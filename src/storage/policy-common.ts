import {CodeExecMode, FsAccessType, PolicyLifetime, PolicyStatus, WebAccessType} from "../policy/types";

export const policyStatusesSql = sqlStringList(Object.values(PolicyStatus));
export const policyLifetimesSql = sqlStringList(Object.values(PolicyLifetime));
export const fsAccessTypesSql = sqlStringList(Object.values(FsAccessType));
export const webAccessTypesSql = sqlStringList(Object.values(WebAccessType));
export const codeExecModesSql = sqlStringList(["inline", "file", "*"] satisfies Array<CodeExecMode | "*">);

function sqlStringList(values: string[]): string {
  return values.map((it) => `'${it.replace(/'/g, "''")}'`).join(", ");
}
