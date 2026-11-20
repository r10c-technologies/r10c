# One Cloud SQL instance for every Postgres database the fleet has
# (ADR 0083 §3): config-service's `configuration` store in `postgres`, the
# flow engine's `workflow` journal, and Zitadel's own. The same three the lab's
# Postgres holds (infra/local/lib.sh, PG_DATABASES and the zitadel deployment).
#
# Stopping it is the down command's `activationPolicy: NEVER` (#685). A stopped
# instance keeps its disk, its backups and its address, and bills for them:
# part of the off-state floor, never a loss of data.

resource "google_sql_database_instance" "fleet" {
  name             = "${var.name}-fleet"
  region           = var.region
  database_version = "POSTGRES_16"

  settings {
    tier              = var.sql_tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 10
    disk_autoresize   = true

    location_preference {
      zone = var.zone
    }

    # A private address inside the fleet's VPC and no public one.
    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = google_compute_network.fleet.id
      enable_private_path_for_google_cloud_services = true
      ssl_mode                                      = "ENCRYPTED_ONLY"
    }

    # Declared, not scripted: a daily backup kept a week, and the write-ahead
    # log kept long enough to restore to any point inside it.
    backup_configuration {
      enabled                        = true
      start_time                     = "07:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }

    maintenance_window {
      day  = 7
      hour = 8
    }

    insights_config {
      query_insights_enabled = false
    }
  }

  deletion_protection = true

  lifecycle {
    # The up and down commands start and stop the instance (#685).
    ignore_changes = [settings[0].activation_policy]
  }

  depends_on = [google_service_networking_connection.private_services]
}

# `postgres` exists on every instance and is config-service's, as in the lab.
resource "google_sql_database" "fleet" {
  for_each = toset(["workflow", "zitadel"])

  name     = each.value
  instance = google_sql_database_instance.fleet.name

  # Never dropped by a `destroy` of this resource alone: a database holds
  # records the instance's backups would then be the only copy of.
  deletion_policy = "ABANDON"
}
