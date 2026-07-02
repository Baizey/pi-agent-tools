import {Orm, column, table, type Row} from "./orm";
import {SqliteDatabase} from "./sqlite";
import type {SubagentToolkit, SubagentRunMode} from "../shared/subagents";

export const subagentRunStatuses = {
    starting: "starting",
    running: "running",
    done: "done",
    failed: "failed",
    cancelled: "cancelled",
    timedOut: "timed_out",
} as const;

export type SubagentRunStatus = typeof subagentRunStatuses[keyof typeof subagentRunStatuses];

export const subagentRuns = table("subagent_runs", {
    id: column.text().primaryKey(),
    rootId: column.text().notNull(),
    parentId: column.text().nullable(),
    ordinal: column.integer().notNull(),
    depth: column.integer().notNull(),
    mode: column.text().notNull(),
    task: column.text().notNull(),
    profiles: column.json<SubagentToolkit[]>().notNull(),
    tools: column.json<string[]>().notNull(),
    status: column.text().notNull(),
    latestLine: column.text().notNull(),
    startedAt: column.date().notNull(),
    updatedAt: column.date().notNull(),
    finishedAt: column.date().nullable(),
    exitCode: column.integer().nullable(),
    timedOut: column.boolean().nullable(),
    error: column.text().nullable(),
});

export type SubagentRunRow = Row<typeof subagentRuns> & {
    mode: SubagentRunMode;
    status: SubagentRunStatus;
};

export type StartSubagentRunInput = {
    id: string;
    rootId: string;
    parentId?: string;
    ordinal: number;
    depth: number;
    mode: SubagentRunMode;
    task: string;
    toolkits: SubagentToolkit[];
    tools: string[];
};

export type UpdateSubagentRunInput = Partial<{
    status: SubagentRunStatus;
    latestLine: string;
    finishedAt: Date | null;
    exitCode: number | null;
    timedOut: boolean | null;
    error: string | null;
}>;

export class SubagentDao {
    private readonly orm: Orm;
    private schemaInitialized = false;

    constructor(private readonly db: SqliteDatabase) {
        this.orm = new Orm(db);
    }

    initializeSchema() {
        if (this.schemaInitialized) return this;
        this.orm.createTable(subagentRuns);
        this.db.exec(`
            create index if not exists "idx_subagent_runs_root_parent" on "subagent_runs" ("rootId", "parentId", "ordinal");
            create index if not exists "idx_subagent_runs_updatedAt" on "subagent_runs" ("updatedAt");
        `);
        this.schemaInitialized = true;
        return this;
    }

    nextOrdinal(parentId: string | null, rootId: string): number {
        const row = this.db.prepare(`
            select coalesce(max("ordinal"), 0) + 1 as "nextOrdinal"
            from "subagent_runs"
            where "rootId" = @rootId
              and ((@parentId is null and "parentId" is null) or "parentId" = @parentId)
        `).get({rootId, parentId}) as {nextOrdinal: number} | undefined;
        return Number(row?.nextOrdinal ?? 1);
    }

    startRun(input: StartSubagentRunInput): SubagentRunRow {
        const now = new Date();
        const row = {
            id: input.id,
            rootId: input.rootId,
            parentId: input.parentId ?? null,
            ordinal: input.ordinal,
            depth: input.depth,
            mode: input.mode,
            task: input.task,
            profiles: input.toolkits,
            tools: input.tools,
            status: subagentRunStatuses.starting,
            latestLine: input.task,
            startedAt: now,
            updatedAt: now,
            finishedAt: null,
            exitCode: null,
            timedOut: null,
            error: null,
        } satisfies SubagentRunRow;
        this.orm.upsert(subagentRuns, row, ["id"]);
        return row;
    }

    updateRun(id: string, update: UpdateSubagentRunInput): SubagentRunRow | undefined {
        this.orm.update(subagentRuns, {id}, {...update, updatedAt: new Date()});
        return this.getRun(id);
    }

    finishRun(id: string, status: SubagentRunStatus, update: Omit<UpdateSubagentRunInput, "status" | "finishedAt"> = {}): SubagentRunRow | undefined {
        return this.updateRun(id, {status, finishedAt: new Date(), ...update});
    }

    getRun(id: string): SubagentRunRow | undefined {
        return this.orm.get(subagentRuns, {id}) as SubagentRunRow | undefined;
    }

    listTree(rootId: string): SubagentRunRow[] {
        return this.orm.all(subagentRuns, {rootId}, {orderBy: [
            {column: "depth", direction: "asc"},
            {column: "parentId", direction: "asc"},
            {column: "ordinal", direction: "asc"},
        ]}) as SubagentRunRow[];
    }
}
