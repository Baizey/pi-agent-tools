import fs from "node:fs";
import path from "node:path";
import { PathPolicyLogic } from "./PathPolicyLogic";
import { PathPolicySnapshot } from "../types";
import {parseJsonObjectFile, sanitizePathPolicySnapshot} from "../validation";

export class PathPolicyLogicStore {
  constructor(private readonly file: string) {}

  loadInto(policy: PathPolicyLogic): void {
    if (!fs.existsSync(this.file)) return;
    const snapshot = sanitizePathPolicySnapshot(parseJsonObjectFile<PathPolicySnapshot>(() => fs.readFileSync(this.file, "utf8")));
    policy.addPolicies(snapshot.policies);
  }

  save(policy: PathPolicyLogic): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const snapshot: PathPolicySnapshot = {
      policies: policy.persistedPolicies().sort((left, right) => left.path.localeCompare(right.path)),
    };
    fs.writeFileSync(this.file, `${JSON.stringify(snapshot, null, 2)}\n`, {encoding: "utf8", mode: 0o600});
  }
}
