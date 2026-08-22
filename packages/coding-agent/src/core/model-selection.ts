/**
 * Environment-neutral initial model selection.
 *
 * CLI model parsing and diagnostics remain in model-resolver.ts. This leaf
 * owns only the settings/auth/available-model fallback shared by Node and SDK
 * entry points.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, KnownProvider, Model } from "@earendil-works/pi-ai";
import { DEFAULT_THINKING_LEVEL } from "./defaults.ts";
import type { ModelRuntimeContract } from "./model-runtime-contract.ts";

/** Default model IDs for each known provider. */
export const defaultModelPerProvider: Record<KnownProvider, string> = {
	"amazon-bedrock": "us.anthropic.claude-opus-4-6-v1",
	"ant-ling": "Ring-2.6-1T",
	anthropic: "claude-opus-4-8",
	openai: "gpt-5.5",
	"azure-openai-responses": "gpt-5.4",
	"openai-codex": "gpt-5.5",
	radius: "auto",
	nvidia: "nvidia/nemotron-3-super-120b-a12b",
	deepseek: "deepseek-v4-pro",
	google: "gemini-3.1-pro-preview",
	"google-vertex": "gemini-3.1-pro-preview",
	"github-copilot": "gpt-5.4",
	openrouter: "moonshotai/kimi-k2.6",
	"vercel-ai-gateway": "zai/glm-5.1",
	xai: "grok-4.6",
	groq: "openai/gpt-oss-120b",
	cerebras: "gpt-oss-120b",
	zai: "glm-5.3",
	"zai-coding-cn": "glm-5.3",
	mistral: "devstral-medium-latest",
	minimax: "MiniMax-M2.7",
	"minimax-cn": "MiniMax-M2.7",
	moonshotai: "kimi-k2.6",
	"moonshotai-cn": "kimi-k2.6",
	huggingface: "moonshotai/Kimi-K2.6",
	fireworks: "accounts/fireworks/models/kimi-k2p6",
	together: "moonshotai/Kimi-K2.6",
	baseten: "zai-org/GLM-5.2",
	opencode: "kimi-k2.6",
	"opencode-go": "kimi-k2.6",
	"kimi-coding": "kimi-for-coding",
	"cloudflare-workers-ai": "@cf/moonshotai/kimi-k2.6",
	"cloudflare-ai-gateway": "workers-ai/@cf/moonshotai/kimi-k2.6",
	"qwen-token-plan": "qwen3.7-max",
	"qwen-token-plan-cn": "qwen3.7-max",
	"qwen-token-plan-individual": "qwen3.8-max",
	xiaomi: "mimo-v2.5-pro",
	"xiaomi-token-plan-cn": "mimo-v2.5-pro",
	"xiaomi-token-plan-ams": "mimo-v2.5-pro",
	"xiaomi-token-plan-sgp": "mimo-v2.5-pro",
};

export interface InitialModelResult {
	model: Model<Api> | undefined;
	thinkingLevel: ThinkingLevel;
	fallbackMessage: string | undefined;
}

export async function findInitialModelFromDefaults(options: {
	defaultProvider?: string;
	defaultModelId?: string;
	defaultThinkingLevel?: ThinkingLevel;
	modelThinkingLevels?: Record<string, ThinkingLevel>;
	modelRuntime: Pick<ModelRuntimeContract, "getModel" | "hasConfiguredAuth" | "getAvailableSnapshot">;
}): Promise<InitialModelResult> {
	const { defaultProvider, defaultModelId, defaultThinkingLevel, modelThinkingLevels, modelRuntime } = options;

	if (defaultProvider && defaultModelId) {
		const found = modelRuntime.getModel(defaultProvider, defaultModelId);
		if (found && modelRuntime.hasConfiguredAuth(found.provider)) {
			const perModel = modelThinkingLevels?.[`${defaultProvider}/${defaultModelId}`];
			return {
				model: found,
				thinkingLevel: perModel ?? defaultThinkingLevel ?? DEFAULT_THINKING_LEVEL,
				fallbackMessage: undefined,
			};
		}
	}

	const availableModels = [...modelRuntime.getAvailableSnapshot()];
	for (const provider of Object.keys(defaultModelPerProvider) as KnownProvider[]) {
		const defaultId = defaultModelPerProvider[provider];
		const match = availableModels.find((model) => model.provider === provider && model.id === defaultId);
		if (match) {
			return { model: match, thinkingLevel: DEFAULT_THINKING_LEVEL, fallbackMessage: undefined };
		}
	}

	return {
		model: availableModels[0],
		thinkingLevel: DEFAULT_THINKING_LEVEL,
		fallbackMessage: undefined,
	};
}
