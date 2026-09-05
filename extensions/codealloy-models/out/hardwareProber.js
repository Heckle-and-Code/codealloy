"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HardwareProber = void 0;
const os = require("os");
class HardwareProber {
    static _cachedInfo;
    static getHardwareInfo() {
        if (this._cachedInfo) {
            return this._cachedInfo;
        }
        const totalRamBytes = os.totalmem();
        const freeRamBytes = os.freemem();
        const totalRamGb = Math.round((totalRamBytes / (1024 * 1024 * 1024)) * 10) / 10;
        const freeRamGb = Math.round((freeRamBytes / (1024 * 1024 * 1024)) * 10) / 10;
        const cpus = os.cpus();
        const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown Processor';
        const isAppleSilicon = process.platform === 'darwin' && (process.arch === 'arm64' || cpuModel.includes('Apple'));
        const hasUnifiedMemory = isAppleSilicon;
        let recommendedModelSize = '1.5B';
        let recommendedModelId = 'qwen2.5-coder-1.5b-q4';
        if (totalRamGb >= 28) {
            recommendedModelSize = '14B';
            recommendedModelId = 'qwen2.5-coder-14b-q4';
        }
        else if (totalRamGb >= 12) {
            recommendedModelSize = '7B';
            recommendedModelId = 'qwen2.5-coder-7b-q4';
        }
        else {
            recommendedModelSize = '1.5B';
            recommendedModelId = 'qwen2.5-coder-1.5b-q4';
        }
        const memoryDescription = `${Math.round(totalRamGb)} GB ${hasUnifiedMemory ? 'Unified Memory' : 'RAM'}`;
        this._cachedInfo = {
            totalRamBytes,
            totalRamGb,
            freeRamBytes,
            freeRamGb,
            isAppleSilicon,
            hasUnifiedMemory,
            cpuModel,
            recommendedModelSize,
            recommendedModelId,
            memoryDescription
        };
        return this._cachedInfo;
    }
    static checkMemorySafety(modelName, recommendedRamGb, fileSizeBytes) {
        const hw = this.getHardwareInfo();
        const totalGb = hw.totalRamGb;
        // Estimate RAM requirement: use recommendedRamGb if known, else file size * 1.35 for context + KV cache
        let requiredGb = recommendedRamGb || 4.0;
        if (!recommendedRamGb && fileSizeBytes && fileSizeBytes > 0) {
            requiredGb = Math.round(((fileSizeBytes * 1.35) / (1024 * 1024 * 1024)) * 10) / 10;
        }
        const thresholdGb = totalGb * 0.8;
        const safe = requiredGb <= thresholdGb;
        if (!safe) {
            const warning = `Loading "${modelName}" requires ~${requiredGb} GB of memory, which exceeds 80% of your system's total memory (${Math.round(totalGb)} GB ${hw.hasUnifiedMemory ? 'Unified Memory' : 'RAM'}). This may cause significant system memory pressure or swapping.`;
            return { safe: false, warning, requiredGb, totalGb };
        }
        return { safe: true, requiredGb, totalGb };
    }
}
exports.HardwareProber = HardwareProber;
//# sourceMappingURL=hardwareProber.js.map