import {SqliteDatabase} from "./sqlite";
import {Orm, SortDirection, column, table, type Row} from "./orm";
import type {AgentMessage, ReadonlySessionManager, SessionEntry, SessionHeader, SessionMessageEntry} from "../pi/types";

export const sessions = table("sessions", {
    id: column.text().primaryKey(),
    file: column.text().nullable(),
    cwd: column.text().notNull(),
    name: column.text().nullable(),
    title: column.text().nullable(),
    summary: column.text().nullable(),
    keywords: column.json<string[]>().nullable(),
    parentSession: column.text().nullable(),
    startedAt: column.date().notNull(),
    updatedAt: column.date().notNull(),
    header: column.json<SessionHeader>().notNull(),
});

export const sessionMessages = table("session_messages", {
    key: column.text().primaryKey(),
    entryId: column.text().notNull(),
    sessionId: column.text().notNull(),
    role: column.text().notNull(),
    contentText: column.text().notNull(),
    timestamp: column.date().notNull(),
    message: column.json<AgentMessage>().notNull(),
});

export type SessionRow = Row<typeof sessions>;
export type SessionMessageRow = Row<typeof sessionMessages>;

export type SessionMessageSearchResult = SessionMessageRow & {
    rank?: number;
};

export type SessionSearchResult = SessionRow & {
    rank?: number;
};

export class SessionDao {
    private readonly orm: Orm;
    private schemaInitialized = false;

    constructor(private readonly db: SqliteDatabase) {
        this.orm = new Orm(db);
    }

    initializeSchema() {
        if (this.schemaInitialized) return this;

        this.orm
            .createTable(sessions)
            .createTable(sessionMessages);

        this.db.exec(`
            create virtual table if not exists "session_fts" using fts5(
                "sessionId" unindexed,
                "cwd" unindexed,
                "title",
                "summary",
                "keywords"
            );

            create virtual table if not exists "session_message_fts" using fts5(
                "entryKey" unindexed,
                "entryId" unindexed,
                "sessionId" unindexed,
                "role",
                "contentText"
            );

            create index if not exists "idx_sessions_cwd_updatedAt" on "sessions" ("cwd", "updatedAt");
            create index if not exists "idx_sessions_updatedAt" on "sessions" ("updatedAt");
            create index if not exists "idx_session_messages_sessionId" on "session_messages" ("sessionId");
            create index if not exists "idx_session_messages_timestamp" on "session_messages" ("timestamp");
            create index if not exists "idx_session_messages_role" on "session_messages" ("role");
        `);

        this.schemaInitialized = true;
        return this;
    }

    syncSession(manager: ReadonlySessionManager) {
        const header = manager.getHeader();
        if (!header) return this;
        const entries = manager.getEntries();
        const sessionFile = manager.getSessionFile() ?? null;
        const sessionName = manager.getSessionName() ?? null;
        const startedAt = parseDate(header.timestamp);
        const updatedAt = latestTimestamp(header, entries);
        const title = sessionName ?? inferTitle(entries);

        const run = this.db.transaction(() => {
            this.upsertSession({
                id: header.id,
                file: sessionFile,
                cwd: header.cwd || manager.getCwd(),
                name: sessionName,
                title,
                summary: null,
                keywords: null,
                parentSession: header.parentSession ?? null,
                startedAt,
                updatedAt,
                header,
            });

            for (const entry of entries) {
                if (isMessageEntry(entry)) this.upsertMessage(header.id, entry);
            }
        });
        run();
        return this;
    }

    updateSessionSummary(sessionId: string, patch: {summary?: string | null; keywords?: string[] | null; title?: string | null}) {
        if (Object.keys(patch).length === 0) return this;
        this.orm.update(sessions, {id: sessionId}, {...patch, updatedAt: new Date()});
        const saved = this.getSession(sessionId);
        if (saved) this.upsertSessionFts(saved);
        return this;
    }

    getSession(sessionId: string): SessionRow | undefined {
        return this.orm.get(sessions, {id: sessionId});
    }

    listSessions(options: {cwd?: string; limit?: number} = {}): SessionRow[] {
        return this.orm.all(sessions, options.cwd ? {cwd: options.cwd} : {}, {
            orderBy: {column: "updatedAt", direction: SortDirection.DESC},
            limit: options.limit,
        });
    }

    messages(sessionId: string): SessionMessageRow[] {
        return this.orm.all(sessionMessages, {sessionId}, {orderBy: {column: "timestamp", direction: SortDirection.ASC}});
    }

    searchSessions(query: string, options: {cwd?: string; limit?: number} = {}): SessionSearchResult[] {
        const clauses = [`"session_fts" match @query`];
        if (options.cwd) clauses.push(`s."cwd" = @cwd`);
        const limit = options.limit ?? 25;
        const rows = this.db.prepare(`
            select s.*, bm25("session_fts") as rank
            from "session_fts"
            join "sessions" s on s."id" = "session_fts"."sessionId"
            where ${clauses.join(" and ")}
            order by rank
            limit @limit
        `).all({query, cwd: options.cwd, limit}) as Record<string, unknown>[];
        return rows.map(row => ({...decodeSessionRow(row), rank: Number(row.rank)}));
    }

    searchMessages(query: string, options: {sessionId?: string; cwd?: string; limit?: number} = {}): SessionMessageSearchResult[] {
        const clauses = [`"session_message_fts" match @query`];
        if (options.sessionId) clauses.push(`"session_message_fts"."sessionId" = @sessionId`);
        if (options.cwd) clauses.push(`s."cwd" = @cwd`);
        const limit = options.limit ?? 25;
        const rows = this.db.prepare(`
            select m.*, bm25("session_message_fts") as rank
            from "session_message_fts"
            join "session_messages" m on m."key" = "session_message_fts"."entryKey"
            join "sessions" s on s."id" = m."sessionId"
            where ${clauses.join(" and ")}
            order by rank
            limit @limit
        `).all({query, sessionId: options.sessionId, cwd: options.cwd, limit}) as Record<string, unknown>[];
        return rows.map(row => ({...decodeMessageRow(row), rank: Number(row.rank)}));
    }

    private upsertSession(row: SessionRow) {
        this.orm.upsert(sessions, row, ["id"], [
            "file",
            "cwd",
            "name",
            "parentSession",
            "startedAt",
            "updatedAt",
            "header",
        ]);

        const saved = this.getSession(row.id);
        if (saved) this.upsertSessionFts(saved);
    }

    private upsertMessage(sessionId: string, entry: SessionMessageEntry) {
        const row = {
            key: entryKey(sessionId, entry.id),
            entryId: entry.id,
            sessionId,
            role: String(entry.message.role),
            contentText: messageText(entry.message),
            timestamp: parseDate(entry.timestamp),
            message: entry.message,
        } satisfies SessionMessageRow;

        this.orm.upsert(sessionMessages, row, ["key"], ["role", "contentText", "timestamp", "message"]);

        this.deleteSessionMessageFts(row.key);
        if (row.contentText.trim()) {
            this.db.prepare(`
                insert into "session_message_fts" ("entryKey", "entryId", "sessionId", "role", "contentText")
                values (@key, @entryId, @sessionId, @role, @contentText)
            `).run(row);
        }
    }

    private upsertSessionFts(row: SessionRow) {
        this.db.prepare(`delete from "session_fts" where "sessionId" = ?`).run(row.id);
        const keywords = row.keywords?.join(" ") ?? "";
        if (![row.title, row.summary, keywords].some(value => value?.trim())) return;
        this.db.prepare(`
            insert into "session_fts" ("sessionId", "cwd", "title", "summary", "keywords")
            values (@id, @cwd, @title, @summary, @keywords)
        `).run({...row, keywords});
    }

    private deleteSessionMessageFts(entryKeyValue: string) {
        this.db.prepare(`delete from "session_message_fts" where "entryKey" = ?`).run(entryKeyValue);
    }
}

function entryKey(sessionId: string, entryId: string) {
    return `${sessionId}:${entryId}`;
}

function isMessageEntry(entry: SessionEntry): entry is SessionMessageEntry {
    return entry.type === "message" && typeof entry.message === "object" && entry.message !== null;
}

function latestTimestamp(header: SessionHeader, entries: SessionEntry[]) {
    let latest = parseDate(header.timestamp).getTime();
    for (const entry of entries) latest = Math.max(latest, parseDate(entry.timestamp).getTime());
    return new Date(latest);
}

function parseDate(value: string) {
    const time = Date.parse(value);
    return new Date(Number.isFinite(time) ? time : Date.now());
}

function inferTitle(entries: SessionEntry[]) {
    for (const entry of entries) {
        if (!isMessageEntry(entry)) continue;
        if (entry.message.role !== "user") continue;
        const text = messageText(entry.message).replace(/\s+/g, " ").trim();
        if (!text) continue;
        return text.length > 120 ? `${text.slice(0, 117)}...` : text;
    }
    return null;
}

function messageText(message: AgentMessage): string {
    const content = message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content.map(part => {
            if (!part || typeof part !== "object") return "";
            if ("text" in part && typeof part.text === "string") return part.text;
            if ("thinking" in part && typeof part.thinking === "string") return part.thinking;
            if ("name" in part && typeof part.name === "string") return `[tool call: ${part.name}] ${JSON.stringify("arguments" in part ? part.arguments : {})}`;
            if ("mimeType" in part && typeof part.mimeType === "string") return `[image: ${part.mimeType}]`;
            return JSON.stringify(part);
        }).filter(Boolean).join("\n");
    }
    return JSON.stringify(message);
}

function decodeSessionRow(row: Record<string, unknown>): SessionRow {
    return {
        id: String(row.id),
        file: row.file === null || row.file === undefined ? null : String(row.file),
        cwd: String(row.cwd),
        name: row.name === null || row.name === undefined ? null : String(row.name),
        title: row.title === null || row.title === undefined ? null : String(row.title),
        summary: row.summary === null || row.summary === undefined ? null : String(row.summary),
        keywords: row.keywords === null || row.keywords === undefined ? null : JSON.parse(String(row.keywords)) as string[],
        parentSession: row.parentSession === null || row.parentSession === undefined ? null : String(row.parentSession),
        startedAt: new Date(Number(row.startedAt)),
        updatedAt: new Date(Number(row.updatedAt)),
        header: JSON.parse(String(row.header)) as SessionHeader,
    };
}

function decodeMessageRow(row: Record<string, unknown>): SessionMessageRow {
    return {
        key: String(row.key),
        entryId: String(row.entryId),
        sessionId: String(row.sessionId),
        role: String(row.role),
        contentText: String(row.contentText),
        timestamp: new Date(Number(row.timestamp)),
        message: JSON.parse(String(row.message)) as AgentMessage,
    };
}
