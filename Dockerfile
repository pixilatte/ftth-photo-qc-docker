# Stage 1: Build the Vite + React application
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./

# Install dependencies cleanly
RUN npm ci

# Copy source code and build
COPY . .
RUN npm run build

# Stage 2: Serve using Nginx Alpine
FROM nginx:alpine

# Remove default static files
RUN rm -rf /usr/share/nginx/html/*

# Copy build artifacts from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80 inside container
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

