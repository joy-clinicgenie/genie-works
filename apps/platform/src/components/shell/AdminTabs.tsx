"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { InnerNavFrame, InnerNavGroup, InnerNavLink } from "@/components/shell/InnerNav";

const TABS = [["/admin", "Status"], ["/admin/users", "Users and roles"], ["/admin/audit", "Audit history"], ["/admin/backups", "Backups and recovery"]] as const;

export function AdminTabs({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <InnerNavFrame
      label="Admin sections"
      nav={
        <InnerNavGroup title="Admin">
          {TABS.map(([href, name]) => {
            const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
            return <InnerNavLink key={href} href={href} current={active}>{name}</InnerNavLink>;
          })}
        </InnerNavGroup>
      }
    >
      {children}
    </InnerNavFrame>
  );
}
