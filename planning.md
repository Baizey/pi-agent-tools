# Planning Notes

## Persistence

Move away from individual files and toward SQLite.

Done:
- Path, shell, web, and code-exec policies persist in SQLite, with legacy JSON import/cleanup.
- Session history is synced into SQLite and queryable through read-only `local_sql`.
- Subagent run tree/status metadata is persisted in `subagent_runs` for tree rendering and status lookup.

Still open:
- Long-term memory tables and write tooling, if we want persistent agent memory beyond sessions/policies.

## Tooling

Done:
- `local_sql` provides read-only access to the local agent SQLite database.
- `policy_info` provides policy introspection/evaluation.
- Subagent capability groups are now called toolkits:
  - no `toolkits` / empty list = no tools
  - `meta` = harness introspection (`policy_info`, `local_sql`)
  - no `none` toolkit

Still open:
- SQL/write tooling for intentional long-term memory.

## Sandboxing

All policy capture currently relies on statically catching things pre-tool execution, with subagent utilities for quick insight into scripts and shell commands before execution.
This still does not guarantee IO or web access containment inside arbitrary executed code.

## Multi-agent tabbing

Done / partial:
- Subagent tree/status data is persisted and surfaced through status/await flows.
- `/subagents` provides running/done/all orchestration views through the subagent tree widget.
- Tree rows show each subagent persona and richer latest tool context such as files and commands.

Still open:
- Permission asking from subagents via pinging an orchestration view.
- Quick tabbing beyond the current widget, if needed.

## Subagent

Done:
- Scoped subagent runs support sync, async, and conversation modes.
- Status/await/message/cancel tooling exists.
- Toolkits replaced subagent capability profiles.
- `meta` toolkit covers harness introspection.
- `persona` is required for each spawned subagent, persisted, injected into the prompt, and shown in the tree.

Still open:
- Agentic role/persona registry.
