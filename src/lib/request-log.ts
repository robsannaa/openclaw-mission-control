type LogMeta = Record<string, unknown>;

function emit(entry: Record<string, unknown>) {
  try {
    // Use console.log — process.stdout.write is unavailable on Edge Runtime
    console.log(JSON.stringify(entry));
  } catch {
    // swallow — never crash a request over logging
  }
}

export function logRequest(
  route: string,
  status: number,
  durationMs: number,
  meta?: LogMeta,
) {
  emit({
    level: "info",
    ts: new Date().toISOString(),
    route,
    status,
    durationMs,
    ...(meta ? { meta } : {}),
  });
}

export function logError(
  route: string,
  error: unknown,
  meta?: LogMeta,
) {
  emit({
    level: "error",
    ts: new Date().toISOString(),
    route,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack?.split("\n").slice(0, 3).join("\n") : undefined,
    ...(meta ? { meta } : {}),
  });
}
