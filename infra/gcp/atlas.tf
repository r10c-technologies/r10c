# The fleet's Mongo stores on MongoDB Atlas, GCP `us-central1` (Atlas calls it
# `CENTRAL_US`), beside the cluster (ADR 0083 §3–§4).
#
# The tier is Flex. Measured against the lab on 2026-11-20: the platform's own
# databases are 13 holding about 75 collections, and each organization adds 4
# databases (`tenant_`, `stock_`, `sales_`, `fulfilment_`) holding up to about
# 15. Flex's limits, from Atlas's "Flex Cluster Limitations" page the same day:
# 100 databases and 500 collections in total, 5 GB of data, 500 operations a
# second, 500 connections, one daily snapshot. So the database limit binds
# first, at about 21 organizations: the three demo stores and the two lab
# organizations fit four times over. The free tier has the same database limit
# but 0.5 GB and 100 operations a second, which the tenant relays' walks over
# every `stock_*` and `fulfilment_*` database would spend, and its backups are
# a private preview.
#
# Multi-document transactions need a replica set, which every Atlas cluster is.
# Neither Flex nor free supports peering or a Private Endpoint, so the cluster
# reaches Atlas over TLS from the one NAT address, and that address is the
# project's whole IP access list. A dedicated tier is the trigger for a
# Private Endpoint (ADR 0083, Trigger).

resource "mongodbatlas_project" "fleet" {
  name   = "${var.name}-fleet"
  org_id = var.atlas_org_id
}

resource "mongodbatlas_flex_cluster" "fleet" {
  project_id = mongodbatlas_project.fleet.id
  name       = "${var.name}-fleet"

  provider_settings = {
    backing_provider_name = "GCP"
    region_name           = "CENTRAL_US"
  }

  termination_protection_enabled = true
}

resource "mongodbatlas_project_ip_access_list" "egress" {
  project_id = mongodbatlas_project.fleet.id
  ip_address = google_compute_address.egress.address
  comment    = "The fleet's Cloud NAT address, its only way out"
}

# The machines a person runs the live pass against the cluster from (#704),
# which reads and writes the stores directly as the `operator` user. Empty by
# default: an operator address is added for a pass and removed after it.
resource "mongodbatlas_project_ip_access_list" "operator" {
  for_each = toset(var.operator_cidrs)

  project_id = mongodbatlas_project.fleet.id
  cidr_block = each.value
  comment    = "An operator's machine, for the live pass (#704)"
}
