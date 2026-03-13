FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

# Install all workspace dependencies
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci

# Copy source
COPY . .

# Build workspace dependencies and API
RUN npm run build --workspace @dashboarduz/shared \
  && npm run build --workspace @dashboarduz/db \
  && npm run build --workspace @dashboarduz/api

ENV NODE_ENV=production
EXPOSE 3001

CMD ["npm", "run", "start", "--workspace", "@dashboarduz/api"]
