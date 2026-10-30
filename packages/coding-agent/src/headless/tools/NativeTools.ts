/**
 * Native tool schemas and executors for provider-specific tools.
 *
 * These tools are injected into the agent's tool registry based on the model's provider.
 * They call the provider's native APIs directly (e.g., OpenAI's web_search_preview).
 */

/** OpenAI function schema format */
interface ToolSchema {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

/** Result from native tool execution */
export interface NativeToolResult {
	success: boolean;
	content: string;
	error?: string;
	metadata?: Record<string, unknown>;
}

export interface NativeTool {
	schema: ToolSchema;
	executor: NativeToolExecutor;
	provider: string;
}

export interface NativeToolExecutor {
	execute(args: Record<string, unknown>, context: NativeToolContext): Promise<NativeToolResult>;
}

export interface NativeToolContext {
	modelId: string;
	provider: string;
	apiKey: string;
	baseURL?: string;
	signal: AbortSignal;
	turnNumber: number;
}

/**
 * Get native tools for a specific provider
 */
export function getNativeToolsForProvider(provider: string): NativeTool[] {
	switch (provider) {
		case "openai":
			return [
				{ schema: webSearchPreviewSchema, executor: new OpenAIWebSearchExecutor(), provider: "openai" },
				{ schema: codeInterpreterSchema, executor: new OpenAICodeInterpreterExecutor(), provider: "openai" },
			];
		case "anthropic":
			return [
				{ schema: anthropicWebSearchSchema, executor: new AnthropicWebSearchExecutor(), provider: "anthropic" },
			];
		case "google":
			return [{ schema: googleSearchSchema, executor: new GoogleSearchExecutor(), provider: "google" }];
		case "xai":
			return [{ schema: xaiWebSearchSchema, executor: new XAIWebSearchExecutor(), provider: "xai" }];
		default:
			return [];
	}
}

/**
 * Get native tool schemas for a provider (for registration in tool registry)
 */
export function getNativeToolSchemasForProvider(provider: string): ToolSchema[] {
	return getNativeToolsForProvider(provider).map((t) => t.schema);
}

/**
 * Execute a native tool by name
 */
export async function executeNativeTool(
	provider: string,
	toolName: string,
	args: Record<string, unknown>,
	context: NativeToolContext,
): Promise<NativeToolResult | null> {
	const tools = getNativeToolsForProvider(provider);
	const tool = tools.find((t) => t.schema.function.name === toolName);
	if (!tool) return null;

	return tool.executor.execute(args, context);
}

// ============================================================================
// OpenAI Native Tools
// ============================================================================

export const webSearchPreviewSchema: ToolSchema = {
	type: "function",
	function: {
		name: "web_search_preview",
		description:
			"Search the web for real-time information. Use for fact-finding, current events, documentation, and research.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search query. Be specific and use relevant keywords." },
				search_context_size: {
					type: "string",
					enum: ["low", "medium", "high"],
					description: "Context size: low=fast/cheap, medium=balanced, high=comprehensive",
					default: "medium",
				},
			},
			required: ["query"],
			additionalProperties: false,
		},
	},
};

export const codeInterpreterSchema: ToolSchema = {
	type: "function",
	function: {
		name: "code_interpreter",
		description:
			"Execute Python code in a sandboxed environment. Use for calculations, data analysis, visualization, and code execution.",
		parameters: {
			type: "object",
			properties: {
				code: { type: "string", description: "Python code to execute" },
			},
			required: ["code"],
			additionalProperties: false,
		},
	},
};

class OpenAIWebSearchExecutor implements NativeToolExecutor {
	async execute(
		args: { query: string; search_context_size?: "low" | "medium" | "high" },
		context: NativeToolContext,
	): Promise<NativeToolResult> {
		const { OpenAI } = await import("openai");

		const client = new OpenAI({
			apiKey: context.apiKey,
			baseURL: context.baseURL,
		});

		try {
			const response = await client.responses.create(
				{
					model: context.modelId,
					input: args.query,
					tools: [{ type: "web_search_preview", search_context_size: args.search_context_size || "medium" }],
				},
				{ signal: context.signal },
			);

			// Extract citations from annotations
			const citations = response.output
				.flatMap((output: any) => (output.type === "message" ? output.content : []))
				.flatMap((content: any) => (content.type === "output_text" ? content.annotations || [] : []))
				.filter(
					(
						annotation: any,
					): annotation is {
						type: "url_citation";
						title: string;
						url: string;
						start_index: number;
						end_index: number;
					} => annotation.type === "url_citation",
				)
				.map((annotation: any) => ({
					title: annotation.title,
					url: annotation.url,
					domain: new URL(annotation.url).hostname,
				}));

			// Get the text output
			const outputText = response.output_text || "";

			return {
				success: true,
				content: outputText,
				metadata: {
					citations,
					searches_used: 1,
					provider: "openai",
					tool: "web_search_preview",
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				content: "",
				error: `web_search_preview failed: ${message}`,
				metadata: { provider: "openai", tool: "web_search_preview" },
			};
		}
	}
}

class OpenAICodeInterpreterExecutor implements NativeToolExecutor {
	async execute(args: { code: string }, context: NativeToolContext): Promise<NativeToolResult> {
		const { OpenAI } = await import("openai");

		const client = new OpenAI({
			apiKey: context.apiKey,
			baseURL: context.baseURL,
		});

		try {
			const response = await client.responses.create(
				{
					model: context.modelId,
					input: args.code,
					tools: [{ type: "code_interpreter", container: { type: "auto" } }],
				},
				{ signal: context.signal },
			);

			const outputText = response.output_text || "";
			return {
				success: true,
				content: outputText,
				metadata: { provider: "openai", tool: "code_interpreter" },
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				content: "",
				error: `code_interpreter failed: ${message}`,
				metadata: { provider: "openai", tool: "code_interpreter" },
			};
		}
	}
}

// ============================================================================
// Anthropic Native Tools
// ============================================================================

export const anthropicWebSearchSchema: ToolSchema = {
	type: "function",
	function: {
		name: "web_search",
		description: "Search the web for real-time information using Anthropic's web search tool.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search query" },
			},
			required: ["query"],
			additionalProperties: false,
		},
	},
};

class AnthropicWebSearchExecutor implements NativeToolExecutor {
	async execute(args: { query: string }, context: NativeToolContext): Promise<NativeToolResult> {
		const { Anthropic } = await import("@anthropic-ai/sdk");

		const client = new Anthropic({
			apiKey: context.apiKey,
			baseURL: context.baseURL,
		});

		try {
			const response: any = await client.messages.create(
				{
					model: context.modelId,
					max_tokens: 4096,
					messages: [{ role: "user", content: args.query }],
					tools: [{ type: "web_search_20240305", name: "web_search" }] as any,
				},
				{ signal: context.signal },
			);

			const toolUse = response.content.find((c: any) => c.type === "tool_use");
			const resultText = toolUse?.input?.result || "";
			const citations = this.extractCitations(response);

			return {
				success: true,
				content: resultText,
				metadata: {
					citations,
					searches_used: 1,
					provider: "anthropic",
					tool: "web_search",
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				content: "",
				error: `web_search failed: ${message}`,
				metadata: { provider: "anthropic", tool: "web_search" },
			};
		}
	}

	private extractCitations(response: any): Array<{ title: string; url: string; domain: string }> {
		const citations: Array<{ title: string; url: string; domain: string }> = [];
		for (const content of response.content || []) {
			if (content.citations) {
				for (const citation of content.citations) {
					try {
						citations.push({
							title: citation.title,
							url: citation.url,
							domain: new URL(citation.url).hostname,
						});
					} catch {
						// Invalid URL, skip
					}
				}
			}
		}
		return citations;
	}
}

// ============================================================================
// Google Native Tools
// ============================================================================

export const googleSearchSchema: ToolSchema = {
	type: "function",
	function: {
		name: "google_search",
		description: "Search the web using Google Search.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search query" },
			},
			required: ["query"],
			additionalProperties: false,
		},
	},
};

class GoogleSearchExecutor implements NativeToolExecutor {
	async execute(args: { query: string }, context: NativeToolContext): Promise<NativeToolResult> {
		const { GoogleGenerativeAI } = await import("@google/generative-ai");

		const genAI = new GoogleGenerativeAI(context.apiKey);
		const model = genAI.getGenerativeModel({ model: context.modelId });

		try {
			const result: any = await model.generateContent(
				{
					contents: [{ role: "user", parts: [{ text: args.query }] }],
					tools: [{ googleSearch: {} }] as any,
				},
				{ signal: context.signal },
			);

			const response = result.response;
			const text = response.text();
			const citations = this.extractCitations(response);

			return {
				success: true,
				content: text,
				metadata: {
					citations,
					searches_used: 1,
					provider: "google",
					tool: "google_search",
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				content: "",
				error: `google_search failed: ${message}`,
				metadata: { provider: "google", tool: "google_search" },
			};
		}
	}

	private extractCitations(response: any): Array<{ title: string; url: string; domain: string }> {
		const citations: Array<{ title: string; url: string; domain: string }> = [];
		for (const candidate of response.candidates || []) {
			if (candidate.groundingMetadata?.groundingChunks) {
				for (const chunk of candidate.groundingMetadata.groundingChunks) {
					if (chunk.web) {
						try {
							citations.push({
								title: chunk.web.title,
								url: chunk.web.uri,
								domain: new URL(chunk.web.uri).hostname,
							});
						} catch {
							// Invalid URL, skip
						}
					}
				}
			}
		}
		return citations;
	}
}

// ============================================================================
// xAI Native Tools
// ============================================================================

export const xaiWebSearchSchema: ToolSchema = {
	type: "function",
	function: {
		name: "web_search",
		description: "Search the web using xAI's web search tool.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search query" },
			},
			required: ["query"],
			additionalProperties: false,
		},
	},
};

class XAIWebSearchExecutor implements NativeToolExecutor {
	async execute(args: { query: string }, context: NativeToolContext): Promise<NativeToolResult> {
		// xAI uses OpenAI-compatible API

		const { OpenAI } = await import("openai");

		const client = new OpenAI({
			apiKey: context.apiKey,
			baseURL: context.baseURL || "https://api.x.ai/v1",
		});

		try {
			// xAI's web search is similar to OpenAI's but may have different tool format
			// For now, we'll use a generic approach
			const response = await client.chat.completions.create(
				{
					model: context.modelId,
					messages: [{ role: "user", content: args.query }],
					tools: [
						{
							type: "function",
							function: {
								name: "web_search",
								description: "Search the web",
								parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
							},
						},
					],
				},
				{ signal: context.signal },
			);

			const toolCall = response.choices[0]?.message?.tool_calls?.[0];
			const resultText = toolCall && "function" in toolCall ? toolCall.function.arguments : "";
			return {
				success: true,
				content: resultText,
				metadata: { provider: "xai", tool: "web_search" },
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				content: "",
				error: `web_search failed: ${message}`,
				metadata: { provider: "xai", tool: "web_search" },
			};
		}
	}
}
