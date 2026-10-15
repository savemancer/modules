# syntax=docker/dockerfile:1
# Два образа из одного репозитория:
#   --target cdn     — собранные модули + registry.json (cdn.savemancer.com)
#   --target devkit  — редактор для разработчиков модулей (dev.savemancer.com)

FROM node:24-alpine AS deps
WORKDIR /app
# Сначала только манифесты — слой с зависимостями кэшируется между сборками
COPY package.json package-lock.json ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/devkit/package.json packages/devkit/
RUN npm ci --no-audit --no-fund
COPY . .

FROM deps AS modules-build
# В прод не попадает ничего, что не прошло валидацию, типы и тесты
RUN npm run check && npm run build

FROM deps AS devkit-build
RUN npm run build -w @savemancer/devkit

FROM nginx:1.27-alpine AS cdn
COPY docker/cdn.conf /etc/nginx/conf.d/default.conf
COPY --from=modules-build /app/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

FROM nginx:1.27-alpine AS devkit
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=devkit-build /app/packages/devkit/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
