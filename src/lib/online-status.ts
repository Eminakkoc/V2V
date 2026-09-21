// Shared online/offline snapshot for `useSyncExternalStore`, used by both
// polling hooks and the offline banner so they read one source instead of
// each rolling its own `navigator.onLine` listener. Mirrors the
// subscribeVisibility / isVisible / isVisibleOnServer shape in
// use-job-polling.ts.
export function subscribeOnlineStatus(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function isOnline() {
  return navigator.onLine;
}

// Server render has no `navigator`; assume online so neither the offline
// banner nor a paused poll render into a server-rendered page before
// hydration can read the real status.
export function isOnlineOnServer() {
  return true;
}
