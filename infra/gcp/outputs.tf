output "cluster_name" {
  description = "The cluster the up and down commands resize (#685)."
  value       = google_container_cluster.fleet.name
}

output "egress_address" {
  description = "The one address the fleet leaves through: Atlas's whole IP access list."
  value       = google_compute_address.egress.address
}

output "edge_address" {
  description = "The edge's public address, for DNS (#686)."
  value       = google_compute_address.edge.address
}

output "sql_instance" {
  description = "The Cloud SQL instance the up and down commands start and stop (#685)."
  value       = google_sql_database_instance.fleet.name
}

output "sql_private_address" {
  description = "Where config-service, the flow engine and Zitadel reach Postgres."
  value       = google_sql_database_instance.fleet.private_ip_address
}

output "atlas_connection_string" {
  description = "The SRV connection string, without credentials. Each service's user is #683's."
  value       = mongodbatlas_flex_cluster.fleet.connection_strings.standard_srv
}
