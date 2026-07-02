import fs from "node:fs";
import {WebPolicySnapshot} from "../types";
import {parseJsonObjectFile, sanitizeWebPolicySnapshot} from "../validation";
import {WebPolicyLogic} from "./WebPolicyLogic";
import {WebPolicyDao} from "../../storage";

export class WebPolicyLogicStore {
  constructor(
    private readonly dao: WebPolicyDao,
    private readonly legacyFile?: string,
  ) {}

  loadInto(policy: WebPolicyLogic): void {
    policy.addPolicies(this.dao.loadPolicies());
    this.importLegacyJson(policy);
  }

  save(policy: WebPolicyLogic): void {
    this.dao.replacePolicies(policy.persistedPolicies().sort((left, right) => `${left.host}${left.path}${left.accessType}`.localeCompare(`${right.host}${right.path}${right.accessType}`)));
  }

  private importLegacyJson(policy: WebPolicyLogic): void {
    if (!this.legacyFile || !fs.existsSync(this.legacyFile)) return;
    const snapshot = sanitizeWebPolicySnapshot(parseJsonObjectFile<WebPolicySnapshot>(() => fs.readFileSync(this.legacyFile as string, "utf8")));
    policy.addPolicies(snapshot.policies);
    this.save(policy);
    fs.rmSync(this.legacyFile, {force: true});
  }
}
