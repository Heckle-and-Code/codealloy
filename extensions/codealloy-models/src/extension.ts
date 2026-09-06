import * as vscode from 'vscode';
import * as path from 'path';
import { LocalModelManager, InstalledModel } from './modelManager';
import { CURATED_MODELS, CuratedModel } from './modelCatalog';
import { LlamaServerService } from './llamaServerService';
import { AgentChatViewProvider } from './agentChatViewProvider';
import { HardwareProber } from './hardwareProber';
import { OllamaService, DiscoveredModel } from './ollamaService';

let modelStatusBarItem: vscode.StatusBarItem;
let chatStatusBarItem: vscode.StatusBarItem;
let autonomyStatusBarItem: vscode.StatusBarItem;
let modelManager: LocalModelManager;
let llamaServer: LlamaServerService;
let chatProvider: AgentChatViewProvider;

export function activate(context: vscode.ExtensionContext) {
	modelManager = new LocalModelManager();
	llamaServer = LlamaServerService.getInstance();

	const hw = HardwareProber.getHardwareInfo();
	console.log(`[CodeAlloy] Hardware Detected: ${hw.cpuModel}, ${hw.memoryDescription}, recommended size: ${hw.recommendedModelSize}`);

	// 1. Create Model Selector & Chat Status Bar Items
	modelStatusBarItem = vscode.window.createStatusBarItem(
		'codealloy.modelSelector',
		vscode.StatusBarAlignment.Right,
		100
	);
	modelStatusBarItem.command = 'codealloy.selectModel';
	context.subscriptions.push(modelStatusBarItem);

	autonomyStatusBarItem = vscode.window.createStatusBarItem(
		'codealloy.autonomySelector',
		vscode.StatusBarAlignment.Right,
		99
	);
	autonomyStatusBarItem.command = 'codealloy.selectAutonomy';
	context.subscriptions.push(autonomyStatusBarItem);

	chatStatusBarItem = vscode.window.createStatusBarItem(
		'codealloy.chatButton',
		vscode.StatusBarAlignment.Right,
		101
	);
	chatStatusBarItem.text = '$(comment-discussion) Agent Chat';
	chatStatusBarItem.tooltip = 'Click to open CodeAlloy Agent Chat Panel';
	chatStatusBarItem.command = 'codealloy.focusChat';
	chatStatusBarItem.show();
	context.subscriptions.push(chatStatusBarItem);

	// 2. Register Agent Chat View Provider
	chatProvider = new AgentChatViewProvider(context.extensionUri, modelManager, llamaServer);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			AgentChatViewProvider.viewType,
			chatProvider,
			{ webviewOptions: { retainContextWhenHidden: true } }
		)
	);

	chatProvider.onDidChangeAutonomyLevel((level) => {
		updateAutonomyStatusBar(level);
	});

	// 3. Register Commands
	context.subscriptions.push(
		vscode.commands.registerCommand('codealloy.selectAutonomy', async () => {
			await showAutonomyPicker();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('codealloy.undoLastTurn', async () => {
			const shadowGit = chatProvider.getShadowGit();
			const result = await shadowGit.undoLastTurn();
			if (result.success && result.entry) {
				vscode.window.showInformationMessage(
					`CodeAlloy: Successfully rolled back last turn (${result.entry.commitHash.substring(0, 8)}).`
				);
			} else {
				vscode.window.showInformationMessage('CodeAlloy: No agent turns available to undo.');
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('codealloy.timeTravelTimeline', async () => {
			await showTimeTravelQuickPick();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('codealloy.acceptDiffChunk', async () => {
			await chatProvider.getDiffService().acceptCurrentChunk();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('codealloy.rejectDiffChunk', async () => {
			await chatProvider.getDiffService().rejectCurrentChunk();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('codealloy.acceptAllDiffs', async () => {
			await chatProvider.getDiffService().acceptAllChunks();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('codealloy.openWelcome', async () => {
			try {
				await vscode.commands.executeCommand('workbench.action.openWalkthrough', 'codealloy.codealloy-models#codealloy.welcome');
			} catch (e) {
				console.error('[CodeAlloy] Failed to open walkthrough:', e);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('codealloy.selectModel', async () => {
			await showModelPicker();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('codealloy.switchProvider', async () => {
			await switchInferenceProvider();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('codealloy.refreshModels', () => {
			updateStatusBar();
			chatProvider.syncState();
			vscode.window.showInformationMessage('CodeAlloy: Local models refreshed.');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('codealloy.clearChat', () => {
			chatProvider.clearChat();
			vscode.window.showInformationMessage('CodeAlloy: Agent chat history cleared.');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('codealloy.focusChat', async () => {
			try {
				await vscode.commands.executeCommand('codealloy.agentView.focus');
			} catch {
				await vscode.commands.executeCommand('workbench.view.extension.codealloy-agent-panel');
			}
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
				chatProvider.syncState();
			}
		})
	);

	// Initial status bar setup & auto-load active model
	updateStatusBar();
	updateAutonomyStatusBar(chatProvider.getAutonomyLevel());
	modelStatusBarItem.show();
	autonomyStatusBarItem.show();

	const active = modelManager.getActiveModel();
	if (active) {
		activateModel(active).catch(err => {
			console.error('[CodeAlloy] Failed to auto-load active model:', err);
		});
	}

	// Auto-setup Agentic IDE layout on startup: Explorer on left, Agent Chat on right
	const setupAgenticLayout = async () => {
		try {
			// Ensure Explorer is active on the left Primary Side Bar
			await vscode.commands.executeCommand('workbench.view.explorer');
		} catch {}

		try {
			// Ensure CodeAlloy Agent is active on the right Secondary Side Bar
			await vscode.commands.executeCommand('codealloy.agentView.focus');
		} catch {
			try {
				await vscode.commands.executeCommand('workbench.view.extension.codealloy-agent-panel');
			} catch {}
		}
	};

	setTimeout(setupAgenticLayout, 250);
	setTimeout(setupAgenticLayout, 900);
}

async function switchInferenceProvider(): Promise<void> {
	const config = vscode.workspace.getConfiguration('codealloy');
	const currentProvider = config.get<string>('inferenceProvider', 'embedded');
	const currentEndpoint = config.get<string>('externalEndpoint', 'http://127.0.0.1:11434');

	const choice = await vscode.window.showQuickPick([
		{
			label: `${currentProvider === 'embedded' ? '$(check) ' : ''}Embedded Local Engine (llama.cpp)`,
			description: 'Offline, private, Metal GPU accelerated on Apple Silicon',
			provider: 'embedded'
		},
		{
			label: `${currentProvider === 'external' ? '$(check) ' : ''}External Endpoint (Ollama / vLLM / LM Studio / Remote Cloud GPU)`,
			description: currentEndpoint,
			provider: 'external'
		}
	], {
		placeHolder: 'Select active inference engine provider for CodeAlloy'
	});

	if (!choice) return;

	if (choice.provider === 'external') {
		const newEndpoint = await vscode.window.showInputBox({
			prompt: 'Enter external inference provider endpoint URL (e.g. Ollama, vLLM, LM Studio)',
			value: currentEndpoint,
			ignoreFocusOut: true
		});
		if (!newEndpoint) return;

		await config.update('externalEndpoint', newEndpoint.trim(), vscode.ConfigurationTarget.Global);
		await config.update('inferenceProvider', 'external', vscode.ConfigurationTarget.Global);

		// Stop embedded llamaServer to conserve local GPU memory
		llamaServer.stop();

		// Probe external endpoint
		const discovery = await OllamaService.discoverModels(newEndpoint.trim());
		if (discovery.available && discovery.models.length > 0) {
			vscode.window.showInformationMessage(`CodeAlloy: Connected to ${discovery.provider} endpoint (${discovery.models.length} models discovered).`);
			await activateModel(discovery.models[0].name);
		} else {
			vscode.window.showWarningMessage(`CodeAlloy: External endpoint set to ${newEndpoint}, but no models currently reachable.`);
		}
	} else {
		await config.update('inferenceProvider', 'embedded', vscode.ConfigurationTarget.Global);
		const installed = modelManager.listInstalledModels();
		if (installed.length > 0) {
			await activateModel(installed[0].fileName);
		}
		vscode.window.showInformationMessage('CodeAlloy: Switched to Embedded Local Engine (Metal GPU).');
	}

	updateStatusBar();
	chatProvider.syncState();
}

async function activateModel(fileName: string, curatedInfo?: CuratedModel): Promise<void> {
	const config = vscode.workspace.getConfiguration('codealloy');
	const provider = config.get<string>('inferenceProvider', 'embedded');

	// Memory safety check for embedded local models (US-1.4 / AC 1.4.3)
	if (provider === 'embedded') {
		const installed = modelManager.listInstalledModels();
		const matched = installed.find(m => m.fileName.toLowerCase() === fileName.toLowerCase());
		const matchedCurated = curatedInfo || matched?.curatedInfo || CURATED_MODELS.find(c => c.fileName.toLowerCase() === fileName.toLowerCase());

		const safety = HardwareProber.checkMemorySafety(
			matched ? matched.name : fileName,
			matchedCurated?.recommendedRamGb,
			matched?.sizeBytes || matchedCurated?.fileSizeBytes
		);

		if (!safety.safe && safety.warning) {
			const choice = await vscode.window.showWarningMessage(
				safety.warning,
				{ modal: true },
				'Load Model Anyway'
			);
			if (choice !== 'Load Model Anyway') {
				return;
			}
		}
	}

	await modelManager.setActiveModel(fileName);

	if (provider === 'embedded') {
		const fullPath = path.join(modelManager.getModelsDirectory(), fileName);
		modelStatusBarItem.text = `$(sync~spin) Loading ${fileName}...`;
		modelStatusBarItem.tooltip = `Loading ${fileName} into Apple Silicon Metal GPU memory...`;

		const started = await llamaServer.start(fullPath);
		if (!started) {
			vscode.window.showWarningMessage(`CodeAlloy: Selected "${fileName}" (inference engine offline).`);
		}
	}

	updateStatusBar();
	chatProvider.syncState();
}

function updateStatusBar(): void {
	const active = modelManager.getActiveModel();
	const installed = modelManager.listInstalledModels();
	const serverStatus = llamaServer.getStatus();
	const config = vscode.workspace.getConfiguration('codealloy');
	const provider = config.get<string>('inferenceProvider', 'embedded');
	const externalEndpoint = config.get<string>('externalEndpoint', 'http://127.0.0.1:11434');
	const hw = HardwareProber.getHardwareInfo();

	if (active) {
		const matched = installed.find(m => m.fileName.toLowerCase() === active.toLowerCase());
		const displayName = matched ? matched.name : active;
		const providerLabel = provider === 'embedded' ? 'Metal GPU' : 'External';

		if (serverStatus.running || provider === 'external') {
			modelStatusBarItem.text = `$(flame) ${displayName} (${providerLabel})`;
			modelStatusBarItem.tooltip = `CodeAlloy Active Model: ${displayName}\nProvider: ${provider === 'embedded' ? 'Embedded llama.cpp (Metal GPU)' : `External (${externalEndpoint})`}\nHardware: ${hw.memoryDescription}\nClick to switch models or provider`;
			modelStatusBarItem.backgroundColor = undefined;
		} else {
			modelStatusBarItem.text = `$(flame) ${displayName} (Standby)`;
			modelStatusBarItem.tooltip = `CodeAlloy Model: ${displayName} (Ready to load on prompt)\nProvider: Embedded llama.cpp\nClick to change models`;
			modelStatusBarItem.backgroundColor = undefined;
		}
	} else {
		modelStatusBarItem.text = `$(flame) CodeAlloy: No Model`;
		modelStatusBarItem.tooltip = 'Click to select or download a local coding model';
		modelStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
	}
}

function updateAutonomyStatusBar(level?: string): void {
	const activeLevel = level || chatProvider.getAutonomyLevel() || 'L3';
	const badges: Record<string, { icon: string; label: string; desc: string }> = {
		L0: { icon: '$(info)', label: 'L0 Assist', desc: 'Read-only advisory mode (no file or terminal actions)' },
		L1: { icon: '$(comment)', label: 'L1 Chat', desc: 'Interactive dialogue without autonomous tool execution' },
		L2: { icon: '$(eye)', label: 'L2 Supv', desc: 'Supervised: 1-click approvals for all file writes and shell commands' },
		L3: { icon: '$(shield)', label: 'L3 Guard', desc: 'Guarded: Auto-run safe workspace actions, guard dangerous commands (Default)' },
		L4: { icon: '$(zap)', label: 'L4 Auto', desc: 'Autonomous: Goal runner loop with error circuit breaker' }
	};
	const info = badges[activeLevel] || badges['L3'];
	autonomyStatusBarItem.text = `${info.icon} ${info.label}`;
	autonomyStatusBarItem.tooltip = `CodeAlloy Autonomy Level: ${info.desc}\nClick to switch autonomy level`;
	autonomyStatusBarItem.show();
}

async function showAutonomyPicker(): Promise<void> {
	const current = chatProvider.getAutonomyLevel();
	const items: (vscode.QuickPickItem & { level: string })[] = [
		{
			label: '$(info) L0: Assist',
			description: 'Read-only advisory mode',
			detail: 'Suggests code in chat; strictly prevents writing files or running terminal commands.',
			picked: current === 'L0',
			level: 'L0'
		},
		{
			label: '$(comment) L1: Chat',
			description: 'Interactive conversation',
			detail: 'Conversational partner mode; answers questions without invoking autonomous tools.',
			picked: current === 'L1',
			level: 'L1'
		},
		{
			label: '$(eye) L2: Supervised',
			description: '1-click human approvals',
			detail: 'Pauses before every file write and shell command for interactive Approve / Reject confirmation.',
			picked: current === 'L2',
			level: 'L2'
		},
		{
			label: '$(shield) L3: Guarded (Recommended)',
			description: 'Safe workspace auto-execution',
			detail: 'Automatically creates/edits files and runs safe commands in workspace; intercepts dangerous operations.',
			picked: current === 'L3',
			level: 'L3'
		},
		{
			label: '$(zap) L4: Autonomous',
			description: 'Goal runner with circuit breaker',
			detail: 'Iterates autonomously across up to 25 turns; halts automatically if 3 repeated errors occur.',
			picked: current === 'L4',
			level: 'L4'
		}
	];

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select CodeAlloy Autonomy Level'
	});

	if (selected) {
		chatProvider.setAutonomyLevel(selected.level);
		updateAutonomyStatusBar(selected.level);
		vscode.window.showInformationMessage(`CodeAlloy: Switched to Autonomy Level ${selected.label.replace(/\$\([^)]+\)\s*/, '')}.`);
	}
}

async function showModelPicker(): Promise<void> {
	const installed = modelManager.listInstalledModels();
	const active = modelManager.getActiveModel();
	const config = vscode.workspace.getConfiguration('codealloy');
	const provider = config.get<string>('inferenceProvider', 'embedded');
	const externalEndpoint = config.get<string>('externalEndpoint', 'http://127.0.0.1:11434');
	const hw = HardwareProber.getHardwareInfo();

	interface ModelQuickPickItem extends vscode.QuickPickItem {
		action: 'select' | 'download' | 'add-file' | 'open-folder' | 'switch-provider';
		fileName?: string;
		curatedModel?: CuratedModel;
	}

	const items: ModelQuickPickItem[] = [];

	// Section 0: Provider Switcher
	items.push({
		label: `$(server-process) Inference Provider: ${provider === 'embedded' ? 'Embedded Engine (Metal GPU)' : `External Endpoint (${externalEndpoint})`}`,
		description: 'Click to toggle between embedded llama.cpp and external Ollama/vLLM',
		action: 'switch-provider'
	});

	// Section 1: External Discovered Models (if in external mode)
	if (provider === 'external') {
		items.push({
			label: `EXTERNAL MODELS (${externalEndpoint})`,
			kind: vscode.QuickPickItemKind.Separator,
			action: 'select'
		});

		try {
			const discovery = await OllamaService.discoverModels(externalEndpoint);
			if (discovery.available && discovery.models.length > 0) {
				for (const m of discovery.models) {
					const isActive = active && m.name.toLowerCase() === active.toLowerCase();
					items.push({
						label: `${isActive ? '$(check) ' : ''}${m.name}`,
						description: m.parameterSize ? `${m.parameterSize} • ${m.quantization || ''}` : m.tag,
						detail: `Provider: ${discovery.provider} at ${externalEndpoint}`,
						action: 'select',
						fileName: m.name
					});
				}
			} else {
				items.push({
					label: '$(warning) No models found at external endpoint',
					description: discovery.error || 'Verify server is running',
					action: 'switch-provider'
				});
			}
		} catch (e: any) {
			items.push({
				label: '$(error) Could not connect to external endpoint',
				description: e?.message,
				action: 'switch-provider'
			});
		}
	}

	// Section 2: Installed Local Models (if in embedded mode or available)
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

	// Section 3: Curated Models to Download (US-1.4: Hardware-Aware Recommendations)
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
			const isRecommended = curated.id === hw.recommendedModelId;
			items.push({
				label: `${isRecommended ? '$(star-full) ' : '$(cloud-download) '}${curated.displayName}`,
				description: `${gb} GB • ${curated.parameterSize}${isRecommended ? ` • ★ Recommended for your ${hw.memoryDescription}` : ''}`,
				detail: curated.description,
				action: 'download',
				curatedModel: curated
			});
		}
	}

	// Section 4: Management Actions
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
		placeHolder: active ? `Active Model: ${active} — Switch or download models` : 'Select or download a local model',
		ignoreFocusOut: true
	});

	if (!selected) return;

	if (selected.action === 'switch-provider') {
		await switchInferenceProvider();
	} else if (selected.action === 'select' && selected.fileName) {
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

async function showTimeTravelQuickPick(): Promise<void> {
	const shadowGit = chatProvider.getShadowGit();
	const timeline = shadowGit.getHistoryTimeline();

	if (!timeline || timeline.length === 0) {
		vscode.window.showInformationMessage('CodeAlloy: No historical checkpoints recorded yet.');
		return;
	}

	const items: (vscode.QuickPickItem & { commitHash: string })[] = timeline
		.slice()
		.reverse()
		.map((entry) => {
			const timeStr = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
			const fileCount = entry.filesModified ? entry.filesModified.length : 0;
			const filesStr = fileCount > 0 ? entry.filesModified.join(', ') : 'No files modified';
			return {
				label: `$(history) #${entry.commitHash.substring(0, 8)} — ${timeStr}`,
				description: entry.prompt,
				detail: fileCount > 0 ? `Modified ${fileCount} file(s): ${filesStr}` : 'Advisory turn (read-only)',
				commitHash: entry.commitHash
			};
		});

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a checkpoint to restore workspace state'
	});

	if (selected) {
		const ok = await shadowGit.rollbackToCommit(selected.commitHash);
		if (ok) {
			vscode.window.showInformationMessage(`CodeAlloy: Workspace reverted to historical checkpoint #${selected.commitHash.substring(0, 8)}.`);
		} else {
			vscode.window.showErrorMessage(`CodeAlloy: Failed to rollback to checkpoint #${selected.commitHash.substring(0, 8)}.`);
		}
	}
}

export function deactivate() {
	if (llamaServer) {
		llamaServer.stop();
	}
	if (modelStatusBarItem) {
		modelStatusBarItem.dispose();
	}
	if (chatStatusBarItem) {
		chatStatusBarItem.dispose();
	}
	if (chatProvider) {
		chatProvider.getDiffService().dispose();
		chatProvider.getMcpService().dispose();
	}
}
