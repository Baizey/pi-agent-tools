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

function registeredWebTool(): ToolDefinition {
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
        evaluate: (_url: string, accessType: WebAccessType) => ({...allowedResult, accessType}),
        toDenyReasonOrNull: () => null,
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
