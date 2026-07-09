import type {Component, Theme, ToolRenderContext} from "../../pi/types";

export type RenderTheme = Pick<Theme, "fg" | "bold">;
export type ExpansionContext = Pick<ToolRenderContext, "expanded">;
export type StaticTextComponent = Component;
