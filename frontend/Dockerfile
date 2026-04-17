FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN corepack enable && pnpm install
COPY . .
# Next.js build 只讀 .env / .env.production；把專案慣例的 .env.docker 複製過去，
# 讓 NEXT_PUBLIC_* 能在 build time inline 進 JS bundle
RUN if [ -f .env.docker ]; then cp .env.docker .env.production; fi
RUN pnpm build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
