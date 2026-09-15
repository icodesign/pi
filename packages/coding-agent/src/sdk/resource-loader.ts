import { existsSync } from "node:fs";
import type { ResourceDiagnostic } from "../core/diagnostics.ts";
import { createEventBus, type EventBus } from "../core/event-bus.ts";
import {
	createExtensionRuntime,
	type ExtensionFactoryHost,
	loadExtensionFromFactory,
} from "../core/extensions/factory.ts";
import type { Extension, InlineExtension, LoadExtensionsResult } from "../core/extensions/types.ts";
import type { PromptTemplate } from "../core/prompt-templates.ts";
import { loadPromptTemplates } from "../core/prompt-templates.ts";
import type { ResourceExtensionPaths, ResourceLoader, ResourceLoaderReloadOptions } from "../core/resource-loader.ts";
import type { Skill } from "../core/skills.ts";
import { loadSkills } from "../core/skills.ts";
import type { Theme } from "../modes/interactive/theme/theme.ts";
import { canonicalizePath, resolvePath } from "../utils/paths.ts";

export type { ResourceDiagnostic } from "../core/diagnostics.ts";
export type { ResourceExtensionPaths, ResourceLoader, ResourceLoaderReloadOptions } from "../core/resource-loader.ts";

export interface InlineResourceLoaderOptions {
	cwd: string;
	agentDir: string;
	extensionFactoryHost: ExtensionFactoryHost;
	extensionFactories: InlineExtension[];
	eventBus?: EventBus;
	skillPaths?: string[];
	promptPaths?: string[];
	themePaths?: string[];
	/** Opt into Pi's default user/project directories; inline mode defaults to false. */
	includeDefaults?: boolean;
	agentsFiles?: Array<{ path: string; content: string }>;
	systemPrompt?: string;
	appendSystemPrompt?: string[];
}

const INLINE_THEME_WARNING = "Theme resources are not loaded by the inline resource loader";

/**
 * Resource loader for pre-bundled, non-interactive coding-agent runtimes.
 *
 * This keeps Pi's resource parsers and extension factory lifecycle while
 * leaving filesystem discovery, package resolution, Jiti, and TUI themes to
 * the Node/interactive loader.
 */
export class InlineResourceLoader implements ResourceLoader {
	private readonly cwd: string;
	private readonly agentDir: string;
	private readonly extensionFactoryHost: ExtensionFactoryHost;
	private readonly extensionFactories: InlineExtension[];
	private readonly eventBus: EventBus;
	private skillPaths: string[];
	private promptPaths: string[];
	private themePaths: string[];
	private readonly includeDefaults: boolean;
	private readonly agentsFiles: Array<{ path: string; content: string }>;
	private readonly systemPrompt?: string;
	private readonly appendSystemPrompt: string[];
	private extensionsResult: LoadExtensionsResult;
	private skills: Skill[];
	private skillDiagnostics: ResourceDiagnostic[];
	private prompts: PromptTemplate[];
	private promptDiagnostics: ResourceDiagnostic[];
	private themeDiagnostics: ResourceDiagnostic[];

	constructor(options: InlineResourceLoaderOptions) {
		this.cwd = resolvePath(options.cwd);
		this.agentDir = resolvePath(options.agentDir);
		this.extensionFactoryHost = options.extensionFactoryHost;
		this.extensionFactories = [...options.extensionFactories];
		this.eventBus = options.eventBus ?? createEventBus();
		this.skillPaths = this.mergePaths([], options.skillPaths ?? []);
		this.promptPaths = this.mergePaths([], options.promptPaths ?? []);
		this.themePaths = this.mergePaths([], options.themePaths ?? []);
		this.includeDefaults = options.includeDefaults ?? false;
		this.agentsFiles = [...(options.agentsFiles ?? [])];
		this.systemPrompt = options.systemPrompt;
		this.appendSystemPrompt = [...(options.appendSystemPrompt ?? [])];
		this.extensionsResult = {
			extensions: [],
			errors: [],
			runtime: createExtensionRuntime(),
		};
		this.skills = [];
		this.skillDiagnostics = [];
		this.prompts = [];
		this.promptDiagnostics = [];
		this.themeDiagnostics = [];
		this.refreshResources();
	}

	getExtensions(): LoadExtensionsResult {
		return this.extensionsResult;
	}

	getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
		return { skills: this.skills, diagnostics: this.skillDiagnostics };
	}

	getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] } {
		return { prompts: this.prompts, diagnostics: this.promptDiagnostics };
	}

	getThemes(): { themes: Theme[]; diagnostics: ResourceDiagnostic[] } {
		return { themes: [], diagnostics: this.themeDiagnostics };
	}

	getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> } {
		return { agentsFiles: this.agentsFiles };
	}

	getSystemPrompt(): string | undefined {
		return this.systemPrompt;
	}

	getSystemPromptSource(): { path: string } | undefined {
		return undefined;
	}

	getAppendSystemPrompt(): string[] {
		return this.appendSystemPrompt;
	}

	getAppendSystemPromptSources(): Array<{ path: string }> {
		return [];
	}

	extendResources(paths: ResourceExtensionPaths): void {
		if (paths.skillPaths && paths.skillPaths.length > 0) {
			this.skillPaths = this.mergePaths(
				this.skillPaths,
				paths.skillPaths.map((entry) => entry.path),
			);
		}
		if (paths.promptPaths && paths.promptPaths.length > 0) {
			this.promptPaths = this.mergePaths(
				this.promptPaths,
				paths.promptPaths.map((entry) => entry.path),
			);
		}
		if (paths.themePaths && paths.themePaths.length > 0) {
			this.themePaths = this.mergePaths(
				this.themePaths,
				paths.themePaths.map((entry) => entry.path),
			);
		}

		this.refreshResources();
	}

	async reload(_options?: ResourceLoaderReloadOptions): Promise<void> {
		const runtime = createExtensionRuntime();
		const extensions: Extension[] = [];
		const errors: Array<{ path: string; error: string }> = [];

		for (const [index, input] of this.extensionFactories.entries()) {
			const isNamed = typeof input !== "function";
			const factory = isNamed ? input.factory : input;
			const extensionPath = `<inline:${isNamed ? input.name : index + 1}>`;
			try {
				const extension = await loadExtensionFromFactory(
					factory,
					this.cwd,
					this.eventBus,
					runtime,
					extensionPath,
					this.extensionFactoryHost,
				);
				extension.hidden = isNamed ? input.hidden : undefined;
				extensions.push(extension);
			} catch (error) {
				const message = error instanceof Error ? error.message : "failed to load extension";
				errors.push({ path: extensionPath, error: message });
			}
		}

		this.extensionsResult = { extensions, errors, runtime };
		this.refreshResources();
	}

	private refreshResources(): void {
		const skills = loadSkills({
			cwd: this.cwd,
			agentDir: this.agentDir,
			skillPaths: this.skillPaths,
			includeDefaults: this.includeDefaults,
		});
		this.skills = skills.skills;
		this.skillDiagnostics = this.withMissingPathDiagnostics(skills.diagnostics, this.skillPaths, "Skill");

		const loadedPrompts = loadPromptTemplates({
			cwd: this.cwd,
			agentDir: this.agentDir,
			promptPaths: this.promptPaths,
			includeDefaults: this.includeDefaults,
		});
		this.prompts = loadedPrompts;
		this.promptDiagnostics = this.withMissingPathDiagnostics([], this.promptPaths, "Prompt template");
		this.themeDiagnostics = this.themePaths.map((path) => ({
			type: "warning",
			message: INLINE_THEME_WARNING,
			path,
		}));
	}

	private withMissingPathDiagnostics(
		diagnostics: ResourceDiagnostic[],
		paths: string[],
		label: string,
	): ResourceDiagnostic[] {
		const result = [...diagnostics];
		for (const path of paths) {
			if (result.some((diagnostic) => diagnostic.path === path) || existsSync(path)) continue;
			result.push({ type: "warning", message: `${label} path does not exist`, path });
		}
		return result;
	}

	private mergePaths(primary: string[], additional: string[]): string[] {
		const merged: string[] = [];
		const seen = new Set<string>();
		for (const path of [...primary, ...additional]) {
			const resolved = resolvePath(path, this.cwd, { trim: true });
			const canonical = canonicalizePath(resolved);
			if (seen.has(canonical)) continue;
			seen.add(canonical);
			merged.push(resolved);
		}
		return merged;
	}
}
