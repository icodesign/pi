import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getThemeByName, theme } from "../../modes/interactive/theme/theme.ts";
import { resolvePath } from "../../utils/paths.ts";
import type { SessionExporter } from "../agent-session.ts";
import { exportSessionToHtml } from "../export-html/index.ts";
import { createToolHtmlRenderer } from "../export-html/tool-renderer.ts";
import { CURRENT_SESSION_VERSION } from "../session/context.ts";
import type { SessionHeader, SessionManager } from "../session-manager.ts";

/** Create the Node environment capability used by the full coding-agent SDK. */
export function createNodeSessionExporter(): SessionExporter {
	return {
		exportToHtml: async (sessionManager, state, options) => {
			const themeName = [options.themeName, options.settingsThemeName].find(
				(candidate) => candidate !== undefined && getThemeByName(candidate) !== undefined,
			);
			const toolRenderer = createToolHtmlRenderer({
				getToolDefinition: options.getToolDefinition,
				theme,
				cwd: options.cwd,
			});

			return exportSessionToHtml(sessionManager as SessionManager, state, {
				outputPath: options.outputPath,
				themeName,
				toolRenderer,
			});
		},

		exportToJsonl: (sessionManager, outputPath) => {
			const filePath = resolvePath(
				outputPath ?? `session-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
				process.cwd(),
			);
			const dir = dirname(filePath);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}

			const header: SessionHeader = {
				type: "session",
				version: CURRENT_SESSION_VERSION,
				id: sessionManager.getSessionId(),
				timestamp: new Date().toISOString(),
				cwd: sessionManager.getCwd(),
			};

			const branchEntries = sessionManager.getBranch();
			const lines = [JSON.stringify(header)];

			// Re-chain parentIds to form a linear sequence
			let prevId: string | null = null;
			for (const entry of branchEntries) {
				const linear = { ...entry, parentId: prevId };
				lines.push(JSON.stringify(linear));
				prevId = entry.id;
			}

			writeFileSync(filePath, `${lines.join("\n")}\n`);
			return filePath;
		},
	};
}
