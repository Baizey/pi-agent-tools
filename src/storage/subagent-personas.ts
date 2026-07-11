import {Orm, SortDirection, column, table, type Row} from "./orm";
import {SqliteDatabase} from "./sqlite";
import {
    SubagentPersonaSource,
    SubagentRunMode,
    SubagentToolkitName,
} from "../shared/subagents";

export const subagentPersonaNamePattern = /^[a-z0-9][a-z0-9_-]*$/;

export const subagentPersonas = table("subagent_personas", {
    name: column.text().primaryKey(),
    role: column.text().notNull(),
    description: column.text().notNull(),
    mode: column.text().notNull(),
    model: column.text().notNull(),
    toolkits: column.json<SubagentToolkitName[]>().notNull(),
    systemPrompt: column.text().notNull(),
    source: column.text().notNull(),
    enabled: column.boolean().notNull(),
    createdAt: column.date().notNull(),
    updatedAt: column.date().notNull(),
});

type StoredSubagentPersonaRow = Row<typeof subagentPersonas>;

export type SubagentPersonaRow = Omit<StoredSubagentPersonaRow, "mode" | "source" | "toolkits"> & {
    mode: SubagentRunMode;
    source: SubagentPersonaSource;
    toolkits: SubagentToolkitName[];
};

export type SubagentPersonaDefinition = Omit<SubagentPersonaRow, "createdAt" | "updatedAt">;

export type UpsertSubagentPersonaInput = Omit<SubagentPersonaDefinition, "enabled"> & {
    enabled?: boolean;
} & Partial<Pick<SubagentPersonaRow, "createdAt" | "updatedAt">>;

export type ListSubagentPersonasOptions = {
    enabled?: boolean;
    source?: SubagentPersonaSource;
};

export const builtinSubagentPersonas = [
    {
        name: "reviewer",
        role: "code reviewer",
        description: [
            "Reviews code and repository changes for correctness, risks, and maintainability.",
            "You must provide a complete spec for the feature being reviewed.",
        ].join("\n"),
        mode: SubagentRunMode.conversation,
        model: "reasoning_high",
        toolkits: [SubagentToolkitName.meta, SubagentToolkitName.ioRead, SubagentToolkitName.executeBash],
        systemPrompt: [
            "You are a focused code reviewer.",
            "Inspect the provided task and repository context for bugs, regressions, missing tests, and maintainability risks.",
            "Prefer concrete findings with file paths and concise rationale. Do not edit files.",
            "Call out shortcuts that violate the provided specification.",
        ].join("\n"),
        source: SubagentPersonaSource.builtin,
        enabled: true,
    },
    {
        name: "researcher",
        role: "web researcher",
        description: [
            "Performs web research and summarizes relevant external information with sources.",
            "You can provide concrete or broad research goals.",
        ].join("\n"),
        mode: SubagentRunMode.conversation,
        model: "reasoning_high",
        toolkits: [SubagentToolkitName.meta, SubagentToolkitName.webRead],
        systemPrompt: [
            "You are a careful web researcher.",
            "Look up relevant current information, compare sources when useful, and summarize findings clearly.",
            "Include source URLs or names for important claims. Do not use filesystem or code execution tools.",
        ].join("\n"),
        source: SubagentPersonaSource.builtin,
        enabled: true,
    },
    {
        name: "planner",
        role: "implementation planner",
        description: "Breaks down implementation work into clear design notes, steps, and risks.",
        mode: SubagentRunMode.conversation,
        model: "reasoning_high",
        toolkits: [SubagentToolkitName.meta, SubagentToolkitName.ioRead, SubagentToolkitName.executeBash],
        systemPrompt: [
            "You are an implementation planner.",
            "Analyze the task, inspect read-only context when helpful, and produce a concise plan with risks and validation steps.",
            "Do not edit files or run commands that change state.",
        ].join("\n"),
        source: SubagentPersonaSource.builtin,
        enabled: true,
    },
    {
        name: "rubber-duck",
        role: "rubber-duck reasoning partner",
        description: "Helps reason through problems conversationally without tools.",
        mode: SubagentRunMode.conversation,
        model: "reasoning_low",
        toolkits: [],
        systemPrompt: [
            "You are a rubber-duck reasoning partner.",
            "Ask clarifying questions when useful, reflect assumptions, and help the user reason toward a solution.",
            "Stay concise and do not claim access to tools or external context.",
        ].join("\n"),
        source: SubagentPersonaSource.builtin,
        enabled: true,
    },
] satisfies readonly SubagentPersonaDefinition[];

const builtinPersonaNames = new Set<string>(builtinSubagentPersonas.map(persona => persona.name));

export function isValidSubagentPersonaName(value: string): boolean {
    return subagentPersonaNamePattern.test(value);
}

export function normalizeSubagentPersonaName(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const name = value.trim();
    return isValidSubagentPersonaName(name) ? name : undefined;
}

export function validateSubagentPersonaName(value: unknown): string {
    if (typeof value === "string" && isValidSubagentPersonaName(value)) return value;
    throw new Error("Invalid subagent persona name. Expected lowercase id matching ^[a-z0-9][a-z0-9_-]*$.");
}

export function isBuiltinSubagentPersonaName(value: string): boolean {
    return builtinPersonaNames.has(value);
}

export class SubagentPersonaDao {
    private readonly orm: Orm;
    private schemaInitialized = false;

    constructor(private readonly db: SqliteDatabase) {
        this.orm = new Orm(db);
    }

    initializeSchema() {
        if (this.schemaInitialized) return this;
        this.db.exec(`
            create table if not exists "subagent_personas"
            (
                "name"         text primary key,
                "role"         text    not null,
                "description"  text    not null,
                "mode"         text    not null check ("mode" in (${sqliteStringList(Object.values(SubagentRunMode))})),
                "model"        text    not null,
                "toolkits"     text    not null,
                "systemPrompt" text    not null,
                "source"       text    not null check ("source" in (${sqliteStringList(Object.values(SubagentPersonaSource))})),
                "enabled"      integer not null,
                "createdAt"    integer not null,
                "updatedAt"    integer not null
            );

            create index if not exists "idx_subagent_personas_enabled_name"
                on "subagent_personas" ("enabled", "name");
            create index if not exists "idx_subagent_personas_source_name"
                on "subagent_personas" ("source", "name");
        `);
        this.schemaInitialized = true;
        return this;
    }

    seedBuiltinPersonas(personas: readonly SubagentPersonaDefinition[] = builtinSubagentPersonas): SubagentPersonaRow[] {
        this.initializeSchema();
        const run = this.db.transaction((items: readonly SubagentPersonaDefinition[]) => items.map(persona => this.seedBuiltinPersona(persona)));
        return run(personas);
    }

    upsertBuiltinPersona(persona: SubagentPersonaDefinition): SubagentPersonaRow {
        return this.upsertPersona({...persona, source: SubagentPersonaSource.builtin});
    }

    private seedBuiltinPersona(persona: SubagentPersonaDefinition): SubagentPersonaRow {
        const row = this.normalizeInput({...persona, source: SubagentPersonaSource.builtin});
        const existing = this.getPersona(row.name);
        if (existing && existing.source !== SubagentPersonaSource.builtin) {
            throw new Error(`Cannot seed builtin over non-builtin subagent persona: ${row.name}`);
        }

        const desired = {...row, enabled: existing?.enabled ?? row.enabled};
        if (existing && sameSubagentPersonaConfig(existing, desired)) return existing;

        return this.upsertPersona({...desired, createdAt: existing?.createdAt});
    }

    upsertPersona(input: UpsertSubagentPersonaInput): SubagentPersonaRow {
        this.initializeSchema();
        const row = this.normalizeInput(input);
        const existing = this.getPersona(row.name);

        if (row.source !== SubagentPersonaSource.builtin && builtinPersonaNames.has(row.name)) {
            throw new Error(`Subagent persona name is reserved for a builtin: ${row.name}`);
        }
        if (row.source !== SubagentPersonaSource.builtin && existing?.source === SubagentPersonaSource.builtin) {
            throw new Error(`Cannot overwrite builtin subagent persona: ${row.name}`);
        }

        const now = new Date();
        const stored = {
            ...row,
            createdAt: input.createdAt ?? existing?.createdAt ?? now,
            updatedAt: input.updatedAt ?? now,
        } satisfies SubagentPersonaRow;

        this.orm.upsert(subagentPersonas, stored, ["name"], [
            "role",
            "description",
            "mode",
            "model",
            "toolkits",
            "systemPrompt",
            "source",
            "enabled",
            "updatedAt",
        ]);

        return this.getPersona(stored.name) ?? stored;
    }

    getPersona(name: unknown, options: { enabled?: boolean } = {}): SubagentPersonaRow | undefined {
        this.initializeSchema();
        const normalizedName = normalizeSubagentPersonaName(name);
        if (!normalizedName) return undefined;
        const where: Partial<StoredSubagentPersonaRow> = {name: normalizedName};
        if (options.enabled !== undefined) where.enabled = options.enabled;
        return this.orm.get(subagentPersonas, where) as SubagentPersonaRow | undefined;
    }

    getEnabledPersona(name: unknown): SubagentPersonaRow | undefined {
        return this.getPersona(name, {enabled: true});
    }

    listPersonas(options: ListSubagentPersonasOptions = {}): SubagentPersonaRow[] {
        this.initializeSchema();
        const where: Partial<StoredSubagentPersonaRow> = {};
        if (options.enabled !== undefined) where.enabled = options.enabled;
        if (options.source !== undefined) {
            assertSubagentPersonaSource(options.source);
            where.source = options.source;
        }
        return this.orm.all(subagentPersonas, where, {
            orderBy: {
                column: "name",
                direction: SortDirection.ASC
            }
        }) as SubagentPersonaRow[];
    }

    listEnabledPersonas(): SubagentPersonaRow[] {
        return this.listPersonas({enabled: true});
    }

    private normalizeInput(input: UpsertSubagentPersonaInput): SubagentPersonaDefinition {
        const name = validateSubagentPersonaName(input.name);
        const role = requiredText(input.role, "role");
        const description = requiredText(input.description, "description");
        const mode = assertSubagentRunMode(input.mode);
        const model = requiredText(input.model, "model");
        const toolkits = normalizeToolkits(input.toolkits);
        const systemPrompt = requiredText(input.systemPrompt, "systemPrompt");
        const source = assertSubagentPersonaSource(input.source);
        const enabled = input.enabled ?? true;

        return {name, role, description, mode, model, toolkits, systemPrompt, source, enabled};
    }
}

export {SubagentPersonaDao as SubagentPersonaRegistry};

export function initializeSubagentPersonaRegistry(db: SqliteDatabase, options: {
    seedBuiltins?: boolean
} = {}): SubagentPersonaDao {
    const dao = new SubagentPersonaDao(db).initializeSchema();
    if (options.seedBuiltins) dao.seedBuiltinPersonas();
    return dao;
}

export function seedBuiltinSubagentPersonas(db: SqliteDatabase): SubagentPersonaRow[] {
    return new SubagentPersonaDao(db).initializeSchema().seedBuiltinPersonas();
}

export function upsertSubagentPersona(db: SqliteDatabase, input: UpsertSubagentPersonaInput): SubagentPersonaRow {
    return new SubagentPersonaDao(db).initializeSchema().upsertPersona(input);
}

export function upsertBuiltinSubagentPersona(db: SqliteDatabase, persona: SubagentPersonaDefinition): SubagentPersonaRow {
    return new SubagentPersonaDao(db).initializeSchema().upsertBuiltinPersona(persona);
}

export function getSubagentPersona(db: SqliteDatabase, name: unknown, options: {
    enabled?: boolean
} = {}): SubagentPersonaRow | undefined {
    return new SubagentPersonaDao(db).initializeSchema().getPersona(name, options);
}

export function listSubagentPersonas(db: SqliteDatabase, options: ListSubagentPersonasOptions = {}): SubagentPersonaRow[] {
    return new SubagentPersonaDao(db).initializeSchema().listPersonas(options);
}

function requiredText(value: unknown, field: string): string {
    if (typeof value !== "string") throw new Error(`Subagent persona ${field} is required.`);
    const text = value.trim();
    if (!text) throw new Error(`Subagent persona ${field} is required.`);
    return text;
}

function assertSubagentRunMode(value: unknown): SubagentRunMode {
    const mode = Object.values(SubagentRunMode).find((candidate) => candidate === value);
    if (mode) return mode;
    throw new Error(`Invalid subagent persona mode: ${String(value)}`);
}

function assertSubagentPersonaSource(value: unknown): SubagentPersonaSource {
    const source = Object.values(SubagentPersonaSource).find((candidate) => candidate === value);
    if (source) return source;
    throw new Error(`Invalid subagent persona source: ${String(value)}`);
}

function normalizeToolkits(value: unknown): SubagentToolkitName[] {
    if (!Array.isArray(value)) throw new Error("Subagent persona toolkits must be an array.");
    const toolkits: SubagentToolkitName[] = [];
    for (const toolkit of value) {
        const normalized = Object.values(SubagentToolkitName).find((candidate) => candidate === toolkit);
        if (!normalized) throw new Error(`Invalid subagent persona toolkit: ${String(toolkit)}`);
        if (!toolkits.includes(normalized)) toolkits.push(normalized);
    }
    return toolkits;
}

function sameSubagentPersonaConfig(existing: SubagentPersonaRow, desired: SubagentPersonaDefinition): boolean {
    return existing.name === desired.name
        && existing.role === desired.role
        && existing.description === desired.description
        && existing.mode === desired.mode
        && existing.model === desired.model
        && sameStringArray(existing.toolkits, desired.toolkits)
        && existing.systemPrompt === desired.systemPrompt
        && existing.source === desired.source
        && existing.enabled === desired.enabled;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sqliteStringList(values: readonly string[]): string {
    return values.map(value => `'${value.replace(/'/g, "''")}'`).join(", ");
}
