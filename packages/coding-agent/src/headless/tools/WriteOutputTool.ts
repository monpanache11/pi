/**
 * WriteOutputTool - Special tool for headless mode to write structured result to file.
 */

import { writeFile } from "node:fs/promises";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "../../core/extensions/types.ts";

interface TextContent {
	type: "text";
	text: string;
}

export interface WriteOutputArgs {
	findings: string;
	citations: Array<{
		id: number;
		title: string;
		url: string;
		source_type: "primary" | "secondary";
		domain: string;
	}>;
	gaps: Array<{
		claim: string;
		single_source: boolean;
		reason: string;
	}>;
	confidence: "HIGH" | "MEDIUM" | "LOW";
	confidence_reasoning: string;
	searches_used: number;
}

let outputFilePath: string = "";
let taskId: string = "";
let turnCount: number = 0;

export function createWriteOutputTool(outputFile: string, taskIdParam: string): ToolDefinition {
	outputFilePath = outputFile;
	taskId = taskIdParam;

	return {
		name: "write_output",
		label: "Write Output",
		description: "Write final research result to output file. Call this ONCE when research is complete.",
		parameters: {
			type: "object",
			required: ["findings", "citations", "gaps", "confidence", "confidence_reasoning", "searches_used"],
			properties: {
				findings: { type: "string", description: "Structured findings with inline citations [1], [2], etc." },
				citations: {
					type: "array",
					items: {
						type: "object",
						required: ["id", "title", "url", "source_type", "domain"],
						properties: {
							id: { type: "number" },
							title: { type: "string" },
							url: { type: "string" },
							source_type: { type: "string", enum: ["primary", "secondary"] },
							domain: { type: "string" },
						},
					},
				},
				gaps: {
					type: "array",
					items: {
						type: "object",
						required: ["claim", "single_source", "reason"],
						properties: {
							claim: { type: "string" },
							single_source: { type: "boolean" },
							reason: { type: "string" },
						},
					},
				},
				confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
				confidence_reasoning: { type: "string" },
				searches_used: { type: "number" },
			},
		} as const,
		execute: async (
			_toolCallId: string,
			args: WriteOutputArgs,
			_signal: AbortSignal | undefined,
			_onUpdate: ((result: AgentToolResult) => void) | undefined,
			_ctx: any,
		): Promise<AgentToolResult> => {
			const output = {
				sub_question_id: taskId,
				...args,
				turns_used: turnCount,
			};
			await writeFile(outputFilePath, JSON.stringify(output, null, 2));
			const content: TextContent[] = [{ type: "text", text: "Result written to output file" }];
			return { content, details: { success: true }, isError: false };
		},
	};
}

export function setTurnCount(count: number): void {
	turnCount = count;
}
