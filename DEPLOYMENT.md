# Deployment Guide - Drop Monitor Backend

## Coolify Deployment

### Prerequisites

- Coolify instance configured
- Git repository access
- Domain/subdomain configured

### Configuration Steps

#### 1. Environment Variables w Coolify

Ustaw następujące zmienne środowiskowe w panelu Coolify:

```bash
NODE_ENV=production
DROP_PORT=3000
DROP_DB_PATH=/app/data/drop-monitor.db
DROP_ALLOWED_ORIGINS=https://eclesiar.com,https://www.eclesiar.com
DROP_API_KEYS=your-super-secret-api-key-here
```

**Uwaga:** Port 3000 jest używany wewnątrz kontenera (non-root user nodejs nie może bindować do portów <1024 bez uprawnień root).

#### 2. Volume Mapping (Persistent Storage)

W panelu Coolify, kliknij **"Add Volume Mount"** i wprowadź:

**Opcja 1 - Named Volume (zalecane):**

```
Name: drop-monitor-data
Source Path: (zostaw puste)
Destination Path: /app/data
```

**Opcja 2 - Bind Mount (jeśli potrzebujesz dostępu do plików z hosta):**

```
Name: drop-monitor-data
Source Path: /var/lib/coolify/volumes/drop-monitor-data
Destination Path: /app/data
```

**Uwaga:** Volume musi być skonfigurowany, inaczej baza danych SQLite zostanie utracona przy restart kontenera!

#### 3. Port Mapping

- **Container Port:** `3000`
- **Public Port:** Coolify automatycznie zarządza przez reverse proxy (80/443)

#### 4. Health Check

Coolify użyje wbudowanego health checka z Dockerfile:

- **Endpoint:** `http://localhost:3000/api/health`
- **Interval:** 30s
- **Timeout:** 3s
- **Retries:** 3

### Build Process

Coolify automatycznie:

1. Wykryje `Dockerfile` w repozytorium
2. Zbuduje multi-stage image
3. Uruchomi kontener z ustawionymi zmiennymi

### Monitoring

Sprawdź status aplikacji:

```bash
curl https://your-domain.com/api/health
```

Oczekiwana odpowiedź:

```json
{ "status": "ok" }
```

---

## Local Docker Testing

### Uruchomienie z docker-compose

```bash
# 1. Skopiuj i edytuj zmienne środowiskowe
cp .env.example .env
nano .env

# 2. Zbuduj i uruchom
docker-compose up -d

# 3. Sprawdź logi
docker-compose logs -f

# 4. Test health check
curl http://localhost:4110/api/health
```

### Ręczne uruchomienie Docker

```bash
# Build
docker build -t drop-monitor-backend .

# Run
docker run -d \
  --name drop-monitor \
  -p 4110:3000 \
  -v $(pwd)/data:/app/data \
  -e DROP_PORT=3000 \
  -e DROP_DB_PATH=/app/data/drop-monitor.db \
  -e DROP_ALLOWED_ORIGINS=https://eclesiar.com,https://www.eclesiar.com \
  -e DROP_API_KEYS=your-secret-key \
  drop-monitor-backend

# Logs
docker logs -f drop-monitor

# Stop
docker stop drop-monitor
docker rm drop-monitor
```

---

## Database Persistence

### SQLite w Dockerze

Baza danych SQLite jest przechowywana w `/app/data/drop-monitor.db` wewnątrz kontenera.

**Ważne:** Zawsze używaj volume mapping, aby dane przetrwały restart kontenera!

### Backup

```bash
# Z hosta (jeśli volume zmapowany)
cp /var/lib/coolify/volumes/drop-monitor-data/drop-monitor.db ./backup-$(date +%Y%m%d).db

# Z kontenera
docker exec drop-monitor sqlite3 /app/data/drop-monitor.db ".backup /app/data/backup.db"
docker cp drop-monitor:/app/data/backup.db ./backup-$(date +%Y%m%d).db
```

### Restore

```bash
# Zatrzymaj kontener
docker stop drop-monitor

# Przywróć backup
cp backup-20240101.db /var/lib/coolify/volumes/drop-monitor-data/drop-monitor.db

# Uruchom ponownie
docker start drop-monitor
```

---

## Troubleshooting

### Kontener nie startuje

```bash
# Sprawdź logi
docker logs drop-monitor

# Sprawdź zmienne środowiskowe
docker exec drop-monitor env | grep DROP_
```

### Brak dostępu do API

1. Sprawdź czy kontener działa: `docker ps`
2. Sprawdź health check: `curl http://localhost:3000/api/health` (wewnątrz kontenera) lub `curl http://localhost:4110/api/health` (z hosta)
3. Sprawdź CORS origins w zmiennych środowiskowych
4. Sprawdź API key w requestach

### Problemy z bazą danych

```bash
# Sprawdź uprawnienia do pliku
docker exec drop-monitor ls -la /app/data/

# Sprawdź czy baza jest dostępna
docker exec drop-monitor sqlite3 /app/data/drop-monitor.db "SELECT COUNT(*) FROM war_hits;"
```

### Performance Issues

```bash
# Sprawdź użycie zasobów
docker stats drop-monitor

# Sprawdź rozmiar bazy
docker exec drop-monitor du -h /app/data/drop-monitor.db
```

---

## Security Best Practices

1. **Nigdy nie commituj pliku `.env`** z prawdziwymi kluczami API
2. **Używaj silnych API keys** (min. 32 znaki, losowe)
3. **Ogranicz CORS origins** tylko do zaufanych domen
4. **Regularnie aktualizuj dependencies**: `npm audit fix`
5. **Monitoruj logi** pod kątem podejrzanej aktywności
6. **Backup bazy danych** regularnie (codziennie/co tydzień)

---

## Performance Tuning

### Dla większego ruchu

Jeśli aplikacja obsługuje >1000 req/min, rozważ:

1. **Zwiększenie rate limitów** w `src/server.ts`
2. **Zwiększenie cache size** SQLite w `src/db.ts`
3. **Dodanie Redis** dla session/cache
4. **Load balancing** z wieloma instancjami

### Optymalizacja bazy danych

```sql
-- Uruchom VACUUM co miesiąc
VACUUM;

-- Sprawdź statystyki
ANALYZE;

-- Sprawdź rozmiar indeksów
SELECT name, SUM(pgsize) as size FROM dbstat GROUP BY name;
```
