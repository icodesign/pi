import { getAgentDir } from "../config.ts";
import { FileSettingsStorage } from "./settings/file-storage.ts";
import {
	SettingsManager as CoreSettingsManager,
	InMemorySettingsStorage,
	type Settings,
	type SettingsManagerCreateOptions,
	type SettingsStorage,
} from "./settings/manager-core.ts";

export { FileSettingsStorage } from "./settings/file-storage.ts";
export type {
	BranchSummarySettings,
	CompactionSettings,
	DefaultProjectTrust,
	FullscreenExitOutput,
	ImageSettings,
	MarkdownSettings,
	MermaidRenderingMode,
	PackageSource,
	ProviderRetrySettings,
	RetrySettings,
	Settings,
	SettingsError,
	SettingsManagerCreateOptions,
	SettingsScope,
	SettingsStorage,
	TerminalSettings,
	ThinkingBudgetsSettings,
	TransportSetting,
	TuiMode,
	WarningSettings,
} from "./settings/manager-core.ts";
export { InMemorySettingsStorage } from "./settings/manager-core.ts";

export class SettingsManager extends CoreSettingsManager {
	/** Create a SettingsManager that loads from Node file storage. */
	static create(
		cwd: string,
		agentDir: string = getAgentDir(),
		options: SettingsManagerCreateOptions = {},
	): SettingsManager {
		return SettingsManager.fromStorage(new FileSettingsStorage(cwd, agentDir), options);
	}

	/** Create a SettingsManager from an arbitrary storage backend. */
	static fromStorage(storage: SettingsStorage, options: SettingsManagerCreateOptions = {}): SettingsManager {
		const state = SettingsManager.loadState(storage, options);
		return new SettingsManager(
			storage,
			state.globalSettings,
			state.projectSettings,
			state.globalLoadError,
			state.projectLoadError,
			state.initialErrors,
			state.projectTrusted,
		);
	}

	/** Create an in-memory SettingsManager (no file I/O). */
	static inMemory(settings: Partial<Settings> = {}, options: SettingsManagerCreateOptions = {}): SettingsManager {
		const storage = new InMemorySettingsStorage();
		const initialSettings = SettingsManager.migrateSettings(structuredClone(settings) as Record<string, unknown>);
		storage.withLock("global", () => JSON.stringify(initialSettings, null, 2));
		return SettingsManager.fromStorage(storage, options);
	}
}
