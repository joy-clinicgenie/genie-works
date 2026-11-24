import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState, Notice } from "@/components/ui/Notice";
import { InnerNavFrame } from "@/components/shell/InnerNav";
import { BlogNav } from "@/components/modules/blog/BlogNav";
import { BlogScopeView } from "@/components/modules/blog/BlogScopeView";
import type { BlogPageKey, BlogScope } from "@/lib/blog-scope";

/** D87: the frame for a Blog section: navigation, client selection, then the section once a client is chosen. */
export function BlogSection({ active, title, description, scope, children }: { active: BlogPageKey; title: string; description: string; scope: BlogScope; children: ReactNode }) {
  return (
    <InnerNavFrame label="Blog" nav={<BlogNav active={active} scope={scope} />}>
      <PageHeader title={title} description={description} />
      {scope.denied && <div className="mb-4"><Notice tone="neutral">That client is not available.</Notice></div>}
      <BlogScopeView clients={scope.clients} clientId={scope.clientId}>
        {scope.client && (scope.websites.length === 0 ? <EmptyState title="No website for this client">This client has no active website.</EmptyState> : children)}
      </BlogScopeView>
    </InnerNavFrame>
  );
}
