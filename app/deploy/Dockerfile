# syntax=docker/dockerfile:1
# Imagem do Forseti (spec 0004, D-I9): um processo serve a API em /api/* e o
# build da web na mesma origem. O contexto de build é a pasta app/:
#   docker build -f deploy/Dockerfile -t forseti .        (de dentro de app/)
# Só entra o que é copiado pasta por pasta abaixo: nada de COPY . . e nenhum
# .env. O BuildKit também lê deploy/Dockerfile.dockerignore.

ARG NODE_VERSION=26.8.1

# 1. Build da web (Vite). O front importa tipos de shared/model.ts.
FROM node:${NODE_VERSION}-trixie-slim AS web
WORKDIR /app
COPY shared/ ./shared/
COPY web/ ./web/
# Um .env local esquecido em web/ viraria variável do bundle do Vite.
RUN find web -name '.env*' ! -name '.env.example' -exec rm -rf {} + \
 && npm --prefix web ci --ignore-scripts --no-audit --no-fund \
 && npm --prefix web run build

# 2. Dependências de produção do servidor. O único script de instalação da
# árvore é o do esbuild, que só otimiza: o binário vem do pacote da plataforma.
FROM node:${NODE_VERSION}-trixie-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# 3. Imagem final. O código fica com o root e o processo roda como node.
FROM node:${NODE_VERSION}-trixie-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    SEED_ON_BOOT=1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY server/ ./server/
COPY shared/ ./shared/
COPY contracts/abi/ ./contracts/abi/
COPY deploy/limpar-workspaces.mjs ./deploy/
COPY --from=web /app/web/dist ./web/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--import", "tsx", "server/index.ts"]
