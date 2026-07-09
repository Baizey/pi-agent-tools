import type {RenderTheme} from "./types";

type KeyHintFn = (keybinding: string, description: string) => string;
type KeyTextFn = (keybinding: string) => string;
type KeybindingHelpers = {keyHint?: KeyHintFn; keyText?: KeyTextFn};

export type KeybindingHint = {
  keybinding: string;
  defaultKey: string;
  description: string;
};

let cachedHelpers: KeybindingHelpers | null | undefined;

export function formatKeybindingHint(hint: KeybindingHint, theme?: RenderTheme): string {
  const helpers = loadHelpers();
  const configuredKey = readConfiguredKey(helpers, hint.keybinding);
  const key = configuredKey || hint.defaultKey;

  if (configuredKey && helpers?.keyHint) {
    try {
      return helpers.keyHint(hint.keybinding, hint.description);
    } catch {
      // Fall through to the local formatter.
    }
  }
  return color(theme, "dim", key) + color(theme, "muted", ` ${hint.description}`);
}

function readConfiguredKey(helpers: KeybindingHelpers | undefined, keybinding: string): string | undefined {
  try {
    return helpers?.keyText?.(keybinding)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function loadHelpers(): KeybindingHelpers | undefined {
  if (cachedHelpers !== undefined) return cachedHelpers ?? undefined;
  try {
    const piPackage = require("@earendil-works/pi-coding-agent") as {keyHint?: unknown; keyText?: unknown};
    cachedHelpers = {
      keyHint: typeof piPackage.keyHint === "function" ? piPackage.keyHint as KeyHintFn : undefined,
      keyText: typeof piPackage.keyText === "function" ? piPackage.keyText as KeyTextFn : undefined,
    };
  } catch {
    cachedHelpers = null;
  }
  return cachedHelpers ?? undefined;
}

function color(theme: RenderTheme | undefined, name: string, text: string): string {
  return theme?.fg ? theme.fg(name, text) : text;
}
