import {ExtensionContext} from "../../../pi/types";
import {agentEnv} from "../../../shared/env";
import {agentModelProfiles, resolveAgentModelProfile, subagentProfileNames, runSyncSubagent} from "../../subagent";

const bashSummariesByCommand = new Map<string, string>();
const bashScopeDescriptionsByCommand = new Map<string, Map<string, string>>();

async function resolveShellPolicyHelperModel(ctx: ExtensionContext): Promise<string | undefined> {
  return resolveAgentModelProfile(ctx, process.env[agentEnv.subagentModel]?.trim() || agentModelProfiles.textLow);
}

export function getBashSummary(command: string): string | undefined {
  return bashSummariesByCommand.get(command);
}

export async function summarizeCommandForApproval(command: string, ctx: ExtensionContext): Promise<void> {
  if (bashSummariesByCommand.has(command)) return;
  try {
    const model = await resolveShellPolicyHelperModel(ctx);
    const result = await runSyncSubagent({
      task: `Summarize this bash command in one short sentence. Say what it appears intended to do, not whether it is safe. Command: ${JSON.stringify(command)}`,
      profiles: [subagentProfileNames.none],
      cwd: ctx.cwd,
      timeoutSeconds: 20,
      model,
      systemPrompt: "You summarize bash commands for approval UI. Use one concise sentence. Do not provide hidden reasoning. Do not call tools.",
    }, ctx.signal);
    const summary = cleanSummary(result.output, 180);
    if (summary) bashSummariesByCommand.set(command, summary);
  } catch {
    // Summary is best-effort; approval and execution should still proceed.
  }
}

export async function describeShellPolicyScopes(
  command: string,
  scopeOptions: Array<{label: string}>,
  ctx: ExtensionContext,
): Promise<Map<string, string>> {
  const cached = bashScopeDescriptionsByCommand.get(command);
  if (cached && scopeOptions.every((option) => cached.has(option.label))) return cached;

  const descriptions = new Map<string, string>();
  try {
    const model = await resolveShellPolicyHelperModel(ctx);
    const result = await runSyncSubagent({
      task: [
        "Describe the shell policy scope options for this bash command.",
        "Return exactly one line per option in this machine-readable format:",
        "<index>|<short description>",
        "Descriptions must be clear, non-judgmental, and at most 12 words.",
        "Do not include safety advice, markdown, bullets, or extra lines.",
        `Full original command: ${JSON.stringify(command)}`,
        "Options:",
        ...scopeOptions.map((option, index) => `${index}|${option.label}`),
      ].join("\n"),
      profiles: [subagentProfileNames.none],
      cwd: ctx.cwd,
      timeoutSeconds: 20,
      model,
      systemPrompt: "You write concise shell approval UI descriptions. You do not call tools. You output only the requested machine-readable lines.",
    }, ctx.signal);

    for (const line of result.output.split(/\r?\n/)) {
      const match = line.trim().match(/^(\d+)\|(.*)$/);
      if (!match) continue;
      const option = scopeOptions[Number(match[1])];
      const description = cleanSummary(match[2] ?? "", 100);
      if (option && description) descriptions.set(option.label, description);
    }
  } catch {
    // Descriptions are best-effort; approval and execution should still proceed.
  }

  bashScopeDescriptionsByCommand.set(command, descriptions);
  return descriptions;
}

function cleanSummary(output: string, maxLength: number): string {
  return output.replace(/\s+/g, " ").trim().slice(0, maxLength);
}
