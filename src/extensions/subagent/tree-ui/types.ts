import {SubagentRunStatus} from "../../../storage";
import {SubagentRunMode, SubagentToolkit} from "../toolkits";

export {SubagentRunStatus as subagentNodeStatuses};
export type SubagentNodeStatus = SubagentRunStatus;

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
