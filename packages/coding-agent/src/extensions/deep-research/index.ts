/**
 * Deep Research Extension
 *
 * Orchestrates multi-agent deep research using headless subagents:
 * 1. Planner - breaks down the question into sub-questions (headless agent)
 * 2. Researchers - parallel headless agents for each sub-question
 * 3. Synthesizer - combines findings into a coherent report (headless agent)
 * 4. Critic - reviews the report for gaps and issues (headless agent)
 * 5. Fact-checker - verifies key claims (headless agent)
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionFactory } from "../../core/extensions/types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

interface SubQuestion {
	id: string;
	question: string;
	description: string;
	budget: number;
}

interface ResearchResult {
	sub_question_id: string;
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
	turns_used: number;
}

interface DeepResearchPlan {
	main_question: string;
	sub_questions: SubQuestion[];
}

interface DeepResearchReport {
	main_question: string;
	executive_summary: string;
	detailed_findings: string;
	sources: Array<{
		id: number;
		title: string;
		url: string;
		source_type: "primary" | "secondary";
		domain: string;
		sub_question_id: string;
	}>;
	gaps: Array<{
		claim: string;
		single_source: boolean;
		reason: string;
		sub_question_id: string;
	}>;
	confidence: "HIGH" | "MEDIUM" | "LOW";
	confidence_reasoning: string;
	sub_question_results: ResearchResult[];
}

async function getPiEntryPoint(): Promise<string> {
	// Try to find the pi CLI entry point
	const possiblePaths = [
		join(__dirname, "..", "..", "..", "..", "dist", "cli.js"),
		join(__dirname, "..", "..", "..", "dist", "cli.js"),
		join(process.cwd(), "dist", "cli.js"),
	];
	const { existsSync } = await import("node:fs");
	for (const p of possiblePaths) {
		try {
			if (existsSync(p)) return p;
		} catch {}
	}
	// Fallback
	return join(__dirname, "..", "..", "..", "..", "dist", "cli.js");
}

function getTempDir(): string {
	return join(homedir(), ".pi", "deep-research", `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function runHeadlessAgent(
	agentName: string,
	task: SubQuestion,
	modelId: string,
	provider: string,
	apiKey: string,
	tempDir: string,
): Promise<ResearchResult> {
	const taskFile = join(tempDir, `task-${task.id}.json`);
	const outputFile = join(tempDir, `result-${task.id}.json`);

	await writeFile(taskFile, JSON.stringify(task, null, 2));

	const piEntryPoint = await getPiEntryPoint();

	return new Promise((resolve, reject) => {
		const env = {
			...process.env,
			PI_MODEL: modelId,
			PI_PROVIDER: provider,
			[`${provider.toUpperCase()}_API_KEY`]: apiKey,
			PI_OFFLINE: "0",
		};

		const child = spawn(
			"node",
			[
				piEntryPoint,
				"--headless",
				"--agent",
				agentName,
				"--task-file",
				taskFile,
				"--output",
				outputFile,
				"--max-turns",
				"20",
			],
			{
				env,
				cwd: process.cwd(),
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		let stderr = "";
		child.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		child.on("close", async (code) => {
			if (code !== 0) {
				reject(new Error(`Headless agent failed (code ${code}): ${stderr}`));
				return;
			}

			try {
				const resultContent = await readFile(outputFile, "utf8");
				const result = JSON.parse(resultContent) as ResearchResult;
				resolve(result);
			} catch (err) {
				reject(new Error(`Failed to read result: ${err}`));
			}
		});

		child.on("error", (err) => {
			reject(new Error(`Failed to spawn headless agent: ${err.message}`));
		});

		// Timeout after 5 minutes
		setTimeout(
			() => {
				child.kill("SIGTERM");
				reject(new Error("Headless agent timed out after 5 minutes"));
			},
			5 * 60 * 1000,
		);
	});
}

function createPlannerTask(mainQuestion: string): SubQuestion {
	return {
		id: "plan",
		question: `Create a research plan for: ${mainQuestion}`,
		description: `Break down the main question into 3-5 focused sub-questions for parallel investigation.

Main Question: ${mainQuestion}

Output a JSON object with this exact structure:
{
  "main_question": "...",
  "sub_questions": [
    {
      "id": "sq1",
      "question": "Specific focused question",
      "description": "What to investigate, key angles, sources to check",
      "budget": 5
    }
  ]
}

Focus on:
- Different angles/perspectives
- Different source types (academic, industry, news, official)
- Comparative aspects if applicable
- Recent developments (2024)
- Practical implications`,
		budget: 3,
	};
}

function createSynthesizerTask(plan: DeepResearchPlan, results: ResearchResult[]): SubQuestion {
	const findingsSummary = results
		.map((r) => {
			const sq = plan.sub_questions.find((q) => q.id === r.sub_question_id);
			return `## ${r.sub_question_id}: ${sq?.question}\n\n${r.findings}`;
		})
		.join("\n\n---\n\n");

	return {
		id: "synthesize",
		question: `Synthesize the following research findings into a coherent report for: ${plan.main_question}`,
		description: `Combine findings from ${results.length} sub-questions into a structured report.

Sub-question findings:
${findingsSummary}

Create a JSON report with:
{
  "main_question": "...",
  "executive_summary": "2-3 paragraph summary",
  "detailed_findings": "...",
  "sources": [...],
  "gaps": [...],
  "confidence": "HIGH|MEDIUM|LOW",
  "confidence_reasoning": "...",
  "sub_question_results": [...]
}

Deduplicate citations by URL. Renumber citations sequentially.`,
		budget: 2,
	};
}

function createCriticTask(report: DeepResearchReport): SubQuestion {
	return {
		id: "critique",
		question: `Critique this research report for: ${report.main_question}`,
		description: `Review the draft report for:
1. Logical consistency and coherence
2. Gaps in coverage
3. Overstated claims without sufficient evidence
4. Missing perspectives or counterarguments
5. Citation quality and relevance

Report:
${JSON.stringify(report, null, 2)}

Output the improved report JSON, or "APPROVED" if solid.`,
		budget: 2,
	};
}

function createFactCheckerTask(report: DeepResearchReport): SubQuestion {
	return {
		id: "factcheck",
		question: `Fact-check this research report for: ${report.main_question}`,
		description: `Verify key claims by checking citations and identifying unsupported assertions.

Report:
${JSON.stringify(report, null, 2)}

For each key claim, check if it has adequate citation support. Flag claims that:
- Have no citation
- Have only a single source (especially secondary)
- Have citations that don't actually support the claim
- Have outdated information

Output the corrected report JSON.`,
		budget: 2,
	};
}

async function parsePlanResult(result: ResearchResult): Promise<DeepResearchPlan> {
	try {
		// Try to extract JSON from findings
		const jsonMatch = result.findings.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			return JSON.parse(jsonMatch[0]);
		}
		// Fallback to default plan
		throw new Error("No JSON found in planner output");
	} catch {
		// Default fallback plan
		return {
			main_question: result.sub_question_id === "plan" ? "Unknown" : "Research Topic",
			sub_questions: [
				{ id: "sq1", question: "Overview", description: "General landscape", budget: 5 },
				{ id: "sq2", question: "Technical details", description: "Technical deep dive", budget: 5 },
				{ id: "sq3", question: "Practical implications", description: "Real-world adoption", budget: 5 },
			],
		};
	}
}

async function parseReportResult(result: ResearchResult): Promise<DeepResearchReport> {
	try {
		const jsonMatch = result.findings.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			return JSON.parse(jsonMatch[0]);
		}
		throw new Error("No JSON found in report output");
	} catch {
		// Fallback
		return {
			main_question: "Research Topic",
			executive_summary: result.findings.slice(0, 500),
			detailed_findings: result.findings,
			sources: result.citations.map((c) => ({ ...c, sub_question_id: result.sub_question_id })),
			gaps: result.gaps.map((g) => ({ ...g, sub_question_id: result.sub_question_id })),
			confidence: result.confidence,
			confidence_reasoning: result.confidence_reasoning,
			sub_question_results: [],
		};
	}
}

export function createDeepResearchExtension(): ExtensionFactory {
	return (pi) => {
		pi.registerCommand("deep-research", {
			description:
				"Start a deep research investigation using parallel headless agents. Usage: /deep-research <question> [--depth standard|deep|comprehensive]",
			handler: async (args: string, ctx: import("../../core/extensions/types.ts").ExtensionCommandContext) => {
				const parts = args.trim().split(/\s+/);
				const depthFlag = parts.indexOf("--depth");
				let depth = "standard";
				let question = args;

				if (depthFlag !== -1 && depthFlag + 1 < parts.length) {
					depth = parts[depthFlag + 1];
					question = parts.slice(0, depthFlag).join(" ");
				}

				if (!question.trim()) {
					ctx.ui.notify("Usage: /deep-research <question> [--depth standard|deep|comprehensive]", "warning");
					return;
				}

				// Get current model config
				const model = ctx.model;
				if (!model) {
					ctx.ui.notify("Error: No model selected", "error");
					return;
				}

				const modelId = model.id;
				const provider = model.provider;
				// ollama doesn't need an API key
				const needsApiKey = provider !== "ollama";
				const apiKey = needsApiKey ? process.env[`${provider.toUpperCase()}_API_KEY`] || "" : "ollama";

				if (needsApiKey && !apiKey) {
					ctx.ui.notify(`Error: No API key for provider ${provider}`, "error");
					return;
				}

				ctx.ui.notify(`Starting deep research: ${question}`, "info");

				try {
					// Create temp directory for this run
					const tempDir = getTempDir();
					await mkdir(tempDir, { recursive: true });

					console.error(JSON.stringify({ level: "info", event: "deep_research_start", question, depth, tempDir }));

					// Phase 1: Plan (using headless agent)
					console.error(JSON.stringify({ level: "info", event: "deep_research_phase", phase: "planning" }));
					ctx.ui.notify("Phase 1/5: Planning research...", "info");
					const planTask = createPlannerTask(question);
					const planResult = await runHeadlessAgent(
						"researcher_headless",
						planTask,
						modelId,
						provider,
						apiKey,
						tempDir,
					);
					const plan = await parsePlanResult(planResult);

					// Phase 2: Parallel Research
					console.error(
						JSON.stringify({
							level: "info",
							event: "deep_research_phase",
							phase: "research",
							subQuestions: plan.sub_questions.length,
						}),
					);
					ctx.ui.notify(`Phase 2/5: Launching ${plan.sub_questions.length} parallel researchers...`, "info");
					const researchPromises = plan.sub_questions.map((sq) =>
						runHeadlessAgent("researcher_headless", sq, modelId, provider, apiKey, tempDir),
					);
					const results = await Promise.all(researchPromises);

					// Phase 3: Synthesize (using headless agent)
					console.error(JSON.stringify({ level: "info", event: "deep_research_phase", phase: "synthesis" }));
					ctx.ui.notify("Phase 3/5: Synthesizing findings...", "info");
					const synthesizeTask = createSynthesizerTask(plan, results);
					const synthesizeResult = await runHeadlessAgent(
						"researcher_headless",
						synthesizeTask,
						modelId,
						provider,
						apiKey,
						tempDir,
					);
					let report = await parseReportResult(synthesizeResult);

					// Phase 4: Critique (using headless agent)
					console.error(JSON.stringify({ level: "info", event: "deep_research_phase", phase: "critique" }));
					ctx.ui.notify("Phase 4/5: Critiquing report...", "info");
					const criticTask = createCriticTask(report);
					const criticResult = await runHeadlessAgent(
						"researcher_headless",
						criticTask,
						modelId,
						provider,
						apiKey,
						tempDir,
					);
					if (criticResult.findings !== "APPROVED") {
						report = await parseReportResult(criticResult);
					}

					// Phase 5: Fact-check (using headless agent)
					console.error(JSON.stringify({ level: "info", event: "deep_research_phase", phase: "fact_check" }));
					ctx.ui.notify("Phase 5/5: Fact-checking...", "info");
					const factCheckTask = createFactCheckerTask(report);
					const factCheckResult = await runHeadlessAgent(
						"researcher_headless",
						factCheckTask,
						modelId,
						provider,
						apiKey,
						tempDir,
					);
					report = await parseReportResult(factCheckResult);

					console.error(JSON.stringify({ level: "info", event: "deep_research_complete", question }));

					// Output the final report
					const output = {
						report,
						metadata: {
							question,
							depth,
							model: modelId,
							provider,
							sub_questions_count: plan.sub_questions.length,
							total_citations: report.sources.length,
							total_gaps: report.gaps.length,
							timestamp: Date.now(),
						},
					};

					// Write final report to file
					const finalReportPath = join(tempDir, "final_report.json");
					await writeFile(finalReportPath, JSON.stringify(output, null, 2));

					ctx.ui.notify(`Deep research complete! Report saved to ${finalReportPath}`, "info");
					ctx.ui.notify(`Summary: ${report.executive_summary.slice(0, 200)}...`, "info");
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					console.error(JSON.stringify({ level: "error", event: "deep_research_error", error: message }));
					ctx.ui.notify(`Deep research failed: ${message}`, "error");
				}
			},
		});
	};
}

export default createDeepResearchExtension();
