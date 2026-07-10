import assert from "node:assert/strict";
import {agentEnv} from "../shared/env";
import {FsAccessType, PolicyLifetime, PolicyStatus, WebAccessType} from "../policy/types";
import {ShellPolicyLogic} from "../policy/shell/ShellPolicyLogic";
import {
  applyPolicyDefaultCommand,
  currentPathPolicyDefault,
  currentShellPolicyDefault,
  currentWebPolicyDefault,
  parsePolicyDefaultCommand,
  PolicyDefaultMode,
  policyDefaultCommandCompletions,
  policyDefaultsEnvForSubagents,
  resetPolicyDefaultsForTest,
} from "../extensions/policy/defaults";
import {registerPathPolicy} from "../extensions/policy/path-policy";
import {ensureShellAllowed} from "../extensions/policy/shell-policy";
import type {ExtensionContext, PiExtensionApi, ToolCallDecision, ToolCallEvent} from "../index";

function withCleanPolicyDefaults(fn: () => void): void {
  resetPolicyDefaultsForTest();
  try {
    fn();
  } finally {
    resetPolicyDefaultsForTest();
  }
}

test("policy default command parses actions, targets, and scope", () => {
  withCleanPolicyDefaults(() => {
    assert.deepEqual(parsePolicyDefaultCommand(""), {action: "show"});
    assert.deepEqual(parsePolicyDefaultCommand("allow web io_read --scope subagents"), {
      action: "allow",
      targets: ["web", "io_read"],
      scope: "subagents",
    });
    assert.deepEqual(parsePolicyDefaultCommand("deny path bash --scope=all"), {
      action: "deny",
      targets: ["io", "shell"],
      scope: "all",
    });
    assert.deepEqual(parsePolicyDefaultCommand("reset execute_code"), {
      action: "reset",
      targets: ["code"],
      scope: "root",
    });
    assert.deepEqual(parsePolicyDefaultCommand("ask web --scope=agent"), {
      action: "ask",
      targets: ["web"],
      scope: "root",
    });
  });
});

test("policy defaults apply independently to root and subagent scopes", () => {
  withCleanPolicyDefaults(() => {
    applyPolicyDefaultCommand({action: "allow", targets: ["web"], scope: "subagents"});

    assert.equal(currentWebPolicyDefault(WebAccessType.READ, false), PolicyDefaultMode.ASK);
    assert.equal(currentWebPolicyDefault(WebAccessType.SEARCH, false), PolicyDefaultMode.ASK);

    const env = policyDefaultsEnvForSubagents()[agentEnv.policyDefaults];
    assert.ok(env);
    const parsed = JSON.parse(env) as {web: Record<string, string>};
    assert.deepEqual(parsed.web, {READ: PolicyDefaultMode.ALLOW, SEARCH: PolicyDefaultMode.ALLOW});
  });
});

test("policy defaults can allow, deny, ask, and reset grouped targets", () => {
  withCleanPolicyDefaults(() => {
    applyPolicyDefaultCommand({action: "allow", targets: ["all"], scope: "root"});
    assert.equal(currentPathPolicyDefault(FsAccessType.READ, false), PolicyDefaultMode.ALLOW);
    assert.equal(currentShellPolicyDefault(false), PolicyDefaultMode.ALLOW);
    assert.equal(currentWebPolicyDefault(WebAccessType.SEARCH, false), PolicyDefaultMode.ALLOW);

    applyPolicyDefaultCommand({action: "deny", targets: ["io_write"], scope: "root"});
    assert.equal(currentPathPolicyDefault(FsAccessType.WRITE, false), PolicyDefaultMode.DENY);
    assert.equal(currentPathPolicyDefault(FsAccessType.EDIT, false), PolicyDefaultMode.DENY);
    assert.equal(currentPathPolicyDefault(FsAccessType.DELETE, false), PolicyDefaultMode.DENY);
    assert.equal(currentPathPolicyDefault(FsAccessType.READ, false), PolicyDefaultMode.ALLOW);

    applyPolicyDefaultCommand({action: "ask", targets: ["shell"], scope: "root"});
    assert.equal(currentShellPolicyDefault(true), PolicyDefaultMode.ASK);

    applyPolicyDefaultCommand({action: "reset", targets: ["all"], scope: "root"});
    assert.equal(currentPathPolicyDefault(FsAccessType.READ, false), PolicyDefaultMode.ASK);
    assert.equal(currentPathPolicyDefault(FsAccessType.READ, true), PolicyDefaultMode.DENY);
    assert.equal(currentShellPolicyDefault(false), PolicyDefaultMode.ASK);
  });
});

test("policy default command autocompletes actions targets and scopes", () => {
  withCleanPolicyDefaults(() => {
    assert.ok(policyDefaultCommandCompletions("a")?.some((item) => item.value === "allow"));
    assert.ok(policyDefaultCommandCompletions("allow al")?.some((item) => item.value === "allow all"));
    assert.ok(policyDefaultCommandCompletions("allow web")?.some((item) => item.value === "allow web"));
    assert.ok(policyDefaultCommandCompletions("allow io")?.some((item) => item.value === "allow io"));
    assert.ok(policyDefaultCommandCompletions("allow w")?.some((item) => item.value === "allow web_search"));
    assert.ok(policyDefaultCommandCompletions("allow web --scope=s")?.some((item) => item.value === "allow web --scope=subagents"));
  });
});

test("shell policy default allow still honors explicit denials after unmatched segments", async () => {
  resetPolicyDefaultsForTest();
  try {
    applyPolicyDefaultCommand({action: "allow", targets: ["shell"], scope: "root"});
    const shellPolicy = new ShellPolicyLogic({
      policies: [ShellPolicyLogic.createPolicy("git", PolicyStatus.DENIED, PolicyLifetime.SESSION, "git denied for test")],
    });
    const denied = await ensureShellAllowed(
      {cwd: process.cwd(), hasUI: false},
      {shellPolicy, shellPolicyStore: {} as never} as never,
      "echo \"allowed by default\" ; git status",
      false,
    );

    assert.match(denied ?? "", /git denied for test/);
  } finally {
    resetPolicyDefaultsForTest();
  }
});

test("path policy hook honors session default allow and deny modes for unmatched paths", async () => {
  resetPolicyDefaultsForTest();
  try {
    let handler: ((event: ToolCallEvent, ctx: ExtensionContext) => Promise<ToolCallDecision | void> | ToolCallDecision | void) | undefined;
    const pi = {
      on(event: "tool_call", callback: typeof handler) {
        if (event === "tool_call") handler = callback;
      },
    } as PiExtensionApi;
    const runtime = {
      pathPolicy: {
        evaluate(path: string, accessType: FsAccessType, denyByDefault: boolean) {
          if (!denyByDefault) return null;
          return {
            evaluatedPath: path,
            evaluatedAccessType: accessType,
            matchedPattern: "(none)",
            matchedLifetime: PolicyLifetime.SESSION,
            matchedStatus: PolicyStatus.DENIED,
            matchedReason: "denied by default for test",
          };
        },
        toDenyReasonOrNull(result: {matchedStatus: PolicyStatus; matchedReason: string}) {
          return result.matchedStatus === PolicyStatus.ALLOWED ? null : result.matchedReason;
        },
      },
    };
    registerPathPolicy(pi, {sessionDao: {} as never, subagentDao: {} as never, runtimeFor: () => runtime as never});
    assert.ok(handler);

    applyPolicyDefaultCommand({action: "allow", targets: ["io_read"], scope: "root"});
    const allowed = await handler(
      {type: "tool_call", toolCallId: "read-1", toolName: "read", input: {path: "unmatched.txt"}},
      {cwd: process.cwd(), hasUI: false},
    );
    assert.equal(allowed, undefined);

    applyPolicyDefaultCommand({action: "deny", targets: ["io_read"], scope: "root"});
    const denied = await handler(
      {type: "tool_call", toolCallId: "read-2", toolName: "read", input: {path: "unmatched.txt"}},
      {cwd: process.cwd(), hasUI: false},
    );
    assert.deepEqual(denied, {block: true, reason: "denied by default for test"});
  } finally {
    resetPolicyDefaultsForTest();
  }
});
