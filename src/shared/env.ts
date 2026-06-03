export const agentEnv = {
  pathDenyByDefault: "PI_AGENT_PATH_DENY_BY_DEFAULT",
  shellDenyByDefault: "PI_AGENT_SHELL_DENY_BY_DEFAULT",
  codeExecDenyByDefault: "PI_AGENT_CODE_EXEC_DENY_BY_DEFAULT",
  webDenyByDefault: "PI_AGENT_WEB_DENY_BY_DEFAULT",
  subagentProfileCeiling: "PI_AGENT_SUBAGENT_PROFILE_CEILING",
  subagentModel: "PI_AGENT_SUBAGENT_MODEL",
  subagentRootId: "PI_AGENT_SUBAGENT_ROOT_ID",
  subagentParentId: "PI_AGENT_SUBAGENT_PARENT_ID",
  subagentNodeId: "PI_AGENT_SUBAGENT_NODE_ID",
  subagentDepth: "PI_AGENT_SUBAGENT_DEPTH",
  subagentTreeDir: "PI_AGENT_SUBAGENT_TREE_DIR",
} as const;

export type AgentEnvName = typeof agentEnv[keyof typeof agentEnv];

export const agentEnvDescriptions = {
  [agentEnv.pathDenyByDefault]: "When set to '1', unmatched path policy checks are denied instead of prompting.",
  [agentEnv.shellDenyByDefault]: "When set to '1', unmatched shell policy checks are denied instead of prompting.",
  [agentEnv.codeExecDenyByDefault]: "When set to '1', unmatched code execution policy checks are denied instead of prompting.",
  [agentEnv.webDenyByDefault]: "When set to '1', unmatched web policy checks are denied instead of prompting.",
  [agentEnv.subagentProfileCeiling]: "Comma-separated list of subagent profiles nested subagents may use at most.",
  [agentEnv.subagentModel]: "Optional model profile, pattern, or ID to use for spawned subagents by default.",
  [agentEnv.subagentRootId]: "Lineage id for the root subagent tree this process belongs to.",
  [agentEnv.subagentParentId]: "Lineage id for the parent subagent node this process was spawned by.",
  [agentEnv.subagentNodeId]: "Lineage id for the current subagent node represented by this process.",
  [agentEnv.subagentDepth]: "Numeric depth of the current subagent node in its subagent tree.",
  [agentEnv.subagentTreeDir]: "Directory used by subagent processes to publish current tree node state.",
} satisfies Record<AgentEnvName, string>;

export function isAgentEnvEnabled(name: AgentEnvName): boolean {
  return process.env[name] === "1";
}

export function denyByDefaultEnv(): Partial<Record<AgentEnvName, string>> {
  return {
    [agentEnv.pathDenyByDefault]: "1",
    [agentEnv.shellDenyByDefault]: "1",
    [agentEnv.codeExecDenyByDefault]: "1",
    [agentEnv.webDenyByDefault]: "1",
  };
}
