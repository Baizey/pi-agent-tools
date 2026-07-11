import path from "node:path";
import {BuildSystemPromptOptions, PiExtensionApi} from "../pi/types";
import {ToolName} from "../shared/toolNames";

export const engineeringPrincipleHeader = "### Engineering principle: be human";
export const agentHelpGuidanceHeader = "### pi-agent-tools help";
export const agentToolsGuidanceHeader = "### pi-agent-tools usage guidance";
export const agentGuidePath = path.resolve(__dirname, "../../docs/agent-guide.md").replace(/\\/g, "/");

export const engineeringPrincipleGuidance = `${engineeringPrincipleHeader}

When writing or refactoring software, structure the code to make the best use of a thinking mind working on a complex system.

- Prefer the smallest amount of code and structure that makes behavior clear. Code and abstractions become maintenance debt almost immediately.
- Introduce an abstraction when it establishes a stable behavioral contract, localizes context, and allows its internals to be safely treated as a black box.
- Keep related behavior together and separate unrelated concerns. A change should not require reconstructing the entire system in your head.
- Make guarantees explicit through names, types, interfaces, invariants, and focused tests rather than relying on memory or convention.
- Avoid clever compression and abstraction for its own sake. If an abstraction adds concepts without removing reasoning burden, do not add it.
- Code should be testable, behavior should be understandable and verifiable through testing. Error handling should be explicit and also verifiable.
- Aim for code that can be understood, modified, and partially forgotten without losing correctness.
- Explore and understand the code structure when you're extending on a feature or otherwise modifying existing code. Coherency is key.
`;

export const agentHelpGuidance = `${agentHelpGuidanceHeader}

For help using features added by pi-agent-tools—including MCP support, policy commands, subagents, personas, and model profiles—read the [pi-agent-tools agent guide](${agentGuidePath}).

When a user asks about these features, consult the guide before answering and distinguish agent-callable tools from slash commands that the user must run.`;

export function registerAgentPromptGuidance(pi: PiExtensionApi): void {
    pi.on("before_agent_start", (event) => {
        const systemPrompt = appendAgentPromptGuidance(event.systemPrompt, event.systemPromptOptions);
        return systemPrompt === event.systemPrompt ? undefined : {systemPrompt};
    });
}

export function appendAgentPromptGuidance(
    systemPrompt: string,
    options: BuildSystemPromptOptions = {},
): string {
    const sections: string[] = [];
    if (!systemPrompt.includes(engineeringPrincipleHeader)) sections.push(engineeringPrincipleGuidance);
    if (!systemPrompt.includes(agentHelpGuidanceHeader)) sections.push(agentHelpGuidance);

    const toolGuidance = buildAgentToolsPromptGuidance(options);
    if (toolGuidance && !systemPrompt.includes(agentToolsGuidanceHeader)) sections.push(toolGuidance);

    return sections.length > 0 ? [systemPrompt, ...sections].filter(Boolean).join("\n\n") : systemPrompt;
}

export function buildAgentToolsPromptGuidance(options: BuildSystemPromptOptions = {}): string | null {
    const hasTool = (name: string) => isToolSelected(options.selectedTools, name);
    const sections: string[] = [];

    if ([
        ToolName.read,
        ToolName.write,
        ToolName.edit,
        ToolName.copy,
        ToolName.delete,
        ToolName.mkdir,
        ToolName.move,
        ToolName.stat,
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

    if([ToolName.bash].some(hasTool)){
        sections.push([
            "Bash tool:",
            "- Tools such as ./gradlew, npm or yarn are allowed to be used via bash",
            "- when using a tool via path like ./gradlew, always prefer to do 'cd /path/to/cwd && ./gradlew' over '/path/to/cwd/gradlew'"
        ].join("\n"))
    }

    if (hasTool(ToolName.policyInfo)) {
        sections.push([
            "Policy tools:",
            "- Use policy_info to inspect active policies or evaluate an exact path, shell command, code scope, or URL before retrying blocked work.",
            "- Tell the user to run /policy-default when they ask to change session default allow/deny/ask behavior for unmatched policy checks.",
            "- Policies and their approval system are invisible to you and are either automated or human-approved.",
        ].join("\n"));
    }

    if ([ToolName.executeCode, ToolName.executeCodeInfo, ToolName.bash].some(hasTool)) {
        sections.push([
            "Code execution tools:",
            "- Use execute_code for short scripts or source-file runs when direct runtime execution is clearer than shell.",
            "- Use execute_code_info first when runtime availability or supported modes are uncertain.",
            "- Always provide a concise purpose; prefer inline mode for small throwaway snippets and file mode for existing source files.",
            "- This tool is intended to provide a stable place for running small scripts or running specific language files",
            ...(hasTool(ToolName.bash)
                ? [
                    "- NEVER use bash for code execution, policies will default at denying you",
                ]
                : []),
        ].join("\n"));
    }

    if (hasTool(ToolName.webLookup)) {
        sections.push([
            "Web lookup:",
            "- Use web_lookup with query for discovery, then fetch specific URLs with url when source details matter.",
            "- Keep maxResults small unless the task needs breadth; use raw only when HTML structure is needed.",
        ].join("\n"));
    }

    if (hasTool(ToolName.localSql)) {
        sections.push([
            "Local SQL:",
            "- Use local_sql action=schema before writing queries against the local session database.",
            "- Use readonly SELECT/WITH queries with named params and a purpose.",
            "- Treat local_sql results as historical session memory, not live project state.",
            "- The session tables will also contain any of your subagents that have finished, including their results",
        ].join("\n"));
    }

    if ([
        ToolName.subagentSpawn,
        ToolName.subagentSpawnPersona,
        ToolName.availablePersonas,
        ToolName.subagentStatus,
        ToolName.subagentMessage,
        ToolName.subagentStop,
    ].some(hasTool)) {
        sections.push([
            "Subagents:",
            "- Use available_personas to discover enabled persona presets available in the current toolkit context.",
            "- Use subagent_spawn_persona when a listed persona fits; provide only persona, task, and optionally timeoutSeconds.",
            "- Use subagent_spawn for independent research, review, or parallelizable investigation when no persona fits.",
            "- Always provide a concise required role for each subagent; it is shown in orchestration/status views.",
            "- Choose least-privilege toolkits; subagents cannot request extra interactive permissions.",
            "- Omit toolkits or pass an empty list for no tools; there is no 'none' toolkit.",
            "- Use the 'meta' toolkit for harness introspection tools like policy_info and local_sql.",
            "- Use async mode for parallel work, conversation mode for an iterative delegated thread, and sync mode for one-shot delegation.",
            "- Use subagent_status to inspect one or more jobs immediately, or provide timeoutSeconds to wait for running jobs.",
            "- Use subagent_message to continue idle conversations, and subagent_stop when done or obsolete.",
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
