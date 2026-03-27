FROM node:20-alpine

# Install nmap for network discovery scanning
RUN apk add --no-cache nmap nmap-scripts sudo \
    && echo "node ALL=(ALL) NOPASSWD: /usr/bin/nmap" >> /etc/sudoers.d/nmap

WORKDIR /app

# Copy root package.json for workspace setup
COPY package.json package-lock.json ./
COPY packages/scanner/package.json packages/scanner/
COPY packages/server/package.json packages/server/

RUN npm install --workspace=packages/server --workspace=packages/scanner

# Build scanner first (server depends on it)
COPY packages/scanner/tsconfig.json packages/scanner/
COPY packages/scanner/src packages/scanner/src
RUN npm run build -w packages/scanner

# Build server
COPY packages/server/tsconfig.json packages/server/
COPY packages/server/src packages/server/src
COPY packages/server/migrations packages/server/migrations
RUN npm run build -w packages/server

WORKDIR /app/packages/server

EXPOSE 3001

CMD ["node", "dist/index.js"]
