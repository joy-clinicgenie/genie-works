"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { InnerNavFrame, InnerNavGroup, InnerNavLink } from "@/components/shell/InnerNav";

const TABS = [
  ["/enquiries", "Enquiries"],
  ["/enquiries/forms", "Forms"],
  ["/enquiries/notifications", "Notification status"],
] as const;

const EXACT = ["/enquiries/forms", "/enquiries/notifications"] as const;

export function EnquiryTabs({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <InnerNavFrame
      label="Enquiry sections"
      nav={
        <InnerNavGroup title="Enquiries">
          {TABS.map(([href, name]) => {
            const active = href === "/enquiries"
              ? pathname === "/enquiries" || (pathname.startsWith("/enquiries/") && !EXACT.some((exact) => pathname.startsWith(exact)))
              : pathname.startsWith(href);
            return <InnerNavLink key={href} href={href} current={active}>{name}</InnerNavLink>;
          })}
        </InnerNavGroup>
      }
    >
      {children}
    </InnerNavFrame>
  );
}
