let pending: Promise<void> | null = null;

export function ensureSession(): Promise<void> {
  pending ??= fetch("/api/session", { method: "POST", credentials: "same-origin" }).then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

export function sessionReady(): Promise<void> {
  return pending ?? Promise.resolve();
}

export function resetSessionForTests(): void {
  pending = null;
}
