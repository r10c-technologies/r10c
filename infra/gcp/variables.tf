variable "project_id" {
  description = "The GCP project the fleet lives in. Created by the runbook's bootstrap step (#693), with billing attached."
  type        = string
}

variable "region" {
  description = "Every regional resource, beside Atlas and the Grafana Cloud stack (ADR 0083 §1)."
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "Every zonal resource. One zone: the GKE free tier covers one zonal cluster, and a demo accepts a zone outage (ADR 0083 §1)."
  type        = string
  default     = "us-central1-a"
}

variable "name" {
  description = "The prefix every resource name starts with."
  type        = string
  default     = "r10c"
}

variable "control_plane_authorized_cidrs" {
  description = "Who may reach the cluster's API server. Empty means nobody from outside the VPC; the runbook adds the operator's address."
  type = list(object({
    cidr = string
    name = string
  }))
  default = []
}

variable "fleet_machine_type" {
  description = "The fleet pool's machine type, sized by #678 from the lab's measured requests."
  type        = string
  default     = "e2-standard-4"
}

variable "fleet_max_nodes" {
  description = "The fleet pool's autoscaling ceiling. Its floor is zero, which is what the down command sets (ADR 0083 §2)."
  type        = number
  default     = 3
}

variable "sql_tier" {
  description = "The Cloud SQL machine tier for the one Postgres instance (ADR 0083 §3)."
  type        = string
  default     = "db-g1-small"
}

variable "atlas_org_id" {
  description = "The Atlas organization the project is created in."
  type        = string
}
