/**
 * Agent definition loader for headless mode.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "../utils/frontmatter.ts";

export interface AgentDefinition {
	name: string;
	description?: string;
	tools?: string[];
	frontmatter: Record<string, unknown>;
	content: string;
	filePath: string;
}

export class AgentLoader {
	static async load(agentDir: string, agentName: string): Promise<AgentDefinition> {
		// Check in ~/.pi/agent/agents/ first, then in agentDir/agents/
		const possiblePaths = [
			join(agentDir, "agents", `${agentName}.md`),
			join(agentDir, "agents", `${agentName}.markdown`),
		];

		for (const path of possiblePaths) {
			try {
				const content = await readFile(path, "utf8");
				const { frontmatter, body } = parseFrontmatter(content);
				return {
					name: agentName,
					description: frontmatter.description as string | undefined,
					tools: frontmatter.tools as string[] | undefined,
					frontmatter,
					content: body,
					filePath: path,
				};
			} catch {
				// Try next path
			}
		}

		throw new Error(`Agent not found: ${agentName}. Searched in ${possiblePaths.join(", ")}`);
	}
}