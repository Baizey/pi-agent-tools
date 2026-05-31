import path from "node:path";
import {PathPolicyLogic} from "./path/PathPolicyLogic";
import {FsAccessType} from "./types";
import {PathPolicyLogicStore} from "./path/PathPolicyLogicStore";

export type PiPathPolicyOptions = {
    cwd: string;
    globalPiDir?: string;
    projectPiDir?: string;
};

export class PiPathPolicy {
    static create(options: PiPathPolicyOptions): PathPolicyLogic {
        const cwd = path.resolve(options.cwd);
        const standardizePath = (input: string) => path.resolve(cwd, input).normalize().replace(/[\\/]+$/g, "");
        const policy = new PathPolicyLogic({standardizePath})
        if (options.globalPiDir) {
            new PathPolicyLogicStore(options.globalPiDir).loadInto(policy);
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
