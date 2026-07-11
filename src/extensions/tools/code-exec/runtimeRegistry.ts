import {createCodeExecAdapters} from "./adapters";
import {Adapter, AdapterPlanInput, CodeLanguage, ExecutionPlan, isDetectedRuntime, RuntimeInfo} from "./types";

/** Owns runtime adapters and lazy detection state for one extension instance. */
export class CodeExecRuntimeRegistry {
    private readonly detectionCache = new Map<CodeLanguage, Promise<RuntimeInfo>>();

    constructor(private readonly adapters: Record<CodeLanguage, Adapter> = createCodeExecAdapters()) {
    }

    adapterFor(language: CodeLanguage): Adapter {
        return this.adapters[language];
    }

    detect(language: CodeLanguage): Promise<RuntimeInfo> {
        const cached = this.detectionCache.get(language);
        if (cached) return cached;

        const detection = Promise.resolve().then(() => this.adapterFor(language).detect());
        this.detectionCache.set(language, detection);
        detection.catch(() => {
            // Keep successful (including unavailable) results, but allow transient failures to retry.
            if (this.detectionCache.get(language) === detection) this.detectionCache.delete(language);
        });
        return detection;
    }

    detectAll(): Promise<RuntimeInfo[]> {
        return Promise.all(Object.values(CodeLanguage).map((language) => this.detect(language)));
    }

    async plan(language: CodeLanguage, input: AdapterPlanInput): Promise<ExecutionPlan> {
        const runtime = await this.detect(language);
        if (!isDetectedRuntime(runtime)) {
            throw new RuntimeUnavailableError(runtime);
        }
        return this.adapterFor(language).plan(input, runtime);
    }
}

export class RuntimeUnavailableError extends Error {
    constructor(readonly runtime: RuntimeInfo) {
        super(`Runtime unavailable for ${runtime.language}: ${runtime.error ?? "not found"}`);
    }
}
