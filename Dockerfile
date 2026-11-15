# ---- build the React client ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime: API + built client, production deps only ----
FROM node:24-alpine
ENV NODE_ENV=production PORT=4300 DB_FILE=/data/fixwerk.db
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY server/src server/src
COPY --from=build /app/client/dist client/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4300
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:4300/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.js"]
