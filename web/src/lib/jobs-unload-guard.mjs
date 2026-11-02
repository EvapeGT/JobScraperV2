// Runs currently belong to their streaming browser request. Warn before a hard
// reload/tab close disconnects that request; ordinary in-app navigation is safe.
export function installJobsUnloadGuard(target, active) {
  if (!active) return () => {};
  const warn = (event) => {
    event.preventDefault();
    event.returnValue = "";
  };
  target.addEventListener("beforeunload", warn);
  return () => target.removeEventListener("beforeunload", warn);
}
