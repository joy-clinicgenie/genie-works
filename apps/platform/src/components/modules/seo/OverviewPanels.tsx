import type { ReactNode } from "react";
import { Unavailable } from "@/components/modules/seo/SeoFrame";

/* The SEO Overview itself is built from SeoAssistant.tsx (D74). The earlier overview cards (D67: Google Search,
   AI Visibility, Quick actions, Recent changes) were removed from the dashboard; their data stays in Reports. */

export function DemoNote({ children }: { children: ReactNode }) {
  return <Unavailable title="Demo data">{children} Nothing on this screen is saved, crawled or sent to Google.</Unavailable>;
}
