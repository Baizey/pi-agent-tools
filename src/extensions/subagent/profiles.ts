import {toolNames} from "../../shared/toolNames";

export const subagentRunModes = {
    sync: "sync",
    async: "async",
    conversation: "conversation",
} as const;

export type SubagentRunMode = typeof subagentRunModes[keyof typeof subagentRunModes];

export const subagentProfileNames = {
    none: "none",
    ioRead: "io_read",
    ioWrite: "io_write",
    executeBash: "execute_bash",
    executeCode: "execute_code",
    webRead: "web_read",
    spawnSubagent: "spawn_subagent",
} as const;

export type SubagentProfile = typeof subagentProfileNames[keyof typeof subagentProfileNames];

export type ResolvedSubagentProfiles = {
    profiles: SubagentProfile[];
    tools: string[];
    instructions: string[];
};

export const subagentProfiles: Record<SubagentProfile, { tools: string[]; instructions: string[] }> = {
    [subagentProfileNames.none]: {
        tools: [],
        instructions: ["You have access to no tools."],
    },
    [subagentProfileNames.ioRead]: {
        tools: [toolNames.read, toolNames.stat, toolNames.policyInfo],
        instructions: ["You have access to read-only IO tools"],
    },
    [subagentProfileNames.ioWrite]: {
        tools: [toolNames.write, toolNames.edit, toolNames.delete, toolNames.copy, toolNames.move, toolNames.mkdir],
        instructions: ["You have access to write IO tools"],
    },
    [subagentProfileNames.executeBash]: {
        tools: [toolNames.bash],
        instructions: ["You have access to the bash execution tool, policy constraints may apply"],
    },
    [subagentProfileNames.executeCode]: {
        tools: [toolNames.executeCode, toolNames.executeCodeInfo],
        instructions: ["You have access to structured code execution tools"],
    },
    [subagentProfileNames.webRead]: {
        tools: [toolNames.webLookup],
        instructions: ["You have access to web lookup and searching tools"],
    },
    [subagentProfileNames.spawnSubagent]: {
        tools: [
            toolNames.subagentSpawn,
            toolNames.subagentStatus,
            toolNames.subagentAwait,
            toolNames.subagentMessage,
            toolNames.subagentCancel,
        ],
        instructions: ["You have access to subagent delegation tools"],
    },
};

export function normalizeSubagentProfiles(input: unknown): SubagentProfile[] {
    if (input === undefined || input === null) return [subagentProfileNames.none];
    const values = Array.isArray(input) ? input : [input];
    const profiles: SubagentProfile[] = [];

    for (const value of values) {
        if (typeof value !== "string") continue;
        if (isSubagentProfile(value) && !profiles.includes(value)) profiles.push(value);
    }

    return profiles.length > 0 ? profiles : [subagentProfileNames.none];
}

export function isSubagentProfile(value: string): value is SubagentProfile {
    return Object.prototype.hasOwnProperty.call(subagentProfiles, value);
}

export function applySubagentProfileCeiling(
    requestedProfiles: SubagentProfile[],
    ceilingProfiles: SubagentProfile[] | null,
): SubagentProfile[] {
    if (!ceilingProfiles) return requestedProfiles;
    const ceiling = new Set(ceilingProfiles);
    const allowed = requestedProfiles.filter((profile) => ceiling.has(profile));
    return allowed.length > 0 ? allowed : [subagentProfileNames.none];
}

export function serializeSubagentProfileCeiling(profiles: SubagentProfile[]): string {
    return profiles.join(",");
}

export function parseSubagentProfileCeiling(value: string | undefined): SubagentProfile[] | null {
    if (!value) return null;
    const profiles = value
        .split(",")
        .map((profile) => profile.trim())
        .filter(isSubagentProfile);
    return profiles.length > 0 ? profiles : [subagentProfileNames.none];
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
        case subagentRunModes.sync:
            return 120;
        case subagentRunModes.async:
            return 900;
        case subagentRunModes.conversation:
            return 120;
    }
}
