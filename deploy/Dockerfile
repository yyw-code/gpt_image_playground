# ---- Build stage ----
FROM --platform=$BUILDPLATFORM node:20-alpine AS build

WORKDIR /app

# 保留编译期标记，用于配置脚本加载失败时阻止工作台启动；具体配置由独立文件提供。
ENV VITE_DOCKER_DEPLOYMENT=true

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Production stage ----
FROM nginx:alpine

ENV HOST=0.0.0.0
ENV PORT=80
ENV DEFAULT_API_URL=
ENV SITE_MODE=true
ENV API_PROXY_URL=
ENV ENABLE_API_PROXY=false
ENV LOCK_API_PROXY=false
ENV SHOW_PRESET_CONFIG_ONLY=false
ENV LOCK_PRESET_CONFIG_PARAMS=false
ENV PREVENT_PRESET_CONFIG_DELETION=false
ENV DEFAULT_UI_FONT=
ENV DEFAULT_MONO_FONT=
ENV BUILTIN_FONT_SOURCE=

COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY --chmod=755 deploy/migrate-api-env.envsh /docker-entrypoint.d/05-migrate-api-env.envsh
COPY --chmod=755 deploy/inject-api-url.sh /docker-entrypoint.d/40-inject-api-url.sh

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
