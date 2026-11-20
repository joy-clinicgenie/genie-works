import Link from "next/link";
import { formatDate, listBranches } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { Table, Td, Th } from "@/components/ui/Table";
import { Badge, label } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { SeoBusinessProfileForm } from "@/components/modules/SeoSoftLaunchForms";
import { SeoFrame, Unavailable } from "@/components/modules/seo/SeoFrame";
import { DemoNote } from "@/components/modules/seo/OverviewPanels";
import { loadSeoContext, loadWebsiteSeo, queryText, selectedTab, type SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Google Business Profile" };

const TABS = [
  ["locations", "Locations"],
  ["reviews", "Reviews"],
  ["insights", "Insights"],
] as const;

export default async function BusinessProfilePage({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  const access = await requireAccess();
  const query = await searchParams;
  const ctx = await loadSeoContext(access, query);
  const bundle = ctx.selected ? await loadWebsiteSeo(access, ctx.selected) : null;
  const tab = selectedTab(queryText(query, "tab"), TABS, "locations");
  // SEO-06.1 (D64): branches of the selected website's organisation.
  const site = ctx.selected;
  const branches = site && tab === "locations" ? await staffTx(access, (db) => listBranches(db, site.clientId)) : [];
  const branchHref = (id: string) => `/seo/business-profile/${id}?${new URLSearchParams({ website: site?.id ?? "" })}`;
  return (
    <SeoFrame ctx={ctx} pathname="/seo/business-profile" title="Google Business Profile" description="Branch references are internal records. Saving one does not change the public Google profile." tabs={TABS} currentTab={tab}>
      {ctx.demo ? <DemoNote>No sample locations, reviews or insights are shown.</DemoNote> : tab === "reviews" ? (
        <Unavailable title="Reviews are not connected">There is no review list, draft reply or reply publication. A reply cannot be sent to Google from here.</Unavailable>
      ) : tab === "insights" ? (
        <Unavailable title="Profile insights are not connected">Calls, searches and direction requests are unavailable. They are not shown as zero.</Unavailable>
      ) : bundle ? (
        <>
          <Unavailable title="Google listing data is not connected">Google&apos;s Business Profile APIs need an approved project, which Genie Works does not have. Branches can be mapped by location ID or public link and reviewed manually; Google-supplied details are shown as Unavailable.</Unavailable>
          <Card className="my-5">
            <CardHeader title="Branches" description={`Branches of ${site?.clientName ?? "this organisation"}. Each row opens the branch's saved details and review history.`} />
            {branches.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">No branches are recorded for this organisation.</p> : (
              <Table caption="Google Business Profile branches">
                <thead><tr><Th>Branch</Th><Th>Mapping</Th><Th>Setup status</Th><Th>Last review</Th><Th>Actions</Th></tr></thead>
                <tbody>
                  {branches.map((branch) => (
                    <tr key={branch.id} data-branch={branch.branch_name} data-mapping={branch.mapping}>
                      <Td className="font-medium">{branch.branch_name}</Td>
                      <Td>
                        {branch.mapping === "location" ? <Badge tone="good">Google location ID</Badge> : branch.mapping === "public_link" ? <Badge tone="info">Public listing link</Badge> : <Badge tone="warn">Unmapped</Badge>}
                        {branch.mapping === "location" && <div className="mt-1 text-xs text-muted">{branch.external_identifier}</div>}
                        {branch.unrecognisedIdentifier && <div className="mt-1 text-xs text-muted">Stored ID is not a Google location name</div>}
                      </Td>
                      <Td>{label(branch.setup_status)}</Td>
                      <Td>{branch.lastReview ? `${formatDate(branch.lastReview.reviewedOn)} · ${branch.lastReview.discrepancyCount} discrepancy(ies)` : <span className="text-muted">Not reviewed</span>}</Td>
                      <Td><Link href={branchHref(branch.id)} className="text-action hover:underline" aria-label={`Open ${branch.branch_name}`}>Open branch</Link></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          {bundle.canEdit && (
            <Card>
              <CardHeader title="Add a branch" description="Map it by Google location ID or public listing link. Staff-marked verified is not confirmation from Google." />
              <div className="px-5 pb-5"><SeoBusinessProfileForm clientId={ctx.selected!.clientId} /></div>
            </Card>
          )}
        </>
      ) : null}
    </SeoFrame>
  );
}
