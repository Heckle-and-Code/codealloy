import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';

export interface McpServerConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

export interface McpConfigFile {
	mcpServers?: Record<string, McpServerConfig>;
}

export interface McpToolDefinition {
	name: string;
	description?: string;
	inputSchema?: any;
}

interface PendingRpc {
	resolve: (result: any) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

class ActiveMcpServer {
	public process?: ChildProcess;
	public tools: McpToolDefinition[] = [];
	private _requestId = 0;
	private _pendingRequests: Map<number, PendingRpc> = new Map();
	private _buffer = '';

	constructor(
		public readonly name: string,
		public readonly config: McpServerConfig,
		private readonly _outputChannel: vscode.OutputChannel
	) {}

	public async start(): Promise<void> {
		const env = { ...process.env, ...(this.config.env || {}) };
		this._outputChannel.appendLine(`[MCP:${this.name}] Spawning ${this.config.command} ${(this.config.args || []).join(' ')}`);

		try {
			this.process = spawn(this.config.command, this.config.args || [], {
				env,
				stdio: ['pipe', 'pipe', 'pipe']
			});

			this.process.stdout?.on('data', (chunk: Buffer) => {
				this._handleData(chunk.toString('utf8'));
			});

			this.process.stderr?.on('data', (chunk: Buffer) => {
				this._outputChannel.appendLine(`[MCP:${this.name}:stderr] ${chunk.toString('utf8').trim()}`);
			});

			this.process.on('exit', (code, signal) => {
				this._outputChannel.appendLine(`[MCP:${this.name}] Exited with code ${code}, signal ${signal}`);
			});

			// Perform JSON-RPC handshake
			await this._initialize();
			await this._fetchTools();
		} catch (err: any) {
			this._outputChannel.appendLine(`[MCP:${this.name} Error] Failed to start server: ${err?.message || err}`);
		}
	}

	public async callTool(toolName: string, args: any): Promise<{ success: boolean; output: string }> {
		try {
			const res = await this._sendRequest('tools/call', {
				name: toolName,
				arguments: args || {}
			});

			if (res && Array.isArray(res.content)) {
				const outputText = res.content
					.map((item: any) => (item.type === 'text' ? item.text : JSON.stringify(item)))
					.join('\n');
				return { success: !res.isError, output: outputText || '(Empty tool response)' };
			}

			return { success: true, output: JSON.stringify(res) };
		} catch (err: any) {
			return { success: false, output: `MCP call failed: ${err.message || err}` };
		}
	}

	private async _initialize(): Promise<void> {
		await this._sendRequest('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: {
				name: 'CodeAlloy',
				version: '1.0.0'
			}
		});

		// Send notifications/initialized
		this._sendNotification('notifications/initialized', {});
	}

	private async _fetchTools(): Promise<void> {
		const res = await this._sendRequest('tools/list', {});
		if (res && Array.isArray(res.tools)) {
			this.tools = res.tools;
			this._outputChannel.appendLine(`[MCP:${this.name}] Discovered ${this.tools.length} tool(s): ${this.tools.map(t => t.name).join(', ')}`);
		}
	}

	private _sendRequest(method: string, params: any): Promise<any> {
		const id = ++this._requestId;
		const message = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				if (this._pendingRequests.has(id)) {
					this._pendingRequests.delete(id);
					reject(new Error(`MCP request ${method} (id ${id}) timed out after 15s`));
				}
			}, 15000);

			this._pendingRequests.set(id, { resolve, reject, timer });
			if (this.process && this.process.stdin && !this.process.stdin.destroyed) {
				this.process.stdin.write(message);
			} else {
				clearTimeout(timer);
				this._pendingRequests.delete(id);
				reject(new Error(`MCP server ${this.name} stdin is not writable`));
			}
		});
	}

	private _sendNotification(method: string, params: any): void {
		const message = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
		if (this.process && this.process.stdin && !this.process.stdin.destroyed) {
			this.process.stdin.write(message);
		}
	}

	private _handleData(data: string): void {
		this._buffer += data;
		const lines = this._buffer.split('\n');
		this._buffer = lines.pop() || '';

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			try {
				const msg = JSON.parse(trimmed);
				if (msg.id !== undefined && this._pendingRequests.has(msg.id)) {
					const { resolve, reject, timer } = this._pendingRequests.get(msg.id)!;
					clearTimeout(timer);
					this._pendingRequests.delete(msg.id);

					if (msg.error) {
						reject(new Error(msg.error.message || 'JSON-RPC Error'));
					} else {
						resolve(msg.result);
					}
				}
			} catch (err) {
				// Line was not JSON or stdout logging
			}
		}
	}

	public dispose(): void {
		for (const [, req] of this._pendingRequests) {
			clearTimeout(req.timer);
			req.reject(new Error('Server shutting down'));
		}
		this._pendingRequests.clear();

		if (this.process) {
			try {
				this.process.kill();
			} catch (e) {}
			this.process = undefined;
		}
	}
}

export class McpService {
	private _servers: Map<string, ActiveMcpServer> = new Map();
	private _outputChannel: vscode.OutputChannel;
	private _workspaceRoot: string;
	private _initialized = false;

	constructor(workspaceRoot: string, outputChannel: vscode.OutputChannel) {
		this._workspaceRoot = workspaceRoot;
		this._outputChannel = outputChannel;
	}

	public async init(): Promise<void> {
		if (this._initialized) return;

		const config = this.loadConfig();
		if (!config || !config.mcpServers) {
			this._outputChannel.appendLine('[McpService] No MCP configuration found.');
			this._initialized = true;
			return;
		}

		for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
			const server = new ActiveMcpServer(name, serverConfig, this._outputChannel);
			this._servers.set(name, server);
			await server.start();
		}

		this._initialized = true;
	}

	public loadConfig(): McpConfigFile | null {
		const possiblePaths = [
			path.join(this._workspaceRoot, '.codealloy', 'mcp_config.json'),
			path.join(this._workspaceRoot, '.vscode', 'mcp_config.json'),
			path.join(os.homedir(), '.codealloy', 'mcp_config.json')
		];

		for (const configPath of possiblePaths) {
			if (fs.existsSync(configPath)) {
				try {
					const content = fs.readFileSync(configPath, 'utf8');
					this._outputChannel.appendLine(`[McpService] Loaded configuration from ${configPath}`);
					return JSON.parse(content);
				} catch (err: any) {
					this._outputChannel.appendLine(`[McpService Error] Failed to parse ${configPath}: ${err?.message}`);
				}
			}
		}

		return null;
	}

	/**
	 * Returns OpenAI-compatible tools schema combining all connected MCP servers.
	 */
	public getOpenAiTools(): any[] {
		const tools: any[] = [];

		for (const [serverName, server] of this._servers.entries()) {
			for (const tool of server.tools) {
				tools.push({
					type: 'function',
					function: {
						name: `mcp__${serverName}__${tool.name}`,
						description: `[MCP: ${serverName}] ${tool.description || ''}`,
						parameters: tool.inputSchema || { type: 'object', properties: {} }
					}
				});
			}
		}

		return tools;
	}

	/**
	 * Checks if a tool name belongs to an MCP server.
	 */
	public isMcpTool(toolName: string): boolean {
		return toolName.startsWith('mcp__');
	}

	/**
	 * Call an MCP tool by its namespaced tool name.
	 */
	public async callTool(namespacedToolName: string, args: any): Promise<{ success: boolean; output: string }> {
		const parts = namespacedToolName.split('__');
		if (parts.length < 3) {
			return { success: false, output: `Invalid MCP tool name "${namespacedToolName}". Expected format "mcp__<server>__<tool>".` };
		}

		const serverName = parts[1];
		const toolName = parts.slice(2).join('__');

		const server = this._servers.get(serverName);
		if (!server) {
			return { success: false, output: `MCP server "${serverName}" is not running or not found.` };
		}

		return await server.callTool(toolName, args);
	}

	public dispose(): void {
		for (const [, server] of this._servers) {
			server.dispose();
		}
		this._servers.clear();
	}
}
