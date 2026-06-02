# pi-agent-tools

A Pi package with local agent tooling for safer filesystem work, shell policy checks, policy introspection, and scoped subagents.

> This package runs as a Pi extension. Review the source before installing, especially because policy and subagent features affect tool execution.

## Install

Install from GitHub:

```bash
pi install git:github.com/Baizey/pi-agent-tools
```

Recommended stable install with a tag:

```bash
pi install git:github.com/Baizey/pi-agent-tools@v0.1.0
```

Update installed packages:

```bash
pi update --extensions
```

For local development, use a project-local package entry pointing at the git branch you are testing, or run temporarily from a checkout:

```bash
pi -e C:/Repositories/pi-agent-tools
```

Avoid loading both a local-path copy and a git-installed copy at the same time; Pi treats those as different package identities and both extensions may register.

## Included tools

Filesystem tools:

- `delete`
- `copy`
- `move`
- `mkdir`
- `stat`

Policy tools:

- `policy_info`

Subagent tools:

- `subagent_spawn`
- `subagent_status`
- `subagent_await`
- `subagent_message`
- `subagent_cancel`

Code execution tools:

- `execute_code`
- `execute_code_info`

## Policy features

### Path policy

Path policy checks structured filesystem tools and built-in file tools before access. Policies are tracked by access type:

- `READ`
- `WRITE`
- `EDIT`
- `DELETE`
- `EXECUTE`

The policy matcher uses standardized absolute paths and prefers more specific path rules.

### Shell policy

Shell policy checks `bash` calls before execution. It is intentionally conservative and policy-friendly rather than a complete shell parser.

Guidance injected into the agent prompt asks bash commands to:

- keep command core words at the start, such as `git status` or `npm test`
- quote string and pattern values
- keep file/path values as arguments, not command core
- put flags before their values
- use `--` before positional values that may start with `-`
- avoid shell expansion, redirection, command substitution, `eval`/`source`/`exec`, and nested shells unless explicitly requested
- prefer structured file tools for filesystem changes

`policy_info` can show the currently active path and shell policies.

## Subagents

Subagents run separate scoped Pi processes with constrained tool profiles.

Supported modes:

- `sync` — run and wait for the result
- `async` — start a background job and inspect/await/cancel it later
- `conversation` — start a reusable conversation job; await until it becomes idle, send follow-up messages, then cancel when done

Supported profiles:

- `none`
- `io_read`
- `io_write`
- `execute_bash`
- `execute_code`
- `web_read` *(reserved for future web tools)*
- `spawn_subagent`

Profiles are ceilings. Nested subagents cannot grant themselves profiles outside the parent process's effective profile ceiling.

Subagent runs publish a best-effort tree of nested activity. Recursive subagents share tree state through temporary per-node JSON files that are cleaned up by the root runner.

## Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Build only:

```bash
npm run build
```

The Pi manifest in `package.json` loads `./src/extension.ts`, so Pi can run the TypeScript extension source directly.

## Notes

- This package is currently intended for personal/self-hosted use.
- Code execution tools are planned but not implemented yet.
- Policy enforcement is best-effort and implemented at the tool/prompt layer; it is not an OS sandbox.
