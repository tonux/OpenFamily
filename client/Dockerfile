# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Disable husky's prepare script — git hooks aren't relevant in containers.
ENV HUSKY=0

# Copy package files
COPY package.json ./
COPY client/package.json ./client/
COPY shared/package.json ./shared/

# Strip the husky `prepare` script: git hooks aren't relevant in containers
# and husky is a devDep — running it would fail on any --production install.
RUN npm pkg delete scripts.prepare

# Install dependencies
RUN npm install --legacy-peer-deps
RUN cd client && npm install --legacy-peer-deps
RUN cd shared && npm install --legacy-peer-deps

# Copy source code
COPY shared ./shared
COPY client ./client
COPY tsconfig.json ./

# Build shared and client
RUN cd shared && npm run build
RUN cd client && npm run build

# Production stage
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/client/dist /usr/share/nginx/html

# Copy nginx configuration
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
