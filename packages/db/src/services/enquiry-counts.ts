/** Dashboard enquiry totals. Status and count only: no name, contact or message columns. */

export interface EnquiryCountWindow {
  from?: string | null;
  to?: string | null;
  clinicId?: string | null;
}

export function enquiryStatusCountQuery(
  scope: string[] | null,
  window?: EnquiryCountWindow,
  options: { productionOnly?: boolean } = {},
): { sql: string; params: unknown[] } {
  const productionOnly = options.productionOnly !== false;
  const from = window?.from || null;
  const to = window?.to || null;
  const sql = `select status, count(*)::int as count
     from enquiries
     where ($1::text[] is null or clinic_id = any($1))
       and ($2::boolean = false or is_synthetic = false)
       and ($3::date is null or (created_at at time zone 'Asia/Singapore')::date between $3::date and $4::date)
       and ($5::text is null or clinic_id = $5)
     group by status`;
  return {
    sql,
    params: [scope, productionOnly, from && to ? from : null, from && to ? to : null, window?.clinicId || null],
  };
}
