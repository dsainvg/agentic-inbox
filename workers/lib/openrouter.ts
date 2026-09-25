import { OpenRouter } from "@openrouter/sdk";
import type { Env } from "../types";

export type OpenRouterConfig = {
	apiKey: string;
	model: string;
	baseUrl?: string;
};

export const DEFAULT_OPENROUTER_MODEL = "openrouter/free";

export function getOpenRouterConfig(env: Pick<Env, "OPENROUTER_API_KEY" | "OPENROUTER_MODEL" | "OPENROUTER_BASE_URL">): OpenRouterConfig | undefined {
	const apiKey = env.OPENROUTER_API_KEY?.trim();
	const model = env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
	if (!apiKey) return undefined;
	return {
		apiKey,
		model,
		baseUrl: env.OPENROUTER_BASE_URL?.trim() || undefined,
	};
}

export function createOpenRouter(config: OpenRouterConfig): OpenRouter {
	return new OpenRouter({
		apiKey: config.apiKey,
		serverURL: config.baseUrl,
		appTitle: "Agentic Inbox",
		timeoutMs: 20_000,
		retryConfig: { strategy: "none" },
	});
}

function textContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part: any) => part?.type === "text" && typeof part.text === "string")
		.map((part: any) => part.text)
		.join("");
}

function toolResultContent(output: any): string {
	if (!output || typeof output !== "object") return String(output ?? "");
	return output.type === "json" ? JSON.stringify(output.value) : String(output.value ?? "");
}

function toChatMessages(prompt: any[]): any[] {
	const messages: any[] = [];
	for (const message of prompt) {
		if (message.role === "system") {
			messages.push({ role: "system", content: textContent(message.content) });
			continue;
		}
		if (message.role === "user") {
			messages.push({ role: "user", content: textContent(message.content) });
			continue;
		}
		if (message.role === "tool") {
			for (const part of message.content ?? []) {
				if (part?.type === "tool-result") {
					messages.push({
						role: "tool",
						toolCallId: part.toolCallId,
						content: toolResultContent(part.output),
					});
				}
			}
			continue;
		}
		if (message.role === "assistant") {
			const text = textContent(message.content);
			const toolCalls: any[] = [];
			for (const part of message.content ?? []) {
				if (part?.type === "tool-call") {
					toolCalls.push({
						id: part.toolCallId,
						type: "function",
						function: {
							name: part.toolName,
							arguments: JSON.stringify(part.input ?? {}),
						},
					});
				}
			}
			if (text || toolCalls.length > 0) {
				messages.push({ role: "assistant", content: text || null, tool_calls: toolCalls });
			}
		}
	}
	return messages;
}

function toTools(tools: any[] | undefined): any[] | undefined {
	const functions = (tools ?? [])
		.filter((tool: any) => tool?.type === "function")
		.map((tool: any) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.inputSchema,
				strict: tool.strict ?? false,
			},
		}));
	return functions.length > 0 ? functions : undefined;
}

function toToolChoice(toolChoice: any): any {
	if (!toolChoice) return undefined;
	if (toolChoice.type === "tool") return { type: "function", function: { name: toolChoice.toolName } };
	return toolChoice.type;
}

function mapFinishReason(reason: unknown): { unified: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other"; raw: string | undefined } {
	const raw = typeof reason === "string" ? reason : undefined;
	if (raw === "length" || raw === "max_tokens") return { unified: "length", raw };
	if (raw === "tool_calls" || raw === "function_call") return { unified: "tool-calls", raw };
	if (raw === "content_filter") return { unified: "content-filter", raw };
	if (raw === "stop" || raw === "end_turn") return { unified: "stop", raw };
	return { unified: raw ? "other" : "stop", raw };
}

function mapUsage(usage: any) {
	return {
		inputTokens: {
			total: usage?.promptTokens ?? usage?.prompt_tokens,
			noCache: usage?.promptTokens ?? usage?.prompt_tokens,
			cacheRead: usage?.cacheReadTokens ?? usage?.prompt_tokens_details?.cached_tokens,
			cacheWrite: usage?.cacheCreationTokens,
		},
		outputTokens: {
			total: usage?.completionTokens ?? usage?.completion_tokens,
			text: usage?.completionTokens ?? usage?.completion_tokens,
			reasoning: usage?.reasoningTokens,
		},
		raw: usage,
	};
}

function toGenerateContent(message: any): any[] {
	const content: any[] = [];
	if (typeof message?.content === "string" && message.content) {
		content.push({ type: "text", text: message.content });
	}
	for (const toolCall of message?.toolCalls ?? []) {
		content.push({
			type: "tool-call",
			toolCallId: toolCall.id,
			toolName: toolCall.function?.name ?? toolCall.name,
			input: typeof toolCall.function?.arguments === "string"
				? toolCall.function.arguments
				: JSON.stringify(toolCall.function?.arguments ?? {}),
		});
	}
	return content;
}

export class OpenRouterChatModel {
	readonly specificationVersion = "v3" as const;
	readonly provider = "openrouter";
	readonly modelId: string;
	readonly supportedUrls = {};
	private readonly client: OpenRouter;

	constructor(private readonly config: OpenRouterConfig) {
		this.modelId = config.model;
		this.client = createOpenRouter(config);
	}

	private request(options: any, stream: boolean) {
		return {
			chatRequest: {
				model: this.config.model,
				messages: toChatMessages(options.prompt),
				maxCompletionTokens: options.maxOutputTokens,
				temperature: options.temperature,
				topP: options.topP,
				stop: options.stopSequences,
				tools: toTools(options.tools),
				toolChoice: toToolChoice(options.toolChoice),
				stream,
			},
		};
	}

	async doGenerate(options: any) {
		const request = this.request(options, false);
		const result: any = await this.client.chat.send(request, { signal: options.abortSignal });
		const choice = result.choices?.[0];
		return {
			content: toGenerateContent(choice?.message),
			finishReason: mapFinishReason(choice?.finishReason),
			usage: mapUsage(result.usage),
			request: { body: request },
			response: {
				id: result.id,
				modelId: result.model,
				timestamp: result.created ? new Date(result.created * 1000) : undefined,
			},
			warnings: [],
		};
	}

	async doStream(options: any) {
		const request = this.request(options, true);
		const result: any = await this.client.chat.send(request, { signal: options.abortSignal });
		if (!result || typeof (result as any)[Symbol.asyncIterator] !== "function") {
			throw new Error("OpenRouter returned a non-streaming response");
		}

		const textId = `${this.modelId}:text`;
		const reasoningId = `${this.modelId}:reasoning`;
		const stream = new ReadableStream<any>({
			start: async (controller) => {
				let textStarted = false;
				let reasoningStarted = false;
				let finishReason: unknown = "stop";
				let usage: any;
				const tools = new Map<string, { id: string; name: string }>();
				controller.enqueue({ type: "stream-start", warnings: [] });
				try {
					for await (const chunk of result as AsyncIterable<any>) {
						if (chunk?.error) throw new Error(chunk.error.message || "OpenRouter stream failed");
						usage = chunk.usage ?? usage;
						for (const choice of chunk.choices ?? []) {
							const delta = choice.delta ?? {};
							if (typeof delta.content === "string" && delta.content) {
								if (!textStarted) {
									textStarted = true;
									controller.enqueue({ type: "text-start", id: textId });
								}
								controller.enqueue({ type: "text-delta", id: textId, delta: delta.content });
							}
							if (typeof delta.reasoning === "string" && delta.reasoning) {
								if (!reasoningStarted) {
									reasoningStarted = true;
									controller.enqueue({ type: "reasoning-start", id: reasoningId });
								}
								controller.enqueue({ type: "reasoning-delta", id: reasoningId, delta: delta.reasoning });
							}
							for (const toolCall of delta.toolCalls ?? []) {
								const key = String(toolCall.index ?? 0);
								let tool = tools.get(key);
								if (!tool) {
									tool = { id: toolCall.id || `${this.modelId}:tool:${key}`, name: toolCall.function?.name || "unknown" };
									tools.set(key, tool);
									controller.enqueue({ type: "tool-input-start", id: tool.id, toolName: tool.name });
								} else if (toolCall.function?.name && tool.name === "unknown") {
									tool.name = toolCall.function.name;
								}
								if (typeof toolCall.function?.arguments === "string" && toolCall.function.arguments) {
									controller.enqueue({ type: "tool-input-delta", id: tool.id, delta: toolCall.function.arguments });
								}
							}
							if (choice.finishReason) finishReason = choice.finishReason;
						}
					}
					if (reasoningStarted) controller.enqueue({ type: "reasoning-end", id: reasoningId });
					if (textStarted) controller.enqueue({ type: "text-end", id: textId });
					for (const tool of tools.values()) controller.enqueue({ type: "tool-input-end", id: tool.id });
					controller.enqueue({ type: "finish", finishReason: mapFinishReason(finishReason), usage: mapUsage(usage) });
				} catch (error) {
					controller.enqueue({ type: "error", error });
				}
				controller.close();
			},
		});
		return { stream, request: { body: request } };
	}
}
