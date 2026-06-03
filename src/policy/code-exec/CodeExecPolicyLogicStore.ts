import fs from "node:fs";
import path from "node:path";
import {CodeExecPolicySnapshot} from "../types";
import {CodeExecPolicyLogic} from "./CodeExecPolicyLogic";

export class CodeExecPolicyLogicStore {
  constructor(private readonly file: string) {}

  loadInto(policy: CodeExecPolicyLogic): void {
    if (!fs.existsSync(this.file)) return;
    const snapshot = JSON.parse(fs.readFileSync(this.file, "utf8")) as CodeExecPolicySnapshot;
    policy.addPolicies(snapshot.policies);
  }

  save(policy: CodeExecPolicyLogic): void {
    fs.mkdirSync(path.dirname(this.file), {recursive: true});
    const snapshot: CodeExecPolicySnapshot = {policies: policy.persistedPolicies()};
    fs.writeFileSync(this.file, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }
}
