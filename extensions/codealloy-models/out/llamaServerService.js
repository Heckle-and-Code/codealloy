"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlamaServerService = void 0;
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const child_process_1 = require("child_process");
const vscode = require("vscode");
class LlamaServerService {
    static instance;
    process;
    currentModel;
    currentPort = 51434;
    outputChannel;
    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('CodeAlloy Inference Engine');
    }
    static getInstance() {
        if (!LlamaServerService.instance) {
            LlamaServerService.instance = new LlamaServerService();
        }
        return LlamaServerService.instance;
    }
    getBinaryName() {
        return process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    }
    getBinaryPath() {
        const binaryName = this.getBinaryName();
        const homedir = os.homedir();
        const binDir = path.join(homedir, '.codealloy', 'bin');
        const serverBin = path.join(binDir, binaryName);
        if (fs.existsSync(serverBin)) {
            return serverBin;
        }
        // Check app resources fallback (for packaged .app / installer)
        const appResBin = path.join(path.dirname(__dirname), 'bin', binaryName);
        if (fs.existsSync(appResBin)) {
            return appResBin;
        }
        return undefined;
    }
    getPlatformReleaseAsset(tag = 'b10798') {
        const plat = process.platform;
        const arch = process.arch;
        if (plat === 'darwin') {
            if (arch === 'arm64') {
                return {
                    url: `https://github.com/ggml-org/llama.cpp/releases/download/${tag}/llama-${tag}-bin-macos-arm64.tar.gz`,
                    format: 'tar.gz'
                };
            }
            else {
                return {
                    url: `https://github.com/ggml-org/llama.cpp/releases/download/${tag}/llama-${tag}-bin-macos-x64.tar.gz`,
                    format: 'tar.gz'
                };
            }
        }
        else if (plat === 'win32') {
            return {
                url: `https://github.com/ggml-org/llama.cpp/releases/download/${tag}/llama-${tag}-bin-win-avx2-x64.zip`,
                format: 'zip'
            };
        }
        else if (plat === 'linux') {
            if (arch === 'arm64') {
                return {
                    url: `https://github.com/ggml-org/llama.cpp/releases/download/${tag}/llama-${tag}-bin-ubuntu-arm64.tar.gz`,
                    format: 'tar.gz'
                };
            }
            else {
                return {
                    url: `https://github.com/ggml-org/llama.cpp/releases/download/${tag}/llama-${tag}-bin-ubuntu-x64.tar.gz`,
                    format: 'tar.gz'
                };
            }
        }
        return undefined;
    }
    getStatus() {
        return {
            running: !!this.process && !this.process.killed,
            port: this.currentPort,
            modelPath: this.currentModel
        };
    }
    getEndpointUrl() {
        return `http://127.0.0.1:${this.currentPort}/v1`;
    }
    async start(modelPath, port = 51434) {
        if (this.process && this.currentModel === modelPath && !this.process.killed) {
            return true;
        }
        // Stop any existing running model
        await this.stop();
        const binaryPath = this.getBinaryPath();
        if (!binaryPath) {
            this.outputChannel.appendLine(`[Engine Error] ${this.getBinaryName()} not found in ~/.codealloy/bin/`);
            return false;
        }
        if (!fs.existsSync(modelPath)) {
            this.outputChannel.appendLine(`[Engine Error] Model file does not exist: ${modelPath}`);
            return false;
        }
        this.currentPort = port;
        this.currentModel = modelPath;
        // Calculate reasonable threads based on CPU count
        const threadCount = Math.max(1, Math.min(8, Math.floor(os.cpus().length)));
        const args = [
            '-m', modelPath,
            '--port', String(port),
            '--host', '127.0.0.1',
            '-ngl', '99', // GPU offload: Metal on Mac, CUDA/Vulkan on Windows/Linux (auto falls back if CPU-only)
            '-c', '8192', // 8k context window
            '-t', String(threadCount),
            '--flash-attn', 'on'
        ];
        this.outputChannel.appendLine(`[Engine] Platform: ${process.platform} (${process.arch})`);
        this.outputChannel.appendLine(`[Engine] Spawning: ${binaryPath} ${args.join(' ')}`);
        return new Promise((resolve) => {
            try {
                this.process = (0, child_process_1.spawn)(binaryPath, args, {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    env: { ...process.env }
                });
                this.process.stdout?.on('data', (data) => {
                    this.outputChannel.append(data.toString());
                });
                this.process.stderr?.on('data', (data) => {
                    this.outputChannel.append(data.toString());
                });
                this.process.on('error', (err) => {
                    this.outputChannel.appendLine(`[Engine Process Error]: ${err.message}`);
                    this.process = undefined;
                    resolve(false);
                });
                this.process.on('exit', (code) => {
                    this.outputChannel.appendLine(`[Engine Process Exited] code: ${code}`);
                    this.process = undefined;
                });
                // Poll health endpoint
                this.waitForHealth(port, 25000)
                    .then((ready) => {
                    if (ready) {
                        this.outputChannel.appendLine(`[Engine] Ready at ${this.getEndpointUrl()}`);
                        resolve(true);
                    }
                    else {
                        this.outputChannel.appendLine('[Engine Error] Timed out waiting for server to be ready');
                        this.stop();
                        resolve(false);
                    }
                })
                    .catch(() => {
                    this.stop();
                    resolve(false);
                });
            }
            catch (err) {
                this.outputChannel.appendLine(`[Engine Spawn Error]: ${err?.message || err}`);
                resolve(false);
            }
        });
    }
    async stop() {
        if (this.process && !this.process.killed) {
            this.outputChannel.appendLine('[Engine] Stopping current model process...');
            if (process.platform === 'win32') {
                this.process.kill();
            }
            else {
                this.process.kill('SIGTERM');
            }
            this.process = undefined;
            this.currentModel = undefined;
            // Brief pause to ensure socket and VRAM release
            await new Promise(r => setTimeout(r, 400));
        }
    }
    async waitForHealth(port, timeoutMs) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                const isOk = await new Promise((resolve) => {
                    const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 1000 }, (res) => {
                        resolve(res.statusCode === 200);
                    });
                    req.on('error', () => resolve(false));
                    req.on('timeout', () => { req.destroy(); resolve(false); });
                });
                if (isOk) {
                    return true;
                }
            }
            catch {
                // Retry
            }
            await new Promise(r => setTimeout(r, 400));
        }
        return false;
    }
}
exports.LlamaServerService = LlamaServerService;
//# sourceMappingURL=llamaServerService.js.map