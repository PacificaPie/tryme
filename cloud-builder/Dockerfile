FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee

# Only reviewed build tools and their lock file enter the image. The application
# source tree, local credentials, local node_modules and Sites files are excluded.
WORKDIR /toolkit
COPY scripts/build-toolkit/package.json scripts/build-toolkit/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org --userconfig=/dev/null --globalconfig=/tmp/build-global-npmrc && npm cache clean --force
COPY scripts/build-toolkit/bundle.mjs scripts/build-toolkit/inspect.mjs scripts/build-toolkit/export.mjs scripts/build-toolkit/limits.mjs ./
COPY scripts/repo-builder.mjs /app/scripts/repo-builder.mjs
COPY scripts/build-toolkit/limits.mjs scripts/build-toolkit/self-contained.mjs /app/scripts/build-toolkit/
COPY cloud-builder/runner/ /app/cloud-builder/runner/
RUN mkdir -p /work && chown 1000:1000 /work && chmod 0700 /work && \
    chmod -R a-w /app /toolkit && chmod 0555 /app/cloud-builder/runner/start.sh && \
    find /usr /bin /sbin -type f -perm /6000 -exec chmod a-s '{}' +

# Only this fixed control service is root. Every repository command drops to UID
# 1000 with no groups/capabilities and no-new-privileges; it never receives a
# platform token. Requires Cloudflare's DEFAULT scheduling policy.
USER root
WORKDIR /app/cloud-builder/runner
EXPOSE 8080
ENTRYPOINT ["/app/cloud-builder/runner/start.sh"]
