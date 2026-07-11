import {PiExtensionApi} from "../../../pi/types";
import {AgentServices} from "../../../pi/runtime";
import {ToolName} from "../../../shared/toolNames";
import {FoldDirection, renderToolCallInput, renderToolResultOutput} from "../../../shared/toolRendering";
import {errorResult, successResult} from "../../../shared/toolResults";
import {stringValue} from "../../../shared/values";
import {contextForCwd, executeCodeParameters, isLanguage, parseInput} from "./input";
import {renderCodeExecCall} from "./rendering";
import {formatRuntimeInfo} from "./resultFormatting";
import {CodeExecRuntimeRegistry} from "./runtimeRegistry";
import {CodeLanguage} from "./types";
import {createCodeExecWorkflowDependencies, executeCodeWorkflow} from "./workflow";

export function registerCodeExecutionTool(
    pi: PiExtensionApi,
    services: AgentServices,
    registry = new CodeExecRuntimeRegistry(),
): void {
    const workflow = createCodeExecWorkflowDependencies(services, registry);

    pi.registerTool?.({
        name: ToolName.executeCode,
        label: "Execute Code",
        description: "Execute code from an inline snippet or file using a detected language runtime. Uses direct process spawning, not a shell.",
        parameters: executeCodeParameters(),
        async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
            const parsed = parseInput(rawParams, ctx?.cwd ?? process.cwd());
            if ("error" in parsed) return errorResult(parsed.error);
            const effectiveCtx = contextForCwd(ctx, parsed.cwd);
            return executeCodeWorkflow(parsed, effectiveCtx, signal, workflow);
        },
        renderCall(args, theme, context) {
            return renderCodeExecCall(args, theme, context);
        },
        renderResult(result, _options, theme, context) {
            return renderToolResultOutput(result, theme, context, {direction: FoldDirection.TAIL, previewLines: 12});
        },
    });

    pi.registerTool?.({
        name: ToolName.executeCodeInfo,
        label: "Code Runtimes",
        description: "Show detected code execution runtimes, versions, supported modes, and detection errors.",
        parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
                language: {
                    type: "string",
                    enum: Object.values(CodeLanguage),
                    description: "Optional language to inspect."
                },
            },
        },
        async execute(_toolCallId, rawParams) {
            const rawLanguage = stringValue((rawParams as { language?: unknown }).language);
            if (rawLanguage && !isLanguage(rawLanguage)) return errorResult(`Unsupported language: ${rawLanguage}`);
            const results = rawLanguage && isLanguage(rawLanguage) ? [await registry.detect(rawLanguage)] : await registry.detectAll();
            return successResult(formatRuntimeInfo(results), {runtimes: results});
        },
        renderCall(args, theme, context) {
            return renderToolCallInput(ToolName.executeCodeInfo, args, theme, context);
        },
        renderResult(result, _options, theme, context) {
            return renderToolResultOutput(result, theme, context, {direction: FoldDirection.HEAD, previewLines: 16});
        },
    });
}
