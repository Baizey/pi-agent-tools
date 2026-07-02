import {SqliteDatabase} from "./sqlite";
import {policyLifetimesSql, policyStatusesSql} from "./policy-common";
import {PolicyLifetime, PolicyStatus, ShellFlagPolicyStatus, ShellPolicy} from "../policy/types";
import {sanitizeShellPolicySnapshot} from "../policy/validation";

type ShellPolicyCommandRow = {
  command: string;
  allowAllFlags: number;
  lifetime: PolicyLifetime;
  status: PolicyStatus;
  reason: string;
};

type ShellPolicyFlagRow = {
  command: string;
  flag: string;
  lifetime: PolicyLifetime;
  status: PolicyStatus;
  reason: string;
};

export class ShellPolicyDao {
  private schemaInitialized = false;

  constructor(private readonly db: SqliteDatabase) {}

  initializeSchema() {
    if (this.schemaInitialized) return this;
    this.db.exec(`
      create table if not exists "policy_shell_commands" (
        "command" text primary key,
        "allowAllFlags" integer not null check ("allowAllFlags" in (0, 1)),
        "lifetime" text not null check ("lifetime" in (${policyLifetimesSql})),
        "status" text not null check ("status" in (${policyStatusesSql})),
        "reason" text not null,
        "updatedAt" integer not null
      );

      create table if not exists "policy_shell_flags" (
        "command" text not null,
        "flag" text not null,
        "lifetime" text not null check ("lifetime" in (${policyLifetimesSql})),
        "status" text not null check ("status" in (${policyStatusesSql})),
        "reason" text not null,
        "updatedAt" integer not null,
        primary key ("command", "flag")
      );

      create index if not exists "idx_policy_shell_flags_command"
        on "policy_shell_flags" ("command");
    `);
    this.schemaInitialized = true;
    return this;
  }

  loadPolicies(): ShellPolicy[] {
    this.initializeSchema();
    const commandRows = this.db.prepare(`
      select "command", "allowAllFlags", "lifetime", "status", "reason"
      from "policy_shell_commands"
      order by "command" asc
    `).all() as ShellPolicyCommandRow[];
    const flagRows = this.db.prepare(`
      select "command", "flag", "lifetime", "status", "reason"
      from "policy_shell_flags"
      order by "command" asc, "flag" asc
    `).all() as ShellPolicyFlagRow[];

    const flagsByCommand = new Map<string, Record<string, ShellFlagPolicyStatus>>();
    for (const row of flagRows) {
      const flags = flagsByCommand.get(row.command) ?? {};
      flags[row.flag] = {
        flag: row.flag,
        lifetime: row.lifetime,
        status: row.status,
        reason: row.reason,
      };
      flagsByCommand.set(row.command, flags);
    }

    const policies = commandRows.map((row): ShellPolicy => ({
      commandArgs: row.command.split(" ").filter(Boolean),
      flags: flagsByCommand.get(row.command) ?? {},
      allowAllFlags: row.allowAllFlags === 1,
      lifetime: row.lifetime,
      status: row.status,
      reason: row.reason,
    }));

    return sanitizeShellPolicySnapshot({policies}).policies;
  }

  replacePolicies(policies: ShellPolicy[]): void {
    this.initializeSchema();
    const now = Date.now();
    const run = this.db.transaction((items: ShellPolicy[]) => {
      this.db.prepare(`delete from "policy_shell_flags"`).run();
      this.db.prepare(`delete from "policy_shell_commands"`).run();
      const insertCommand = this.db.prepare(`
        insert into "policy_shell_commands" ("command", "allowAllFlags", "lifetime", "status", "reason", "updatedAt")
        values (@command, @allowAllFlags, @lifetime, @status, @reason, @updatedAt)
      `);
      const insertFlag = this.db.prepare(`
        insert into "policy_shell_flags" ("command", "flag", "lifetime", "status", "reason", "updatedAt")
        values (@command, @flag, @lifetime, @status, @reason, @updatedAt)
      `);

      for (const policy of sanitizeShellPolicySnapshot({policies: items}).policies) {
        const command = shellCommandForArgs(policy.commandArgs);
        if (!command) continue;
        insertCommand.run({
          command,
          allowAllFlags: policy.allowAllFlags ? 1 : 0,
          lifetime: policy.lifetime,
          status: policy.status,
          reason: policy.reason,
          updatedAt: now,
        });
        for (const flag of Object.values(policy.flags)) {
          insertFlag.run({command, ...flag, updatedAt: now});
        }
      }
    });
    run(policies);
  }
}

export function shellCommandForArgs(commandArgs: string[]): string {
  return commandArgs.map((it) => it.trim()).filter(Boolean).join(" ");
}
