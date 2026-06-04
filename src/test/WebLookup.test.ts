import assert from "node:assert/strict";
import {registerWebLookupTool} from "../extensions/web";
import {PolicyLifetime, PolicyStatus, WebAccessType} from "../policy/types";
import {PiExtensionApi, ToolDefinition} from "../pi/types";

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

function registeredWebTool(options: {allowed?: boolean; onEvaluate?: (url: string, accessType: WebAccessType) => void} = {}): ToolDefinition {
  let tool: ToolDefinition | undefined;
  const pi = {
    on() {},
    registerTool(definition: ToolDefinition) {
      tool = definition;
    },
  } satisfies PiExtensionApi;

  const allowedResult = {
    url: "https://example.com/",
    accessType: WebAccessType.READ,
    host: "example.com",
    path: "/",
    matchedHost: "example.com",
    matchedPath: "/",
    matchedScope: "example.com/",
    matchedLifetime: PolicyLifetime.FOREVER,
    matchedStatus: PolicyStatus.ALLOWED,
    matchedReason: "test",
  };

  registerWebLookupTool(pi, {
    runtimeFor: () => ({
      webPolicy: {
        evaluate: (url: string, accessType: WebAccessType) => {
          options.onEvaluate?.(url, accessType);
          return {...allowedResult, url, accessType, matchedStatus: options.allowed === false ? PolicyStatus.DENIED : PolicyStatus.ALLOWED};
        },
        toDenyReasonOrNull: (result: {matchedStatus: PolicyStatus}) => result.matchedStatus === PolicyStatus.ALLOWED ? null : "denied for test",
        removePolicies: () => {},
      },
      webPolicyStore: {save: () => {}},
    } as never),
  });

  assert.ok(tool);
  return tool;
}

void (async () => {
  await test("web lookup requires exactly one of query or url", async () => {
    const tool = registeredWebTool();

    const both = await tool.execute("1", {query: "pi", url: "https://example.com/"});
    assert.equal(both.isError, true);
    assert.match(both.content[0].text, /either query or url, not both/);

    const neither = await tool.execute("2", {});
    assert.equal(neither.isError, true);
    assert.match(neither.content[0].text, /provide either query or url/);
  });

  await test("web lookup denied policy does not call fetch", async () => {
    const tool = registeredWebTool({allowed: false});
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("should not happen", {status: 200});
    }) as typeof fetch;

    try {
      const result = await tool.execute("denied", {url: "https://example.com/"});
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /denied for test/);
      assert.equal(fetchCalled, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await test("web lookup uses SEARCH for query and READ for url", async () => {
    const evaluations: Array<{url: string; accessType: WebAccessType}> = [];
    const tool = registeredWebTool({onEvaluate: (url, accessType) => evaluations.push({url, accessType})});
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("<html>ok</html>", {status: 200})) as typeof fetch;

    try {
      await tool.execute("search", {query: "pi tools"});
      await tool.execute("read", {url: "https://example.com/docs"});
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(evaluations[0].accessType, WebAccessType.SEARCH);
    assert.match(evaluations[0].url, /^https:\/\/duckduckgo\.com\/html\/\?q=pi\+tools|^https:\/\/duckduckgo\.com\/html\/\?q=pi%20tools/);
    assert.deepEqual(evaluations[1], {url: "https://example.com/docs", accessType: WebAccessType.READ});
  });

  await test("web lookup passes cancellation signal to fetch", async () => {
    const tool = registeredWebTool();
    const originalFetch = globalThis.fetch;
    let fetchSignal: AbortSignal | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      fetchSignal = init?.signal ?? undefined;
      return new Response("<html>ok</html>", {status: 200});
    }) as typeof fetch;

    try {
      const controller = new AbortController();
      const result = await tool.execute("3", {url: "https://example.com/"}, controller.signal);
      assert.equal(result.isError, undefined);
      assert.ok(fetchSignal);
      controller.abort("cancelled");
      assert.equal(fetchSignal.aborted, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
})();
