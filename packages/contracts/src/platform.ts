/** Shared vocabularies for the Clinic Genie platform. Database constraints mirror these lists. */

export const PLATFORM_ROLES = ["admin", "manager", "specialist", "reviewer", "read_only"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const CLIENT_CHANNELS = ["website", "seo", "google_ads", "social", "email", "other"] as const;
export type ClientChannel = (typeof CLIENT_CHANNELS)[number];

export const ACCOUNT_REFERENCE_KINDS = ["ga4", "search_console", "google_ads", "tag_manager", "google_business", "wix", "hosting", "domain", "booking", "other"] as const;

export const TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_STATUSES = ["open", "in_progress", "waiting", "completed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const ACTIVE_TASK_STATUSES: TaskStatus[] = ["open", "in_progress", "waiting"];

export const APPROVAL_STATUSES = ["draft", "submitted", "approved", "changes_requested", "withdrawn"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const APPROVAL_TYPES = ["content", "seo_change", "ads_change", "medical_claim", "website_change", "other"] as const;
export const DECISION_OUTCOMES = ["approved", "changes_requested"] as const;

export const SEARCH_INTENTS = ["informational", "navigational", "commercial", "transactional"] as const;
export const CONTENT_STATUSES = ["planned", "drafting", "in_review", "published", "needs_update", "retired"] as const;
export const MAPPING_FLAGS = ["none", "duplicate_target", "cannibalisation", "missing_page", "wrong_intent", "thin_content", "other"] as const;

export const AUDIT_STATUSES = ["open", "closed"] as const;
export const FINDING_SEVERITIES = ["low", "medium", "high"] as const;
export const FINDING_STATUSES = ["open", "implemented", "dismissed"] as const;

export const ISSUE_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const ISSUE_STATUSES = ["open", "investigating", "resolved_pending_verification", "verified_closed", "reopened"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const VERIFICATION_RESULTS = ["passed", "failed"] as const;

export const CLAIM_STATUSES = ["draft", "under_review", "approved", "rejected", "withdrawn"] as const;
export const REVIEW_DECISIONS = ["approved", "rejected", "changes_required"] as const;
export const SOURCE_TYPES = ["guideline", "peer_reviewed", "regulator", "manufacturer", "clinic_record", "other"] as const;

export const REPORT_SOURCES = ["manual", "ga4_export", "search_console_export", "google_ads_export", "clinic_records", "other"] as const;
export const REPORT_CHANNELS = ["all", "organic_search", "paid_search", "direct", "referral", "social", "email", "other"] as const;
export const REPORT_METRICS = [
  { key: "impressions", label: "Impressions", unit: "count" },
  { key: "clicks", label: "Clicks", unit: "count" },
  { key: "sessions", label: "Sessions", unit: "count" },
  { key: "unique_visitors", label: "Unique visitors", unit: "count" },
  { key: "page_views", label: "Page views", unit: "count" },
  { key: "post_views", label: "Post views", unit: "count" },
  { key: "contact_clicks", label: "Contact clicks", unit: "count" },
  { key: "form_submissions", label: "Form submissions", unit: "count" },
  { key: "enquiries", label: "Enquiries", unit: "count" },
  { key: "confirmed_appointments", label: "Confirmed appointments", unit: "count" },
  { key: "patients", label: "Patient count", unit: "count" },
  { key: "cost", label: "Cost", unit: "sgd" },
  { key: "conversions_reported", label: "Platform-reported conversions", unit: "count" },
] as const;
export type ReportMetricKey = (typeof REPORT_METRICS)[number]["key"];

export const REPORT_SECTION_KEYS = ["traffic", "engagement", "enquiries", "search", "campaigns"] as const;
export type ReportSectionKey = (typeof REPORT_SECTION_KEYS)[number];
export const REPORT_SECTIONS: Array<{ key: ReportSectionKey; label: string; source: string; metrics: ReportMetricKey[] }> = [
  { key: "traffic", label: "Traffic", source: "ga4_export", metrics: ["sessions", "unique_visitors", "page_views"] },
  { key: "engagement", label: "Engagement", source: "manual", metrics: ["page_views", "post_views", "contact_clicks"] },
  { key: "enquiries", label: "Enquiries and conversions", source: "clinic_records", metrics: ["enquiries", "form_submissions", "confirmed_appointments"] },
  { key: "search", label: "Search", source: "search_console_export", metrics: ["impressions", "clicks"] },
  { key: "campaigns", label: "Campaigns", source: "google_ads_export", metrics: ["clicks", "cost", "conversions_reported"] },
];

export const TIMELINE_EVENT_TYPES = [
  "task_created", "task_completed", "task_cancelled",
  "approval_submitted", "approval_decided", "approval_superseded",
  "seo_change_recorded", "seo_change_verified",
  "ads_audit_opened", "ads_audit_closed", "ads_change_recorded", "ads_change_verified",
  "issue_opened", "issue_resolved", "issue_verified", "issue_reopened",
  "medical_review_decided", "claim_wording_changed",
  "report_snapshot_added", "report_observation_added", "report_saved",
  "client_created", "client_archived",
  "article_published", "article_unpublished",
  "article_submitted", "article_approved", "article_returned",
] as const;
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

export const BLOG_STATUSES = ["draft", "in_review", "approved", "published", "archived"] as const;
export type BlogStatus = (typeof BLOG_STATUSES)[number];
export const BLOG_LAYOUT = "clinic-article-v1" as const;

export const RELATED_RECORD_TYPES = ["task", "approval", "seo_page", "seo_change", "ads_audit", "ads_finding", "ads_change", "issue", "evidence", "medical_claim", "medical_review", "report_snapshot", "website", "account_reference", "blog_article"] as const;
export type RelatedRecordType = (typeof RELATED_RECORD_TYPES)[number];
