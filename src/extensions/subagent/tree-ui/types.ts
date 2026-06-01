import {SubagentProfile, SubagentRunMode} from "../profiles";

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
  profiles: SubagentProfile[];
  tools: string[];
  status: SubagentNodeStatus;
  latestLine: string;
  startedAt: number;
  finishedAt?: number;
  children: string[];
};

export type StartSubagentNodeInput = {
  id?: string;
  parentId?: string;
  rootId?: string;
  depth?: number;
  mode: SubagentRunMode;
  task: string;
  profiles: SubagentProfile[];
  tools: string[];
};

export type SubagentNodeUpdate = Partial<Pick<SubagentNode, "status" | "latestLine" | "finishedAt">>;

export type SubagentTreeContext = {
  rootId?: string;
  parentId?: string;
  nodeId?: string;
  depth: number;
  treeDir?: string;
};
