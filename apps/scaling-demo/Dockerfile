FROM node:24.21.0-alpine3.24@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2 AS base
RUN apk upgrade --no-cache

FROM base AS tested
WORKDIR /app
COPY apps/scaling-demo/package.json apps/scaling-demo/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY apps/scaling-demo/*.mjs ./
COPY apps/scaling-demo/test ./test
COPY apps/scaling-demo/public ./public
RUN npm test

FROM base AS web
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=tested /app/web.mjs ./
USER node
EXPOSE 8080
CMD ["node", "web.mjs"]

FROM base AS load
ENV NODE_ENV=production
WORKDIR /app
COPY --from=tested /app/load.mjs /app/config.mjs ./
USER node
CMD ["node", "load.mjs"]

FROM base AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=tested /app/node_modules ./node_modules
COPY --from=tested /app/worker.mjs /app/queue.mjs /app/config.mjs ./
USER node
CMD ["node", "worker.mjs"]

FROM tested AS kubectl
RUN wget -q -O /kubectl https://dl.k8s.io/release/v1.35.0/bin/linux/amd64/kubectl \
    && wget -q -O /kubectl.sha256 https://dl.k8s.io/release/v1.35.0/bin/linux/amd64/kubectl.sha256 \
    && echo "$(cat /kubectl.sha256)  /kubectl" | sha256sum -c - \
    && chmod 755 /kubectl

FROM base AS presenter
ENV NODE_ENV=production PORT=8080 LAB_DIR=/app/labs KUBECONFIG=/etc/demo/kubeconfig
WORKDIR /app
COPY --from=tested /app/node_modules ./node_modules
COPY --from=tested /app/presenter.mjs /app/catalog.mjs /app/queue.mjs /app/config.mjs ./
COPY --from=tested /app/public ./public
COPY --from=kubectl /kubectl /usr/local/bin/kubectl
COPY labs/01-scaling/web.yaml labs/01-scaling/hpa.yaml labs/01-scaling/load.yaml labs/01-scaling/pdb.yaml labs/01-scaling/queue.yaml labs/01-scaling/scaledobject.yaml ./labs/
USER node
EXPOSE 8080
CMD ["node", "presenter.mjs"]