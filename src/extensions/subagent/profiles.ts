export type SubagentRunMode =
    | "sync"
    | "async"
    | "conversation";

export type SubagentProfile =
    | "none"
    | "io_read"
    | "io_write"
    | "execute_bash"
    | "execute_code"
    | "web_read"
    | "spawn_subagent";

export type ResolvedSubagentProfiles = {
    profiles: SubagentProfile[];
    tools: string[];
    instructions: string[];
};

export const subagentProfiles: Record<SubagentProfile, { tools: string[]; instructions: string[] }> = {
    none: {
        tools: [],
        instructions: ["You have access to no tools. Yet your persist"],
    },
    io_read: {
        tools: ["read", "ls", "find", "grep", "rg", "stat", "policy_info"],
        instructions: ["You have access to read-only IO tools"],
    },
    io_write: {
        tools: ["write", "edit", "delete", "copy", "move", "mkdir"],
        instructions: ["You have access to write IO tools"],
    },
    execute_bash: {
        tools: ["bash"],
        instructions: ["You have access to the bash execution tool, policy constraints may apply"],
    },
    execute_code: {
        tools: ["node_exec", "python_exec", "powershell_exec"],
        instructions: ["You have access to code execution environment tools"],
    },
    web_read: {
        tools: ["web_lookup"],
        instructions: ["You have access to web lookup and searching tools"],
    },
    spawn_subagent: {
        tools: ["subagent"],
        instructions: ["You have access to subagent delegation tools"],
    },
};

export function normalizeSubagentProfiles(input: unknown): SubagentProfile[] {
    if (input === undefined || input === null) return ["io_read"];
    const values = Array.isArray(input) ? input : [input];
    const profiles: SubagentProfile[] = [];

    for (const value of values) {
        if (typeof value !== "string") continue;
        if (isSubagentProfile(value) && !profiles.includes(value)) profiles.push(value);
    }

    return profiles.length > 0 ? profiles : ["io_read"];
}

export function isSubagentProfile(value: string): value is SubagentProfile {
    return Object.prototype.hasOwnProperty.call(subagentProfiles, value);
}

export function resolveSubagentProfiles(profiles: SubagentProfile[]): ResolvedSubagentProfiles {
    const tools = new Set<string>();
    const instructions: string[] = [];

    for (const profile of profiles) {
        const definition = subagentProfiles[profile];
        for (const tool of definition.tools) tools.add(tool);
        instructions.push(...definition.instructions);
    }

    return {profiles, tools: [...tools], instructions};
}

export function defaultTimeoutSecondsForMode(mode: SubagentRunMode): number {
    switch (mode) {
        case "sync":
            return 120;
        case "async":
            return 900;
        case "conversation":
            return 120;
    }
}
