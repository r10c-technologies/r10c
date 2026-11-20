# Every secret the fleet holds, as a Secret Manager container (ADR 0083 §7,
# #683). The containers are declared here and their values never are: a value
# in this code would be a value in the state bucket, and a secret that lives
# in two places has two places to leak from.
#
# Each list says who supplies a value, and the up command (`tools/infra`)
# acts on it: it mints a missing `generated` value once and never rotates it,
# stores what Zitadel mints at its first init under `minted`, and refuses to
# start while a `provided` value nobody has added yet is missing. The lists
# are also tools/infra's, and its spec fails when the two disagree.
locals {
  # Random tokens, passwords and the token-signing key, minted by the up
  # command the first time it finds the container empty.
  generated_secrets = [
    "fleet-token",
    "jwt-private-key",
    "flow-crossing-token",
    "stock-crossing-token",
    "order-crossing-token",
    "payment-crossing-token",
    "fulfilment-crossing-token",
    "storefront-lookup-token",
    "redis-password",
    "sql-postgres-password",
    "sql-config-service-password",
    "sql-transaction-service-password",
    "sql-zitadel-password",
    "zitadel-masterkey",
    "zitadel-admin-password",
    # One Atlas database user per Mongo-backed service (ADR 0083 §4).
    "mongo-auth-service-password",
    "mongo-marketplace-service-password",
    "mongo-marketplace-admin-service-password",
    "mongo-order-service-password",
    "mongo-payment-service-password",
    "mongo-settlement-service-password",
    "mongo-stock-service-password",
    "mongo-sales-service-password",
    "mongo-fulfilment-service-password",
    "mongo-realtime-service-password",
  ]

  # Written by Zitadel at its first init, read back by the up command and kept
  # here so the next up hands the fleet the same ones.
  minted_secrets = [
    "zitadel-client-id",
    "zitadel-pat",
    "zitadel-login-pat",
    "zitadel-action-signing-key",
  ]

  # Accounts a person opens and pastes in, as the runbook says (#693).
  provided_secrets = [
    "grafana-cloud",
    "posthog",
    "smtp",
  ]
}

resource "google_secret_manager_secret" "fleet" {
  for_each = toset(concat(local.generated_secrets, local.minted_secrets, local.provided_secrets))

  secret_id = "${var.name}-${each.value}"

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.this]
}
