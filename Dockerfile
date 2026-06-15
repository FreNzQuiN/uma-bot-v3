FROM node:22-slim

# Install Playwright dependencies
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency files first (Docker layer caching)
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy Playwright browsers
RUN npx playwright install chromium

# Copy source
COPY dist/ ./dist/
COPY config.yaml ./

# Create data directory
RUN mkdir -p data/snapshots data/auth

# Environment
ENV NODE_ENV=production
ENV API_PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>r.json()).then(j=>{if(!j.success)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
