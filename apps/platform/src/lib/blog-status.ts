import { WEBSITE_STATUS_LABEL, type ArticleRow } from "@clinic-genie/db";
import type { Tone } from "@/components/ui/Badge";

/**
 * D87: one status label per article, from the same SQL as the Overview queues. A released
 * article shows what the website is known to show; an internal release before D87 reads
 * "Website publication unverified". "Ship to site" is not used: it names the delivery action.
 */
export function articleStatus(article: Pick<ArticleRow, "status" | "working_status" | "website_status" | "latest_decision">): { label: string; tone: Tone } {
  if (article.status === "archived") return { label: "Archived", tone: "neutral" };
  if (article.status === "published") {
    const tone: Tone = article.website_status === "verified" ? "good" : article.website_status === "delivery_failed" ? "bad" : "warn";
    return { label: WEBSITE_STATUS_LABEL[article.website_status], tone };
  }
  if (article.status === "approved") return { label: "Ready to publish", tone: "info" };
  if (article.status === "in_review") return { label: "Awaiting review", tone: "warn" };
  if (article.latest_decision === "returned") return { label: "Changes requested", tone: "bad" };
  return { label: "Draft", tone: "neutral" };
}

/** The working copy of a live article, when it differs from what is released. */
export function workingLabel(article: Pick<ArticleRow, "status" | "working_status" | "latest_decision">): string | null {
  if (article.status !== "published" || !article.working_status) return null;
  if (article.working_status === "approved") return "Update ready to publish";
  if (article.working_status === "in_review") return "Update awaiting review";
  return article.latest_decision === "returned" ? "Update: changes requested" : "Unpublished changes";
}
