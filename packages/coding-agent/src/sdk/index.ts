import type { Agent, AgentMessage, StreamFn, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Message, Model } from "@earendil-works/pi-ai";
import type {
	AgentSessionHostCapabilities,
	BashExecutor,
	ExtensionBindings,
	SessionExporter,
	ToolResultImageNormalizer,
} from "../core/agent-session.ts";
import { AgentSession } from "../core/agent-session.ts";
import type { ExtensionFactoryHost } from "../core/extensions/factory.ts";
import { createExtensionRuntime } from "../core/extensions/factory.ts";
import type {
	ExtensionFactory,
	InlineExtension,
	LoadExtensionsResult,
	SessionStartEvent,
	ToolDefinition,
} from "../core/extensions/types.ts";
import type { ModelRuntimeContract } from "../core/model-runtime-contract.ts";
import type { ResourceLoader } from "../core/resource-loader.ts";
import { InMemorySessionManager, type SessionManagerContract } from "../core/session/state.ts";
import type { NewSessionOptions, SessionContext, SessionEntry, SessionHeader } from "../core/session-manager.ts";
import {
	InMemorySettingsStorage,
	type Settings,
	SettingsManager,
	type SettingsManagerContract,
	type SettingsManagerCreateOptions,
	type SettingsStorage,
} from "../core/settings/manager-core.ts";
import {
	bashToolSystemPromptContribution,
	editToolSystemPromptContribution,
	readToolSystemPromptContribution,
	writeToolSystemPromptContribution,
} from "../core/tools/tool-prompt-contributions.ts";
import { type CreateAgentSessionCoreOptions, createAgentSessionCore } from "./core.ts";
import { InlineResourceLoader, type InlineResourceLoaderOptions } from "./resource-loader.ts";

/** Options for the host-injected portable coding-agent SDK. */
export interface CreateAgentSessionOptions
	extends Omit<
		CreateAgentSessionCoreOptions,
		"model" | "resourceLoader" | "extensionRunnerRef" | "settingsManager" | "sessionManager" | "hostCapabilities"
	> {
	readonly model?: Model<Api>;
	readonly resourceLoader?: ResourceLoader;
	readonly baseToolDefinitions?: Record<string, ToolDefinition>;
	readonly toolResultImageNormalizer?: ToolResultImageNormalizer;
	readonly bashExecutor?: BashExecutor;
	readonly sessionExporter?: SessionExporter<SessionManagerContract>;
	readonly resetModelProviders?: () => void;

	/** The portable host must supply model/auth resolution and provider transport. */
	readonly modelRuntime: ModelRuntimeContract;
	readonly streamFn: StreamFn;

	/** In-memory owners are the default; inject owners to restore an existing tree. */
	readonly settingsManager?: SettingsManagerContract;
	readonly settings?: Partial<Settings>;
	readonly settingsManagerOptions?: SettingsManagerCreateOptions;
	readonly sessionManager?: SessionManagerContract;
	readonly sessionId?: string;

	/** Inline factories are used only when no resourceLoader is supplied. */
	readonly extensionFactories?: InlineExtension[];
	readonly extensionFactoryHost?: ExtensionFactoryHost;
	readonly agentDir?: string;
	readonly skillPaths?: string[];
	readonly promptPaths?: string[];
	readonly themePaths?: string[];
	readonly includeDefaults?: boolean;
	readonly agentsFiles?: Array<{ path: string; content: string }>;
	readonly systemPrompt?: string;
	readonly appendSystemPrompt?: string[];
}

/** Official SDK result shape. */
export interface CreateAgentSessionResult {
	session: AgentSession<ModelRuntimeContract, SessionManagerContract, SettingsManagerContract>;
	extensionsResult: LoadExtensionsResult;
	modelFallbackMessage?: string;
}

function unavailableExtensionFactoryHost(): ExtensionFactoryHost {
	return {
		exec: async () => {
			throw new Error("Extension exec capability is not available in the portable SDK runtime");
		},
	};
}

function createInlineResourceLoader(options: CreateAgentSessionOptions): ResourceLoader {
	const resourceLoaderOptions: InlineResourceLoaderOptions = {
		cwd: options.cwd,
		agentDir: options.agentDir ?? options.cwd,
		extensionFactoryHost: options.extensionFactoryHost ?? unavailableExtensionFactoryHost(),
		extensionFactories: options.extensionFactories ?? [],
		skillPaths: options.skillPaths,
		promptPaths: options.promptPaths,
		themePaths: options.themePaths,
		includeDefaults: options.includeDefaults,
		agentsFiles: options.agentsFiles,
		systemPrompt: options.systemPrompt,
		appendSystemPrompt: options.appendSystemPrompt,
	};
	return new InlineResourceLoader(resourceLoaderOptions);
}

const identityToolResultImageNormalizer: ToolResultImageNormalizer = async (content) => content;

/** Construct the native AgentSession from explicit portable host capabilities. */
export async function createAgentSession(options: CreateAgentSessionOptions): Promise<CreateAgentSessionResult> {
	const settingsManager =
		options.settingsManager ?? SettingsManager.inMemory(options.settings, options.settingsManagerOptions);
	const sessionManager =
		options.sessionManager ??
		new InMemorySessionManager(options.cwd, options.sessionId ? { id: options.sessionId } : undefined);
	if (options.initialMessages && sessionManager.buildSessionContext().messages.length > 0) {
		throw new Error("initialMessages cannot be combined with a non-empty sessionManager");
	}

	const resourceLoader = options.resourceLoader ?? createInlineResourceLoader(options);
	if (!options.resourceLoader) {
		await resourceLoader.reload();
	}

	const result = await createAgentSessionCore({
		...options,
		settingsManager,
		sessionManager,
		resourceLoader,
		hostCapabilities: {
			getBaseToolDefinitions: () => options.baseToolDefinitions ?? {},
			toolResultImageNormalizer: options.toolResultImageNormalizer ?? identityToolResultImageNormalizer,
			bashExecutor: options.bashExecutor,
			sessionExporter: options.sessionExporter,
			resetModelProviders: options.resetModelProviders,
		},
	});
	return result;
}

export {
	AgentSession,
	InMemorySettingsStorage,
	InMemorySessionManager,
	InlineResourceLoader,
	SettingsManager,
	createExtensionRuntime,
	bashToolSystemPromptContribution,
	editToolSystemPromptContribution,
	readToolSystemPromptContribution,
	writeToolSystemPromptContribution,
};

export type {
	Agent,
	AgentMessage,
	AgentSessionHostCapabilities,
	BashExecutor,
	ExtensionBindings,
	ExtensionFactory,
	ExtensionFactoryHost,
	InlineExtension,
	InlineResourceLoaderOptions,
	LoadExtensionsResult,
	Message,
	Model,
	ModelRuntimeContract,
	NewSessionOptions,
	ResourceLoader,
	SessionContext,
	SessionEntry,
	SessionManagerContract,
	SessionExporter,
	SessionHeader,
	SessionStartEvent,
	Settings,
	SettingsManagerCreateOptions,
	SettingsManagerContract,
	SettingsStorage,
	StreamFn,
	ThinkingLevel,
	ToolDefinition,
	ToolResultImageNormalizer,
};
