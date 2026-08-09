export interface PageTransitionIdentity {
  url: string;
  signature: string;
}

export interface PageTransitionOutcome {
  changed: boolean;
  current: PageTransitionIdentity;
}

export async function waitForPageTransition(options: {
  initial: PageTransitionIdentity;
  readCurrent: () => Promise<PageTransitionIdentity> | PageTransitionIdentity;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<PageTransitionOutcome> {
  const timeoutMs = Math.max(0, options.timeoutMs ?? 10_000);
  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 150);
  const deadline = Date.now() + timeoutMs;
  let current = options.initial;

  do {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    current = await options.readCurrent();
    if (
      current.url !== options.initial.url ||
      current.signature !== options.initial.signature
    ) {
      return { changed: true, current };
    }
  } while (Date.now() < deadline);

  return { changed: false, current };
}
