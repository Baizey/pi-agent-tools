import assert from "node:assert/strict";
import test from "node:test";
import {PolicyLifetime, PolicyStatus, WebAccessType} from "../policy/types";
import {WebPolicyLogic, webPolicyPathForUrl} from "../policy/web/WebPolicyLogic";

function assertAllowed(result: ReturnType<WebPolicyLogic["evaluate"]>) {
  assert.equal(result?.matchedStatus, PolicyStatus.ALLOWED);
}

function assertDenied(result: ReturnType<WebPolicyLogic["evaluate"]>) {
  assert.equal(result?.matchedStatus, PolicyStatus.DENIED);
}

test("web URL policy path reverses host and keeps URL path order", () => {
  assert.equal(webPolicyPathForUrl("https://www.subdomain.domain.co.uk/my/path/to?param=2"), "uk/co/domain/subdomain/my/path/to");
});

test("unknown web URL returns null when not denying by default", () => {
  const policy = new WebPolicyLogic();
  assert.equal(policy.evaluate("https://example.com/", WebAccessType.READ, false), null);
});

test("host policy matches subdomains but not sibling domains", () => {
  const policy = new WebPolicyLogic({
    policies: [WebPolicyLogic.createPolicy("example.com", "/", WebAccessType.READ, PolicyLifetime.SESSION, PolicyStatus.ALLOWED, "ok")],
  });
  assertAllowed(policy.evaluate("https://sub.example.com/a", WebAccessType.READ));
  assert.equal(policy.evaluate("https://badexample.com/a", WebAccessType.READ), null);
});

test("invalid or non-http URLs are denied", () => {
  const policy = new WebPolicyLogic();

  assertDenied(policy.evaluate("file:///etc/passwd", WebAccessType.READ, false));
  assertDenied(policy.evaluate("not a url", WebAccessType.READ, false));
});

test("web path policies respect path segment boundaries", () => {
  const policy = new WebPolicyLogic({
    policies: [WebPolicyLogic.createPolicy("example.com", "/docs", WebAccessType.READ, PolicyLifetime.SESSION, PolicyStatus.ALLOWED, "docs ok")],
  });

  assertAllowed(policy.evaluate("https://example.com/docs/page", WebAccessType.READ));
  assert.equal(policy.evaluate("https://example.com/docs2/page", WebAccessType.READ), null);
});

test("more specific host and path policy wins", () => {
  const policy = new WebPolicyLogic({
    policies: [
      WebPolicyLogic.createPolicy("example.com", "/docs", WebAccessType.READ, PolicyLifetime.SESSION, PolicyStatus.ALLOWED, "docs ok"),
      WebPolicyLogic.createPolicy("api.example.com", "/docs/private", WebAccessType.READ, PolicyLifetime.SESSION, PolicyStatus.DENIED, "private"),
    ],
  });
  assertAllowed(policy.evaluate("https://api.example.com/docs/public", WebAccessType.READ));
  assertDenied(policy.evaluate("https://api.example.com/docs/private/page", WebAccessType.READ));
});

test("web access types are independent", () => {
  const policy = new WebPolicyLogic({
    policies: [WebPolicyLogic.createPolicy("duckduckgo.com", "/html", WebAccessType.SEARCH, PolicyLifetime.SESSION, PolicyStatus.ALLOWED, "search ok")],
  });
  assertAllowed(policy.evaluate("https://duckduckgo.com/html/?q=test", WebAccessType.SEARCH));
  assert.equal(policy.evaluate("https://duckduckgo.com/html/?q=test", WebAccessType.READ), null);
});

test("pending web scopes broaden path only on exact host, then broaden host roots", () => {
  const policy = new WebPolicyLogic();
  assert.deepEqual(policy.pendingPolicyScopeOptions("https://sub.example.com/a/b", WebAccessType.READ).map((it) => it.label), [
    "READ sub.example.com/a/b",
    "READ sub.example.com/a",
    "READ sub.example.com",
    "READ example.com",
  ]);
});

test("pending web scopes do not combine parent hosts with child host paths", () => {
  const policy = new WebPolicyLogic();
  assert.deepEqual(policy.pendingPolicyScopeOptions("https://mail.google.com/path/to/stuff", WebAccessType.READ).map((it) => it.label), [
    "READ mail.google.com/path/to/stuff",
    "READ mail.google.com/path/to",
    "READ mail.google.com/path",
    "READ mail.google.com",
    "READ google.com",
  ]);
});
