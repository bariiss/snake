# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build Angular app with environment variables
ARG API_URL=http://backend:8080
ARG WS_URL=ws://backend:8080
ENV API_URL=$API_URL
ENV WS_URL=$WS_URL

RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install serve globally
RUN npm install -g serve

# Copy built app from builder
COPY --from=builder /app/dist/snake-frontend /app/dist

EXPOSE 80

# Serve the built app
CMD ["serve", "-s", "dist", "-l", "80"]

