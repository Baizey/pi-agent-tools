export const agentEnv = {
  pathDenyByDefault: "PI_AGENT_PATH_DENY_BY_DEFAULT",
  shellDenyByDefault: "PI_AGENT_SHELL_DENY_BY_DEFAULT",
  subagentProfileCeiling: "PI_AGENT_SUBAGENT_PROFILE_CEILING",
} as const;

export type AgentEnvName = typeof agentEnv[keyof typeof agentEnv];

export const agentEnvDescriptions = {
  [agentEnv.pathDenyByDefault]: "When set to '1', unmatched path policy checks are denied instead of prompting.",
  [agentEnv.shellDenyByDefault]: "When set to '1', unmatched shell policy checks are denied instead of prompting.",
  [agentEnv.subagentProfileCeiling]: "Comma-separated list of subagent profiles nested subagents may use at most.",
} satisfies Record<AgentEnvName, string>;

export function isAgentEnvEnabled(name: AgentEnvName): boolean {
  return process.env[name] === "1";
}

export function denyByDefaultEnv(): Partial<Record<AgentEnvName, string>> {
  return {
    [agentEnv.pathDenyByDefault]: "1",
    [agentEnv.shellDenyByDefault]: "1",
  };
}
