# pi-agent-tools agent guide

This guide explains how an agent should help a user understand and operate features added by `pi-agent-tools`.

## How to use this guide

When a user asks about this extension, its tools, policies, MCP support, subagents, personas, model profiles, or slash commands:

1. Read the relevant section here before answering.
2. Distinguish **agent-callable tools** from **user-invoked slash commands**.
3. Use an inspection tool when one exists; do not guess current configuration or runtime state.
4. When a slash command is needed, give the user the exact command and briefly explain its effect. Do not claim that the command ran unless the user ran it.
5. Prefer the smallest safe change. Explain persistence, reload requirements, and security consequences before suggesting configuration changes.

Slash-command argument completion is the canonical source for currently accepted actions and values. If uncertain, ask the user to type the command followed by a space and use Pi's completion UI.

## Tools versus slash commands

Tools are callable by the agent when active. Slash commands configure or display interactive Pi state and are normally entered by the user.

Important agent-callable capabilities include:

- Structured filesystem operations: `read`, `write`, `edit`, `delete`, `copy`, `move`, `mkdir`, and `stat`.
- Policy inspection: `policy_info`.
- Direct code execution: `execute_code` and `execute_code_info`.
- Web search and reading: `web_lookup`.
- Historical local session queries: `local_sql`.
- Scoped delegation: `available_personas`, `subagent_spawn`, `subagent_spawn_persona`, `subagent_status`, `subagent_await`, `subagent_message`, and `subagent_cancel`.
- Exposed MCP tools, registered with names based on `mcp_<server>_<tool>`.

Use the tools for work the agent can perform directly. Recommend slash commands when the user needs to change interactive configuration, inspect UI-managed state, or make a policy decision.

## MCP server support

MCP configuration is stored in:

```text
~/.pi/agent/mcp.json
```

Supported transports are:

- `stdio`: command, arguments, and optional environment variables.
- `http`: Streamable HTTP URL and optional headers.

MCP tools default to **not exposed**. A server's `tools.expose` list allows selected tools; `"*"` exposes all discovered tools except entries in `tools.hide`.

Example:

```json
{
  "servers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Repositories"],
      "tools": {
        "expose": ["read_file", "list_directory"],
        "hide": []
      }
    }
  }
}
```

Do not expose every tool by default. Help the user expose only the tools needed for their workflow, especially for servers with mutation, credential, network, or process capabilities.

### MCP slash commands

```text
/mcp
/mcp show [all|server]
/mcp connect [all|server]
/mcp disconnect [all|server]
/mcp refresh [all|server]
/mcp expose <server> <tool...|*>
/mcp hide <server> <tool...|*>
/mcp reset <server> [tool...|*]
```

Recommended workflow:

1. `/mcp show all` — inspect configured servers, connection state, discovered tools, and exposure.
2. `/mcp connect <server>` — connect and discover tools.
3. `/mcp expose <server> <tool>` — expose only required tools.
4. `/mcp refresh <server>` — reconnect and rediscover after server-side changes.
5. `/mcp hide <server> <tool>` — block calls immediately.

Pi currently has no public tool-unregister API. A hidden tool that was already registered can remain visible until `/reload`, although calls are blocked immediately.

When troubleshooting MCP, ask for or inspect:

- `/mcp show <server>` output.
- The relevant redacted server entry from `mcp.json`.
- Whether the server process or HTTP endpoint works independently.
- Whether the tool is discovered but not exposed, exposed but not registered, or registered but failing at call time.

Never ask the user to paste secrets. Headers, environment variables, and command arguments may contain credentials.

## Policy commands

Use `policy_info` when the agent needs to inspect active policy behavior or evaluate a concrete path, shell command, code scope, or URL. Slash commands are for user-directed policy management.

### Session defaults

`/policy-default` controls what happens when no explicit policy matches. It does not override an explicit matching policy.

```text
/policy-default show
/policy-default allow <target...> [--scope root|subagents|all]
/policy-default deny <target...> [--scope root|subagents|all]
/policy-default ask <target...> [--scope root|subagents|all]
/policy-default reset <target...> [--scope root|subagents|all]
```

Targets include `all`, `io`, `io_read`, `io_write`, `io_execute`, `shell`, `code`, `web`, `web_read`, and `web_search`.

Use session defaults for temporary broad behavior. Use explicit policies for durable, narrowly scoped decisions.

### Explicit policies

```text
/policy [show [all|io|shell|code|web]]
/policy clear <io|shell|code|web> --yes

/policy-io <show|eval|allow|deny|remove|clear> ...
/policy-shell <show|eval|allow|deny|remove|clear> ...
/policy-code <show|eval|allow|deny|remove|clear> ...
/policy-web <show|eval|allow|deny|remove|clear> ...
```

Common options include:

- `--lifetime session|forever`
- `--reason <text>`
- `--yes` for destructive clears

Shell policy commands additionally support options such as `--flag`, `--all-flags`, and `--entire` where applicable.

Guidance:

- Prefer `eval` before adding a policy when scope is uncertain.
- Prefer session lifetime unless the user clearly wants persistence.
- Explain the exact path, command core, language/mode, or domain/path being allowed or denied.
- Never recommend broad forever policies merely to bypass an error.
- Clearing requires `--yes` and should be treated as destructive.

## Subagents, personas, and model profiles

The agent should normally use subagent tools directly. Slash commands expose configuration and UI state to the user.

### Subagent UI

```text
/subagents [on|off] [running|done|all]
```

This controls the persistent orchestration widget. With no arguments it toggles the widget.

### Persona inspection

```text
/personas
/personas list
/personas show <name>
```

Use `available_personas` before spawning a persona. Use `/personas show <name>` when the user wants to inspect the complete stored preset, including its system prompt.

### Model profile configuration

```text
/model-profiles
/model-profiles <text_low|text_high|reasoning_low|reasoning_high> <auto|provider/model>
/model-profiles reset [text_low|text_high|reasoning_low|reasoning_high]
```

Use `/model-profiles` without arguments to inspect current resolution. Prefer `auto` unless the user wants a concrete provider/model mapping.

## Thinking tool

The `thinking` tool lets the agent share concise thoughts or reasoning before it continues. It is active by default and, while active, tells the agent to call it after internal reasoning and before an answer or any other tool. The agent should provide the closest precise account it can share, paraphrasing or summarizing when instructions limit disclosure while preserving key considerations and decisions. Thoughts should use multiple short lines, stay within the TUI width, and wrap at roughly 160 characters when that width is unknown.

The user controls it with:

```text
/thinking
/thinking on
/thinking off
```

With no argument, `/thinking` flips the current state. It is a user-invoked slash command; the agent cannot invoke it as a tool. Toggling it preserves the state of every other active tool.

## Other extension capabilities

- `execute_code` runs supported languages through direct process spawning rather than a shell and is subject to path and code-execution policy.
- `web_lookup` separates search permission from URL-read permission.
- `local_sql` provides readonly access to the extension's local SQLite history. It is historical memory, not live repository state.
- Filesystem mutation tools are policy-aware and should be preferred over shell commands for file operations.
- The package includes the `agent-tools-flat-dark` theme.

## Helping effectively

When a user says a feature “does not work,” first classify the problem:

- **Unavailable:** extension/tool/server was not loaded.
- **Disconnected:** configured MCP server is not connected.
- **Not exposed:** MCP tool was discovered but exposure rules hide it.
- **Policy blocked:** the capability exists but an explicit policy or default denied it.
- **Needs reload:** configuration changed but Pi still has stale registered tools or extension state.
- **Wrong interface:** the user is trying to call a slash command as a tool, or expecting the agent to invoke an interactive command.

Inspect the narrowest relevant state, explain what is known, and propose one concrete next step rather than listing every possible command.
