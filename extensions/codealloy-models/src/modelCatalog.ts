export interface CuratedModel {
	id: string;
	displayName: string;
	fileName: string;
	parameterSize: string;
	quantization: string;
	fileSizeBytes: number;
	recommendedRamGb: number;
	downloadUrl: string;
	description: string;
}

export const CURATED_MODELS: CuratedModel[] = [
	{
		id: 'qwen2.5-coder-1.5b-q4',
		displayName: 'Qwen 2.5 Coder 1.5B',
		fileName: 'qwen2.5-coder-1.5b-instruct-q4_k_m.gguf',
		parameterSize: '1.5B',
		quantization: 'Q4_K_M',
		fileSizeBytes: 1050000000,
		recommendedRamGb: 8,
		downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf',
		description: 'Ultra-fast, lightweight model ideal for 8GB RAM laptops and quick completions.'
	},
	{
		id: 'qwen2.5-coder-7b-q4',
		displayName: 'Qwen 2.5 Coder 7B (Recommended)',
		fileName: 'qwen2.5-coder-7b-instruct-q4_k_m.gguf',
		parameterSize: '7B',
		quantization: 'Q4_K_M',
		fileSizeBytes: 4680000000,
		recommendedRamGb: 16,
		downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf',
		description: 'State-of-the-art 7B coding model. Superb code generation, refactoring, and debugging.'
	},
	{
		id: 'deepseek-r1-distill-qwen-7b-q4',
		displayName: 'DeepSeek R1 Distill Qwen 7B',
		fileName: 'deepseek-r1-distill-qwen-7b-q4_k_m.gguf',
		parameterSize: '7B',
		quantization: 'Q4_K_M',
		fileSizeBytes: 4680000000,
		recommendedRamGb: 16,
		downloadUrl: 'https://huggingface.co/unsloth/DeepSeek-R1-Distill-Qwen-7B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf',
		description: 'Advanced reasoning and architectural problem-solving model.'
	},
	{
		id: 'qwen2.5-coder-14b-q4',
		displayName: 'Qwen 2.5 Coder 14B',
		fileName: 'qwen2.5-coder-14b-instruct-q4_k_m.gguf',
		parameterSize: '14B',
		quantization: 'Q4_K_M',
		fileSizeBytes: 9300000000,
		recommendedRamGb: 32,
		downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct-GGUF/resolve/main/qwen2.5-coder-14b-instruct-q4_k_m.gguf',
		description: 'High-capability multi-file engineering model for 32GB+ RAM workstations.'
	}
];
