import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { uuidv7 } from "@earendil-works/pi-ai";
import { createBranchSummaryMessage, createCompactionSummaryMessage, createCustomMessage } from "../messages.ts";
import type {
	CompactionEntry,
	FileEntry,
	SessionContext,
	SessionEntry,
	SessionHeader,
	SessionMessageEntry,
} from "../session-manager.ts";

export const CURRENT_SESSION_VERSION = 3;

export function createSessionId(): string {
	return uuidv7();
}

export function assertValidSessionId(id: string): void {
	if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id)) {
		throw new Error(
			"Session id must be non-empty, contain only alphanumeric characters, '-', '_', and '.', and start and end with an alphanumeric character",
		);
	}
}

/** Generate a unique short ID (8 hex chars, collision-checked). */
export function generateSessionEntryId(byId: { has(id: string): boolean }): string {
	for (let i = 0; i < 100; i++) {
		const id = crypto.randomUUID().slice(0, 8);
		if (!byId.has(id)) return id;
	}
	return crypto.randomUUID();
}

/** Migrate v1 to v2 by adding the id/parentId tree structure. */
function migrateV1ToV2(entries: FileEntry[]): void {
	const ids = new Set<string>();
	let prevId: string | null = null;

	for (const entry of entries) {
		if (entry.type === "session") {
			entry.version = 2;
			continue;
		}

		entry.id = generateSessionEntryId(ids);
		entry.parentId = prevId;
		prevId = entry.id;

		if (entry.type === "compaction") {
			const compaction = entry as CompactionEntry & { firstKeptEntryIndex?: number };
			if (typeof compaction.firstKeptEntryIndex === "number") {
				const targetEntry = entries[compaction.firstKeptEntryIndex];
				if (targetEntry && targetEntry.type !== "session") {
					compaction.firstKeptEntryId = targetEntry.id;
				}
				delete compaction.firstKeptEntryIndex;
			}
		}
	}
}

/** Migrate v2 to v3 by renaming the hookMessage role to custom. */
function migrateV2ToV3(entries: FileEntry[]): void {
	for (const entry of entries) {
		if (entry.type === "session") {
			entry.version = 3;
			continue;
		}

		if (entry.type === "message") {
			const messageEntry = entry as SessionMessageEntry;
			if (messageEntry.message && (messageEntry.message as { role: string }).role === "hookMessage") {
				(messageEntry.message as { role: string }).role = "custom";
			}
		}
	}
}

/** Mutate entries in place, returning whether a migration was applied. */
export function migrateToCurrentSessionVersion(entries: FileEntry[]): boolean {
	const header = entries.find((entry) => entry.type === "session") as SessionHeader | undefined;
	const version = header?.version ?? 1;
	if (version >= CURRENT_SESSION_VERSION) return false;
	if (version < 2) migrateV1ToV2(entries);
	if (version < 3) migrateV2ToV3(entries);
	return true;
}

/** Exported for tests and importers of historical sessions. */
export function migrateSessionEntries(entries: FileEntry[]): void {
	migrateToCurrentSessionVersion(entries);
}

export function parseSessionEntries(content: string): FileEntry[] {
	const entries: FileEntry[] = [];
	for (const line of content.trim().split("\n")) {
		if (!line.trim()) continue;
		try {
			entries.push(JSON.parse(line) as FileEntry);
		} catch {
			// Ignore malformed JSONL lines, matching the file-backed loader.
		}
	}
	return entries;
}

export function getLatestCompactionEntry(entries: SessionEntry[]): CompactionEntry | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		if (entries[i].type === "compaction") return entries[i] as CompactionEntry;
	}
	return null;
}

function buildEntryIndex(entries: SessionEntry[], byId?: Map<string, SessionEntry>): Map<string, SessionEntry> {
	if (byId) return byId;
	return new Map(entries.map((entry) => [entry.id, entry]));
}

function buildSessionPath(
	entries: SessionEntry[],
	leafId?: string | null,
	byId?: Map<string, SessionEntry>,
): SessionEntry[] {
	const index = buildEntryIndex(entries, byId);
	if (leafId === null) return [];
	let leaf = leafId ? index.get(leafId) : undefined;
	leaf ??= entries[entries.length - 1];
	if (!leaf) return [];

	const path: SessionEntry[] = [];
	let current: SessionEntry | undefined = leaf;
	while (current) {
		path.push(current);
		current = current.parentId ? index.get(current.parentId) : undefined;
	}
	path.reverse();
	return path;
}

function getSessionContextSettings(path: SessionEntry[]): Pick<SessionContext, "thinkingLevel" | "model"> {
	let thinkingLevel = "off";
	let model: { provider: string; modelId: string } | null = null;
	for (const entry of path) {
		if (entry.type === "thinking_level_change") {
			thinkingLevel = entry.thinkingLevel;
		} else if (entry.type === "model_change") {
			model = { provider: entry.provider, modelId: entry.modelId };
		} else if (entry.type === "message" && entry.message.role === "assistant") {
			model = { provider: entry.message.provider, modelId: entry.message.model };
		}
	}
	return { thinkingLevel, model };
}

/** Project one selected session entry into LLM/runtime messages. */
export function sessionEntryToContextMessages(entry: SessionEntry): AgentMessage[] {
	if (entry.type === "message") {
		const message = entry.message;
		if (
			(message.role === "user" || message.role === "assistant" || message.role === "toolResult") &&
			message.content == null
		) {
			return [{ ...message, content: [] }];
		}
		return [message];
	}
	if (entry.type === "custom_message") {
		return [
			createCustomMessage(entry.customType, entry.content ?? [], entry.display, entry.details, entry.timestamp),
		];
	}
	if (entry.type === "branch_summary" && entry.summary) {
		return [createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp)];
	}
	if (entry.type === "compaction") {
		return [createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp)];
	}
	return [];
}

/** Build the active, compaction-aware session entry list. */
export function buildContextEntries(
	entries: SessionEntry[],
	leafId?: string | null,
	byId?: Map<string, SessionEntry>,
): SessionEntry[] {
	const path = buildSessionPath(entries, leafId, byId);
	let compaction: CompactionEntry | null = null;
	for (const entry of path) {
		if (entry.type === "compaction") compaction = entry;
	}
	if (!compaction) return path;

	const compactionIndex = path.findIndex((entry) => entry.id === compaction.id);
	if (compactionIndex < 0) return path;

	const contextEntries: SessionEntry[] = [compaction];
	let foundFirstKept = false;
	for (let i = 0; i < compactionIndex; i++) {
		const entry = path[i];
		if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true;
		if (foundFirstKept) contextEntries.push(entry);
	}
	contextEntries.push(...path.slice(compactionIndex + 1));
	return contextEntries;
}

/** Build the active LLM context and selected model settings. */
export function buildSessionContext(
	entries: SessionEntry[],
	leafId?: string | null,
	byId?: Map<string, SessionEntry>,
): SessionContext {
	const path = buildSessionPath(entries, leafId, byId);
	const { thinkingLevel, model } = getSessionContextSettings(path);
	const messages = buildContextEntries(entries, leafId, byId).flatMap(sessionEntryToContextMessages);
	return { messages, thinkingLevel, model };
}
