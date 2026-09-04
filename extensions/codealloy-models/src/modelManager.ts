import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as vscode from 'vscode';
import { CuratedModel, CURATED_MODELS } from './modelCatalog';

export interface InstalledModel {
	name: string;
	fileName: string;
	fullPath: string;
	sizeBytes: number;
	sizeFormatted: string;
	isCurated: boolean;
	curatedInfo?: CuratedModel;
}

export class LocalModelManager {
	private readonly modelsDir: string;

	constructor() {
		this.modelsDir = path.join(os.homedir(), '.codealloy', 'models');
		this.ensureModelsDirectory();
	}

	public getModelsDirectory(): string {
		return this.modelsDir;
	}

	public ensureModelsDirectory(): void {
		if (!fs.existsSync(this.modelsDir)) {
			fs.mkdirSync(this.modelsDir, { recursive: true });
		}
	}

	public formatBytes(bytes: number): string {
		if (bytes <= 0) return '0 B';
		const gb = bytes / (1024 * 1024 * 1024);
		if (gb >= 1.0) {
			return `${gb.toFixed(1)} GB`;
		}
		const mb = bytes / (1024 * 1024);
		return `${mb.toFixed(0)} MB`;
	}

	public listInstalledModels(): InstalledModel[] {
		this.ensureModelsDirectory();
		try {
			const files = fs.readdirSync(this.modelsDir);
			const models: InstalledModel[] = [];

			for (const file of files) {
				if (file.toLowerCase().endsWith('.gguf')) {
					const fullPath = path.join(this.modelsDir, file);
					const stat = fs.statSync(fullPath);
					const curated = CURATED_MODELS.find(m => m.fileName.toLowerCase() === file.toLowerCase());

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
		} catch (err) {
			console.error('[CodeAlloy] Error listing models:', err);
			return [];
		}
	}

	public getActiveModel(): string | undefined {
		const config = vscode.workspace.getConfiguration('codealloy.model');
		const active = config.get<string>('activeModel');
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

	public async setActiveModel(fileName: string): Promise<void> {
		const config = vscode.workspace.getConfiguration('codealloy.model');
		await config.update('activeModel', fileName, vscode.ConfigurationTarget.Global);
	}

	public async addModelFromDisk(): Promise<string | undefined> {
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
			} catch {
				fs.copyFileSync(srcPath, destPath);
			}
		}

		await this.setActiveModel(fileName);
		return fileName;
	}

	public async downloadCuratedModel(model: CuratedModel, progressCallback?: (percent: number) => void): Promise<string> {
		this.ensureModelsDirectory();
		const destPath = path.join(this.modelsDir, model.fileName);
		const tempPath = destPath + '.downloading';

		return new Promise((resolve, reject) => {
			const fileStream = fs.createWriteStream(tempPath);

			const request = (url: string) => {
				https.get(url, (res) => {
					// Follow redirects
					if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
						return request(res.headers.location);
					}

					if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
						fileStream.close();
						fs.unlink(tempPath, () => {});
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
							} catch (renameErr) {
								reject(renameErr);
							}
						});
					});

					res.on('error', (err) => {
						fileStream.close();
						fs.unlink(tempPath, () => {});
						reject(err);
					});
				}).on('error', (err) => {
					fileStream.close();
					fs.unlink(tempPath, () => {});
					reject(err);
				});
			};

			request(model.downloadUrl);
		});
	}
}
