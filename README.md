# pi-agent-tools

Policy-aware local tools for [Pi](https://github.com/earendil-works/pi-coding-agent): filesystem operations, shell approvals, code execution, web lookup, policy introspection, scoped subagents, and a bundled theme.

> This package runs inside Pi as an extension. It is designed for safer agent workflows, but it is **not** an OS sandbox. Review the source and use conservative policies for untrusted workspaces.

## Installation

Install from GitHub:

```bash
pi install git:github.com/Baizey/pi-agent-tools
```

Update installed Pi packages:

```bash
pi update --extensions
```

For development from a checkout:

```bash
npm install
pi -e C:/Repositories/pi-agent-tools
```

Avoid loading both a local-path copy and a git-installed copy at the same time; Pi treats them as separate package identities and both may register tools/hooks.

## What this package registers

### Filesystem tools

These supplement Pi's built-in file tools and are covered by path policy:

| Tool | Purpose |
| --- | --- |
| `delete` | Delete a file or directory. Optional recursive directory delete. |
| `copy` | Copy a file or directory. Optional recursive and overwrite modes. |
| `move` | Move or rename a file/directory. Optional overwrite. |
| `mkdir` | Create a directory. Optional recursive parent creation. |
| `stat` | Return metadata for a file or directory. |

Path policy also hooks Pi's built-in `read`, `write`, and `edit` tool calls.

### Shell policy hook

The extension does not replace Pi's `bash` tool; it listens for shell tool calls and blocks/prompts before execution when no matching shell policy exists.

### Code execution tools

| Tool | Purpose |
| --- | --- |
| `execute_code` | Execute inline code or a source file using a detected runtime. Uses direct process spawning, not a shell. |
| `execute_code_info` | Show detected runtimes, versions, supported modes, and detection errors. |

Supported language adapters: `javascript`, `typescript`, `python`, `powershell`, `ruby`, `php`, `perl`, `go`, `java`, `dotnet`, `c`, `cpp`, `rust`. The available enum for `execute_code` is narrowed to runtimes detected when the extension starts.

### Web tool

| Tool | Purpose |
| --- | --- |
| `web_lookup` | Search DuckDuckGo HTML results with `query`, or fetch/read an `http(s)` URL. |

### MCP tools

MCP servers are configured in `~/.pi/agent/mcp.json`. Only tools exposed by this extension are registered as Pi tools; exposure defaults to none. Use `tools.expose` to allow specific MCP tool names, or `"*"` to expose all currently discovered tools except entries in `tools.hide`.

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

Supported transports are `stdio` and Streamable HTTP (`transport: "http"`, `url`, optional `headers`). Stdio `env` values are merged over the MCP SDK default inherited environment.

Slash commands:

```text
/mcp show [all|server]
/mcp connect [all|server]
/mcp disconnect [all|server]
/mcp refresh [all|server]
/mcp expose <server> <tool...|*>
/mcp hide <server> <tool...|*>
/mcp reset <server> [tool...|*]
```

Because Pi currently has no public tool unregister API, hiding an already registered MCP tool blocks calls immediately but the tool name may remain visible until `/reload`.

### Policy introspection

| Tool | Purpose |
| --- | --- |
| `policy_info` | Show active policies or evaluate a path, shell command, code execution scope, or web URL. |

### Subagent tools

| Tool | Purpose |
| --- | --- |
| `subagent_spawn` | Start a scoped subagent in `sync`, `async`, or `conversation` mode. |
| `available_personas` | List enabled persona presets available in the current toolkit context. |
| `subagent_spawn_persona` | Spawn a subagent from a registered persona preset. |
| `subagent_status` | Inspect an async/conversation job. |
| `subagent_await` | Wait for one or more async jobs. |
| `subagent_message` | Send a follow-up task to an idle conversation subagent. |
| `subagent_cancel` | Cancel a running or idle async/conversation job. |

### Theme

The package also exposes `themes/agent-tools-flat-dark.json` via the Pi package manifest.

## Policies

Policies are loaded per Pi runtime and persisted under:

```text
~/.pi/agent/agent.sqlite
```

Legacy `path-policy.json`, `shell-policy.json`, `code-exec-policy.json`, and `web-policy.json` files are imported into SQLite and deleted on startup.

Interactive approvals support lifetimes such as one-shot, session, and forever. Forever policies are written to disk. One-shot policies are removed after the current operation/approval loop.

Set deny-by-default environment variables to block unmatched requests instead of prompting:

| Env var | Effect |
| --- | --- |
| `PI_AGENT_PATH_DENY_BY_DEFAULT=1` | Deny unmatched path access. |
| `PI_AGENT_SHELL_DENY_BY_DEFAULT=1` | Deny unmatched shell commands/flags. |
| `PI_AGENT_CODE_EXEC_DENY_BY_DEFAULT=1` | Deny unmatched code execution scopes. |
| `PI_AGENT_WEB_DENY_BY_DEFAULT=1` | Deny unmatched web access. |
| `PI_AGENT_POLICY_DEFAULTS` | Internal session default overrides inherited by spawned subagents. |

Session defaults for unmatched checks can be changed with `/policy-default` without writing persistent policies:

```text
/policy-default show
/policy-default allow <target...> [--scope root|subagents|all]
/policy-default deny <target...> [--scope root|subagents|all]
/policy-default ask <target...> [--scope root|subagents|all]
/policy-default reset <target...> [--scope root|subagents|all]
```

Targets: `all`, `io`, `io_read`, `io_write`, `io_execute`, `shell`, `code`, `web`, `web_read`, `web_search`. Explicit matching policies still win; defaults only handle unmatched checks. `root` affects the current agent process, `subagents` is inherited by spawned subagents, and `all` applies to both. Subagents still start from deny-by-default, unless overridden by `/policy-default ... --scope subagents`.

### Path policy

Path policy evaluates standardized absolute paths and prefers the most specific matching rule. Access types are:

- `READ`
- `WRITE`
- `EDIT`
- `DELETE`
- `EXECUTE`

Tool access mapping examples:

- `read`, `stat` → `READ`
- `write`, `mkdir` → `WRITE`
- `edit` → `EDIT`
- `delete` → `DELETE`
- `copy` → source `READ`, destination `WRITE`
- `move` → source `DELETE`, destination `WRITE`, plus destination `DELETE` when overwriting
- `execute_code` → working directory `EXECUTE`; file mode source `READ` and `EXECUTE`

### Shell policy

Shell policy is intentionally conservative and policy-friendly rather than a full shell parser.

It splits obvious command segments (`&&`, `||`, `;`, `|`, `&`, newlines) and evaluates each segment independently. Shell expansion/redirection syntax such as `$`, command substitution, globs, braces, and redirects is denied by policy evaluation. Dynamic shell helpers such as `eval`, `source`, `exec`, nested `bash -c`/`sh -c`, `find -exec`, and `xargs` are treated as unsafe.

Command scope is inferred from simple command words at the start of a segment, with known subcommand support for tools such as `git`, `gh`, `npm`, `pnpm`, and `yarn`. File/path-like arguments, quoted values, flags, and `--` stop command-core inference.

Flags are non-quoted tokens that start with `-` or `--` immediately followed by a letter, for example `-m`, `--short`, or `--untracked-files=all`. Policy applies to flag names/tokens, not to flag values.

When an unmatched shell command is prompted, scope choices broaden from exact command to parent command. For example `git status --short` can offer:

- `git status`
- `git status | with all flags allowed`
- `git`

When the command is already allowed but a flag is unknown, the prompt can offer the individual flag and an exact-command all-flags option. Explicit flag policies still win over all-flags approval, so a denied flag remains denied even if `allowAllFlags` is enabled for that exact command.

Policy-friendly shell formatting for agents:

- keep command core words at the start, such as `git status` or `npm test`
- quote string and pattern values
- keep file/path values as arguments, not command core
- put flags before their values
- use `--` before positional values that may start with `-`
- avoid shell expansion, redirection, command substitution, `eval`/`source`/`exec`, and nested shells unless explicitly requested
- prefer structured file tools for filesystem changes

### Code execution policy

`execute_code` checks multiple policy layers before running:

1. path policy for the working directory (`EXECUTE`)
2. path policy for source file reads/executes in file mode
3. code execution policy for language and mode (`inline` or `file`)
4. optional static effect analysis that can infer likely path effects and preflight those paths through path policy

Code execution uses direct process spawning with language adapters. Compiled languages may have a compile step followed by a run step. Temporary build/source files are cleaned up where applicable. `timeoutSeconds` defaults to 30 and is capped at 600.

### Web policy

`web_lookup` has separate access types:

- `SEARCH` for DuckDuckGo HTML searches
- `READ` for fetching a URL

Web policy uses normalized domains and URL paths, ignoring scheme and query string. Leading `www.` is stripped. A domain-level policy can match subdomains, while more specific domain/path policies take precedence. UI prompts display scopes as `domain/path`, such as `example.com/docs`, and root path scopes as the bare domain, such as `example.com`.

## Subagents

Subagents run separate scoped Pi processes with constrained capabilities. Each subagent requires a `role`, a concise title shown in orchestration views and injected into its prompt.

Modes:

- `sync` — run the task and wait for the result
- `async` — start a background job and inspect/await/cancel it later
- `conversation` — start a reusable conversation job; await/status until idle, send follow-up messages, cancel when done

Persona presets are global SQLite rows that wrap `subagent_spawn` with predefined `role`, `description`, `mode`, `model`, `toolkits`, and `systemPrompt`. Use `available_personas` to discover enabled personas that the current agent can spawn, then call `subagent_spawn_persona` with only `persona`, `task`, and optional `timeoutSeconds`. Persona availability is all-or-nothing: if a persona requires a toolkit outside the current subagent ceiling, it is omitted and cannot be spawned from that context.

Use `/personas` to list registered personas and `/personas show <name>` to see full details including the system prompt. Builtin personas are seeded into the global registry and use reserved names.

Toolkits are additive capability ceilings. Omitting toolkits, or passing an empty toolkit list, grants no tools.

- `meta` — harness introspection tools (`policy_info`, `local_sql`)
- `io_read`
- `io_write`
- `execute_bash`
- `execute_code`
- `web_read`
- `spawn_subagent`

Nested subagents cannot request toolkits outside the parent process's effective ceiling. Subagent runs also force deny-by-default policy env vars so nested processes cannot prompt for more permissions interactively; if blocked, they should report what was blocked and continue with available information.

Use `/subagents [on|off] [running|done|all]` for the orchestration tree. Tree rows show role, status, and latest activity; child tool calls include useful context such as file paths or shell commands.

Raw `subagent_spawn` settings:

- `role`: required concise title/role for the spawned agent
- `model`: one of the package model profiles, such as `text_low`, `text_high`, `reasoning_low`, or `reasoning_high`
- `cwd`: working directory
- `timeoutSeconds`: timeout for a subagent run; defaults to 900 seconds (15 minutes). `subagent_await` defaults to waiting 30 seconds and reports current job statuses on timeout.
- `systemPrompt`: additional system instructions
- `contextPaths`: files/directories suggested as context

Relevant environment variables:

| Env var | Purpose |
| --- | --- |
| `PI_AGENT_SUBAGENT_TOOLKIT_CEILING` | Comma-separated maximum toolkits for nested subagents. |
| `PI_AGENT_SUBAGENT_MODEL` | Optional default model profile/pattern/id for spawned subagents and code-effect analysis. |

## Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

The Pi package manifest is defined in `package.json`.

## Security notes

- This project is intended for local/self-hosted use.
- Policy enforcement is best-effort at the Pi tool/prompt layer; it does not prevent out-of-band access by other processes.
- Shell parsing is deliberately conservative and incomplete. Prefer structured tools and simple command formatting.
- Code execution can run arbitrary local code once approved. Review prompts carefully and use deny-by-default for non-interactive or delegated workflows.
