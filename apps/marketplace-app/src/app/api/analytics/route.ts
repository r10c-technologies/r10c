/**
 * Where the browser reads its product-analytics key (#684, ADR 0001): PostHog
 * when an environment has a project, nothing when it has none — the lab, and
 * any cluster whose `posthog` secret is `{}`.
 *
 * A route rather than a `NEXT_PUBLIC_*` value, because that would bake one
 * environment's key into an image every environment runs. The key is public by
 * design (PostHog's project keys are write-only and shipped to every browser);
 * it comes from the pod's environment (`POSTHOG_KEY`, `POSTHOG_HOST`), which
 * the up command fills from Secret Manager.
 */
export function GET() {
  const key = process.env['POSTHOG_KEY'] ?? '';
  const host = process.env['POSTHOG_HOST'] ?? '';
  return Response.json(key === '' ? {} : { key, host });
}
