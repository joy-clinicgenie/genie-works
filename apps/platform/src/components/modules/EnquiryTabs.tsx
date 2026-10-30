"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { InnerNavFrame, InnerNavGroup, InnerNavLink } from "@/components/shell/InnerNav";

const TABS = [
  ["/enquiries", "Enquiries"],
  ["/enquiries/notifications", "Notification status"],
] as const;

export function EnquiryTabs({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <InnerNavFrame
      label="Enquiry sections"
      nav={
        <InnerNavGroup title="Enquiries">
          {TABS.map(([href, name]) => {
            const active = href === "/enquiries/notifications" ? pathname.startsWith(href) : pathname === "/enquiries" || (pathname.startsWith("/enquiries/") && !pathname.startsWith("/enquiries/notifications"));
            return <InnerNavLink key={href} href={href} current={active}>{name}</InnerNavLink>;
          })}
        </InnerNavGroup>
      }
    >
      {children}
    </InnerNavFrame>
  );
}
