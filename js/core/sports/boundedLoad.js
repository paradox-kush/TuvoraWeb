// Every load a Sports screen waits on ends: loaded, or failed at a deadline (CLAUDE.md "every
// loading state has a deadline and a terminal outcome"). The work gets an AbortSignal so a fetch
// that never answers is cancelled, and a failure is always thrown, never turned into "empty".

export class LoadTimeoutError extends Error {
  constructor(ms) {
    super(`Timed out after ${Math.round(ms / 1000)} s`);
    this.name = "LoadTimeoutError";
  }
}

export function withDeadline(work, deadlineMs) {
  const controller = new AbortController();
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new LoadTimeoutError(deadlineMs));
    }, deadlineMs);
  });
  return Promise.race([Promise.resolve().then(() => work(controller.signal)), timeout])
    .finally(() => clearTimeout(timer));
}
