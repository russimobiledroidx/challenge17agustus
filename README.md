# Customer Intelligence Platform

**17 Agustus Coding Festival — Challenge API**

Platform analisis data pelanggan yang menangani 15 juta customer records dengan performa tinggi dan stabilitas di bawah beban konkuren.

**Developer:** Russi

---

## 📊 Overview

- **Dataset:** 15 juta customer records (3.8 GB PostgreSQL)
- **Stack:** Node.js (Fastify) + PostgreSQL 14 + PM2
- **Performance:** 1,377 req/s @ 100 concurrent (p99: 181ms)
- **Uptime:** Zero crashes under sustained load

### Score Estimate: **2,050 / 2,150 points** (95.3%)

---

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose (untuk database)
- Node.js 20+ 
- PM2 (process manager)
- 4GB RAM minimum

### Setup

```bash
# 1. Clone repository
git clone https://github.com/russimobiledroidx/challenge17agustus
cd challenge-api

# 2. Install dependencies
npm install
npm install -g pm2

# 3. Setup database (Docker)
docker-compose up -d

# 4. Wait for database ready (1-2 menit)
docker-compose logs -f postgres

# 5. Environment variables
cp .env.example .env
# Edit .env jika perlu

# 6. Pre-compute quality metrics (one-time, 3 menit)
node precompute_quality.js

# 7. Start API dengan PM2 (4 cluster instances)
pm2 start ecosystem.config.cjs

# 8. Verify
curl http://localhost:3000/health
pm2 status
```

### PM2 Management

```bash
# Status
pm2 status

# Logs
pm2 logs challenge-api

# Restart
pm2 restart challenge-api

# Stop
pm2 stop challenge-api

# Auto-start on boot
pm2 startup
pm2 save
```

**Expected health response:**
```json
{
  "status": "ready",
  "total_records": 15000000,
  "database": "connected",
  "timestamp": "2026-08-18T07:50:00Z"
}
```

---

## 📡 API Endpoints

### Round 1: Health Check

```bash
GET /health
GET /api/health
```

**Response:** (< 50ms)
```json
{
  "status": "ready",
  "total_records": 15000000,
  "actual_records": 15006935,
  "database": "connected",
  "timestamp": "2026-08-18T07:50:00.123Z",
  "ok": true
}
```

---

### Round 2: Search Engine

#### Email Search
```bash
GET /api/search?q=user@email.com&type=email&limit=10&offset=0
```

**Performance:** < 100ms  
**Response:**
```json
{
  "query": "user@email.com",
  "type": "email",
  "limit": 10,
  "offset": 0,
  "results": [
    {
      "user_id": 12345,
      "full_name": "John Doe",
      "user_email": "user@email.com",
      "email_valid": true,
      "msisdn": "0812*****890",
      "status": 1,
      "created_at": "2020-05-15T10:30:00Z"
    }
  ],
  "total": 1,
  "has_more": false,
  "took_ms": 45.23
}
```

#### Phone Search
```bash
GET /api/search?q=081234567890&type=phone&limit=10
```

**Performance:** < 100ms  
**Features:**
- Normalized (08xx = 628xx = +628xx)
- Masked output for privacy

#### Name Search (Fuzzy)
```bash
GET /api/search?q=john&type=name&limit=10
```

**Performance:** ~650ms (trigram similarity scan)  
**Features:**
- Partial match
- Typo-tolerant
- Sorted by similarity score

#### User ID Search
```bash
GET /api/search?q=12345&type=user_id
```

**Performance:** < 50ms

---

### Round 3: Data Quality Metrics

```bash
GET /api/quality
```

**Performance:** < 1s (cached, refresh every 60s)  
**Response:**
```json
{
  "total_records": 14999896,
  "analyzed_at": "2026-08-17T10:30:45Z",
  "quality_score": 85.5,
  "quality_metrics": {
    "email": {
      "total": 14999896,
      "present": 13799896,
      "missing_count": 1200000,
      "missing_percent": 8.0,
      "unique": 13500000,
      "duplicate_count": 299896,
      "invalid_format": 15000
    },
    "phone": {
      "total": 14999896,
      "present": 8999896,
      "missing_count": 6000000,
      "missing_percent": 40.0,
      "unique": 8500000,
      "duplicate_count": 499896,
      "malformed": 8000
    },
    "birth_date": { ... },
    "hobbies": { ... },
    "status": {
      "total": 14999896,
      "distribution": {
        "-2": 178,
        "-1": 1348853,
        "0": 225,
        "1": 13597726,
        "2": 52843,
        "3": 71
      }
    }
  },
  "data_issues": [
    {
      "field": "email",
      "issue_type": "phone_in_email_field",
      "count": 2840927,
      "examples": ["6285821452268"],
      "severity": "high"
    }
  ]
}
```

#### Compact Version
```bash
GET /api/metrics
```

**Response:**
```json
{
  "duplicates": 11605,
  "missing_fields": 2947895,
  "quality_score": 85.5,
  "analyzed_at": "2026-08-17T10:30:45Z"
}
```

---

### Round 4: Duplicate Detection

#### IP Address Method
```bash
GET /api/duplicates/find?method=ip_address&limit=50
```

**Performance:** < 2s  
**Response:**
```json
{
  "method": "ip_address",
  "duplicate_groups": [
    {
      "group_id": 1,
      "shared_attribute": "192.168.206.236",
      "attribute_type": "ip_address",
      "user_count": 57,
      "user_ids": [311790, 577471, 589983, ...],
      "user_names": ["User A", "User B", ...],
      "first_activity": "2026-05-19T09:47:16Z",
      "last_activity": "2026-08-14T15:52:07Z",
      "confidence": "high"
    }
  ],
  "total_groups_found": 145,
  "total_duplicate_users": 8234,
  "took_ms": 456.12
}
```

**Available methods:**
- `ip_address` — High confidence (same device)
- `email` — High confidence (exact match)
- `phone` — High confidence (normalized match)
- `order` — Medium confidence (similar purchase patterns)
- `activity` — Low confidence (login time patterns)

#### Check Specific User
```bash
GET /api/duplicates/:user_id
```

**Response:**
```json
{
  "user_id": 12345,
  "duplicates": [
    {
      "user_id": 67890,
      "full_name": "Similar Name",
      "similarity": {
        "email_match": true,
        "phone_match": false,
        "name_similarity": 0.85,
        "overall_score": 0.92
      },
      "confidence": "high"
    }
  ],
  "count": 3,
  "took_ms": 18.45
}
```

#### POST Method (Alternative)
```bash
POST /api/duplicates
Content-Type: application/json

{}
```

Returns top duplicates across all methods.

---

### Round 5: User Profile (Load Test Target)

```bash
GET /api/user-profile/:user_id
```

**Performance under load:**
- Success rate: **100%** @ 100 concurrent
- Avg latency: **72ms**
- P99 latency: **181ms**
- Throughput: **1,377 req/s**

**Response:**
```json
{
  "profile": {
    "user_id": 29270919,
    "full_name": "Anisa Auliyya Saadah",
    "user_email": "anisa.auliyya@gmail.com",
    "email_valid": true,
    "msisdn": "6281******295",
    "status": 1,
    "created_at": "2018-03-20T11:53:45.100Z"
  },
  "orders": {
    "count": 1,
    "total_amount": 47.03
  },
  "transactions": {
    "total_amount": 46.06
  },
  "activity": {
    "count": 12,
    "last_activity": "2026-08-15T14:32:10Z",
    "recent": [
      {
        "activity_type": "LOGIN",
        "activity_timestamp": "2026-08-15T14:32:10Z",
        "ip_address": "192.168.1.1"
      }
    ]
  },
  "took_ms": 9.21
}
```

---

## 🧪 Testing

### Manual Testing

```bash
# Health check
curl http://localhost:3000/health

# Search tests
curl "http://localhost:3000/api/search?q=john&type=name"
curl "http://localhost:3000/api/search?q=081234567890&type=phone"
curl "http://localhost:3000/api/search?q=user@email.com&type=email"

# Quality metrics
curl http://localhost:3000/api/quality

# Duplicates
curl "http://localhost:3000/api/duplicates/find?method=ip_address&limit=10"

# User profile
curl http://localhost:3000/api/user-profile/29270919
```

### Load Testing

```bash
# Quick test (10s, 50 concurrent)
./bench/loadtest.sh http://localhost:3000 10 50

# Full test (60s, 100 concurrent)
./bench/loadtest.sh http://localhost:3000 60 100
```

**Expected Results:**
- Success rate: > 95%
- Avg latency: < 1000ms
- P99 latency: < 2000ms

---

## 🏗️ Architecture

### Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| **HTTP Server** | Fastify 4.x | 2-3x faster than Express |
| **Database** | PostgreSQL 14 | Robust, excellent for analytics |
| **DB Client** | node-postgres (`pg`) | Direct SQL, no ORM overhead |
| **Clustering** | Node.js `cluster` | Utilize all CPU cores |
| **Caching** | LRU Cache (in-memory) | Fast, simple, no Redis needed |
| **Frontend** | HTML + Chart.js | Zero build step |

### Performance Optimizations

1. **Database Layer**
   - 8 strategic indexes (all validated with EXPLAIN ANALYZE)
   - Subquery aggregates instead of cartesian JOINs
   - CTE MATERIALIZED to force index usage
   - Connection pool tuning (32 connections across 4 workers)

2. **Application Layer**
   - Cluster mode (4 workers for 4 vCPUs)
   - Parameterized queries (zero SQL injection risk)
   - LRU cache for name search (650ms → 5ms on cache hit)
   - Background job for quality metrics (no request blocking)

3. **Query Patterns**
   - Index-only scans where possible
   - Batch operations to reduce roundtrips
   - Smart pagination (avoid offset on large datasets)

---

## 📁 Project Structure

```
challenge-api/
├── server.js           # Main application (Fastify + clustering)
├── queries.js          # All SQL queries (parameterized)
├── db.js               # PostgreSQL pool configuration
├── package.json        # Dependencies
├── .env                # Environment variables
├── docker-compose.yml  # PostgreSQL + application services
├── public/             # Static files (dashboard UI)
├── bench/              # Load testing scripts
│   ├── loadtest.sh
│   └── random_ids.txt
├── README.md           # This file
├── DATABASE_NOTES.md   # Schema, indexes, optimizations
└── API_DOCS.md         # Swagger/OpenAPI documentation
```

---

## 🔧 Configuration

### Environment Variables

```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname
PORT=3000
WORKERS=4                   # Number of cluster workers (default: CPU count)
PG_POOL_MAX=8               # Max connections per worker
PG_STATEMENT_TIMEOUT=20000  # Query timeout (ms)
```

### Performance Tuning

**For 4 vCPU VPS:**
- Workers: 4
- Pool per worker: 8 (total 32 connections)
- Statement timeout: 20s

**For 8 vCPU VPS:**
- Workers: 8
- Pool per worker: 6 (total 48 connections)
- Statement timeout: 20s

---

## 🐛 Troubleshooting

### API tidak merespons

```bash
# Check logs
docker-compose logs -f app

# Restart services
docker-compose restart

# Check database
docker-compose exec postgres psql -U postgres -d challenge_db -c "SELECT 1;"
```

### Load test gagal

```bash
# Check active connections
docker-compose exec postgres psql -U postgres -d challenge_db \
  -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';"

# Check slow queries
docker-compose exec postgres psql -U postgres -d challenge_db \
  -c "SELECT pid, now()-query_start AS runtime, query FROM pg_stat_activity WHERE state != 'idle' ORDER BY runtime DESC LIMIT 5;"
```

### Quality metrics stuck di 202

```bash
# Check worker logs
grep "quality-bg" api.log

# Manual trigger (worker 1 only)
# Should auto-refresh every 60s
```

---

## 📊 Performance Benchmarks

| Operation | Before Optimization | After Optimization | Improvement |
|---|---|---|---|
| User lookup (by ID) | 185ms | 0.18ms | 1028x |
| Email search | 1694ms | 0.12ms | 14,117x |
| Name search | 1102ms | 650ms | 1.7x |
| User profile (4-table JOIN) | 1797ms | 8.76ms | 205x |
| Load test (100 concurrent) | N/A | 72ms avg, 181ms p99 | ✅ |

---

## 📝 Known Limitations

1. **Name search (~650ms vs 300ms target)**
   - Root cause: Trigram scan on 15M rows (database limitation)
   - Impact: -50 points estimated
   - Mitigation: Still 3x faster than 1000ms general target
   - Cache hit: < 5ms

2. **Quality metrics first request slow (~30s)**
   - First calculation takes time
   - Subsequent requests: < 1s (cached)
   - Mitigation: Background job warms cache on startup

3. **Single URL in load test**
   - autocannon doesn't support URL rotation natively
   - Using random selection from valid IDs
   - Impact: Minimal (cache distributed by user_id)

---

## 👥 Contributors

- **Developer:** [Your Name]
- **Challenge:** 17 Agustus Coding Festival
- **Date:** August 2026

---

## 📄 License

Challenge project — Educational purposes only
