/**
 * Labels for the audience figures on the Analytics pages (Phase 2.3A).
 *
 * GA4 has more than one "users" measure and they are not interchangeable:
 *   Total users   `totalUsers`   users who logged any event. The headline Users figure, fetched for the exact period.
 *   Active users  `activeUsers`  distinct users who visited. Used for the per-page figures and for the new and returning split.
 * The headline stays Total users. The figures built from active users now say so. No number changes here: only the words.
 * (Google's definitions, read 13 Nov 2026: docs/analytics/03_FEATURE_MEASUREMENT_DICTIONARY.md, M02 and M03.)
 */

export type AudienceMeasure = "ga4" | undefined;

export interface AudienceLabels {
  users: { label: string; meaning: string };
  newUsers: { label: string; meaning: string };
  returningUsers: { label: string; meaning: string };
  conversionMeaning: string;
  pageTimeColumn: string;
}

const RECORDED: AudienceLabels = {
  users: { label: "Total users", meaning: "People who visited. This is not the same measure as a session." },
  newUsers: { label: "New visitors", meaning: "Visitors the export marks as new." },
  returningUsers: { label: "Returning visitors", meaning: "Visitors the export marks as returning." },
  conversionMeaning: "Stored enquiries divided by visitors.",
  pageTimeColumn: "Avg. time",
};

const GA4: AudienceLabels = {
  users: { label: "Total users", meaning: "Users Google Analytics recorded any event for, counted once over the whole period. Not the same measure as sessions or active users." },
  newUsers: { label: "New active users", meaning: "Active users Google Analytics classes as new. Active users is a different measure from Total users, so new and returning active users do not add up to Total users." },
  returningUsers: { label: "Returning active users", meaning: "Active users Google Analytics classes as returning. Active users is a different measure from Total users." },
  conversionMeaning: "Stored enquiries divided by Total users.",
  pageTimeColumn: "Avg. time per active user",
};

export function audienceLabels(measure: AudienceMeasure): AudienceLabels {
  return measure === "ga4" ? GA4 : RECORDED;
}
