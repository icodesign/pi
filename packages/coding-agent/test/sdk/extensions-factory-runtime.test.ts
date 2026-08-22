import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { createEventBus } from "../../src/core/event-bus.ts";
import {
	createExtensionRuntime,
	type ExtensionFactoryHost,
	loadExtensionFromFactory,
} from "../../src/core/extensions/factory.ts";

describe("portable extension factory runtime", () => {
	it("registers lifecycle handlers, tools, and commands with injected exec", async () => {
		const runtime = createExtensionRuntime();
		const eventBus = createEventBus();
		const execCalls: Array<{ command: string; args: string[]; cwd: string }> = [];
		const host: ExtensionFactoryHost = {
			exec: async (command, args, cwd) => {
				execCalls.push({ command, args, cwd });
				return { stdout: "host result", stderr: "", code: 0, killed: false };
			},
		};

		let execStdout: string | undefined;
		const extension = await loadExtensionFromFactory(
			async (pi) => {
				pi.on("agent_start", () => {});
				pi.registerTool({
					name: "portable_echo",
					label: "Portable Echo",
					description: "Echo a value from a portable extension.",
					parameters: Type.Object({ value: Type.String() }),
					execute: async (_toolCallId, params) => ({
						content: [{ type: "text", text: params.value }],
						details: undefined,
					}),
				});
				pi.registerCommand("portable-command", {
					description: "Run a portable command.",
					handler: async () => {},
				});
				execStdout = (await pi.exec("host-command", ["arg"], { cwd: "/workspace" })).stdout;
			},
			"/workspace",
			eventBus,
			runtime,
			"<inline:portable>",
			host,
		);

		expect(extension.handlers.get("agent_start")).toHaveLength(1);
		expect(extension.tools.has("portable_echo")).toBe(true);
		expect(extension.commands.get("portable-command")).toEqual(
			expect.objectContaining({ description: "Run a portable command." }),
		);
		expect(execStdout).toBe("host result");
		expect(execCalls).toEqual([{ command: "host-command", args: ["arg"], cwd: "/workspace" }]);
	});
});
