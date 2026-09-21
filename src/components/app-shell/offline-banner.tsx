"use client";

import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";
import { isOnline, isOnlineOnServer, subscribeOnlineStatus } from "@/lib/online-status";

// App-wide, so it lives once in the root layout rather than per page -- it must show on History and
// Create alike while a job polls.
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribeOnlineStatus, isOnline, isOnlineOnServer);
  if (online) return null;

  return (
    <div role="status" className="page-shell">
      <p className="flex items-center gap-2 rounded-pill border border-divider bg-neutral-200 px-4 py-3 type-body font-semibold text-foreground sm:gap-3 sm:px-6">
        <WifiOff aria-hidden className="size-[18px] shrink-0" />
        You are offline. Live updates are paused and will resume automatically.
      </p>
    </div>
  );
}
