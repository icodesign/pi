import { beforeEach, describe, expect, it, vi } from "vitest";
import { stream as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import type { AssistantMessageEvent, Context, Model } from "../src/types.ts";

const mockState = vi.hoisted(() => ({
	chunks: [] as unknown[],
	readCount: 0,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: () => {
					const stream = {
						async *[Symbol.asyncIterator]() {
							for (const chunk of mockState.chunks) {
								mockState.readCount += 1;
								yield chunk;
							}
						},
					};
					const promise = Promise.resolve(stream) as Promise<typeof stream> & {
						withResponse: () => Promise<{
							data: typeof stream;
							response: { status: number; headers: Headers };
						}>;
					};
					promise.withResponse = async () => ({
						data: stream,
						response: { status: 200, headers: new Headers() },
					});
					return promise;
				},
			},
		};
	}
	return { default: FakeOpenAI };
});

const context: Context = {
	messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
};

function model(provider: "deepseek" | "openai"): Model<"openai-completions"> {
	return {
		id: "test-model",
		name: "Test Model",
		api: "openai-completions",
		provider,
		baseUrl: provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 4096,
	};
}

async function eventsFor(provider: "deepseek" | "openai"): Promise<AssistantMessageEvent[]> {
	const events: AssistantMessageEvent[] = [];
	for await (const event of streamOpenAICompletions(model(provider), context, { apiKey: "test" })) {
		events.push(event);
	}
	return events;
}

describe("OpenAI completions lifecycle", () => {
	beforeEach(() => {
		mockState.chunks = [];
		mockState.readCount = 0;
	});

	it("ends thinking when answer text begins", async () => {
		mockState.chunks = [
			{ id: "chatcmpl-1", choices: [{ index: 0, delta: { reasoning_content: "plan" } }] },
			{ id: "chatcmpl-1", choices: [{ index: 0, delta: { content: "answer" } }] },
			{ id: "chatcmpl-1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
		];

		const events = await eventsFor("openai");

		expect(events.map((event) => event.type)).toEqual([
			"start",
			"thinking_start",
			"thinking_delta",
			"thinking_end",
			"text_start",
			"text_delta",
			"text_end",
			"done",
		]);
	});

	it("treats DeepSeek finish_reason as terminal after consuming its usage", async () => {
		mockState.chunks = [
			{ id: "chatcmpl-2", choices: [{ index: 0, delta: { content: "answer" } }] },
			{
				id: "chatcmpl-2",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
				usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
			},
			{ id: "must-not-be-read", choices: [{ index: 0, delta: { content: "late" } }] },
		];

		const events = await eventsFor("deepseek");
		const done = events.at(-1);

		expect(mockState.readCount).toBe(2);
		expect(done?.type).toBe("done");
		if (done?.type !== "done") throw new Error("expected a completed stream");
		expect(done.message.stopReason).toBe("stop");
		expect(done.message.usage.totalTokens).toBe(5);
	});

	it("keeps reading generic OpenAI streams for a separate usage chunk", async () => {
		mockState.chunks = [
			{ id: "chatcmpl-3", choices: [{ index: 0, delta: { content: "answer" } }] },
			{ id: "chatcmpl-3", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
			{
				id: "chatcmpl-3",
				choices: [],
				usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
			},
		];

		const events = await eventsFor("openai");
		const done = events.at(-1);

		expect(mockState.readCount).toBe(3);
		if (done?.type !== "done") throw new Error("expected a completed stream");
		expect(done.message.usage.totalTokens).toBe(6);
	});
});
