import test from "node:test";
import assert from "node:assert/strict";
import { discoveryRequest, rootIdentity, discoveryUrl, DISCOVERY_APP } from "../../src/lib/core/discovery.mjs";

const root = process.cwd();
const health = { app: DISCOVERY_APP, instance: rootIdentity(root) };
function mockFetch(replies) {
  const calls = [];
  return { calls, fetchFn: async (url, options) => {
    calls.push({ url, options }); const reply = replies.shift();
    assert.ok(reply, "unexpected request");
    return { ok: reply.ok !== false, json: async () => reply.body };
  } };
}
test("data bridge validates workspace identity and never returns the collector token", async () => {
  const mock = mockFetch([{ body: health }, { body: { token: "private-token", index: { listings: [] } } }]);
  const data = await discoveryRequest({ root, fetchFn: mock.fetchFn });
  assert.deepEqual(data, { index: { listings: [] } });
  assert.equal(mock.calls.length, 2);
  assert.ok(mock.calls.every(call => call.url.startsWith("http://127.0.0.1:4381/api/")));
});
test("refresh uses only the fixed collector endpoint and its same-origin token", async () => {
  const mock = mockFetch([{ body: health }, { body: { token: "secret" } }, { body: { running: true } }]);
  const status = await discoveryRequest({ root, action: "refresh", fetchFn: mock.fetchFn });
  assert.equal(status.running, true);
  const call = mock.calls[2]; assert.equal(call.url, "http://127.0.0.1:4381/api/refresh");
  assert.equal(call.options.method, "POST");
  assert.deepEqual(call.options.headers, { Origin: "http://127.0.0.1:4381", "X-Desk-Token": "secret" });
  assert.equal(call.options.body, undefined);
});
test("wrong app or workspace never receives a refresh request", async () => {
  for (const wrong of [{ app: "different", instance: health.instance }, { ...health, instance: "different" }]) {
    const mock = mockFetch([{ body: wrong }]);
    await assert.rejects(discoveryRequest({ root, action: "refresh", fetchFn: mock.fetchFn }), /different app or workspace/);
    assert.equal(mock.calls.length, 1);
  }
});
test("status reads no collector token or job index", async () => {
  const mock = mockFetch([{ body: health }, { body: { running: false, phase: "complete" } }]);
  assert.equal((await discoveryRequest({ root, action: "status", fetchFn: mock.fetchFn })).phase, "complete");
  assert.equal(mock.calls[1].url, "http://127.0.0.1:4381/api/status");
});
test("source errors and duplicate-run conflicts remain errors", async () => {
  const mock = mockFetch([{ body: health }, { body: { token: "secret" } }, { ok: false, body: { error: "A refresh is already running." } }]);
  await assert.rejects(discoveryRequest({ root, action: "refresh", fetchFn: mock.fetchFn }), /already running/);
});
test("unsupported actions and invalid ports are refused before making requests", async () => {
  const mock = mockFetch([]);
  await assert.rejects(discoveryRequest({ root, action: "apply", fetchFn: mock.fetchFn }), /Unknown discovery action/);
  for (const value of ["80", "http://elsewhere.test", "4381/path", "70000"]) assert.throws(() => discoveryUrl(value), /Invalid local discovery port/);
  assert.equal(mock.calls.length, 0);
});
