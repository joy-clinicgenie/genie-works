import Link from "next/link";
import { notFound } from "next/navigation";
import { canEditClient, canPublishClient, canReviewClient, getArticle, listActiveStaff, listArticleActivity, listArticleApprovals, listArticleMedia, listArticleVersions, listBlogWebsites } from "@clinic-genie/db";
import type { BlogStatus } from "@clinic-genie/contracts";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card, CardHeader } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";
import { updateArticleAction } from "@/app/actions/blog";
import { ArticleForm } from "@/components/modules/blog/ArticleForm";
import { ArticleTabs } from "@/components/modules/blog/ArticleTabs";
import { BlogWorkflow } from "@/components/modules/blog/BlogWorkflow";
import { HistoryRestore } from "@/components/modules/blog/HistoryRestore";
import { ImageUpload } from "@/components/modules/blog/ImageUpload";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<BlogStatus, string> = { draft: "Draft", in_review: "In review", approved: "Approved", published: "Published", archived: "Archived" };
const STATUS_TONE: Record<BlogStatus, Tone> = { draft: "neutral", in_review: "warn", approved: "info", published: "good", archived: "neutral" };
const REVISION_LABEL = { draft_revision: "Draft revision", revision_in_review: "Revision in review", approved_revision: "Approved revision" } as const;
const ACTIVITY_LABEL: Record<string, string> = {
  saved: "Saved",
  submitted: "Submitted for review",
  changes_requested: "Changes requested",
  withdrawn: "Returned to draft",
  approved: "Approved",
  published: "Published",
  revision_published: "Published revision",
  unpublished: "Unpublished",
  archived: "Archived",
  restored: "Restored to draft",
  version_restored: "Restored a previous version as a draft",
};

function stamp(value: Date | string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireAccess();
  const data = await staffTx(access, async (db) => {
    const article = await getArticle(db, id);
    if (!article) return null;
    return {
      article,
      versions: await listArticleVersions(db, id),
      approvals: await listArticleApprovals(db, id),
      activity: await listArticleActivity(db, id),
      media: await listArticleMedia(db, id),
      websites: await listBlogWebsites(db),
      staff: await listActiveStaff(db),
    };
  });
  if (!data) notFound();
  const { article } = data;
  const locked = article.status === "archived" || article.status === "in_review" || article.status === "approved" || (article.status === "published" && article.working_status !== "draft");
  const canEdit = canEditClient(access, article.client_id) && !locked;
  const canDecide = canReviewClient(access, article.client_id) && (access.user.platform_role === "admin" || access.user.platform_role === "manager" || access.user.id === article.reviewer_user_id);
  const latestReturn = data.approvals.find((approval) => approval.decision === "returned");
  const latestApproval = data.approvals.find((approval) => approval.decision === "approved" && approval.version_id === article.current_version_id);
  const stale = (article.status === "draft" || article.working_status === "draft") && data.approvals.some((approval) => approval.decision === "approved" && approval.version_id !== article.current_version_id);
  let domain: string | null = null;
  if (article.website_url) {
    try { domain = new URL(article.website_url).host; } catch { domain = null; }
  }
  const liveUrl = article.website_url && article.live_slug ? `${article.website_url.replace(/\/$/, "")}/blog/${article.live_slug}` : null;
  const reviewers = data.staff.filter((person) => person.platform_role === "admin" || person.platform_role === "manager" || person.platform_role === "reviewer");
  const versionLabel = article.version_number ? `Version ${article.version_number}` : "Saved version";

  return (
    <ArticleTabs
      lead={
        <>
      <PageHeader
        eyebrow={<Link href={`/blog?client=${article.client_id}&website=${article.website_id}`} className="text-action hover:underline">Blog</Link>}
        title={article.title.trim() || "Untitled article"}
        description={`${article.client_name} · ${article.website_name}`}
        action={<span className="inline-flex flex-wrap gap-2">{article.revision_indicator && <Badge tone="info">{REVISION_LABEL[article.revision_indicator]}</Badge>}<Badge tone={STATUS_TONE[article.status]}>{STATUS_LABEL[article.status]}</Badge></span>}
      />
      <div className="mb-6">
        <BlogWorkflow
          articleId={article.id}
          versionId={article.current_version_id}
          status={article.status}
          workingStatus={article.working_status}
          native={article.native}
          live={Boolean(article.live_version_id)}
          title={article.title}
          clientName={article.client_name}
          websiteName={article.website_name}
          domain={domain}
          publicUrl={liveUrl}
          approver={latestApproval?.reviewer_name ?? null}
          versionLabel={versionLabel}
          canEdit={canEditClient(access, article.client_id)}
          canDecide={canDecide}
          canPublish={canPublishClient(access, article.client_id)}
        />
      </div>
      {article.status === "published" && article.working_status && <div className="mb-4"><Notice tone="neutral">A published revision is still on the website. This working copy is not public.</Notice></div>}
      {article.status === "published" && !article.working_status && <div className="mb-4"><Notice tone="neutral">Create a revision before editing. The published page stays as it is until that revision is approved and published.</Notice></div>}
      {stale && <div className="mb-4"><Notice tone="warn" title="Resubmission required">An earlier approval does not cover this version.</Notice></div>}
      {article.live_version_id && liveUrl && <p className="mb-4 text-sm">Live URL: <a href={liveUrl} className="text-action underline" target="_blank" rel="noreferrer">{liveUrl}</a> · Published {stamp(article.first_published_at)}</p>}
        </>
      }
      editor={
          <div className="-mx-4 overflow-visible border-y border-line bg-surface lg:-mx-8">
            <ArticleForm
              action={updateArticleAction}
              websites={data.websites}
              people={data.staff}
              reviewers={reviewers}
              media={data.media}
              lockedClientId={article.client_id}
              lockedWebsiteId={article.website_id}
              readOnly={!canEdit}
              feedback={latestReturn?.note}
              article={article}
              backHref={`/blog?client=${article.client_id}&website=${article.website_id}`}
              context={`${article.client_name} · ${article.website_name}`}
              previewHref={article.current_version_id ? `/blog/${article.id}/preview?version=${article.current_version_id}` : undefined}
              upload={canEdit ? <ImageUpload articleId={article.id} /> : undefined}
            />
          </div>
        }
        review={
          <Card>
            <CardHeader title="Review and approval" description={`${article.client_name} · ${article.website_name}`} />
            <dl className="grid gap-3 px-5 py-4 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">Author</dt><dd>{article.author_name ?? "—"}</dd></div>
              <div><dt className="text-muted">Reviewer</dt><dd>{article.reviewer_name ?? "—"}</dd></div>
              <div><dt className="text-muted">Version</dt><dd>{versionLabel}</dd></div>
              <div><dt className="text-muted">Latest approval</dt><dd>{latestApproval ? `${latestApproval.reviewer_name} · ${stamp(latestApproval.decided_at)}` : "None for this version"}</dd></div>
            </dl>
            <div className="px-5 pb-5">
              {article.current_version_id && <Link href={`/blog/${article.id}/preview?version=${article.current_version_id}`} className="text-sm text-action underline">Open preview</Link>}
            </div>
          </Card>
        }
        history={
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Content versions" description="Restoring a version creates a new draft. It does not change the live article." />
              <ol className="divide-y divide-line">
                {data.versions.map((version) => (
                  <li key={version.id} className="px-5 py-3 text-sm">
                    <span className="font-medium">Version {version.version_number}</span>
                    <span className="text-muted"> · {version.title.trim() || "Untitled article"} · {version.created_by_name} · {stamp(version.created_at)}</span>
                    {version.id === article.current_version_id && <Badge className="ml-2">Working</Badge>}
                    {version.id === article.live_version_id && <Badge tone="good" className="ml-2">Live</Badge>}
                    <div className="mt-1"><Link href={`/blog/${article.id}/preview?version=${version.id}`} className="text-action underline">Inspect</Link></div>
                    {canEditClient(access, article.client_id) && article.status !== "in_review" && article.status !== "approved" && (
                      <HistoryRestore articleId={article.id} versionId={version.id} needsReplace={Boolean(article.working_status)} />
                    )}
                  </li>
                ))}
              </ol>
            </Card>
            <Card>
              <CardHeader title="Workflow activity" />
              <ol className="divide-y divide-line">
                {data.activity.length === 0 && <li className="px-5 py-3 text-sm text-muted">No activity yet.</li>}
                {data.activity.map((event) => (
                  <li key={event.id} className="px-5 py-3 text-sm">
                    <span className="font-medium">{ACTIVITY_LABEL[event.action] ?? event.action}</span>
                    <span className="text-muted"> · {event.actor_name} · {stamp(event.created_at)}{event.version_number ? ` · version ${event.version_number}` : ""}</span>
                    {event.note && <p className="mt-1">{event.note}</p>}
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        }
    />
  );
}
