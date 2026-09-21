// One shared online/offline snapshot for `useSyncExternalStore`, so the polling hooks and the
// offline banner do not each roll their own listener.
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

// Server render has no `navigator`; assume online so nothing renders an offline state before
// hydration can read the real one.
export function isOnlineOnServer() {
  return true;
}
