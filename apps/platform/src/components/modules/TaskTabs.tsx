import type { ReactNode } from "react";
import { InnerNavFrame, InnerNavGroup, InnerNavLink } from "@/components/shell/InnerNav";

const TABS = [
  { id: "mine", label: "My tasks" },
  { id: "all", label: "All tasks" },
  { id: "completed", label: "Completed" },
] as const;

export type TaskListView = (typeof TABS)[number]["id"];

export function taskListView(value: string | undefined): TaskListView {
  return value === "all" || value === "completed" ? value : "mine";
}

function tabHref(id: TaskListView, search: string) {
  const params = new URLSearchParams(search);
  params.delete("view");
  params.delete("task");
  params.delete("compose");
  if (id !== "mine") params.set("view", id);
  const query = params.toString();
  return query ? `/my-tasks?${query}` : "/my-tasks";
}

export function TaskTabs({ view, search = "", children }: { view: TaskListView; search?: string; children: ReactNode }) {
  return (
    <InnerNavFrame
      label="Task lists"
      nav={
        <InnerNavGroup title="Tasks">
          {TABS.map((tab) => <InnerNavLink key={tab.id} href={tabHref(tab.id, search)} current={tab.id === view}>{tab.label}</InnerNavLink>)}
        </InnerNavGroup>
      }
    >
      {children}
    </InnerNavFrame>
  );
}
