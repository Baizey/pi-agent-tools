# Planning Notes

## Persistance

move away from individual files and towards SQLite

current points of refactor/migration:
- path policy (currently persistent json file)
- shell policy (currently persistent json file)
- web policy (currently persistent json file)
- code exec policy (currently persistent json file)
- session querying (currently pi builtin, unknown storage but persistent)
- subagent UI information relay (currently temp files with naming patterns)
- subagent meta information (doesnt exist verbatum atm)
- subagent result piping (doesnt exist verbatum atm)

## Tooling

- SQL tooling for accessing information
- SQL tooling for potentially writing long-term memory of various kinds

## Sandboxing

All policy capture currently relies on statically catching things pre-tool execution with some subagent util for getting quick insight in scripts and shell command execution before it happens
But this gives no guarantees of IO or web access in the wild execution

## Multi-agent tabbing

- Orchestration view of all active (sub)agents
- Potential for permission asking from sub agents with pinging to orchestration view for ask
- quick tabbing / overview / tree-view of active and completed (sub) agents

## Subagent

- Provide title names / purposes of sub agents
- agentic role registry
- result piping
