import Link from "next/link";
import { canEditClient, formatDateTime, formatPeriod, listClientsForRequest, listSavedReports, scopeWorkspace } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card, CardHeader } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Table, Td, Th } from "@/components/ui/Table";
import { clientLabel } from "@/lib/client-label";
import { Notice } from "@/components/ui/Notice";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const access = await requireAccess();
  const { client } = await searchParams;
  const data = await staffTx(access, async (db) => {
    const clients = await listClientsForRequest(db, client);
    const selection = scopeWorkspace({ requestedClientId: client, clients, websites: [] });
    const reports = await listSavedReports(db, selection.clientId ?? undefined);
    return { clients, reports, selection };
  });
  const canCreate = data.clients.some((item) => canEditClient(access, item.id));
  return (
    <>
      <PageHeader
        title="Reports"
        description="Prepare, save and export a report. Analytics stays on its own page. Recorded figures are read from the client. A contact click is not shown as an enquiry or an appointment."
        action={canCreate ? <LinkButton href="/reports/new">Create</LinkButton> : undefined}
      />
      {data.selection.denied && <div className="mb-4"><Notice tone="neutral">That client is not available.</Notice></div>}
      <Card className="mb-4">
        <CardHeader title="Report library" description="Report name, client, reporting period, creator and date created." />
        <form method="get" className="flex flex-wrap items-end gap-3 px-5 pb-4">
          <Field label="Client" htmlFor="client">
            <Select id="client" name="client" defaultValue={data.selection.clientId ?? ""}>
              <option value="">All clients</option>
              {data.clients.map((item) => <option key={item.id} value={item.id}>{clientLabel(item)}</option>)}
            </Select>
          </Field>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        <Table caption="Report library">
          <thead>
            <tr><Th>Report</Th><Th>Client</Th><Th>Reporting period</Th><Th>Creator</Th><Th>Date created</Th></tr>
          </thead>
          <tbody>
            {data.reports.map((report) => (
              <tr key={report.id}>
                <Td><Link href={`/reports/${report.id}`} className="font-medium text-action hover:underline">{report.name}</Link><span className="mt-0.5 block text-xs text-muted">{report.status === "draft" ? "Draft" : "Saved"}</span></Td>
                <Td>{clientLabel({ name: report.client_name, reference_number: report.reference_number })}</Td>
                <Td className="whitespace-nowrap">{formatPeriod(report.period_start, report.period_end, " to ")}</Td>
                <Td>{report.creator_name}</Td>
                <Td className="whitespace-nowrap">{formatDateTime(report.created_at)}</Td>
              </tr>
            ))}
            {data.reports.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-center text-sm text-muted">No reports saved yet.</td></tr>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
