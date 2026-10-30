import { Card, CardHeader } from "@/components/ui/Card";

const CATEGORIES = [
  {
    title: "Traffic",
    reports: ["Traffic trends", "Sources", "Devices", "Locations", "Entry pages", "New and returning visitors"],
    recorded: "Session totals can be compared below when a website export exists. Devices, locations, entry pages and new or returning visitors are not recorded.",
  },
  {
    title: "Engagement",
    reports: ["Page performance", "Engagement time", "Button clicks", "Navigation paths"],
    recorded: "Not recorded. Bounce rate stays out of the overview until engagement rate is connected.",
  },
  {
    title: "Enquiries and conversions",
    reports: ["Form funnel", "Contact actions", "Enquiries by source, page and device"],
    recorded: "A stored-enquiry total can be compared below. It is not a contact click, a form-completion rate, or a confirmed appointment. Splits by source, page and device are not recorded.",
  },
  {
    title: "Search",
    reports: ["Google queries", "Clicks", "Impressions", "Click-through rate", "Landing-page performance"],
    recorded: "Clicks and impressions can be compared below when that export exists. Queries, average position and landing pages are not recorded.",
  },
  {
    title: "Campaigns",
    reports: ["Paid campaign results", "Cost per enquiry", "Email and social performance"],
    recorded: "Paid clicks, cost and platform-reported conversions can be compared below when that export exists. Cost per enquiry is not calculated, because ad cost and stored enquiries are different measurements. Email and social performance are not connected.",
  },
] as const;

export function ReportCatalogue() {
  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-2">
      {CATEGORIES.map((category) => (
        <Card key={category.title}>
          <CardHeader title={category.title} description={category.reports.join(" · ")} />
          <p className="px-5 pb-5 text-sm text-muted">{category.recorded}</p>
        </Card>
      ))}
    </div>
  );
}
