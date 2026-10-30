"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { InnerNavAnchor, InnerNavFrame, InnerNavGroup, InnerNavLink } from "@/components/shell/InnerNav";

const SECTIONS = [
  ["#profile", "Profile"],
  ["#workspace", "Workspace"],
  ["#references", "Account references"],
] as const;

const PAGES = [
  ["/approvals", "Approvals"],
  ["/reports", "Reports"],
  ["/timeline", "Timeline"],
  ["/profile", "Edit profile"],
] as const;

export function ClientTabs({ clientId, children }: { clientId: string; children: ReactNode }) {
  const pathname = usePathname();
  const base = `/clients/${clientId}`;
  const onOverview = pathname === base;
  const [hash, setHash] = useState("");
  useEffect(() => {
    const read = () => setHash(window.location.hash);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [pathname]);
  const section = hash === "#workspace" || hash === "#references" ? hash : "#profile";
  return (
    <InnerNavFrame
      label="Client sections"
      nav={
        <>
          <InnerNavGroup title="This client">
            {SECTIONS.map(([suffix, name]) => (
              <InnerNavAnchor key={suffix} href={`${base}${suffix}`} current={onOverview && section === suffix} onClick={() => setHash(suffix)}>{name}</InnerNavAnchor>
            ))}
          </InnerNavGroup>
          <InnerNavGroup title="Records">
            {PAGES.map(([suffix, name]) => (
              <InnerNavLink key={suffix} href={`${base}${suffix}`} current={pathname.startsWith(`${base}${suffix}`)}>{name}</InnerNavLink>
            ))}
          </InnerNavGroup>
        </>
      }
    >
      {children}
    </InnerNavFrame>
  );
}
