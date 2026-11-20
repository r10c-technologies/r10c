# Where the fleet's images live (ADR 0083 §3): one Docker repository in the
# nodes' own region, so a pull never crosses one. The up command pushes each
# image tagged with the commit it was built from (#685); the node pool's
# service account already reads from it (gke.tf).
#
# A demo needs the image it is running and the one before it to roll back to,
# so older versions are deleted and storage stays inside the free 0.5 GB.
resource "google_artifact_registry_repository" "fleet" {
  location      = var.region
  repository_id = var.name
  format        = "DOCKER"
  description   = "The fleet's images, one per process (tools/docker)."

  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"

    most_recent_versions {
      keep_count = 2
    }
  }

  cleanup_policies {
    id     = "delete-older"
    action = "DELETE"

    condition {
      tag_state = "ANY"
    }
  }

  depends_on = [google_project_service.this]
}
