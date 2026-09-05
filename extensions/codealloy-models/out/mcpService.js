"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpService = void 0;
const fs = require("fs");
const path = require("path");
const os = require("os");
const child_process_1 = require("child_process");
class ActiveMcpServer {
    name;
    config;
    _outputChannel;
    process;
    tools = [];
    _requestId = 0;
    _pendingRequests = new Map();
    _buffer = '';
    constructor(name, config, _outputChannel) {
        this.name = name;
        this.config = config;
        this._outputChannel = _outputChannel;
    }
    async start() {
        const env = { ...process.env, ...(this.config.env || {}) };
        this._outputChannel.appendLine(`[MCP:${this.name}] Spawning ${this.config.command} ${(this.config.args || []).join(' ')}`);
        try {
            this.process = (0, child_process_1.spawn)(this.config.command, this.config.args || [], {
                env,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            this.process.stdout?.on('data', (chunk) => {
                this._handleData(chunk.toString('utf8'));
            });
            this.process.stderr?.on('data', (chunk) => {
                this._outputChannel.appendLine(`[MCP:${this.name}:stderr] ${chunk.toString('utf8').trim()}`);
            });
            this.process.on('exit', (code, signal) => {
                this._outputChannel.appendLine(`[MCP:${this.name}] Exited with code ${code}, signal ${signal}`);
            });
            // Perform JSON-RPC handshake
            await this._initialize();
            await this._fetchTools();
        }
        catch (err) {
            this._outputChannel.appendLine(`[MCP:${this.name} Error] Failed to start server: ${err?.message || err}`);
        }
    }
    async callTool(toolName, args) {
        try {
            const res = await this._sendRequest('tools/call', {
                name: toolName,
                arguments: args || {}
            });
            if (res && Array.isArray(res.content)) {
                const outputText = res.content
                    .map((item) => (item.type === 'text' ? item.text : JSON.stringify(item)))
                    .join('\n');
                return { success: !res.isError, output: outputText || '(Empty tool response)' };
            }
            return { success: true, output: JSON.stringify(res) };
        }
        catch (err) {
            return { success: false, output: `MCP call failed: ${err.message || err}` };
        }
    }
    async _initialize() {
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
    async _fetchTools() {
        const res = await this._sendRequest('tools/list', {});
        if (res && Array.isArray(res.tools)) {
            this.tools = res.tools;
            this._outputChannel.appendLine(`[MCP:${this.name}] Discovered ${this.tools.length} tool(s): ${this.tools.map(t => t.name).join(', ')}`);
        }
    }
    _sendRequest(method, params) {
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
            }
            else {
                clearTimeout(timer);
                this._pendingRequests.delete(id);
                reject(new Error(`MCP server ${this.name} stdin is not writable`));
            }
        });
    }
    _sendNotification(method, params) {
        const message = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
        if (this.process && this.process.stdin && !this.process.stdin.destroyed) {
            this.process.stdin.write(message);
        }
    }
    _handleData(data) {
        this._buffer += data;
        const lines = this._buffer.split('\n');
        this._buffer = lines.pop() || '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            try {
                const msg = JSON.parse(trimmed);
                if (msg.id !== undefined && this._pendingRequests.has(msg.id)) {
                    const { resolve, reject, timer } = this._pendingRequests.get(msg.id);
                    clearTimeout(timer);
                    this._pendingRequests.delete(msg.id);
                    if (msg.error) {
                        reject(new Error(msg.error.message || 'JSON-RPC Error'));
                    }
                    else {
                        resolve(msg.result);
                    }
                }
            }
            catch (err) {
                // Line was not JSON or stdout logging
            }
        }
    }
    dispose() {
        for (const [, req] of this._pendingRequests) {
            clearTimeout(req.timer);
            req.reject(new Error('Server shutting down'));
        }
        this._pendingRequests.clear();
        if (this.process) {
            try {
                this.process.kill();
            }
            catch (e) { }
            this.process = undefined;
        }
    }
}
class McpService {
    _servers = new Map();
    _outputChannel;
    _workspaceRoot;
    _initialized = false;
    constructor(workspaceRoot, outputChannel) {
        this._workspaceRoot = workspaceRoot;
        this._outputChannel = outputChannel;
    }
    async init() {
        if (this._initialized)
            return;
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
    loadConfig() {
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
                }
                catch (err) {
                    this._outputChannel.appendLine(`[McpService Error] Failed to parse ${configPath}: ${err?.message}`);
                }
            }
        }
        return null;
    }
    /**
     * Returns OpenAI-compatible tools schema combining all connected MCP servers.
     */
    getOpenAiTools() {
        const tools = [];
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
    isMcpTool(toolName) {
        return toolName.startsWith('mcp__');
    }
    /**
     * Call an MCP tool by its namespaced tool name.
     */
    async callTool(namespacedToolName, args) {
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
    dispose() {
        for (const [, server] of this._servers) {
            server.dispose();
        }
        this._servers.clear();
    }
}
exports.McpService = McpService;
//# sourceMappingURL=mcpService.js.map