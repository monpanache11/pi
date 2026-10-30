/**
 * Headless CLI mode for running pi as a subprocess agent.
 *
 * This mode:
 * - Does not start TUI
 * - Reads task from --task-file
 * - Runs specified agent with the task
 * - Writes result to --output file
 * - Exits with appropriate code
 */

import { readFile, writeFile } from "node:fs/promises";
import chalk from "chalk";
import type { Args } from "../cli/args.ts";
import { getAgentDir } from "../config.ts";
import { AgentLoader } from "../core/agent-loader.ts";
import { ModelResolver } from "../core/model-resolver.ts";
import type { ToolDefinition } from "../core/extensions/types.ts";
import { createWriteOutputTool } from "./tools/WriteOutputTool.ts";
import { getNativeToolsForProvider } from "./tools/NativeTools.ts";
import type { NativeTool } from "./tools/NativeTools.ts";
import { createAgentSessionServices, createAgentSessionFromServices } from "../core/agent-session-services.ts";
import { SettingsManager } from "../core/settings-manager.ts";
import { SessionManager } from "../core/session-manager.ts";
import { ModelRuntime } from "../core/model-runtime.ts";
import type { Model, Api } from "@earendil-works/pi-ai";
import { builtInExtensions } from "../extensions/index.ts";

export interface HeadlessConfig {
	agent: string;
	taskFile: string;
	outputFile: string;
	maxTurns: number;
	modelConfig: { modelId: string; provider: string };
	providerConfig: { name: string };
	nativeTools: NativeTool[];
}

export interface HeadlessResult {
	success: boolean;
	exitCode: number;
	error?: string;
}

/**
 * Load task from JSON file
 */
export interface TaskInput {
	sub_question_id: string;
	question: string;
	description: string;
	budget: number;
}

async function loadTask(taskFile: string): Promise<TaskInput> {
	const content = await readFile(taskFile, "utf8");
	return JSON.parse(content);
}

/**
 * Build initial messages for the agent from task
 */
function buildInitialMessages(agentDef: Awaited<ReturnType<typeof AgentLoader.load>>, task: TaskInput): string {
	const systemPrompt = (agentDef.frontmatter?.systemPrompt as string) ?? "";
	return `${systemPrompt}\n\n## Task\n\n**Sub-question ID:** ${task.sub_question_id}\n**Question:** ${task.question}\n**Description:** ${task.description}\n**Search Budget:** ${task.budget} searches maximum\n\nBegin research now.`;
}

/**
 * Run headless mode using real AgentSessionRuntime
 */
export async function runHeadlessMode(parsed: Args): Promise<number> {
	const { agent, taskFile, output, maxTurns = 15 } = parsed;

	if (!agent) {
		console.error(chalk.red("Error: --agent is required in headless mode"));
		return 3;
	}
	if (!taskFile) {
		console.error(chalk.red("Error: --task-file is required in headless mode"));
		return 3;
	}
	if (!output) {
		console.error(chalk.red("Error: --output is required in headless mode"));
		return 3;
	}

	// In headless mode, we DO NOT accept --model or --provider flags.
	// Model is inherited ONLY from PI_MODEL / PI_PROVIDER env vars.
	if (parsed.model || parsed.provider) {
		console.error(chalk.red("Error: --model and --provider are not allowed in headless mode. Model is inherited from PI_MODEL/PI_PROVIDER env vars."));
		return 3;
	}

	// Resolve model from env vars (set by orchestrator)
	const modelConfig = ModelResolver.resolve({});
	const provider = modelConfig.provider;

	console.error(JSON.stringify({
		level: "info",
		event: "headless_start",
		agent,
		model: modelConfig.modelId,
		provider,
		taskFile,
		output,
		maxTurns,
		timestamp: Date.now()
	}));

	try {
		// Load task
		const task = await loadTask(taskFile);

		// Load agent definition
		const agentDir = getAgentDir();
		const agentDef = await AgentLoader.load(agentDir, agent);

		// Build initial prompt
		const initialPrompt = buildInitialMessages(agentDef, task);

		// Get native provider tools
		const nativeTools = getNativeToolsForProvider(provider);

		// Create a minimal in-memory session for headless mode
		const cwd = process.cwd();
		const sessionManager = SessionManager.inMemory(cwd);

		// Create settings manager
		const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });

		// Create model runtime
		const modelRuntime = await ModelRuntime.create({ allowModelNetwork: true });

		// Set API key if available
		const apiKey = process.env[`${provider.toUpperCase()}_API_KEY`];
		if (apiKey) {
			await modelRuntime.setRuntimeApiKey(provider, apiKey);
		}

		// Resolve model from modelRuntime, with fallback for custom models
		let model = modelRuntime.getModel(provider, modelConfig.modelId);
		if (!model) {
			// Try to find any model from this provider to use as base for fallback
			const providerModels = modelRuntime.getModels(provider);
			if (providerModels.length > 0) {
				// Create fallback model by cloning an existing model with custom ID
				const baseModel = providerModels[0];
				model = { ...baseModel, id: modelConfig.modelId, name: modelConfig.modelId } as Model<Api>;
				console.error(JSON.stringify({
					level: "warn",
					event: "headless_model_fallback",
					message: `Model ${modelConfig.modelId} not in catalog, using fallback based on ${baseModel.id}`,
					timestamp: Date.now()
				}));
			} else {
				throw new Error(`Model ${modelConfig.modelId} not found for provider ${provider} and no base models available`);
			}
		}

		// Check auth
		if (!(await modelRuntime.checkAuth(provider))) {
			throw new Error(`No API key configured for provider ${provider}`);
		}

		// Create resource loader with minimal extensions
		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			settingsManager,
			modelRuntimeSignal: AbortSignal.timeout(30_000),
			resourceLoaderOptions: {
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
				extensionFactories: builtInExtensions,
			},
			modelRuntime,
		});

		const resourceLoader = services.resourceLoader;

		// Build native tool definitions
		const nativeToolDefs: ToolDefinition[] = nativeTools.map(tool => ({
			name: tool.schema.function.name,
			label: tool.schema.function.name,
			description: tool.schema.function.description,
			parameters: tool.schema.function.parameters,
			execute: async (
				_toolCallId: string,
				args: Record<string, unknown>,
				_signal: AbortSignal | undefined,
				_onUpdate: any,
				_ctx: any
			) => {
				const abortSignal = _signal ?? new AbortController().signal;
				const result = await tool.executor.execute(args, {
					modelId: modelConfig.modelId,
					provider: provider,
					apiKey: apiKey || "",
					baseURL: undefined,
					signal: abortSignal,
					turnNumber: 0,
				});
				const content = [{ type: "text" as const, text: result.content }];
				return { content, details: result.metadata, isError: !result.success };
			},
		}));

		// Add write_output tool
		const writeOutputTool = createWriteOutputTool(output, task.sub_question_id);

		// Create custom tools combining native + write_output
		const customTools: ToolDefinition[] = [...nativeToolDefs, writeOutputTool];

		// Build tools allowlist: write_output + native tool names
		const toolNames = ["write_output", ...nativeTools.map(t => t.schema.function.name)];

		// Create the agent session
		const { session } = await createAgentSessionFromServices({
			services,
			sessionManager,
			model,
			customTools,
			tools: toolNames,
			scopedModels: [],
		});

		// Bind extensions for headless mode
		await session.bindExtensions({
			mode: "headless",
			commandContextActions: {
				waitForIdle: () => session.waitForIdle(),
				newSession: async () => ({ cancelled: true }),
				fork: async () => ({ cancelled: true }),
				navigateTree: async () => ({ cancelled: true }),
				switchSession: async () => ({ cancelled: true }),
				reload: async () => {},
			},
			onError: (err) => {
				console.error(JSON.stringify({
					level: "error",
					event: "extension_error",
					extensionPath: err.extensionPath,
					error: err.error,
					timestamp: Date.now()
				}));
			},
		});

		// Run the agent with the task
		await session.prompt(initialPrompt);

		// Wait for agent to complete (idle)
		await session.waitForIdle();

		// Check if output was written (agent should call write_output)
		// If not written, the agent may have finished without calling the tool
		// This is OK - the agent is expected to call write_output

		console.error(JSON.stringify({
			level: "info",
			event: "headless_complete",
			agent: agentDef.name,
			model: modelConfig.modelId,
			provider,
			nativeTools: nativeTools.map(t => t.schema.function.name),
			task: task.question,
			timestamp: Date.now()
		}));

		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(JSON.stringify({
			level: "error",
			event: "headless_error",
			error: message,
			timestamp: Date.now()
		}));
		return 1;
	}
}