export const toolNames = {
    // builtin
    bash: "bash",
    write: "write",
    edit: "edit",
    read: "read",

    // io expansion
    copy: "copy",
    delete: "delete",
    mkdir: "mkdir",
    move: "move",
    stat: "stat",

    // policy expansion
    policyInfo: "policy_info",

    // local data expansion
    localSql: "local_sql",

    // subagent expansion
    subagentSpawn: "subagent_spawn",
    subagentAwait: "subagent_await",
    subagentCancel: "subagent_cancel",
    subagentMessage: "subagent_message",
    subagentStatus: "subagent_status",

    // code execution expansion
    executeCode: "execute_code",
    executeCodeInfo: "execute_code_info",

    // web expansion
    webLookup: "web_lookup",
} as const;

export type ToolName = typeof toolNames[keyof typeof toolNames];
