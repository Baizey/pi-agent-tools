import {agentEnv} from "../../../shared/env";
import {SubagentTreeContext} from "./types";

export function readSubagentTreeContext(env: NodeJS.ProcessEnv = process.env): SubagentTreeContext {
  return {
    rootId: env[agentEnv.subagentRootId],
    parentId: env[agentEnv.subagentParentId],
    nodeId: env[agentEnv.subagentNodeId],
    depth: parseDepth(env[agentEnv.subagentDepth]),
    treeDir: env[agentEnv.subagentTreeDir],
  };
}

export function subagentTreeEnv(input: {rootId: string; parentId?: string; nodeId: string; depth: number; treeDir?: string}): Record<string, string> {
  return {
    [agentEnv.subagentRootId]: input.rootId,
    [agentEnv.subagentParentId]: input.parentId ?? "",
    [agentEnv.subagentNodeId]: input.nodeId,
    [agentEnv.subagentDepth]: String(input.depth),
    ...(input.treeDir ? {[agentEnv.subagentTreeDir]: input.treeDir} : {}),
  };
}

function parseDepth(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}
