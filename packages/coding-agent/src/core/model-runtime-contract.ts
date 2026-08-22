import type {
	Api,
	AssistantMessage,
	AuthCheck,
	AuthOperationOptions,
	AuthResult,
	Context,
	Model,
	ModelsApiStreamOptions,
	ModelsRefreshOptions,
	ModelsRefreshResult,
	Provider,
	ProviderHeaders,
} from "@earendil-works/pi-ai";
import type { AuthStatus, ProviderConfigInput } from "./provider-composer.ts";

/**
 * Auth overrides accepted by the coding-agent model runtime.
 *
 * This is intentionally structural so a host can provide auth resolution
 * without constructing the Node ModelRuntime implementation.
 */
export interface ModelRuntimeContractAuthOverrides extends AuthOperationOptions {
	apiKey?: string;
	env?: Record<string, string>;
	minOAuthValidityMs?: number;
}

/** Compatibility metadata used when a provider has no resolved auth. */
export interface ModelRuntimeCompatibilityRequestConfig {
	headers?: ProviderHeaders;
	authHeader: boolean;
}

/**
 * Structural model/auth surface consumed by AgentSession and extensions.
 *
 * The concrete Node ModelRuntime satisfies this contract, but the contract
 * deliberately carries no implementation state or class-private fields so a
 * headless host can inject an equivalent runtime.
 */
export interface ModelRuntimeContract {
	refresh(options?: ModelsRefreshOptions): Promise<ModelsRefreshResult>;
	getError(): string | undefined;
	getModels(providerId?: string): readonly Model<Api>[];
	getAvailableSnapshot(): readonly Model<Api>[];
	getModel(providerId: string, modelId: string): Model<Api> | undefined;
	checkAuth(providerId: string, options?: AuthOperationOptions): Promise<AuthCheck | undefined>;
	hasConfiguredAuth(providerId: string): boolean;

	getAuth(providerId: string, overrides?: ModelRuntimeContractAuthOverrides): Promise<AuthResult | undefined>;
	getAuth(model: Model<Api>, overrides?: ModelRuntimeContractAuthOverrides): Promise<AuthResult | undefined>;
	isUsingOAuth(providerId: string): boolean;
	getProviderAuthStatus(providerId: string): AuthStatus;
	getCompatibilityRequestConfig(model: Model<Api>): ModelRuntimeCompatibilityRequestConfig;

	getProvider(providerId: string): Provider | undefined;
	complete<TApi extends Api>(
		model: Model<TApi>,
		context: Context,
		options?: ModelsApiStreamOptions<TApi>,
	): Promise<AssistantMessage>;

	registerProvider(providerId: string, config: ProviderConfigInput): void;
	registerNativeProvider(provider: Provider): void;
	unregisterProvider(providerId: string): void;
	getRegisteredProviderConfig(providerId: string): ProviderConfigInput | undefined;
	getRegisteredNativeProvider(providerId: string): Provider | undefined;
	getRegisteredProviderIds(): readonly string[];
}
