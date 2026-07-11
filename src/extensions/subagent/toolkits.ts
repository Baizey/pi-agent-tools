import {ToolName} from "../../shared/toolNames";
import {SubagentRunMode, SubagentToolkitName} from "../../shared/subagents";

export {SubagentRunMode, SubagentToolkitName};

export type ResolvedSubagentToolkits = {
    toolkits: SubagentToolkitName[];
    tools: string[];
    instructions: string[];
};

export const subagentToolkits: Record<SubagentToolkitName, { tools: string[]; instructions: string[] }> = {
    [SubagentToolkitName.meta]: {
        tools: [ToolName.policyInfo, ToolName.localSql],
        instructions: ["You have access to harness metadata and introspection tools"],
    },
    [SubagentToolkitName.ioRead]: {
        tools: [ToolName.read, ToolName.stat],
        instructions: ["You have access to read-only IO tools"],
    },
    [SubagentToolkitName.ioWrite]: {
        tools: [ToolName.write, ToolName.edit, ToolName.delete, ToolName.copy, ToolName.move, ToolName.mkdir],
        instructions: ["You have access to write IO tools"],
    },
    [SubagentToolkitName.executeBash]: {
        tools: [ToolName.bash],
        instructions: ["You have access to the bash execution tool, policy constraints may apply"],
    },
    [SubagentToolkitName.executeCode]: {
        tools: [ToolName.executeCode, ToolName.executeCodeInfo],
        instructions: ["You have access to structured code execution tools"],
    },
    [SubagentToolkitName.webRead]: {
        tools: [ToolName.webLookup],
        instructions: ["You have access to web lookup and searching tools"],
    },
    [SubagentToolkitName.spawnSubagent]: {
        tools: [
            ToolName.subagentSpawn,
            ToolName.subagentSpawnPersona,
            ToolName.availablePersonas,
            ToolName.subagentStatus,
            ToolName.subagentMessage,
            ToolName.subagentStop,
        ],
        instructions: ["You have access to subagent delegation and persona discovery/spawn tools"],
    },
};

export function normalizeSubagentToolkits(input: unknown): SubagentToolkitName[] {
    if (input === undefined || input === null) return [];
    const values = Array.isArray(input) ? input : [input];
    const toolkits: SubagentToolkitName[] = [];

    for (const value of values) {
        if (typeof value !== "string") continue;
        if (isSubagentToolkit(value) && !toolkits.includes(value)) toolkits.push(value);
    }

    return toolkits;
}

export function isSubagentToolkit(value: string): value is SubagentToolkitName {
    return Object.prototype.hasOwnProperty.call(subagentToolkits, value);
}

export function applySubagentToolkitCeiling(
    requestedToolkits: SubagentToolkitName[],
    ceilingToolkits: SubagentToolkitName[] | null,
): SubagentToolkitName[] {
    if (!ceilingToolkits) return requestedToolkits;
    const ceiling = new Set(ceilingToolkits);
    return requestedToolkits.filter((toolkit) => ceiling.has(toolkit));
}

export function serializeSubagentToolkitCeiling(toolkits: SubagentToolkitName[]): string {
    return toolkits.join(",");
}

export function parseSubagentToolkitCeiling(value: string | undefined): SubagentToolkitName[] | null {
    if (value === undefined) return null;
    return value
        .split(",")
        .map((toolkit) => toolkit.trim())
        .filter(isSubagentToolkit);
}

export function resolveSubagentToolkits(toolkits: SubagentToolkitName[]): ResolvedSubagentToolkits {
    const tools = new Set<string>();
    const instructions: string[] = [];

    for (const toolkit of toolkits) {
        const definition = subagentToolkits[toolkit];
        for (const tool of definition.tools) tools.add(tool);
        instructions.push(...definition.instructions);
    }

    return {
        toolkits,
        tools: [...tools],
        instructions: instructions.length > 0 ? instructions : ["You have access to no tools."],
    };
}

export const defaultSubagentTimeoutSeconds = 15 * 60;

export function defaultTimeoutSecondsForMode(mode: SubagentRunMode): number {
    switch (mode) {
        case SubagentRunMode.sync:
        case SubagentRunMode.async:
        case SubagentRunMode.conversation:
            return defaultSubagentTimeoutSeconds;
    }
}
