# The cloud half of ADR 0083: OpenTofu declares every GCP and Atlas resource,
# and the manifests in infra/cluster/ declare what runs inside the cluster.
# Nothing here is applied before MVP-7 (#702); CI runs `fmt`, `validate` and
# tflint only, with the backend disabled and no credential.
terraform {
  required_version = ">= 1.10.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
    mongodbatlas = {
      source  = "mongodb/mongodbatlas"
      version = "~> 2.0"
    }
    grafana = {
      source  = "grafana/grafana"
      version = "~> 4.0"
    }
  }

  # The state bucket is created by the runbook's bootstrap step (#693), never
  # by the code that keeps its state in it. Its name is passed at init:
  #   tofu init -backend-config="bucket=<project>-tofu-state"
  backend "gcs" {
    prefix = "r10c/fleet"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

# Reads MONGODB_ATLAS_CLIENT_ID / MONGODB_ATLAS_CLIENT_SECRET (a service
# account of the Atlas organization) from the environment of whoever applies.
provider "mongodbatlas" {}

# Reads GRAFANA_URL and GRAFANA_AUTH (a service-account token of the Grafana
# Cloud stack) from the environment of whoever applies (grafana.tf).
provider "grafana" {}
