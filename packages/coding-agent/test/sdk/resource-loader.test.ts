import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventBus } from "../../src/core/event-bus.ts";
import type { ExtensionFactoryHost } from "../../src/core/extensions/factory.ts";
import { InlineResourceLoader } from "../../src/sdk/resource-loader.ts";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function createFixture(): { cwd: string; agentDir: string; skillsDir: string; promptsDir: string } {
	const root = mkdtempSync(join(tmpdir(), "pi-sdk-resource-"));
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	const skillsDir = join(root, "skills");
	const promptsDir = join(root, "prompts");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(skillsDir, { recursive: true });
	mkdirSync(promptsDir, { recursive: true });
	tempDirectories.push(root);
	return { cwd, agentDir, skillsDir, promptsDir };
}

function createHost(): ExtensionFactoryHost {
	return {
		exec: vi.fn(async () => ({ stdout: "", stderr: "", code: 0, killed: false })),
	};
}

describe("InlineResourceLoader", () => {
	it("loads named factories with tools, handlers, errors, and a fresh runtime on reload", async () => {
		const fixture = createFixture();
		const eventBus = createEventBus();
		let loads = 0;
		const loader = new InlineResourceLoader({
			cwd: fixture.cwd,
			agentDir: fixture.agentDir,
			extensionFactoryHost: createHost(),
			eventBus,
			extensionFactories: [
				{
					name: "sdk-tools",
					hidden: true,
					factory: (pi) => {
						loads += 1;
						pi.on("agent_start", () => {});
						pi.registerTool({
							name: "sdk_echo",
							label: "SDK Echo",
							description: "A test tool.",
							parameters: Type.Object({ value: Type.String() }),
							execute: async (_toolCallId, params) => ({
								content: [{ type: "text", text: params.value }],
								details: undefined,
							}),
						});
					},
				},
				() => {
					throw new Error("factory exploded");
				},
			],
		});

		await loader.reload();
		const first = loader.getExtensions();
		expect(first.extensions).toHaveLength(1);
		expect(first.extensions[0]).toEqual(expect.objectContaining({ path: "<inline:sdk-tools>", hidden: true }));
		expect(first.extensions[0].handlers.get("agent_start")).toHaveLength(1);
		expect(first.extensions[0].tools.has("sdk_echo")).toBe(true);
		expect(first.errors).toEqual([{ path: "<inline:2>", error: "factory exploded" }]);

		const firstRuntime = first.runtime;
		await loader.reload();
		expect(loads).toBe(2);
		expect(loader.getExtensions().runtime).not.toBe(firstRuntime);
		expect(loader.getExtensions().extensions[0].path).toBe("<inline:sdk-tools>");
	});

	it("uses Pi skill and prompt loaders and refreshes synchronously with deduplicated paths", () => {
		const fixture = createFixture();
		const skillDir = join(fixture.skillsDir, "demo-skill");
		mkdirSync(skillDir);
		writeFileSync(join(skillDir, "SKILL.md"), "---\nname: demo-skill\ndescription: Demo skill\n---\nUse it.\n");
		const promptPath = join(fixture.promptsDir, "demo.md");
		writeFileSync(promptPath, "---\ndescription: Demo prompt\n---\nPrompt body\n");

		const loader = new InlineResourceLoader({
			cwd: fixture.cwd,
			agentDir: fixture.agentDir,
			extensionFactoryHost: createHost(),
			extensionFactories: [],
			skillPaths: [skillDir, `${skillDir}/.`],
			promptPaths: [promptPath, promptPath],
		});

		expect(loader.getSkills().skills.map((skill) => skill.name)).toEqual(["demo-skill"]);
		expect(loader.getPrompts().prompts.map((prompt) => prompt.name)).toEqual(["demo"]);

		const extraSkillDir = join(fixture.skillsDir, "extra-skill");
		mkdirSync(extraSkillDir);
		writeFileSync(join(extraSkillDir, "SKILL.md"), "---\nname: extra-skill\ndescription: Extra skill\n---\nExtra.\n");
		const extraPromptPath = join(fixture.promptsDir, "extra.md");
		writeFileSync(extraPromptPath, "---\ndescription: Extra prompt\n---\nExtra prompt body\n");
		loader.extendResources({
			skillPaths: [{ path: extraSkillDir, metadata: { source: "test", scope: "temporary", origin: "top-level" } }],
			promptPaths: [
				{ path: extraPromptPath, metadata: { source: "test", scope: "temporary", origin: "top-level" } },
			],
			themePaths: [
				{ path: "themes/sdk.json", metadata: { source: "test", scope: "temporary", origin: "top-level" } },
			],
		});
		expect(loader.getSkills().skills.map((skill) => skill.name)).toEqual(["demo-skill", "extra-skill"]);
		expect(loader.getPrompts().prompts.map((prompt) => prompt.name)).toEqual(["demo", "extra"]);
		expect(loader.getThemes().diagnostics).toEqual([
			expect.objectContaining({
				type: "warning",
				message: "Theme resources are not loaded by the inline resource loader",
				path: join(fixture.cwd, "themes/sdk.json"),
			}),
		]);
	});

	it("reports every missing explicit skill and prompt path once", () => {
		const fixture = createFixture();
		const missingSkill = join(fixture.cwd, "missing-skill");
		const missingPrompt = join(fixture.cwd, "missing-prompt.md");
		const loader = new InlineResourceLoader({
			cwd: fixture.cwd,
			agentDir: fixture.agentDir,
			extensionFactoryHost: createHost(),
			extensionFactories: [],
			skillPaths: [missingSkill, missingSkill],
			promptPaths: [missingPrompt, missingPrompt],
		});

		expect(loader.getSkills().diagnostics).toEqual([
			{ type: "warning", message: "skill path does not exist", path: missingSkill },
		]);
		expect(loader.getPrompts().diagnostics).toEqual([
			{ type: "warning", message: "Prompt template path does not exist", path: missingPrompt },
		]);
	});

	it("returns supplied context and an explicit warning for inline themes", () => {
		const fixture = createFixture();
		const loader = new InlineResourceLoader({
			cwd: fixture.cwd,
			agentDir: fixture.agentDir,
			extensionFactoryHost: createHost(),
			extensionFactories: [],
			themePaths: ["themes/custom.json"],
			agentsFiles: [{ path: "AGENTS.md", content: "Context" }],
			systemPrompt: "System prompt",
			appendSystemPrompt: ["Append one"],
		});

		expect(loader.getThemes()).toEqual({
			themes: [],
			diagnostics: [
				{
					type: "warning",
					message: "Theme resources are not loaded by the inline resource loader",
					path: join(fixture.cwd, "themes/custom.json"),
				},
			],
		});
		expect(loader.getAgentsFiles().agentsFiles).toEqual([{ path: "AGENTS.md", content: "Context" }]);
		expect(loader.getSystemPrompt()).toBe("System prompt");
		expect(loader.getAppendSystemPrompt()).toEqual(["Append one"]);
		expect(loader.getSystemPromptSource()).toBeUndefined();
		expect(loader.getAppendSystemPromptSources()).toEqual([]);
	});
});
