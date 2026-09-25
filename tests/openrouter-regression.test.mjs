import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = process.cwd();

async function loadWorkerModule(entry) {
	const result = await build({
		absWorkingDir: root,
		entryPoints: [entry],
		bundle: true,
		write: false,
		format: "esm",
		platform: "node",
		target: "es2022",
	});
	return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("defaults to the OpenRouter free model router", async () => {
	const { getOpenRouterConfig } = await loadWorkerModule("workers/lib/openrouter.ts");
	assert.deepEqual(getOpenRouterConfig({ OPENROUTER_API_KEY: "test-key" }), {
		apiKey: "test-key",
		model: "openrouter/free",
		baseUrl: undefined,
	});
});

test("uses OpenRouter as the primary provider", async () => {
	const { runAiWithFallbacks } = await loadWorkerModule("workers/lib/ai.ts");
	const previousFetch = globalThis.fetch;
	let request;
	let cloudflareCalls = 0;
	globalThis.fetch = async (input, init) => {
		request = new Request(input, init);
		return new Response(JSON.stringify({
			id: "test-response",
			object: "chat.completion",
			created: 1,
			model: "openrouter/free",
			system_fingerprint: "test",
			choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "OpenRouter fallback text" } }],
		}), { status: 200, headers: { "content-type": "application/json" } });
	};

	try {
		const result = await runAiWithFallbacks(
			{ run: async () => { cloudflareCalls++; throw new Error("Workers AI unavailable"); } },
			{ messages: [{ role: "user", content: "Summarize this message" }] },
			["workers-ai-test-model"],
			{ apiKey: "test-key", model: "openrouter/free", baseUrl: "https://openrouter.test/api/v1" },
		);
		assert.equal(result.text, "OpenRouter fallback text");
		assert.equal(result.model, "openrouter/openrouter/free");
		assert.equal(cloudflareCalls, 0);
		assert.equal(request.headers.get("authorization"), "Bearer test-key");
		const body = await request.clone().json();
		assert.equal(body.model, "openrouter/free");
		assert.equal(body.messages.at(-1).content, "Summarize this message");
	} finally {
		globalThis.fetch = previousFetch;
	}
});

test("maps OpenRouter chat streams to AI SDK parts", async () => {
	const { OpenRouterChatModel } = await loadWorkerModule("workers/lib/openrouter.ts");
	const previousFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		const body = new ReadableStream({
			start(controller) {
				const encoder = new TextEncoder();
				controller.enqueue(encoder.encode(`data: ${JSON.stringify({
					id: "stream-1",
					object: "chat.completion.chunk",
					created: 1,
					model: "openrouter/free",
					choices: [{ index: 0, finish_reason: null, delta: { role: "assistant", content: "Hello" } }],
				})}\n\n`));
				controller.enqueue(encoder.encode(`data: ${JSON.stringify({
					id: "stream-2",
					object: "chat.completion.chunk",
					created: 1,
					model: "openrouter/free",
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
				})}\n\n`));
				controller.enqueue(encoder.encode("data: [DONE]\n\n"));
				controller.close();
			},
		});
		return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
	};

	try {
		const model = new OpenRouterChatModel({ apiKey: "test-key", model: "openrouter/free", baseUrl: "https://openrouter.test/api/v1" });
		const result = await model.doStream({
			prompt: [{ role: "user", content: [{ type: "text", text: "Say hello" }] }],
		});
		const parts = [];
		for await (const part of result.stream) parts.push(part);
		assert.equal(parts.at(-1).type, "finish");
		assert.equal(parts.find((part) => part.type === "text-delta").delta, "Hello");
	} finally {
		globalThis.fetch = previousFetch;
	}
});
