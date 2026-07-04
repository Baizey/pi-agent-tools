import {SubagentRunMode, SubagentToolkit} from "../toolkits";

export const subagentNodeStatuses = {
  starting: "starting",
  running: "running",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
  timedOut: "timed_out",
} as const;

export type SubagentNodeStatus = typeof subagentNodeStatuses[keyof typeof subagentNodeStatuses];

export type SubagentNode = {
  id: string;
  rootId: string;
  parentId?: string;
  depth: number;
  mode: SubagentRunMode;
  task: string;
  role: string;
  toolkits: SubagentToolkit[];
  tools: string[];
  status: SubagentNodeStatus;
  latestLine: string;
  startedAt: number;
  finishedAt?: number;
  children: string[];
};

export type SubagentTreeContext = {
  rootId?: string;
  parentId?: string;
  nodeId?: string;
  depth: number;
};
