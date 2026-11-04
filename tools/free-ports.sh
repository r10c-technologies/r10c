#!/usr/bin/env bash
# Free the dev ports this workspace binds, killing leftovers from a previous run
# (an nx task killed with SIGKILL, a crashed terminal, a detached `next dev`).
# Wired as the `free-ports` nx target that every app/service `dev` depends on,
# so each project clears its own port before binding it.
#
#   tools/free-ports.sh              every fleet port
#   tools/free-ports.sh 3001 3101    just these
#
# SAFETY: a listener is only killed when it belongs to THIS workspace — its cwd
# or its command line must sit under the repo root. Anything else (your other
# project on :3000, a system daemon) is reported and the script exits 1 rather
# than killing a process it does not own. `R10C_FREE_PORTS=force` overrides that
# refusal; there is deliberately no way to make it the default.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The fleet (docs/_shared/ports.md): the edge's origins 300N, the Next apps
# behind them on 320N (the origin + 200), backends 310N, platform 319x.
ALL_PORTS=(3000 3001 3200 3201 3100 3101 3102 3103 3105 3106 3107 3108 3109 3110 3190 3191)
# The Node inspector each `@nx/js:node` dev target opens, at its service port
# + 6000. One shared 9229 meant only the first service of a fleet got a debugger
# and every other one logged "address already in use".
INSPECT_PORTS=(9100 9101 9102 9103 9105 9106 9107 9108 9109 9110 9190 9191)
# The flow engine's runners (ADR 0066): the service port + 31000 + 1000 × the
# replica, so transaction-service's two land on 34103 and 35103 — clear of
# every service port, inspector and minikube NodePort.
RUNNER_PORTS=(34103 35103)

if [[ -t 1 ]]; then
  C_DIM=$'\033[2m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_OFF=$'\033[0m'
else
  C_DIM=''; C_RED=''; C_YELLOW=''; C_OFF=''
fi

PORTS=("$@")
[[ ${#PORTS[@]} -eq 0 ]] && PORTS=("${ALL_PORTS[@]}" "${INSPECT_PORTS[@]}" "${RUNNER_PORTS[@]}")

if ! command -v lsof >/dev/null 2>&1; then
  echo "${C_YELLOW}==>${C_OFF} lsof not available — skipping port cleanup" >&2
  exit 0
fi

# The edge's origins are published by a container (tools/edge/serve.sh), and
# the process holding a published port is Docker's own backend — outside this
# workspace, so the loop below would refuse it rather than free it. Freeing an
# origin therefore removes the container by name, and the lsof pass that
# follows only confirms the port is clear.
EDGE_CONTAINER='r10c-edge'
for port in "${PORTS[@]}"; do
  if [[ "$port" == 3000 || "$port" == 3001 ]]; then
    if command -v docker >/dev/null 2>&1 &&
      [[ -n "$(docker ps -q --filter "name=^${EDGE_CONTAINER}$" 2>/dev/null)" ]]; then
      echo "${C_YELLOW}==> free-ports:${C_OFF} :$port held by the edge — removing ${EDGE_CONTAINER}"
      docker rm -f "$EDGE_CONTAINER" >/dev/null 2>&1 || true
    fi
    break
  fi
done

listeners() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | sort -u; }

# A process is ours when it runs from inside the repo. `lsof -d cwd` answers for
# processes we own; the command line is the fallback (nx forks carry absolute
# paths), so a stale `next dev` started from a deleted shell is still matched.
belongs_to_repo() {
  local pid="$1" cwd args
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
  [[ -n "$cwd" && "$cwd" == "$REPO_ROOT"* ]] && return 0
  args="$(ps -p "$pid" -o args= 2>/dev/null)"
  [[ -n "$args" && "$args" == *"$REPO_ROOT"* ]] && return 0
  return 1
}

describe() { ps -p "$1" -o args= 2>/dev/null | cut -c1-90; }

killed_any=0
foreign=0

for port in "${PORTS[@]}"; do
  for pid in $(listeners "$port"); do
    # Never kill the process tree we are running inside (nx invoked us).
    if [[ "$pid" == "$$" || "$pid" == "$PPID" ]]; then continue; fi

    if ! belongs_to_repo "$pid" && [[ "${R10C_FREE_PORTS:-}" != "force" ]]; then
      echo "${C_RED}ERROR:${C_OFF} port $port is held by a process outside this workspace:" >&2
      echo "  pid $pid  $(describe "$pid")" >&2
      foreign=1
      continue
    fi

    echo "${C_YELLOW}==> free-ports:${C_OFF} :$port held by pid $pid ${C_DIM}$(describe "$pid")${C_OFF}"
    kill -TERM "$pid" 2>/dev/null

    # Give it a moment to close the socket, then insist.
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "${C_YELLOW}==> free-ports:${C_OFF} pid $pid ignored SIGTERM — SIGKILL"
      kill -KILL "$pid" 2>/dev/null
      sleep 0.5
    fi
    killed_any=1
  done
done

if [[ "$foreign" -eq 1 ]]; then
  echo >&2
  echo "  Stop it yourself, or re-run with R10C_FREE_PORTS=force to kill it anyway." >&2
  exit 1
fi

# Sockets can linger a beat after the process dies; confirm before handing over.
for port in "${PORTS[@]}"; do
  for _ in 1 2 3 4 5 6; do
    [[ -z "$(listeners "$port")" ]] && break
    sleep 0.5
  done
  if [[ -n "$(listeners "$port")" ]]; then
    echo "${C_RED}ERROR:${C_OFF} port $port is still in use after cleanup (pid $(listeners "$port" | tr '\n' ' '))" >&2
    exit 1
  fi
done

[[ "$killed_any" -eq 1 ]] && echo "${C_DIM}==> free-ports: done${C_OFF}"
exit 0
