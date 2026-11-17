import { listClients } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui/Card";
import { Table, Td, Th } from "@/components/ui/Table";
import { EmptyState, Notice } from "@/components/ui/Notice";
import { FilterBar, FilterSelect } from "@/components/ui/Filters";
import { EnquiryTabs } from "@/components/modules/EnquiryTabs";
import { clientLabel } from "@/lib/client-label";
import { submissionClinicScope } from "@/lib/form-submissions";
import { listConnectedForms } from "@/lib/connected-forms";

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
  return (
    <EnquiryTabs>
      <PageHeader
        title="Forms"
        description="The forms each website sends enquiries from, read from the clinic website enquiry database. Genie Works does not change a form's fields, recipients or notifications."
      />
      {denied && <div className="mb-4"><Notice tone="bad" title="Not available">You do not have access to that clinic.</Notice></div>}
      <FilterBar clearHref="/enquiries/forms">
        <FilterSelect name="clinic" label="Client" value={clinic} allLabel="All clients" options={clientOptions} />
      </FilterBar>
      {forms.length === 0 ? (
        <EmptyState title="No forms are connected">
          No website-database form has been seen yet. A form appears here once its website has sent an enquiry.
        </EmptyState>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Form</Th>
                <Th>Client / website</Th>
                <Th>Source</Th>
              </tr>
            </thead>
            <tbody>
              {forms.map((form) => (
                <tr key={`${form.clientSlug}-${form.websiteKey ?? "none"}-${form.formKey}`}>
                  <Td>
                    <div className="font-medium">{form.displayName}</div>
                    <div className="text-xs text-muted">{form.formKey}</div>
                  </Td>
                  <Td>
                    <div>{form.clientName}</div>
                    <div className="text-xs text-muted">{form.websiteKey ?? "Unknown website"}</div>
                  </Td>
                  <Td>{form.platform}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </EnquiryTabs>
  );
}
