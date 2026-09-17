import { wrapLanguageModel } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { CLOUDFLARE_AI_MODELS } from "./ai";

/** Retry only stream establishment, never a partially delivered tool/text stream. */
export function createChatModel(ai: Ai) {
	const provider = createWorkersAI({ binding: {
		// Keep non-serializable SDK options (notably AbortSignal) off the AI RPC boundary.
		// Cancellation is enforced by the SDK and startup race below.
		run: async (model: string, inputs: unknown) => {
			const response = await ai.run(model as any, JSON.parse(JSON.stringify(inputs)));
			if (!(response instanceof ReadableStream)) return response;
			return normalizeAiStream(response);
		},
	} as Ai });
	// Keep chat fallbacks tool-capable; the smaller text-only fallbacks are unsuitable.
	const models = [CLOUDFLARE_AI_MODELS.PRIMARY, CLOUDFLARE_AI_MODELS.FALLBACKS[0]];
	return wrapLanguageModel({
		model: provider(models[0] as any),
		middleware: {
			specificationVersion: "v3",
			wrapStream: async ({ params }) => {
				for (const [index, modelId] of models.entries()) {
					params.abortSignal?.throwIfAborted();
					const controller = new AbortController();
					const signal = params.abortSignal
						? AbortSignal.any([params.abortSignal, controller.signal])
						: controller.signal;
					let timer: ReturnType<typeof setTimeout> | undefined;
					let onAbort: (() => void) | undefined;
					try {
						return await Promise.race([
							provider(modelId as any).doStream({ ...params, abortSignal: signal }),
							new Promise<never>((_, reject) => {
								onAbort = () => reject(signal.reason);
								signal.addEventListener("abort", onAbort, { once: true });
								if (signal.aborted) onAbort();
								timer = setTimeout(() => controller.abort(new Error("AI stream startup timed out")), 20_000);
							}),
						]);
					} catch (error) {
						console.error("[Chat startup failure]", {
							model: modelId,
							message: error instanceof Error ? error.message : String(error),
							stack: error instanceof Error ? error.stack : undefined,
						});
						params.abortSignal?.throwIfAborted();
						if (index === models.length - 1) throw error;
						console.warn(`[Chat] Model ${modelId} failed before streaming; trying fallback.`);
					} finally {
						clearTimeout(timer);
						if (onAbort) signal.removeEventListener("abort", onAbort);
					}
				}
				throw new Error("No chat models configured");
			},
		},
	});
}

/** Workers AI may send native and OpenAI text in the same SSE event. Emit it once. */
export function normalizeAiStream(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
	let pending = "";
	const normalizeLine = (line: string) => {
		if (!line.startsWith("data:")) return line;
		try {
			const chunk = JSON.parse(line.slice(5).trim());
			if (typeof chunk.choices?.[0]?.delta?.content === "string") delete chunk.response;
			return `data: ${JSON.stringify(chunk)}`;
		} catch { return line; }
	};
	const decoder = new TextDecoder();
	return stream.pipeThrough(new TransformStream<Uint8Array, string>({
		transform(bytes, controller) { controller.enqueue(decoder.decode(bytes, { stream: true })); },
		flush(controller) { controller.enqueue(decoder.decode()); },
	})).pipeThrough(new TransformStream<string, string>({
		transform(text, controller) {
			pending += text;
			let end: number;
			while ((end = pending.indexOf("\n")) !== -1) {
				controller.enqueue(normalizeLine(pending.slice(0, end).replace(/\r$/, "")) + "\n");
				pending = pending.slice(end + 1);
			}
		},
		flush(controller) { if (pending) controller.enqueue(normalizeLine(pending)); },
	})).pipeThrough(new TextEncoderStream());
}

