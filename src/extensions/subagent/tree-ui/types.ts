import {SubagentProfile, SubagentRunMode} from "../profiles";

export type SubagentNodeStatus = "starting" | "running" | "done" | "failed" | "cancelled" | "timed_out";

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
};
