import {AgentEnvName} from "../../../shared/env";
import {SubagentTreeContext} from "./types";

export function readSubagentTreeContext(env: NodeJS.ProcessEnv = process.env): SubagentTreeContext {
  return {
    rootId: env[AgentEnvName.subagentRootId],
    parentId: env[AgentEnvName.subagentParentId],
    nodeId: env[AgentEnvName.subagentNodeId],
    depth: parseDepth(env[AgentEnvName.subagentDepth]),
  };
}

export function subagentTreeEnv(input: {rootId: string; parentId?: string; nodeId: string; depth: number}): Record<string, string> {
  return {
    [AgentEnvName.subagentRootId]: input.rootId,
    [AgentEnvName.subagentParentId]: input.parentId ?? "",
    [AgentEnvName.subagentNodeId]: input.nodeId,
    [AgentEnvName.subagentDepth]: String(input.depth),
  };
}

function parseDepth(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}
