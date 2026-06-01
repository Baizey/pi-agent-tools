import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    FsAccessType,
    PathPolicyLogic,
    PolicyLifetime,
    PolicyStatus,
    ShellFlagPolicyStatus,
    ShellPolicy,
    ShellPolicyLogic,
    ShellPolicyResult,
} from "../../index";

const test = (name: string, fn: () => void): void => {
    try {
        fn();
        console.log(`✓ ${name}`);
    } catch (error) {
        console.error(`✗ ${name}`);
        throw error;
    }
};

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "pidev-shell-policy-"));

const allowCommand = (...commandArgs: string[]): ShellPolicy => ({
    commandArgs,
    flags: {},
    lifetime: PolicyLifetime.SESSION,
    status: PolicyStatus.ALLOWED,
    reason: `${commandArgs.join(" ")} is allowed.`,
});

const allowFlag = (flag: string): ShellFlagPolicyStatus => ({
    flag,
    lifetime: PolicyLifetime.SESSION,
    status: PolicyStatus.ALLOWED,
    reason: `${flag} is allowed.`,
});

const assertAllowed = (result: ShellPolicyResult): void => {
    assert.equal(result.allowed, true);
    assert.equal(result.denied, false);
};

const assertDenied = (result: ShellPolicyResult): void => {
    assert.equal(result.denied, true);
};

test("command policy applies to child command words", () => {
    const logic = new ShellPolicyLogic({policies: [allowCommand("git")]});

    const result = logic.evaluate("git status", process.cwd(), true);

    assertAllowed(result);
    assert.deepEqual(result.segmentResults[0].commandPrefix, ["git", "status"]);
});

test("child command policy does not allow parent or sibling commands", () => {
    const logic = new ShellPolicyLogic({policies: [allowCommand("git", "status")]});

    assertDenied(logic.evaluate("git", process.cwd(), true));
    assertDenied(logic.evaluate("git commit", process.cwd(), true));
});

test("flag policy applies only to exact command words", () => {
    const logic = new ShellPolicyLogic({
        policies: [
            {...allowCommand("git"), flags: {"-m": allowFlag("-m")}},
            allowCommand("git", "commit"),
        ],
    });

    assertAllowed(logic.evaluate("git -m message", process.cwd(), true));

    const child = logic.evaluate("git commit -m message", process.cwd(), true);
    assertDenied(child);
    assert.deepEqual(child.segmentResults[0].commandPrefix, ["git", "commit"]);
    assert.equal(child.segmentResults[0].flags[0].flag, "-m");
});

test("bash separators make each command segment evaluated independently", () => {
    const logic = new ShellPolicyLogic({policies: [allowCommand("git", "status")]});

    for (const separator of ["&&", "||", ";", "|", "&", "\n", "\r"]) {
        const result = logic.evaluate(`git status ${separator} git commit`, process.cwd(), true);

        assertDenied(result);
        assert.equal(result.segmentResults.length, 2, separator);
        assert.equal(result.segmentResults[0].status, PolicyStatus.ALLOWED);
        assert.equal(result.segmentResults[1].status, PolicyStatus.DENIED);
    }
});

test("empty command is denied", () => {
    const logic = new ShellPolicyLogic();

    const result = logic.evaluate("   ", process.cwd(), true);

    assertDenied(result);
    assert.deepEqual(result.segmentResults[0].commandPrefix, []);
});

test("redirection is denied even when command is allowed", () => {
    const logic = new ShellPolicyLogic({policies: [allowCommand("git", "status")]});

    assertDenied(logic.evaluate("git status > leak.txt", process.cwd(), true));
    assertDenied(logic.evaluate("git status>>leak.txt", process.cwd(), true));
});

test("bash expansion syntax is denied even when command is allowed", () => {
    const logic = new ShellPolicyLogic({policies: [allowCommand("echo")]});

    for (const command of ["echo $HOME", "echo $(git commit)", "echo `git commit`", "echo *.txt", "echo file?.txt"]) {
        assertDenied(logic.evaluate(command, process.cwd(), true));
    }
});

test("nested bash execution flags cannot hide denied commands", () => {
    const logic = new ShellPolicyLogic({
        policies: [{...allowCommand("bash"), flags: {"-c": allowFlag("-c")}}],
    });

    assertDenied(logic.evaluate("bash -c 'git commit'", process.cwd(), true));
    assertDenied(logic.evaluate("sh -c 'git commit'", process.cwd(), true));
});

test("bash dynamic execution helpers are denied", () => {
    const logic = new ShellPolicyLogic({
        policies: [allowCommand("eval"), allowCommand("source"), allowCommand("."), allowCommand("exec")],
    });

    for (const command of ["eval 'git commit'", "source ./payload.sh", ". ./payload.sh", "exec git commit"]) {
        assertDenied(logic.evaluate(command, process.cwd(), true));
    }
});

test("find exec and xargs are denied because they can invoke nested commands", () => {
    const logic = new ShellPolicyLogic({
        policies: [
            {...allowCommand("find"), flags: {"-exec": allowFlag("-exec")}},
            allowCommand("xargs"),
        ],
    });

    assertDenied(logic.evaluate("find . -exec git commit ;", process.cwd(), true));
    assertDenied(logic.evaluate("xargs git commit", process.cwd(), true));
});

test("denied working directory denies before command policy", () => {
    const base = tempDir();
    const logic = new ShellPolicyLogic({policies: [allowCommand("git")]});
    const result = logic.evaluate("git status", base, true);

    assertDenied(result);
    assert.deepEqual(result.segmentResults[0].commandPrefix, []);
    assert.equal(result.segmentResults[0].reason, "System path is denied.");
});

test("persisted policies keep forever command and flag policies only", () => {
    const logic = new ShellPolicyLogic({
        policies: [
            {...allowCommand("git"), lifetime: PolicyLifetime.FOREVER},
            {
                ...allowCommand("npm"),
                lifetime: PolicyLifetime.SESSION,
                flags: {"--version": {...allowFlag("--version"), lifetime: PolicyLifetime.FOREVER}}
            },
            allowCommand("node"),
        ],
    });

    const persisted = logic.persistedPolicies();

    assert.deepEqual(persisted.map((it) => it.commandArgs.join(" ")), ["git", "npm"]);
    assert.deepEqual(Object.keys(persisted.find((it) => it.commandArgs[0] === "npm")?.flags ?? {}), ["--version"]);
});
