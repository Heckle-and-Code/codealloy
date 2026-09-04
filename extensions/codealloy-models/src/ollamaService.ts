import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface DiscoveredModel {
	name: string;
	tag: string;
	sizeBytes?: number;
	parameterSize?: string;
	quantization?: string;
	modifiedAt?: string;
	format?: string;
}

export interface DiscoveryResult {
	available: boolean;
	endpoint: string;
	provider: 'ollama' | 'openai-compatible' | 'none';
	models: DiscoveredModel[];
	error?: string;
}

function fetchJson<T>(targetUrl: string, timeoutMs = 2500): Promise<T> {
	return new Promise((resolve, reject) => {
		try {
			const parsed = new URL(targetUrl);
			const client = parsed.protocol === 'https:' ? https : http;
			const req = client.get(targetUrl, { timeout: timeoutMs }, (res) => {
				if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
					let data = '';
					res.on('data', (chunk) => { data += chunk; });
					res.on('end', () => {
						try {
							resolve(JSON.parse(data));
						} catch (e) {
							reject(new Error(`Invalid JSON response: ${e}`));
						}
					});
				} else {
					reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
				}
			});

			req.on('timeout', () => {
				req.destroy(new Error('Connection timed out'));
			});
			req.on('error', (err) => {
				reject(err);
			});
		} catch (err) {
			reject(err);
		}
	});
}

export class OllamaService {
	public static formatBytes(bytes?: number): string {
		if (!bytes || bytes <= 0) return '';
		const gb = bytes / (1024 * 1024 * 1024);
		return `${gb.toFixed(1)} GB`;
	}

	public static async discoverModels(endpoint: string): Promise<DiscoveryResult> {
		const cleanEndpoint = endpoint.replace(/\/+$/, '');

		// 1. Try native Ollama endpoint: /api/tags
		try {
			const ollamaUrl = `${cleanEndpoint}/api/tags`;
			interface OllamaTagsResponse {
				models?: Array<{
					name: string;
					size?: number;
					modified_at?: string;
					details?: {
						parameter_size?: string;
						quantization_level?: string;
						format?: string;
					};
				}>;
			}

			const data = await fetchJson<OllamaTagsResponse>(ollamaUrl);
			if (data && Array.isArray(data.models)) {
				const models: DiscoveredModel[] = data.models.map(m => ({
					name: m.name,
					tag: m.name.includes(':') ? m.name.split(':')[1] : 'latest',
					sizeBytes: m.size,
					parameterSize: m.details?.parameter_size,
					quantization: m.details?.quantization_level,
					format: m.details?.format,
					modifiedAt: m.modified_at
				}));

				return {
					available: true,
					endpoint: cleanEndpoint,
					provider: 'ollama',
					models
				};
			}
		} catch (ollamaErr: any) {
			// 2. Fallback: Try OpenAI-compatible /v1/models (vLLM, LM Studio, etc.)
			try {
				const openaiUrl = `${cleanEndpoint}/v1/models`;
				interface OpenAIModelsResponse {
					data?: Array<{ id: string; owned_by?: string }>;
				}

				const openaiData = await fetchJson<OpenAIModelsResponse>(openaiUrl);
				if (openaiData && Array.isArray(openaiData.data)) {
					const models: DiscoveredModel[] = openaiData.data.map(m => ({
						name: m.id,
						tag: 'v1'
					}));

					return {
						available: true,
						endpoint: cleanEndpoint,
						provider: 'openai-compatible',
						models
					};
				}
			} catch {
				// Both checks failed
			}

			return {
				available: false,
				endpoint: cleanEndpoint,
				provider: 'none',
				models: [],
				error: ollamaErr.message || 'Connection refused'
			};
		}

		return {
			available: false,
			endpoint: cleanEndpoint,
			provider: 'none',
			models: [],
			error: 'No models discovered'
		};
	}
}
