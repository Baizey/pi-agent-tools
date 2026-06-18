import {ExtensionContext} from "../../../pi/types";
import {UIAiHelpWrap} from "./DecisionAiHelper";

type ValueOrLambda<T, K> = K | ((state: Partial<T>) => K);

type Component = {
    render(width: number): string[];
    handleInput?(data: string): void;
    invalidate(): void;
};

type ShortcutTui = {requestRender(): void};
type ShortcutTheme = {
    fg?: (name: string, text: string) => string;
    bg?: (name: string, text: string) => string;
    bold?: (text: string) => string;
};
type ShortcutKeybindings = {matches?: (data: string, key: string) => boolean};
type ShortcutCustomUi = {
    custom<T>(factory: (tui: ShortcutTui, theme: ShortcutTheme, keybindings: ShortcutKeybindings, done: (value: T) => void) => Component): Promise<T>;
};

/**
 * K cannot be a function.
 */
const parse = <T, K>(lambdaMaybe: ValueOrLambda<T, K>, input: Partial<T>): K => {
    if (typeof lambdaMaybe === "function") {
        return (lambdaMaybe as ((state: Partial<T>) => K))(input);
    }
    return lambdaMaybe;
};

function isUiFlowShortcut(value: unknown): value is UiFlowShortcut {
    return value === UiFlowShortcut.ALLOW_ALL_ONCE || value === UiFlowShortcut.DENY_ALL_ONCE;
}

export type UiSelectDecisionOption<T> = {
    title: ValueOrLambda<T, string>;
    /**
     * Should technically be bound to T[keyof T] for the relevant key, but please just remember this on usage
     */
    value: T[keyof T];
    /**
     * Returns the key of the next decision to run
     * Return null if the flow is completed and should finish
     */
    next: ValueOrLambda<T, keyof T | null>;
};

export type UiDecision<T> = UiSelectDecision<T> | UiInputDecision<T>;

export enum UiFlowShortcut {
    ALLOW_ALL_ONCE = "ALLOW_ALL_ONCE",
    DENY_ALL_ONCE = "DENY_ALL_ONCE",
}

export type UiFlowShortcutOptions = {
    enabled?: boolean;
};

export type UiSelectDecision<T> = {
    type: "select";
    title: ValueOrLambda<T, string>;
    key: keyof T;
    options: UiSelectDecisionOption<T>[];
    showAiHelpOption: boolean;
};

export type UiInputDecision<T> = {
    type: "input";
    title: ValueOrLambda<T, string>;
    key: keyof T;
    placeholder: ValueOrLambda<T, string>;
    next: ValueOrLambda<T, keyof T | null>;
};

export class UiDecisionFlowManager {
    constructor(private ctx: ExtensionContext) {}

    async runFlow<T>(
        initialDecision: UiDecision<T>,
        allDecisions: Record<keyof T, UiDecision<T>>,
        onCancelReturn: (state: Partial<T>) => T,
        aiHelp?: UIAiHelpWrap,
        shortcuts?: UiFlowShortcutOptions,
    ): Promise<T | UiFlowShortcut> {
        const state = {} as Partial<T>;
        if (!this.ctx.ui?.input || !this.ctx.ui.select) return onCancelReturn(state);

        let currentDecision = initialDecision;
        while (currentDecision) {
            const choice = await this.resolveDecision(currentDecision, state, aiHelp, shortcuts);
            if (!choice) return onCancelReturn(state);
            if (isUiFlowShortcut(choice)) return choice;

            state[currentDecision.key] = choice.value;
            const nextDecisionKey = parse(choice.next, state);
            if (!nextDecisionKey) break;
            currentDecision = allDecisions[nextDecisionKey];
        }
        return state as T;
    }

    private async resolveDecision<T>(
        decision: UiDecision<T>,
        state: Partial<T>,
        aiHelp?: UIAiHelpWrap,
        shortcuts?: UiFlowShortcutOptions,
    ): Promise<UiSelectDecisionOption<T> | UiFlowShortcut | null> {
        const baseTitle = parse(decision.title, state);
        const title = aiHelp?.titleWithHelp(baseTitle) ?? baseTitle;

        switch (decision.type) {
            case "select":
                return this.resolveSelectDecision(decision, state, title, aiHelp, shortcuts);
            case "input":
                return this.resolveInputDecision(decision, state, title);
            default:
                throw new Error(`Decision type ${(decision as {type: string}).type} not supported.`);
        }
    }

    private async resolveSelectDecision<T>(
        decision: UiSelectDecision<T>,
        state: Partial<T>,
        title: string,
        aiHelp?: UIAiHelpWrap,
        shortcuts?: UiFlowShortcutOptions,
    ): Promise<UiSelectDecisionOption<T> | UiFlowShortcut | null> {
        const renderedOptions = decision.options.map((option) => renderOptionTitle(option, state, aiHelp));
        const lookup = Object.fromEntries(renderedOptions.map((title, index) => [title, decision.options[index]]));
        if (decision.showAiHelpOption && aiHelp) renderedOptions.push(aiHelp.optionLabel());

        const choice = shortcuts?.enabled && hasShortcutUi(this.ctx)
            ? await shortcutSelect(this.ctx.ui, title, renderedOptions)
            : await this.ctx.ui!.select(title, renderedOptions);

        if (!choice) return null;
        if (isUiFlowShortcut(choice)) return choice;
        if (choice === aiHelp?.optionLabel()) {
            await aiHelp.load(this.ctx);
            return this.resolveSelectDecision(decision, state, title, aiHelp, shortcuts);
        }
        return lookup[choice] ?? null;
    }

    private async resolveInputDecision<T>(
        decision: UiInputDecision<T>,
        state: Partial<T>,
        title: string,
    ): Promise<UiSelectDecisionOption<T> | null> {
        const input = await this.ctx.ui!.input!(title, parse(decision.placeholder, state));
        if (input === undefined) return null;
        return {
            title: "",
            value: (input || "") as T[keyof T],
            next: decision.next,
        } satisfies UiSelectDecisionOption<T>;
    }
}

function renderOptionTitle<T>(option: UiSelectDecisionOption<T>, state: Partial<T>, aiHelp?: UIAiHelpWrap): string {
    const title = parse(option.title, state);
    return aiHelp?.optionTitleWithHelp(title) ?? title;
}

function hasShortcutUi(ctx: ExtensionContext): ctx is ExtensionContext & {ui: ShortcutCustomUi} {
    return typeof (ctx.ui as {custom?: unknown} | undefined)?.custom === "function";
}

async function shortcutSelect(
    ui: ShortcutCustomUi,
    title: string,
    options: string[],
): Promise<string | UiFlowShortcut | undefined> {
    return ui.custom<string | UiFlowShortcut | undefined>((tui, theme, keybindings, done) => {
        return new ShortcutSelectComponent(tui, theme, keybindings, done, title, options);
    });
}

class ShortcutSelectComponent implements Component {
    private selected = 0;

    constructor(
        private readonly tui: ShortcutTui,
        private readonly theme: ShortcutTheme,
        private readonly keybindings: ShortcutKeybindings,
        private readonly done: (value: string | UiFlowShortcut | undefined) => void,
        private readonly title: string,
        private readonly options: string[],
    ) {}

    render(width: number): string[] {
        const titleLines = this.title.split(/\r?\n/).map((line) => this.color("accent", this.bold(line)));
        const optionLines = this.options.map((option, index) => this.renderOption(option, index));
        return [...titleLines, ...optionLines].map((line) => truncate(line, width));
    }

    handleInput(data: string): void {
        if (this.isRight(data)) return this.done(UiFlowShortcut.ALLOW_ALL_ONCE);
        if (this.isLeft(data)) return this.done(UiFlowShortcut.DENY_ALL_ONCE);
        if (this.isUp(data)) this.moveSelection(-1);
        else if (this.isDown(data)) this.moveSelection(1);
        else if (this.isEnter(data)) return this.done(this.options[this.selected]);
        else if (this.isEscape(data)) return this.done(undefined);
        this.tui.requestRender();
    }

    invalidate(): void {}

    private renderOption(option: string, index: number): string {
        const prefix = index === this.selected ? "› " : "  ";
        const line = `${prefix}${option}`;
        return index === this.selected ? this.bg("selectedBg", this.color("accent", line)) : line;
    }

    private moveSelection(delta: -1 | 1): void {
        if (this.options.length === 0) return;
        this.selected = (this.selected + delta + this.options.length) % this.options.length;
    }

    private isLeft(data: string): boolean {
        return this.matches(data, "tui.editor.cursorLeft") || this.matches(data, "tui.select.pageUp") || data === "\x1b[D";
    }

    private isRight(data: string): boolean {
        return this.matches(data, "tui.editor.cursorRight") || this.matches(data, "tui.select.pageDown") || data === "\x1b[C";
    }

    private isUp(data: string): boolean {
        return this.matches(data, "tui.select.up") || data === "\x1b[A";
    }

    private isDown(data: string): boolean {
        return this.matches(data, "tui.select.down") || data === "\x1b[B";
    }

    private isEnter(data: string): boolean {
        return this.matches(data, "tui.select.confirm") || data === "\r" || data === "\n";
    }

    private isEscape(data: string): boolean {
        return this.matches(data, "tui.select.cancel") || data === "\x1b";
    }

    private matches(data: string, key: string): boolean {
        return this.keybindings.matches?.(data, key) === true;
    }

    private color(name: string, text: string): string {
        return this.theme.fg ? this.theme.fg(name, text) : text;
    }

    private bg(name: string, text: string): string {
        return this.theme.bg ? this.theme.bg(name, text) : text;
    }

    private bold(text: string): string {
        return this.theme.bold ? this.theme.bold(text) : text;
    }
}

function truncate(line: string, width: number): string {
    if (!Number.isFinite(width) || width <= 0 || line.length <= width) return line;
    return `${line.slice(0, Math.max(0, width - 1))}…`;
}
