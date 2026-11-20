import Link from "next/link";
import { REVIEW_FIELDS, canEditClient, formatDate, getBranch, listBranchReviews, todaySgt, type BranchRow, type ReviewField } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { Badge, label } from "@/components/ui/Badge";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Checkbox, Field, Input } from "@/components/ui/Field";
import { EmptyState, Notice } from "@/components/ui/Notice";
import { Table, Td, Th } from "@/components/ui/Table";
import { SeoBusinessProfileForm } from "@/components/modules/SeoSoftLaunchForms";
import { SeoFrame } from "@/components/modules/seo/SeoFrame";
import { recordBranchReviewAction } from "@/app/actions/seo-branches";
import { isWebsiteId } from "@/lib/seo-scope";
import { loadSeoContext, queryText, seoHref, type SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Branch profile" };

const TABS = [["locations", "Locations"], ["reviews", "Reviews"], ["insights", "Insights"]] as const;
const FIELD_LABEL: Record<ReviewField, string> = { name: "Name", address: "Address", phone: "Phone", hours: "Opening hours" };

function saved(branch: BranchRow, field: ReviewField): string | null {
  if (field === "name") return branch.branch_name;
  if (field === "address") return branch.address;
  if (field === "phone") return branch.phone;
  return branch.opening_hours;
}

export default async function BranchProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SeoSearch> }) {
  const access = await requireAccess();
  const { id } = await params;
  const query = await searchParams;
  const ctx = await loadSeoContext(access, query);
  const site = ctx.selected;
  // SEO-06.2 (D64): the branch must belong to the selected website's organisation.
  const data = site && isWebsiteId(id)
    ? await staffTx(access, async (db) => {
      const branch = await getBranch(db, site.clientId, id);
      return branch ? { branch, reviews: await listBranchReviews(db, site.clientId, id) } : null;
    })
    : null;
  const listHref = seoHref("/seo/business-profile", ctx, { tab: "locations" });
  if (!data || !site) {
    return (
      <SeoFrame ctx={ctx} pathname="/seo/business-profile" title="Branch profile" description="Saved branch details and listing reviews." tabs={TABS} currentTab="locations">
        <EmptyState title="This branch is not part of the selected organisation" action={site ? <LinkButton href={listHref} variant="secondary">Open the branch list</LinkButton> : undefined}>Open the branch from its own organisation&apos;s list.</EmptyState>
      </SeoFrame>
    );
  }
  const { branch, reviews } = data;
  const canEdit = canEditClient(access, site.clientId);
  const notice = queryText(query, "notice");
  return (
    <SeoFrame ctx={ctx} pathname="/seo/business-profile" title={branch.branch_name} description="Saved branch details beside the Google listing, and staff reviews of that listing." tabs={TABS} currentTab="locations" action={<LinkButton href={listHref} variant="secondary">All branches</LinkButton>}>
      <div className="space-y-5" data-branch-id={branch.id}>
        {notice === "review_saved" && <Notice tone="neutral">The review is saved.</Notice>}
        {notice === "review_invalid" && <Notice tone="warn">The review was not saved. {queryText(query, "reason")}</Notice>}
        {notice === "denied" && <Notice tone="warn">Recording a review needs edit access to this organisation.</Notice>}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {branch.mapping === "location" ? <Badge tone="good">Mapped by Google location ID</Badge> : branch.mapping === "public_link" ? <Badge tone="info">Mapped by public listing link</Badge> : <Badge tone="warn">Unmapped</Badge>}
          <Badge>{label(branch.setup_status)}</Badge>
          {branch.mapping === "location" && <span className="font-mono">{branch.external_identifier}</span>}
          {branch.profile_url && <a href={branch.profile_url} target="_blank" rel="noreferrer" className="text-action hover:underline">Open the public listing</a>}
        </div>

        <Card>
          <CardHeader title="Branch details" description="Genie Works records on the left. Google-supplied data needs an approved Business Profile API connection, which is not available." />
          <Table caption="Saved details beside the Google listing">
            <thead><tr><Th>Field</Th><Th>Saved in Genie Works</Th><Th>Google listing</Th></tr></thead>
            <tbody>
              {REVIEW_FIELDS.map((field) => (
                <tr key={field}>
                  <Td className="font-medium">{FIELD_LABEL[field]}</Td>
                  <Td className="whitespace-pre-line">{saved(branch, field) ?? <span className="text-muted">Not saved</span>}</Td>
                  <Td><Badge>Unavailable</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="px-5 py-3 text-xs text-muted">
            {branch.mapping === "public_link" ? "Review the public listing manually and record what it shows below."
              : branch.mapping === "location" ? "The location ID is stored for a future approved connection. Until then, review the listing manually."
                : "Add a public listing link or Google location ID to map this branch."}
          </p>
        </Card>

        {canEdit && (
          <Card>
            <CardHeader title="Record a listing review" description="Your observation of the public Google listing. It is recorded as a staff observation, not Google data." />
            <form action={recordBranchReviewAction} className="space-y-4 px-5 pb-5">
              <input type="hidden" name="websiteId" value={site.id} />
              <input type="hidden" name="branchId" value={branch.id} />
              <Field label="Review date" htmlFor="review-date">
                <Input id="review-date" name="reviewedOn" type="date" defaultValue={todaySgt()} required />
              </Field>
              <div className="space-y-3">
                {REVIEW_FIELDS.map((field) => (
                  <fieldset key={field} className="rounded-xl border border-line p-3">
                    <legend className="px-1 text-sm font-medium">{FIELD_LABEL[field]}</legend>
                    <div className="flex flex-wrap gap-4">
                      <Checkbox name={`reviewed_${field}`} label="Reviewed" />
                      <Checkbox name={`mismatch_${field}`} label="Listing differs from saved" />
                    </div>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <Field label="What the listing shows" htmlFor={`observed-${field}`}>
                        <Input id={`observed-${field}`} name={`observed_${field}`} maxLength={300} />
                      </Field>
                      <Field label="Note (optional)" htmlFor={`note-${field}`}>
                        <Input id={`note-${field}`} name={`note_${field}`} maxLength={300} />
                      </Field>
                    </div>
                  </fieldset>
                ))}
              </div>
              <Button type="submit" variant="secondary" size="sm">Save review</Button>
            </form>
          </Card>
        )}

        <Card>
          <CardHeader title="Review history" description="Staff observations, newest first." />
          {reviews.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">No review is recorded for this branch.</p> : (
            <ul className="divide-y divide-line">
              {reviews.map((review) => (
                <li key={review.id} className="space-y-1 px-5 py-4 text-sm" data-review={review.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>Staff observation</Badge>
                    <span>{formatDate(review.reviewedOn)} · {review.reviewedByName ?? "A staff member"}</span>
                    <span className="text-muted">Reviewed: {review.fieldsReviewed.map((field) => FIELD_LABEL[field]).join(", ")}</span>
                  </div>
                  {review.discrepancies.length === 0 ? <p className="text-muted">No discrepancy recorded.</p> : review.discrepancies.map((item) => (
                    <p key={item.field} data-discrepancy={item.field}>
                      <Badge tone="warn">{FIELD_LABEL[item.field]} differs</Badge> Saved: {item.saved ?? "Not saved"} · Listing: {item.observed}{item.note ? ` · ${item.note}` : ""}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {canEdit && (
          <Card>
            <CardHeader title="Edit branch" description="Saving changes the Genie Works record only. It does not change the Google listing." />
            <div className="px-5 pb-5"><SeoBusinessProfileForm clientId={branch.client_id} profile={branch} /></div>
          </Card>
        )}
        <Link href={listHref} className="text-sm text-action hover:underline">Back to all branches</Link>
      </div>
    </SeoFrame>
  );
}
