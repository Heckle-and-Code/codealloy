import * as vscode from 'vscode';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { LocalModelManager } from './modelManager';
import { LlamaServerService } from './llamaServerService';

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	timestamp: number;
}

export class AgentChatViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'codealloy.agentView';

	private _view?: vscode.WebviewView;
	private _messages: ChatMessage[] = [];
	private _activeRequest?: http.ClientRequest;
	private _autonomyLevel: string = 'L1'; // L0, L1, L2, L3, L4
	private _outputChannel: vscode.OutputChannel;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _modelManager: LocalModelManager,
		private readonly _llamaServer: LlamaServerService
	) {
		this._outputChannel = vscode.window.createOutputChannel('CodeAlloy Agent Chat');
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
					this._abortActiveStream();
					break;
				case 'clearChat':
					this.clearChat();
					break;
				case 'insertAtCursor':
					await this._insertAtCursor(data.text);
					break;
				case 'selectModel':
					await vscode.commands.executeCommand('codealloy.selectModel');
					break;
				case 'setAutonomy':
					this._autonomyLevel = data.level;
					this.syncState();
					break;
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

		this._view.webview.postMessage({
			type: 'syncState',
			activeModel: activeModel || null,
			serverRunning: serverStatus.running,
			endpoint: this._llamaServer.getEndpointUrl(),
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

	private _abortActiveStream(): void {
		if (this._activeRequest) {
			try {
				this._activeRequest.destroy();
			} catch (e) {
				console.error('[AgentChat] Error aborting stream:', e);
			}
			this._activeRequest = undefined;
		}
	}

	private async _insertAtCursor(text: string): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('CodeAlloy: Open a file editor to insert code.');
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

		// 2. Prepare Assistant Turn
		const assistantMsg: ChatMessage = {
			id: assistantMsgId,
			role: 'assistant',
			content: '',
			timestamp: Date.now()
		};
		this._messages.push(assistantMsg);

		if (this._view) {
			this._view.webview.postMessage({
				type: 'streamStart',
				userMsg,
				assistantMsgId
			});
		}

		// 3. Ensure local inference engine is running
		let serverStatus = this._llamaServer.getStatus();
		if (!serverStatus.running) {
			const fullPath = path.join(this._modelManager.getModelsDirectory(), activeModel);
			this._outputChannel.appendLine(`[AgentChat] Starting inference engine: ${fullPath}`);

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
			serverStatus = this._llamaServer.getStatus();
		}

		// 4. Prepare conversation context for /v1/chat/completions
		const apiMessages = [
			{
				role: 'system',
				content:
					'You are CodeAlloy Agent, an autonomous open-model coding partner embedded directly in the CodeAlloy IDE. You write concise, high-performance, production-ready code. Always specify language tags in markdown code fences. Keep explanations clear, precise, and directly actionable.'
			},
			...this._messages.slice(-8).map((m) => ({
				role: m.role,
				content: m.content
			}))
		];

		const requestBody = JSON.stringify({
			model: activeModel,
			messages: apiMessages,
			stream: true,
			temperature: 0.2
		});

		const currentPort = this._llamaServer.getStatus().port || 51434;
		const reqOptions: http.RequestOptions = {
			hostname: '127.0.0.1',
			port: currentPort,
			path: '/v1/chat/completions',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(requestBody)
			}
		};

		await new Promise<void>((resolve) => {
			const req = http.request(reqOptions, (res) => {
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
								assistantMsg.content += delta;
								if (this._view) {
									this._view.webview.postMessage({
										type: 'streamChunk',
										assistantMsgId,
										chunk: delta
									});
								}
							}
						} catch {
							// Incomplete JSON or malformed chunk
						}
					}
				});

				res.on('end', () => {
					this._activeRequest = undefined;
					const preview = assistantMsg.content.substring(0, 80).replace(/\n/g, ' ');
					this._outputChannel.appendLine(`[AgentChat] Stream ended successfully (${assistantMsg.content.length} chars): "${preview}..."`);
					if (this._view) {
						this._view.webview.postMessage({
							type: 'streamEnd',
							assistantMsgId,
							fullContent: assistantMsg.content
						});
					}
					resolve();
				});
			});

			req.on('error', (err) => {
				this._activeRequest = undefined;
				this._outputChannel.appendLine(`[AgentChat Request Error]: ${err.message}`);
				assistantMsg.content += `\n\n*(Error communicating with inference engine: ${err.message})*`;
				if (this._view) {
					this._view.webview.postMessage({
						type: 'streamEnd',
						assistantMsgId,
						fullContent: assistantMsg.content
					});
				}
				resolve();
			});

			this._activeRequest = req;
			req.write(requestBody);
			req.end();
		});
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
	</style>
</head>
<body>
	<div class="header">
		<div class="model-bar">
			<div class="model-badge" id="modelBadge" title="Click to select or download local model">
				<div class="status-dot" id="statusDot"></div>
				<span id="modelName">Checking Engine...</span>
			</div>
			<button class="clear-btn" id="clearBtn" title="Clear conversation">Clear</button>
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
