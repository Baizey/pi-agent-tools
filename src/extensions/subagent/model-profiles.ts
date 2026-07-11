import {ExtensionContext} from "../../pi/types";
import {autoModelProfileConfig, configuredModelForProfile, ModelProfileConfig, ModelProfileConfigStore} from "./model-profile-config";
import {AgentModelProfile} from "./model-profile-types";

export {AgentModelProfile};

export function isAgentModelProfile(value: string): value is AgentModelProfile {
  return Object.values(AgentModelProfile).some((profile) => profile === value);
}

export async function resolveAgentModelProfile(
  ctx: ExtensionContext | undefined,
  model: string | undefined,
): Promise<string | undefined> {
  const configured = model?.trim();
  if (!configured) return undefined;
  if (!isAgentModelProfile(configured)) return configured;

  const profileConfigured = configuredModelForProfile(configured);
  if (profileConfigured !== autoModelProfileConfig) return profileConfigured;
  return resolveAgentModel(ctx, configured);
}

export async function resolvedModelForProfile(
  ctx: ExtensionContext | undefined,
  profile: AgentModelProfile,
  config: ModelProfileConfig = new ModelProfileConfigStore().load(),
): Promise<{configured: string; resolved: string | undefined; automatic: boolean}> {
  const configured = configuredModelForProfile(profile, config);
  if (configured !== autoModelProfileConfig) return {configured, resolved: configured, automatic: false};
  return {configured, resolved: await resolveAgentModel(ctx, profile), automatic: true};
}

export async function renderModelProfileConfig(
  ctx: ExtensionContext | undefined,
  config: ModelProfileConfig = new ModelProfileConfigStore().load(),
): Promise<string[]> {
  const rows = await Promise.all(Object.values(AgentModelProfile).map(async (profile) => ({
    profile,
    ...(await resolvedModelForProfile(ctx, profile, config)),
  })));
  const profileWidth = Math.max(...rows.map((row) => row.profile.length));
  const modelWidth = Math.max(...rows.map((row) => (row.resolved ?? "unresolved").length));

  return [
    "Model profiles",
    "",
    ...rows.map((row) => {
      const model = row.resolved ?? "unresolved";
      const suffix = row.automatic ? "  auto" : "";
      return `${row.profile.padEnd(profileWidth)}  → ${model.padEnd(modelWidth)}${suffix}`;
    }),
  ];
}

export async function resolveAgentModel(
  ctx: ExtensionContext | undefined,
  profile: AgentModelProfile,
): Promise<string | undefined> {
  try {
    const available = await ctx?.modelRegistry?.getAvailable();
    const selected = selectAgentModel(available ?? [], profile);
    return selected ? `${selected.provider}/${selected.id}` : undefined;
  } catch {
    return undefined;
  }
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
  return profile === AgentModelProfile.reasoningLow || profile === AgentModelProfile.reasoningHigh;
}

function wantsLowCost(profile: AgentModelProfile): boolean {
  return profile === AgentModelProfile.textLow || profile === AgentModelProfile.reasoningLow;
}

function modelCostScore(model: AgentModelCandidate): number {
  const cost = model.cost;
  if (!cost) return 0.1;
  return cost.input + cost.output;
}
