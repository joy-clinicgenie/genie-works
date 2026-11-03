import { formatDateTime, listClients } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/Table";
import { EmptyState, Notice } from "@/components/ui/Notice";
import { FilterBar, FilterSelect } from "@/components/ui/Filters";
import { EnquiryTabs } from "@/components/modules/EnquiryTabs";
import { clientLabel } from "@/lib/client-label";
import { submissionClinicScope } from "@/lib/form-submissions";
import {
  connectedFormDetail,
  connectedFormStateLabel,
  connectedFormStateTone,
  listConnectedForms,
} from "@/lib/connected-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Forms" };

export default async function EnquiryFormsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const access = await requireAccess();
  const params = await searchParams;
  const scope = submissionClinicScope(access);
  const denied = Boolean(params.clinic && scope !== null && !scope.includes(params.clinic));
  const clinic = denied ? undefined : params.clinic && /^[a-z0-9-]{1,64}$/.test(params.clinic) ? params.clinic : undefined;
  const [forms, clients] = await Promise.all([
    listConnectedForms(access, clinic ? [clinic] : scope),
    staffTx(access, (db) => listClients(db)),
  ]);
  const clientOptions = clients.map((client) => ({ value: client.slug, label: clientLabel(client) }));
  const unreadable = forms.filter((form) => form.state !== "readable" && form.state !== "empty");
  const misbound = forms.filter((form) => form.boundSiteMatch === "different");
  return (
    <EnquiryTabs>
      <PageHeader
        title="Forms"
        description="The forms each website is connected to, read from that website's own source. A Wix form is read through the Wix Forms API; a vibe-coded website is read from its enquiry database. Genie Works does not create Wix forms and does not change their fields, recipients or notifications."
      />
      {denied && <div className="mb-4"><Notice tone="bad" title="Not available">You do not have access to that clinic.</Notice></div>}
      {unreadable.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn" title={`${unreadable.length} connected ${unreadable.length === 1 ? "form is" : "forms are"} not readable`}>
            A form listed below could not be read. The other websites are unaffected, and nothing was copied. An empty submission list is not the same as a failed read.
          </Notice>
        </div>
      )}
      {misbound.length > 0 && (
        <div className="mb-4">
          <Notice tone="bad" title={`${misbound.length} ${misbound.length === 1 ? "form reads" : "forms read"} from a different Wix site`}>
            The bound Wix site is not the website address recorded for that clinic. Enquiries submitted on the recorded address are not in the bound form, so a readable result is not a working connection for that website. The binding was left unchanged.
          </Notice>
        </div>
      )}
      <FilterBar clearHref="/enquiries/forms">
        <FilterSelect name="clinic" label="Client" value={clinic} allLabel="All clients" options={clientOptions} />
      </FilterBar>
      {forms.length === 0 ? (
        <EmptyState title="No forms are connected">
          No website is connected to a Wix form, and no website-database form has been seen. Connecting a form is an administrator action on the client&apos;s website record.
        </EmptyState>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Form</Th>
                <Th>Client / website</Th>
                <Th>Recorded address</Th>
                <Th>Bound Wix site</Th>
                <Th>Source</Th>
                <Th>Form id</Th>
                <Th>State</Th>
                <Th>Active</Th>
                <Th>Last successful read</Th>
              </tr>
            </thead>
            <tbody>
              {forms.map((form) => {
                const detail = connectedFormDetail(form);
                return (
                  <tr key={`${form.source}-${form.clientSlug}-${form.websiteKey ?? "none"}-${form.formKey}`}>
                    <Td>
                      <div className="font-medium">{form.displayName}</div>
                      <div className="text-xs text-muted">{form.formKey}</div>
                      {form.fields.length > 0 && <div className="text-xs text-muted mt-0.5">{form.fields.length} fields</div>}
                    </Td>
                    <Td>
                      <div>{form.clientName}</div>
                      <div className="text-xs text-muted">{form.websiteName ?? form.websiteKey ?? "Unknown website"}</div>
                    </Td>
                    <Td>
                      <div className="text-xs break-all">{form.liveDomain ?? "Not recorded"}</div>
                      {form.environment && <div className="text-xs text-muted">{form.environment}</div>}
                    </Td>
                    <Td>
                      {form.source === "database" ? (
                        <span className="text-xs text-muted">Not applicable</span>
                      ) : (
                        <>
                          <div className="text-xs break-all">{form.boundSiteUrl ?? "Not reported"}</div>
                          <div className="mt-1">
                            {form.boundSiteMatch === "different" ? (
                              <Badge tone="bad">Different site</Badge>
                            ) : form.boundSiteMatch === "match" ? (
                              <Badge tone="good">Same site</Badge>
                            ) : (
                              <Badge tone="neutral">Not confirmed</Badge>
                            )}
                          </div>
                        </>
                      )}
                    </Td>
                    <Td>
                      <div>{form.platform}</div>
                      {!form.countsInTotals && form.source === "wix" && <div className="text-xs text-muted">Out of production totals</div>}
                    </Td>
                    <Td>
                      <span className="text-xs font-mono break-all">{form.providerFormId ?? "Not applicable"}</span>
                    </Td>
                    <Td>
                      <Badge tone={connectedFormStateTone(form.state)}>{connectedFormStateLabel(form.state)}</Badge>
                      {detail && <div className="text-xs text-muted mt-1 max-w-xs">{detail}</div>}
                    </Td>
                    <Td>{form.active === null ? "Not reported" : form.active ? "Active" : "Inactive"}</Td>
                    <Td>
                      {form.checkedAt ? formatDateTime(form.checkedAt) : "Not read"}
                      {form.submissions !== null && (
                        <div className="text-xs text-muted">
                          {form.submissions === 0 ? "No submissions" : `${form.submissions}${form.more ? "+" : ""} read`}
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </EnquiryTabs>
  );
}
