# Build stage
FROM node:20 AS build

# Accept build arguments for environment variables with defaults
ARG UNSPLASH_KEY=DUMMY_UNSPLASH_KEY
ARG UNSPLASH_CLIENT_ID=DUMMY_UNSPLASH_CLIENT_ID
ARG NODE_OPTIONS=--max-old-space-size=4096

# Set as environment variables for the build
ENV UNSPLASH_KEY=$UNSPLASH_KEY
ENV UNSPLASH_CLIENT_ID=$UNSPLASH_CLIENT_ID
ENV NODE_OPTIONS=$NODE_OPTIONS

WORKDIR /app

# Install git and configure for HTTPS
# Use single apt-get command to avoid GPG issues
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
    --no-install-recommends \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && git config --global url."https://github.com/".insteadOf ssh://git@github.com/

# Copy and install dependencies
COPY package*.json ./
COPY packages/ ./packages/
COPY tsconfig.json ./
RUN npm ci --ignore-scripts || npm i --ignore-scripts
# Manually run prepare steps (skip husky which is for git hooks)
RUN npx ts-patch install -s && \
    cd packages/shared-schema && npm run build && cd ../.. && \
    cd packages/plugin-api && npm run build && cd ../..

# Copy source and build
COPY . .
# Pass build args as environment variables for the build commands
# Skip lint in CI as it's already run in pre-push hook
RUN UNSPLASH_KEY=$UNSPLASH_KEY UNSPLASH_CLIENT_ID=$UNSPLASH_CLIENT_ID npm run env && npm run buildFrontend:prodWeb

# Production stage
FROM nginx:1

ENV PORT=80

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends jq && rm -rf /var/lib/apt/lists/*

# Copy built app and configs
COPY --from=build /app/dist/browser /usr/share/nginx/html
COPY ./nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY ./docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

EXPOSE $PORT
WORKDIR /usr/share/nginx/html

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
