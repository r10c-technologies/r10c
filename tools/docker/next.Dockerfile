# One image per Next app (ADR 0083, #682), built from what `next build` leaves
# under `output: 'standalone'`: a `server.js`, the traced files it reads, and
# the static assets beside it.
#
#   pnpm nx run <app>:container
#
# The build context is the app's own directory, narrowed by
# `next.Dockerfile.dockerignore` to the three paths copied below, so a `.env`
# or a local `node_modules` never reaches the daemon. Nothing is installed: the
# trace already holds every module the server requires.
#
# Same base, pinned by the same digest, as tools/docker/service.Dockerfile.
FROM node:26.4.0-slim@sha256:a1d9d671994fc2d26e297ac56b4b1522a8bc7fa71c43b14cd1b1fe6c5116f7dc

# The unscoped project name, e.g. `marketplace-app`: the standalone tree keeps
# the app at its path from the repository root.
ARG APP
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    APP=${APP}
WORKDIR /app
RUN chown node:node /app
# The base image's `node` user, by number: a pod's `runAsNonRoot` can only
# verify a numeric user, and refuses to start an image that names one.
USER 1000:1000

COPY --chown=node:node .next/standalone ./
COPY --chown=node:node .next/static ./apps/${APP}/.next/static
COPY --chown=node:node public ./apps/${APP}/public

# `PORT` is set by the manifest: 3200 or 3201, the origin + 200 (ADR 0072).
CMD ["sh", "-c", "exec node apps/${APP}/server.js"]
