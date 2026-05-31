import path from "node:path";
import { PathPolicyLogic } from "./path/PathPolicyLogic";
import { FsAccessType, PolicyLifetime, PolicyStatus } from "./path/types";

export type PiPathPolicyOptions = {
  cwd: string;
  globalPiDir?: string;
  projectPiDir?: string;
};

export class PiPathPolicy {
  static create(options: PiPathPolicyOptions): PathPolicyLogic {
    const cwd = path.resolve(options.cwd);
    const standardizePath = (input: string) => path.resolve(cwd, input).normalize().replace(/[\\/]+$/g, "");
    const projectPiDir = options.projectPiDir ?? path.join(cwd, ".pi");
    const policy = new PathPolicyLogic({ standardizePath });

    policy.addPolicies([
      PathPolicyLogic.createPolicy(cwd, PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "Project path is allowed."),
      PathPolicyLogic.createPolicy(projectPiDir, PolicyStatus.DENIED, PolicyLifetime.SESSION, "Project pi internals are disallowed."),
    ]);

    if (options.globalPiDir) {
      policy.addPolicies([
        PathPolicyLogic.createPolicy(options.globalPiDir, PolicyStatus.DENIED, PolicyLifetime.SESSION, "Global pi internals are disallowed."),
      ]);
    }

    return policy;
  }

  static accessTypeForTool(toolName: string): FsAccessType | null {
    switch (toolName) {
      case "read":
      case "grep":
      case "find":
      case "ls":
        return FsAccessType.READ;
      case "write":
        return FsAccessType.WRITE;
      case "edit":
        return FsAccessType.EDIT;
      default:
        return null;
    }
  }
}
