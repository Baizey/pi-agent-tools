export enum SubagentRunMode {
    sync = "sync",
    async = "async",
    conversation = "conversation",
}

export const subagentRunModes = SubagentRunMode;

export enum SubagentToolkitName {
    meta = "meta",
    ioRead = "io_read",
    ioWrite = "io_write",
    executeBash = "execute_bash",
    executeCode = "execute_code",
    webRead = "web_read",
    spawnSubagent = "spawn_subagent",
}

export const subagentToolkitNames = SubagentToolkitName;

export type SubagentToolkit = SubagentToolkitName;
