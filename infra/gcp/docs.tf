# The two documentation sites (#686, ADR 0083 §3): r10c's and entifix's, each a
# static export plus Storybook served by one dependency-free Node script, on
# Cloud Run. Not in the cluster on purpose: the cluster scales to zero between
# demos, and the docs are read when it is down. Cloud Run scales to zero too,
# and a site with no traffic costs nothing but its stored image.
#
# r10c's site is restricted to `var.docs_readers` by IAP on the service itself,
# with no load balancer, so there is no forwarding rule to pay for; entifix's is
# public. Each repository deploys only its own site, through Workload Identity
# Federation: a GitHub Actions run on `main` exchanges its OIDC token for its
# site's deploy account, and no key exists anywhere.
#
# Every value that names something real — the hosts, the readers — is a
# variable whose default is a placeholder (`.example`, RFC 2606). The real
# values arrive at MVP-7 (#702) in a `tfvars` file kept out of git.
locals {
  docs_sites = {
    r10c = {
      repository = var.docs_repositories.r10c
      host       = var.docs_hosts.r10c
      public     = false
    }
    entifix = {
      repository = var.docs_repositories.entifix
      host       = var.docs_hosts.entifix
      public     = true
    }
  }
}

# The images, two versions each — the one serving and the one before it.
resource "google_artifact_registry_repository" "docs" {
  location      = var.region
  repository_id = "docs"
  format        = "DOCKER"
  description   = "The documentation sites' images, one per site."

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

# What each site runs as: nothing to reach, so no role at all.
resource "google_service_account" "docs_runtime" {
  for_each = local.docs_sites

  account_id   = "${each.key}-docs-run"
  display_name = "${each.key} documentation site (runtime)"
}

resource "google_cloud_run_v2_service" "docs" {
  for_each = local.docs_sites

  name     = "${each.key}-docs"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  # IAP on the service itself, without a load balancer (r10c's only).
  iap_enabled = !each.value.public

  deletion_protection = false

  template {
    service_account = google_service_account.docs_runtime[each.key].email

    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    containers {
      # A placeholder until the site's workflow deploys its own image; the
      # workflow owns the image from then on (see `ignore_changes`).
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      ports {
        container_port = 8080
      }

      resources {
        cpu_idle = true
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
      }

      startup_probe {
        http_get {
          path = "/health"
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [google_project_service.this]
}

# entifix's site answers anyone.
resource "google_cloud_run_v2_service_iam_member" "docs_public" {
  for_each = { for key, site in local.docs_sites : key => site if site.public }

  name     = google_cloud_run_v2_service.docs[each.key].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# r10c's site answers IAP alone, and IAP answers only its readers.
resource "google_cloud_run_v2_service_iam_member" "docs_iap_invoker" {
  for_each = { for key, site in local.docs_sites : key => site if !site.public }

  name     = google_cloud_run_v2_service.docs[each.key].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-iap.iam.gserviceaccount.com"
}

resource "google_iap_web_cloud_run_service_iam_member" "docs_readers" {
  for_each = {
    for pair in setproduct(
      [for key, site in local.docs_sites : key if !site.public],
      var.docs_readers,
    ) : "${pair[0]}/${pair[1]}" => { site = pair[0], member = pair[1] }
  }

  location               = var.region
  cloud_run_service_name = google_cloud_run_v2_service.docs[each.value.site].name
  role                   = "roles/iap.httpsResourceAccessor"
  member                 = each.value.member
}

# Each site at its own host, with a certificate Google manages.
resource "google_cloud_run_domain_mapping" "docs" {
  for_each = local.docs_sites

  name     = each.value.host
  location = var.region

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.docs[each.key].name
  }
}

# GitHub Actions, trusted on `main` of the two repositories only.
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  description               = "The documentation sites' deploy workflows."

  depends_on = [google_project_service.this]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  attribute_condition = "assertion.ref == 'refs/heads/main' && assertion.repository in [${join(", ", [for site in local.docs_sites : "'${site.repository}'"])}]"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# One deploy account per site, so a repository can roll only its own.
resource "google_service_account" "docs_deploy" {
  for_each = local.docs_sites

  account_id   = "${each.key}-docs-deploy"
  display_name = "${each.key} documentation site (deploy)"
}

resource "google_service_account_iam_member" "docs_deploy_federation" {
  for_each = local.docs_sites

  service_account_id = google_service_account.docs_deploy[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${each.value.repository}"
}

resource "google_cloud_run_v2_service_iam_member" "docs_deploy" {
  for_each = local.docs_sites

  name     = google_cloud_run_v2_service.docs[each.key].name
  location = var.region
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.docs_deploy[each.key].email}"
}

# A deploy runs the new revision as the site's runtime account.
resource "google_service_account_iam_member" "docs_deploy_acts_as_runtime" {
  for_each = local.docs_sites

  service_account_id = google_service_account.docs_runtime[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.docs_deploy[each.key].email}"
}

resource "google_artifact_registry_repository_iam_member" "docs_deploy" {
  for_each = local.docs_sites

  location   = var.region
  repository = google_artifact_registry_repository.docs.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.docs_deploy[each.key].email}"
}
