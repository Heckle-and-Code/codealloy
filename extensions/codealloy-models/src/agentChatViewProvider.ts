import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import { LocalModelManager } from './modelManager';
import { LlamaServerService } from './llamaServerService';
import { ShadowGitService, TimelineEntry } from './shadowGitService';

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system' | 'tool';
	name?: string;
	content: string;
	timestamp: number;
}

export class AgentChatViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'codealloy.agentView';

	private _view?: vscode.WebviewView;
	private _messages: ChatMessage[] = [];
	private _activeRequest?: http.ClientRequest;
	private _currentPrompt?: string;
	private _currentAssistantMsg?: ChatMessage;
	private _autonomyLevel: string = 'L3'; // L0, L1, L2 (Supervisor), L3 (Guarded), L4 (Autonomous)
	private _outputChannel: vscode.OutputChannel;
	private readonly _onDidChangeAutonomyLevel = new vscode.EventEmitter<string>();
	public readonly onDidChangeAutonomyLevel: vscode.Event<string> = this._onDidChangeAutonomyLevel.event;
	private _pendingApprovals: Map<string, (decision: { approved: boolean; reason?: string }) => void> = new Map();
	private _shadowGit?: ShadowGitService;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _modelManager: LocalModelManager,
		private readonly _llamaServer: LlamaServerService
	) {
		this._outputChannel = vscode.window.createOutputChannel('CodeAlloy Agent Chat');
	}

	public getShadowGit(): ShadowGitService {
		if (!this._shadowGit) {
			const workspacePath = this._getWorkspacePath();
			this._shadowGit = new ShadowGitService(workspacePath, this._outputChannel);
		}
		return this._shadowGit;
	}

	private _getWorkspacePath(): string {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (workspaceFolder) return workspaceFolder;
		const activeDoc = vscode.window.activeTextEditor?.document.uri;
		if (activeDoc && activeDoc.scheme === 'file') {
			return path.dirname(activeDoc.fsPath);
		}
		return process.env.CODEALLOY_WORKSPACE || '/Users/peter/source/Heckle and Code Projects/editor';
	}

	public getAutonomyLevel(): string {
		return this._autonomyLevel;
	}

	public setAutonomyLevel(level: string): void {
		if (this._autonomyLevel !== level) {
			this._autonomyLevel = level;
			this._onDidChangeAutonomyLevel.fire(level);
			this.syncState();
		}
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this._view = webviewView;
		this._outputChannel.appendLine(`[AgentChat] resolveWebviewView initialized (visible: ${webviewView.visible})`);

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Proactively sync state immediately and after render
		this.syncState();
		setTimeout(() => this.syncState(), 100);
		setTimeout(() => this.syncState(), 500);

		// Handle messages from the webview
		webviewView.webview.onDidReceiveMessage(async (data) => {
			this._outputChannel.appendLine(`[AgentChat Webview Event] type: ${data.type}`);
			switch (data.type) {
				case 'sendMessage':
					await this._handleUserPrompt(data.prompt, data.assistantMsgId);
					break;
				case 'logError':
					this._outputChannel.appendLine(`[AgentChat Webview JS Error]: ${data.error}`);
					break;
				case 'abortStream':
					await this._abortActiveStream();
					break;
				case 'clearChat':
					this.clearChat();
					break;
				case 'insertAtCursor':
					await this._insertAtCursor(data.text);
					break;
				case 'openFile':
					await this._openFileInEditor(data.path);
					break;
				case 'selectModel':
					await vscode.commands.executeCommand('codealloy.selectModel');
					break;
				case 'setAutonomy':
					this.setAutonomyLevel(data.level);
					break;
				case 'actionApproved':
					if (this._pendingApprovals.has(data.actionId)) {
						this._pendingApprovals.get(data.actionId)!({ approved: true });
						this._pendingApprovals.delete(data.actionId);
					}
					break;
				case 'actionRejected':
					if (this._pendingApprovals.has(data.actionId)) {
						this._pendingApprovals.get(data.actionId)!({ approved: false, reason: data.reason || 'User rejected this action' });
						this._pendingApprovals.delete(data.actionId);
					}
					break;
				case 'rollbackTurn': {
					const shadowGit = this.getShadowGit();
					const ok = await shadowGit.rollbackToCommit(data.commitHash);
					if (ok) {
						vscode.window.showInformationMessage(`CodeAlloy: Successfully rolled back turn (${data.commitHash.substring(0, 8)}).`);
						this._view?.webview.postMessage({
							type: 'turnRolledBack',
							assistantMsgId: data.assistantMsgId,
							commitHash: data.commitHash
						});
					} else {
						vscode.window.showErrorMessage(`CodeAlloy: Failed to rollback turn to checkpoint ${data.commitHash.substring(0, 8)}.`);
					}
					break;
				}
				case 'getTimeTravelTimeline': {
					const timeline = this.getShadowGit().getHistoryTimeline();
					this._view?.webview.postMessage({
						type: 'timelineLoaded',
						timeline
					});
					break;
				}
				case 'rollbackToTimelinePoint': {
					const shadowGit = this.getShadowGit();
					const ok = await shadowGit.rollbackToCommit(data.commitHash);
					if (ok) {
						vscode.window.showInformationMessage(`CodeAlloy: Workspace reverted to historical checkpoint (${data.commitHash.substring(0, 8)}).`);
						this._view?.webview.postMessage({
							type: 'timelineRolledBack',
							commitHash: data.commitHash
						});
					} else {
						vscode.window.showErrorMessage(`CodeAlloy: Failed to revert to checkpoint ${data.commitHash.substring(0, 8)}.`);
					}
					break;
				}
				case 'ready':
					this._outputChannel.appendLine('[AgentChat] Webview reported ready');
					this.syncState();
					break;
			}
		});

		// Listen to visibility
		webviewView.onDidChangeVisibility(() => {
			this._outputChannel.appendLine(`[AgentChat] Visibility changed: ${webviewView.visible}`);
			if (webviewView.visible) {
				this.syncState();
			}
		});
	}

	public syncState(): void {
		if (!this._view) return;

		const activeModel = this._modelManager.getActiveModel();
		const serverStatus = this._llamaServer.getStatus();
		const config = vscode.workspace.getConfiguration('codealloy');
		const provider = config.get<string>('inferenceProvider', 'embedded');
		const externalEndpoint = config.get<string>('externalEndpoint', 'http://127.0.0.1:11434');

		const isRunning = provider === 'embedded' ? serverStatus.running : true;
		const endpointUrl = provider === 'embedded' ? this._llamaServer.getEndpointUrl() : externalEndpoint;

		this._view.webview.postMessage({
			type: 'syncState',
			activeModel: activeModel || null,
			serverRunning: isRunning,
			provider: provider,
			endpoint: endpointUrl,
			autonomyLevel: this._autonomyLevel,
			messages: this._messages
		});
	}

	public clearChat(): void {
		this._abortActiveStream();
		this._messages = [];
		if (this._view) {
			this._view.webview.postMessage({
				type: 'chatCleared'
			});
		}
	}

	private async _abortActiveStream(): Promise<void> {
		if (this._activeRequest) {
			try {
				this._activeRequest.destroy();
			} catch (e) {
				console.error('[AgentChat] Error aborting stream:', e);
			}
			this._activeRequest = undefined;
		}

		// Ensure any partially generated file is saved and opened
		if (this._currentPrompt && this._currentAssistantMsg && this._currentAssistantMsg.content.trim().length > 0) {
			try {
				await this._detectAndExecuteFiles(this._currentPrompt, this._currentAssistantMsg.content, this._currentAssistantMsg.id);
			} catch (e: any) {
				this._outputChannel.appendLine(`[AgentChat Error saving file on abort]: ${e?.message}`);
			}
		}
	}

	private async _insertAtCursor(text: string): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('CodeAlloy: No active text editor to insert code into.');
			return;
		}

		await editor.edit((editBuilder) => {
			if (!editor.selection.isEmpty) {
				editBuilder.replace(editor.selection, text);
			} else {
				editBuilder.insert(editor.selection.active, text);
			}
		});

		vscode.window.showInformationMessage('CodeAlloy: Inserted code at cursor.');
	}

	private async _openFileInEditor(filePath: string): Promise<void> {
		try {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
			const targetUri = workspaceFolder ? vscode.Uri.joinPath(workspaceFolder, filePath) : vscode.Uri.file(path.resolve(filePath));
			const doc = await vscode.workspace.openTextDocument(targetUri);
			await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
		} catch (err: any) {
			vscode.window.showErrorMessage(`CodeAlloy: Could not open "${filePath}": ${err?.message}`);
		}
	}

	private _isDangerousCommand(command: string): boolean {
		return (
			/\brm\s+-rf\s+[/~]/i.test(command) ||
			/\bsudo\b/i.test(command) ||
			/\bgit\s+push\s+.*--force/i.test(command) ||
			/\bcurl\b.*\|\s*(ba)?sh/i.test(command) ||
			/\bwget\b.*\|\s*(ba)?sh/i.test(command) ||
			/\bmkfs\b/i.test(command) ||
			/\bdd\s+if=/i.test(command)
		);
	}

	private async _requestUserApproval(
		type: 'file' | 'command',
		target: string,
		details: string,
		assistantMsgId: string
	): Promise<{ approved: boolean; reason?: string }> {
		const actionId = `act-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
		if (this._view) {
			this._view.webview.postMessage({
				type: 'actionApprovalRequired',
				actionId,
				actionType: type,
				target,
				details,
				assistantMsgId
			});
		}

		return new Promise((resolve) => {
			this._pendingApprovals.set(actionId, resolve);
		});
	}

	private async _executeFileAction(fileName: string, content: string, assistantMsgId: string): Promise<boolean> {
		try {
			// L0 Assist: Read-only advisory mode
			if (this._autonomyLevel === 'L0') {
				this._outputChannel.appendLine(`[AgentChat L0] Blocked file write to "${fileName}" in Read-Only Assist mode.`);
				vscode.window.showWarningMessage(`CodeAlloy: File modification blocked in L0 Assist (read-only) mode.`);
				return false;
			}

			// L2 Supervised: 1-click human approval
			if (this._autonomyLevel === 'L2') {
				const lineCount = content.split('\n').length;
				const preview = content.length > 350
					? content.substring(0, 350) + `\n... (+${content.length - 350} chars, ${lineCount} lines total)`
					: content;
				const approval = await this._requestUserApproval('file', fileName, preview, assistantMsgId);
				if (!approval.approved) {
					this._outputChannel.appendLine(`[AgentChat L2] User rejected file write for "${fileName}": ${approval.reason}`);
					return false;
				}
			}

			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
			let targetUri: vscode.Uri;
			if (workspaceFolder) {
				targetUri = vscode.Uri.joinPath(workspaceFolder, fileName);
			} else {
				const activeDoc = vscode.window.activeTextEditor?.document.uri;
				if (activeDoc && activeDoc.scheme === 'file') {
					targetUri = vscode.Uri.joinPath(vscode.Uri.file(path.dirname(activeDoc.fsPath)), fileName);
				} else {
					const fallbackBase = process.env.CODEALLOY_WORKSPACE ||
						vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath ||
						'/Users/peter/source/Heckle and Code Projects/editor';
					if (!fs.existsSync(fallbackBase)) {
						try { fs.mkdirSync(fallbackBase, { recursive: true }); } catch {}
					}
					targetUri = vscode.Uri.file(path.join(fallbackBase, fileName));
				}
			}

			// Ensure parent directory exists
			const dirUri = vscode.Uri.file(path.dirname(targetUri.fsPath));
			try {
				await vscode.workspace.fs.createDirectory(dirUri);
			} catch {}

			// Write content to disk
			await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content, 'utf8'));
			const relPath = workspaceFolder ? vscode.workspace.asRelativePath(targetUri) : targetUri.fsPath;
			this._outputChannel.appendLine(`[AgentChat] Successfully wrote file to filesystem: ${targetUri.fsPath} (${content.length} bytes)`);

			// Open file in active editor area (column 1 next to sidebar)
			const doc = await vscode.workspace.openTextDocument(targetUri);
			await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });

			vscode.window.showInformationMessage(`CodeAlloy: Created "${path.basename(targetUri.fsPath)}" at ${targetUri.fsPath}`);

			// Notify webview with confirmation
			if (this._view) {
				this._view.webview.postMessage({
					type: 'fileCreated',
					assistantMsgId,
					fileName: fileName,
					filePath: targetUri.fsPath,
					bytes: content.length
				});
			}

			return true;
		} catch (err: any) {
			this._outputChannel.appendLine(`[AgentChat Error writing file]: ${err?.message}`);
			vscode.window.showErrorMessage(`CodeAlloy: Failed to write "${fileName}": ${err?.message}`);
			return false;
		}
	}

	private async _executeShellCommand(command: string, assistantMsgId: string): Promise<{ success: boolean; output: string }> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
			process.env.CODEALLOY_WORKSPACE ||
			'/Users/peter/source/Heckle and Code Projects/editor';

		// L0 Assist: Read-only mode
		if (this._autonomyLevel === 'L0') {
			this._outputChannel.appendLine(`[AgentChat L0] Blocked shell command in Read-Only Assist mode.`);
			vscode.window.showWarningMessage(`CodeAlloy: Command execution blocked in L0 Assist (read-only) mode.`);
			return { success: false, output: 'Command execution disabled in L0 Assist mode.' };
		}

		// Security guardrail for dangerous operations (US-2.3)
		if (this._isDangerousCommand(command)) {
			this._outputChannel.appendLine(`[AgentChat Dangerous Command Intercepted]: "${command}"`);
			const choice = await vscode.window.showWarningMessage(
				`CodeAlloy Security Guard:\n\nThe agent proposed executing a sensitive or destructive command:\n"${command}"\n\nDo you want to allow this command to run?`,
				{ modal: true },
				'Approve Command',
				'Block Command'
			);
			if (choice !== 'Approve Command') {
				return { success: false, output: 'Command blocked by user security guard.' };
			}
		}

		// L2 Supervised: 1-click human approval
		if (this._autonomyLevel === 'L2') {
			const approval = await this._requestUserApproval('command', command, `Execute in workspace root:\n$ ${command}`, assistantMsgId);
			if (!approval.approved) {
				this._outputChannel.appendLine(`[AgentChat L2] User rejected command "${command}": ${approval.reason}`);
				return { success: false, output: `Command rejected by user: ${approval.reason || 'User declined permission'}` };
			}
		}

		this._outputChannel.appendLine(`[AgentChat] Executing shell command in ${workspaceFolder}: ${command}`);

		if (this._view) {
			this._view.webview.postMessage({
				type: 'commandStarted',
				assistantMsgId,
				command
			});
		}

		return new Promise((resolve) => {
			exec(command, { cwd: workspaceFolder, maxBuffer: 10 * 1024 * 1024, timeout: 60000 }, (err, stdout, stderr) => {
				if (err) {
					const errMsg = err.message || stderr || 'Execution error';
					this._outputChannel.appendLine(`[AgentChat Command Error]: ${errMsg}`);
					if (this._view) {
						this._view.webview.postMessage({
							type: 'commandCompleted',
							assistantMsgId,
							command,
							success: false,
							error: errMsg
						});
					}
					resolve({ success: false, output: errMsg });
				} else {
					const out = stdout.trim() || stderr.trim() || 'Executed successfully with exit code 0';
					this._outputChannel.appendLine(`[AgentChat Command Succeeded]: ${out}`);
					vscode.window.showInformationMessage(`CodeAlloy: Executed "${command.trim()}"`);
					if (this._view) {
						this._view.webview.postMessage({
							type: 'commandCompleted',
							assistantMsgId,
							command,
							success: true,
							output: out
						});
					}
					resolve({ success: true, output: out });
				}
			});
		});
	}

	private _parseToolActions(text: string): Array<{ name: string; arguments: any }> {
		const actions: Array<{ name: string; arguments: any }> = [];

		// 1. JSON tool calls in markdown fences: ```json\n{\n  "name": "...", "arguments": { ... } }\n```
		const jsonRegex = /```(?:json)?\s*(\{\s*"name"\s*:\s*"[^"]+"[\s\S]*?\})\s*```/g;
		let jsonMatch;
		while ((jsonMatch = jsonRegex.exec(text)) !== null) {
			try {
				const parsed = JSON.parse(jsonMatch[1]);
				if (parsed.name && parsed.arguments) {
					actions.push({ name: parsed.name, arguments: parsed.arguments });
				}
			} catch {}
		}

		// 2. Raw JSON tool calls without fences
		if (actions.length === 0) {
			const rawJsonRegex = /(\{\s*"name"\s*:\s*"(?:execute_command|write_file|read_file|list_dir)"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\})/g;
			let rawMatch;
			while ((rawMatch = rawJsonRegex.exec(text)) !== null) {
				try {
					const parsed = JSON.parse(rawMatch[1]);
					if (parsed.name && parsed.arguments) {
						actions.push({ name: parsed.name, arguments: parsed.arguments });
					}
				} catch {}
			}
		}

		// 3. XML tool calls: <tool_call>...</tool_call>
		const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
		let tcMatch;
		while ((tcMatch = toolCallRegex.exec(text)) !== null) {
			try {
				const parsed = JSON.parse(tcMatch[1].trim());
				if (parsed.name && parsed.arguments) {
					actions.push({ name: parsed.name, arguments: parsed.arguments });
				}
			} catch {}
		}

		// 4. XML actions: <actions><action><name>...</name><arguments>...</arguments></action></actions>
		const xmlActionRegex = /<action>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<arguments>([\s\S]*?)<\/arguments>[\s\S]*?<\/action>/g;
		let xmlMatch;
		while ((xmlMatch = xmlActionRegex.exec(text)) !== null) {
			const name = xmlMatch[1].trim();
			const argsRaw = xmlMatch[2].trim();
			let args: any = {};
			try {
				args = JSON.parse(argsRaw);
			} catch {
				const argKeyRegex = /<([a-zA-Z0-9_\-]+)>([\s\S]*?)<\/\1>/g;
				let argMatch;
				while ((argMatch = argKeyRegex.exec(argsRaw)) !== null) {
					args[argMatch[1]] = argMatch[2].trim();
				}
			}
			actions.push({ name, arguments: args });
		}

		// 5. Explicit file fences: ```file:path or ```write:path
		const explicitFileRegex = /```(?:file|write|create|write_file):([a-zA-Z0-9_\-\.\/]+)\n([\s\S]*?)(?:```|$)/g;
		let fileMatch;
		while ((fileMatch = explicitFileRegex.exec(text)) !== null) {
			actions.push({
				name: 'write_file',
				arguments: { path: fileMatch[1].trim(), content: fileMatch[2].replace(/```+$/, '') }
			});
		}

		// 6. Explicit bash command fences: ```bash:run
		const cmdFenceRegex = /```(?:bash:run|sh:run|terminal:run)(?::run)?\n([\s\S]*?)(?:```|$)/g;
		let cmdMatch;
		while ((cmdMatch = cmdFenceRegex.exec(text)) !== null) {
			actions.push({
				name: 'execute_command',
				arguments: { command: cmdMatch[1].replace(/```+$/, '').trim() }
			});
		}

		return actions;
	}

	private async _detectAndExecuteFiles(
		prompt: string,
		content: string,
		assistantMsgId: string
	): Promise<boolean> {
		const isL2Plus = this._autonomyLevel === 'L2' || this._autonomyLevel === 'L3' || this._autonomyLevel === 'L4';
		const fileIntentRegex = /\b(create|make|write|generate|save|put|build|code|prototype|setup|install|venv|virtual\s*env|environment)\b.*\b(file|script|module|routine|portfolio|website|page|webpage|app|component|template|html|python|css|javascript|typescript|api|shell|folder|directory)\b/i;
		const hasActionIntent =
			fileIntentRegex.test(prompt) ||
			/\b(on the filesystem|to disk|in workspace|create the file|make the file|virtual environment|fastapi|venv)\b/i.test(prompt) ||
			isL2Plus;

		if (!hasActionIntent) return false;

		let executedAny = false;

		// 1. Check for explicit file fences: ```file:path or ```write:path
		const explicitFenceRegex = /```(?:file|write|create|write_file|[a-zA-Z0-9_\-]+):([a-zA-Z0-9_\-\.\/]+)\n([\s\S]*?)(?:```|$)/g;
		let match;
		while ((match = explicitFenceRegex.exec(content)) !== null) {
			const fileName = match[1].trim();
			let fileContent = match[2].replace(/```+$/, '');
			if (fileName && fileContent.trim().length > 0) {
				const ok = await this._executeFileAction(fileName, fileContent, assistantMsgId);
				if (ok) executedAny = true;
			}
		}

		// 2. Check for shell command blocks: ```bash:run or ```bash or ```sh
		const cmdFenceRegex = /```(?:bash:run|sh:run|terminal:run|bash|sh|shell)(?::run)?\n([\s\S]*?)(?:```|$)/g;
		let cmdMatch;
		while ((cmdMatch = cmdFenceRegex.exec(content)) !== null) {
			const rawCmd = cmdMatch[1].replace(/```+$/, '').trim();
			if (rawCmd.length > 0) {
				const commands = rawCmd
					.split('\n')
					.map((c) => c.trim())
					.filter((c) => c.length > 0 && !c.startsWith('#'));
				for (const cmd of commands) {
					const res = await this._executeShellCommand(cmd, assistantMsgId);
					if (res.success) executedAny = true;
				}
			}
		}

		// 3. Fallback: single standard code block if no explicit fences were found
		if (!executedAny) {
			const codeBlockRegex = /```([a-zA-Z0-9_\-]+)?\n([\s\S]*?)(?:```|$)/g;
			const codeMatch = codeBlockRegex.exec(content);
			if (codeMatch) {
				const codeContent = codeMatch[2];
				const lang = (codeMatch[1] || '').toLowerCase();

				// If language is bash/sh, execute as command
				if (lang === 'bash' || lang === 'sh' || lang === 'shell') {
					const commands = codeContent
						.split('\n')
						.map((c) => c.trim())
						.filter((c) => c.length > 0 && !c.startsWith('#'));
					for (const cmd of commands) {
						await this._executeShellCommand(cmd, assistantMsgId);
						executedAny = true;
					}
				} else {
					const fileNameRegex = /\b([a-zA-Z0-9_\-]+\.(?:py|js|ts|jsx|tsx|json|html|css|sh|md|go|rs|cpp|c|h|java|rb|php|sql|ya?ml|toml))\b/gi;
					let extractedName: string | undefined;

					const promptMatches = Array.from(prompt.matchAll(fileNameRegex));
					if (promptMatches.length > 0) {
						extractedName = promptMatches[promptMatches.length - 1][1];
					}
					if (!extractedName) {
						const responseMatches = Array.from(content.matchAll(fileNameRegex));
						if (responseMatches.length > 0) {
							extractedName = responseMatches[0][1];
						}
					}
					if (!extractedName) {
						if (lang === 'html' || /\b(html|portfolio|website|webpage|page)\b/i.test(prompt)) {
							extractedName = 'portfolio.html';
						} else if (lang === 'python' || (/\bpython\b/i.test(prompt) && !/\bhtml\b/i.test(prompt))) {
							extractedName = /\bapi\b/i.test(prompt) ? 'api/main.py' : 'main.py';
						} else if (lang === 'javascript' || /\bjavascript\b/i.test(prompt)) {
							extractedName = 'index.js';
						} else if (lang === 'typescript' || /\btypescript\b/i.test(prompt)) {
							extractedName = 'index.ts';
						} else if (lang === 'css' || /\bcss\b/i.test(prompt)) {
							extractedName = 'style.css';
						} else if (lang) {
							extractedName = `script.${lang}`;
						} else {
							extractedName = 'main.py';
						}
					}

					if (extractedName && codeContent.trim().length > 0) {
						return await this._executeFileAction(extractedName, codeContent, assistantMsgId);
					}
				}
			}
		}

		return executedAny;
	}

	private async _executeInferenceStream(
		provider: string,
		externalEndpoint: string,
		activeModel: string,
		messages: any[],
		tools: any[],
		assistantMsgId: string,
		onChunk: (chunk: string) => void
	): Promise<boolean> {
		const requestBody = JSON.stringify({
			model: activeModel,
			messages,
			tools,
			stream: true,
			temperature: 0.1,
			max_tokens: 4096
		});

		let isHttps = false;
		let reqOptions: http.RequestOptions;

		if (provider === 'embedded') {
			const currentPort = this._llamaServer.getStatus().port || 51434;
			reqOptions = {
				hostname: '127.0.0.1',
				port: currentPort,
				path: '/v1/chat/completions',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(requestBody)
				}
			};
		} else {
			try {
				const parsed = new URL(externalEndpoint);
				isHttps = parsed.protocol === 'https:';
				const port = parsed.port ? parseInt(parsed.port, 10) : (isHttps ? 443 : 80);
				const basePath = parsed.pathname.replace(/\/+$/, '');
				reqOptions = {
					hostname: parsed.hostname,
					port,
					path: `${basePath}/v1/chat/completions`,
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Content-Length': Buffer.byteLength(requestBody)
					}
				};
			} catch (e: any) {
				this._outputChannel.appendLine(`[AgentChat Error] Invalid external endpoint URL: ${externalEndpoint}`);
				return false;
			}
		}

		return new Promise<boolean>((resolve) => {
			const client = isHttps ? https : http;
			const req = client.request(reqOptions, (res) => {
				let buffer = '';

				res.on('data', (chunk: Buffer) => {
					buffer += chunk.toString();
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed || !trimmed.startsWith('data:')) continue;

						const payload = trimmed.substring(5).trim();
						if (payload === '[DONE]') {
							continue;
						}

						try {
							const parsed = JSON.parse(payload);
							const delta = parsed.choices?.[0]?.delta?.content;
							if (delta) {
								onChunk(delta);
							}
						} catch {}
					}
				});

				res.on('end', () => {
					this._activeRequest = undefined;
					resolve(true);
				});
			});

			req.on('error', (err) => {
				this._activeRequest = undefined;
				this._outputChannel.appendLine(`[AgentChat Stream Error]: ${err.message}`);
				resolve(false);
			});

			this._activeRequest = req;
			req.write(requestBody);
			req.end();
		});
	}

	private async _handleUserPrompt(prompt: string, incomingTurnId?: string): Promise<void> {
		if (!prompt || prompt.trim().length === 0) return;

		const assistantMsgId = incomingTurnId || `assistant-${Date.now()}`;
		this._outputChannel.appendLine(`[AgentChat] Handling prompt: "${prompt}" (turnId: ${assistantMsgId})`);

		if (this._activeRequest) {
			this._outputChannel.appendLine('[AgentChat Warning] Generation already in progress.');
			vscode.window.showWarningMessage('CodeAlloy: Agent is currently generating a response.');
			return;
		}

		const activeModel = this._modelManager.getActiveModel();
		if (!activeModel) {
			this._outputChannel.appendLine('[AgentChat Error] No active model selected');
			if (this._view) {
				this._view.webview.postMessage({
					type: 'showNotice',
					level: 'error',
					message: 'No model selected. Click the flame badge or select a model to begin.'
				});
			}
			return;
		}

		// 1. Push User Message
		const userMsg: ChatMessage = {
			id: `user-${Date.now()}`,
			role: 'user',
			content: prompt.trim(),
			timestamp: Date.now()
		};
		this._messages.push(userMsg);

		// 2. Prepare Assistant Turn in UI
		const assistantMsg: ChatMessage = {
			id: assistantMsgId,
			role: 'assistant',
			content: '',
			timestamp: Date.now()
		};
		this._messages.push(assistantMsg);
		this._currentPrompt = prompt;
		this._currentAssistantMsg = assistantMsg;

		if (this._view) {
			this._view.webview.postMessage({
				type: 'streamStart',
				userMsg,
				assistantMsgId
			});
		}

		// 3. Ensure inference engine is running
		const config = vscode.workspace.getConfiguration('codealloy');
		const provider = config.get<string>('inferenceProvider', 'embedded');
		const externalEndpoint = config.get<string>('externalEndpoint', 'http://127.0.0.1:11434');

		if (provider === 'embedded') {
			let serverStatus = this._llamaServer.getStatus();
			if (!serverStatus.running) {
				const fullPath = path.join(this._modelManager.getModelsDirectory(), activeModel);
				this._outputChannel.appendLine(`[AgentChat] Starting embedded inference engine: ${fullPath}`);

				if (this._view) {
					this._view.webview.postMessage({
						type: 'streamChunk',
						assistantMsgId,
						chunk: `*(Igniting Apple Silicon Metal GPU engine for "${activeModel}"...)*\n\n`
					});
				}

				const started = await this._llamaServer.start(fullPath);
				if (!started) {
					this._outputChannel.appendLine(`[AgentChat Error] Failed to start engine for ${activeModel}`);
					assistantMsg.content = `*(Failed to start inference engine for "${activeModel}". Please check Output > CodeAlloy Inference Engine for details.)*`;
					if (this._view) {
						this._view.webview.postMessage({
							type: 'streamEnd',
							assistantMsgId,
							fullContent: assistantMsg.content
						});
					}
					return;
				}
				this.syncState();
			}
		} else {
			this._outputChannel.appendLine(`[AgentChat] Using external provider at ${externalEndpoint} for model: ${activeModel}`);
		}

		// 4. Tool Definitions based on Autonomy Level
		const isReadOnly = this._autonomyLevel === 'L0' || this._autonomyLevel === 'L1';
		const tools = isReadOnly
			? []
			: [
				{
					type: 'function',
					function: {
						name: 'write_file',
						description: 'Write or overwrite a file directly in the workspace filesystem and open it in the editor.',
						parameters: {
							type: 'object',
							properties: {
								path: { type: 'string', description: 'Relative file path (e.g. "api/main.py" or "portfolio.html")' },
								content: { type: 'string', description: 'Complete source code or text content to write' }
							},
							required: ['path', 'content']
						}
					}
				},
				{
					type: 'function',
					function: {
						name: 'execute_command',
						description: 'Execute a terminal or shell command in the workspace root directory (e.g. creating virtual environments, installing dependencies, creating directories).',
						parameters: {
							type: 'object',
							properties: {
								command: { type: 'string', description: 'Shell command to execute' }
							},
							required: ['command']
						}
					}
				}
			];

		let systemPrompt = '';
		if (this._autonomyLevel === 'L0') {
			systemPrompt =
				'You are CodeAlloy Agent in Read-Only Assist Mode (L0).\n' +
				'Provide code explanations, architectural analysis, or suggestions.\n' +
				'You do not have access to tools and must NOT write files or execute commands on the system.';
		} else if (this._autonomyLevel === 'L1') {
			systemPrompt =
				'You are CodeAlloy Agent in Interactive Chat Mode (L1).\n' +
				'Collaborate as a coding partner. Answer questions and design solutions.\n' +
				'You do not have access to tools and must NOT write files or execute commands on the system.';
		} else if (this._autonomyLevel === 'L2') {
			systemPrompt =
				'You are CodeAlloy Agent in Supervised Mode (L2).\n' +
				'You have access to tools (write_file, execute_command). Each action will be paused for user review and approval before execution on disk.\n' +
				'Execute tasks cleanly using tools without giving conversational tutorials.';
		} else if (this._autonomyLevel === 'L4') {
			systemPrompt =
				'You are CodeAlloy Agent in Autonomous Goal Mode (L4).\n' +
				'You are assigned a self-contained engineering goal. Plan, execute tools, verify outcomes, and self-heal across multiple iterations until the goal is achieved.\n' +
				'Continue invoking write_file and execute_command until all tasks and tests are satisfied, then provide a final confirmation.';
		} else {
			// L3 Guarded (Default)
			systemPrompt =
				'You are CodeAlloy Agent, the autonomous AI engineering partner embedded directly in the CodeAlloy IDE (Guarded Mode L3).\n' +
				'You have direct capability to forge files and execute terminal commands in the workspace using tools.\n\n' +
				'STRICT OPERATING RULES:\n' +
				'1. NEVER give tutorials, step-by-step numbered guides, or tell the user how to do something (e.g., NEVER say "Here is how you can...", "1. Create the folder: mkdir", "2. Run cd", etc.).\n' +
				'2. YOU MUST EXECUTE ALL ACTIONS AUTONOMOUSLY using the available tools:\n' +
				'   - Call execute_command to run terminal commands (creating folders, setting up virtual environments, installing dependencies).\n' +
				'   - Call write_file to create or overwrite project files on disk.\n' +
				'3. Continue invoking tools until all requested directories, environments, and files are created.\n' +
				'4. When all actions are complete, conclude with a single concise confirmation sentence.\n' +
				'5. Do not output conversational preamble before calling tools.';
		}

		// 5. Multi-Turn Autonomous Agentic Execution Loop
		const MAX_AGENTIC_TURNS = this._autonomyLevel === 'L4' ? 25 : (isReadOnly ? 1 : 6);
		let turnCount = 0;
		let consecutiveErrors: string[] = [];
		let conversationMessages: any[] = [
			{ role: 'system', content: systemPrompt },
			...this._messages
				.filter((m) => m.id !== assistantMsgId && m.id !== userMsg.id && m.content.trim().length > 0)
				.slice(-6)
				.map((m) => ({ role: m.role, content: m.content.trim() })),
			{ role: 'user', content: prompt.trim() }
		];

		let totalAccumulatedDisplay = '';

		// Sub-50ms atomic pre-turn snapshot (US-3.1)
		const shadowGit = this.getShadowGit();
		let preCommitHash: string | null = null;
		if (!isReadOnly) {
			preCommitHash = await shadowGit.createPreTurnSnapshot(assistantMsgId, prompt);
		}

		while (turnCount < MAX_AGENTIC_TURNS) {
			turnCount++;
			this._outputChannel.appendLine(`[AgentChat Loop] Turn ${turnCount}/${MAX_AGENTIC_TURNS} starting (mode: ${this._autonomyLevel})...`);

			let turnContent = '';
			const streamSuccess = await this._executeInferenceStream(
				provider,
				externalEndpoint,
				activeModel,
				conversationMessages,
				tools,
				assistantMsgId,
				(chunk: string) => {
					turnContent += chunk;
					totalAccumulatedDisplay += chunk;
					if (this._view) {
						this._view.webview.postMessage({
							type: 'streamChunk',
							assistantMsgId,
							chunk
						});
					}
				}
			);

			if (!streamSuccess) {
				if (!totalAccumulatedDisplay) {
					totalAccumulatedDisplay = '*(Error communicating with inference engine)*';
				}
				break;
			}

			// In read-only modes (L0/L1), stop after 1 conversational turn
			if (isReadOnly) {
				break;
			}

			// Parse tool actions
			const actions = this._parseToolActions(turnContent);
			this._outputChannel.appendLine(`[AgentChat Loop] Turn ${turnCount} yielded ${actions.length} action(s).`);

			if (actions.length === 0) {
				// Fallback detection in case standard code blocks without tool format were returned
				const executedFallback = await this._detectAndExecuteFiles(prompt, turnContent, assistantMsgId);
				if (!executedFallback) {
					this._outputChannel.appendLine(`[AgentChat Loop] No further actions. Agent completed task.`);
				}
				break;
			}

			// Add assistant turn to conversation context
			conversationMessages.push({
				role: 'assistant',
				content: turnContent
			});

			// Execute all tool actions sequentially
			let circuitBreakerTripped = false;
			for (const action of actions) {
				if (action.name === 'execute_command' && action.arguments?.command) {
					const cmd = action.arguments.command;
					const res = await this._executeShellCommand(cmd, assistantMsgId);
					conversationMessages.push({
						role: 'tool',
						name: 'execute_command',
						content: res.success
							? `Command "${cmd}" executed successfully with exit code 0. Output:\n${res.output}`
							: `Command "${cmd}" failed with error: ${res.output}`
					});

					// L4 Circuit Breaker: Error loop detector (US-2.4)
					if (!res.success && this._autonomyLevel === 'L4') {
						const errSig = (res.output || '').trim().toLowerCase().substring(0, 150);
						consecutiveErrors.push(errSig);
						const errLen = consecutiveErrors.length;
						if (errLen >= 3 && consecutiveErrors[errLen - 1] === consecutiveErrors[errLen - 2] && consecutiveErrors[errLen - 2] === consecutiveErrors[errLen - 3]) {
							this._outputChannel.appendLine(`[AgentChat Circuit Breaker] Tripped! Repeated error: ${errSig}`);
							vscode.window.showErrorMessage(`CodeAlloy Circuit Breaker: Tripped on 3 identical consecutive errors. Halting autonomous loop.`);
							if (this._view) {
								this._view.webview.postMessage({
									type: 'showNotice',
									level: 'error',
									message: '⚡ Circuit Breaker Tripped: The same error occurred 3 times in a row. Halting autonomous loop to prevent infinite churn.'
								});
							}
							circuitBreakerTripped = true;
							break;
						}
					} else if (res.success) {
						consecutiveErrors = [];
					}
				} else if (action.name === 'write_file' && action.arguments?.path && action.arguments?.content) {
					const ok = await this._executeFileAction(action.arguments.path, action.arguments.content, assistantMsgId);
					conversationMessages.push({
						role: 'tool',
						name: 'write_file',
						content: ok
							? `File "${action.arguments.path}" successfully created and opened in editor.`
							: `Failed to write file "${action.arguments.path}".`
					});
				}
			}

			if (circuitBreakerTripped) {
				break;
			}
		}

		let modifiedFiles: string[] = [];
		if (preCommitHash) {
			modifiedFiles = await shadowGit.finalizeTurn(assistantMsgId, preCommitHash, prompt);
		}

		assistantMsg.content = totalAccumulatedDisplay;
		if (this._view) {
			this._view.webview.postMessage({
				type: 'streamEnd',
				assistantMsgId,
				fullContent: assistantMsg.content
			});

			if (preCommitHash && modifiedFiles.length > 0) {
				this._view.webview.postMessage({
					type: 'turnCheckpointed',
					assistantMsgId,
					commitHash: preCommitHash,
					modifiedFiles
				});
			}
		}
	}

	private _getHtmlForWebview(_webview: vscode.Webview): string {
		const scriptPath = path.join(this._extensionUri.fsPath, 'resources', 'agentChat.js');
		let scriptContent = '';
		try {
			scriptContent = fs.readFileSync(scriptPath, 'utf8');
		} catch (err: any) {
			this._outputChannel.appendLine(`[AgentChat Error reading script]: ${err?.message}`);
		}

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>CodeAlloy Agent</title>
	<style>
		:root {
			--ca-bg: #0E0F12;
			--ca-surface: #16171B;
			--ca-surface-hover: #1E2026;
			--ca-border: #272A30;
			--ca-border-subtle: #1D2026;
			--ca-amber: #FF6B00;
			--ca-amber-glow: rgba(255, 107, 0, 0.25);
			--ca-gold: #FFA000;
			--ca-text-primary: #ECEFF4;
			--ca-text-secondary: #9BA1B0;
			--ca-text-muted: #5C6370;
			--ca-code-bg: #0B0C0E;
			--ca-success: #4EBD79;
			--ca-error: #E06C75;
		}

		* {
			box-sizing: border-box;
			margin: 0;
			padding: 0;
		}

		body {
			background-color: var(--ca-bg);
			color: var(--ca-text-primary);
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
			font-size: 13px;
			line-height: 1.5;
			display: flex;
			flex-direction: column;
			height: 100vh;
			overflow: hidden;
		}

		/* Header Section */
		.header {
			padding: 10px 12px;
			background: var(--ca-surface);
			border-bottom: 1px solid var(--ca-border);
			display: flex;
			flex-direction: column;
			gap: 8px;
			flex-shrink: 0;
		}

		.model-bar {
			display: flex;
			align-items: center;
			justify-content: space-between;
			font-size: 11px;
		}

		.model-badge {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 3px 8px;
			border-radius: 4px;
			background: rgba(255, 107, 0, 0.08);
			border: 1px solid rgba(255, 107, 0, 0.3);
			color: var(--ca-gold);
			font-weight: 600;
			cursor: pointer;
			transition: all 0.15s ease;
		}

		.model-badge:hover {
			background: rgba(255, 107, 0, 0.16);
			border-color: var(--ca-amber);
		}

		.status-dot {
			width: 6px;
			height: 6px;
			border-radius: 50%;
			background: var(--ca-success);
			box-shadow: 0 0 6px rgba(78, 189, 121, 0.6);
		}

		.status-dot.offline {
			background: var(--ca-text-muted);
			box-shadow: none;
		}

		.clear-btn {
			background: none;
			border: none;
			color: var(--ca-text-muted);
			cursor: pointer;
			padding: 3px 6px;
			border-radius: 3px;
			font-size: 11px;
		}

		.clear-btn:hover {
			color: var(--ca-text-primary);
			background: var(--ca-surface-hover);
		}

		/* Autonomy Dial Segmented Control */
		.autonomy-container {
			display: flex;
			background: var(--ca-bg);
			border: 1px solid var(--ca-border);
			border-radius: 6px;
			padding: 2px;
			gap: 2px;
		}

		.autonomy-dial-btn {
			flex: 1;
			background: none;
			border: none;
			color: var(--ca-text-secondary);
			font-size: 10px;
			font-weight: 600;
			padding: 4px 2px;
			text-align: center;
			border-radius: 4px;
			cursor: pointer;
			transition: all 0.15s ease;
		}

		.autonomy-dial-btn:hover {
			color: var(--ca-text-primary);
			background: var(--ca-surface-hover);
		}

		.autonomy-dial-btn.active {
			background: var(--ca-amber);
			color: #0E0F12;
			box-shadow: 0 1px 4px var(--ca-amber-glow);
		}

		/* Messages Scroll Area */
		.messages-container {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			padding: 12px;
			display: flex;
			flex-direction: column;
			gap: 14px;
		}

		.empty-state {
			margin: auto;
			text-align: center;
			padding: 24px 16px;
			max-width: 280px;
			background: var(--ca-surface);
			border: 1px dashed var(--ca-border);
			border-radius: 8px;
		}

		.empty-flame {
			font-size: 28px;
			color: var(--ca-amber);
			margin-bottom: 8px;
		}

		.empty-title {
			font-weight: 600;
			font-size: 13px;
			margin-bottom: 6px;
			color: var(--ca-text-primary);
		}

		.empty-desc {
			font-size: 11px;
			color: var(--ca-text-secondary);
			margin-bottom: 12px;
			line-height: 1.4;
		}

		.prompt-chips {
			display: flex;
			flex-direction: column;
			gap: 6px;
			margin-top: 10px;
			width: 100%;
			text-align: left;
		}

		.chip-btn {
			background: var(--ca-code-bg);
			border: 1px solid var(--ca-border);
			color: var(--ca-text-primary);
			border-radius: 5px;
			padding: 7px 10px;
			font-size: 11px;
			text-align: left;
			cursor: pointer;
			transition: all 0.15s ease;
			display: flex;
			align-items: center;
			gap: 6px;
		}

		.chip-btn:hover {
			border-color: var(--ca-amber);
			background: rgba(255, 107, 0, 0.08);
			color: var(--ca-gold);
		}

		.model-tag {
			display: inline-block;
			background: rgba(78, 189, 121, 0.15);
			color: var(--ca-success);
			border: 1px solid rgba(78, 189, 121, 0.3);
			padding: 2px 7px;
			border-radius: 3px;
			font-size: 10.5px;
			font-weight: 600;
			margin: 4px 0;
			word-break: break-all;
		}

		.btn-primary {
			background: var(--ca-amber);
			color: #0E0F12;
			border: none;
			border-radius: 4px;
			padding: 6px 12px;
			font-weight: 600;
			font-size: 11px;
			cursor: pointer;
			transition: filter 0.15s ease;
		}

		.btn-primary:hover {
			filter: brightness(1.1);
		}

		.message-bubble {
			display: flex;
			flex-direction: column;
			gap: 4px;
			max-width: 100%;
			animation: fadeIn 0.15s ease-out;
		}

		@keyframes fadeIn {
			from { opacity: 0; transform: translateY(4px); }
			to { opacity: 1; transform: translateY(0); }
		}

		.message-bubble.user {
			align-self: flex-end;
			background: #1C2029;
			border: 1px solid #2B303C;
			border-left: 3px solid var(--ca-amber);
			padding: 8px 12px;
			border-radius: 6px;
			max-width: 90%;
			color: #FFFFFF !important;
		}

		.message-bubble.assistant {
			align-self: flex-start;
			background: var(--ca-surface);
			border: 1px solid var(--ca-border);
			padding: 10px 12px;
			border-radius: 6px;
			width: 100%;
			color: #ECEFF4 !important;
		}

		.message-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			font-size: 10px;
			color: var(--ca-text-muted) !important;
			margin-bottom: 4px;
		}

		.message-content {
			word-break: break-word;
			font-size: 12.5px;
			line-height: 1.5;
			color: #ECEFF4 !important;
		}

		.message-content p {
			margin-bottom: 8px;
			color: #ECEFF4 !important;
		}

		.message-content p:last-child {
			margin-bottom: 0;
		}

		.message-bubble.user .message-content,
		.message-bubble.user .message-content p {
			color: #FFFFFF !important;
		}

		/* Code Blocks */
		.code-block {
			background: var(--ca-code-bg);
			border: 1px solid var(--ca-border);
			border-radius: 5px;
			margin: 8px 0;
			overflow: hidden;
			font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
			font-size: 11.5px;
		}

		.code-header {
			background: #131418;
			padding: 4px 8px;
			display: flex;
			align-items: center;
			justify-content: space-between;
			border-bottom: 1px solid var(--ca-border-subtle);
			font-size: 10px;
			color: var(--ca-text-secondary);
		}

		.code-actions {
			display: flex;
			gap: 6px;
		}

		.code-action-btn {
			background: transparent;
			border: 1px solid var(--ca-border);
			color: var(--ca-text-secondary);
			border-radius: 3px;
			padding: 2px 6px;
			font-size: 10px;
			cursor: pointer;
			transition: all 0.15s ease;
		}

		.code-action-btn:hover {
			background: var(--ca-surface-hover);
			color: var(--ca-amber);
			border-color: var(--ca-amber);
		}

		.code-block pre {
			padding: 8px 10px;
			overflow-x: auto;
			line-height: 1.4;
			color: #D8DEE9 !important;
		}

		/* Inline Code */
		code.inline-code {
			background: var(--ca-code-bg);
			border: 1px solid var(--ca-border);
			padding: 1px 4px;
			border-radius: 3px;
			font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
			font-size: 11px;
			color: var(--ca-gold) !important;
		}

		/* Input Footer */
		.input-container {
			padding: 10px 12px;
			background: var(--ca-surface);
			border-top: 1px solid var(--ca-border);
			display: flex;
			flex-direction: column;
			gap: 6px;
			flex-shrink: 0;
		}

		.input-box-wrapper {
			display: flex;
			background: var(--ca-bg);
			border: 1px solid var(--ca-border);
			border-radius: 6px;
			padding: 6px 8px;
			transition: border-color 0.15s ease;
		}

		.input-box-wrapper:focus-within {
			border-color: var(--ca-amber);
			box-shadow: 0 0 0 1px var(--ca-amber-glow);
		}

		textarea#promptInput {
			flex: 1;
			background: transparent;
			border: none;
			outline: none;
			color: #ECEFF4 !important;
			font-family: inherit;
			font-size: 12.5px;
			resize: none;
			min-height: 38px;
			max-height: 140px;
		}

		textarea#promptInput::placeholder {
			color: var(--ca-text-muted);
		}

		.input-actions {
			display: flex;
			align-items: center;
			justify-content: space-between;
			font-size: 10px;
			color: var(--ca-text-muted);
		}

		.send-btn {
			background: var(--ca-amber);
			color: #0E0F12;
			border: none;
			border-radius: 4px;
			padding: 4px 10px;
			font-weight: 600;
			font-size: 11px;
			cursor: pointer;
			display: flex;
			align-items: center;
			gap: 4px;
		}

		.send-btn:hover {
			filter: brightness(1.1);
		}

		.stop-btn {
			background: var(--ca-error);
			color: #fff;
			border: none;
			border-radius: 4px;
			padding: 4px 10px;
			font-weight: 600;
			font-size: 11px;
			cursor: pointer;
			display: none;
		}

		.typing-indicator {
			display: inline-block;
			width: 6px;
			height: 12px;
			background: var(--ca-amber);
			vertical-align: middle;
			margin-left: 2px;
			animation: blink 0.8s infinite;
		}

		.forging-banner {
			display: inline-flex;
			align-items: center;
			gap: 8px;
			padding: 6px 12px;
			background: rgba(255, 107, 0, 0.08);
			border: 1px solid rgba(255, 107, 0, 0.3);
			border-radius: 6px;
			color: var(--ca-gold);
			font-size: 11.5px;
			font-weight: 500;
			animation: forgePulse 1.5s infinite ease-in-out;
		}

		.flame-icon {
			font-size: 14px;
			display: inline-block;
			animation: flameWiggle 1s infinite ease-in-out;
		}

		@keyframes forgePulse {
			0%, 100% { opacity: 0.85; border-color: rgba(255, 107, 0, 0.25); }
			50% { opacity: 1; border-color: rgba(255, 107, 0, 0.7); box-shadow: 0 0 10px rgba(255, 107, 0, 0.25); }
		}

		@keyframes flameWiggle {
			0%, 100% { transform: scale(1); }
			50% { transform: scale(1.2); }
		}

		@keyframes blink {
			0%, 100% { opacity: 1; }
			50% { opacity: 0; }
		}

		.file-action-badge {
			display: flex;
			align-items: center;
			gap: 8px;
			margin-top: 10px;
			padding: 7px 12px;
			background: rgba(78, 189, 121, 0.12);
			border: 1px solid rgba(78, 189, 121, 0.4);
			border-radius: 6px;
			font-size: 11.5px;
			color: #4EBD79 !important;
			cursor: pointer;
			transition: all 0.15s ease;
		}

		.file-action-badge.forging {
			background: rgba(255, 107, 0, 0.08);
			border-color: rgba(255, 107, 0, 0.4);
			color: var(--ca-gold) !important;
			animation: forgePulse 1.5s infinite ease-in-out;
		}

		.file-action-badge.forging strong {
			color: var(--ca-gold) !important;
		}

		.file-action-badge.created {
			background: rgba(78, 189, 121, 0.12);
			border-color: rgba(78, 189, 121, 0.4);
			color: #4EBD79 !important;
		}

		.file-action-badge:hover {
			background: rgba(78, 189, 121, 0.22);
			border-color: var(--ca-success);
		}

		.file-action-badge strong {
			color: #4EBD79 !important;
		}

		.file-action-badge code {
			background: var(--ca-code-bg);
			padding: 2px 6px;
			border-radius: 4px;
			color: #ECEFF4 !important;
			font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
			font-weight: 600;
			border: 1px solid var(--ca-border);
		}

		.file-size {
			color: var(--ca-text-muted) !important;
			font-size: 10px;
		}

		/* Action Approval Card (L2 Supervised Mode) */
		.action-approval-card {
			margin-top: 10px;
			margin-bottom: 6px;
			background: rgba(217, 119, 6, 0.08);
			border: 1px solid rgba(217, 119, 6, 0.35);
			border-radius: 6px;
			padding: 10px 12px;
			display: flex;
			flex-direction: column;
			gap: 8px;
			animation: fadeIn 0.15s ease;
		}

		.action-approval-card.resolved {
			opacity: 0.7;
			pointer-events: none;
		}

		.approval-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			font-size: 11px;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.5px;
		}

		.approval-type {
			display: flex;
			align-items: center;
			gap: 6px;
			color: var(--ca-gold);
		}

		.approval-target {
			font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
			font-size: 12px;
			color: #ECEFF4 !important;
			font-weight: 600;
			word-break: break-all;
		}

		.approval-details {
			font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
			font-size: 11px;
			color: var(--ca-text-muted);
			background: var(--ca-code-bg);
			padding: 6px 8px;
			border-radius: 4px;
			border: 1px solid var(--ca-border);
			white-space: pre-wrap;
			max-height: 120px;
			overflow-y: auto;
		}

		.approval-actions {
			display: flex;
			align-items: center;
			gap: 8px;
			margin-top: 4px;
		}

		.btn-approve {
			background: #4EBD79;
			color: #0E1013 !important;
			border: none;
			padding: 4px 10px;
			border-radius: 4px;
			font-size: 11px;
			font-weight: 700;
			cursor: pointer;
			display: inline-flex;
			align-items: center;
			gap: 4px;
			transition: background 0.15s ease, transform 0.1s ease;
		}

		.btn-approve:hover {
			background: #62cf8d;
			transform: translateY(-1px);
		}

		.btn-reject {
			background: rgba(224, 108, 117, 0.15);
			color: #E06C75 !important;
			border: 1px solid rgba(224, 108, 117, 0.35);
			padding: 4px 10px;
			border-radius: 4px;
			font-size: 11px;
			font-weight: 600;
			cursor: pointer;
			display: inline-flex;
			align-items: center;
			gap: 4px;
			transition: background 0.15s ease;
		}

		.btn-reject:hover {
			background: rgba(224, 108, 117, 0.28);
		}

		.approval-hint {
			font-size: 10px;
			color: var(--ca-text-muted);
			margin-left: auto;
		}

		/* Turn Checkpoint & Undo Button (US-3.2) */
		.turn-actions-bar {
			display: flex;
			align-items: center;
			justify-content: flex-end;
			margin-top: 8px;
			gap: 8px;
		}

		.undo-turn-btn {
			background: rgba(224, 108, 117, 0.12);
			border: 1px solid rgba(224, 108, 117, 0.35);
			color: #E06C75 !important;
			border-radius: 4px;
			padding: 3px 8px;
			font-size: 10.5px;
			font-weight: 600;
			cursor: pointer;
			display: inline-flex;
			align-items: center;
			gap: 4px;
			transition: all 0.15s ease;
		}

		.undo-turn-btn:hover {
			background: rgba(224, 108, 117, 0.25);
			border-color: #E06C75;
		}

		.undo-turn-btn.reverted {
			background: rgba(140, 140, 140, 0.15);
			border-color: var(--ca-border);
			color: var(--ca-text-muted) !important;
			pointer-events: none;
		}

		/* Time-Travel History Drawer (US-3.3) */
		.timeline-drawer {
			position: absolute;
			top: 66px;
			left: 0;
			right: 0;
			max-height: 280px;
			background: var(--ca-surface);
			border-bottom: 2px solid var(--ca-border);
			z-index: 100;
			display: flex;
			flex-direction: column;
			box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
			animation: slideDown 0.15s ease;
		}

		@keyframes slideDown {
			from { transform: translateY(-10px); opacity: 0; }
			to { transform: translateY(0); opacity: 1; }
		}

		.timeline-drawer-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 8px 12px;
			background: rgba(217, 119, 6, 0.12);
			border-bottom: 1px solid var(--ca-border);
			font-size: 11px;
			font-weight: 700;
			text-transform: uppercase;
			letter-spacing: 0.5px;
			color: var(--ca-gold);
		}

		.timeline-close-btn {
			background: transparent;
			border: none;
			color: var(--ca-text-muted);
			font-size: 16px;
			cursor: pointer;
			padding: 0 4px;
			line-height: 1;
		}

		.timeline-close-btn:hover {
			color: #ECEFF4;
		}

		.timeline-drawer-list {
			overflow-y: auto;
			padding: 8px;
			display: flex;
			flex-direction: column;
			gap: 8px;
			max-height: 230px;
		}

		.timeline-empty {
			font-size: 11px;
			color: var(--ca-text-muted);
			text-align: center;
			padding: 16px;
		}

		.timeline-item {
			background: var(--ca-bg);
			border: 1px solid var(--ca-border);
			border-radius: 6px;
			padding: 8px 10px;
			display: flex;
			flex-direction: column;
			gap: 4px;
		}

		.timeline-item-meta {
			display: flex;
			align-items: center;
			justify-content: space-between;
			font-size: 10.5px;
			color: var(--ca-text-muted);
		}

		.timeline-commit-hash {
			font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
			color: var(--ca-amber);
			font-weight: 600;
		}

		.timeline-prompt-preview {
			font-size: 12px;
			color: #ECEFF4;
			font-weight: 500;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.timeline-files-list {
			font-size: 10.5px;
			color: #4EBD79;
			font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.btn-revert-timeline {
			align-self: flex-end;
			background: rgba(224, 108, 117, 0.15);
			border: 1px solid rgba(224, 108, 117, 0.35);
			color: #E06C75 !important;
			border-radius: 4px;
			padding: 2px 8px;
			font-size: 10.5px;
			font-weight: 600;
			cursor: pointer;
			margin-top: 2px;
			transition: background 0.15s ease;
		}

		.btn-revert-timeline:hover {
			background: rgba(224, 108, 117, 0.3);
		}
	</style>
</head>
<body>
	<div class="header">
		<div class="model-bar">
			<div class="model-badge" id="modelBadge" title="Click to select or download local model">
				<div class="status-dot" id="statusDot"></div>
				<span id="modelName">Checking Engine...</span>
			</div>
			<div style="display: flex; gap: 4px; align-items: center;">
				<button class="clear-btn" id="timelineBtn" title="View historical checkpoints & time-travel">&#9201; Timeline</button>
				<button class="clear-btn" id="clearBtn" title="Clear conversation">Clear</button>
			</div>
		</div>

		<!-- History Timeline Drawer (US-3.3) -->
		<div class="timeline-drawer" id="timelineDrawer" style="display: none;">
			<div class="timeline-drawer-header">
				<span>&#9201; Time-Travel Checkpoints</span>
				<button class="timeline-close-btn" id="timelineCloseBtn">&times;</button>
			</div>
			<div class="timeline-drawer-list" id="timelineList">
				<div class="timeline-empty">No checkpoints recorded yet. Snapshots are taken before every agent turn.</div>
			</div>
		</div>

		<!-- Autonomy Dial -->
		<div class="autonomy-container" id="autonomyDial">
			<button class="autonomy-dial-btn" data-level="L0" title="Assist: Read-only suggestions">L0 Assist</button>
			<button class="autonomy-dial-btn active" data-level="L1" title="Chat: Interactive dialogue">L1 Chat</button>
			<button class="autonomy-dial-btn" data-level="L2" title="Supervised: 1-click approvals for all file writes">L2 Supv</button>
			<button class="autonomy-dial-btn" data-level="L3" title="Guarded: Auto-run safe workspace actions">L3 Guard</button>
			<button class="autonomy-dial-btn" data-level="L4" title="Autonomous: Goal runner with circuit breaker">L4 Auto</button>
		</div>
	</div>

	<!-- Scrollable Messages Container -->
	<div class="messages-container" id="messagesContainer">
		<div class="empty-state" id="emptyState">
			<div class="empty-flame" id="emptyFlame">&#128293;</div>
			<div class="empty-title" id="emptyTitle">CodeAlloy Forge Agent</div>
			<div class="empty-desc" id="emptyDesc">
				Connecting to local inference engine...
			</div>
			<div id="emptyActions"></div>
		</div>
	</div>

	<!-- Input Area -->
	<div class="input-container">
		<div class="input-box-wrapper">
			<textarea id="promptInput" rows="2" placeholder="Ask CodeAlloy agent or describe code to forge... (Enter to send, Shift+Enter for newline)"></textarea>
		</div>
		<div class="input-actions">
			<span>Local &bull; Private &bull; Open Models</span>
			<div style="display: flex; gap: 6px;">
				<button class="stop-btn" id="stopBtn">Stop</button>
				<button class="send-btn" id="sendBtn" onclick="window.sendCurrentPrompt()">Forge &rarr;</button>
			</div>
		</div>
	</div>

	<script>
${scriptContent}
	</script>
</body>
</html>`;
	}
}
