# 83. The fleet runs on GCP on demand, and the demo environment is still a lab

- Status: Proposed
- Date: 2026-11-20
- Area: platform
- Revised: 2026-11-20 — #683 and #685 built §4, §5 and the secrets row: a secret reaches a pod through the up command, each Atlas user may read and write any database, and the edge's certificate comes from cert-manager.
- Revised: 2026-11-20 — #692 built the receipts and mail rows: a private bucket in `infra/gcp/storage.tf`, granted by Workload Identity to order-service's own Kubernetes account (every workload now runs as its own), and the SMTP provider's account and STARTTLS rule carried into order-service's rows and re-stated to Zitadel on every seed.
- Read when: declaring a cloud resource, choosing what runs managed and what runs in the cluster, writing the up or down command, or wondering whether "nothing runs in production" still holds once a cluster exists — one region, one zonal cluster scaled to zero, and the demo environment is reset like the lab

## Context

[ADR 0001](0001-observability-and-tooling.md) settled the cloud in July: Google
Cloud with GKE, MongoDB Atlas in the same region, Cloud SQL for Zitadel and
config-service, Redis, RabbitMQ and Zitadel in the cluster, and OTLP through a
Collector to Grafana Cloud. It settled nothing else. There is no region, no
cluster shape, no rule for when the fleet runs, and no code that declares any
of it. The repository holds:

- `infra/local/` — the minikube lab. Every datastore is a single-replica
  `Deployment` on a `hostPath` volume, applied by `apply.sh` and walked by the
  health ladder.
- `infra/cluster/` — manifests for a cluster that does not exist: the Envoy
  Gateway resources generated from `tools/edge/src/routes.ts`
  ([ADR 0072](0072-the-realtime-slice-flow-status-and-the-edge.md)) and
  realtime-service's `Deployment`. CI checks them with `kubeconform -strict`,
  and nothing applies them.
- No Dockerfile, no image, no infrastructure-as-code.

The plan for January ends in a demo for real merchants in the second week of
January 2027 (MVP-8). The fleet has to run somewhere they can reach, on a
budget that one person pays, and it is used for hours a week, not all month. A
cluster that runs around the clock costs the same whether anyone opens the
storefront or not.

`CLAUDE.md` says **nothing runs in production**. Every environment is a local
fleet recreated on demand, and the codebase is designed without backward
compatibility because of it: no dual-read windows, no migration shims, change
the seed and reset. A cluster with a public address is the first environment
that is not a laptop. Whether the rule survives it has to be decided before the
first manifest is written, because the answer decides whether MVP-5 writes
migration jobs.

Atlas also constrains the network more than ADR 0001 says. ADR 0001 names VPC
peering or a Private Endpoint between the cluster and Atlas. Both exist only on
dedicated Atlas clusters. The free and Flex tiers, which fit a demo with three
stores, reach their clients over the public endpoint behind an IP access list.

## Decision

### 1. One region, `us-central1`, and one zone in it

Every GCP resource lives in `us-central1`, and every zonal resource in one zone
of it, chosen by #678. The Atlas cluster is in the same GCP region, and so is
the Grafana Cloud stack (`prod-us-central-0` is Grafana's general-use stack on
GCP `us-central1`).

- **Why this region.** It has GCP's lowest price tier, Grafana Cloud runs a
  general-use stack there, and Atlas offers GCP clusters there. Putting all
  three in one region makes telemetry and database traffic in-region.
- **Why not `northamerica-south1` (Querétaro).** It is closer to Guatemala, but
  it is priced higher, Grafana has no stack there, and Atlas free and Flex
  availability there is unverified. The latency it saves is tens of
  milliseconds on a page that already renders on the server.
- **One zone, no high availability.** A zonal cluster is the one GKE's free
  tier covers (below). A zone outage during a demo is a risk accepted for a
  demo. Regional resources are a decision for the first real tenant (§6).

### 2. One zonal GKE Standard cluster, scaled to zero when off

- **Zonal Standard, not Autopilot.** GKE charges $0.10 per cluster per hour for
  management. The free tier gives $74.40 per billing account per month, which
  covers one zonal or Autopilot cluster. So the control plane costs nothing
  either way. Standard is chosen because its cost is the node count, which the
  down command can set to zero. A DaemonSet such as the Collector's agent is
  then billed as part of a node, not per pod.
- **Node pools have autoscaling with a minimum of zero.** "Up" sets each pool's
  size and "down" sets it to zero. The cluster itself is never deleted, so its
  identity, its service accounts and its persistent volumes survive a cycle.
- **Nodes are regular VMs, not Spot.** A Spot VM can be reclaimed in the middle
  of a demo. Spot is a cost lever to pull later, per pool, not the default.
- **Size from measurement, not from a guess.** #678 sizes the pool from the
  lab's measured requests: twelve services, the second workflow runner, two Next
  apps, the edge, RabbitMQ, Redis, Zitadel, its login container, and the
  Collector's agent and gateway.

### 3. What is managed and what runs in the cluster

| Component                                        | Where                                        | Why                                                                                                                                                                                                                                                        | When the fleet is down                                                     |
| ------------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Postgres: `configuration`, `workflow`, Zitadel's | **Cloud SQL**, one instance, three databases | three stores and a foreign system on one small instance; backups and point-in-time recovery are declared, not scripted                                                                                                                                     | stopped (`activationPolicy: NEVER`)                                        |
| Mongo: every Mongo store, four databases per org | **MongoDB Atlas**, GCP `us-central1`         | transactions need a replica set, and a per-organization database is cheap there and a chore to operate in a pod                                                                                                                                            | left running: a Flex cluster bills a flat monthly rate whether used or not |
| RabbitMQ                                         | cluster, through its operator                | a managed broker has no stop; quorum queues and `x-delivery-limit` ([ADR 0030](0030-failure-retry-and-quarantine-on-the-bus.md)) need a real broker                                                                                                        | pods gone, volume kept                                                     |
| Redis                                            | cluster, AOF on a volume                     | Memorystore bills by the hour and cannot stop; Redis holds sessions and OIDC state, not a cache                                                                                                                                                            | pods gone, volume kept                                                     |
| Zitadel and its login container                  | cluster, database in Cloud SQL               | the login is a second container ([ADR 0018](0018-the-hosted-login-is-a-second-container.md)); Zitadel itself is stateless                                                                                                                                  | pods gone                                                                  |
| OTel Collector, agent and gateway                | cluster                                      | [ADR 0001](0001-observability-and-tooling.md)'s topology                                                                                                                                                                                                   | pods gone                                                                  |
| Edge                                             | cluster, Envoy Gateway                       | rendered from the same route table as the local Envoy ([ADR 0072](0072-the-realtime-slice-flow-status-and-the-edge.md)); HTTPS on 443 for `shop.`, `office.` and `id.` under the domain, one Let's Encrypt certificate issued by cert-manager over HTTP-01 | load balancer removed, static IP kept                                      |
| Images                                           | Artifact Registry, `us-central1`             | same region as the nodes that pull them                                                                                                                                                                                                                    | kept                                                                       |
| Receipts and media                               | Cloud Storage bucket                         | the port [ADR 0081](0081-an-order-waits-for-a-payment-the-seller-confirms-and-a-receipt-is-a-file.md) names, with a cloud adapter (#692)                                                                                                                   | kept                                                                       |
| Mail                                             | an SMTP provider on port 587                 | GCP blocks outbound 25; the provider is configuration rows, so changing it is a seed edit (#692)                                                                                                                                                           | external                                                                   |
| Secrets                                          | Secret Manager                               | no secret in the repository; the up command (`tools/infra`) mints what is missing, reads the rest and writes them as Kubernetes Secrets, so nothing in the cluster holds a Secret Manager credential                                                       | kept                                                                       |
| Logs, metrics, traces                            | Grafana Cloud, `prod-us-central-0`           | ADR 0001                                                                                                                                                                                                                                                   | external                                                                   |
| Product analytics                                | PostHog                                      | ADR 0001                                                                                                                                                                                                                                                   | external                                                                   |

The documentation sites are not on GCP. They are static exports on S3 and
CloudFront, as myself-app is (#686, plan Q23).

### 4. Atlas over an IP access list until the tier is dedicated

This corrects ADR 0001. Peering and Private Endpoints exist only on dedicated
clusters, so on the free or Flex tier:

- The cluster leaves through **Cloud NAT with one reserved address**, and
  Atlas's IP access list holds that address and nothing else. Without NAT,
  every node's ephemeral address would have to be listed, and a scale-up would
  break the list.
- Connections use TLS and a database user per service, from Secret Manager.
  Flex has no role scoped to a prefix of database names, and the tenant plane
  is a database per organization, so each user holds `readWriteAnyDatabase`:
  a user per service buys attribution and a rotation that touches one service,
  not isolation between them. A dedicated tier's custom roles are where that
  changes.
- The tier is #680's choice. It must hold four databases per organization for
  three stores plus the platform's, support multi-document transactions, and
  have its database and collection limits verified in writing before the
  choice is merged.

The move to a Private Endpoint is recorded as this record's own trigger (below)
and not built now.

### 5. Up and down are one command each, and down never deletes data

#685 writes the commands. This record fixes what they may touch.

- **Down removes what bills by the hour and holds no data.** It scales the node
  pools to zero, stops Cloud SQL, and removes the edge's load balancer. It
  keeps every persistent disk, the Cloud SQL storage and backups, the Atlas
  cluster, the bucket, the registry, the secrets, the reserved addresses and
  the DNS records.
- **Up is the reverse, and it is idempotent.** It starts Cloud SQL, sizes the
  pools, applies the cluster manifests and waits on the same readiness probes
  the lab's ladder walks.
- **Persistent volumes use `reclaimPolicy: Retain`.** A deleted claim must
  not take a broker's or Redis's disk with it.
- The off-state cost is estimated per component by #685 and measured by #705.
  Cloud SQL still bills storage and its IP while stopped, and a reserved
  address bills while unused. Those are the expected floor, not a leak.

### 6. The demo environment is a lab, and "nothing runs in production" stands

The rule stands until the first real tenant's data is written to any store.
Until then:

- **The GCP environment is a lab with a public address.** Its data is seed data
  and demo data, and nothing in it is anyone's record of a real sale.
- **It is reset the way the local lab is.** A change of shape is a reseed of
  the cloud environment, the same hard cut as `<app>:dev:reset`. MVP-5 writes
  no migration job, no dual-read path and no compatibility flag.
- **A merchant may type real data into the demo.** That data is disposable and
  the demo says so. A reset may erase it.
- **The rule ends with a record, not a drift.** The first real tenant is the
  trigger for a new ADR that decides how a shape change reaches data that cannot
  be reset. Until that record exists, the codebase keeps designing without
  backward compatibility.

`CLAUDE.md`'s rule is reworded to name the cloud environment, so nobody reads a
running cluster as a production environment.

### 7. Cloud resources are OpenTofu, cluster contents are manifests, and nothing is applied before MVP-7

- **OpenTofu owns the cloud**, in `infra/gcp/`: the project's APIs, the
  network and Cloud NAT, the cluster and its pools, Cloud SQL, the Atlas
  project and cluster (the `mongodbatlas` provider), the bucket, the registry,
  the secrets' containers (never their values), and the reserved addresses.
  OpenTofu is used rather than Terraform because its licence is open and it
  reads the same providers (plan Q30).
- **Manifests own the cluster's contents**, in `infra/cluster/`, applied with
  `kubectl apply -k`. Third-party operators and charts are rendered once into
  pinned manifests and committed, so `kubeconform -strict` checks them like
  everything else and an upgrade shows up as a diff.
- **The state backend is a Cloud Storage bucket created by the runbook's
  bootstrap step** (#693), not by the code that stores its state in it.
- **CI validates and never applies.** `tofu fmt -check`, `tofu validate` with
  the backend disabled, and a linter run on every change to `infra/gcp/`, beside
  the existing `kubeconform` job. No CI job holds a GCP credential before
  MVP-7.
- **Nothing is applied before MVP-7 (#702).** MVP-5's close-out (#696) checks
  that no resource was created.

### 8. The repository stays public through the demo

The infrastructure code holds no secret, no commercial term and no named
vendor's conditions ([ADR 0025](0025-where-planning-and-business-knowledge-live.md)).
A project id, a region and a domain are not secrets. Going private (plan Q28)
is decided after the Actions minutes Change Validation uses are measured, and
it changes nothing here.

## Consequences

- The fleet costs something only while it is up, apart from a floor: Cloud SQL
  storage, persistent disks, reserved addresses and Cloud NAT's address. The
  cost while up is the node pool's machines.
- An "up" takes minutes. A demo starts with the up command and a smoke test,
  never with a click on a cold link.
- One zone, one Cloud SQL instance and one RabbitMQ replica are single points of
  failure, accepted for a demo and listed in the runbook.
- The Atlas cluster is reachable from the internet behind an access list of one
  address. That is weaker than a Private Endpoint and stronger than an open
  list. It is the residual this record accepts.
- ADR 0001's network sentence was wrong for the tiers a demo uses, and is
  corrected in place.
- MVP-5's issues each implement one row or section of this record: #678 §1–§2,
  #679 and #680 §3–§4, #681 the cluster rows of §3, #682 the images, #683 the
  secrets, #684 the external rows, #685 §5, #686 the documentation sites, #692
  the bucket and mail, #693 §7's bootstrap.

## Trigger

The record moves to Accepted when the infrastructure is applied from this code
(#702) and one down-and-up cycle keeps every record (#705).

Two later events each require a new record:

- **The first real tenant's data is written.** It ends §6.
- **Atlas moves to a dedicated tier.** The Private Endpoint replaces §4's
  access list, and the NAT address stops being a database credential.
