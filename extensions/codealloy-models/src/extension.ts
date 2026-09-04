import * as vscode from 'vscode';
import * as path from 'path';
import { LocalModelManager, InstalledModel } from './modelManager';
import { CURATED_MODELS, CuratedModel } from './modelCatalog';
import { LlamaServerService } from './llamaServerService';

let modelStatusBarItem: vscode.StatusBarItem;
let modelManager: LocalModelManager;
let llamaServer: LlamaServerService;

export function activate(context: vscode.ExtensionContext) {
	modelManager = new LocalModelManager();
	llamaServer = LlamaServerService.getInstance();

	// 1. Create Model Selector Status Bar Item
	modelStatusBarItem = vscode.window.createStatusBarItem(
		'codealloy.modelSelector',
		vscode.StatusBarAlignment.Right,
		100
	);
	modelStatusBarItem.command = 'codealloy.selectModel';
	context.subscriptions.push(modelStatusBarItem);

	// 2. Register Commands
	context.subscriptions.push(
		vscode.commands.registerCommand('codealloy.selectModel', async () => {
			await showModelPicker();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('codealloy.refreshModels', () => {
			updateStatusBar();
			vscode.window.showInformationMessage('CodeAlloy: Local models refreshed.');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('codealloy.addLocalModel', async () => {
			const added = await modelManager.addModelFromDisk();
			if (added) {
				await activateModel(added);
				vscode.window.showInformationMessage(`CodeAlloy: Model "${added}" added and activated.`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('codealloy.downloadModel', async (model?: CuratedModel) => {
			if (!model) {
				const choice = await vscode.window.showQuickPick(
					CURATED_MODELS.map(m => ({
						label: m.displayName,
						description: `${(m.fileSizeBytes / (1024*1024*1024)).toFixed(1)} GB`,
						detail: m.description,
						model: m
					})),
					{ placeHolder: 'Select an open coding model to download' }
				);
				if (!choice) return;
				model = choice.model;
			}

			await downloadModelWithProgress(model);
		})
	);

	// Listen for configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('codealloy.model')) {
				updateStatusBar();
			}
		})
	);

	// Initial status bar setup & auto-load active model
	updateStatusBar();
	modelStatusBarItem.show();

	const active = modelManager.getActiveModel();
	if (active) {
		activateModel(active).catch(err => {
			console.error('[CodeAlloy] Failed to auto-load active model:', err);
		});
	}
}

async function activateModel(fileName: string): Promise<void> {
	await modelManager.setActiveModel(fileName);
	const fullPath = path.join(modelManager.getModelsDirectory(), fileName);

	modelStatusBarItem.text = `$(sync~spin) Loading ${fileName}...`;
	modelStatusBarItem.tooltip = `Loading ${fileName} into Apple Silicon Metal GPU memory...`;

	const started = await llamaServer.start(fullPath);
	if (started) {
		updateStatusBar();
		vscode.window.showInformationMessage(`CodeAlloy: Model "${fileName}" loaded into GPU memory (Metal active).`);
	} else {
		updateStatusBar();
		vscode.window.showWarningMessage(`CodeAlloy: Selected "${fileName}" (inference engine offline).`);
	}
}

function updateStatusBar(): void {
	const active = modelManager.getActiveModel();
	const installed = modelManager.listInstalledModels();
	const serverStatus = llamaServer.getStatus();

	if (active) {
		const matched = installed.find(m => m.fileName.toLowerCase() === active.toLowerCase());
		const displayName = matched ? matched.name : active;

		if (serverStatus.running) {
			modelStatusBarItem.text = `$(flame) ${displayName}`;
			modelStatusBarItem.tooltip = `CodeAlloy Active Model: ${displayName}\nEngine: Embedded llama.cpp (Metal GPU)\nEndpoint: ${llamaServer.getEndpointUrl()}\nClick to switch models`;
			modelStatusBarItem.backgroundColor = undefined;
		} else {
			modelStatusBarItem.text = `$(flame) ${displayName} (Standby)`;
			modelStatusBarItem.tooltip = `CodeAlloy Model: ${displayName} (Ready to load on prompt)\nClick to change models`;
			modelStatusBarItem.backgroundColor = undefined;
		}
	} else {
		modelStatusBarItem.text = `$(flame) CodeAlloy: No Model`;
		modelStatusBarItem.tooltip = 'Click to select or download a local coding model';
		modelStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
	}
}

async function showModelPicker(): Promise<void> {
	const installed = modelManager.listInstalledModels();
	const active = modelManager.getActiveModel();

	interface ModelQuickPickItem extends vscode.QuickPickItem {
		action: 'select' | 'download' | 'add-file' | 'open-folder';
		fileName?: string;
		curatedModel?: CuratedModel;
	}

	const items: ModelQuickPickItem[] = [];

	// Section 1: Installed Models
	if (installed.length > 0) {
		items.push({
			label: 'INSTALLED LOCAL MODELS',
			kind: vscode.QuickPickItemKind.Separator,
			action: 'select'
		});

		for (const model of installed) {
			const isActive = active && model.fileName.toLowerCase() === active.toLowerCase();
			items.push({
				label: `${isActive ? '$(check) ' : ''}${model.name}`,
				description: model.sizeFormatted,
				detail: model.fullPath,
				action: 'select',
				fileName: model.fileName
			});
		}
	}

	// Section 2: Curated Models to Download
	const notInstalled = CURATED_MODELS.filter(
		c => !installed.some(i => i.fileName.toLowerCase() === c.fileName.toLowerCase())
	);

	if (notInstalled.length > 0) {
		items.push({
			label: 'CURATED CODING MODELS (1-CLICK DOWNLOAD)',
			kind: vscode.QuickPickItemKind.Separator,
			action: 'download'
		});

		for (const curated of notInstalled) {
			const gb = (curated.fileSizeBytes / (1024 * 1024 * 1024)).toFixed(1);
			items.push({
				label: `$(cloud-download) ${curated.displayName}`,
				description: `${gb} GB • ${curated.parameterSize}`,
				detail: curated.description,
				action: 'download',
				curatedModel: curated
			});
		}
	}

	// Section 3: Management Actions
	items.push({
		label: 'ACTIONS',
		kind: vscode.QuickPickItemKind.Separator,
		action: 'add-file'
	});

	items.push({
		label: '$(folder-opened) Add Local GGUF Model File...',
		description: 'Select an existing .gguf file from your filesystem',
		action: 'add-file'
	});

	items.push({
		label: '$(folder) Open Models Directory',
		description: modelManager.getModelsDirectory(),
		action: 'open-folder'
	});

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: active ? `Active Model: ${active} — Switch or download models` : 'Select or download a local model'
	});

	if (!selected) return;

	if (selected.action === 'select' && selected.fileName) {
		await activateModel(selected.fileName);
	} else if (selected.action === 'download' && selected.curatedModel) {
		await downloadModelWithProgress(selected.curatedModel);
	} else if (selected.action === 'add-file') {
		const added = await modelManager.addModelFromDisk();
		if (added) {
			await activateModel(added);
			vscode.window.showInformationMessage(`CodeAlloy: Added and activated "${added}"`);
		}
	} else if (selected.action === 'open-folder') {
		await vscode.env.openExternal(vscode.Uri.file(modelManager.getModelsDirectory()));
	}
}

async function downloadModelWithProgress(model: CuratedModel): Promise<void> {
	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Downloading ${model.displayName}`,
			cancellable: false
		},
		async (progress) => {
			progress.report({ message: 'Starting download...' });
			let lastPercent = 0;

			try {
				await modelManager.downloadCuratedModel(model, (percent) => {
					const inc = percent - lastPercent;
					if (inc > 0) {
						progress.report({ increment: inc, message: `${percent}% complete` });
						lastPercent = percent;
					}
				});

				await activateModel(model.fileName);
				vscode.window.showInformationMessage(
					`CodeAlloy: "${model.displayName}" downloaded and activated in GPU memory!`,
					'OK'
				);
			} catch (err: any) {
				vscode.window.showErrorMessage(`Download failed: ${err?.message || err}`);
			}
		}
	);
}

export function deactivate() {
	if (llamaServer) {
		llamaServer.stop();
	}
	if (modelStatusBarItem) {
		modelStatusBarItem.dispose();
	}
}
