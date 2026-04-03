# Build SPA CineContent (clés anon Supabase injectées au build — passer les ARG depuis CI)
FROM node:22-bookworm AS frontend-builder
WORKDIR /fe
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ARG VITE_API_BASE_URL=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.50.0-jammy AS backend-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.50.0-jammy AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV FRONTEND_DIST_PATH=/app/frontend-dist

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=backend-builder /app/dist ./dist
COPY --from=frontend-builder /fe/dist ./frontend-dist

EXPOSE 8080
CMD ["node", "dist/index.js"]
