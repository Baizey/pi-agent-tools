export const subagentRunModes = {
    sync: "sync",
    async: "async",
    conversation: "conversation",
} as const;

export type SubagentRunMode = typeof subagentRunModes[keyof typeof subagentRunModes];

export const subagentProfileNames = {
    meta: "meta",
    ioRead: "io_read",
    ioWrite: "io_write",
    executeBash: "execute_bash",
    executeCode: "execute_code",
    webRead: "web_read",
    spawnSubagent: "spawn_subagent",
} as const;

export type SubagentProfile = typeof subagentProfileNames[keyof typeof subagentProfileNames];
