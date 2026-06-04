import fs from "node:fs";
import path from "node:path";
import {WebPolicySnapshot} from "../types";
import {parseJsonObjectFile, sanitizeWebPolicySnapshot} from "../validation";
import {WebPolicyLogic} from "./WebPolicyLogic";

export class WebPolicyLogicStore {
  constructor(private readonly file: string) {}

  loadInto(policy: WebPolicyLogic): void {
    if (!fs.existsSync(this.file)) return;
    const snapshot = sanitizeWebPolicySnapshot(parseJsonObjectFile<WebPolicySnapshot>(() => fs.readFileSync(this.file, "utf8")));
    policy.addPolicies(snapshot.policies);
  }

  save(policy: WebPolicyLogic): void {
    fs.mkdirSync(path.dirname(this.file), {recursive: true});
    const snapshot: WebPolicySnapshot = {
      policies: policy.persistedPolicies().sort((left, right) => `${left.host}${left.path}${left.accessType}`.localeCompare(`${right.host}${right.path}${right.accessType}`)),
    };
    fs.writeFileSync(this.file, `${JSON.stringify(snapshot, null, 2)}\n`, {encoding: "utf8", mode: 0o600});
  }
}
