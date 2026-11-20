# The APIs the fleet's resources need. The project itself, its billing account
# and the state bucket are the runbook's bootstrap step (#693): they must exist
# before the first `tofu init`.
locals {
  services = [
    "compute.googleapis.com",
    "container.googleapis.com",
    "sqladmin.googleapis.com",
    "servicenetworking.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
  ]
}

resource "google_project_service" "this" {
  for_each = toset(local.services)

  service = each.value
  # Turning an API off with `destroy` would take every resource on it along.
  disable_on_destroy = false
}
