import Link from "next/link";
import { canExport, formatDateTime, listClients, listFormWebsites, openedEnquiryIdentities } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/Table";
import { Notice, EmptyState } from "@/components/ui/Notice";
import { FilterBar, FilterInput, FilterSelect } from "@/components/ui/Filters";
import { Button } from "@/components/ui/Button";
import { EnquiryTabs } from "@/components/modules/EnquiryTabs";
import { EnquiryOverview } from "@/components/modules/EnquiryOverview";
import { clientLabel } from "@/lib/client-label";
import { KNOWN_FORMS } from "@/lib/form-catalogue";
import {
  ENQUIRY_PAGE_SIZE,
  STATUS_LABEL,
  canSearchEnquiryPerson,
  enquiryConnection,
  enquiryConnectorLabel,
  enquiryHandling,
  enquiryIdentity,
  enquiryUnavailableCopy,
  enquiryWindow,
  formName,
  HANDLING_LABEL,
  handlingFilter,
  listEnquiryBoard,
  listSubmissionForms,
  pageHandledEnquiries,
  submissionClinicScope,
  submissionFormKey,
  submissionStatus,
  submissionWebsiteKey,
  type EnquiryHandling,
  type SubmissionStatus,
} from "@/lib/form-submissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Enquiries" };

const STATUS_TONE: Record<SubmissionStatus, "info" | "warn" | "neutral"> = { new: "info", acknowledged: "warn", closed: "neutral" };
const HANDLING_TONE: Record<EnquiryHandling, "info" | "warn" | "good"> = { unopened: "info", read: "warn", resolved: "good" };

function queryHref(values: Record<string, string | undefined>, page?: number): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) search.set(key, value);
  if (page && page > 1) search.set("page", String(page));
  const text = search.toString();
  return text ? `/enquiries?${text}` : "/enquiries";
}

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const access = await requireAccess();
  const params = await searchParams;
  const scope = submissionClinicScope(access);
  const window = enquiryWindow(params.from, params.to);
  const status = submissionStatus(params.status);
  const form = submissionFormKey(params.form);
  const website = submissionWebsiteKey(params.website);
  const handling = handlingFilter(params.handling);
  const reference = params.q?.trim().slice(0, 80) || undefined;
  const personRequested = params.person?.trim().slice(0, 80) || undefined;
  const personAllowed = canSearchEnquiryPerson(access);
  const person = personAllowed ? personRequested : undefined;
  const page = Math.max(1, Number(params.page) || 1);
  const denied = Boolean(params.clinic && scope !== null && !scope.includes(params.clinic));
  const clinic = denied ? undefined : params.clinic && /^[a-z0-9-]{1,64}$/.test(params.clinic) ? params.clinic : undefined;
  const filters = { clinicId: clinic, websiteKey: website, formKey: form, status, reference, person, from: window.from, to: window.to, page };
  // Handling is resolved from this platform's read rows, not from the website source, so that filter pages here.
  const [board, forms, directory] = await Promise.all([
    listEnquiryBoard(scope, handling ? { ...filters, page: "all" as const } : filters, window, access),
    listSubmissionForms(scope),
    staffTx(access, async (db) => ({ clients: await listClients(db), websites: await listFormWebsites(db, null) })),
  ]);
  const opened = new Set(
    board.items.length === 0
      ? []
      : await staffTx(access, (db) => openedEnquiryIdentities(db, board.items.map((item) => ({ id: item.id, source: item.source ?? "database" })))),
  );
  const rowHandling = (item: (typeof board.items)[number]): EnquiryHandling => enquiryHandling(item.status, opened.has(enquiryIdentity(item)));
  const shown = handling ? pageHandledEnquiries(board.items, handling, opened, page) : { items: board.items, total: board.total, page: board.page };
  const productionTotal = handling ? board.items.filter((item) => !item.isSynthetic && rowHandling(item) === handling).length : board.currentTotal;
  const websiteNames = new Map(directory.websites.flatMap((site) => site.enquiry_key ? [[site.enquiry_key, site.name] as const] : []));
  const clientOptions = new Map(directory.clients.map((client) => [client.slug, clientLabel(client)]));
  for (const item of board.clinics) if (!clientOptions.has(item.id)) clientOptions.set(item.id, item.name);
  const websiteOptions = new Map<string, string>();
  for (const site of directory.websites) {
    if (!site.enquiry_key || (clinic && site.client_slug !== clinic)) continue;
    websiteOptions.set(site.enquiry_key, site.name);
  }
  for (const site of board.websites) {
    if (clinic && site.clinicId !== clinic) continue;
    if (!websiteOptions.has(site.key)) websiteOptions.set(site.key, websiteNames.get(site.key) ?? site.key);
  }
  const formOptions = new Map(KNOWN_FORMS.map((item) => [item.key, item.name]));
  for (const item of forms) formOptions.set(item.key, item.name);
  const preserved = { clinic, website, form, status, handling, q: reference, person, from: window.from, to: window.to };
  const source = board.connected ? null : await enquiryConnection();
  const lastPage = Math.max(1, Math.ceil(shown.total / ENQUIRY_PAGE_SIZE));
  return (
    <EnquiryTabs>
      <PageHeader
        title="Enquiries"
        description="Wix enquiries use the Forms API; vibe-coded sites use their own databases. Genie Works tracks enquiries without copying messages or sending emails. Handling and notification statuses remain separate, with each site managing its own email delivery."
      />
      {denied && <div className="mb-4"><Notice tone="bad" title="Not available">You do not have access to that clinic.</Notice></div>}
      {board.sourceNotice && <div className="mb-4"><Notice tone="warn">{board.sourceNotice}</Notice></div>}
      {personRequested && !personAllowed && <div className="mb-4"><Notice tone="neutral">Search by name, email or telephone is limited to staff who can edit the client. Reference search is available.</Notice></div>}
      {!board.connected && <EmptyState title="No enquiries are available">{enquiryUnavailableCopy(source ?? { configured: false, refused: false }, "No website enquiry database is connected, and no Wix form is available to read. One connection does not cover every website. Submitted requests stay at their source.")}</EmptyState>}
      {board.connected && (
        <>
          <EnquiryOverview board={board} window={window} websiteNames={websiteNames} />
          <FilterBar clearHref="/enquiries">
            <FilterInput name="from" label="From" type="date" value={window.from} />
            <FilterInput name="to" label="To" type="date" value={window.to} />
            <FilterSelect name="clinic" label="Client" value={clinic} allLabel="All clients" options={[...clientOptions].map(([value, label]) => ({ value, label }))} />
            <FilterSelect name="website" label="Website" value={website} allLabel="All websites" options={[...websiteOptions].map(([value, label]) => ({ value, label }))} />
            <FilterSelect name="form" label="Form" value={form} allLabel="All forms" options={[...formOptions].map(([value, label]) => ({ value, label }))} />
            <FilterSelect name="status" label="Follow-up status" value={status} allLabel="Any status" options={[{ value: "new", label: "New" }, { value: "acknowledged", label: "Acknowledged" }, { value: "closed", label: "Closed" }]} />
            <FilterSelect name="handling" label="Handling" value={handling} allLabel="Any handling" options={[{ value: "unopened", label: HANDLING_LABEL.unopened }, { value: "read", label: HANDLING_LABEL.read }, { value: "resolved", label: HANDLING_LABEL.resolved }]} />
            <FilterInput name="q" label="Reference" value={reference} placeholder="Reference" />
            {personAllowed && <FilterInput name="person" label="Name, email or telephone" value={person} placeholder="Restricted search" />}
          </FilterBar>
          <p className="mb-3 text-sm text-ink-soft">
            {shown.total === 1 ? "1 matching enquiry" : `${shown.total} matching enquiries`}
            {shown.total !== productionTotal && " The comparison above leaves demonstration submissions out."}
          </p>
          {canExport(access) && (
            <form method="get" action="/enquiries/export" className="card mb-5 space-y-3 p-4">
              {Object.entries(preserved).map(([key, value]) => value ? <input key={key} type="hidden" name={key} value={value} /> : null)}
              <p className="text-sm">This export includes {productionTotal === 1 ? "1 production record" : `${productionTotal} production records`} for the current filters. Demonstration submissions are not included.</p>
              <label className="flex min-h-11 items-start gap-2 text-sm">
                <input type="checkbox" name="details" value="1" className="mt-1 size-4 accent-action" />
                <span>Include contact details. This adds name, telephone and email. The message and other free-text details stay out of the file.</span>
              </label>
              <Button type="submit" variant="secondary" size="sm">Download CSV</Button>
            </form>
          )}
          <Card>
            <Table caption="Enquiries">
              <thead>
                <tr>
                  <Th>Received</Th>
                  <Th>Reference</Th>
                  <Th>Client / website</Th>
                  <Th>Form</Th>
                  <Th>Name</Th>
                  <Th>Follow-up status</Th>
                  <Th>Handling</Th>
                </tr>
              </thead>
              <tbody>
                {shown.items.map((item) => (
                  <tr key={enquiryIdentity(item)} className="hover:bg-surface-muted/60">
                    <Td className="whitespace-nowrap">
                      <Link href={`/enquiries/${item.id}`} className="font-medium text-action hover:underline">{formatDateTime(item.submittedAt)}</Link>
                    </Td>
                    <Td>{item.reference}</Td>
                    <Td>
                      {item.clinicName}
                      <div className="text-xs text-muted">{item.websiteKey ? websiteNames.get(item.websiteKey) ?? item.websiteKey : "Website not recorded"}</div>
                      <div className="text-xs text-muted">{enquiryConnectorLabel(item.source)}</div>
                    </Td>
                    <Td>{formName(item.formKey)}</Td>
                    <Td>
                      {item.submitterName}
                      {item.isSynthetic && <div className="text-xs text-muted">Demonstration data</div>}
                    </Td>
                    <Td><Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge></Td>
                    <Td><Badge tone={HANDLING_TONE[rowHandling(item)]}>{HANDLING_LABEL[rowHandling(item)]}</Badge></Td>
                  </tr>
                ))}
                {shown.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted">
                      {scope !== null && scope.length === 0 ? "No clinic access is assigned to you." : "No enquiries match this search."}
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
            {shown.total > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <p>Showing {(shown.page - 1) * ENQUIRY_PAGE_SIZE + 1}–{Math.min(shown.page * ENQUIRY_PAGE_SIZE, shown.total)} of {shown.total}</p>
                <div className="flex gap-3">
                  {shown.page > 1 && <Link href={queryHref(preserved, shown.page - 1)} className="text-action underline">Previous</Link>}
                  {shown.page < lastPage && <Link href={queryHref(preserved, shown.page + 1)} className="text-action underline">Next</Link>}
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </EnquiryTabs>
  );
}
