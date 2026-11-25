/**
 * What the fleet cost, per day, read from the bill rather than estimated
 * (#705): `pnpm run infra:cost -- --target gcp [--days 7]`.
 *
 * Cloud Billing exports every charge into the dataset `infra/gcp/billing.tf`
 * declares, once the export is turned on in the console (the one step the
 * API does not offer). A day's cost is its charges net of credits — the free
 * tier's GKE credit arrives as one — summed per service, which is how the
 * off-state floor in docs/DEVELOPING.md is checked against the real bill: bring
 * the fleet down, wait a whole day, read that day.
 *
 * Atlas bills outside Google Cloud, so its line is not here; its Flex floor
 * is read off Atlas's own invoice.
 */
import type { Io } from './io.js';

export interface CostRow {
  readonly day: string;
  readonly service: string;
  /** USD, net of credits. */
  readonly net: number;
}

/** The standard export's tables are `gcp_billing_export_v1_<account>`. */
export const costQuery = (
  project: string,
  dataset: string,
  days: number,
): string => `SELECT
  FORMAT_DATE('%F', DATE(usage_start_time, 'UTC')) AS day,
  service.description AS service,
  ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(credit.amount) FROM UNNEST(credits) AS credit), 0)), 2) AS net
FROM \`${project}.${dataset}.gcp_billing_export_v1_*\`
WHERE DATE(usage_start_time, 'UTC') >= DATE_SUB(CURRENT_DATE('UTC'), INTERVAL ${String(days)} DAY)
GROUP BY day, service
ORDER BY day, service`;

/** `bq --format=json` answers every column as a string. */
export const costRows = (json: string): CostRow[] =>
  (
    JSON.parse(json.trim() === '' ? '[]' : json) as {
      day: string;
      service: string;
      net: string;
    }[]
  ).map(row => ({ day: row.day, service: row.service, net: Number(row.net) }));

const usd = (amount: number) => `$${amount.toFixed(2)}`;

/** One line per day: its total, then each service that cost a cent or more. */
export const costTable = (rows: readonly CostRow[]): string => {
  if (rows.length === 0)
    return 'no charges yet: the export fills within a day of being turned on';
  const days = [...new Set(rows.map(row => row.day))].sort();
  return days
    .map(day => {
      const lines = rows
        .filter(row => row.day === day && Math.abs(row.net) >= 0.01)
        .sort((a, b) => b.net - a.net);
      const total = lines.reduce((sum, row) => sum + row.net, 0);
      return `${day}  ${usd(total).padStart(8)}  ${lines
        .map(row => `${row.service} ${usd(row.net)}`)
        .join(' · ')}`;
    })
    .join('\n');
};

export const cost = (
  io: Io,
  outputs: { readonly project_id: string; readonly billing_dataset: string },
  days: number,
): void => {
  const answer = io.run(
    [
      'bq',
      'query',
      `--project_id=${outputs.project_id}`,
      '--use_legacy_sql=false',
      '--format=json',
      '--max_rows=10000',
      costQuery(outputs.project_id, outputs.billing_dataset, days),
    ],
    { capture: true },
  );
  io.log(costTable(costRows(answer.stdout)));
};
