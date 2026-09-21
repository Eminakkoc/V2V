"use client";

import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

  return (
    <Tabs
      value={active}
      onValueChange={(value) => router.push(hrefFor(value as HistoryTab))}
      activationMode="manual"
    >
      <TabsList aria-label="History views">
        <TabsTrigger value="jobs">Transformations</TabsTrigger>
        <TabsTrigger value="sources">Uploaded videos</TabsTrigger>
      </TabsList>
      <TabsContent value={active}>{children}</TabsContent>
    </Tabs>
  );
}
