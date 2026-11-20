# One VPC, one subnet with the cluster's secondary ranges, and one way out.
#
# Nodes are private, so everything leaves through Cloud NAT on one reserved
# address. That address is Atlas's whole IP access list (ADR 0083 §4): the free
# and Flex tiers support neither peering nor a Private Endpoint, and without
# NAT every node's ephemeral address would have to be listed.

resource "google_compute_network" "fleet" {
  name                    = "${var.name}-fleet"
  auto_create_subnetworks = false

  depends_on = [google_project_service.this]
}

resource "google_compute_subnetwork" "fleet" {
  name                     = "${var.name}-fleet"
  network                  = google_compute_network.fleet.id
  region                   = var.region
  ip_cidr_range            = "10.10.0.0/20"
  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.20.0.0/16"
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.30.0.0/20"
  }
}

resource "google_compute_router" "fleet" {
  name    = "${var.name}-fleet"
  network = google_compute_network.fleet.id
  region  = var.region
}

# Kept while the fleet is down, so Atlas's access list never changes. An
# unused reserved address bills by the hour: part of the off-state floor.
resource "google_compute_address" "egress" {
  name   = "${var.name}-egress"
  region = var.region
}

resource "google_compute_router_nat" "fleet" {
  name                               = "${var.name}-fleet"
  router                             = google_compute_router.fleet.name
  region                             = var.region
  nat_ip_allocate_option             = "MANUAL_ONLY"
  nat_ips                            = [google_compute_address.egress.self_link]
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

# The edge's public address (ADR 0072), kept while the fleet is down so DNS
# never changes. The down command removes the load balancer, not the address.
resource "google_compute_address" "edge" {
  name   = "${var.name}-edge"
  region = var.region
}

# Private services access: Cloud SQL gets a private address inside this VPC
# and no public one (#679).
resource "google_compute_global_address" "private_services" {
  name          = "${var.name}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.fleet.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.fleet.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}
