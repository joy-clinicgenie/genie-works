import Link from "next/link";
import { formatDateTime } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { PageHeader, Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/Table";
import { Notice, EmptyState } from "@/components/ui/Notice";
import { FilterBar, FilterSelect } from "@/components/ui/Filters";
import { EnquiryTabs } from "@/components/modules/EnquiryTabs";
import { formName, listFormSubmissions, listSubmissionForms, submissionClinicScope, submissionFormKey, submissionStatus } from "@/lib/form-submissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Enquiries" };

const STATUS_TONE = { new: "info", acknowledged: "warn", closed: "neutral" } as const;

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<{ clinic?: string; status?: string; form?: string }> }) {
  const access = await requireAccess();
  const params = await searchParams;
  const scope = submissionClinicScope(access);
  const status = submissionStatus(params.status);
  const form = submissionFormKey(params.form);
  const denied = Boolean(params.clinic && scope !== null && !scope.includes(params.clinic));
  const [data, forms] = await Promise.all([
    listFormSubmissions(scope, { clinicId: denied ? undefined : params.clinic, status, formKey: form }),
    listSubmissionForms(scope),
  ]);
  return (
    <EnquiryTabs>
      <PageHeader title="Enquiries" description="Requests received from clinic websites. This list reads those records. It does not keep a second copy." />
      {denied && <div className="mb-4"><Notice tone="bad" title="Not available">You do not have access to that clinic.</Notice></div>}
      {!data.connected && (
        <EmptyState title="No enquiries are available">The clinic website database is not connected. Submitted requests stay there until it is.</EmptyState>
      )}
      {data.connected && (
        <>
          <FilterBar>
            <FilterSelect name="clinic" label="Client" value={params.clinic} allLabel="All clients" options={data.clinics.map((clinic) => ({ value: clinic.id, label: clinic.name }))} />
            <FilterSelect name="form" label="Form" value={form} allLabel="All forms" options={forms.map((item) => ({ value: item.key, label: item.name }))} />
            <FilterSelect name="status" label="Status" value={status} allLabel="Any status" options={[{ value: "new", label: "New" }, { value: "acknowledged", label: "Acknowledged" }, { value: "closed", label: "Closed" }]} />
          </FilterBar>
          <Card>
            <Table caption="Enquiries">
              <thead>
                <tr>
                  <Th>Received</Th>
                  <Th>Client</Th>
                  <Th>Form</Th>
                  <Th>Name</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} className="hover:bg-surface-muted/60">
                    <Td>
                      <Link href={`/enquiries/${item.id}`} className="font-medium text-action hover:underline">{formatDateTime(item.submittedAt)}</Link>
                      <div className="text-xs text-muted">{item.reference}</div>
                    </Td>
                    <Td>{item.clinicName}</Td>
                    <Td>{formName(item.formKey)}</Td>
                    <Td>
                      {item.submitterName}
                      {item.isSynthetic && <div className="text-xs text-muted">Demonstration data</div>}
                    </Td>
                    <Td><Badge tone={STATUS_TONE[item.status]}>{item.status === "new" ? "New" : item.status === "acknowledged" ? "Acknowledged" : "Closed"}</Badge></Td>
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted">
                      {scope !== null && scope.length === 0 ? "No clinic access is assigned to you." : params.clinic || status || form ? "No enquiries match this search." : "No enquiries have been received."}
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </EnquiryTabs>
  );
}
