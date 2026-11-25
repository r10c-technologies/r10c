# The flow's alerts and its dashboard on the Grafana Cloud stack (#706,
# ADR 0083 §3), from the very files the lab provisions: one source, two
# stacks. Kustomize cannot load a file outside its own directory, so the
# source stays beside the lab's Grafana and this reads it from there.
#
# The lab's Prometheus is uid `prometheus`; the cloud stack names its own,
# so every `prometheus` in the source is rewritten to
# `var.grafana_prometheus_uid` and nothing else changes. `@r10c/docs-check`
# holds the source to that: one data source uid besides `__expr__`, every
# expression naming a metric the fleet declares.
#
# Nothing here is applied before MVP-7 (#702). The provider reads
# GRAFANA_URL and GRAFANA_AUTH (a stack service-account token) from whoever
# applies, as the Atlas provider reads its own — no token in state or code.

locals {
  grafana_source = "${path.module}/../local/otel-lgtm/dashboards"
  alert_groups   = yamldecode(file("${local.grafana_source}/r10c-alerts.yaml")).groups

  # A data source uid as the cloud stack names it.
  cloud_uid = { prometheus = var.grafana_prometheus_uid }
}

resource "grafana_folder" "r10c" {
  title = "r10c"
}

resource "grafana_rule_group" "flow" {
  for_each = { for group in local.alert_groups : group.name => group }

  name       = each.value.name
  folder_uid = grafana_folder.r10c.uid
  # `1m` in the source, the only form it uses.
  interval_seconds = tonumber(trimsuffix(each.value.interval, "m")) * 60

  dynamic "rule" {
    for_each = each.value.rules
    content {
      name           = rule.value.title
      condition      = rule.value.condition
      for            = rule.value.for
      no_data_state  = rule.value.noDataState
      exec_err_state = rule.value.execErrState
      labels         = rule.value.labels
      annotations    = rule.value.annotations

      dynamic "data" {
        for_each = rule.value.data
        content {
          ref_id         = data.value.refId
          datasource_uid = lookup(local.cloud_uid, data.value.datasourceUid, data.value.datasourceUid)
          model          = jsonencode(data.value.model)

          relative_time_range {
            from = try(data.value.relativeTimeRange.from, 0)
            to   = try(data.value.relativeTimeRange.to, 0)
          }
        }
      }
    }
  }
}

resource "grafana_dashboard" "bus_outbox" {
  folder = grafana_folder.r10c.uid
  config_json = replace(
    file("${local.grafana_source}/r10c-bus-outbox.json"),
    "\"uid\": \"prometheus\"",
    "\"uid\": \"${var.grafana_prometheus_uid}\"",
  )
}

# Who is told. Email keeps the free tier's own channel; a page and a warning
# both reach the operator, the page with no wait.
resource "grafana_contact_point" "operator" {
  name = "r10c operator"

  email {
    addresses = [var.alert_email]
  }
}

resource "grafana_notification_policy" "r10c" {
  contact_point   = grafana_contact_point.operator.name
  group_by        = ["alertname"]
  group_wait      = "1m"
  repeat_interval = "4h"

  policy {
    contact_point = grafana_contact_point.operator.name
    group_wait    = "0s"

    matcher {
      label = "severity"
      match = "="
      value = "page"
    }
  }
}
