import assert from "node:assert/strict";
import {createCodeExecAdapters} from "../extensions/tools/code-exec/adapters";
import {CodeExecRuntimeRegistry} from "../extensions/tools/code-exec/runtimeRegistry";
import {Adapter, CodeLanguage, CodeExecMode, RuntimeInfo} from "../extensions/tools/code-exec/types";

function adaptersWith(javascript: Adapter): Record<CodeLanguage, Adapter> {
    return Object.fromEntries(Object.values(CodeLanguage).map((language) => [
        language,
        language === CodeLanguage.JAVASCRIPT ? javascript : unavailableAdapter(language),
    ])) as Record<CodeLanguage, Adapter>;
}

function unavailableAdapter(language: CodeLanguage): Adapter {
    return {
        language,
        modes: [CodeExecMode.INLINE],
        async detect(): Promise<RuntimeInfo> {
            return {language, available: false, modes: [CodeExecMode.INLINE]};
        },
        async plan() {
            throw new Error("unavailable");
        },
    };
}

test("runtime detection is lazy, shared within a registry, and isolated between registries", async () => {
    let detections = 0;
    const adapter: Adapter = {
        ...unavailableAdapter(CodeLanguage.JAVASCRIPT),
        async detect() {
            detections++;
            return {
                language: CodeLanguage.JAVASCRIPT,
                available: true,
                provider: "node",
                executable: "/runtime/node",
                modes: [CodeExecMode.INLINE]
            };
        },
    };

    const first = new CodeExecRuntimeRegistry(adaptersWith(adapter));
    const second = new CodeExecRuntimeRegistry(adaptersWith(adapter));
    assert.equal(detections, 0);

    const [one, two] = await Promise.all([first.detect(CodeLanguage.JAVASCRIPT), first.detect(CodeLanguage.JAVASCRIPT)]);
    assert.equal(one, two);
    assert.equal(detections, 1);

    await second.detect(CodeLanguage.JAVASCRIPT);
    assert.equal(detections, 2);
});

test("an unsuccessful probe is cached only as unavailable", async () => {
    const runner = jest.fn(async () => ({
        stdout: "",
        stderr: "version failed",
        exitCode: 3,
        timedOut: false,
        cancelled: false,
    }));
    const registry = new CodeExecRuntimeRegistry(createCodeExecAdapters(runner));

    const first = await registry.detect(CodeLanguage.JAVASCRIPT);
    const second = await registry.detect(CodeLanguage.JAVASCRIPT);

    assert.equal(first, second);
    assert.equal(first.available, false);
    assert.equal(first.provider, undefined);
    assert.match(first.error ?? "", /exited with code 3/);
    assert.equal(runner.mock.calls.length, 1);
});

test("rejected detection is retried", async () => {
    let attempts = 0;
    const adapter: Adapter = {
        ...unavailableAdapter(CodeLanguage.JAVASCRIPT),
        async detect() {
            attempts++;
            if (attempts === 1) throw new Error("transient detection failure");
            return {language: CodeLanguage.JAVASCRIPT, available: false, modes: [CodeExecMode.INLINE]};
        },
    };
    const registry = new CodeExecRuntimeRegistry(adaptersWith(adapter));

    await assert.rejects(registry.detect(CodeLanguage.JAVASCRIPT), /transient/);
    const result = await registry.detect(CodeLanguage.JAVASCRIPT);
    assert.equal(result.available, false);
    assert.equal(attempts, 2);
});
