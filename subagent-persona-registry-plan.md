# Subagent Persona Registry Plan

## Goal

Add a persona registry as a preset layer over the existing subagent system. Do not replace or reduce `subagent_spawn`; add a simpler, reliable persona-based spawn path that builds a normal subagent request from a stored persona config.

## Terminology

- `role`: the current subagent title/display/injected role. This replaces the current raw `persona` argument and storage/display meaning.
- `persona`: a named global preset that owns role, description, mode, model, toolkits, and system prompt.
- Raw `subagent_spawn`: the primitive subagent API.
- `subagent_spawn_persona`: a wrapper tool that takes a persona name and task, then uses shared subagent spawn logic.

## Persona row

Personas are global SQLite rows in the agent database. No project/session scope.

Required fields:

- `name`: primary key, lowercase one-word id matching `^[a-z0-9][a-z0-9_-]*$`
- `role`: role/title injected into and shown for the spawned subagent
- `description`: short discovery text for agents/users
- `mode`: `SubagentRunMode` enum value; required, never defaulted silently
- `model`: required model profile or concrete provider/model id
- `toolkits`: `SubagentToolkit[]`
- `systemPrompt`: persona-specific behavior instructions
- `source`: `SubagentPersonaSource` enum
- `enabled`: boolean
- `createdAt`: date
- `updatedAt`: date

Explicitly not persona fields:

- timeout
- context paths
- scope
- task
- cwd
- raw tool names
- policy defaults

Source enum:

```ts
export enum SubagentPersonaSource {
  builtin = "builtin",
  user = "user",
  agent = "agent",
}
```

Use enums for mode/source and existing enum-backed toolkit types. Avoid loose string unions for these domain values.

## Tool changes

### `subagent_spawn`

Clean breaking rename:

- current `persona` argument becomes `role`
- `role` is required with `task`
- prompt says `Role: ...`
- run tree/status/details use role
- storage uses `role`

Existing raw options remain:

- `mode`
- `toolkits`
- `cwd`
- `timeoutSeconds`
- `model`
- `systemPrompt`
- `contextPaths`

### `available_personas`

No required args.

Returns only enabled personas whose required toolkits are fully spawnable in the current context. Context is based on the current subagent toolkit ceiling. Availability is all-or-nothing: do not silently strip toolkits.

Return summary fields:

- `name`
- `role`
- `description`
- `mode`
- `model`
- `toolkits`
- `source`

Do not include full system prompts by default.

### `subagent_spawn_persona`

Arguments:

- `persona`: required persona name
- `task`: required task
- `timeoutSeconds`: optional per-run timeout, same meaning as raw spawn timeout

Behavior:

1. Load the enabled persona by name.
2. Validate the current context can spawn all persona toolkits.
3. Build a normal `SubagentRequest` from persona config and task.
4. Use persona mode/role/model/toolkits/systemPrompt.
5. Use provided timeout or `defaultTimeoutSecondsForMode(persona.mode)`.
6. Resolve model profiles exactly as raw `subagent_spawn` does.
7. Use the existing sync/async/conversation job flow.

Persona spawn must not silently fall back to sync or optional model. Misconfigured personas should be unavailable or error.

## Commands

Initial `/personas` command scope:

- `/personas`: list personas
- `/personas show <name>`: show full persona details, including system prompt

Future, not first slice:

- add/edit/disable/remove user personas
- agent-created dynamic personas

## Storage changes

### `subagent_runs`

Clean breaking rename/meaning:

- `role`: actual spawned role
- `persona`: nullable persona name when spawned through `subagent_spawn_persona`

No backfill. Old rows may break/render blank.

### `subagent_personas`

Global table in agent SQLite DB. Builtins are seeded/upserted into the same table with `source = builtin`. Builtin names are reserved; user/agent personas should not overwrite them unless explicit override semantics are designed later.

## Builtins

Keep initial builtins intentional and explicit. Do not grant write or code-execution toolkits by default. Higher-effort personas may use `reasoning_high`, `conversation`, `meta`, and `execute_bash` when that is part of the intended workflow.

Chosen starter personas:

- `reviewer`: code/repo review, `conversation`, `reasoning_high`, `meta`, `io_read`, `execute_bash`
- `researcher`: web research, `conversation`, `reasoning_high`, `meta`, `web_read`
- `planner`: planning/design, `conversation`, `reasoning_high`, `meta`, `io_read`, `execute_bash`
- `rubber-duck`: reasoning dialogue, `conversation`, `reasoning_low`, no tools

Each builtin explicitly sets mode, model, and toolkits.

## Implementation slices

1. Raw `persona` → `role` rename across request/runner/jobs/tree/storage/docs/tests.
2. Persona storage/registry helpers and builtins.
3. `available_personas` tool.
4. `subagent_spawn_persona` tool.
5. `/personas` list/show command.
6. Docs and final test pass.

## Review checklist

- No hidden sync default for personas.
- Persona model is required.
- Persona mode is required.
- No timeout/contextPaths/scope in persona rows.
- Persona names are lowercase one-word ids with `_`/`-` allowed.
- Persona availability is all-or-nothing on toolkits.
- Raw `subagent_spawn` still exists and remains the primitive.
- Raw role naming is consistently `role`, not legacy `persona`.
- `subagent_runs.persona` means preset name only.
- No backfill logic.
- Domain values use enums where appropriate.
