import { describe, expect, it } from "vitest";
import { ModelRegistry } from "../../src/core/model-registry.ts";
import type { ModelRuntimeContract } from "../../src/core/model-runtime-contract.ts";

const structuralRuntime = {
	refresh: async () => ({ aborted: false, errors: new Map() }),
	getError: () => undefined,
	getModels: () => [],
	getAvailableSnapshot: () => [],
	getModel: () => undefined,
	checkAuth: async () => undefined,
	hasConfiguredAuth: () => false,
	getAuth: async () => undefined,
	isUsingOAuth: () => false,
	getProviderAuthStatus: () => ({ configured: false }),
	getCompatibilityRequestConfig: () => ({ authHeader: false }),
	getProvider: () => undefined,
	complete: async () => {
		throw new Error("complete is not part of this structural test");
	},
	registerProvider: () => {},
	registerNativeProvider: () => {},
	unregisterProvider: () => {},
	getRegisteredProviderConfig: () => undefined,
	getRegisteredNativeProvider: () => undefined,
	getRegisteredProviderIds: () => [],
} satisfies ModelRuntimeContract;

describe("ModelRuntimeContract", () => {
	it("accepts a plain structural runtime in ModelRegistry", () => {
		const registry = new ModelRegistry(structuralRuntime);

		expect(registry.getAll()).toEqual([]);
		expect(registry.getAvailable()).toEqual([]);
		expect(registry.getError()).toBeUndefined();
	});
});
