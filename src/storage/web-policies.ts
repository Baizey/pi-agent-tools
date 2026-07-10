import {SqliteDatabase} from "./sqlite";
import {policyLifetimesSql, policyStatusesSql, webAccessTypesSql} from "./policy-common";
import {PolicyLifetime, PolicyStatus, WebAccessType, WebPolicy} from "../policy/types";
import {sanitizeWebPolicySnapshot} from "../policy/validation";

type WebPolicyRuleRow = {
  host: string;
  path: string;
  accessType: WebAccessType;
  lifetime: PolicyLifetime;
  status: PolicyStatus;
  reason: string;
};

export class WebPolicyDao {
  private schemaInitialized = false;

  constructor(private readonly db: SqliteDatabase) {}

  initializeSchema() {
    if (this.schemaInitialized) return this;
    this.db.exec(`
      create table if not exists "policy_web_rules" (
        "host" text not null,
        "path" text not null,
        "accessType" text not null check ("accessType" in (${webAccessTypesSql})),
        "lifetime" text not null check ("lifetime" in (${policyLifetimesSql})),
        "status" text not null check ("status" in (${policyStatusesSql})),
        "reason" text not null,
        "updatedAt" integer not null,
        primary key ("host", "path", "accessType")
      );

      create index if not exists "idx_policy_web_rules_access_host_path"
        on "policy_web_rules" ("accessType", "host", "path");
    `);
    this.schemaInitialized = true;
    return this;
  }

  loadPolicies(): WebPolicy[] {
    this.initializeSchema();
    const rows = this.db.prepare(`
      select "host", "path", "accessType", "lifetime", "status", "reason"
      from "policy_web_rules"
      order by "host" asc, "path" asc, "accessType" asc
    `).all() as WebPolicyRuleRow[];

    return sanitizeWebPolicySnapshot({policies: rows}).policies;
  }

  replacePolicies(policies: WebPolicy[]): void {
    this.initializeSchema();
    const now = Date.now();
    const run = this.db.transaction((items: WebPolicy[]) => {
      this.db.prepare(`delete from "policy_web_rules"`).run();
      const insert = this.db.prepare(`
        insert into "policy_web_rules" ("host", "path", "accessType", "lifetime", "status", "reason", "updatedAt")
        values (@host, @path, @accessType, @lifetime, @status, @reason, @updatedAt)
      `);
      for (const policy of sanitizeWebPolicySnapshot({policies: items}).policies) {
        insert.run({...policy, updatedAt: now});
      }
    });
    run(policies);
  }
}
