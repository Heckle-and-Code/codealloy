"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShadowGitService = void 0;
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const child_process_1 = require("child_process");
const vscode = require("vscode");
class ShadowGitService {
    _workspacePath;
    _projectHash;
    _projectDir;
    _gitDir;
    _indexFile;
    _outputChannel;
    _initialized = false;
    _historyTimeline = [];
    _metadataFile;
    constructor(workspacePath, outputChannel) {
        this._workspacePath = path.resolve(workspacePath);
        this._projectHash = crypto.createHash('sha256').update(this._workspacePath).digest('hex').substring(0, 16);
        this._projectDir = path.join(os.homedir(), '.codealloy', 'projects', this._projectHash);
        this._gitDir = path.join(this._projectDir, 'history.git');
        this._indexFile = path.join(this._projectDir, 'index');
        this._metadataFile = path.join(this._projectDir, 'timeline.json');
        this._outputChannel = outputChannel;
    }
    get projectHash() {
        return this._projectHash;
    }
    get gitDir() {
        return this._gitDir;
    }
    async init() {
        if (this._initialized)
            return;
        try {
            if (!fs.existsSync(this._projectDir)) {
                fs.mkdirSync(this._projectDir, { recursive: true });
            }
            if (!fs.existsSync(this._gitDir)) {
                await this._execGit(`init --bare "${this._gitDir}"`);
                this._outputChannel.appendLine(`[ShadowGit] Initialized headless store for ${this._workspacePath} at ${this._gitDir}`);
            }
            // Configure author details and isolated settings
            await this._execGit(`--git-dir="${this._gitDir}" config user.name "CodeAlloy Shadow"`);
            await this._execGit(`--git-dir="${this._gitDir}" config user.email "shadow@codealloy.ai"`);
            await this._execGit(`--git-dir="${this._gitDir}" config core.autocrlf false`);
            // Setup info/exclude to safeguard against bloating the shadow store
            const infoDir = path.join(this._gitDir, 'info');
            if (!fs.existsSync(infoDir)) {
                fs.mkdirSync(infoDir, { recursive: true });
            }
            const excludePath = path.join(infoDir, 'exclude');
            const defaultExcludes = [
                'node_modules/',
                '.git/',
                '.codealloy/',
                '.build/',
                'out/',
                'dist/',
                '.next/',
                '__pycache__/',
                '*.pyc',
                '.venv/',
                'venv/',
                '*.log',
                '*.vsix',
                '.DS_Store'
            ].join('\n') + '\n';
            fs.writeFileSync(excludePath, defaultExcludes, { encoding: 'utf8' });
            // Load existing timeline metadata if available
            if (fs.existsSync(this._metadataFile)) {
                try {
                    const data = fs.readFileSync(this._metadataFile, 'utf8');
                    this._historyTimeline = JSON.parse(data);
                }
                catch (e) {
                    this._historyTimeline = [];
                }
            }
            this._initialized = true;
        }
        catch (err) {
            this._outputChannel.appendLine(`[ShadowGit Error] Failed to initialize shadow store: ${err.message || err}`);
        }
    }
    /**
     * Sub-50ms atomic pre-turn snapshot.
     * Executes `git add -A`, `git write-tree`, and `git commit-tree` without touching user's .git.
     */
    async createPreTurnSnapshot(turnId, prompt) {
        await this.init();
        const t0 = Date.now();
        try {
            // Stage workspace into isolated index
            await this._execGitWithWorkTree('add -A');
            // Write tree object
            const treeHash = (await this._execGitWithWorkTree('write-tree')).trim();
            // Sanitize prompt for commit message
            const sanitizedPrompt = prompt.replace(/"/g, '\\"').substring(0, 120);
            const commitHash = (await this._execGitWithWorkTree(`commit-tree ${treeHash} -m "Pre-turn checkpoint [${turnId}]: ${sanitizedPrompt}"`)).trim();
            // Update shadow branch ref
            await this._execGit(`--git-dir="${this._gitDir}" update-ref refs/heads/main ${commitHash}`);
            const elapsedMs = Date.now() - t0;
            this._outputChannel.appendLine(`[ShadowGit] Created pre-turn checkpoint ${commitHash.substring(0, 8)} in ${elapsedMs}ms for turn ${turnId}`);
            return commitHash;
        }
        catch (err) {
            this._outputChannel.appendLine(`[ShadowGit Snapshot Error]: ${err.message || err}`);
            return null;
        }
    }
    /**
     * Finalize a turn by calculating the files that were modified, created, or deleted,
     * taking a post-turn commit, and storing the record in the historical timeline.
     */
    async finalizeTurn(turnId, preCommitHash, prompt) {
        await this.init();
        try {
            await this._execGitWithWorkTree('add -A');
            const postTree = (await this._execGitWithWorkTree('write-tree')).trim();
            const diffOutput = (await this._execGit(`--git-dir="${this._gitDir}" diff-tree --no-commit-id --name-only -r ${preCommitHash} ${postTree}`)).trim();
            const modifiedFiles = diffOutput ? diffOutput.split('\n').map(f => f.trim()).filter(Boolean) : [];
            const entry = {
                turnId,
                commitHash: preCommitHash,
                timestamp: Date.now(),
                prompt,
                filesModified: modifiedFiles
            };
            this._historyTimeline.push(entry);
            this._saveTimeline();
            this._outputChannel.appendLine(`[ShadowGit] Finalized turn ${turnId}. Files modified: ${modifiedFiles.length > 0 ? modifiedFiles.join(', ') : 'none'}`);
            return modifiedFiles;
        }
        catch (err) {
            this._outputChannel.appendLine(`[ShadowGit Finalize Error]: ${err.message || err}`);
            return [];
        }
    }
    /**
     * Roll back the workspace state to a specific commit.
     * Restores all modified/deleted files and cleans untracked files added after that commit.
     */
    async rollbackToCommit(commitHash) {
        await this.init();
        const t0 = Date.now();
        try {
            this._outputChannel.appendLine(`[ShadowGit] Initiating rollback to commit ${commitHash.substring(0, 8)}...`);
            // 1. Reset index and update working tree directly to commit
            await this._execGitWithWorkTree(`read-tree -u --reset ${commitHash}`);
            // 2. Ensure all files match commit
            await this._execGitWithWorkTree(`checkout ${commitHash} -- .`);
            // 3. Remove untracked files that were created after this checkpoint
            await this._execGitWithWorkTree('clean -fd');
            const elapsedMs = Date.now() - t0;
            this._outputChannel.appendLine(`[ShadowGit] Rollback completed successfully in ${elapsedMs}ms!`);
            // 3. Request VS Code to reload active documents from disk
            try {
                await vscode.commands.executeCommand('workbench.action.files.revert');
            }
            catch (e) { }
            return true;
        }
        catch (err) {
            this._outputChannel.appendLine(`[ShadowGit Rollback Error]: ${err.message || err}`);
            return false;
        }
    }
    /**
     * Undo the most recent agent turn from the timeline.
     */
    async undoLastTurn() {
        if (this._historyTimeline.length === 0) {
            return { success: false };
        }
        const lastEntry = this._historyTimeline[this._historyTimeline.length - 1];
        const success = await this.rollbackToCommit(lastEntry.commitHash);
        if (success) {
            // Remove the undone turn from the timeline
            this._historyTimeline.pop();
            this._saveTimeline();
            return { success: true, entry: lastEntry };
        }
        return { success: false, entry: lastEntry };
    }
    /**
     * Retrieve all historical checkpoints in chronological order (or reverse for UI timeline).
     */
    getHistoryTimeline() {
        return [...this._historyTimeline];
    }
    _saveTimeline() {
        try {
            fs.writeFileSync(this._metadataFile, JSON.stringify(this._historyTimeline, null, 2), { encoding: 'utf8' });
        }
        catch (err) {
            this._outputChannel.appendLine(`[ShadowGit Save Error]: ${err.message || err}`);
        }
    }
    _execGit(commandArgs) {
        return new Promise((resolve, reject) => {
            (0, child_process_1.exec)(`git ${commandArgs}`, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(stderr || err.message));
                }
                else {
                    resolve(stdout);
                }
            });
        });
    }
    _execGitWithWorkTree(commandArgs) {
        const env = {
            ...process.env,
            GIT_DIR: this._gitDir,
            GIT_WORK_TREE: this._workspacePath,
            GIT_INDEX_FILE: this._indexFile
        };
        return new Promise((resolve, reject) => {
            (0, child_process_1.exec)(`git ${commandArgs}`, {
                cwd: this._workspacePath,
                env,
                maxBuffer: 20 * 1024 * 1024
            }, (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(stderr || err.message));
                }
                else {
                    resolve(stdout);
                }
            });
        });
    }
}
exports.ShadowGitService = ShadowGitService;
//# sourceMappingURL=shadowGitService.js.map