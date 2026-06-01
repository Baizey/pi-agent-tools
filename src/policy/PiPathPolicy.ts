import path from "node:path";
import {PathPolicyLogic} from "./path/PathPolicyLogic";
import {FsAccessType} from "./types";
import {PathPolicyLogicStore} from "./path/PathPolicyLogicStore";
import fs from "node:fs";

export type PiPathPolicyOptions = {
    cwd: string;
    globalPiDir: string;
    projectPiDir?: string;
};

export class PiPathPolicy {
    static create(options: PiPathPolicyOptions): PathPolicyLogic {
        const cwd = path.resolve(options.cwd);
        const standardizePath = (input: string) => path.resolve(cwd, input).normalize().replace(/[\\/]+$/g, "");
        const policy = new PathPolicyLogic({standardizePath});
        const pathPolicyPersistenceLocation = path.resolve(options.globalPiDir, "path-policy.json")

        if (fs.existsSync(pathPolicyPersistenceLocation)) {
            new PathPolicyLogicStore(pathPolicyPersistenceLocation).loadInto(policy);
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
            case 'bash':
                return FsAccessType.EXECUTE;
            default:
                return null;
        }
    }
}
