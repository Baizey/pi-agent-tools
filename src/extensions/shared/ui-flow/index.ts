import {ExtensionContext} from "../../../pi/types";
import {UIAiHelpWrap} from "./DecisionAiHelper";

type ValueOrLambda<T, K> = K | ((state: Partial<T>) => K)

/**
 * K cannot be a function.
 */
const parse = <T, K>(lambdaMaybe: ValueOrLambda<T, K>, input: Partial<T>): K => {
    if (typeof lambdaMaybe === "function") {
        return (lambdaMaybe as ((state: Partial<T>) => K))(input)
    }
    return lambdaMaybe
}

export type UiSelectDecisionOption<T> = {
    title: ValueOrLambda<T, string>
    /**
     * Should technically be bound to T[keyof T] for the relevant key, but please just remember this on usage
     */
    value: T[keyof T]
    /**
     * Returns the key of the next decision to run
     * Return null if the flow is completed and should finish
     */
    next: ValueOrLambda<T, keyof T | null>
}

export type UiDecision<T> = UiSelectDecision<T> | UiInputDecision<T>

export type UiSelectDecision<T> = {
    type: "select"
    title: ValueOrLambda<T, string>
    key: keyof T
    options: UiSelectDecisionOption<T>[],
    showAiHelpOption: boolean
}

export type UiInputDecision<T> = {
    type: "input"
    title: ValueOrLambda<T, string>
    key: keyof T
    placeholder: ValueOrLambda<T, string>
    next: ValueOrLambda<T, keyof T | null>
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

            const nextDecisionKey = parse(choice.next, state)
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
        const baseTitle = parse(decision.title, state)
        const title = aiHelp?.titleWithHelp(baseTitle) ?? baseTitle
        const type = decision.type
        switch (type) {
            case "select":
                const lookup = {} as { [title: string]: UiSelectDecisionOption<T> }
                decision.options.forEach(option => lookup[aiHelp?.optionTitleWithHelp(parse(option.title, state)) ?? parse(option.title, state)] = option)
                const options = decision.options.map(option => aiHelp?.optionTitleWithHelp(parse(option.title, state)) ?? parse(option.title, state))
                if (decision.showAiHelpOption && aiHelp) options.push(aiHelp.optionLabel())
                const choice = await this.ctx.ui!.select(title, options)
                if (!choice) return null;
                if (choice === aiHelp?.optionLabel()) {
                    await aiHelp.load(this.ctx)
                    return this.resolveDecision(decision, state, aiHelp)
                }
                return lookup[choice]
            case "input":
                const placeholder = parse(decision.placeholder, state)
                const inputMethod = this.ctx.ui!.input!
                const input = await inputMethod(title, placeholder)
                if (input === undefined) return null;
                return {
                    title: "",
                    value: (input || "") as T[keyof T],
                    next: decision.next,
                } satisfies UiSelectDecisionOption<T>
            default:
                throw new Error(`Decision type ${type} not supported.`)
        }
    }
}