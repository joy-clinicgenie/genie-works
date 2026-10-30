"use client";

import { useState, type ReactNode } from "react";
import { InnerNavFrame, InnerNavGroup, innerNavItemClass } from "@/components/shell/InnerNav";

const tabs = [
  { id: "content", label: "Write" },
  { id: "review", label: "Review" },
  { id: "history", label: "History" },
] as const;

export function ArticleTabs({ lead, editor, review, history }: { lead?: ReactNode; editor: ReactNode; review: ReactNode; history: ReactNode }) {
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("content");
  const panels = { content: editor, review, history };
  return (
    <InnerNavFrame
      label="Article"
      nav={
        <InnerNavGroup title="Article" label="Article workspace">
          {tabs.map((item) => (
            <li key={item.id}>
              <button type="button" role="tab" aria-selected={tab === item.id} className={innerNavItemClass(tab === item.id)} onClick={() => setTab(item.id)}>
                {item.label}
              </button>
            </li>
          ))}
        </InnerNavGroup>
      }
    >
      {lead}
      {tabs.map((item) => (
        <div key={item.id} role="tabpanel" hidden={tab !== item.id}>{panels[item.id]}</div>
      ))}
    </InnerNavFrame>
  );
}
