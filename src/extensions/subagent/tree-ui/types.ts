import {SubagentRunStatus} from "../../../storage";
import {SubagentRunMode, SubagentToolkitName} from "../toolkits";

export {SubagentRunStatus};

export type SubagentNode = {
  id: string;
  rootId: string;
  parentId?: string;
  depth: number;
  mode: SubagentRunMode;
  task: string;
  role: string;
  toolkits: SubagentToolkitName[];
  tools: string[];
  status: SubagentRunStatus;
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
