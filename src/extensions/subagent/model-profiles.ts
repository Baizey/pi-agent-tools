import {ExtensionContext} from "../../pi/types";

export const agentModelProfiles = {
  textLow: "text_low",
  textHigh: "text_high",
  reasoningLow: "reasoning_low",
  reasoningHigh: "reasoning_high",
} as const;

export type AgentModelProfile = typeof agentModelProfiles[keyof typeof agentModelProfiles];

const agentModelProfileValues = new Set<string>(Object.values(agentModelProfiles));
const cachedResolvedModels = new Map<AgentModelProfile, string | undefined>();

export function isAgentModelProfile(value: string): value is AgentModelProfile {
  return agentModelProfileValues.has(value);
}

export async function resolveAgentModelProfile(
  ctx: ExtensionContext | undefined,
  model: string | undefined,
): Promise<string | undefined> {
  const configured = model?.trim();
  if (!configured) return undefined;
  if (!isAgentModelProfile(configured)) return configured;
  return resolveAgentModel(ctx, configured);
}

export async function resolveAgentModel(
  ctx: ExtensionContext | undefined,
  profile: AgentModelProfile,
): Promise<string | undefined> {
  if (cachedResolvedModels.has(profile)) return cachedResolvedModels.get(profile);

  let resolved: string | undefined;
  try {
    const available = await ctx?.modelRegistry?.getAvailable();
    const selected = selectAgentModel(available ?? [], profile);
    resolved = selected ? `${selected.provider}/${selected.id}` : undefined;
  } catch {
    resolved = undefined;
  }

  cachedResolvedModels.set(profile, resolved);
  return resolved;
}

type AgentModelCandidate = Awaited<ReturnType<NonNullable<ExtensionContext["modelRegistry"]>["getAvailable"]>>[number];

function selectAgentModel(models: AgentModelCandidate[], profile: AgentModelProfile): AgentModelCandidate | undefined {
  const textModels = models.filter((model) => model.input?.includes("text") !== false);
  const preferredReasoning = textModels.filter((model) => wantsReasoning(profile) ? model.reasoning === true : model.reasoning !== true);
  const candidates = preferredReasoning.length > 0 ? preferredReasoning : textModels;
  const sorted = [...candidates].sort((left, right) => modelCostScore(left) - modelCostScore(right));
  return wantsLowCost(profile) ? sorted[0] : sorted[sorted.length - 1];
}

function wantsReasoning(profile: AgentModelProfile): boolean {
  return profile === agentModelProfiles.reasoningLow || profile === agentModelProfiles.reasoningHigh;
}

function wantsLowCost(profile: AgentModelProfile): boolean {
  return profile === agentModelProfiles.textLow || profile === agentModelProfiles.reasoningLow;
}

function modelCostScore(model: AgentModelCandidate): number {
  const cost = model.cost;
  if (!cost) return Number.POSITIVE_INFINITY;
  return cost.input + cost.output;
}
