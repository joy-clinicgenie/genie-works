import type { Queryable } from "../client";
import { classifyPath, classifySearchQuery, type WithheldReason } from "./privacy";

/**
 * Read-only scan of dimension values ALREADY STORED in published and superseded reports (Phase 2.3A).
 *
 * Until 13 Nov 2026 GA4 page paths and landing pages were stored without any check, and Search Console rows were
 * checked by a word list. Reports written then may hold an email address, a phone number, an access token or a
 * query string in a dimension value. This reports HOW MANY, by template and reason. It prints no value, changes no
 * row and deletes nothing. What to do about any it finds is a decision for the data owner: published reports are
 * append-only, and a correction would be a new generation, not an edit.
 */

const PATH_TEMPLATES = new Set(["ga4.landing", "ga4.pages", "gsc.pages"]);
const QUERY_TEMPLATES = new Set(["gsc.queries"]);

export interface StoredValueFinding {
  template: string;
  issue: WithheldReason | "query_string_in_value";
  distinctValues: number;
  rows: number;
}

export interface StoredValueScan {
  distinctValuesChecked: number;
  rowsChecked: number;
  findings: StoredValueFinding[];
}

export async function scanStoredValues(db: Queryable): Promise<StoredValueScan> {
  const { rows } = await db.query<{ template_key: string; dimension_key: string; rows: number }>(
    `select p.template_key, r.dimension_key, count(*)::int as rows
     from analytics_report_rows r join analytics_report_partitions p on p.id = r.partition_id
     where p.template_key = any($1::text[])
     group by 1, 2`,
    [[...PATH_TEMPLATES, ...QUERY_TEMPLATES]],
  );
  const tally = new Map<string, StoredValueFinding>();
  let rowsChecked = 0;
  const add = (template: string, issue: StoredValueFinding["issue"], count: number) => {
    const key = `${template}|${issue}`;
    const found = tally.get(key) ?? { template, issue, distinctValues: 0, rows: 0 };
    found.distinctValues += 1;
    found.rows += count;
    tally.set(key, found);
  };
  for (const row of rows) {
    rowsChecked += row.rows;
    if (PATH_TEMPLATES.has(row.template_key)) {
      // A stored value that still has a query string was written before query strings were removed.
      if (/[?#]/.test(row.dimension_key)) add(row.template_key, "query_string_in_value", row.rows);
      const decision = classifyPath(row.dimension_key);
      if (decision.value === null) add(row.template_key, decision.reason ?? "opaque_identifier", row.rows);
    } else {
      const decision = classifySearchQuery(row.dimension_key);
      if (decision.value === null) add(row.template_key, decision.reason ?? "opaque_identifier", row.rows);
    }
  }
  return { distinctValuesChecked: rows.length, rowsChecked, findings: [...tally.values()].sort((a, b) => a.template.localeCompare(b.template) || a.issue.localeCompare(b.issue)) };
}
