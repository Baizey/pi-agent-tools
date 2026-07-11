import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    createCodeExecAdapters,
    createExecutableResolver,
    PlanningCleanupError
} from "../extensions/tools/code-exec/adapters";
import {ProcessResult} from "../extensions/tools/code-exec/process";
import {CodeLanguage, CodeExecMode, DetectedRuntime} from "../extensions/tools/code-exec/types";

function runtime(language: CodeLanguage, provider: string, executable: string): DetectedRuntime {
    return {language, available: true, provider, executable, modes: [CodeExecMode.INLINE, CodeExecMode.FILE]};
}

function processResult(overrides: Partial<ProcessResult>): ProcessResult {
    return {stdout: "", stderr: "", exitCode: 0, timedOut: false, cancelled: false, ...overrides};
}

test.each([
    ["spawn error", processResult({exitCode: null, spawnError: "ENOENT"}), /spawn failed: ENOENT/],
    ["cancellation", processResult({exitCode: null, cancelled: true}), /detection was cancelled/],
    ["timeout", processResult({exitCode: null, timedOut: true}), /detection timed out/],
    ["non-zero exit", processResult({
        exitCode: 7,
        stderr: "bad version invocation"
    }), /exited with code 7: bad version invocation/],
])("runtime detection treats %s as unavailable", async (_label, result, expectedError) => {
    const runner = jest.fn(async () => result as ProcessResult);
    const info = await createCodeExecAdapters(runner)[CodeLanguage.JAVASCRIPT].detect();

    assert.equal(info.available, false);
    assert.match(info.error ?? "", expectedError as RegExp);
    assert.equal(info.provider, undefined);
    assert.equal(info.executable, undefined);
});

test("detection binds the canonical executable to interpreted and compiled plans independent of requested cwd", async () => {
    const commands: string[] = [];
    const runner = jest.fn(async (spec: { command: string }) => {
        commands.push(spec.command);
        return processResult({stdout: "version 1"});
    });
    const resolved = new Map([["node", path.resolve("canonical/node")], ["gcc", path.resolve("canonical/gcc")]]);
    const resolver = jest.fn(async (provider: string) => resolved.get(provider));
    const adapters = createCodeExecAdapters(runner, resolver);
    const requestedCwd = path.resolve("a-different-execution-cwd");

    const javascriptRuntime = await adapters[CodeLanguage.JAVASCRIPT].detect();
    assert.equal(javascriptRuntime.available, true);
    if (!javascriptRuntime.available || !javascriptRuntime.provider || !javascriptRuntime.executable) assert.fail("JavaScript runtime was not detected");
    const javascriptPlan = await adapters[CodeLanguage.JAVASCRIPT].plan(
        {mode: CodeExecMode.INLINE, source: "1 + 1", args: [], cwd: requestedCwd},
        javascriptRuntime as DetectedRuntime,
    );
    assert.equal(commands[0], javascriptPlan.run.command);
    assert.equal(javascriptPlan.run.cwd, requestedCwd);

    const cRuntime = await adapters[CodeLanguage.C].detect();
    assert.equal(cRuntime.available, true);
    if (!cRuntime.available || !cRuntime.provider || !cRuntime.executable) assert.fail("C runtime was not detected");
    const cPlan = await adapters[CodeLanguage.C].plan(
        {mode: CodeExecMode.FILE, source: "sample.c", args: [], cwd: requestedCwd},
        cRuntime as DetectedRuntime,
    );
    try {
        assert.equal(commands[1], cPlan.compile?.command);
        assert.equal(cPlan.compile?.cwd, requestedCwd);
    } finally {
        await cPlan.cleanup?.();
    }
});

test("csi provider identity survives resolution and selects the csi plan convention", async () => {
    const csiPath = path.resolve("canonical/csi.exe");
    const runner = jest.fn(async (_spec: { command: string }) => processResult({stdout: "csi 1"}));
    const resolver = jest.fn(async (provider: string) => provider === "csi" ? csiPath : undefined);
    const adapter = createCodeExecAdapters(runner, resolver)[CodeLanguage.DOTNET];
    const detected = await adapter.detect();
    assert.equal(detected.available, true);
    if (!detected.available || !detected.provider || !detected.executable) assert.fail("csi was not detected");
    const plan = await adapter.plan(
        {mode: CodeExecMode.FILE, source: "sample.csx", args: ["arg"], cwd: path.resolve("requested-cwd")},
        detected as DetectedRuntime,
    );

    assert.equal(runner.mock.calls[0][0].command, csiPath);
    assert.equal(plan.run.command, csiPath);
    assert.deepEqual(plan.run.args, ["sample.csx", "arg"]);
    assert.equal(plan.runtime.provider, "csi");
    assert.equal(plan.runtime.executable, csiPath);
});

test("executable resolution ignores empty and relative PATH entries", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-code-resolver-"));
    const absoluteBin = path.join(temp, "absolute-bin");
    const provider = `pi-resolver-${Date.now()}`;
    const executableName = process.platform === "win32" ? `${provider}.EXE` : provider;
    const executable = path.join(absoluteBin, executableName);
    await fs.mkdir(absoluteBin);
    await fs.writeFile(executable, process.platform === "win32" ? "not launched" : "#!/bin/sh\n");
    if (process.platform !== "win32") await fs.chmod(executable, 0o755);

    try {
        const unsafeOnlyResolver = createExecutableResolver({
            path: ["", ".", "relative-bin"].join(path.delimiter),
            pathExt: ".cmd;.EXE"
        });
        assert.equal(await unsafeOnlyResolver(provider), undefined);

        const resolver = createExecutableResolver({
            path: ["", ".", "relative-bin", absoluteBin].join(path.delimiter),
            pathExt: ".cmd;.EXE",
        });
        const canonical = await fs.realpath(executable);
        assert.equal(await resolver(provider), canonical);
        assert.equal(await resolver(executable), canonical);
        assert.equal(await resolver(`.${path.sep}${provider}`), undefined);
    } finally {
        await fs.rm(temp, {recursive: true, force: true});
    }
});

test.each([".EXE", ".COM"])("Windows resolution ignores batch shims and selects a directly spawnable %s file", async (availableExtension) => {
    const accesses: string[] = [];
    const available = `C:\\bin\\tool${availableExtension}`;
    const resolver = createExecutableResolver({
        platform: "win32",
        path: "C:\\bin",
        pathExt: ".CMD;.BAT;.EXE;.COM",
        fileSystem: {
            async access(file) {
                accesses.push(file);
                if (file.toLowerCase() !== available.toLowerCase()) throw new Error("ENOENT");
            },
            async realpath(file) {
                return file;
            },
            async stat() {
                return {isFile: () => true};
            },
        },
    });

    assert.equal(await resolver("tool"), available);
    assert.ok(accesses.every((candidate) => !/\.(?:cmd|bat)$/i.test(candidate)));
    const count = accesses.length;
    assert.equal(await resolver("C:\\bin\\tool.cmd"), undefined);
    assert.equal(accesses.length, count, "an explicit batch path must be rejected without filesystem probing");
});

test("Windows resolution rejects a directory with an executable extension", async () => {
    const resolver = createExecutableResolver({
        platform: "win32",
        path: "C:\\bin",
        pathExt: ".EXE",
        fileSystem: {
            async access() {
            },
            async realpath(file) {
                return file;
            },
            async stat() {
                return {isFile: () => false};
            },
        },
    });

    assert.equal(await resolver("directory"), undefined);
    assert.equal(await resolver("C:\\bin\\directory.exe"), undefined);
});

test("temporary artifacts are removed when planning fails", async () => {
    const temp = await fs.mkdtemp(`${process.cwd()}/code-exec-plan-failure-`);
    const mkdtemp = jest.spyOn(fs, "mkdtemp").mockResolvedValue(temp);
    const writeFile = jest.spyOn(fs, "writeFile").mockRejectedValue(new Error("write failed"));
    try {
        const adapter = createCodeExecAdapters()[CodeLanguage.TYPESCRIPT];
        await assert.rejects(adapter.plan(
            {mode: CodeExecMode.INLINE, source: "invalid", args: [], cwd: process.cwd()},
            runtime(CodeLanguage.TYPESCRIPT, "tsx", "/resolved/tsx"),
        ), /write failed/);
        await assert.rejects(fs.stat(temp));
    } finally {
        mkdtemp.mockRestore();
        writeFile.mockRestore();
        await fs.rm(temp, {recursive: true, force: true});
    }
});

test("planning failure preserves both the planning and cleanup failures", async () => {
    const temp = `${process.cwd()}/code-exec-double-failure`;
    const planningError = new Error("write failed");
    const cleanupError = new Error("cleanup failed");
    const mkdtemp = jest.spyOn(fs, "mkdtemp").mockResolvedValue(temp);
    const writeFile = jest.spyOn(fs, "writeFile").mockRejectedValue(planningError);
    const rm = jest.spyOn(fs, "rm").mockRejectedValue(cleanupError);
    try {
        const adapter = createCodeExecAdapters()[CodeLanguage.TYPESCRIPT];
        await assert.rejects(
            adapter.plan(
                {mode: CodeExecMode.INLINE, source: "invalid", args: [], cwd: process.cwd()},
                runtime(CodeLanguage.TYPESCRIPT, "tsx", "/resolved/tsx"),
            ),
            (error: unknown) => error instanceof PlanningCleanupError
                && error.planningError === planningError
                && error.cleanupError === cleanupError,
        );
    } finally {
        mkdtemp.mockRestore();
        writeFile.mockRestore();
        rm.mockRestore();
    }
});

test("a successful temporary-file plan transfers cleanup ownership", async () => {
    const adapter = createCodeExecAdapters()[CodeLanguage.TYPESCRIPT];
    const plan = await adapter.plan(
        {mode: CodeExecMode.INLINE, source: "console.log('ok')", args: [], cwd: process.cwd()},
        runtime(CodeLanguage.TYPESCRIPT, "tsx", "/resolved/tsx"),
    );
    const sourceFile = plan.run.args[0];

    assert.equal(await fs.readFile(sourceFile, "utf8"), "console.log('ok')");
    assert.ok(plan.cleanup);
    await plan.cleanup();
    await assert.rejects(fs.stat(sourceFile));
});
