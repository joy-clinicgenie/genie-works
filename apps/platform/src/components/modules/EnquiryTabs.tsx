"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { InnerNavFrame, InnerNavGroup, InnerNavLink } from "@/components/shell/InnerNav";

// The Forms tab is hidden from this nav. /enquiries/forms still resolves for
// anyone holding the link, and stays listed in EXACT so it does not mark the
// Enquiries tab active.
const TABS = [
  ["/enquiries", "Enquiries"],
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
