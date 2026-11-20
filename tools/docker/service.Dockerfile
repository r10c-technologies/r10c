# One image per Effect service (ADR 0083, #682), built from what
# `pnpm nx run <service>:prune` leaves in `apps/<service>/dist`: the webpack
# bundle, a package.json naming only what the bundle keeps external, a lockfile
# pruned to it, and the workspace packages it resolves to `file:` paths.
#
#   pnpm nx run <service>:container
#
# The build context is that `dist` and nothing else, so an image cannot pick
# up a source file, a `.env` or a local `node_modules` by accident.
#
# The base is pinned by digest, as the edge's Envoy is: the same tag can be
# re-pushed, and "which Node does the image run" must have one answer. It is
# the toolchain's own Node (`engines` in the root package.json).
FROM node:26.4.0-slim@sha256:a1d9d671994fc2d26e297ac56b4b1522a8bc7fa71c43b14cd1b1fe6c5116f7dc

ENV NODE_ENV=production
WORKDIR /app

# pnpm at the toolchain's version, so the pruned lockfile installs as written.
# Node 26 no longer ships corepack, so it comes from the registry by exact
# version, and it is the image's only use of npm.
RUN npm install --global --no-fund --no-audit pnpm@11.9.0

RUN chown node:node /app
# The base image's `node` user, by number: a pod's `runAsNonRoot` can only
# verify a numeric user, and refuses to start an image that names one.
USER 1000:1000

COPY --chown=node:node . .
# Production dependencies only, exactly as the pruned lockfile pins them; a
# lockfile that disagrees with package.json fails the build rather than
# resolving something new. The store is a temporary directory removed in the
# same layer: the installed files are hard links, so they outlive it, and the
# image does not carry every package twice.
RUN pnpm install --prod --frozen-lockfile --ignore-scripts \
    --config.store-dir=/tmp/pnpm-store \
  && rm -rf /tmp/pnpm-store
# `main.js` serves HTTP. transaction-service's runner-only replica runs
# `runner.js` from the same image (infra/cluster/fleet/transaction-runner.yaml).
CMD ["node", "--enable-source-maps", "main.js"]
