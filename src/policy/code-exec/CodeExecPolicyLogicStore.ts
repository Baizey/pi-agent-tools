import fs from "node:fs";
import {CodeExecPolicySnapshot} from "../types";
import {parseJsonObjectFile, sanitizeCodeExecPolicySnapshot} from "../validation";
import {CodeExecPolicyLogic} from "./CodeExecPolicyLogic";
import {CodeExecPolicyDao} from "../../storage";

export class CodeExecPolicyLogicStore {
  constructor(
    private readonly dao: CodeExecPolicyDao,
    private readonly legacyFile?: string,
  ) {}

  loadInto(policy: CodeExecPolicyLogic): void {
    policy.addPolicies(this.dao.loadPolicies());
    this.importLegacyJson(policy);
  }

  save(policy: CodeExecPolicyLogic): void {
    this.dao.replacePolicies(policy.persistedPolicies());
  }

  private importLegacyJson(policy: CodeExecPolicyLogic): void {
    if (!this.legacyFile || !fs.existsSync(this.legacyFile)) return;
    const snapshot = sanitizeCodeExecPolicySnapshot(parseJsonObjectFile<CodeExecPolicySnapshot>(() => fs.readFileSync(this.legacyFile as string, "utf8")));
    policy.addPolicies(snapshot.policies);
    this.save(policy);
    fs.rmSync(this.legacyFile, {force: true});
  }
}
