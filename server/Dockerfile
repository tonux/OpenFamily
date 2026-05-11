# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Disable husky's prepare script — git hooks aren't relevant in containers
# and husky is a devDep, so the production install below would otherwise
# fail with "husky: not found" when --production skips devDeps.
ENV HUSKY=0

# Copy package files
COPY package.json ./
COPY server/package.json ./server/
COPY shared/package.json ./shared/

# Strip the husky `prepare` script: git hooks aren't relevant in containers,
# and husky is a devDep so it won't be present in any --production install.
RUN npm pkg delete scripts.prepare

# Install dependencies
RUN npm install
RUN cd server && npm install
RUN cd shared && npm install

# Copy source code
COPY shared ./shared
COPY server ./server
COPY tsconfig.json ./

# Build shared and server
RUN cd shared && npm run build
RUN cd server && npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

ENV HUSKY=0

# Copy package files
COPY package.json ./
COPY server/package.json ./server/
COPY shared/package.json ./shared/

# See builder stage — strip husky prepare hook before the production install.
RUN npm pkg delete scripts.prepare

# Install production dependencies only
RUN npm install --production
RUN cd server && npm install --production
RUN cd shared && npm install --production

# Copy built files from builder
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/dist ./server/dist

# Copy SQL migrations — runMigrations() reads them at boot through node-pg-migrate.
# Without this line the new container would start against an empty pgmigrations
# table and never create the AI tables (or any post-initial schema change).
COPY --from=builder /app/server/migrations ./server/migrations

# Create uploads directory
RUN mkdir -p /app/uploads

EXPOSE 3001

CMD ["node", "server/dist/index.js"]
