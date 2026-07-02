import {SqliteDatabase} from "./sqlite";
import {codeExecModesSql, policyLifetimesSql, policyStatusesSql} from "./policy-common";
import {CodeExecPolicy, CodeExecPolicyMode, PolicyLifetime, PolicyStatus} from "../policy/types";
import {sanitizeCodeExecPolicySnapshot} from "../policy/validation";

type CodeExecPolicyRuleRow = {
  language: string;
  mode: CodeExecPolicyMode;
  lifetime: PolicyLifetime;
  status: PolicyStatus;
  reason: string;
};

export class CodeExecPolicyDao {
  private schemaInitialized = false;

  constructor(private readonly db: SqliteDatabase) {}

  initializeSchema() {
    if (this.schemaInitialized) return this;
    this.db.exec(`
      create table if not exists "policy_code_exec_rules" (
        "language" text not null,
        "mode" text not null check ("mode" in (${codeExecModesSql})),
        "lifetime" text not null check ("lifetime" in (${policyLifetimesSql})),
        "status" text not null check ("status" in (${policyStatusesSql})),
        "reason" text not null,
        "updatedAt" integer not null,
        primary key ("language", "mode")
      );

      create index if not exists "idx_policy_code_exec_rules_language_mode"
        on "policy_code_exec_rules" ("language", "mode");
    `);
    this.schemaInitialized = true;
    return this;
  }

  loadPolicies(): CodeExecPolicy[] {
    this.initializeSchema();
    const rows = this.db.prepare(`
      select "language", "mode", "lifetime", "status", "reason"
      from "policy_code_exec_rules"
      order by "language" asc, "mode" asc
    `).all() as CodeExecPolicyRuleRow[];

    return sanitizeCodeExecPolicySnapshot({policies: rows.map((row): CodeExecPolicy => ({...row}))}).policies;
  }

  replacePolicies(policies: CodeExecPolicy[]): void {
    this.initializeSchema();
    const now = Date.now();
    const run = this.db.transaction((items: CodeExecPolicy[]) => {
      this.db.prepare(`delete from "policy_code_exec_rules"`).run();
      const insert = this.db.prepare(`
        insert into "policy_code_exec_rules" ("language", "mode", "lifetime", "status", "reason", "updatedAt")
        values (@language, @mode, @lifetime, @status, @reason, @updatedAt)
      `);
      for (const policy of sanitizeCodeExecPolicySnapshot({policies: items}).policies) {
        insert.run({...policy, updatedAt: now});
      }
    });
    run(policies);
  }
}
