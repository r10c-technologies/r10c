# One zonal GKE Standard cluster (ADR 0083 §2). The control plane is covered by
# GKE's free tier, so the cluster's cost is its nodes, and the down command
# sets the fleet pool to zero. The cluster is never deleted: its identity, its
# service accounts and its persistent volumes survive a cycle.

resource "google_service_account" "nodes" {
  account_id   = "${var.name}-nodes"
  display_name = "r10c fleet nodes"
}

# What a node needs and nothing else: write its logs and metrics (the free
# infra floor, ADR 0001) and pull the fleet's images.
resource "google_project_iam_member" "nodes" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/monitoring.viewer",
    "roles/artifactregistry.reader",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.nodes.email}"
}

resource "google_container_cluster" "fleet" {
  name     = "${var.name}-fleet"
  location = var.zone

  network    = google_compute_network.fleet.id
  subnetwork = google_compute_subnetwork.fleet.id

  # The default pool cannot scale to zero on its own terms; the fleet pool
  # below replaces it.
  remove_default_node_pool = true
  initial_node_count       = 1

  release_channel {
    channel = "REGULAR"
  }

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  master_authorized_networks_config {
    dynamic "cidr_blocks" {
      for_each = var.control_plane_authorized_cidrs
      content {
        cidr_block   = cidr_blocks.value.cidr
        display_name = cidr_blocks.value.name
      }
    }
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  # Cloud Logging and Monitoring for system components only: the free floor.
  # The fleet's own telemetry goes through the Collector to Grafana Cloud.
  logging_config {
    enable_components = ["SYSTEM_COMPONENTS"]
  }

  monitoring_config {
    enable_components = ["SYSTEM_COMPONENTS"]
    managed_prometheus {
      enabled = false
    }
  }

  addons_config {
    gce_persistent_disk_csi_driver_config {
      enabled = true
    }
  }

  deletion_protection = true

  depends_on = [google_project_service.this]
}

resource "google_container_node_pool" "fleet" {
  name     = "fleet"
  cluster  = google_container_cluster.fleet.id
  location = var.zone

  # Zero when the fleet is down. The up and down commands (#685) resize the
  # pool; its size is theirs, not this file's.
  initial_node_count = 0

  autoscaling {
    min_node_count = 0
    max_node_count = var.fleet_max_nodes
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  node_config {
    machine_type    = var.fleet_machine_type
    disk_type       = "pd-balanced"
    disk_size_gb    = 50
    service_account = google_service_account.nodes.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]

    # Regular VMs, not Spot: a Spot VM can be reclaimed in the middle of a demo
    # (ADR 0083 §2).
    spot = false

    workload_metadata_config {
      mode = "GKE_METADATA"
    }

    shielded_instance_config {
      enable_secure_boot = true
    }
  }

  # The down command turns autoscaling off before it resizes to zero, or a
  # pending system pod would bring a node straight back; the up command turns
  # it on again. Both are theirs, like the size.
  lifecycle {
    ignore_changes = [initial_node_count, node_count, autoscaling]
  }
}
