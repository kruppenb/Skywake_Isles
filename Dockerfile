FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && mkdir -p /app/data && chown node:node /app/data
COPY --chown=node:node client ./client
COPY --chown=node:node shared ./shared
COPY --chown=node:node server ./server
USER node
ENV NODE_ENV=production PORT=3400 DATA_DIR=/app/data
EXPOSE 3400
HEALTHCHECK --interval=20s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3400/health').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(j=>{if(!j.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
