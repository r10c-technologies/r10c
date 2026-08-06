#!/usr/bin/env bash
# Read-only diagnosis of the LOCAL DEV infrastructure: walks the same ladder
# `ensure.sh` heals and prints where it stands. Mutates nothing, never starts
# anything — run it when a boot failed and you want the state without
# triggering another heal.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$DIR/lib.sh"

row() { printf '%-14s %-6s %s\n' "$1" "$2" "$3"; }
ok()   { row "$1" "${C_GREEN}OK${C_OFF}    " "$2"; }
bad()  { row "$1" "${C_RED}FAIL${C_OFF}  " "$2"; }
skip() { row "$1" "${C_DIM}SKIP${C_OFF}  " "$2"; }

echo
echo "${C_BOLD}dev infra doctor${C_OFF}  ${C_DIM}local minikube, namespace $NS${C_OFF}"
echo

# L0 -------------------------------------------------------------------------
missing_tools=""
for t in minikube kubectl nc; do has "$t" || missing_tools="$missing_tools $t"; done
if [[ -n "$missing_tools" ]]; then
  bad "L0 tooling" "missing:$missing_tools"
  echo
  echo "fix: brew install minikube kubernetes-cli"
  exit 1
fi
optional=""
for t in pg_isready redis-cli mongosh docker; do has "$t" || optional="$optional $t"; done
ok "L0 tooling" "minikube kubectl nc${optional:+  ${C_DIM}(optional missing:$optional)${C_OFF}}"

# L1 -------------------------------------------------------------------------
state="$(minikube_state)"
if [[ "$state" == "Running" ]]; then
  ok "L1 cluster" "minikube Running"
else
  if [[ "$state" == "Drifted" ]]; then
    # Named for what it is: the cluster is alive, kubectl is aimed at the wrong
    # port. Everything below needs kubectl, so there is nothing left to report.
    bad "L1 cluster" "kubeconfig stale — kubectl is pointing at a dead apiserver port"
  else
    bad "L1 cluster" "minikube $state"
  fi
  skip "L2 portmap" ""; skip "L3 workloads" ""; skip "L4 rollout" ""; skip "L5 probes" ""
  echo
  if [[ "$state" == "Drifted" ]]; then
    echo "fix: minikube update-context    # instant; ensure.sh also does it for you"
  else
    echo "fix: pnpm run mp-admin:dev      # ensure.sh starts it with the right --ports"
  fi
  exit 1
fi

# L2 -------------------------------------------------------------------------
missing_ports="$(missing_host_ports)"
if [[ -n "$missing_ports" ]]; then
  bad "L2 portmap" "not published:$missing_ports"
else
  ok "L2 portmap" "${REQUIRED_HOST_PORTS[*]}"
fi

# L3 -------------------------------------------------------------------------
present=0; total=0; absent=""
for spec in "${PORT_SPECS[@]}"; do
  d="$(spec_deploy "$spec")"; total=$(( total + 1 ))
  if deploy_exists "$d"; then present=$(( present + 1 )); else absent="$absent $d"; fi
done
if [[ "$present" -eq "$total" ]]; then
  ok "L3 workloads" "$present/$total deployments present"
else
  bad "L3 workloads" "$present/$total present, missing:$absent"
fi

# L4 -------------------------------------------------------------------------
not_ready=""
for spec in "${PORT_SPECS[@]}"; do
  d="$(spec_deploy "$spec")"
  deploy_exists "$d" || continue
  if ! deploy_ready "$d"; then
    reason="$(deploy_reason "$d")"
    not_ready="$not_ready $d${reason:+(${reason% })}"
  fi
done
if [[ -z "$not_ready" ]]; then
  ok "L4 rollout" "all deployments Ready"
else
  bad "L4 rollout" "not Ready:$not_ready"
fi

# L5 -------------------------------------------------------------------------
down=""
for spec in "${PORT_SPECS[@]}"; do
  label="$(spec_label "$spec")"; port="$(spec_port "$spec")"
  probe_datastore "$label" "$port" || down="$down $label(:$port)"
done
if [[ -z "$down" ]]; then
  ok "L5 probes" "$(probed_labels)"
else
  bad "L5 probes" "unreachable:$down"
fi

# L6 -------------------------------------------------------------------------
# A rung the ladder can heal but a human cannot see any other way: the fleet
# fails at sign-in rather than at boot when the instance is unseeded.
if zitadel_seeded; then
  ok "L6 zitadel" "instance seeded (project, OIDC app, login policy, SMTP)"
  unseeded=""
else
  bad "L6 zitadel" "instance not seeded — no OIDC app, so no sign-in"
  unseeded="1"
fi

echo
if [[ -z "$missing_ports" && -z "$not_ready" && -z "$down" && -z "$unseeded" && "$present" -eq "$total" ]]; then
  echo "${C_GREEN}healthy${C_OFF} — pnpm run mp-admin:dev will start immediately."
  exit 0
fi
if [[ -n "$missing_ports" ]]; then
  echo "fix: bash infra/local/reset.sh --hard     # only a cluster recreate fixes the port mapping"
else
  echo "fix: pnpm run mp-admin:dev                # self-heals L3/L4/L5"
  echo "     pnpm run mp-admin:dev:reset          # if that fails twice (wipes local data)"
fi
exit 1
