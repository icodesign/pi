import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BashExecutor, SessionExporter, ToolResultImageNormalizer } from "../../src/core/agent-session.ts";
import { createHarness, type Harness } from "../suite/harness.ts";

const resultTool: AgentTool = {
	name: "result",
	label: "Result",
	description: "Return a tool result for capability normalization",
	parameters: Type.Object({}),
	execute: async () => ({
		content: [
			{ type: "text" as const, text: "before normalization" },
			{ type: "image" as const, data: "image-data", mimeType: "image/png" },
		],
		details: {},
	}),
};

function seedCompactableSession(harness: Harness): void {
	harness.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
	const model = harness.getModel();
	const now = Date.now();
	harness.sessionManager.appendMessage({
		role: "user",
		content: [{ type: "text", text: "message to compact" }],
		timestamp: now - 1000,
	});
	const assistant: AssistantMessage = {
		...fauxAssistantMessage("assistant response"),
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 100,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 100,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		timestamp: now - 500,
	};
	harness.sessionManager.appendMessage(assistant);
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

describe("AgentSession injected capabilities", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("passes session export arguments through and returns capability results", async () => {
		let htmlCall:
			| {
					manager: unknown;
					state: unknown;
					options: Parameters<SessionExporter["exportToHtml"]>[2];
			  }
			| undefined;
		let jsonlCall: { manager: unknown; outputPath: string | undefined } | undefined;
		const exporter: SessionExporter = {
			exportToHtml: async (manager, state, options) => {
				htmlCall = { manager, state, options };
				return "injected.html";
			},
			exportToJsonl: (manager, outputPath) => {
				jsonlCall = { manager, outputPath };
				return "injected.jsonl";
			},
		};
		const harness = await createHarness({ sessionExporter: exporter, tools: [resultTool] });
		harnesses.push(harness);

		await expect(harness.session.exportToHtml("requested.html", { themeName: "light" })).resolves.toBe(
			"injected.html",
		);
		expect(htmlCall).toMatchObject({
			manager: harness.sessionManager,
			state: harness.session.state,
			options: {
				outputPath: "requested.html",
				themeName: "light",
				settingsThemeName: harness.settingsManager.getTheme(),
				cwd: harness.sessionManager.getCwd(),
			},
		});
		expect(htmlCall?.options.getToolDefinition("result")).toMatchObject({ name: "result" });

		expect(harness.session.exportToJsonl("requested.jsonl")).toBe("injected.jsonl");
		expect(jsonlCall).toEqual({ manager: harness.sessionManager, outputPath: "requested.jsonl" });
	});

	it("passes the auto-resize setting to the image normalizer and persists its result", async () => {
		let normalizationCall:
			| { content: Parameters<ToolResultImageNormalizer>[0]; autoResizeImages: boolean | undefined }
			| undefined;
		const normalizer: ToolResultImageNormalizer = async (content, options) => {
			normalizationCall = { content, autoResizeImages: options?.autoResizeImages };
			return [{ type: "text", text: "normalized" }];
		};
		const harness = await createHarness({
			settings: { images: { autoResize: false } },
			tools: [resultTool],
			toolResultImageNormalizer: normalizer,
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("result", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run the result tool");

		expect(normalizationCall?.content).toEqual([
			{ type: "text", text: "before normalization" },
			{ type: "image", data: "image-data", mimeType: "image/png" },
		]);
		expect(normalizationCall?.autoResizeImages).toBe(false);
		expect(harness.session.messages).toContainEqual(
			expect.objectContaining({
				role: "toolResult",
				content: [{ type: "text", text: "normalized" }],
			}),
		);
	});

	it("delegates resolved bash execution to the injected capability", async () => {
		const invocations: Array<{ command: string; cwd: string; signal: AbortSignal }> = [];
		const chunks: string[] = [];
		const bashExecutor: BashExecutor = async (command, cwd, options) => {
			invocations.push({ command, cwd, signal: options.signal });
			options.onChunk("hello ");
			options.onChunk("from capability");
			return {
				output: "hello from capability",
				exitCode: 0,
				cancelled: false,
				truncated: false,
			};
		};
		const harness = await createHarness({
			settings: { shellCommandPrefix: "set -e", shellPath: "/bin/bash" },
			bashExecutor,
		});
		harnesses.push(harness);
		const eventUpdates: string[] = [];
		const unsubscribe = harness.session.subscribe((event) => {
			if (event.type === "bash_execution_update") {
				eventUpdates.push(event.delta);
			}
		});

		const result = await harness.session.executeBash("printf 'hello'", (chunk) => chunks.push(chunk), {
			id: "bash-1",
		});
		unsubscribe();

		expect(invocations).toHaveLength(1);
		expect(invocations[0]).toMatchObject({
			command: "set -e\nprintf 'hello'",
			cwd: harness.sessionManager.getCwd(),
		});
		expect(invocations[0]?.signal.aborted).toBe(false);
		expect(chunks).toEqual(["hello ", "from capability"]);
		expect(eventUpdates).toEqual(["hello ", "from capability"]);
		expect(result).toMatchObject({ output: "hello from capability", exitCode: 0, cancelled: false });
		expect(harness.session.messages[harness.session.messages.length - 1]).toMatchObject({
			role: "bashExecution",
			command: "printf 'hello'",
			output: "hello from capability",
			excludeFromContext: undefined,
		});
	});

	it("throws explicitly when session export capability is unavailable", async () => {
		const harness = await createHarness({ sessionExporter: null });
		harnesses.push(harness);

		await expect(harness.session.exportToHtml()).rejects.toThrow("Session export capability is not available");
		expect(() => harness.session.exportToJsonl()).toThrow("Session export capability is not available");
	});

	it("uses optional ambient auth by default", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);
		seedCompactableSession(harness);

		let requestApiKey: string | undefined = "not-observed";
		harness.session.agent.streamFunction = (_model, _context, options) => {
			requestApiKey = options?.apiKey;
			const stream = createAssistantMessageEventStream();
			stream.push({
				type: "done",
				reason: "stop",
				message: fauxAssistantMessage("ambient summary"),
			});
			return stream;
		};

		await expect(harness.session.compact()).resolves.toMatchObject({
			summary: expect.stringContaining("ambient summary"),
		});
		expect(requestApiKey).toBeUndefined();
	});

	it("invokes the injected provider reset callback during reload", async () => {
		const resetModelProviders = vi.fn();
		const harness = await createHarness({ resetModelProviders });
		harnesses.push(harness);

		await harness.session.reload();

		expect(resetModelProviders).toHaveBeenCalledTimes(1);
	});

	it("rebuilds built-in definitions from the host getter after settings reload", async () => {
		let getterCalls = 0;
		const harness = await createHarness({
			getBaseToolDefinitions: () => {
				getterCalls += 1;
				return {};
			},
		});
		harnesses.push(harness);

		expect(getterCalls).toBe(1);
		await harness.session.reload();
		expect(getterCalls).toBe(2);
	});

	it("uses base tool overrides without reintroducing built-ins", async () => {
		const harness = await createHarness({
			tools: [resultTool],
			extensionFactories: [
				(pi) =>
					pi.registerTool({
						name: "extension_custom",
						label: "Extension Custom",
						description: "A custom extension tool.",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
					}),
			],
		});
		harnesses.push(harness);

		const names = harness.session.getAllTools().map((tool) => tool.name);
		expect(names).toEqual(expect.arrayContaining(["result", "extension_custom"]));
		expect(names).not.toEqual(expect.arrayContaining(["read", "bash", "edit", "write"]));
	});
});
