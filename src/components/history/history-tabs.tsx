"use client";

import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type HistoryTab = "jobs" | "sources";

function hrefFor(tab: HistoryTab): string {
  // Switching tabs starts from a clean query: the job-only filters
  // (status, statusBucket, style, sort, dir, includePrevious) are rejected
  // by the server outright when combined with tab=sources (see
  // historyQuerySchema's JOB_ONLY guard in history-contract.ts), so
  // carrying them across a tab switch would just produce an invalid
  // request. `jobs` is the schema's default tab, so its URL omits the
  // param rather than spelling out `?tab=jobs`.
  return tab === "sources" ? "/history?tab=sources" : "/history";
}

export type HistoryTabsProps = {
  active: HistoryTab;
  // The active tab's own panel content. Only one tab is ever rendered at a
  // time -- switching is a full server navigation to a page that renders
  // the other tab's content -- so there is never a second, inactive
  // TabsContent mounted alongside this one.
  children: React.ReactNode;
};

// The History page's tablist (F20): role="tablist" / role="tab"
// (aria-selected, aria-controls) / role="tabpanel", all for free from
// Radix's Tabs primitive, with arrow-key roving focus between triggers.
//
// activationMode="manual": arrow keys move focus between the two triggers
// without selecting one, and only Enter/Space/click actually navigates.
// Automatic activation would fire a full server navigation on every arrow
// key press, which is exactly the "expensive activation" case the ARIA
// Authoring Practices recommend manual activation for.
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
