import fs from "node:fs";
import {PathPolicyLogic} from "./PathPolicyLogic";
import {PathPolicySnapshot} from "../types";
import {parseJsonObjectFile, sanitizePathPolicySnapshot} from "../validation";
import {PathPolicyDao} from "../../storage";

export class PathPolicyLogicStore {
  constructor(
    private readonly dao: PathPolicyDao,
    private readonly legacyFile?: string,
  ) {}

  loadInto(policy: PathPolicyLogic): void {
    policy.addPolicies(this.dao.loadPolicies());
    this.importLegacyJson(policy);
  }

  save(policy: PathPolicyLogic): void {
    this.dao.replacePolicies(policy.persistedPolicies().sort((left, right) => left.path.localeCompare(right.path)));
  }

  private importLegacyJson(policy: PathPolicyLogic): void {
    if (!this.legacyFile || !fs.existsSync(this.legacyFile)) return;
    const snapshot = sanitizePathPolicySnapshot(parseJsonObjectFile<PathPolicySnapshot>(() => fs.readFileSync(this.legacyFile as string, "utf8")));
    policy.addPolicies(snapshot.policies);
    this.save(policy);
    fs.rmSync(this.legacyFile, {force: true});
  }
}
