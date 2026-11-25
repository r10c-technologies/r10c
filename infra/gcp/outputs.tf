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

output "project_id" {
  description = "The project every gcloud call in the up and down commands names."
  value       = var.project_id
}

output "region" {
  description = "Where Cloud SQL, the registry and the secrets live."
  value       = var.region
}

output "zone" {
  description = "Where the cluster and its pool live."
  value       = var.zone
}

output "node_pool" {
  description = "The pool the up and down commands resize."
  value       = google_container_node_pool.fleet.name
}

output "registry" {
  description = "Where the up command pushes the fleet's images."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.fleet.repository_id}"
}

output "domain" {
  description = "The public domain the manifests' placeholder is replaced with."
  value       = var.domain
}

output "atlas_project_id" {
  description = "The Atlas project the up command creates each service's database user in."
  value       = mongodbatlas_project.fleet.id
}

output "secret_prefix" {
  description = "Every secret's id starts with it."
  value       = "${var.name}-"
}

output "node_pool_max" {
  description = "The autoscaling ceiling the up command turns autoscaling back on with."
  value       = var.fleet_max_nodes
}

output "evidence_bucket" {
  description = "The bucket order-service keeps payment receipts in (#692)."
  value       = google_storage_bucket.evidence.name
}

output "docs_workload_identity_provider" {
  description = "Each repository's `DOCS_GCP_WIF_PROVIDER` variable."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "docs_deploy_service_accounts" {
  description = "Each repository's `DOCS_GCP_DEPLOY_SA` variable, by site."
  value       = { for key, account in google_service_account.docs_deploy : key => account.email }
}

output "docs_dns_records" {
  description = "The records each documentation host needs, as Cloud Run's domain mapping states them."
  value       = { for key, mapping in google_cloud_run_domain_mapping.docs : key => mapping.status[0].resource_records }
}

output "billing_dataset" {
  description = "The dataset Cloud Billing exports into, which `pnpm run infra:cost` reads (#705)."
  value       = google_bigquery_dataset.billing.dataset_id
}
