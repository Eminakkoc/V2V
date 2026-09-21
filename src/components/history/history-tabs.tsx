"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HistoryBodySkeleton } from "./history-skeleton";

export type HistoryTab = "jobs" | "sources";

function hrefFor(tab: HistoryTab): string {
  // Switching tabs starts from a clean query: the job-only filters are rejected outright alongside
  // tab=sources, so carrying them across would just produce an invalid request.
  return tab === "sources" ? "/history?tab=sources" : "/history";
}

export type HistoryTabsProps = {
  active: HistoryTab;
  children: React.ReactNode;
};

// activationMode="manual": automatic activation would fire a full server navigation on every
// arrow-key press, exactly the "expensive activation" case the ARIA Authoring Practices recommend
// manual activation for.
export function HistoryTabs({ active, children }: HistoryTabsProps) {
  const router = useRouter();
  const [requested, setRequested] = useState<HistoryTab | null>(null);
  const [navigating, startNavigating] = useTransition();

  // Inside a transition, so the clicked pill and this page's own skeleton paint immediately:
  // router.push alone leaves the panel that is on its way out on screen for the whole round trip,
  // which is the delay a reader feels as an unresponsive tab.
  function selectTab(value: string) {
    const tab = value as HistoryTab;
    setRequested(tab);
    startNavigating(() => router.push(hrefFor(tab)));
  }

  const shown = navigating && requested ? requested : active;

  return (
    <Tabs
      value={shown}
      onValueChange={selectTab}
      activationMode="manual"
      className="min-h-0 flex-1"
    >
      <TabsList aria-label="History views" className="shrink-0">
        <TabsTrigger value="jobs">Transformations</TabsTrigger>
        <TabsTrigger value="sources">Uploaded videos</TabsTrigger>
      </TabsList>
      <TabsContent value={shown} className="flex min-h-0 flex-col">
        {navigating ? <HistoryBodySkeleton /> : children}
      </TabsContent>
    </Tabs>
  );
}
