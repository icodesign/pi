// Layer 1: platform-neutral coding-agent state and message helpers. Local
// sessions, tools, extensions, TUI, and filesystem-backed configuration stay
// out until their host capability boundaries are explicit.
export * from "./client/index.ts";
export { createEventBus, type EventBus, type EventBusController } from "./core/event-bus.ts";
export {
	type BashExecutionMessage,
	BRANCH_SUMMARY_PREFIX,
	BRANCH_SUMMARY_SUFFIX,
	type BranchSummaryMessage,
	bashExecutionToText,
	COMPACTION_SUMMARY_PREFIX,
	COMPACTION_SUMMARY_SUFFIX,
	type CompactionSummaryMessage,
	type CustomMessage,
	convertToLlm,
	createBranchSummaryMessage,
	createCompactionSummaryMessage,
	createCustomMessage,
} from "./core/messages.ts";
export {
	assertValidSessionId,
	buildContextEntries,
	buildSessionContext,
	CURRENT_SESSION_VERSION,
	getLatestCompactionEntry,
	migrateSessionEntries,
	parseSessionEntries,
	sessionEntryToContextMessages,
} from "./core/session-context.ts";
export type {
	BranchSummaryEntry,
	CompactionEntry,
	CustomEntry,
	CustomMessageEntry,
	FileEntry,
	LabelEntry,
	ModelChangeEntry,
	NewSessionOptions,
	SessionContext,
	SessionEntry,
	SessionHeader,
	SessionInfoEntry,
	SessionMessageEntry,
	SessionTreeNode,
	ThinkingLevelChangeEntry,
} from "./core/session-types.ts";
export { InMemorySessionManager } from "./core/session-state.ts";
export {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	GREP_MAX_LINE_LENGTH,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
} from "./core/tools/truncate.ts";
export { parseFrontmatter, stripFrontmatter } from "./utils/frontmatter.ts";
