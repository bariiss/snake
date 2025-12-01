# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build Angular app with environment variables
ARG API_URL=https://snake.li1.nl
ENV API_URL=$API_URL

# Update environment.prod.ts with API_URL from build arg
RUN if [ -f src/environments/environment.prod.template.ts ]; then \
      sed "s|{{API_URL}}|${API_URL}|g" src/environments/environment.prod.template.ts > src/environments/environment.prod.ts; \
    else \
      echo "export const environment = { production: true, apiUrl: '${API_URL}' };" > src/environments/environment.prod.ts; \
    fi

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

