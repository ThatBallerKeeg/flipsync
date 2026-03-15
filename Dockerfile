FROM node:20-slim

# System deps: Python, Playwright browser libs, curl
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv curl \
    # Playwright/Chromium system libs
    libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libdbus-1-3 libexpat1 libxcb1 libxkbcommon0 \
    libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
    libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps
COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Node deps (pnpm)
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# App source
COPY . .

# Generate Prisma client (needs schema.prisma to be present)
RUN npx prisma generate

# Playwright: install Chromium
RUN npx playwright install chromium

# Build Next.js
RUN pnpm build

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

CMD ["pnpm", "start"]
