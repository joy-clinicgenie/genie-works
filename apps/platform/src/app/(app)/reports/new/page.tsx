import { canEditClient, listClients, listReportWebsites } from "@clinic-genie/db";
import { itemsForTemplate } from "@clinic-genie/contracts";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { ReportBuilder } from "@/components/modules/ReportBuilder";
import { clientLabel } from "@/lib/client-label";

export const dynamic = "force-dynamic";
export const metadata = { title: "New report" };

export default async function NewReportPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const access = await requireAccess();
  const { client } = await searchParams;
  const clients = await staffTx(access, (db) => listClients(db));
  const editable = clients.filter((item) => canEditClient(access, item.id));
  const websites = await staffTx(access, (db) => listReportWebsites(db, editable.map((item) => item.id)));
  return (
    <>
      <PageHeader title="Create a report" description="Choose a template, adjust the checklist, preview the recorded figures, then save a draft or open a PDF." />
      {editable.length === 0 ? <Notice tone="neutral">You cannot create a report.</Notice> : (
        <ReportBuilder
          readOnly={false}
          preparedBy={access.user.display_name}
          clients={editable.map((item) => ({ id: item.id, label: clientLabel(item) }))}
          websites={websites.map((item) => ({ id: item.id, clientId: item.client_id, label: item.url ? `${item.name} (${item.url})` : item.name }))}
          draft={{
            clientId: editable.some((item) => item.id === client) ? client! : "",
            websiteId: "",
            reportType: "monthly",
            templateKey: "monthly",
            name: "Monthly Performance Report",
            periodStart: "",
            periodEnd: "",
            comparisonStart: "",
            comparisonEnd: "",
            items: itemsForTemplate("monthly"),
          }}
        />
      )}
    </>
  );
}
