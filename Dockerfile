# Stage 1: Build Vite frontend
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production runtime with Node.js
FROM node:22-alpine

WORKDIR /app

# Copy built frontend assets
COPY --from=builder /app/dist ./dist

# Copy server script and package definition
COPY package.json ./
COPY server.js ./

# Set default environment variables
ENV NODE_ENV=production \
    PORT=3137 \
    DATA_DIR=/app/data \
    NEXTCLOUD_URL=https://drive.gciconnect.my.id \
    NEXTCLOUD_USER=gcibot \
    NEXTCLOUD_PASSWORD=Gcidesign#1 \
    NEXTCLOUD_DIR=ftth-photo-qc

RUN mkdir -p /app/data

EXPOSE 3137

CMD ["node", "server.js"]
