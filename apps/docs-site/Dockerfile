# The documentation site (#686, ADR 0083 §3): the static export — both locale
# trees, Pagefind and the storefront's Storybook at /ui — served by the same
# dependency-free script the static check drives. Static files and one Node
# process: no install step, so nothing in the image resolves a dependency.
#
# Built from apps/docs-site after `nx build @r10c/docs-site`:
#   docker build -t r10c/docs-site:local apps/docs-site
FROM node:26.4.0-slim@sha256:a1d9d671994fc2d26e297ac56b4b1522a8bc7fa71c43b14cd1b1fe6c5116f7dc

WORKDIR /srv
COPY serve.mjs ./
COPY out ./out

# A numeric user, as every fleet image (tools/docker): a runtime that refuses
# root verifies it without reading /etc/passwd. Cloud Run passes PORT.
USER 1000:1000
ENV PORT=8080
EXPOSE 8080
CMD ["node", "serve.mjs"]
