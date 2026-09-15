import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { type Api, type AssistantMessage, createAssistantMessageEventStream, type Model } from "@earendil-works/pi-ai";
import { build } from "esbuild";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import {
	bashToolSystemPromptContribution as portableBashToolSystemPromptContribution,
	editToolSystemPromptContribution as portableEditToolSystemPromptContribution,
	readToolSystemPromptContribution as portableReadToolSystemPromptContribution,
	writeToolSystemPromptContribution as portableWriteToolSystemPromptContribution,
} from "../../src/core/tools/tool-prompt-contributions.ts";
import {
	AgentSession,
	bashToolSystemPromptContribution,
	createAgentSession,
	editToolSystemPromptContribution,
	InMemorySessionManager,
	type ModelRuntimeContract,
	readToolSystemPromptContribution,
	type SessionManagerContract,
	SettingsManager,
	type SettingsManagerContract,
	writeToolSystemPromptContribution,
} from "../../src/sdk/index.ts";

const model = {
	id: "sdk-test-model",
	name: "SDK test model",
	api: "openai-responses",
	provider: "sdk-test",
	baseUrl: "https://example.invalid",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 16_384,
	maxTokens: 1024,
} as Model<Api>;

function assistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createModelRuntime(): ModelRuntimeContract {
	return {
		refresh: async () => ({ models: [model], error: undefined }),
		getError: () => undefined,
		getModels: () => [model],
		getAvailableSnapshot: () => [model],
		getModel: () => model,
		checkAuth: async () => undefined,
		hasConfiguredAuth: () => true,
		getAuth: async () => ({ auth: { apiKey: "sdk-test-key" } }),
		isUsingOAuth: () => false,
		getProviderAuthStatus: () => ({ type: "api_key", authenticated: true }) as never,
		getCompatibilityRequestConfig: () => ({ authHeader: true }),
		getProvider: () => undefined,
		complete: async () => assistantMessage("complete") as never,
		registerProvider: () => {},
		registerNativeProvider: () => {},
		unregisterProvider: () => {},
		getRegisteredProviderConfig: () => undefined,
		getRegisteredNativeProvider: () => undefined,
		getRegisteredProviderIds: () => [],
	} as unknown as ModelRuntimeContract;
}

const sessions: Array<AgentSession<ModelRuntimeContract, SessionManagerContract, SettingsManagerContract>> = [];

afterEach(() => {
	for (const session of sessions.splice(0)) session.dispose();
});

describe("portable coding-agent SDK entry", () => {
	it("constructs the native AgentSession, binds inline extensions, and preserves session state", async () => {
		let streamCalls = 0;
		let sessionStarts = 0;
		let beforeRequests = 0;
		let afterResponses = 0;
		let transformedContexts = 0;
		const streamFn: StreamFn = async (_requestModel, context, options) => {
			streamCalls += 1;
			if (streamCalls <= 2) {
				await options?.onPayload?.({ messages: context.messages }, model);
				await options?.onResponse?.({ status: 200, headers: {} }, model);
			}
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() =>
				stream.push({ type: "done", reason: "stop", message: assistantMessage(`reply-${streamCalls}`) }),
			);
			return stream;
		};

		const { session } = await createAgentSession({
			cwd: "/workspace/project",
			model,
			streamFn,
			modelRuntime: createModelRuntime(),
			baseToolDefinitions: {},
			toolResultImageNormalizer: async (content) => content,
			settingsManager: SettingsManager.inMemory({
				compaction: { enabled: false, reserveTokens: 1, keepRecentTokens: 1 },
			}),
			extensionFactoryHost: {
				exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
			},
			extensionFactories: [
				(pi) => {
					pi.registerTool({
						name: "sdk_echo",
						label: "SDK Echo",
						description: "Echo a value.",
						parameters: Type.Object({ value: Type.String() }),
						execute: async (_toolCallId, params) => ({
							content: [{ type: "text", text: params.value }],
							details: undefined,
						}),
					});
					pi.on("session_start", () => {
						sessionStarts += 1;
					});
					pi.on("before_provider_request", () => {
						beforeRequests += 1;
					});
					pi.on("after_provider_response", () => {
						afterResponses += 1;
					});
					pi.on("context", () => {
						transformedContexts += 1;
					});
				},
			],
			sessionId: "sdk-native-session",
			thinkingLevel: "off",
			steeringMode: "all",
			followUpMode: "all",
			extensionBindings: { mode: "print" },
		});
		sessions.push(session);

		expect(session).toBeInstanceOf(AgentSession);
		expect(session.sessionId).toBe("sdk-native-session");
		expect(session.getAllTools().map((tool) => tool.name)).toContain("sdk_echo");
		expect(session.steeringMode).toBe("all");
		expect(session.followUpMode).toBe("all");
		expect(session.sessionManager).toBeInstanceOf(InMemorySessionManager);
		expect(sessionStarts).toBe(1);

		await session.prompt("hello");
		await session.prompt("second");
		expect(session.messages.filter((message) => message.role === "assistant")).toHaveLength(2);
		expect(beforeRequests).toBe(2);
		expect(afterResponses).toBe(2);
		expect(transformedContexts).toBe(2);
		expect(session.sessionManager.getEntries().some((entry) => entry.type === "message")).toBe(true);
		expect(session.sessionManager.getEntries().some((entry) => entry.type === "model_change")).toBe(true);
		expect(session.sessionManager.getEntries().some((entry) => entry.type === "thinking_level_change")).toBe(true);

		const result = await session.compact("Keep the important work.");
		expect(result.summary).toContain("reply");
		expect(session.sessionManager.getEntries().some((entry) => entry.type === "compaction")).toBe(true);
	});

	it("keeps the portable bundle free of Node SDK, loader, TUI, and provider SDK closures", async () => {
		const entry = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/sdk/index.ts");
		const result = await build({
			absWorkingDir: dirname(entry),
			bundle: true,
			entryPoints: [entry],
			format: "esm",
			metafile: true,
			packages: "bundle",
			platform: "node",
			write: false,
		});
		const inputs = Object.keys(result.metafile?.inputs ?? {}).map((input) => input.replaceAll("\\", "/"));
		const forbidden = inputs.filter((input) =>
			[
				"src/core/sdk.ts",
				"src/core/resource-loader.ts",
				"src/core/extensions/loader.ts",
				"src/core/settings-manager.ts",
				"node_modules/jiti/",
				"node_modules/@earendil-works/pi-tui/",
				"node_modules/@anthropic-ai/",
				"node_modules/@google/genai/",
				"node_modules/@aws-sdk/",
				"node_modules/@smithy/",
				"node_modules/openai/",
				"node_modules/@silvia-odwyer/photon-node/",
			].some((suffix) => input.endsWith(suffix) || input.includes(suffix)),
		);
		expect(forbidden).toEqual([]);
		expect(inputs.some((input) => input.endsWith("core/tools/tool-prompt-contributions.ts"))).toBe(true);
		expect(inputs.some((input) => input.endsWith("core/tools/read.ts"))).toBe(false);
		expect(inputs.some((input) => input.endsWith("core/tools/write.ts"))).toBe(false);
		expect(inputs.some((input) => input.endsWith("core/tools/edit.ts"))).toBe(false);
		expect(inputs.some((input) => input.endsWith("core/tools/bash.ts"))).toBe(false);
	});

	it("exports the same portable tool prompt contributions as the tool modules", () => {
		expect(readToolSystemPromptContribution).toBe(portableReadToolSystemPromptContribution);
		expect(writeToolSystemPromptContribution).toBe(portableWriteToolSystemPromptContribution);
		expect(editToolSystemPromptContribution).toBe(portableEditToolSystemPromptContribution);
		expect(bashToolSystemPromptContribution).toBe(portableBashToolSystemPromptContribution);
	});
});
