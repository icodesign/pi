import { Agent, type AgentMessage, type StreamFn, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	type Api,
	clampThinkingLevel,
	type Message,
	type Model,
	type ProviderHeaders,
	type ProviderResponse,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
	AgentSession,
	type AgentSessionConfig,
	type AgentSessionHostCapabilities,
	type ExtensionBindings,
} from "../core/agent-session.ts";
import { formatNoModelsAvailableMessage } from "../core/auth-guidance.ts";
import { DEFAULT_THINKING_LEVEL } from "../core/defaults.ts";
import type { SessionStartEvent, ToolDefinition } from "../core/extensions/types.ts";
import { convertToLlm } from "../core/messages.ts";
import type { ModelRuntimeContract } from "../core/model-runtime-contract.ts";
import { findInitialModelFromDefaults } from "../core/model-selection.ts";
import type { ResourceLoader } from "../core/resource-loader.ts";
import type { SessionManagerContract } from "../core/session/state.ts";
import type { SessionContext } from "../core/session-manager.ts";
import type { SettingsManagerContract } from "../core/settings/manager-core.ts";

/** Mutable bridge used by Agent callbacks and the constructed session. */
export type AgentSessionExtensionRunnerRef = NonNullable<AgentSessionConfig["extensionRunnerRef"]>;

/** Provider-header work that belongs to a concrete host, such as attribution headers. */
export type ProviderHeadersTransformer = (
	model: Model<Api>,
	headers: ProviderHeaders,
	options?: SimpleStreamOptions,
) => ProviderHeaders | Promise<ProviderHeaders>;

/** Host-owned inputs shared by the portable SDK and the Node facade. */
export interface CreateAgentSessionCoreOptions<
	TModelRuntime extends ModelRuntimeContract = ModelRuntimeContract,
	TSessionManager extends SessionManagerContract = SessionManagerContract,
	TSettingsManager extends SettingsManagerContract = SettingsManagerContract,
> {
	readonly cwd: string;
	readonly model?: Model<Api>;
	readonly streamFn: StreamFn;
	readonly modelRuntime: TModelRuntime;
	readonly settingsManager: TSettingsManager;
	readonly sessionManager: TSessionManager;
	readonly resourceLoader: ResourceLoader;
	readonly hostCapabilities: AgentSessionHostCapabilities<NoInfer<TSessionManager>>;

	readonly initialMessages?: readonly AgentMessage[];
	readonly thinkingLevel?: ThinkingLevel;
	readonly scopedModels?: ReadonlyArray<{ model: Model<Api>; thinkingLevel?: ThinkingLevel }>;
	readonly noTools?: "all" | "builtin";
	readonly tools?: string[];
	readonly excludeTools?: string[];
	readonly customTools?: ToolDefinition[];
	readonly steeringMode?: Agent["steeringMode"];
	readonly followUpMode?: Agent["followUpMode"];
	readonly transport?: Agent["transport"];
	readonly thinkingBudgets?: Agent["thinkingBudgets"];
	readonly maxRetryDelayMs?: number;
	readonly convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

	readonly sessionStartEvent?: SessionStartEvent;
	readonly extensionBindings?: ExtensionBindings;
	readonly extensionRunnerRef?: AgentSessionExtensionRunnerRef;
	readonly transformProviderHeaders?: ProviderHeadersTransformer;
}

/** Result shared by portable and Node SDK facades. */
export interface CreateAgentSessionCoreResult<
	TModelRuntime extends ModelRuntimeContract = ModelRuntimeContract,
	TSessionManager extends SessionManagerContract = SessionManagerContract,
	TSettingsManager extends SettingsManagerContract = SettingsManagerContract,
> {
	session: AgentSession<TModelRuntime, TSessionManager, TSettingsManager>;
	extensionsResult: ReturnType<ResourceLoader["getExtensions"]>;
	modelFallbackMessage?: string;
}

function createInitialSessionContext<TSessionManager extends SessionManagerContract>(
	sessionManager: TSessionManager,
): {
	context: SessionContext;
	hasThinkingEntry: boolean;
} {
	const context = sessionManager.buildSessionContext();
	const hasThinkingEntry = sessionManager.getBranch().some((entry) => entry.type === "thinking_level_change");
	return { context, hasThinkingEntry };
}

function appendInitialMessages<TSessionManager extends SessionManagerContract>(
	sessionManager: TSessionManager,
	messages: readonly AgentMessage[],
): void {
	for (const message of messages) {
		switch (message.role) {
			case "user":
			case "assistant":
			case "toolResult":
				sessionManager.appendMessage(message);
				break;
			case "custom":
				sessionManager.appendCustomMessageEntry(
					message.customType,
					message.content,
					message.display,
					message.details,
				);
				break;
		}
	}
}

function convertToLlmWithBlockImages(
	convert: (messages: AgentMessage[]) => Message[] | Promise<Message[]>,
	settingsManager: SettingsManagerContract,
): (messages: AgentMessage[]) => Message[] | Promise<Message[]> {
	return async (messages) => {
		const converted = await convert(messages);
		if (!settingsManager.getBlockImages()) {
			return converted;
		}

		return converted.map((message) => {
			if (message.role !== "user" && message.role !== "toolResult") {
				return message;
			}
			if (!Array.isArray(message.content) || !message.content.some((content) => content.type === "image")) {
				return message;
			}

			const filteredContent = message.content
				.map((content) =>
					content.type === "image" ? { type: "text" as const, text: "Image reading is disabled." } : content,
				)
				.filter((content, index, contents) => {
					return !(
						content.type === "text" &&
						content.text === "Image reading is disabled." &&
						index > 0 &&
						contents[index - 1]?.type === "text" &&
						(contents[index - 1] as { type: "text"; text: string }).text === "Image reading is disabled."
					);
				});
			return { ...message, content: filteredContent };
		});
	};
}

function createProviderStream(
	options: CreateAgentSessionCoreOptions,
	extensionRunnerRef: AgentSessionExtensionRunnerRef,
): StreamFn {
	type StreamOptionsWithHeaders = SimpleStreamOptions & {
		transformHeaders?: (headers: ProviderHeaders) => ProviderHeaders | Promise<ProviderHeaders>;
	};

	return async (model, context, streamOptions) => {
		const providerRetrySettings = options.settingsManager.getProviderRetrySettings();
		const httpIdleTimeoutMs = options.settingsManager.getHttpIdleTimeoutMs();
		// SDKs treat timeout=0 as 0ms (immediate timeout), not "no timeout".
		const effectiveTimeoutMs = httpIdleTimeoutMs === 0 ? 2147483647 : httpIdleTimeoutMs;
		const requestOptions: StreamOptionsWithHeaders = {
			...streamOptions,
			timeoutMs: streamOptions?.timeoutMs ?? providerRetrySettings.timeoutMs ?? effectiveTimeoutMs,
			websocketConnectTimeoutMs:
				streamOptions?.websocketConnectTimeoutMs ?? options.settingsManager.getWebSocketConnectTimeoutMs(),
			maxRetries: streamOptions?.maxRetries ?? providerRetrySettings.maxRetries,
			maxRetryDelayMs: streamOptions?.maxRetryDelayMs ?? providerRetrySettings.maxRetryDelayMs,
			transformHeaders: async (requestHeaders: ProviderHeaders) => {
				const callerHeaders = requestHeaders;
				const hostHeaders = options.transformProviderHeaders
					? await options.transformProviderHeaders(model, callerHeaders, streamOptions)
					: callerHeaders;
				const runner = extensionRunnerRef.current;
				return runner?.hasHandlers("before_provider_headers")
					? runner.emitBeforeProviderHeaders(hostHeaders)
					: hostHeaders;
			},
		};
		return options.streamFn(model, context, requestOptions);
	};
}

/** Construct Pi's native AgentSession from host-owned owners and capabilities. */
export async function createAgentSessionCore<
	TModelRuntime extends ModelRuntimeContract,
	TSessionManager extends SessionManagerContract,
	TSettingsManager extends SettingsManagerContract,
>(
	options: CreateAgentSessionCoreOptions<TModelRuntime, TSessionManager, TSettingsManager>,
): Promise<CreateAgentSessionCoreResult<TModelRuntime, TSessionManager, TSettingsManager>> {
	const { context: existingContext, hasThinkingEntry } = createInitialSessionContext(options.sessionManager);
	const restoredMessages = options.initialMessages ? [...options.initialMessages] : existingContext.messages;
	const hasExistingSession = existingContext.messages.length > 0;
	if (options.initialMessages && hasExistingSession) {
		throw new Error("initialMessages cannot be combined with a non-empty sessionManager");
	}

	let model = options.model;
	let modelFallbackMessage: string | undefined;
	if (!model && hasExistingSession && existingContext.model) {
		const restoredModel = options.modelRuntime.getModel(
			existingContext.model.provider,
			existingContext.model.modelId,
		);
		if (restoredModel && options.modelRuntime.hasConfiguredAuth(restoredModel.provider)) {
			model = restoredModel;
		}
		if (!model) {
			modelFallbackMessage = `Could not restore model ${existingContext.model.provider}/${existingContext.model.modelId}`;
		}
	}

	if (!model) {
		const result = await findInitialModelFromDefaults({
			defaultProvider: options.settingsManager.getDefaultProvider(),
			defaultModelId: options.settingsManager.getDefaultModel(),
			defaultThinkingLevel: options.settingsManager.getDefaultThinkingLevel(),
			modelThinkingLevels: options.settingsManager.getAllModelThinkingLevels(),
			modelRuntime: options.modelRuntime,
		});
		model = result.model;
		if (!model) {
			modelFallbackMessage = formatNoModelsAvailableMessage();
		} else if (modelFallbackMessage) {
			modelFallbackMessage += `. Using ${model.provider}/${model.id}`;
		}
	}

	let thinkingLevel = options.thinkingLevel;
	if (thinkingLevel === undefined && hasExistingSession) {
		thinkingLevel = hasThinkingEntry
			? (existingContext.thinkingLevel as ThinkingLevel)
			: (options.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL);
	}
	if (thinkingLevel === undefined && model) {
		thinkingLevel = options.settingsManager.getModelThinkingLevel(model.provider, model.id);
	}
	if (thinkingLevel === undefined) {
		thinkingLevel = options.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
	}
	thinkingLevel = model ? (clampThinkingLevel(model, thinkingLevel) as ThinkingLevel) : "off";

	if (!hasExistingSession && restoredMessages.length > 0) {
		appendInitialMessages(options.sessionManager, restoredMessages);
	}
	if (!hasExistingSession) {
		if (model) {
			options.sessionManager.appendModelChange(model.provider, model.id);
		}
		options.sessionManager.appendThinkingLevelChange(thinkingLevel);
	} else if (!hasThinkingEntry) {
		options.sessionManager.appendThinkingLevelChange(thinkingLevel);
	}

	const defaultActiveToolNames = ["read", "bash", "edit", "write"];
	const configuredDefaultToolNames = options.settingsManager.getDefaultTools();
	const activeToolNames = (
		options.tools ?? (options.noTools ? [] : (configuredDefaultToolNames ?? defaultActiveToolNames))
	).filter((name) => !options.excludeTools?.includes(name));
	const allowedToolNames = options.tools ?? (options.noTools === "all" ? [] : undefined);

	const extensionRunnerRef = options.extensionRunnerRef ?? {};
	const convert = options.convertToLlm ?? convertToLlm;
	const agent = new Agent({
		initialState: {
			messages: restoredMessages,
			model,
			thinkingLevel,
			tools: [],
		},
		convertToLlm: convertToLlmWithBlockImages(convert, options.settingsManager),
		streamFn: createProviderStream(options, extensionRunnerRef),
		onPayload: async (payload) => {
			const runner = extensionRunnerRef.current;
			return runner?.hasHandlers("before_provider_request") ? runner.emitBeforeProviderRequest(payload) : payload;
		},
		onResponse: async (response: ProviderResponse) => {
			const runner = extensionRunnerRef.current;
			if (runner?.hasHandlers("after_provider_response")) {
				await runner.emit({
					type: "after_provider_response",
					status: response.status,
					headers: response.headers,
				});
			}
		},
		transformContext: async (messages) => {
			const runner = extensionRunnerRef.current;
			return runner ? runner.emitContext(messages) : messages;
		},
		sessionId: options.sessionManager.getSessionId(),
		steeringMode: options.steeringMode ?? options.settingsManager.getSteeringMode(),
		followUpMode: options.followUpMode ?? options.settingsManager.getFollowUpMode(),
		transport: options.transport ?? options.settingsManager.getTransport(),
		thinkingBudgets: options.thinkingBudgets ?? options.settingsManager.getThinkingBudgets(),
		maxRetryDelayMs: options.maxRetryDelayMs ?? options.settingsManager.getProviderRetrySettings().maxRetryDelayMs,
	});

	const session = new AgentSession({
		agent,
		sessionManager: options.sessionManager,
		settingsManager: options.settingsManager,
		cwd: options.cwd,
		hostCapabilities: options.hostCapabilities,
		scopedModels: options.scopedModels ? [...options.scopedModels] : undefined,
		resourceLoader: options.resourceLoader,
		customTools: options.customTools,
		modelRuntime: options.modelRuntime,
		initialActiveToolNames: activeToolNames,
		allowedToolNames,
		excludedToolNames: options.excludeTools,
		extensionRunnerRef,
		sessionStartEvent: options.sessionStartEvent,
	});

	if (options.extensionBindings) {
		await session.bindExtensions(options.extensionBindings);
	}

	return {
		session,
		extensionsResult: options.resourceLoader.getExtensions(),
		modelFallbackMessage,
	};
}
