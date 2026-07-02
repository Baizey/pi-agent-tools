import fs from "node:fs";
import {ShellPolicySnapshot} from "../types";
import {parseJsonObjectFile, sanitizeShellPolicySnapshot} from "../validation";
import {ShellPolicyLogic} from "./ShellPolicyLogic";
import {ShellPolicyDao} from "../../storage";

export class ShellPolicyLogicStore {
  constructor(
    private readonly dao: ShellPolicyDao,
    private readonly legacyFile?: string,
  ) {}

  loadInto(policy: ShellPolicyLogic): void {
    policy.addPolicies(this.dao.loadPolicies());
    this.importLegacyJson(policy);
  }

  save(policy: ShellPolicyLogic): void {
    this.dao.replacePolicies(policy.persistedPolicies());
  }

  private importLegacyJson(policy: ShellPolicyLogic): void {
    if (!this.legacyFile || !fs.existsSync(this.legacyFile)) return;
    const snapshot = sanitizeShellPolicySnapshot(parseJsonObjectFile<ShellPolicySnapshot>(() => fs.readFileSync(this.legacyFile as string, "utf8")));
    policy.addPolicies(snapshot.policies);
    this.save(policy);
    fs.rmSync(this.legacyFile, {force: true});
  }
}
