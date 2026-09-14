# @entifix/posthog

The PostHog adapter for the product-analytics `Tracker` port
(`@entifix/tooling/tracking`). One vendor, two SDKs, two entry points:

- **`@entifix/posthog`** — `makePostHogTracker(client)` over
  `posthog-node` (backend, server-side events).
- **`@entifix/posthog/browser`** — `makeBrowserTracker(posthog)`
  over `posthog-js` (browser events + sync feature-flag / A-B reads).

Both return a framework-free `Tracker`, provided per environment behind
`TrackerTag` (Effect `Context.Tag`) at a composition root — the same
adapter-per-environment shape as REST vs Mongo behind `EntityRepositoryTag`.

Unlike OpenTelemetry (which stays unwrapped), a real vendor SDK belongs behind an
adapter: swapping PostHog for another analytics backend touches only this package.
