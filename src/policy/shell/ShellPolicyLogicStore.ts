import fs from "node:fs";
import path from "node:path";
import { ShellPolicySnapshot } from "../types";
import { ShellPolicyLogic } from "./ShellPolicyLogic";

export class ShellPolicyLogicStore {
  constructor(private readonly file: string) {}

  loadInto(policy: ShellPolicyLogic): void {
    if (!fs.existsSync(this.file)) return;
    const snapshot = JSON.parse(fs.readFileSync(this.file, "utf8")) as ShellPolicySnapshot;
    policy.addPolicies(snapshot.policies);
  }

  save(policy: ShellPolicyLogic): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const snapshot: ShellPolicySnapshot = { policies: policy.persistedPolicies() };
    fs.writeFileSync(this.file, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }
}
