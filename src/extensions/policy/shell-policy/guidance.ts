import {PiExtensionApi} from "../../../pi/types";
import {ToolName} from "../../../shared/toolNames";

export function registerBashPromptGuidance(pi: PiExtensionApi): void {
  pi.on("before_agent_start", (event) => {
    if (!isBashSelected(event.systemPromptOptions?.selectedTools)) return;
    if (event.systemPrompt.includes(bashPolicyGuidanceHeader)) return;
    return {systemPrompt: `${event.systemPrompt}\n\n${bashPolicyGuidance}`};
  });
}

function isBashSelected(selectedTools: Array<string | { name?: string }> | undefined): boolean {
  if (!selectedTools) return true;
  return selectedTools.some((tool) => typeof tool === "string" ? tool === ToolName.bash : tool.name === ToolName.bash);
}

const bashPolicyGuidanceHeader = "### Bash policy-friendly command formatting";
const bashPolicyGuidance = `${bashPolicyGuidanceHeader}
When using bash, format commands in a strict best-practice manner.
If you do not, the policy system may deny you execution, even if it should have been an allowed command.
For best practice think of a command as a sequence of:
- keywords ('git status', 'npm test', 'node')
- flags ('-v', '--version', '--help')
- argument values ('/path/to/file', 50)
You want keywords to be first, flags and arguments comes second.
Always quote any value that is a string-argument (unless this is not supported by the command in question).
Examples:
- git commit -m "fix bug"
- node "index.js" --port 3000
`;
