import {ExtensionContext} from "../../../pi/types";
import {AgentModelProfile, resolveAgentModelProfile, runSyncSubagent, SubagentToolkitName} from "../../subagent";

export type UIAiHelpOptionInfo = {
    task: string
    fullItem: string
    subItems: string[]
    optionLabel?: string
    timeoutSeconds?: number
}

export class UIAiHelpWrap {
    private loaded = false
    private fullInfo: string | undefined
    private subItemInfo = new Map<number, string>()

    constructor(private info: UIAiHelpOptionInfo) {
    }

    optionLabel(): string {
        return this.info.optionLabel ?? "ⓘ Add AI context for this decision"
    }

    titleWithHelp(title: string): string {
        if (!this.fullInfo) return title
        return `${title}\n\nRelevant info:\n${this.fullInfo}`
    }

    optionTitleWithHelp(title: string): string {
        const index = this.info.subItems.indexOf(title)
        const info = index >= 0 ? this.subItemInfo.get(index) : undefined
        return info ? `${title} — ${info}` : title
    }

    async load(ctx: ExtensionContext): Promise<void> {
        if (this.loaded) return
        this.loaded = true

        try {
            const model = await resolveAgentModelProfile(ctx, AgentModelProfile.textLow)
            const result = await runSyncSubagent({
                task: this.prompt(),
                role: "decision helper",
                toolkits: [SubagentToolkitName.ioRead, SubagentToolkitName.webRead],
                cwd: ctx.cwd,
                timeoutSeconds: this.info.timeoutSeconds ?? 30,
                model,
                systemPrompt: this.info.task,
            }, ctx.signal)
            this.parse(result.output)
        } catch {
            // AI help is best-effort; the flow should continue without it.
        }
    }

    private prompt(): string {
        return [
            "Provide concise UI help for an approval decision.",
            "For the full item explain what it will accomplish.",
            "For the individual sub-items explain why they are relevant for the whole.",
            "Return only machine-readable lines in this format:",
            "FULL|<one short summary for the full item>",
            "ITEM|<index>|<short description for that sub-item>",
            "Descriptions must be neutral, clear, and at most 12 words.",
            "Do not include markdown, bullets, or extra lines.",
            `Full item: ${JSON.stringify(this.info.fullItem)}`,
            "Sub-items:",
            ...this.info.subItems.map((item, index) => `${index}|${item}`),
        ].join("\n")
    }

    private parse(output: string): void {
        for (const line of output.split(/\r?\n/)) {
            const trimmed = line.trim()
            const fullMatch = trimmed.match(/^FULL\|(.*)$/)
            if (fullMatch) {
                this.fullInfo = this.cleanAiHelpText(fullMatch[1] ?? "", 180)
                continue
            }

            const itemMatch = trimmed.match(/^ITEM\|(\d+)\|(.*)$/)
            if (!itemMatch) continue
            const index = Number(itemMatch[1])
            const info = this.cleanAiHelpText(itemMatch[2] ?? "", 100)
            if (Number.isInteger(index) && index >= 0 && index < this.info.subItems.length && info) {
                this.subItemInfo.set(index, info)
            }
        }
    }

    private cleanAiHelpText(output: string, maxLength: number): string {
        return output.replace(/\s+/g, " ").trim().slice(0, maxLength)
    }
}