const DEFAULT_PROVIDER_TIMEOUT_MS = 12_000;

export async function withEmailProviderTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Email provider request timed out."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
