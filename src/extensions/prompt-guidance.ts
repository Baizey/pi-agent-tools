import {BuildSystemPromptOptions, PiExtensionApi} from "../pi/types";
import {toolNames} from "../shared/toolNames";

export const agentToolsGuidanceHeader = "### pi-agent-tools usage guidance";

export function registerAgentToolsPromptGuidance(pi: PiExtensionApi): void {
    pi.on("before_agent_start", (event) => {
        if (event.systemPrompt.includes(agentToolsGuidanceHeader)) return;

        const guidance = buildAgentToolsPromptGuidance(event.systemPromptOptions);
        if (!guidance) return;

        return {systemPrompt: `${event.systemPrompt}\n\n${guidance}`};
    });
}

export function buildAgentToolsPromptGuidance(options: BuildSystemPromptOptions = {}): string | null {
    const hasTool = (name: string) => isToolSelected(options.selectedTools, name);
    const sections: string[] = [];

    if ([
        toolNames.read,
        toolNames.write,
        toolNames.edit,
        toolNames.copy,
        toolNames.delete,
        toolNames.mkdir,
        toolNames.move,
        toolNames.stat,
    ].some(hasTool)) {
        sections.push([
            "Filesystem tools:",
            "- Prefer structured file tools over bash for filesystem reads and mutations.",
            "- Use read/stat before mutating when current contents, type, or existence matter.",
            "- Use edit for precise text replacement; merge nearby edits in one edit call and keep oldText exact.",
            "- Use write only for new files or intentional full rewrites.",
            "- Use copy/move/mkdir/delete for filesystem operations; set overwrite/recursive only when explicitly needed.",
        ].join("\n"));
    }

    if ([toolNames.policyInfo].some(hasTool)) {
        sections.push([
            "Policy tools:",
            "- Use policy_info to inspect active policies or evaluate an exact path, shell command, code scope, or URL before retrying blocked work.",
            "- Tell the user to run /policy-default when they ask to change session default allow/deny/ask behavior for unmatched policy checks.",
            "- Policies and their approval system are invisible to you and are either automated or human-approved.",
        ].join("\n"));
    }

    if ([toolNames.executeCode, toolNames.executeCodeInfo, toolNames.bash].some(hasTool)) {
        const bashConstraint = hasTool(toolNames.bash) ?
            "- NEVER use bash for code execution, policies will default at denying you"
            : ""
        
        sections.push([
            "Code execution tools:",
            "- Use execute_code for short scripts or source-file runs when direct runtime execution is clearer than shell.",
            "- Use execute_code_info first when runtime availability or supported modes are uncertain.",
            "- Always provide a concise purpose; prefer inline mode for small throwaway snippets and file mode for existing source files.",
            bashConstraint
        ].join("\n"));
    }

    if (hasTool(toolNames.webLookup)) {
        sections.push([
            "Web lookup:",
            "- Use web_lookup with query for discovery, then fetch specific URLs with url when source details matter.",
            "- Keep maxResults small unless the task needs breadth; use raw only when HTML structure is needed.",
        ].join("\n"));
    }

    if (hasTool(toolNames.localSql)) {
        sections.push([
            "Local SQL:",
            "- Use local_sql action=schema before writing queries against the local session database.",
            "- Use readonly SELECT/WITH queries with named params and a purpose.",
            "- Treat local_sql results as historical session memory, not live project state.",
            "- The session tables will also contain any of your subagents that have finished, including their results",
        ].join("\n"));
    }

    if ([
        toolNames.subagentSpawn,
        toolNames.subagentStatus,
        toolNames.subagentAwait,
        toolNames.subagentMessage,
        toolNames.subagentCancel,
    ].some(hasTool)) {
        sections.push([
            "Subagents:",
            "- Use subagent_spawn for independent research, review, or parallelizable investigation.",
            "- Always provide a concise required persona for each subagent; it is shown in orchestration/status views.",
            "- Choose least-privilege toolkits; subagents cannot request extra interactive permissions.",
            "- Omit toolkits or pass an empty list for no tools; there is no 'none' toolkit.",
            "- Use the 'meta' toolkit for harness introspection tools like policy_info and local_sql.",
            "- Use async mode for parallel work, conversation mode for an iterative delegated thread, and sync mode for one-shot delegation.",
            "- Use subagent_status/subagent_await to collect async results, subagent_message to continue idle conversations, and subagent_cancel when done or obsolete.",
            "- subagent_await waits 30 seconds by default; if jobs are still running, use the returned status lines to decide whether to await again or continue.",
            "- Pass cwd, contextPaths, and systemPrompt when they help constrain the delegated task.",
            "- Prefer over-utilizing subagents; for any substantial search or research task it can be recommended to use subagents",
            "- Prefer using conversation mode, outside of known '1-shot' tasks it is always better for you in the long run",
            "- Always consider using a subagent for rubber-ducking and reasoning, also utilize it for reviewing changes you made"
        ].join("\n"));
    }

    if (sections.length === 0) return null;
    return `${agentToolsGuidanceHeader}\n${sections.join("\n\n")}`;
}

function isToolSelected(selectedTools: Array<string | { name?: string }> | undefined, name: string): boolean {
    if (!selectedTools) return true;
    return selectedTools.some((tool) => typeof tool === "string" ? tool === name : tool.name === name);
}
