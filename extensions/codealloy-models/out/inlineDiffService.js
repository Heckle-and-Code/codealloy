"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InlineDiffService = void 0;
const vscode = require("vscode");
class InlineDiffService {
    _addedDecorationType;
    _removedDecorationType;
    _currentSession;
    constructor() {
        this._addedDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(78, 189, 121, 0.22)',
            isWholeLine: true,
            overviewRulerColor: '#4EBD79',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            gutterIconPath: undefined
        });
        this._removedDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(224, 108, 117, 0.22)',
            isWholeLine: true,
            textDecoration: 'line-through',
            overviewRulerColor: '#E06C75',
            overviewRulerLane: vscode.OverviewRulerLane.Right
        });
    }
    get hasActiveDiff() {
        return !!this._currentSession && this._currentSession.chunks.some(c => c.status === 'pending');
    }
    /**
     * Compute line-by-line diff chunks between original text and proposed text.
     */
    computeDiffChunks(originalText, newText) {
        const origLines = originalText.split('\n');
        const newLines = newText.split('\n');
        // Simple and robust LCS-based line differ
        const lcsMatrix = this._buildLcsMatrix(origLines, newLines);
        const diffOps = this._backtrackLcs(lcsMatrix, origLines, newLines);
        const chunks = [];
        let chunkId = 0;
        let currentOpGroup = [];
        let currentNewLineIdx = 0;
        for (const item of diffOps) {
            if (item.op === 'same') {
                if (currentOpGroup.length > 0) {
                    const chunk = this._buildChunkFromOps(chunkId++, currentOpGroup, currentNewLineIdx);
                    if (chunk)
                        chunks.push(chunk);
                    currentOpGroup = [];
                }
                currentNewLineIdx++;
            }
            else {
                currentOpGroup.push(item);
                if (item.op === 'add') {
                    currentNewLineIdx++;
                }
            }
        }
        if (currentOpGroup.length > 0) {
            const chunk = this._buildChunkFromOps(chunkId++, currentOpGroup, currentNewLineIdx);
            if (chunk)
                chunks.push(chunk);
        }
        return chunks;
    }
    /**
     * Render inline diff in the editor.
     */
    async showDiff(editor, proposedContent) {
        const originalContent = editor.document.getText();
        const chunks = this.computeDiffChunks(originalContent, proposedContent);
        if (chunks.length === 0) {
            return true; // No differences
        }
        // Apply proposed content to editor buffer first so added lines can be decorated
        const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(originalContent.length));
        await editor.edit(editBuilder => {
            editBuilder.replace(fullRange, proposedContent);
        });
        // Apply decorations
        this._applyDecorations(editor, chunks);
        // Set VS Code context for keybindings
        await vscode.commands.executeCommand('setContext', 'codealloy.hasActiveDiff', true);
        return new Promise((resolve) => {
            this._currentSession = {
                editor,
                documentUri: editor.document.uri,
                chunks,
                currentChunkIndex: 0,
                originalContent,
                proposedContent,
                resolvePromise: resolve
            };
            // Scroll to first chunk
            if (chunks[0]) {
                const pos = new vscode.Position(chunks[0].startLine, 0);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            }
            vscode.window.showInformationMessage(`CodeAlloy Inline Diff: ${chunks.length} chunk(s) pending review. [Tab: Accept | Esc: Reject | Cmd+Enter: Accept All]`);
        });
    }
    async acceptCurrentChunk() {
        if (!this._currentSession)
            return;
        const session = this._currentSession;
        const pendingChunks = session.chunks.filter(c => c.status === 'pending');
        if (pendingChunks.length === 0)
            return;
        const currentChunk = session.chunks[session.currentChunkIndex] || pendingChunks[0];
        currentChunk.status = 'accepted';
        // Move to next pending chunk
        const nextPending = session.chunks.find((c, idx) => idx > session.currentChunkIndex && c.status === 'pending')
            || session.chunks.find(c => c.status === 'pending');
        if (nextPending) {
            session.currentChunkIndex = session.chunks.indexOf(nextPending);
            const pos = new vscode.Position(nextPending.startLine, 0);
            session.editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            this._applyDecorations(session.editor, session.chunks);
        }
        else {
            await this.acceptAllChunks();
        }
    }
    async rejectCurrentChunk() {
        if (!this._currentSession)
            return;
        const session = this._currentSession;
        const currentChunk = session.chunks[session.currentChunkIndex];
        if (!currentChunk || currentChunk.status !== 'pending')
            return;
        currentChunk.status = 'rejected';
        // Revert chunk lines in editor
        const startPos = new vscode.Position(currentChunk.startLine, 0);
        const endPos = new vscode.Position(currentChunk.endLine + 1, 0);
        const originalReplacement = currentChunk.originalLines.join('\n') + (currentChunk.originalLines.length > 0 ? '\n' : '');
        await session.editor.edit(editBuilder => {
            editBuilder.replace(new vscode.Range(startPos, endPos), originalReplacement);
        });
        // Check if any remaining pending
        const remaining = session.chunks.filter(c => c.status === 'pending');
        if (remaining.length === 0) {
            await this._finalizeSession(false);
        }
        else {
            const next = remaining[0];
            session.currentChunkIndex = session.chunks.indexOf(next);
            this._applyDecorations(session.editor, session.chunks);
        }
    }
    async acceptAllChunks() {
        if (!this._currentSession)
            return;
        for (const chunk of this._currentSession.chunks) {
            chunk.status = 'accepted';
        }
        await this._finalizeSession(true);
    }
    async _finalizeSession(accepted) {
        if (!this._currentSession)
            return;
        const session = this._currentSession;
        // Clear decorations
        session.editor.setDecorations(this._addedDecorationType, []);
        session.editor.setDecorations(this._removedDecorationType, []);
        // Save document if accepted
        if (accepted) {
            await session.editor.document.save();
        }
        await vscode.commands.executeCommand('setContext', 'codealloy.hasActiveDiff', false);
        if (session.resolvePromise) {
            session.resolvePromise(accepted);
        }
        this._currentSession = undefined;
        vscode.window.showInformationMessage(accepted ? 'CodeAlloy: All diff chunks accepted.' : 'CodeAlloy: Diff review completed.');
    }
    _applyDecorations(editor, chunks) {
        const addedRanges = [];
        const removedRanges = [];
        for (const chunk of chunks) {
            if (chunk.status === 'pending') {
                const range = new vscode.Range(new vscode.Position(chunk.startLine, 0), new vscode.Position(chunk.endLine, Math.max(0, editor.document.lineAt(Math.min(chunk.endLine, editor.document.lineCount - 1)).text.length)));
                if (chunk.type === 'add' || chunk.type === 'modify') {
                    addedRanges.push(range);
                }
                else if (chunk.type === 'delete') {
                    removedRanges.push(range);
                }
            }
        }
        editor.setDecorations(this._addedDecorationType, addedRanges);
        editor.setDecorations(this._removedDecorationType, removedRanges);
    }
    _buildChunkFromOps(id, ops, endLineIdx) {
        const added = ops.filter(o => o.op === 'add').map(o => o.line);
        const removed = ops.filter(o => o.op === 'del').map(o => o.line);
        if (added.length === 0 && removed.length === 0)
            return null;
        let type = 'modify';
        if (added.length > 0 && removed.length === 0)
            type = 'add';
        if (added.length === 0 && removed.length > 0)
            type = 'delete';
        const lineCount = added.length || 1;
        const startLine = Math.max(0, endLineIdx - lineCount);
        const endLine = Math.max(startLine, endLineIdx - 1);
        return {
            id,
            startLine,
            endLine,
            originalLines: removed,
            newLines: added,
            type,
            status: 'pending'
        };
    }
    _buildLcsMatrix(a, b) {
        const m = a.length;
        const n = b.length;
        const matrix = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (a[i - 1] === b[j - 1]) {
                    matrix[i][j] = matrix[i - 1][j - 1] + 1;
                }
                else {
                    matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
                }
            }
        }
        return matrix;
    }
    _backtrackLcs(matrix, a, b) {
        let i = a.length;
        let j = b.length;
        const result = [];
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
                result.unshift({ op: 'same', line: a[i - 1] });
                i--;
                j--;
            }
            else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
                result.unshift({ op: 'add', line: b[j - 1] });
                j--;
            }
            else if (i > 0 && (j === 0 || matrix[i][j - 1] < matrix[i - 1][j])) {
                result.unshift({ op: 'del', line: a[i - 1] });
                i--;
            }
        }
        return result;
    }
    dispose() {
        this._addedDecorationType.dispose();
        this._removedDecorationType.dispose();
    }
}
exports.InlineDiffService = InlineDiffService;
//# sourceMappingURL=inlineDiffService.js.map