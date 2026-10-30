/** Checklist, templates and report types for the report builder. */

export const REPORT_TYPES = ["monthly", "quarterly", "custom"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  custom: "Custom",
};

export const REPORT_TEMPLATE_KEYS = ["monthly", "seo", "sem", "comprehensive"] as const;
export type ReportTemplateKey = (typeof REPORT_TEMPLATE_KEYS)[number];

export const REPORT_GROUP_KEYS = ["executive", "website", "organic", "seo", "leads", "ads", "blog", "recommendations"] as const;
export type ReportGroupKey = (typeof REPORT_GROUP_KEYS)[number];

export interface ReportTemplate {
  key: ReportTemplateKey;
  label: string;
  summary: string;
  groups: ReportGroupKey[];
}

export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    key: "monthly",
    label: "Monthly Performance Report",
    summary: "Executive Summary, Website Analytics, SEO, Leads, Recommendations",
    groups: ["executive", "website", "seo", "leads", "recommendations"],
  },
  {
    key: "seo",
    label: "SEO Performance Report",
    summary: "SEO, Organic Traffic, Blog Performance, Recommendations",
    groups: ["seo", "organic", "blog", "recommendations"],
  },
  {
    key: "sem",
    label: "SEM Performance Report",
    summary: "Google Ads, Leads, Conversions, Recommendations",
    groups: ["ads", "leads", "recommendations"],
  },
  {
    key: "comprehensive",
    label: "Comprehensive Report",
    summary: "All available sections",
    groups: [...REPORT_GROUP_KEYS],
  },
];

export type ReportItemKind = "insight" | "figure";

export interface ReportChecklistItem {
  key: string;
  label: string;
  kind: ReportItemKind;
  hint?: string;
}

export interface ReportChecklistGroup {
  key: ReportGroupKey;
  label: string;
  description?: string;
  items: ReportChecklistItem[];
}

export const REPORT_CHECKLIST: ReportChecklistGroup[] = [
  {
    key: "executive",
    label: "Executive Summary",
    description: "Wording is filled from recorded figures, completed work and open issues.",
    items: [
      { key: "performance_overview", label: "Performance overview", kind: "insight" },
      { key: "key_insights", label: "3 key performance insights", kind: "insight" },
      { key: "achievements", label: "Key achievements", kind: "insight" },
      { key: "attention", label: "Areas requiring attention", kind: "insight" },
      { key: "recommendations_next", label: "Recommendations and next steps", kind: "insight" },
    ],
  },
  {
    key: "website",
    label: "Website Analytics",
    items: [
      { key: "sessions", label: "Total website sessions", kind: "figure" },
      { key: "users", label: "Total users and new users", kind: "figure" },
      { key: "page_views", label: "Page views", kind: "figure" },
      { key: "engagement_rate", label: "Engagement rate", kind: "figure" },
      { key: "engagement_time", label: "Average engagement time", kind: "figure" },
      { key: "traffic_sources", label: "Traffic sources and channels", kind: "figure" },
      { key: "top_pages", label: "Top-performing pages", kind: "figure" },
      { key: "devices", label: "Device breakdown", kind: "figure" },
      { key: "geography", label: "Geographical breakdown", kind: "figure" },
      { key: "month_comparison", label: "Month-on-month comparison", kind: "figure" },
    ],
  },
  {
    key: "organic",
    label: "Organic Traffic",
    description: "Organic sessions stay separate from paid sessions and from Search Console clicks.",
    items: [
      { key: "organic_sessions", label: "Organic sessions", kind: "figure" },
      { key: "organic_channels", label: "Traffic sources and channels", kind: "figure" },
      { key: "organic_comparison", label: "Month-on-month comparison", kind: "figure" },
    ],
  },
  {
    key: "seo",
    label: "SEO Performance",
    items: [
      { key: "search_impressions", label: "Google Search impressions", kind: "figure" },
      { key: "organic_clicks", label: "Organic clicks", kind: "figure" },
      { key: "search_ctr", label: "Average click-through rate", kind: "figure" },
      { key: "search_position", label: "Average search position", kind: "figure" },
      { key: "top_queries", label: "Top search queries", kind: "figure" },
      { key: "organic_landings", label: "Top organic landing pages", kind: "figure" },
      { key: "ranking_changes", label: "Keyword ranking changes", kind: "figure" },
      { key: "seo_checklist", label: "SEO checklist progress", kind: "figure" },
      { key: "technical_seo", label: "Technical SEO issues", kind: "figure" },
      { key: "gbp", label: "Google Business Profile performance", kind: "figure" },
    ],
  },
  {
    key: "leads",
    label: "Leads & Conversions",
    description: "Recorded enquiries are kept apart from clicks. A WhatsApp click, a call-button click or a booking-link click is not a confirmed enquiry or a confirmed appointment.",
    items: [
      { key: "total_leads", label: "Total leads", kind: "figure", hint: "Recorded enquiries only. Form submissions are listed on their own line and are not added again." },
      { key: "form_submissions", label: "Contact form submissions", kind: "figure" },
      { key: "whatsapp_clicks", label: "WhatsApp clicks", kind: "figure", hint: "A click is not a confirmed enquiry." },
      { key: "call_clicks", label: "Call button clicks", kind: "figure", hint: "A click is not a confirmed enquiry." },
      { key: "booking_clicks", label: "Booking link clicks", kind: "figure", hint: "A booking-link click is not a confirmed appointment." },
      { key: "conversion_rate", label: "Conversion rate", kind: "figure", hint: "Recorded enquiries divided by recorded sessions, and only when both exist." },
      { key: "leads_by_source", label: "Leads by traffic source", kind: "figure" },
      { key: "cost_per_lead", label: "Cost per lead (CPL)", kind: "figure", hint: "Shown only when advertising cost and a recorded enquiry count are both available." },
      { key: "lead_comparison", label: "Lead performance comparison", kind: "figure" },
    ],
  },
  {
    key: "ads",
    label: "Google Ads Performance",
    items: [
      { key: "ad_spend", label: "Advertising spend", kind: "figure" },
      { key: "ad_delivery", label: "Impressions and clicks", kind: "figure" },
      { key: "ad_ctr", label: "Click-through rate (CTR)", kind: "figure" },
      { key: "ad_cpc", label: "Average cost per click (CPC)", kind: "figure" },
      { key: "ad_conversions", label: "Recorded conversions", kind: "figure", hint: "Platform-reported conversions, not confirmed enquiries or appointments." },
      { key: "cost_per_conversion", label: "Cost per conversion", kind: "figure" },
      { key: "campaign_performance", label: "Campaign performance", kind: "figure" },
      { key: "ad_keywords", label: "Top-performing keywords", kind: "figure" },
      { key: "search_vs_pmax", label: "Search versus Performance Max", kind: "figure" },
    ],
  },
  {
    key: "blog",
    label: "Blog Performance",
    items: [
      { key: "blogs_published", label: "Blogs published", kind: "figure" },
      { key: "blog_views", label: "Total blog views", kind: "figure" },
      { key: "top_posts", label: "Top-performing blog posts", kind: "figure" },
      { key: "organic_blog_traffic", label: "Organic blog traffic", kind: "figure" },
      { key: "blog_engagement", label: "Blog engagement", kind: "figure" },
      { key: "blog_leads", label: "Blog-generated leads", kind: "figure", hint: "Leads are not attributed to a blog post unless that link is recorded." },
      { key: "blog_search", label: "Search impressions and clicks", kind: "figure" },
      { key: "new_vs_existing", label: "New versus existing posts", kind: "figure" },
    ],
  },
  {
    key: "recommendations",
    label: "Recommendations & Actions",
    description: "Completed work, open issues and waiting decisions are filled from the client record.",
    items: [
      { key: "completed_activities", label: "Completed activities", kind: "insight" },
      { key: "optimisation", label: "Optimisation recommendations", kind: "insight" },
      { key: "next_priorities", label: "Next month's priorities", kind: "insight" },
      { key: "outstanding_issues", label: "Outstanding issues", kind: "insight" },
      { key: "client_decisions", label: "Client decisions required", kind: "insight" },
    ],
  },
];

const ITEM_INDEX = new Map(REPORT_CHECKLIST.flatMap((group) => group.items.map((item) => [item.key, { ...item, group: group.key }] as const)));

export function checklistItem(key: string) {
  return ITEM_INDEX.get(key) ?? null;
}

export function itemsForTemplate(key: ReportTemplateKey): string[] {
  const template = REPORT_TEMPLATES.find((item) => item.key === key);
  if (!template) return [];
  const groups = new Set<string>(template.groups);
  return REPORT_CHECKLIST.filter((group) => groups.has(group.key)).flatMap((group) => group.items.map((item) => item.key));
}

export function groupsForItems(items: string[]): ReportGroupKey[] {
  const wanted = new Set(items);
  return REPORT_CHECKLIST.filter((group) => group.items.some((item) => wanted.has(item.key))).map((group) => group.key);
}

export function isReportTemplate(value: string | null | undefined): value is ReportTemplateKey {
  return REPORT_TEMPLATE_KEYS.includes(value as ReportTemplateKey);
}

export function isReportType(value: string | null | undefined): value is ReportType {
  return REPORT_TYPES.includes(value as ReportType);
}
