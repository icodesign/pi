import { describe, expect, it } from "vitest";
import { InMemorySettingsStorage, type Settings, SettingsManager } from "../../src/core/settings/manager-core.ts";

describe("portable SettingsManager core", () => {
	it("keeps defaults and applies legacy migrations without Node file storage", () => {
		const manager = SettingsManager.inMemory({
			queueMode: "all",
			websockets: true,
			skills: {
				enableSkillCommands: false,
				customDirectories: [".skills"],
			},
			retry: { maxDelayMs: 1234 },
		} as unknown as Partial<Settings>);

		expect(manager.getSteeringMode()).toBe("all");
		expect(manager.getTransport()).toBe("websocket");
		expect(manager.getSkillPaths()).toEqual([".skills"]);
		expect(manager.getEnableSkillCommands()).toBe(false);
		expect(manager.getProviderRetrySettings().maxRetryDelayMs).toBe(1234);

		const defaults = SettingsManager.inMemory();
		expect(defaults.getCompactionSettings()).toEqual({
			enabled: true,
			reserveTokens: 16384,
			keepRecentTokens: 20000,
		});
		expect(defaults.getRetrySettings()).toEqual({ enabled: true, maxRetries: 3, baseDelayMs: 2000 });
	});

	it("writes and reloads through the same storage abstraction", async () => {
		const storage = new InMemorySettingsStorage();
		const manager = SettingsManager.fromStorage(storage);

		manager.setDefaultModelAndProvider("openai", "gpt-5");
		manager.setCompactionEnabled(false);
		manager.setProjectExtensionPaths([".pi/extensions"]);
		await manager.flush();

		const reloaded = SettingsManager.fromStorage(storage);
		expect(reloaded.getDefaultProvider()).toBe("openai");
		expect(reloaded.getDefaultModel()).toBe("gpt-5");
		expect(reloaded.getCompactionEnabled()).toBe(false);
		expect(reloaded.getExtensionPaths()).toEqual([".pi/extensions"]);
	});
});
