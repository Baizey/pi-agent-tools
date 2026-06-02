import {ExtensionContext} from "../../pi/types";

let cachedCheapLlmModel: string | undefined;
let cachedCheapLlmModelResolved = false;

export async function resolveCheapAgentModel(
  ctx: ExtensionContext,
  configuredModel?: string,
): Promise<string | undefined> {
  const configured = configuredModel?.trim();
  if (configured) return configured;
  if (cachedCheapLlmModelResolved) return cachedCheapLlmModel;

  cachedCheapLlmModelResolved = true;
  try {
    const available = await ctx.modelRegistry?.getAvailable();
    const cheapest = available
      ?.filter((model) => model.input?.includes("text") !== false)
      .sort((left, right) => cheapLlmCostScore(left) - cheapLlmCostScore(right))[0];
    cachedCheapLlmModel = cheapest ? `${cheapest.provider}/${cheapest.id}` : undefined;
  } catch {
    cachedCheapLlmModel = undefined;
  }

  return cachedCheapLlmModel;
}

type CheapLlmCandidate = Awaited<ReturnType<NonNullable<ExtensionContext["modelRegistry"]>["getAvailable"]>>[number];

function cheapLlmCostScore(model: CheapLlmCandidate): number {
  const cost = model.cost;
  if (!cost) return Number.POSITIVE_INFINITY;
  return cost.input + (cost.output * 3) + (model.reasoning ? 0.000001 : 0);
}
