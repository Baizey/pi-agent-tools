import {ExtensionContext} from "../../../pi/types";

export type UiSelectDecisionOption<T> = {
    title: (state: Partial<T>) => string
    /**
     * Should technically be bound to T[keyof T] for the relevant key, but please just remember this on usage
     */
    value: any
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
    options: UiSelectDecisionOption<T>[]
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
        onCancelReturn: (state: Partial<T>) => T
    ): Promise<T> {
        const state = {} as Partial<T>
        if (!this.ctx.ui || !this.ctx.ui.input || !this.ctx.ui.select) return onCancelReturn(state)

        let currentDecision = initialDecision
        while (currentDecision) {
            const choice = await this.resolveDecision(currentDecision, state)
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
        state: Partial<T>
    ): Promise<UiSelectDecisionOption<T> | null> {
        const title = decision.title(state)
        const type = decision.type
        switch (type) {
            case "select":
                const lookup = {} as { [title: string]: UiSelectDecisionOption<T> }
                decision.options.forEach(option => lookup[option.title(state)] = option)
                const options = decision.options.map(option => option.title(state))
                const choice = await this.ctx.ui!.select(title, options)
                if (!choice) return null;
                return lookup[choice]
            case "input":
                const placeholder = decision.placeholder(state)
                const inputMethod = this.ctx.ui!.input!
                const input = await inputMethod(title, placeholder)
                if (input === undefined) return null;
                return {
                    title: () => "",
                    value: input || "",
                    next: decision.next,
                } satisfies UiSelectDecisionOption<T>
            default:
                throw new Error(`Decision type ${type} not supported.`)
        }
    }
}
