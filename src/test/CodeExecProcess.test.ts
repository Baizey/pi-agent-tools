import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import type {spawn} from "node:child_process";
import {ProcessRuntime, runProcess} from "../extensions/tools/code-exec/process";

class FakeChild extends EventEmitter {
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    readonly stdin = new PassThrough();
    readonly kills: NodeJS.Signals[] = [];
    killResult = true;
    pid: number | undefined;

    kill(signal: NodeJS.Signals): boolean {
        this.kills.push(signal);
        return this.killResult;
    }
}

type ManualTimer = { callback: () => void; milliseconds: number; active: boolean; unref(): void };

class ManualTimers {
    readonly timers: ManualTimer[] = [];

    readonly setTimeout = ((callback: () => void, milliseconds: number) => {
        const timer: ManualTimer = {
            callback, milliseconds, active: true, unref() {
            }
        };
        this.timers.push(timer);
        return timer;
    }) as unknown as typeof setTimeout;

    readonly clearTimeout = ((timer: ManualTimer) => {
        timer.active = false;
    }) as unknown as typeof clearTimeout;

    fire(milliseconds: number): void {
        const timer = this.timers.find((candidate) => candidate.active && candidate.milliseconds === milliseconds);
        assert.ok(timer, `expected active ${milliseconds}ms timer`);
        timer.active = false;
        timer.callback();
    }
}

function harness(spawnImpl?: (...args: any[]) => FakeChild): {
    child: FakeChild;
    timers: ManualTimers;
    runtime: ProcessRuntime;
    calls: any[][];
} {
    const child = new FakeChild();
    const timers = new ManualTimers();
    const calls: any[][] = [];
    const fakeSpawn = (...args: any[]) => {
        calls.push(args);
        return spawnImpl ? spawnImpl(...args) : child;
    };
    return {
        child,
        timers,
        calls,
        runtime: {
            spawn: fakeSpawn as unknown as typeof spawn,
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
        },
    };
}

const command = {command: "runtime", args: ["file name", "--flag"], cwd: process.cwd()};

test("a pre-aborted process is cancelled without spawning", async () => {
    const controller = new AbortController();
    controller.abort();
    const test = harness();

    const result = await runProcess(command, undefined, 10, controller.signal, test.runtime);

    assert.equal(test.calls.length, 0);
    assert.equal(result.cancelled, true);
    assert.equal(result.timedOut, false);
    assert.equal(result.spawnError, undefined);
});

test("an abort raised while spawn returns is not missed", async () => {
    const controller = new AbortController();
    const child = new FakeChild();
    const test = harness(() => {
        controller.abort();
        return child;
    });

    const pending = runProcess(command, undefined, 10, controller.signal, test.runtime);
    assert.deepEqual(child.kills, ["SIGTERM"]);
    child.emit("close", null);

    const result = await pending;
    assert.equal(result.cancelled, true);
    assert.equal(result.timedOut, false);
});

test("spawn uses an argument array and shell:false", async () => {
    const test = harness();
    const pending = runProcess(command, undefined, 10, undefined, test.runtime);
    test.child.emit("close", 0);
    const result = await pending;

    assert.deepEqual(test.calls[0]?.slice(0, 2), [command.command, command.args]);
    assert.equal(test.calls[0]?.[2].shell, false);
    assert.deepEqual(test.calls[0]?.[2].stdio, ["pipe", "pipe", "pipe"]);
    assert.equal(result.exitCode, 0);
});

test("abort sends TERM, escalates to KILL, and remains distinct from timeout", async () => {
    const controller = new AbortController();
    const test = harness();
    const pending = runProcess(command, undefined, 60, controller.signal, test.runtime);

    controller.abort();
    assert.deepEqual(test.child.kills, ["SIGTERM"]);
    test.timers.fire(2_000);
    assert.deepEqual(test.child.kills, ["SIGTERM", "SIGKILL"]);
    test.child.emit("close", null);

    const result = await pending;
    assert.equal(result.cancelled, true);
    assert.equal(result.timedOut, false);
    assert.equal(test.timers.timers.every((timer) => !timer.active), true);
});

test("SIGKILL followed by no close event eventually settles", async () => {
    const controller = new AbortController();
    const test = harness();
    const pending = runProcess(command, undefined, 60, controller.signal, test.runtime);

    controller.abort();
    test.timers.fire(2_000);
    assert.deepEqual(test.child.kills, ["SIGTERM", "SIGKILL"]);
    test.timers.fire(2_000);

    const result = await pending;
    assert.equal(result.cancelled, true);
    assert.equal(result.exitCode, null);
    assert.equal(test.timers.timers.every((timer) => !timer.active), true);
});

test("failed TERM and KILL signals still settle deterministically", async () => {
    const test = harness();
    test.child.killResult = false;
    const pending = runProcess(command, undefined, 1, undefined, test.runtime);

    test.timers.fire(1_000);
    test.timers.fire(2_000);
    test.timers.fire(2_000);

    const result = await pending;
    assert.deepEqual(test.child.kills, ["SIGTERM", "SIGKILL"]);
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, null);
});

test("timeout sends TERM then KILL and wins a subsequent abort race", async () => {
    const controller = new AbortController();
    const test = harness();
    const pending = runProcess(command, undefined, 1, controller.signal, test.runtime);

    test.timers.fire(1_000);
    controller.abort();
    test.timers.fire(2_000);
    assert.deepEqual(test.child.kills, ["SIGTERM", "SIGKILL"]);
    test.child.emit("close", null);
    test.child.emit("close", 9);

    const result = await pending;
    assert.equal(result.timedOut, true);
    assert.equal(result.cancelled, false);
    assert.equal(result.exitCode, null);
});

test("synchronous spawn throws and asynchronous spawn errors are reported", async () => {
    const thrown = harness(() => {
        throw new Error("spawn threw");
    });
    const throwResult = await runProcess(command, undefined, 1, undefined, thrown.runtime);
    assert.equal(throwResult.spawnError, "spawn threw");
    assert.equal(throwResult.cancelled, false);
    assert.equal(throwResult.timedOut, false);

    const failed = harness();
    const pending = runProcess(command, undefined, 1, undefined, failed.runtime);
    failed.child.emit("error", new Error("ENOENT"));
    failed.child.emit("close", -1);
    const errorResult = await pending;
    assert.equal(errorResult.spawnError, "ENOENT");
    assert.equal(errorResult.exitCode, null);
    assert.equal(failed.timers.timers.every((timer) => !timer.active), true);
});

test("stdin EPIPE is handled without changing the child outcome", async () => {
    const test = harness();
    const pending = runProcess(command, "input", 1, undefined, test.runtime);

    test.child.stdin.emit("error", Object.assign(new Error("broken pipe"), {code: "EPIPE"}));
    test.child.emit("close", 0);

    const result = await pending;
    assert.equal(result.exitCode, 0);
    assert.equal(result.spawnError, undefined);
    assert.equal(result.stdinError, undefined);
});

test("asynchronous non-EPIPE stdin errors are reported separately", async () => {
    const test = harness();
    const pending = runProcess(command, "input", 1, undefined, test.runtime);

    test.child.stdin.emit("error", Object.assign(new Error("stdin unavailable"), {code: "EIO"}));
    test.child.emit("close", 0);

    const result = await pending;
    assert.equal(result.exitCode, 0);
    assert.equal(result.spawnError, undefined);
    assert.equal(result.stdinError, "stdin unavailable");
});

test("a non-EPIPE stdin error immediately after child close is not lost", async () => {
    const test = harness();
    test.child.stdin.end = (() => test.child.stdin) as any;

    const pending = runProcess(command, "input", 1, undefined, test.runtime);
    test.child.emit("close", 0);
    test.child.stdin.emit("error", Object.assign(new Error("late write failure"), {code: "EIO"}));

    const result = await pending;
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdinError, "late write failure");
    assert.equal(test.timers.timers.every((timer) => !timer.active), true);
});

test("child close settles after a bounded wait for a non-closing stdin stream", async () => {
    const test = harness();
    test.child.stdin.end = (() => test.child.stdin) as any;

    const pending = runProcess(command, "input", 1, undefined, test.runtime);
    test.child.emit("close", 0);
    test.timers.fire(25);

    const result = await pending;
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdinError, undefined);
    assert.equal(test.timers.timers.every((timer) => !timer.active), true);
});

test("synchronous non-EPIPE stdin delivery errors are reported separately", async () => {
    const test = harness();
    test.child.stdin.end = (() => {
        throw Object.assign(new Error("write rejected"), {code: "EIO"});
    }) as any;

    const pending = runProcess(command, "input", 1, undefined, test.runtime);
    test.child.emit("close", 0);

    const result = await pending;
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdinError, "write rejected");
});

test("POSIX termination targets the detached process group without a shell", async () => {
    const controller = new AbortController();
    const test = harness();
    const groupSignals: Array<[number, NodeJS.Signals]> = [];
    test.child.pid = 1234;
    test.runtime.platform = "linux";
    test.runtime.processKill = (pid, signal) => {
        groupSignals.push([pid, signal]);
        return true;
    };

    const pending = runProcess(command, undefined, 1, controller.signal, test.runtime);
    controller.abort();
    test.child.emit("close", null);
    await pending;

    assert.equal(test.calls[0]?.[2].detached, true);
    assert.deepEqual(groupSignals, [[-1234, "SIGTERM"]]);
    assert.deepEqual(test.child.kills, []);
});

test("output is bounded and split UTF-8 chunks are decoded without replacement", async () => {
    const test = harness();
    const pending = runProcess(command, undefined, 1, undefined, test.runtime);
    const emoji = Buffer.from("😀");

    test.child.stdout.write(emoji.subarray(0, 2));
    test.child.stdout.write(emoji.subarray(2));
    test.child.stdout.write(Buffer.from("a".repeat(50_100)));
    test.child.stderr.write(Buffer.from([0xe2, 0x82]));
    test.child.stderr.write(Buffer.from([0xac]));
    test.child.emit("close", 0);

    const result = await pending;
    assert.equal(result.stdout, `😀${"a".repeat(49_998)}\n[truncated]`);
    assert.equal(result.stdout.includes("�"), false);
    assert.equal(result.stderr, "€");
});
