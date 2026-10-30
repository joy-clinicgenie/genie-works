"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { analyticsSearch } from "@/lib/period-options";
import { InnerNavFrame, InnerNavGroup, InnerNavLink } from "@/components/shell/InnerNav";

const LINKS = [
  { href: "/analytics", label: "Overview", exact: true },
  { href: "/analytics/traffic", label: "Traffic", exact: false },
  { href: "/analytics/behavior", label: "Behaviour", exact: false },
] as const;

export function AnalyticsSubnav({ clientId, websiteId, range, from, to, children }: { clientId: string; websiteId?: string | null; range: string; from?: string; to?: string; children: ReactNode }) {
  const pathname = usePathname();
  const query = `?${analyticsSearch(clientId, range, from, to, websiteId ?? undefined)}`;
  return (
    <InnerNavFrame
      label="Analytics sections"
      nav={
        <InnerNavGroup title="Analytics">
          {LINKS.map((link) => {
            const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
            return <InnerNavLink key={link.href} href={`${link.href}${query}`} current={active}>{link.label}</InnerNavLink>;
          })}
        </InnerNavGroup>
      }
    >
      {children}
    </InnerNavFrame>
  );
}
