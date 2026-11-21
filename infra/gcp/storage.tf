# Where payment receipts live (ADR 0081 §8, ADR 0083 §3, #692): one private
# bucket, the cloud cell of the object-store port. It is kept when the fleet
# goes down (§5) — a receipt is a buyer's record, deleted on its own schedule
# by order-service's redaction sweep, never by a resize.
resource "google_storage_bucket" "evidence" {
  name     = "${var.project_id}-${var.name}-evidence"
  location = var.region

  # Every object is reached through order-service, under a credential check
  # (ADR 0081 §7): no ACLs, no public reader, no signed URL.
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = false
  }

  # The backstop behind the sweeps: an object the redaction sweep never
  # reached — a bug, a stopped fleet — is still gone within a year.
  lifecycle_rule {
    condition {
      age = 365
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.this]
}

data "google_project" "this" {
  project_id = var.project_id
}

# Workload Identity, by principal: order-service's own Kubernetes account
# (rendered per workload by tools/cluster) may read, write and delete objects
# in this bucket, and nothing else may. No Google service account, no key.
# `r10c` is tools/cluster's FLEET_NAMESPACE; tools/infra's spec holds the two
# to each other.
resource "google_storage_bucket_iam_member" "order_evidence" {
  bucket = google_storage_bucket.evidence.name
  role   = "roles/storage.objectUser"
  member = "principal://iam.googleapis.com/projects/${data.google_project.this.number}/locations/global/workloadIdentityPools/${var.project_id}.svc.id.goog/subject/ns/r10c/sa/order-service"
}
