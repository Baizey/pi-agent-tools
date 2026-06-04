import assert from "node:assert/strict";
import { test } from "./TestHarness";
import {
  PolicyLifetime,
  PolicyStatus,
  ShellFlagPolicyStatus,
  ShellPolicy,
  ShellPolicyLogic,
  ShellPolicyResult,
} from "../index";

const allowCommand = (...commandArgs: string[]): ShellPolicy =>
  ShellPolicyLogic.createPolicy(
    commandArgs,
    PolicyStatus.ALLOWED,
    PolicyLifetime.SESSION,
    `${commandArgs.join(" ")} is allowed.`,
  );

const allowFlag = (flag: string): ShellFlagPolicyStatus =>
  ShellPolicyLogic.createFlagStatus(flag, PolicyStatus.ALLOWED, PolicyLifetime.SESSION, `${flag} is allowed.`);

const assertAllowed = (result: ShellPolicyResult | null): void => {
  assert.ok(result);
  assert.equal(result.allowed, true);
  assert.equal(result.denied, false);
};

const assertDenied = (result: ShellPolicyResult | null): void => {
  assert.ok(result);
  assert.equal(result.denied, true);
};

test("factory creates command policies from a shell-like command string", () => {
  const policy = ShellPolicyLogic.createPolicy(
    "git status",
    PolicyStatus.ALLOWED,
    PolicyLifetime.FOREVER,
    "git status is allowed.",
    [allowFlag("--short")],
  );

  assert.deepEqual(policy.commandArgs, ["git", "status"]);
  assert.deepEqual(Object.keys(policy.flags), ["--short"]);
});

test("command policy applies to child command words", () => {
  const logic = new ShellPolicyLogic({ policies: [allowCommand("git")] });

  const result = logic.evaluate("git status", true);

  assertAllowed(result);
  assert.ok(result);
  assert.deepEqual(result.segmentResults[0].commandPrefix, ["git", "status"]);
});

test("child command policy does not allow parent or sibling commands", () => {
  const logic = new ShellPolicyLogic({ policies: [allowCommand("git", "status")] });

  assertDenied(logic.evaluate("git", true));
  assertDenied(logic.evaluate("git commit", true));
});

test("unknown command returns null when not denying by default", () => {
  const logic = new ShellPolicyLogic();

  assert.equal(logic.evaluate("git status", false), null);
});

test("pending policy scope options ask for command base before flags", () => {
  const logic = new ShellPolicyLogic();

  assert.deepEqual(logic.pendingPolicyScopeOptions("git --version"), [
    { label: "git", commandArgs: ["git"], flags: [] },
  ]);

  logic.addPolicies([allowCommand("git")]);

  assert.deepEqual(logic.pendingPolicyScopeOptions("git --version"), [
    { label: "git flag --version", commandArgs: ["git"], flags: ["--version"] },
    { label: "git | with all flags allowed", commandArgs: ["git"], flags: [], allowAllFlags: true },
  ]);
});

test("pending policy scope options target the first unknown segment only", () => {
  const logic = new ShellPolicyLogic({ policies: [allowCommand("git")] });

  assert.deepEqual(logic.pendingPolicyScopeOptions("git --version && pwd"), [
    { label: "git flag --version", commandArgs: ["git"], flags: ["--version"] },
    { label: "git | with all flags allowed", commandArgs: ["git"], flags: [], allowAllFlags: true },
  ]);

  logic.addPolicies([
    ShellPolicyLogic.createPolicy("git", PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "git allowed", [
      allowFlag("--version"),
    ]),
  ]);

  assert.deepEqual(logic.pendingPolicyScopeOptions("git --version && pwd"), [
    { label: "pwd", commandArgs: ["pwd"], flags: [] },
  ]);
});


test("flags are scoped to exact command context", () => {
  const logic = new ShellPolicyLogic({ policies: [allowCommand("git")] });

  logic.addPolicies([
    ShellPolicyLogic.createPolicy("git", PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "git allowed", [allowFlag("-m")]),
  ]);

  assertAllowed(logic.evaluate("git -m message", false));
  assert.equal(logic.evaluate("git status -m message", false), null);
  assert.deepEqual(logic.pendingPolicyScopeOptions("git status -m message"), [
    { label: "git status flag -m", commandArgs: ["git", "status"], flags: ["-m"] },
    { label: "git status | with all flags allowed", commandArgs: ["git", "status"], flags: [], allowAllFlags: true },
  ]);
});

test("all flags approval applies to exact command context", () => {
  const logic = new ShellPolicyLogic({ policies: [allowCommand("git", "status"), allowCommand("git", "commit")] });

  logic.addPolicies([
    logic.createPolicyForScope(
      { label: "git status | with all flags allowed", commandArgs: ["git", "status"], flags: [], allowAllFlags: true },
      PolicyStatus.ALLOWED,
      PolicyLifetime.SESSION,
      "git status flags allowed",
    ),
  ]);

  assertAllowed(logic.evaluate("git status --short -b --untracked-files=all", true));
  assertDenied(logic.evaluate("git commit --amend", true));
});

test("explicit denied flags beat all flags approval", () => {
  const logic = new ShellPolicyLogic({ policies: [allowCommand("git", "status")] });

  logic.addPolicies([
    ShellPolicyLogic.createPolicy("git status", PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "git status allowed", [
      ShellPolicyLogic.createFlagStatus("--porcelain", PolicyStatus.DENIED, PolicyLifetime.SESSION, "porcelain denied"),
    ], true),
  ]);

  assertAllowed(logic.evaluate("git status --short", true));
  assertDenied(logic.evaluate("git status --porcelain", true));
});

test("runtime addPolicies updates an existing command policy", () => {
  const logic = new ShellPolicyLogic({
    policies: [
      ShellPolicyLogic.createPolicy("git status", PolicyStatus.DENIED, PolicyLifetime.SESSION, "not yet"),
    ],
  });

  assertDenied(logic.evaluate("git status", true));

  logic.addPolicies([
    ShellPolicyLogic.createPolicy("git status", PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "now allowed"),
  ]);

  assertAllowed(logic.evaluate("git status", true));
});

test("runtime addPolicies merges flags into an existing exact command policy", () => {
  const logic = new ShellPolicyLogic({ policies: [allowCommand("git", "commit")] });

  assertDenied(logic.evaluate("git commit -m message", true));

  logic.addPolicies([
    ShellPolicyLogic.createPolicy("git commit", PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "git commit allowed", [
      allowFlag("-m"),
    ]),
  ]);

  assertAllowed(logic.evaluate("git commit -m message", true));
});

test("adding a denied flag policy can preserve an existing allowed command policy", () => {
  const logic = new ShellPolicyLogic({ policies: [allowCommand("git", "commit")] });

  logic.addPolicies([
    logic.createPolicyForScope(
      { label: "git commit flag --amend", commandArgs: ["git", "commit"], flags: ["--amend"] },
      PolicyStatus.DENIED,
      PolicyLifetime.SESSION,
      "--amend denied",
    ),
  ]);

  assertAllowed(logic.evaluate("git commit", true));
  assertDenied(logic.evaluate("git commit --amend", true));
});

test("runtime removePolicies can remove flags or entire command policies", () => {
  const logic = new ShellPolicyLogic({
    policies: [
      ShellPolicyLogic.createPolicy("git commit", PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "git commit allowed", [
        allowFlag("-m"),
      ]),
    ],
  });

  assertAllowed(logic.evaluate("git commit -m message", true));

  logic.removePolicies([{ commandArgs: ["git", "commit"], removeEntirePolicy: false, flags: ["-m"] }]);
  assertDenied(logic.evaluate("git commit -m message", true));
  assertAllowed(logic.evaluate("git commit", true));

  logic.removePolicies([{ commandArgs: ["git", "commit"], removeEntirePolicy: true, flags: [] }]);
  assertDenied(logic.evaluate("git commit", true));
});

test("flag policy applies only to exact command words", () => {
  const logic = new ShellPolicyLogic({
    policies: [
      ShellPolicyLogic.createPolicy("git", PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "git is allowed", [
        allowFlag("-m"),
      ]),
      allowCommand("git", "commit"),
    ],
  });

  assertAllowed(logic.evaluate("git -m message", true));

  const child = logic.evaluate("git commit -m message", true);
  assertDenied(child);
  assert.ok(child);
  assert.deepEqual(child.segmentResults[0].commandPrefix, ["git", "commit"]);
  assert.equal(child.segmentResults[0].flags[0].flag, "-m");
});

test("bash separators make each command segment evaluated independently", () => {
  const logic = new ShellPolicyLogic({ policies: [allowCommand("git", "status")] });

  for (const separator of ["&&", "||", ";", "|", "&", "\n", "\r"]) {
    const result = logic.evaluate(`git status ${separator} git commit`, true);

    assertDenied(result);
    assert.ok(result);
    assert.equal(result.segmentResults.length, 2, separator);
    assert.equal(result.segmentResults[0].status, PolicyStatus.ALLOWED);
    assert.equal(result.segmentResults[1].status, PolicyStatus.DENIED);
  }
});

test("empty command is denied", () => {
  const logic = new ShellPolicyLogic();

  const result = logic.evaluate("   ", true);

  assertDenied(result);
  assert.ok(result);
  assert.deepEqual(result.segmentResults[0].commandPrefix, []);
});

test("redirection is denied even when command is allowed", () => {
  const logic = new ShellPolicyLogic({ policies: [allowCommand("git", "status")] });

  assertDenied(logic.evaluate("git status > leak.txt", true));
  assertDenied(logic.evaluate("git status>>leak.txt", true));
});

test("quoted and escaped search patterns are not treated as shell control syntax", () => {
  const logic = new ShellPolicyLogic({
    policies: [
      allowCommand("rg"),
      ShellPolicyLogic.createPolicy("grep", PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "grep allowed", [
        allowFlag("-R"),
        allowFlag("-n"),
      ]),
    ],
  });

  const rgResult = logic.evaluate('rg "PiPathPolicy|createServices|extension" src/test src', true);
  assertAllowed(rgResult);
  assert.ok(rgResult);
  assert.deepEqual(rgResult.segmentResults[0].commandPrefix, ["rg"]);
  assertAllowed(logic.evaluate("grep -R PiPathPolicy\\|createServices\\|extension -n src/test src", true));
});

test("search command arguments are not treated as command policy scope", () => {
  const logic = new ShellPolicyLogic();

  assert.deepEqual(logic.pendingPolicyScopeOptions('rg "somepattern" src'), [
    { label: "rg", commandArgs: ["rg"], flags: [] },
  ]);
});

test("command core inference stops before quoted path file and flag arguments", () => {
  const logic = new ShellPolicyLogic();

  assert.deepEqual(logic.pendingPolicyScopeOptions('git "status"'), [
    { label: "git", commandArgs: ["git"], flags: [] },
  ]);
  assert.deepEqual(logic.pendingPolicyScopeOptions("git package.json"), [
    { label: "git", commandArgs: ["git"], flags: [] },
  ]);
  assert.deepEqual(logic.pendingPolicyScopeOptions("git ./status"), [
    { label: "git", commandArgs: ["git"], flags: [] },
  ]);
  assert.deepEqual(logic.pendingPolicyScopeOptions("git --no-pager status"), [
    { label: "git", commandArgs: ["git"], flags: [] },
  ]);
});

test("double dash stops flag inference", () => {
  const logic = new ShellPolicyLogic({ policies: [allowCommand("rg")] });

  assertAllowed(logic.evaluate("rg -- -literal-pattern", true));
});

test("known command core words remain minimal and explicit", () => {
  const logic = new ShellPolicyLogic();

  assert.deepEqual(logic.pendingPolicyScopeOptions("git ls-files"), [
    { label: "git ls-files", commandArgs: ["git", "ls-files"], flags: [] },
    { label: "git ls-files | with all flags allowed", commandArgs: ["git", "ls-files"], flags: [], allowAllFlags: true },
    { label: "git", commandArgs: ["git"], flags: [] },
  ]);
  assert.deepEqual(logic.pendingPolicyScopeOptions("gh clone owner/repo"), [
    { label: "gh clone", commandArgs: ["gh", "clone"], flags: [] },
    { label: "gh clone | with all flags allowed", commandArgs: ["gh", "clone"], flags: [], allowAllFlags: true },
    { label: "gh", commandArgs: ["gh"], flags: [] },
  ]);
});

test("bash expansion syntax is denied even when command is allowed", () => {
  const logic = new ShellPolicyLogic({ policies: [allowCommand("echo")] });

  for (const command of ["echo $HOME", "echo $(git commit)", "echo `git commit`", "echo *.txt", "echo file?.txt"]) {
    assertDenied(logic.evaluate(command, true));
  }
});

test("nested bash execution flags cannot hide denied commands", () => {
  const logic = new ShellPolicyLogic({
    policies: [ShellPolicyLogic.createPolicy("bash", PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "bash allowed", [allowFlag("-c")])],
  });

  assertDenied(logic.evaluate("bash -c 'git commit'", true));
  assertDenied(logic.evaluate("sh -c 'git commit'", true));
});

test("bash dynamic execution helpers are denied", () => {
  const logic = new ShellPolicyLogic({
    policies: [allowCommand("eval"), allowCommand("source"), allowCommand("."), allowCommand("exec")],
  });

  for (const command of ["eval 'git commit'", "source ./payload.sh", ". ./payload.sh", "exec git commit"]) {
    assertDenied(logic.evaluate(command, true));
  }
});

test("find exec and xargs are denied because they can invoke nested commands", () => {
  const logic = new ShellPolicyLogic({
    policies: [
      ShellPolicyLogic.createPolicy("find", PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "find allowed", [allowFlag("-exec")]),
      allowCommand("xargs"),
    ],
  });

  assertDenied(logic.evaluate("find . -exec git commit ;", true));
  assertDenied(logic.evaluate("xargs git commit", true));
});

test("persisted policies keep forever command and flag policies only", () => {
  const logic = new ShellPolicyLogic({
    policies: [
      ShellPolicyLogic.createPolicy("git", PolicyStatus.ALLOWED, PolicyLifetime.FOREVER, "git forever"),
      ShellPolicyLogic.createPolicy("npm", PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "npm session", [
        ShellPolicyLogic.createFlagStatus("--version", PolicyStatus.ALLOWED, PolicyLifetime.FOREVER, "version forever"),
      ]),
      allowCommand("node"),
    ],
  });

  const persisted = logic.persistedPolicies();

  assert.deepEqual(persisted.map((it) => it.commandArgs.join(" ")), ["git", "npm"]);
  assert.deepEqual(Object.keys(persisted.find((it) => it.commandArgs[0] === "npm")?.flags ?? {}), ["--version"]);
});
