# Nimble — single-container deploy: API + built web app (same origin).
FROM node:22-slim
RUN npm install -g pnpm@9
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# Same-origin API: empty VITE_API_URL makes the client use relative paths.
ENV VITE_API_URL=""
RUN pnpm --filter @nimble/web build
ENV NODE_ENV=production
ENV WEB_DIST=/app/apps/web/dist
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "pnpm --filter @nimble/api migrate && pnpm --filter @nimble/api start"]
