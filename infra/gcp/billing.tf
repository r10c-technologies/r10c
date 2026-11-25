# What the fleet costs, read back rather than estimated (#705, ADR 0083 §5).
#
# Billing export writes every charge of the billing account into a BigQuery
# dataset, a row per service, SKU and hour; `pnpm run infra:cost` sums it per
# day (tools/infra). This declares the dataset and nothing that writes into
# it: turning the export on is one step in the console, which the Cloud
# Billing API does not offer (infra/gcp/README.md → "Reading the bill").
#
# The budget mails the billing account's admins as the month's spend crosses
# each threshold. It changes nothing on its own: a fleet left up is still the
# operator's to bring down.

resource "google_bigquery_dataset" "billing" {
  dataset_id  = "billing_export"
  location    = var.region
  description = "Cloud Billing's detailed export, read by `pnpm run infra:cost` (#705)."

  # The export's own tables: a destroy must not take the cost history along.
  delete_contents_on_destroy = false

  depends_on = [google_project_service.this]
}

# The Budgets API bills its quota to a project rather than to the caller's
# credentials, so this one resource names the project explicitly.
provider "google" {
  alias                 = "billing"
  project               = var.project_id
  billing_project       = var.project_id
  user_project_override = true
}

resource "google_billing_budget" "fleet" {
  provider        = google.billing
  billing_account = var.billing_account
  display_name    = "r10c fleet"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_usd)
    }
  }

  dynamic "threshold_rules" {
    for_each = [0.5, 0.9, 1.0]
    content {
      threshold_percent = threshold_rules.value
    }
  }

  depends_on = [google_project_service.this]
}
