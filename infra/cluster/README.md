# infra/cluster

Manifests for a cluster that does not exist yet. **Nothing here is applied** —
every environment is the local lab in [`infra/local/`](../local/README.md) — and
CI validates every file against its schema (`kubeconform -strict`) so the shape
is right on the day it first is.

| Directory           | What                                                                                          | Written by                                    |
| ------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `edge/`             | Envoy Gateway: the `Gateway`, one `HTTPRoute` per origin, and the client and backend policies | **generated** from `tools/edge/src/routes.ts` |
| `realtime-service/` | the realtime slice's `Deployment` and `Service`, with its drain                               | hand-written                                  |

`edge/` is rendered from the same route table as the local Envoy
(`tools/edge/envoy.yaml`) — [ADR 0072](../../docs/adr/0072-the-realtime-slice-flow-status-and-the-edge.md).
Change the table and run `pnpm nx run @r10c/edge:generate`; a hand-edit fails
`@r10c/docs-check`.
