import assert from "node:assert/strict";
import {registerCodeExecutionTool} from "../extensions/tools/code-exec";
import {CodeExecRuntimeRegistry} from "../extensions/tools/code-exec/runtimeRegistry";
import {Adapter, CodeExecMode, CodeLanguage} from "../extensions/tools/code-exec/types";
import {FsAccessType, PolicyLifetime, PolicyStatus} from "../policy/types";
import type {PiExtensionApi, ToolDefinition} from "../pi/types";

function registryFixture() {
    const calls = {detect: 0, plan: 0};
    const adapters = Object.fromEntries(Object.values(CodeLanguage).map((language) => [language, {
        language,
        modes: [CodeExecMode.INLINE, CodeExecMode.FILE],
        async detect() {
            calls.detect++;
            return {
                language,
                available: true as const,
                provider: language,
                executable: language,
                modes: [CodeExecMode.INLINE, CodeExecMode.FILE]
            };
        },
        async plan() {
            calls.plan++;
            throw new Error("planning should not be reached");
        },
    } satisfies Adapter])) as unknown as Record<CodeLanguage, Adapter>;
    return {registry: new CodeExecRuntimeRegistry(adapters), calls};
}

async function registeredExecuteCodeTool(
    deny: { path: string; accessType: FsAccessType },
    options: { codeDenied?: boolean; registry?: CodeExecRuntimeRegistry } = {},
) {
    let tool: ToolDefinition | undefined;
    const accesses: Array<{ path: string; accessType: FsAccessType; denyByDefault: boolean }> = [];
    const pi = {
        on() {
        },
        registerTool(definition: ToolDefinition) {
            if (definition.name === "execute_code") tool = definition;
        },
    } satisfies PiExtensionApi;

    await registerCodeExecutionTool(pi, {
        sessionDao: {} as never,
        subagentDao: {} as never,
        runtimeFor: () => ({
            pathPolicy: {
                evaluate(path: string, accessType: FsAccessType, denyByDefault: boolean) {
                    accesses.push({path, accessType, denyByDefault});
                    return {
                        evaluatedPath: path,
                        evaluatedAccessType: accessType,
                        matchedPattern: path,
                        matchedLifetime: PolicyLifetime.SESSION,
                        matchedStatus: deny.path === path && deny.accessType === accessType ? PolicyStatus.DENIED : PolicyStatus.ALLOWED,
                        matchedReason: deny.path === path && deny.accessType === accessType ? "path denied for test" : "path allowed for test",
                    };
                },
                toDenyReasonOrNull(result: { matchedStatus: PolicyStatus; matchedReason: string }) {
                    return result.matchedStatus === PolicyStatus.ALLOWED ? null : result.matchedReason;
                },
            },
            codeExecPolicy: {
                evaluate: () => ({
                    language: "javascript",
                    mode: "inline",
                    matchedLanguage: "javascript",
                    matchedMode: "inline",
                    matchedScope: "javascript inline",
                    matchedLifetime: PolicyLifetime.SESSION,
                    matchedStatus: options.codeDenied ? PolicyStatus.DENIED : PolicyStatus.ALLOWED,
                    matchedReason: options.codeDenied ? "code denied for test" : "code allowed for test",
                }),
                toDenyReasonOrNull: (result: {
                    matchedStatus: PolicyStatus;
                    matchedReason: string
                }) => result.matchedStatus === PolicyStatus.ALLOWED ? null : result.matchedReason,
                removePolicies: () => {
                },
            },
        } as never),
    }, options.registry);

    assert.ok(tool);
    return {tool, accesses};
}

test("registration is synchronous and execute_code schema advertises every supported language", () => {
    let tool: ToolDefinition | undefined;
    const pi = {
        on() {
        },
        registerTool(definition: ToolDefinition) {
            if (definition.name === "execute_code") tool = definition;
        },
    } satisfies PiExtensionApi;

    const {registry, calls} = registryFixture();
    const adapterFor = jest.spyOn(registry, "adapterFor");
    const detect = jest.spyOn(registry, "detect");
    const detectAll = jest.spyOn(registry, "detectAll");
    const registration = registerCodeExecutionTool(pi, {} as never, registry);

    assert.equal(registration, undefined);
    assert.deepEqual(calls, {detect: 0, plan: 0});
    assert.equal(adapterFor.mock.calls.length, 0);
    assert.equal(detect.mock.calls.length, 0);
    assert.equal(detectAll.mock.calls.length, 0);
    assert.ok(tool);
    const parameters = tool.parameters as { properties: { language: { enum: string[] } } };
    assert.deepEqual(parameters.properties.language.enum, Object.values(CodeLanguage));
});

test("execute_code blocks before execution when cwd EXECUTE path policy denies", async () => {
    const cwd = process.cwd();
    const {tool, accesses} = await registeredExecuteCodeTool({path: cwd, accessType: FsAccessType.EXECUTE});

    const result = await tool.execute("code", {
        language: "javascript",
        code: "process.stdout.write('should not run')",
        cwd
    }, undefined, undefined, {cwd, hasUI: false});

    assert.equal(result.isError, true);
    assert.match((result.content[0] as { text: string }).text, /path denied for test/);
    assert.deepEqual(accesses.map((it) => [it.path, it.accessType]), [[cwd, FsAccessType.EXECUTE]]);
});

test("execute_code policy denial performs no runtime detection or planning", async () => {
    const cwd = process.cwd();
    const {registry, calls} = registryFixture();
    const detect = jest.spyOn(registry, "detect");
    const {tool} = await registeredExecuteCodeTool(
        {path: "never-denied", accessType: FsAccessType.READ},
        {codeDenied: true, registry},
    );

    const result = await tool.execute("code", {
        language: "javascript",
        code: "ignored",
        cwd
    }, undefined, undefined, {cwd, hasUI: false});

    assert.equal(result.isError, true);
    assert.match((result.content[0] as { text: string }).text, /code denied for test/);
    assert.equal(detect.mock.calls.length, 0);
    assert.deepEqual(calls, {detect: 0, plan: 0});
});

test("execute_code file mode checks source READ and EXECUTE before code policy/execution", async () => {
    const cwd = process.cwd();
    const {tool, accesses} = await registeredExecuteCodeTool({path: "script.js", accessType: FsAccessType.EXECUTE});

    const result = await tool.execute("code", {
        language: "javascript",
        file: "script.js",
        cwd
    }, undefined, undefined, {cwd, hasUI: false});

    assert.equal(result.isError, true);
    assert.match((result.content[0] as { text: string }).text, /path denied for test/);
    assert.deepEqual(accesses.map((it) => [it.path, it.accessType]), [
        [cwd, FsAccessType.EXECUTE],
        ["script.js", FsAccessType.READ],
        ["script.js", FsAccessType.EXECUTE],
    ]);
});
