import type { BedrockRuntimeClientConfig } from "@aws-sdk/client-bedrock-runtime";
import type { ProviderEnv } from "../types.ts";

/**
 * Browser and React Native replacement for `bedrock-transport.ts`, selected by
 * `package.json`'s `browser` and `react-native` maps.
 *
 * Both overrides in the Node version describe a transport that does not exist
 * here: there is no HTTP agent to attach a proxy to, and no HTTP/2 client to
 * downgrade. The client keeps the fetch transport that the SDK's
 * `runtimeConfig.browser` / `runtimeConfig.native` already installed, so proxy
 * env vars are ignored rather than treated as an error.
 */
export function applyBedrockTransportOverrides(
	_config: BedrockRuntimeClientConfig,
	_targetUrl: string,
	_env?: ProviderEnv,
): void {}
