import type { ImageContent, Message, TextContent, Usage } from "@earendil-works/pi-ai/orbis";
import type { BashExecutionMessage, CustomMessage } from "./messages.ts";
import {
	assertValidSessionId,
	buildContextEntries,
	buildSessionContext,
	CURRENT_SESSION_VERSION,
	createSessionId,
	generateSessionEntryId,
} from "./session-context.ts";
import type {
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
} from "./session-types.ts";

/**
 * Platform-neutral append-only session tree.
 *
 * This class owns session state and traversal only. Filesystem persistence is
 * supplied by the Node SessionManager subclass; Orbis uses this class directly.
 */
export class InMemorySessionManager {
	protected sessionId = "";
	protected cwd: string;
	protected fileEntries: FileEntry[] = [];
	protected byId = new Map<string, SessionEntry>();
	protected labelsById = new Map<string, string>();
	protected labelTimestampsById = new Map<string, string>();
	protected leafId: string | null = null;

	constructor(cwd: string, options?: NewSessionOptions) {
		this.cwd = cwd;
		this.resetSession(options);
	}

	protected resetSession(options?: NewSessionOptions): void {
		if (options?.id !== undefined) assertValidSessionId(options.id);
		this.sessionId = options?.id ?? createSessionId();
		this.fileEntries = [
			{
				type: "session",
				version: CURRENT_SESSION_VERSION,
				id: this.sessionId,
				timestamp: new Date().toISOString(),
				cwd: this.cwd,
				parentSession: options?.parentSession,
			},
		];
		this.byId.clear();
		this.labelsById.clear();
		this.labelTimestampsById.clear();
		this.leafId = null;
	}

	newSession(options?: NewSessionOptions): string | undefined {
		this.resetSession(options);
		return undefined;
	}

	protected rebuildIndex(): void {
		this.byId.clear();
		this.labelsById.clear();
		this.labelTimestampsById.clear();
		this.leafId = null;
		for (const entry of this.fileEntries) {
			if (entry.type === "session") continue;
			this.byId.set(entry.id, entry);
			this.leafId = entry.id;
			if (entry.type !== "label") continue;
			if (entry.label) {
				this.labelsById.set(entry.targetId, entry.label);
				this.labelTimestampsById.set(entry.targetId, entry.timestamp);
			} else {
				this.labelsById.delete(entry.targetId);
				this.labelTimestampsById.delete(entry.targetId);
			}
		}
	}

	protected onAppendEntry(_entry: SessionEntry): void {}

	protected appendEntry(entry: SessionEntry): void {
		this.fileEntries.push(entry);
		this.byId.set(entry.id, entry);
		this.leafId = entry.id;
		this.onAppendEntry(entry);
	}

	isPersisted(): boolean {
		return false;
	}

	getCwd(): string {
		return this.cwd;
	}

	getSessionDir(): string {
		return "";
	}

	usesDefaultSessionDir(): boolean {
		return false;
	}

	getSessionId(): string {
		return this.sessionId;
	}

	getSessionFile(): string | undefined {
		return undefined;
	}

	appendMessage(message: Message | CustomMessage | BashExecutionMessage): string {
		const entry: SessionMessageEntry = {
			type: "message",
			id: generateSessionEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			message,
		};
		this.appendEntry(entry);
		return entry.id;
	}

	appendThinkingLevelChange(thinkingLevel: string): string {
		const entry: ThinkingLevelChangeEntry = {
			type: "thinking_level_change",
			id: generateSessionEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			thinkingLevel,
		};
		this.appendEntry(entry);
		return entry.id;
	}

	appendModelChange(provider: string, modelId: string): string {
		const entry: ModelChangeEntry = {
			type: "model_change",
			id: generateSessionEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			provider,
			modelId,
		};
		this.appendEntry(entry);
		return entry.id;
	}

	appendCompaction<T = unknown>(
		summary: string,
		firstKeptEntryId: string,
		tokensBefore: number,
		details?: T,
		fromHook?: boolean,
		usage?: Usage,
	): string {
		const entry: CompactionEntry<T> = {
			type: "compaction",
			id: generateSessionEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			summary,
			firstKeptEntryId,
			tokensBefore,
			details,
			usage,
			fromHook,
		};
		this.appendEntry(entry);
		return entry.id;
	}

	appendCustomEntry(customType: string, data?: unknown): string {
		const entry: CustomEntry = {
			type: "custom",
			customType,
			data,
			id: generateSessionEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
		};
		this.appendEntry(entry);
		return entry.id;
	}

	appendSessionInfo(name: string): string {
		const entry: SessionInfoEntry = {
			type: "session_info",
			id: generateSessionEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			name: name.replace(/[\r\n]+/g, " ").trim(),
		};
		this.appendEntry(entry);
		return entry.id;
	}

	getSessionName(): string | undefined {
		const entries = this.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "session_info") return entry.name?.trim() || undefined;
		}
		return undefined;
	}

	appendCustomMessageEntry<T = unknown>(
		customType: string,
		content: string | (TextContent | ImageContent)[],
		display: boolean,
		details?: T,
	): string {
		const entry: CustomMessageEntry<T> = {
			type: "custom_message",
			customType,
			content,
			display,
			details,
			id: generateSessionEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
		};
		this.appendEntry(entry);
		return entry.id;
	}

	getLeafId(): string | null {
		return this.leafId;
	}

	getLeafEntry(): SessionEntry | undefined {
		return this.leafId ? this.byId.get(this.leafId) : undefined;
	}

	getEntry(id: string): SessionEntry | undefined {
		return this.byId.get(id);
	}

	getChildren(parentId: string): SessionEntry[] {
		return [...this.byId.values()].filter((entry) => entry.parentId === parentId);
	}

	getLabel(id: string): string | undefined {
		return this.labelsById.get(id);
	}

	appendLabelChange(targetId: string, label: string | undefined): string {
		if (!this.byId.has(targetId)) throw new Error(`Entry ${targetId} not found`);
		const entry: LabelEntry = {
			type: "label",
			id: generateSessionEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			targetId,
			label,
		};
		this.appendEntry(entry);
		if (label) {
			this.labelsById.set(targetId, label);
			this.labelTimestampsById.set(targetId, entry.timestamp);
		} else {
			this.labelsById.delete(targetId);
			this.labelTimestampsById.delete(targetId);
		}
		return entry.id;
	}

	getBranch(fromId?: string): SessionEntry[] {
		const path: SessionEntry[] = [];
		const startId = fromId ?? this.leafId;
		let current = startId ? this.byId.get(startId) : undefined;
		while (current) {
			path.push(current);
			current = current.parentId ? this.byId.get(current.parentId) : undefined;
		}
		path.reverse();
		return path;
	}

	buildContextEntries(): SessionEntry[] {
		return buildContextEntries(this.getEntries(), this.leafId, this.byId);
	}

	buildSessionContext(): SessionContext {
		return buildSessionContext(this.getEntries(), this.leafId, this.byId);
	}

	getHeader(): SessionHeader | null {
		return (this.fileEntries.find((entry) => entry.type === "session") as SessionHeader | undefined) ?? null;
	}

	getEntries(): SessionEntry[] {
		return this.fileEntries.filter((entry): entry is SessionEntry => entry.type !== "session");
	}

	getTree(): SessionTreeNode[] {
		const entries = this.getEntries();
		const nodeMap = new Map<string, SessionTreeNode>();
		const roots: SessionTreeNode[] = [];
		for (const entry of entries) {
			nodeMap.set(entry.id, {
				entry,
				children: [],
				label: this.labelsById.get(entry.id),
				labelTimestamp: this.labelTimestampsById.get(entry.id),
			});
		}
		for (const entry of entries) {
			const node = nodeMap.get(entry.id)!;
			if (entry.parentId === null || entry.parentId === entry.id) {
				roots.push(node);
			} else {
				const parent = nodeMap.get(entry.parentId);
				if (parent) parent.children.push(node);
				else roots.push(node);
			}
		}
		const stack = [...roots];
		while (stack.length > 0) {
			const node = stack.pop()!;
			node.children.sort((a, b) => new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime());
			stack.push(...node.children);
		}
		return roots;
	}

	branch(branchFromId: string): void {
		if (!this.byId.has(branchFromId)) throw new Error(`Entry ${branchFromId} not found`);
		this.leafId = branchFromId;
	}

	resetLeaf(): void {
		this.leafId = null;
	}

	branchWithSummary(
		branchFromId: string | null,
		summary: string,
		details?: unknown,
		fromHook?: boolean,
		usage?: Usage,
	): string {
		if (branchFromId !== null && !this.byId.has(branchFromId)) {
			throw new Error(`Entry ${branchFromId} not found`);
		}
		this.leafId = branchFromId;
		const entry: BranchSummaryEntry = {
			type: "branch_summary",
			id: generateSessionEntryId(this.byId),
			parentId: branchFromId,
			timestamp: new Date().toISOString(),
			fromId: branchFromId ?? "root",
			summary,
			details,
			usage,
			fromHook,
		};
		this.appendEntry(entry);
		return entry.id;
	}

	protected buildBranchedSession(
		leafId: string,
		parentSession?: string,
	): {
		header: SessionHeader;
		entries: FileEntry[];
	} {
		const path = this.getBranch(leafId);
		if (path.length === 0) throw new Error(`Entry ${leafId} not found`);

		const pathWithoutLabels: SessionEntry[] = [];
		let pathParentId: string | null = null;
		for (const entry of path) {
			if (entry.type === "label") continue;
			pathWithoutLabels.push({ ...entry, parentId: pathParentId });
			pathParentId = entry.id;
		}

		const newSessionId = createSessionId();
		const usedIds = new Set(pathWithoutLabels.map((entry) => entry.id));
		const labelEntries: LabelEntry[] = [];
		let parentId = pathWithoutLabels[pathWithoutLabels.length - 1]?.id ?? null;
		for (const [targetId, label] of this.labelsById) {
			if (!usedIds.has(targetId)) continue;
			const labelEntry: LabelEntry = {
				type: "label",
				id: generateSessionEntryId(usedIds),
				parentId,
				timestamp: this.labelTimestampsById.get(targetId)!,
				targetId,
				label,
			};
			usedIds.add(labelEntry.id);
			labelEntries.push(labelEntry);
			parentId = labelEntry.id;
		}

		const header: SessionHeader = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: newSessionId,
			timestamp: new Date().toISOString(),
			cwd: this.cwd,
			parentSession,
		};
		return { header, entries: [header, ...pathWithoutLabels, ...labelEntries] };
	}

	protected replaceSession(header: SessionHeader, entries: FileEntry[]): void {
		this.fileEntries = entries;
		this.sessionId = header.id;
		this.rebuildIndex();
	}

	/** Replace the current in-memory session with one selected branch. */
	createBranchedSession(leafId: string): string | undefined {
		const branched = this.buildBranchedSession(leafId);
		this.replaceSession(branched.header, branched.entries);
		return undefined;
	}
}
