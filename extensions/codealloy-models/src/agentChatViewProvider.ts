import * as vscode from 'vscode';
import * as http from 'http';
import * as path from 'path';
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

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _modelManager: LocalModelManager,
		private readonly _llamaServer: LlamaServerService
	) {}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Handle messages from the webview
		webviewView.webview.onDidReceiveMessage(async (data) => {
			switch (data.type) {
				case 'sendMessage':
					await this._handleUserPrompt(data.prompt);
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
					this.syncState();
					break;
			}
		});

		// Listen to visibility
		webviewView.onDidChangeVisibility(() => {
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

	private async _handleUserPrompt(prompt: string): Promise<void> {
		if (!prompt || prompt.trim().length === 0) return;

		const activeModel = this._modelManager.getActiveModel();
		const serverStatus = this._llamaServer.getStatus();

		if (!activeModel) {
			if (this._view) {
				this._view.webview.postMessage({
					type: 'showNotice',
					level: 'error',
					message: 'No model selected. Click the flame badge or select a model to begin.'
				});
			}
			return;
		}

		if (!serverStatus.running) {
			const fullPath = path.join(this._modelManager.getModelsDirectory(), activeModel);
			if (this._view) {
				this._view.webview.postMessage({
					type: 'showNotice',
					level: 'info',
					message: `Igniting Apple Silicon Metal GPU engine for "${activeModel}"...`
				});
			}
			const started = await this._llamaServer.start(fullPath);
			if (!started) {
				if (this._view) {
					this._view.webview.postMessage({
						type: 'showNotice',
						level: 'error',
						message: `Failed to start inference engine for "${activeModel}". Check Output > CodeAlloy Inference Engine.`
					});
				}
				return;
			}
			this.syncState();
		}

		// Push User Message
		const userMsg: ChatMessage = {
			id: `user-${Date.now()}`,
			role: 'user',
			content: prompt.trim(),
			timestamp: Date.now()
		};
		this._messages.push(userMsg);

		// Prepare Assistant Message
		const assistantMsgId = `assistant-${Date.now()}`;
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

		// Prepare conversation context for /v1/chat/completions
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

		const reqOptions: http.RequestOptions = {
			hostname: '127.0.0.1',
			port: serverStatus.port || 51434,
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
		}

		.message-bubble.assistant {
			align-self: flex-start;
			background: var(--ca-surface);
			border: 1px solid var(--ca-border);
			padding: 10px 12px;
			border-radius: 6px;
			width: 100%;
		}

		.message-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			font-size: 10px;
			color: var(--ca-text-muted);
			margin-bottom: 2px;
		}

		.message-content {
			word-break: break-word;
			font-size: 12.5px;
			line-height: 1.5;
		}

		.message-content p {
			margin-bottom: 8px;
		}

		.message-content p:last-child {
			margin-bottom: 0;
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
			color: #D8DEE9;
		}

		/* Inline Code */
		code.inline-code {
			background: var(--ca-code-bg);
			border: 1px solid var(--ca-border);
			padding: 1px 4px;
			border-radius: 3px;
			font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
			font-size: 11px;
			color: var(--ca-gold);
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
			color: var(--ca-text-primary);
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
				<button class="send-btn" id="sendBtn">Forge &rarr;</button>
			</div>
		</div>
	</div>

	<script>
		const vscode = acquireVsCodeApi();

		const modelNameEl = document.getElementById('modelName');
		const statusDotEl = document.getElementById('statusDot');
		const modelBadgeEl = document.getElementById('modelBadge');
		const clearBtn = document.getElementById('clearBtn');
		const promptInput = document.getElementById('promptInput');
		const sendBtn = document.getElementById('sendBtn');
		const stopBtn = document.getElementById('stopBtn');
		const messagesContainer = document.getElementById('messagesContainer');
		const emptyState = document.getElementById('emptyState');
		const emptyFlame = document.getElementById('emptyFlame');
		const emptyTitle = document.getElementById('emptyTitle');
		const emptyDesc = document.getElementById('emptyDesc');
		const emptyActions = document.getElementById('emptyActions');
		const autonomyDial = document.getElementById('autonomyDial');

		let isStreaming = false;
		let currentAssistantTurnId = null;

		// Notify extension webview is ready
		vscode.postMessage({ type: 'ready' });

		// Autonomy Dial Event Handlers
		autonomyDial.querySelectorAll('.autonomy-dial-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				const level = btn.getAttribute('data-level');
				autonomyDial.querySelectorAll('.autonomy-dial-btn').forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
				vscode.postMessage({ type: 'setAutonomy', level });
			});
		});

		window.triggerSelectModel = function() {
			vscode.postMessage({ type: 'selectModel' });
		};

		window.sendQuickPrompt = function(promptText) {
			if (isStreaming) return;
			promptInput.value = '';
			vscode.postMessage({ type: 'sendMessage', prompt: promptText });
		};

		modelBadgeEl.addEventListener('click', () => {
			window.triggerSelectModel();
		});

		clearBtn.addEventListener('click', () => {
			vscode.postMessage({ type: 'clearChat' });
		});

		stopBtn.addEventListener('click', () => {
			vscode.postMessage({ type: 'abortStream' });
			endStreamUI();
		});

		function sendCurrentPrompt() {
			const text = promptInput.value.trim();
			if (!text || isStreaming) return;
			promptInput.value = '';
			promptInput.style.height = 'auto';
			vscode.postMessage({ type: 'sendMessage', prompt: text });
		}

		sendBtn.addEventListener('click', sendCurrentPrompt);

		promptInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				sendCurrentPrompt();
			}
		});

		promptInput.addEventListener('input', () => {
			promptInput.style.height = 'auto';
			promptInput.style.height = Math.min(promptInput.scrollHeight, 140) + 'px';
		});

		function setStreamingUI(streaming) {
			isStreaming = streaming;
			if (streaming) {
				sendBtn.style.display = 'none';
				stopBtn.style.display = 'block';
			} else {
				sendBtn.style.display = 'flex';
				stopBtn.style.display = 'none';
			}
		}

		function endStreamUI() {
			setStreamingUI(false);
			const indicator = document.querySelector('.typing-indicator');
			if (indicator) indicator.remove();
		}

		// Message Parser (handles basic markdown and code fences with actions)
		function renderMarkdown(raw) {
			const codeBlockRegex = /\`\`\`([a-zA-Z0-9_\-]+)?\n([\s\S]*?)\`\`\`/g;
			let html = '';
			let lastIndex = 0;
			let match;

			while ((match = codeBlockRegex.exec(raw)) !== null) {
				const preceding = raw.substring(lastIndex, match.index);
				html += renderTextParagraphs(preceding);

				const lang = match[1] || 'code';
				const codeContent = match[2];
				const escaped = escapeHtml(codeContent);

				html += \`<div class="code-block">
					<div class="code-header">
						<span>\${lang}</span>
						<div class="code-actions">
							<button class="code-action-btn" onclick="insertCodeAtCursor(this)">Insert at Cursor</button>
							<button class="code-action-btn" onclick="copyCode(this)">Copy</button>
						</div>
					</div>
					<pre><code>\${escaped}</code></pre>
				</div>\`;

				lastIndex = match.index + match[0].length;
			}

			const remaining = raw.substring(lastIndex);
			html += renderTextParagraphs(remaining);
			return html;
		}

		function renderTextParagraphs(text) {
			if (!text.trim()) return '';
			// Handle inline code
			const withInlineCode = escapeHtml(text).replace(/\`([^\`]+)\`/g, '<code class="inline-code">$1</code>');
			const paragraphs = withInlineCode.split(/\\n\\n+/);
			return paragraphs.map(p => \`<p>\${p.replace(/\\n/g, '<br>')}</p>\`).join('');
		}

		function escapeHtml(str) {
			return str
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#039;');
		}

		window.insertCodeAtCursor = function(btn) {
			const codeEl = btn.closest('.code-block').querySelector('pre code');
			if (codeEl) {
				vscode.postMessage({
					type: 'insertAtCursor',
					text: codeEl.textContent
				});
				const oldText = btn.textContent;
				btn.textContent = 'Inserted!';
				setTimeout(() => { btn.textContent = oldText; }, 1500);
			}
		};

		window.copyCode = function(btn) {
			const codeEl = btn.closest('.code-block').querySelector('pre code');
			if (codeEl) {
				navigator.clipboard.writeText(codeEl.textContent);
				const oldText = btn.textContent;
				btn.textContent = 'Copied!';
				setTimeout(() => { btn.textContent = oldText; }, 1500);
			}
		};

		// Extension Host Event Handler
		window.addEventListener('message', (event) => {
			const message = event.data;

			switch (message.type) {
				case 'syncState': {
					if (message.activeModel && message.serverRunning) {
						modelNameEl.textContent = message.activeModel;
						statusDotEl.className = 'status-dot';
						modelBadgeEl.title = 'Active: ' + message.activeModel + ' (Metal GPU Engine online)';

						if (emptyTitle && emptyDesc && emptyActions) {
							emptyFlame.textContent = '🔥';
							emptyTitle.innerHTML = 'Forge Agent Ready';
							emptyDesc.innerHTML = '<span class="model-tag">' + escapeHtml(message.activeModel) + '</span><br><span style="margin-top: 4px; display: inline-block;">Local Metal GPU engine is active and private. Ask questions or click a quick prompt below:</span>';
							emptyActions.innerHTML = '<div class="prompt-chips">' +
								'<button class="chip-btn" onclick="sendQuickPrompt(\\'Explain how this project is structured and what it does\\')">&#9889; Explain project architecture</button>' +
								'<button class="chip-btn" onclick="sendQuickPrompt(\\'Write unit tests for the active code with edge cases\\')">&#128736; Generate unit tests</button>' +
								'<button class="chip-btn" onclick="sendQuickPrompt(\\'Refactor the active code for better performance and readability\\')">&#10024; Refactor and optimize</button>' +
								'</div>' +
								'<div style="margin-top: 10px;">' +
								'<button class="clear-btn" onclick="triggerSelectModel()" style="text-decoration: underline;">Switch model...</button>' +
								'</div>';
						}
					} else if (message.activeModel) {
						modelNameEl.textContent = message.activeModel;
						statusDotEl.className = 'status-dot offline';
						modelBadgeEl.title = 'Active: ' + message.activeModel + ' (Engine standby)';

						if (emptyTitle && emptyDesc && emptyActions) {
							emptyFlame.textContent = '⚡';
							emptyTitle.innerHTML = 'Model Ready (Standby)';
							emptyDesc.innerHTML = '<span class="model-tag">' + escapeHtml(message.activeModel) + '</span><br><span style="margin-top: 4px; display: inline-block;">Click below or send a prompt to ignite the local engine:</span>';
							emptyActions.innerHTML = '<button class="btn-primary" onclick="sendQuickPrompt(\\'Hello CodeAlloy! Confirm engine is online.\\')">&#128293; Ignite Local Engine</button>' +
								'<div style="margin-top: 10px;">' +
								'<button class="clear-btn" onclick="triggerSelectModel()" style="text-decoration: underline;">Switch model...</button>' +
								'</div>';
						}
					} else {
						modelNameEl.textContent = 'No Model Active';
						statusDotEl.className = 'status-dot offline';
						modelBadgeEl.title = 'Click to select or download a local model';

						if (emptyTitle && emptyDesc && emptyActions) {
							emptyFlame.textContent = '❄️';
							emptyTitle.innerHTML = 'No Local Model Active';
							emptyDesc.innerHTML = 'Pick an installed GGUF model or download an open coding model (Qwen 2.5 Coder, DeepSeek R1) with 1 click.';
							emptyActions.innerHTML = '<button class="btn-primary" onclick="triggerSelectModel()">Select or Download Model</button>';
						}
					}

					if (message.autonomyLevel) {
						autonomyDial.querySelectorAll('.autonomy-dial-btn').forEach(btn => {
							btn.classList.toggle('active', btn.getAttribute('data-level') === message.autonomyLevel);
						});
					}

					if (message.messages && message.messages.length > 0) {
						emptyState.style.display = 'none';
					}
					break;
				}

				case 'streamStart': {
					emptyState.style.display = 'none';
					setStreamingUI(true);

					// 1. Render user message
					const userDiv = document.createElement('div');
					userDiv.className = 'message-bubble user';
					userDiv.innerHTML = \`<div class="message-content">\${renderMarkdown(message.userMsg.content)}</div>\`;
					messagesContainer.appendChild(userDiv);

					// 2. Render assistant container
					currentAssistantTurnId = message.assistantMsgId;
					const asstDiv = document.createElement('div');
					asstDiv.className = 'message-bubble assistant';
					asstDiv.id = message.assistantMsgId;
					asstDiv.innerHTML = \`<div class="message-header">CodeAlloy Agent &bull; Just now</div><div class="message-content"><span class="typing-indicator"></span></div>\`;
					messagesContainer.appendChild(asstDiv);

					messagesContainer.scrollTop = messagesContainer.scrollHeight;
					break;
				}

				case 'streamChunk': {
					const asstDiv = document.getElementById(message.assistantMsgId);
					if (asstDiv) {
						if (!asstDiv._rawText) asstDiv._rawText = '';
						asstDiv._rawText += message.chunk;
						const contentEl = asstDiv.querySelector('.message-content');
						if (contentEl) {
							contentEl.innerHTML = renderMarkdown(asstDiv._rawText) + '<span class="typing-indicator"></span>';
						}
						messagesContainer.scrollTop = messagesContainer.scrollHeight;
					}
					break;
				}

				case 'streamEnd': {
					endStreamUI();
					const asstDiv = document.getElementById(message.assistantMsgId);
					if (asstDiv) {
						const contentEl = asstDiv.querySelector('.message-content');
						if (contentEl) {
							contentEl.innerHTML = renderMarkdown(message.fullContent);
						}
					}
					break;
				}

				case 'chatCleared': {
					messagesContainer.innerHTML = '';
					messagesContainer.appendChild(emptyState);
					emptyState.style.display = 'block';
					endStreamUI();
					break;
				}

				case 'showNotice': {
					const noticeDiv = document.createElement('div');
					noticeDiv.className = 'message-bubble assistant';
					noticeDiv.style.borderColor = message.level === 'error' ? 'var(--ca-error)' : 'var(--ca-amber)';
					noticeDiv.innerHTML = \`<div class="message-content" style="color: \${message.level === 'error' ? 'var(--ca-error)' : 'var(--ca-gold)'}; font-weight: 500;">
						\${escapeHtml(message.message)}
					</div>\`;
					messagesContainer.appendChild(noticeDiv);
					messagesContainer.scrollTop = messagesContainer.scrollHeight;
					break;
				}
			}
		});
	</script>
</body>
</html>`;
	}
}
