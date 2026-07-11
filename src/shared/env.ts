export enum AgentEnvName {
  pathDenyByDefault = "PI_AGENT_PATH_DENY_BY_DEFAULT",
  shellDenyByDefault = "PI_AGENT_SHELL_DENY_BY_DEFAULT",
  codeExecDenyByDefault = "PI_AGENT_CODE_EXEC_DENY_BY_DEFAULT",
  webDenyByDefault = "PI_AGENT_WEB_DENY_BY_DEFAULT",
  policyDefaults = "PI_AGENT_POLICY_DEFAULTS",
  subagentToolkitCeiling = "PI_AGENT_SUBAGENT_TOOLKIT_CEILING",
  subagentModel = "PI_AGENT_SUBAGENT_MODEL",
  subagentRootId = "PI_AGENT_SUBAGENT_ROOT_ID",
  subagentParentId = "PI_AGENT_SUBAGENT_PARENT_ID",
  subagentNodeId = "PI_AGENT_SUBAGENT_NODE_ID",
  subagentDepth = "PI_AGENT_SUBAGENT_DEPTH",
}

export const agentEnvDescriptions = {
  [AgentEnvName.pathDenyByDefault]: "When set to '1', unmatched path policy checks are denied instead of prompting.",
  [AgentEnvName.shellDenyByDefault]: "When set to '1', unmatched shell policy checks are denied instead of prompting.",
  [AgentEnvName.codeExecDenyByDefault]: "When set to '1', unmatched code execution policy checks are denied instead of prompting.",
  [AgentEnvName.webDenyByDefault]: "When set to '1', unmatched web policy checks are denied instead of prompting.",
  [AgentEnvName.policyDefaults]: "JSON session overrides for unmatched policy defaults inherited by subagents.",
  [AgentEnvName.subagentToolkitCeiling]: "Comma-separated list of subagent toolkits nested subagents may use at most.",
  [AgentEnvName.subagentModel]: "Optional model profile, pattern, or ID to use for spawned subagents by default.",
  [AgentEnvName.subagentRootId]: "Lineage id for the root subagent tree this process belongs to.",
  [AgentEnvName.subagentParentId]: "Lineage id for the parent subagent node this process was spawned by.",
  [AgentEnvName.subagentNodeId]: "Lineage id for the current subagent node represented by this process.",
  [AgentEnvName.subagentDepth]: "Numeric depth of the current subagent node in its subagent tree.",
} satisfies Record<AgentEnvName, string>;

export function isAgentEnvEnabled(name: AgentEnvName): boolean {
  return process.env[name] === "1";
}

export function denyByDefaultEnv(): Partial<Record<AgentEnvName, string>> {
  return {
    [AgentEnvName.pathDenyByDefault]: "1",
    [AgentEnvName.shellDenyByDefault]: "1",
    [AgentEnvName.codeExecDenyByDefault]: "1",
    [AgentEnvName.webDenyByDefault]: "1",
  };
}
