import {PiExtensionApi} from "../../../pi/types";
import {toolNames} from "../../../shared/toolNames";

export function registerBashPromptGuidance(pi: PiExtensionApi): void {
  pi.on("before_agent_start", (event) => {
    if (!isBashSelected(event.systemPromptOptions?.selectedTools)) return;
    if (event.systemPrompt.includes(bashPolicyGuidanceHeader)) return;
    return {systemPrompt: `${event.systemPrompt}\n\n${bashPolicyGuidance}`};
  });
}

function isBashSelected(selectedTools: Array<string | { name?: string }> | undefined): boolean {
  if (!selectedTools) return true;
  return selectedTools.some((tool) => typeof tool === "string" ? tool === toolNames.bash : tool.name === toolNames.bash);
}

const bashPolicyGuidanceHeader = "### Bash policy-friendly command formatting";
const bashPolicyGuidance = `${bashPolicyGuidanceHeader}
When using bash, format commands so shell policy can distinguish command core, flags, and argument values:
- Keep command core words at the start only, e.g. executable plus common subcommand like 'git status' or 'npm test'.
- Quote string/pattern/message values.
- Use file/path-like values plainly; they are arguments, not command core.
- Put flags before their values, and use -- before positional values that may start with -.
- Avoid shell expansion, redirection, command substitution, eval/source/exec, and nested shells unless explicitly requested.
- Prefer structured file tools over shell commands for filesystem changes.
Doing this keeps commands more parsable and leads to less erroneous denials
`;
