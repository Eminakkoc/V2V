"use client";

import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";
import { isOnline, isOnlineOnServer, subscribeOnlineStatus } from "@/lib/online-status";

// F25: app-wide, so it lives once in the root layout rather than per page --
// it must show on History and on Create alike while a job polls.
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribeOnlineStatus, isOnline, isOnlineOnServer);
  if (online) return null;

  return (
    <div role="status" className="border-b bg-muted px-4 py-2">
      <p className="mx-auto flex w-full max-w-5xl items-center gap-2 text-sm text-muted-foreground">
        <WifiOff aria-hidden className="size-4 shrink-0" />
        You are offline. Nothing is lost — updates will resume once you are back online.
      </p>
    </div>
  );
}
