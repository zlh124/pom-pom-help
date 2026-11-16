# 帕姆帮帮（非官方复刻）· 单镜像部署
# 构建：docker build -t pompom-helphelp .
# 运行：docker run -p 3000:3000 --env-file .env.local -v "$PWD/data:/app/data" pompom-helphelp
#   说明：data/ 里放好 pompom.sqlite / index.sqlite（先在宿主机跑 npm run data:all）
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./
# corpus 在运行时读取（语料即代码），必须带上
COPY --from=build /app/corpus ./corpus
RUN mkdir -p /app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm","start"]
