import {ExtensionContext} from "../../../pi/types";
import {agentModelProfiles, resolveAgentModelProfile, runSyncSubagent, subagentProfileNames} from "../../subagent";

export type UiSelectDecisionOption<T> = {
    title: (state: Partial<T>) => string
    /**
     * Should technically be bound to T[keyof T] for the relevant key, but please just remember this on usage
     */
    value: T[keyof T]
    /**
     * Returns the key of the next decision to run
     * Return null if the flow is completed and should finish
     */
    next: (state: Partial<T>) => keyof T | null
}

export type UiDecision<T> = UiSelectDecision<T> | UiInputDecision<T>

export type UiSelectDecision<T> = {
    type: "select"
    title: (state: Partial<T>) => string
    key: keyof T
    options: UiSelectDecisionOption<T>[],
    showAiHelpOption: boolean
}

export type UiInputDecision<T> = {
    type: "input"
    title: (state: Partial<T>) => string
    key: keyof T
    placeholder: (state: Partial<T>) => string
    next: (state: Partial<T>) => keyof T | null
}

export class UiDecisionFlowManager {
    constructor(private ctx: ExtensionContext) {
    }

    async runFlow<T>(
        initialDecision: UiDecision<T>,
        allDecisions: Record<keyof T, UiDecision<T>>,
        onCancelReturn: (state: Partial<T>) => T,
        aiHelp?: UIAiHelpWrap,
    ): Promise<T> {
        const state = {} as Partial<T>
        if (!this.ctx.ui || !this.ctx.ui.input || !this.ctx.ui.select) return onCancelReturn(state)

        let currentDecision = initialDecision
        while (currentDecision) {
            const choice = await this.resolveDecision(currentDecision, state, aiHelp)
            if (!choice) return onCancelReturn(state)
            state[currentDecision.key] = choice.value

            const nextDecisionKey = choice.next(state)
            if (!nextDecisionKey) break
            currentDecision = allDecisions[nextDecisionKey]
        }
        return state as T
    }

    private async resolveDecision<T>(
        decision: UiDecision<T>,
        state: Partial<T>,
        aiHelp?: UIAiHelpWrap,
    ): Promise<UiSelectDecisionOption<T> | null> {
        const title = aiHelp?.titleWithHelp(decision.title(state)) ?? decision.title(state)
        const type = decision.type
        switch (type) {
            case "select":
                const lookup = {} as { [title: string]: UiSelectDecisionOption<T> }
                decision.options.forEach(option => lookup[aiHelp?.optionTitleWithHelp(option.title(state)) ?? option.title(state)] = option)
                const options = decision.options.map(option => aiHelp?.optionTitleWithHelp(option.title(state)) ?? option.title(state))
                if (decision.showAiHelpOption && aiHelp) options.push(aiHelp.optionLabel())
                const choice = await this.ctx.ui!.select(title, options)
                if (!choice) return null;
                if (choice === aiHelp?.optionLabel()) {
                    await aiHelp.load(this.ctx)
                    return this.resolveDecision(decision, state, aiHelp)
                }
                return lookup[choice]
            case "input":
                const placeholder = decision.placeholder(state)
                const inputMethod = this.ctx.ui!.input!
                const input = await inputMethod(title, placeholder)
                if (input === undefined) return null;
                return {
                    title: () => "",
                    value: (input || "") as T[keyof T],
                    next: decision.next,
                } satisfies UiSelectDecisionOption<T>
            default:
                throw new Error(`Decision type ${type} not supported.`)
        }
    }
}


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
            const model = await resolveAgentModelProfile(ctx, agentModelProfiles.textLow)
            const result = await runSyncSubagent({
                task: this.prompt(),
                profiles: [subagentProfileNames.ioRead, subagentProfileNames.webRead],
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