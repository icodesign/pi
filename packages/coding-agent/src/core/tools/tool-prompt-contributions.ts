/**
 * Portable prompt metadata for the built-in coding tools.
 *
 * Keep this module free of tool implementations and host/UI dependencies so
 * headless runtimes can reuse the exact metadata exposed by Pi's tools.
 */

export interface ToolSystemPromptContribution {
	readonly snippet: string;
	readonly guidelines: readonly string[];
}

export const readToolSystemPromptContribution = {
	snippet: "Read file contents",
	guidelines: ["Use read to examine files instead of cat or sed."],
} as const satisfies ToolSystemPromptContribution;

export const writeToolSystemPromptContribution = {
	snippet: "Create or overwrite files",
	guidelines: ["Use write only for new files or complete rewrites."],
} as const satisfies ToolSystemPromptContribution;

export const editToolSystemPromptContribution = {
	snippet: "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
	guidelines: [
		"Use edit for precise changes (edits[].oldText must match exactly)",
		"When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
		"Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
		"Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
	],
} as const satisfies ToolSystemPromptContribution;

export const bashToolSystemPromptContribution = {
	snippet: "Execute bash commands (ls, grep, find, etc.)",
	guidelines: ["You can inspect PI_* environment variables for current model and session details."],
} as const satisfies ToolSystemPromptContribution;
