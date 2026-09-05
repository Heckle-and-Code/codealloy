"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalModelManager = void 0;
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const vscode = require("vscode");
const modelCatalog_1 = require("./modelCatalog");
class LocalModelManager {
    modelsDir;
    constructor() {
        this.modelsDir = path.join(os.homedir(), '.codealloy', 'models');
        this.ensureModelsDirectory();
    }
    getModelsDirectory() {
        return this.modelsDir;
    }
    ensureModelsDirectory() {
        if (!fs.existsSync(this.modelsDir)) {
            fs.mkdirSync(this.modelsDir, { recursive: true });
        }
    }
    formatBytes(bytes) {
        if (bytes <= 0)
            return '0 B';
        const gb = bytes / (1024 * 1024 * 1024);
        if (gb >= 1.0) {
            return `${gb.toFixed(1)} GB`;
        }
        const mb = bytes / (1024 * 1024);
        return `${mb.toFixed(0)} MB`;
    }
    listInstalledModels() {
        this.ensureModelsDirectory();
        try {
            const files = fs.readdirSync(this.modelsDir);
            const models = [];
            for (const file of files) {
                if (file.toLowerCase().endsWith('.gguf')) {
                    const fullPath = path.join(this.modelsDir, file);
                    const stat = fs.statSync(fullPath);
                    const curated = modelCatalog_1.CURATED_MODELS.find(m => m.fileName.toLowerCase() === file.toLowerCase());
                    models.push({
                        name: curated ? curated.displayName : path.basename(file, '.gguf'),
                        fileName: file,
                        fullPath,
                        sizeBytes: stat.size,
                        sizeFormatted: this.formatBytes(stat.size),
                        isCurated: !!curated,
                        curatedInfo: curated
                    });
                }
            }
            return models;
        }
        catch (err) {
            console.error('[CodeAlloy] Error listing models:', err);
            return [];
        }
    }
    getActiveModel() {
        const config = vscode.workspace.getConfiguration('codealloy.model');
        const active = config.get('activeModel');
        if (active && active.trim().length > 0) {
            return active.trim();
        }
        // Default to first installed model if available
        const installed = this.listInstalledModels();
        if (installed.length > 0) {
            return installed[0].fileName;
        }
        return undefined;
    }
    async setActiveModel(fileName) {
        const config = vscode.workspace.getConfiguration('codealloy.model');
        await config.update('activeModel', fileName, vscode.ConfigurationTarget.Global);
    }
    async addModelFromDisk() {
        const selected = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'GGUF Models': ['gguf']
            },
            openLabel: 'Add Model to CodeAlloy'
        });
        if (!selected || selected.length === 0) {
            return undefined;
        }
        const srcPath = selected[0].fsPath;
        const fileName = path.basename(srcPath);
        const destPath = path.join(this.modelsDir, fileName);
        if (!fs.existsSync(destPath)) {
            // Symlink or copy
            try {
                fs.symlinkSync(srcPath, destPath);
            }
            catch {
                fs.copyFileSync(srcPath, destPath);
            }
        }
        await this.setActiveModel(fileName);
        return fileName;
    }
    async downloadCuratedModel(model, progressCallback) {
        this.ensureModelsDirectory();
        const destPath = path.join(this.modelsDir, model.fileName);
        const tempPath = destPath + '.downloading';
        return new Promise((resolve, reject) => {
            const fileStream = fs.createWriteStream(tempPath);
            const request = (url) => {
                https.get(url, (res) => {
                    // Follow redirects
                    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        return request(res.headers.location);
                    }
                    if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                        fileStream.close();
                        fs.unlink(tempPath, () => { });
                        return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
                    }
                    const totalBytes = parseInt(res.headers['content-length'] || String(model.fileSizeBytes), 10);
                    let downloadedBytes = 0;
                    res.on('data', (chunk) => {
                        downloadedBytes += chunk.length;
                        fileStream.write(chunk);
                        if (totalBytes > 0 && progressCallback) {
                            const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
                            progressCallback(percent);
                        }
                    });
                    res.on('end', () => {
                        fileStream.end(async () => {
                            try {
                                if (fs.existsSync(destPath)) {
                                    fs.unlinkSync(destPath);
                                }
                                fs.renameSync(tempPath, destPath);
                                await this.setActiveModel(model.fileName);
                                resolve(destPath);
                            }
                            catch (renameErr) {
                                reject(renameErr);
                            }
                        });
                    });
                    res.on('error', (err) => {
                        fileStream.close();
                        fs.unlink(tempPath, () => { });
                        reject(err);
                    });
                }).on('error', (err) => {
                    fileStream.close();
                    fs.unlink(tempPath, () => { });
                    reject(err);
                });
            };
            request(model.downloadUrl);
        });
    }
}
exports.LocalModelManager = LocalModelManager;
//# sourceMappingURL=modelManager.js.map