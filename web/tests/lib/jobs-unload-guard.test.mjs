import test from "node:test";
import assert from "node:assert/strict";
import { installJobsUnloadGuard } from "../../src/lib/jobs-unload-guard.mjs";

function reloadEvent() {
  const event = new Event("beforeunload", { cancelable: true });
  // Browser BeforeUnloadEvent has a writable returnValue; Node's generic Event
  // only has the unrelated, read-only legacy Event getter.
  Object.defineProperty(event, "returnValue", { value: null, writable: true });
  return event;
}

test("a hard reload warns while a worker is active, and stops warning after cleanup", () => {
  const target = new EventTarget();
  const cleanup = installJobsUnloadGuard(target, true);
  const reload = reloadEvent();
  target.dispatchEvent(reload);
  assert.equal(reload.defaultPrevented, true);
  assert.equal(reload.returnValue, "");
  cleanup();
  const afterCompletion = reloadEvent();
  target.dispatchEvent(afterCompletion);
  assert.equal(afterCompletion.defaultPrevented, false);
});

test("idle history and ordinary app navigation do not cause a leave-page warning", () => {
  const target = new EventTarget();
  installJobsUnloadGuard(target, false);
  const reload = reloadEvent();
  target.dispatchEvent(reload);
  assert.equal(reload.defaultPrevented, false);
  const cleanup = installJobsUnloadGuard(target, true);
  const navigation = new Event("popstate", { cancelable: true });
  target.dispatchEvent(navigation);
  assert.equal(navigation.defaultPrevented, false);
  cleanup();
});
