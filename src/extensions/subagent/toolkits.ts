import {toolNames} from "../../shared/toolNames";
import {subagentToolkitNames, subagentRunModes, type SubagentToolkit, type SubagentRunMode} from "../../shared/subagents";

export {subagentToolkitNames, subagentRunModes, type SubagentToolkit, type SubagentRunMode};

export type ResolvedSubagentToolkits = {
    toolkits: SubagentToolkit[];
    tools: string[];
    instructions: string[];
};

export const subagentToolkits: Record<SubagentToolkit, { tools: string[]; instructions: string[] }> = {
    [subagentToolkitNames.meta]: {
        tools: [toolNames.policyInfo, toolNames.localSql],
        instructions: ["You have access to harness metadata and introspection tools"],
    },
    [subagentToolkitNames.ioRead]: {
        tools: [toolNames.read, toolNames.stat],
        instructions: ["You have access to read-only IO tools"],
    },
    [subagentToolkitNames.ioWrite]: {
        tools: [toolNames.write, toolNames.edit, toolNames.delete, toolNames.copy, toolNames.move, toolNames.mkdir],
        instructions: ["You have access to write IO tools"],
    },
    [subagentToolkitNames.executeBash]: {
        tools: [toolNames.bash],
        instructions: ["You have access to the bash execution tool, policy constraints may apply"],
    },
    [subagentToolkitNames.executeCode]: {
        tools: [toolNames.executeCode, toolNames.executeCodeInfo],
        instructions: ["You have access to structured code execution tools"],
    },
    [subagentToolkitNames.webRead]: {
        tools: [toolNames.webLookup],
        instructions: ["You have access to web lookup and searching tools"],
    },
    [subagentToolkitNames.spawnSubagent]: {
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

export function normalizeSubagentToolkits(input: unknown): SubagentToolkit[] {
    if (input === undefined || input === null) return [];
    const values = Array.isArray(input) ? input : [input];
    const toolkits: SubagentToolkit[] = [];

    for (const value of values) {
        if (typeof value !== "string") continue;
        if (isSubagentToolkit(value) && !toolkits.includes(value)) toolkits.push(value);
    }

    return toolkits;
}

export function isSubagentToolkit(value: string): value is SubagentToolkit {
    return Object.prototype.hasOwnProperty.call(subagentToolkits, value);
}

export function applySubagentToolkitCeiling(
    requestedToolkits: SubagentToolkit[],
    ceilingToolkits: SubagentToolkit[] | null,
): SubagentToolkit[] {
    if (!ceilingToolkits) return requestedToolkits;
    const ceiling = new Set(ceilingToolkits);
    return requestedToolkits.filter((toolkit) => ceiling.has(toolkit));
}

export function serializeSubagentToolkitCeiling(toolkits: SubagentToolkit[]): string {
    return toolkits.join(",");
}

export function parseSubagentToolkitCeiling(value: string | undefined): SubagentToolkit[] | null {
    if (value === undefined) return null;
    return value
        .split(",")
        .map((toolkit) => toolkit.trim())
        .filter(isSubagentToolkit);
}

export function resolveSubagentToolkits(toolkits: SubagentToolkit[]): ResolvedSubagentToolkits {
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
        case subagentRunModes.sync:
        case subagentRunModes.async:
        case subagentRunModes.conversation:
            return defaultSubagentTimeoutSeconds;
    }
}
