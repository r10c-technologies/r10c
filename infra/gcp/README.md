# infra/gcp

The cloud half of [ADR 0083](../../docs/adr/0083-the-fleet-runs-on-gcp-on-demand.md):
every GCP and MongoDB Atlas resource the fleet needs, declared in OpenTofu.
What runs **inside** the cluster is [`infra/cluster/`](../cluster/README.md).

**Nothing here is applied.** It is written in MVP-5 and applied in MVP-7
(#702). CI runs `tofu fmt -check`, `tofu validate` with the backend disabled
and tflint on every change, and no CI job holds a GCP or Atlas credential.

| File          | Declares                                                                                                           | Issue     |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | --------- |
| `versions.tf` | OpenTofu and provider pins, the `gcs` backend (bucket passed at `init`)                                            | #678      |
| `project.tf`  | the project's APIs                                                                                                 | #678      |
| `network.tf`  | the VPC, Cloud NAT on one reserved address, the edge's address, private services access                            | #678      |
| `gke.tf`      | the zonal Standard cluster and its fleet pool, scaled to zero when down                                            | #678      |
| `sql.tf`      | one Cloud SQL Postgres instance: `postgres` (configuration), `workflow`, `zitadel`; backups, PITR                  | #679      |
| `atlas.tf`    | the Atlas project, a Flex cluster in GCP `us-central1`, the access list: the NAT address, and any `operator_cidrs` | #680 #704 |
| `secrets.tf`  | one Secret Manager container per secret, by who supplies it; never a value                                         | #683      |
| `registry.tf` | the Artifact Registry repository the up command pushes to, keeping two versions per image                          | #685      |
| `storage.tf`  | the private receipts bucket, and order-service's Workload Identity grant on it                                     | #692      |
| `docs.tf`     | the two documentation sites on Cloud Run (r10c's behind IAP), their images, the deploy federation                  | #686      |
| `grafana.tf`  | the flow's alerts, dashboard, contact point and policy on Grafana Cloud, read from the lab's files                 | #706      |
| `billing.tf`  | the billing export's BigQuery dataset, which `infra:cost` reads, and a monthly budget                              | #705      |
| `outputs.tf`  | what the up and down commands and the manifests read                                                               | —         |

## Validate locally

```sh
tofu -chdir=infra/gcp init -backend=false
tofu -chdir=infra/gcp fmt -check -recursive
tofu -chdir=infra/gcp validate
docker run --rm -v "$PWD":/data --entrypoint sh ghcr.io/terraform-linters/tflint:v0.60.0 \
  -c 'tflint --chdir=infra/gcp --init && tflint --chdir=infra/gcp'
```

`init -backend=false` downloads the providers and touches no bucket. The lock
file is committed; CI initializes with `-lockfile=readonly`, so a provider
upgrade is a reviewed change to `.terraform.lock.hcl`.

## What lives outside this code

- **The project, its billing account and the state bucket.** They must exist
  before the first `tofu init`; the runbook's bootstrap step creates them
  (#693).
- **The size of the fleet pool and Cloud SQL's activation policy.** The up and
  down commands own them (#685), so both are in `ignore_changes`, as is the
  pool's autoscaling.
- **The documentation sites' real hosts and readers.** `docs_hosts` and
  `docs_readers` default to placeholders under `.example`; the real values
  arrive at MVP-7 in a `tfvars` kept out of git. Each host then needs the DNS
  records `tofu output docs_dns_records` names. Each repository then needs three
  Actions variables (`DOCS_GCP_PROJECT`, `DOCS_GCP_WIF_PROVIDER`,
  `DOCS_GCP_DEPLOY_SA`) before its `docs_deploy.yml` deploys anything.
- **Secret values and database users.** Secret Manager holds the values; the
  up command (`tools/infra`) mints the generated ones, sets the Cloud SQL and
  Atlas users from them, and writes them into the cluster as Kubernetes
  Secrets. A value in this code would be a value in the state bucket.

## The Atlas tier, measured

Flex: 100 databases and 500 collections in total, 5 GB, 500 operations a
second, 500 connections, one daily snapshot, no peering and no Private Endpoint
(Atlas's "Flex Cluster Limitations", read 2026-11-20). The lab on the same day
held 13 platform databases with about 75 collections, and each organization
adds 4 databases with up to about 15. The database limit binds first, at about
21 organizations. Moving past it, or to a Private Endpoint, means a dedicated
tier, which is ADR 0083's trigger for a new record.
