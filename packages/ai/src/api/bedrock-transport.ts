import type { Agent as HttpsAgent } from "node:https";
import type { BedrockRuntimeClientConfig } from "@aws-sdk/client-bedrock-runtime";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { ProviderEnv } from "../types.ts";
import { resolveHttpProxyUrlForTarget } from "../utils/node-http-proxy.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";

/**
 * Swaps the Bedrock client's transport for the Node-only cases the SDK cannot
 * express through configuration: an HTTP(S) proxy agent, or forcing HTTP/1.1.
 *
 * `package.json`'s `browser` and `react-native` maps replace this module with
 * `bedrock-transport.browser.ts`, so those bundles never reach
 * `@smithy/node-http-handler` or the proxy agents. That is the only part of
 * `bedrock-converse-stream.ts` that is Node-specific; everything else already
 * runs on the SDK's own `runtimeConfig.browser` / `runtimeConfig.native` build.
 */
export function applyBedrockTransportOverrides(
	config: BedrockRuntimeClientConfig,
	targetUrl: string,
	env?: ProviderEnv,
): void {
	const proxyUrl = resolveHttpProxyUrlForTarget(targetUrl, env);
	if (proxyUrl) {
		// Bedrock runtime uses NodeHttp2Handler by default since v3.798.0, which is based
		// on `http2` module and has no support for http agent.
		// Use NodeHttpHandler to support HTTP(S) proxy agents.
		config.requestHandler = new NodeHttpHandler({
			httpAgent: new HttpProxyAgent(proxyUrl),
			httpsAgent: new HttpsProxyAgent(proxyUrl) as unknown as HttpsAgent,
		});
	} else if (getProviderEnvValue("AWS_BEDROCK_FORCE_HTTP1", env) === "1") {
		// Some custom endpoints require HTTP/1.1 instead of HTTP/2
		config.requestHandler = new NodeHttpHandler();
	}
}
