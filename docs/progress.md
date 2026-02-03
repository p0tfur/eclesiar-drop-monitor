# Progress Log - Drop Monitor Backend

## 2024 - Performance Optimization & Code Review

### Task: Backend, API, and User Script Optimization

**Date:** Current session

#### Changes Implemented:

**1. Database Layer (db.ts) - Performance Optimizations:**

- ✅ Enabled SQLite WAL (Write-Ahead Logging) mode for better concurrency
- ✅ Optimized PRAGMA settings:
  - `synchronous = NORMAL` for balanced performance/safety
  - `cache_size = -64000` (64MB cache)
  - `temp_store = MEMORY` for faster temp operations
  - `mmap_size = 30000000000` for memory-mapped I/O
- ✅ Added new indexes:
  - `idx_war_hits_is_drop` - partial index for drops
  - `idx_war_hits_composite` - composite index on (player_name, created_at) for drop queries
- ✅ Wrapped INSERT operations in explicit transactions (BEGIN IMMEDIATE/COMMIT)
- ✅ Added proper rollback handling for failed inserts
- ✅ Reduced max query limit from 200 to 100 records

**2. API Server (server.ts) - Security & Performance:**

- ✅ Added response compression (gzip) using `compression` middleware
- ✅ Implemented rate limiting:
  - General API: 1000 requests per 15 minutes
  - POST endpoints: 100 requests per minute
- ✅ Added request timeout middleware (10 seconds)
- ✅ Reduced JSON payload limit from 1MB to 512KB
- ✅ Implemented graceful shutdown for SIGTERM/SIGINT signals
- ✅ Fixed error handler to check for headers already sent

**3. User Script (Eclesiar_Drop_Monitor.user.js) - Client-Side Optimizations:**

- ✅ Added DOM element caching system with TTL (5 seconds)
- ✅ Implemented throttling for MutationObserver callbacks (100ms)
- ✅ Added retry logic with exponential backoff (3 attempts) for API requests
- ✅ Implemented request timeout using AbortController (8 seconds)
- ✅ Added cache clearing on fight button clicks for fresh data
- ✅ Optimized parsePlayerInfo to use cached DOM selectors

#### Performance Impact:

- **Database:** WAL mode enables concurrent reads during writes, indexes speed up filtered queries
- **API:** Compression reduces bandwidth by ~70%, rate limiting prevents abuse
- **User Script:** DOM caching reduces querySelector calls, throttling prevents excessive processing

#### Dependencies Added:

- `compression` ^2.0.0 - Response compression
- `express-rate-limit` ^7.0.0 - Rate limiting middleware
- `@types/compression` (dev) - TypeScript definitions

---

## 2024 - Docker & Coolify Deployment Setup

**Date:** Current session

#### Changes Implemented:

**1. Dockerfile Optimization:**

- ✅ Changed container port from 80 to 3000 (non-root user security)
- ✅ Multi-stage build already configured
- ✅ Health check endpoint on `/api/health`
- ✅ Tini process manager for proper signal handling
- ✅ Non-root nodejs user (UID 1001)

**2. Docker Compose:**

- ✅ Updated port mapping: `4110:3000` (host:container)
- ✅ Persistent volume for SQLite database
- ✅ Environment variables configuration
- ✅ Health check integration

**3. Environment Configuration:**

- ✅ Updated `.env.example` with Docker deployment notes
- ✅ Documented port usage: 3000 for Docker, 4110 for local dev

**4. Deployment Documentation (DEPLOYMENT.md):**

- ✅ Complete Coolify deployment guide
- ✅ Environment variables setup for Coolify
- ✅ Volume mapping instructions
- ✅ Port configuration (3000 internal, 80/443 via reverse proxy)
- ✅ Local Docker testing instructions
- ✅ Database backup/restore procedures
- ✅ Troubleshooting section
- ✅ Security best practices
- ✅ Performance tuning recommendations

#### Technical Notes:

- **Port 3000 vs 80:** Port 3000 używany wewnątrz kontenera bo non-root user (nodejs) nie może bindować do portów <1024 bez uprawnień root. Coolify reverse proxy mapuje to na publiczne 80/443.
- **Database Persistence:** SQLite stored in `/app/data` with volume mount required
- **Health Check:** Automated monitoring via `GET /api/health` endpoint

#### Bugfix - Dockerfile Build Error:

- ✅ **Problem:** `tsc: not found` - Coolify ustawia `NODE_ENV=production` jako build ARG, co blokuje devDependencies w npm ci
- ✅ **Root cause:** `npm ci` respektuje NODE_ENV i pomija devDeps gdy NODE_ENV=production
- ✅ **Fix:** Zmieniono `npm ci` na `npm install --include=dev` aby wymusić instalację devDeps niezależnie od NODE_ENV
- ✅ `npm prune --production` po buildzie usuwa devDeps z runtime stage

---

### Task: Docker & Coolify Deployment Setup

**Date:** Current session

#### Changes Implemented:

**1. Dockerfile:**

- ✅ Multi-stage build (builder + runtime)
- ✅ Node.js 20 Alpine base image
- ✅ Non-root user (nodejs:1001)
- ✅ Tini init system for proper signal handling
- ✅ Health check endpoint configured
- ✅ Production optimizations (npm ci, prune)
- ✅ Default port 80 for container
- ✅ Volume mount point `/app/data` for SQLite

**2. .dockerignore:**

- ✅ Exclude node_modules, dist, logs
- ✅ Exclude .env files (security)
- ✅ Exclude database files from build context

**3. docker-compose.yml:**

- ✅ Service configuration for local testing
- ✅ Volume mapping for data persistence
- ✅ Environment variables template
- ✅ Health check configuration
- ✅ Port mapping 4110:80

**4. Configuration Updates:**

- ✅ Updated .env.example with Docker-specific comments
- ✅ Port 80 as default for Docker deployment
- ✅ Database path `/app/data/drop-monitor.db` for containers

**5. Documentation:**

- ✅ Created DEPLOYMENT.md with Coolify instructions
- ✅ Local Docker testing guide
- ✅ Database backup/restore procedures
- ✅ Troubleshooting section
- ✅ Security best practices

#### Coolify Configuration:

- **Port:** 80 (wewnątrz kontenera)
- **Volume:** `/app/data` dla persistence bazy danych
- **Health Check:** `/api/health` endpoint
- **Environment Variables:** DROP_PORT, DROP_DB_PATH, DROP_ALLOWED_ORIGINS, DROP_API_KEYS

---

=======

# Progress Log - Drop Monitor Backend

## 2024 - Performance Optimization & Code Review

### Task: Backend, API, and User Script Optimization

**Date:** Current session

#### Changes Implemented:

**1. Database Layer (db.ts) - Performance Optimizations:**

- ✅ Enabled SQLite WAL (Write-Ahead Logging) mode for better concurrency
- ✅ Optimized PRAGMA settings:
  - `synchronous = NORMAL` for balanced performance/safety
  - `cache_size = -64000` (64MB cache)
  - `temp_store = MEMORY` for faster temp operations
  - `mmap_size = 30000000000` for memory-mapped I/O
- ✅ Added new indexes:
  - `idx_war_hits_is_drop` - partial index for drops
  - `idx_war_hits_composite` - composite index on (player_name, created_at) for drop queries
- ✅ Wrapped INSERT operations in explicit transactions (BEGIN IMMEDIATE/COMMIT)
- ✅ Added proper rollback handling for failed inserts
- ✅ Reduced max query limit from 200 to 100 records

**2. API Server (server.ts) - Security & Performance:**

- ✅ Added response compression (gzip) using `compression` middleware
- ✅ Implemented rate limiting:
  - General API: 1000 requests per 15 minutes
  - POST endpoints: 100 requests per minute
- ✅ Added request timeout middleware (10 seconds)
- ✅ Reduced JSON payload limit from 1MB to 512KB
- ✅ Implemented graceful shutdown for SIGTERM/SIGINT signals
- ✅ Fixed error handler to check for headers already sent

**3. User Script (Eclesiar_Drop_Monitor.user.js) - Client-Side Optimizations:**

- ✅ Added DOM element caching system with TTL (5 seconds)
- ✅ Implemented throttling for MutationObserver callbacks (100ms)
- ✅ Added retry logic with exponential backoff (3 attempts) for API requests
- ✅ Implemented request timeout using AbortController (8 seconds)
- ✅ Added cache clearing on fight button clicks for fresh data
- ✅ Optimized parsePlayerInfo to use cached DOM selectors

#### Performance Impact:

- **Database:** WAL mode enables concurrent reads during writes, indexes speed up filtered queries
- **API:** Compression reduces bandwidth by ~70%, rate limiting prevents abuse
- **User Script:** DOM caching reduces querySelector calls, throttling prevents excessive processing

#### Dependencies Added:

- `compression` ^2.0.0 - Response compression
- `express-rate-limit` ^7.0.0 - Rate limiting middleware
- `@types/compression` (dev) - TypeScript definitions

---

## 2024 - Docker & Coolify Deployment Setup

**Date:** Current session

#### Changes Implemented:

**1. Dockerfile Optimization:**

- ✅ Changed container port from 80 to 3000 (non-root user security)
- ✅ Multi-stage build already configured
- ✅ Health check endpoint on `/api/health`
- ✅ Tini process manager for proper signal handling
- ✅ Non-root nodejs user (UID 1001)

**2. Docker Compose:**

- ✅ Updated port mapping: `4110:3000` (host:container)
- ✅ Persistent volume for SQLite database
- ✅ Environment variables configuration
- ✅ Health check integration

**3. Environment Configuration:**

- ✅ Updated `.env.example` with Docker deployment notes
- ✅ Documented port usage: 3000 for Docker, 4110 for local dev

**4. Deployment Documentation (DEPLOYMENT.md):**

- ✅ Complete Coolify deployment guide
- ✅ Environment variables setup for Coolify
- ✅ Volume mapping instructions
- ✅ Port configuration (3000 internal, 80/443 via reverse proxy)
- ✅ Local Docker testing instructions
- ✅ Database backup/restore procedures
- ✅ Troubleshooting section
- ✅ Security best practices
- ✅ Performance tuning recommendations

#### Technical Notes:

- **Port 3000 vs 80:** Port 3000 używany wewnątrz kontenera bo non-root user (nodejs) nie może bindować do portów <1024 bez uprawnień root. Coolify reverse proxy mapuje to na publiczne 80/443.
- **Database Persistence:** SQLite stored in `/app/data` with volume mount required
- **Health Check:** Automated monitoring via `GET /api/health` endpoint

#### Bugfix - Dockerfile Build Error:

- ✅ **Problem:** `tsc: not found` - Coolify ustawia `NODE_ENV=production` jako build ARG, co blokuje devDependencies w npm ci
- ✅ **Root cause:** `npm ci` respektuje NODE_ENV i pomija devDeps gdy NODE_ENV=production
- ✅ **Fix:** Zmieniono `npm ci` na `npm install --include=dev` aby wymusić instalację devDeps niezależnie od NODE_ENV
- ✅ `npm prune --production` po buildzie usuwa devDeps z runtime stage

---

### Task: Docker & Coolify Deployment Setup

**Date:** Current session

#### Changes Implemented:

**1. Dockerfile:**

- ✅ Multi-stage build (builder + runtime)
- ✅ Node.js 20 Alpine base image
- ✅ Non-root user (nodejs:1001)
- ✅ Tini init system for proper signal handling
- ✅ Health check endpoint configured
- ✅ Production optimizations (npm ci, prune)
- ✅ Default port 80 for container
- ✅ Volume mount point `/app/data` for SQLite

**2. .dockerignore:**

- ✅ Exclude node_modules, dist, logs
- ✅ Exclude .env files (security)
- ✅ Exclude database files from build context

**3. docker-compose.yml:**

- ✅ Service configuration for local testing
- ✅ Volume mapping for data persistence
- ✅ Environment variables template
- ✅ Health check configuration
- ✅ Port mapping 4110:80

**4. Configuration Updates:**

- ✅ Updated .env.example with Docker-specific comments
- ✅ Port 80 as default for Docker deployment
- ✅ Database path `/app/data/drop-monitor.db` for containers

**5. Documentation:**

- ✅ Created DEPLOYMENT.md with Coolify instructions
- ✅ Local Docker testing guide
- ✅ Database backup/restore procedures
- ✅ Troubleshooting section
- ✅ Security best practices

#### Coolify Configuration:

- **Port:** 80 (wewnątrz kontenera)
- **Volume:** `/app/data` dla persistence bazy danych
- **Health Check:** `/api/health` endpoint
- **Environment Variables:** DROP_PORT, DROP_DB_PATH, DROP_ALLOWED_ORIGINS, DROP_API_KEYS

---

## 2026 - Coolify Deployment Hotfix

**Date:** 2026-02-02

#### Problem:

- ✅ Kontener startował, ale SQLite zwracał `SQLITE_CANTOPEN: unable to open database file`.
- ✅ Możliwe źródła:
  - uprawnienia wolumenu w Coolify (często mount jako `root:root`), a aplikacja działa jako non-root `nodejs` (UID 1001)
  - błędne wyliczanie ścieżek w buildzie (`dist/config.js`), gdzie `__dirname` = `/app/dist` i wcześniejsze `ROOT_DIR = ../..` dawało `/`, przez co domyślny DB path wpadał w `/data/drop-monitor.db`.

#### Changes Implemented:

**1. Dockerfile (runtime) - naprawa uprawnień bazy na starcie kontenera:**

- ✅ Dodano `su-exec`.
- ✅ Zmieniono uruchomienie kontenera tak, aby na starcie:
  - tworzyć katalog dla `DROP_DB_PATH`
  - wykonać `chown -R nodejs:nodejs` na katalogu bazy
  - uruchomić Node jako użytkownik `nodejs` (bez uprawnień roota).

**2. Healthcheck:**

- ✅ Zainstalowano `curl` w obrazie i zmieniono healthcheck na `curl -fsS http://localhost:3000/api/health` (lepsza kompatybilność z Coolify).
- ✅ Zaktualizowano również `docker-compose.yml`, aby używał tego samego testu.

**3. Config path resolution (dist vs src):**

- ✅ Naprawiono wyliczanie `ROOT_DIR` w `src/config.ts`, aby zarówno w dev (`src/`) jak i w buildzie (`dist/`) wskazywało na katalog projektu (`/app`), a nie `/`.
- ✅ Dzięki temu domyślna ścieżka bazy jest poprawna (`/app/data/drop-monitor.db`), a `.env` jest szukany w `/app/.env` jeśli istnieje.

---

## 2026 - API 401 Diagnostics & Userscript Fix

**Date:** 2026-02-03

#### Problem:

- ✅ Userscript dostawał `401 Unauthorized` na `POST /api/hits`.

#### Changes Implemented:

**1. API Server (server.ts) - lepsza diagnostyka autoryzacji:**

- ✅ Rozszerzono pobieranie klucza API: `x-drop-api-key` lub `Authorization: Bearer <key>`.
- ✅ Dodano bezpieczne logowanie `401` (origin, IP, user-agent, zamaskowany klucz) bez wycieku sekretów.
- ✅ Odpowiedź `401` zawiera informację o wymaganym nagłówku (`x-drop-api-key`).

**2. User Script (Eclesiar_Drop_Monitor.user.js) - poprawki integracji:**

- ✅ Naprawiono literówkę w `@require` (`https://https://...` -> poprawny URL).
- ✅ Rozszerzono obsługę błędów API o treść odpowiedzi (np. `Invalid API key`).
- ✅ Wyłączono retry przy `401/403` (błędy autoryzacji nie powinny być ponawiane).

**3. API Server (server.ts) - trust proxy za reverse proxy:**

- ✅ Włączono `app.set("trust proxy", true)` - naprawia warning `express-rate-limit` o `X-Forwarded-For`.
- ✅ Logi będą teraz pokazywać prawdziwe IP użytkownika zamiast wewnętrznego IP kontenera Docker.

---

## 2026 - Reverse Proxy Rate Limit Fix & CORS Headers

**Date:** 2026-02-03

#### Problem:

- ✅ `express-rate-limit` rzucał `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` w środowisku z reverse proxy.
- ✅ Backend nie dopuszczał jawnie nagłówków autoryzacji w CORS, co mogło blokować przesyłanie `X-DROP-API-KEY`.

#### Changes Implemented:

**1. API Server (server.ts):**

- ✅ Włączono `trust proxy` (wartość `1`) dla poprawnej obsługi `X-Forwarded-For`.
- ✅ Ustawiono `allowedHeaders` w CORS na `Content-Type`, `X-DROP-API-KEY`, `Authorization` oraz metody `GET/POST/OPTIONS`.
- ✅ Rozszerzono log `401` o listę nazw nagłówków (bez wartości).

**2. User Script (Eclesiar_Drop_Monitor.user.js):**

- ✅ Dodano log startowy pokazujący `baseUrl`, `endpoint` i czy `apiKey` jest ustawiony (bez wypisywania klucza).

---
