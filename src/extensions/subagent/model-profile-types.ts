export const agentModelProfiles = {
  textLow: "text_low",
  textHigh: "text_high",
  reasoningLow: "reasoning_low",
  reasoningHigh: "reasoning_high",
} as const;

export type AgentModelProfile = typeof agentModelProfiles[keyof typeof agentModelProfiles];
