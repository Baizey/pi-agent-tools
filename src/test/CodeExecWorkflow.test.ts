import assert from "node:assert/strict";
import {FsAccessType} from "../policy/types";
import {PlanningCleanupError} from "../extensions/tools/code-exec/adapters";
import {executeCodeWorkflow, CodeExecWorkflowDependencies} from "../extensions/tools/code-exec/workflow";
import {ProcessResult} from "../extensions/tools/code-exec/process";
import {
    Adapter,
    CodeExecMode,
    CodeLanguage,
    DetectedRuntime,
    ParsedExecInput,
    TempArtifactMode
} from "../extensions/tools/code-exec/types";

const runtime: DetectedRuntime = {
    language: CodeLanguage.JAVASCRIPT,
    available: true,
    provider: "fake",
    executable: "fake",
    modes: [CodeExecMode.INLINE, CodeExecMode.FILE],
};
const input: ParsedExecInput = {
    language: CodeLanguage.JAVASCRIPT,
    mode: CodeExecMode.INLINE,
    source: "code",
    args: [],
    stdin: "input",
    cwd: "/work",
    timeoutSeconds: 10,
};
const ok = (overrides: Partial<ProcessResult> = {}): ProcessResult => ({
    stdout: "", stderr: "", exitCode: 0, timedOut: false, cancelled: false, ...overrides,
});
const text = (result: Awaited<ReturnType<typeof executeCodeWorkflow>>) => (result.content[0] as { text: string }).text;

function fixture(options: {
    adapter?: Partial<Adapter>;
    plan?: Adapter["plan"];
    process?: CodeExecWorkflowDependencies["runProcess"];
    now?: () => number;
    detect?: () => Promise<typeof runtime>;
    path?: (access: FsAccessType) => Promise<string | null>;
    code?: () => Promise<string | null>;
} = {}) {
    const events: string[] = [];
    let cleanupCalls = 0;
    const adapter: Adapter = {
        language: CodeLanguage.JAVASCRIPT,
        modes: runtime.modes,
        ...options.adapter,
        async detect() {
            return runtime;
        },
        plan: options.plan ?? (async () => {
            events.push("plan");
            return {
                runtime, run: {command: "run", args: [], cwd: input.cwd}, cleanup: async () => {
                    cleanupCalls++;
                    events.push("cleanup");
                }
            };
        }),
    };
    const dependencies: CodeExecWorkflowDependencies = {
        registry: {
            adapterFor() {
                events.push("adapter");
                return adapter;
            },
            async detect() {
                events.push("detect");
                return options.detect ? options.detect() : runtime;
            },
        },
        async runProcess(spec, stdin, timeout, signal) {
            events.push(`${spec.command}:${stdin ?? "-"}:${timeout}`);
            return options.process ? options.process(spec, stdin, timeout, signal) : ok();
        },
        now: options.now ?? (() => 0),
        tempPath: () => "/temp",
        runtimeFor: () => ({} as never),
        async ensurePath(_ctx, _runtime, _path, access) {
            events.push(`path:${access}`);
            return options.path ? options.path(access) : null;
        },
        async ensureCode() {
            events.push("code");
            return options.code ? options.code() : null;
        },
    };
    const execute = (request = input, signal?: AbortSignal) => executeCodeWorkflow(request, {
        cwd: request.cwd,
        hasUI: false
    }, signal, dependencies);
    return {
        events, execute, get cleanupCalls() {
            return cleanupCalls;
        }
    };
}

test("workflow preserves authorization, detection, temp authorization, planning and execution order", async () => {
    const f = fixture({adapter: {tempArtifacts: TempArtifactMode.ALWAYS}});
    const result = await f.execute();
    assert.equal(result.isError, undefined);
    assert.deepEqual(f.events, [
        "path:EXECUTE", "code", "adapter", "detect",
        "path:WRITE", "path:READ", "path:EXECUTE",
        "plan", "run:input:10", "cleanup",
    ]);
});

test("file authorization is cwd EXECUTE then source READ and EXECUTE", async () => {
    const f = fixture({path: async (access) => access === FsAccessType.EXECUTE ? "denied" : null});
    const result = await f.execute({...input, mode: CodeExecMode.FILE, source: "/work/a.js"});
    assert.equal(result.isError, true);
    assert.deepEqual(f.events, ["path:EXECUTE"]);
});

test("every denial short-circuits all later effects", async () => {
    for (const deniedAt of [FsAccessType.EXECUTE, "code"] as const) {
        const f = fixture({
            path: async (access) => deniedAt === access ? "path denied" : null,
            code: async () => deniedAt === "code" ? "code denied" : null,
        });
        const result = await f.execute();
        assert.equal(result.isError, true);
        assert.equal(f.events.includes("detect"), false);
        assert.equal(f.events.includes("plan"), false);
    }
});

test("pre-abort has no effects", async () => {
    const controller = new AbortController();
    controller.abort();
    const f = fixture();
    const result = await f.execute(input, controller.signal);
    assert.equal(result.isError, true);
    assert.match(text(result), /cancelled/i);
    assert.deepEqual(f.events, []);
});

test("cancellation during shared detection prevents planning and spawning", async () => {
    const controller = new AbortController();
    let finish!: () => void;
    const detection = new Promise<void>((resolve) => {
        finish = resolve;
    });
    const f = fixture({
        detect: async () => {
            await detection;
            return runtime;
        }
    });
    const pending = f.execute(input, controller.signal);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    finish();
    const result = await pending;
    assert.match(text(result), /cancelled/i);
    assert.equal(f.events.includes("plan"), false);
    assert.equal(f.events.some((event) => event.startsWith("run:")), false);
});

test("abort after planning cleans once and does not spawn", async () => {
    const controller = new AbortController();
    const f = fixture({
        plan: async () => {
            f.events.push("plan");
            controller.abort();
            return {
                runtime, run: {command: "run", args: [], cwd: input.cwd}, cleanup: async () => {
                    (f as unknown as { events: string[] }).events.push("cleanup");
                }
            };
        }
    });
    const result = await f.execute(input, controller.signal);
    assert.match(text(result), /cancelled/i);
    assert.equal(f.events.some((event) => event.startsWith("run:")), false);
    assert.equal(f.events.filter((event) => event === "cleanup").length, 1);
});

test("planning cleanup failure remains visible when planning is aborted", async () => {
    const controller = new AbortController();
    const f = fixture({
        plan: async () => {
            controller.abort();
            throw new PlanningCleanupError(new Error("planning stopped"), new Error("cannot remove temp file"));
        }
    });
    const result = await f.execute(input, controller.signal);
    assert.equal(result.isError, true);
    assert.match(text(result), /cancelled/i);
    assert.match(text(result), /cleanup failed: cannot remove temp file/i);
    assert.equal((result.details as { cleanupError: string }).cleanupError, "cannot remove temp file");
    assert.equal(f.events.some((event) => event.startsWith("run:")), false);
});

test("compile and run share one millisecond deadline; compile gets no stdin and run gets stdin once", async () => {
    const times = [1000, 1000, 4000];
    const calls: Array<{ command: string; stdin?: string; timeout: number }> = [];
    const f = fixture({
        now: () => times.shift() ?? 4000,
        plan: async () => ({
            runtime,
            compile: {command: "compile", args: [], cwd: input.cwd},
            run: {command: "run", args: [], cwd: input.cwd}
        }),
        process: async (spec, stdin, timeout) => {
            calls.push({command: spec.command, stdin, timeout});
            return ok();
        },
    });
    await f.execute();
    assert.deepEqual(calls, [
        {command: "compile", stdin: undefined, timeout: 10},
        {command: "run", stdin: "input", timeout: 7},
    ]);
});

test("an exhausted shared deadline skips run", async () => {
    const times = [0, 0, 10_001];
    const f = fixture({
        now: () => times.shift() ?? 10_001,
        plan: async () => ({
            runtime,
            compile: {command: "compile", args: [], cwd: input.cwd},
            run: {command: "run", args: [], cwd: input.cwd}
        }),
    });
    const result = await f.execute();
    assert.match(text(result), /timed out/i);
    assert.equal(f.events.filter((event) => event.startsWith("compile:")).length, 1);
    assert.equal(f.events.filter((event) => event.startsWith("run:")).length, 0);
    assert.equal((result.details as { run: unknown }).run === null, false);
});

test("compile failures are distinct and skip run", async () => {
    const states: Array<[Partial<ProcessResult>, RegExp]> = [
        [{cancelled: true, exitCode: null}, /Compilation cancelled/],
        [{timedOut: true, exitCode: null}, /Compilation timed out/],
        [{spawnError: "missing", exitCode: null}, /could not start: missing/],
        [{stdinError: "broken"}, /writing stdin: broken/],
        [{exitCode: 2, stderr: "bad"}, /Compilation failed/],
    ];
    for (const [state, expected] of states) {
        const f = fixture({
            plan: async () => ({
                runtime,
                compile: {command: "compile", args: [], cwd: input.cwd},
                run: {command: "run", args: [], cwd: input.cwd}
            }),
            process: async () => ok(state),
        });
        const result = await f.execute();
        assert.equal(result.isError, true);
        assert.match(text(result), expected);
        assert.equal(f.events.filter((event) => event.startsWith("compile:")).length, 1);
        assert.equal(f.events.filter((event) => event.startsWith("run:")).length, 0);
    }
});

test("run outcomes distinguish cancellation, timeout, spawn, stdin, non-zero, and success", async () => {
    const states: Array<[Partial<ProcessResult>, RegExp, boolean]> = [
        [{cancelled: true, exitCode: null}, /Execution cancelled/, true],
        [{timedOut: true, exitCode: null}, /Execution timed out/, true],
        [{spawnError: "missing", exitCode: null}, /could not start: missing/, true],
        [{stdinError: "broken"}, /writing stdin: broken/, true],
        [{exitCode: 3}, /exit code 3/, true],
        [{stdout: "yes"}, /Exit code: 0/, false],
    ];
    for (const [state, expected, isError] of states) {
        const f = fixture({process: async () => ok(state)});
        const result = await f.execute();
        assert.equal(Boolean(result.isError), isError);
        assert.match(text(result), expected);
    }
});

test("a completed run result wins a simultaneous abort race", async () => {
    const controller = new AbortController();
    const f = fixture({
        process: async () => {
            controller.abort();
            return ok({stdout: "completed"});
        }
    });
    const result = await f.execute(input, controller.signal);
    assert.equal(result.isError, undefined);
    assert.match(text(result), /Exit code: 0/);
    assert.match(text(result), /completed/);
    assert.doesNotMatch(text(result), /cancelled/i);
});

test("abort after compile prevents run and cleanup still occurs", async () => {
    const controller = new AbortController();
    const f = fixture({
        plan: async () => ({
            runtime,
            compile: {command: "compile", args: [], cwd: input.cwd},
            run: {command: "run", args: [], cwd: input.cwd},
            cleanup: async () => {
                f.events.push("cleanup");
            }
        }),
        process: async () => {
            controller.abort();
            return ok();
        },
    });
    const result = await f.execute(input, controller.signal);
    assert.match(text(result), /cancelled/i);
    assert.equal(f.events.filter((event) => event.startsWith("compile:")).length, 1);
    assert.equal(f.events.filter((event) => event.startsWith("run:")).length, 0);
    assert.equal(f.events.filter((event) => event === "cleanup").length, 1);
});

test("cleanup failure is exposed without erasing the primary outcome", async () => {
    const f = fixture({
        plan: async () => ({
            runtime,
            run: {command: "run", args: [], cwd: input.cwd},
            cleanup: async () => {
                throw new Error("cannot remove");
            },
        })
    });
    const result = await f.execute();
    assert.equal(result.isError, true);
    assert.match(text(result), /Exit code: 0/);
    assert.match(text(result), /cleanup failed: cannot remove/i);
    assert.equal((result.details as { cleanupError: string }).cleanupError, "cannot remove");
});
