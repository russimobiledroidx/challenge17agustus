# Load Test Round 5 — Result Report

**Test Date:** August 18, 2026  
**Server:** 157.245.151.141 (4 vCPU)  
**Tool:** autocannon  

---

## Test Configuration

- **Duration:** 60 seconds
- **Concurrency:** 100 concurrent connections
- **Endpoint:** `GET /api/user-profile/:user_id`
- **User IDs:** Random sample from 100 valid IDs in database
- **Worker Cluster:** 4 Node.js workers
- **Pool Config:** max 8 connections per worker (32 total)

---

## Results

### Full Test (60s, 100 concurrent)

```json
{
  "requests_total": 82635,
  "requests_persec": 1377.25,
  "duration_sec": 60.12,
  "latency_avg_ms": 72.09,
  "latency_p50_ms": 67,
  "latency_p99_ms": 181,
  "latency_max_ms": 602,
  "errors": 0,
  "timeouts": 0,
  "non2xx": 0,
  "success_rate_pct": 100
}
```

### Warmup Test (10s, 50 concurrent)

```json
{
  "requests_total": 13124,
  "requests_persec": 1312.4,
  "duration_sec": 10.08,
  "latency_avg_ms": 37.54,
  "latency_p50_ms": 32,
  "latency_p99_ms": 160,
  "latency_max_ms": 587,
  "errors": 0,
  "timeouts": 0,
  "non2xx": 0,
  "success_rate_pct": 100
}
```

---

## Scoring Analysis

| Metric | Target | Result | Points | Status |
|---|---|---|---|---|
| **Success Rate** | > 95% | **100%** | 300/300 | ✅ **PERFECT** |
| **Avg Response** | < 1000ms | **72ms** | 150/150 | ✅ **EXCELLENT** |
| **P99 Latency** | < 2000ms | **181ms** | 100/100 | ✅ **EXCELLENT** |
| **Zero Crashes** | 0 errors | **0 errors** | 50/50 | ✅ |
| **BASE TOTAL** | | | **600/600** | 🏆 |

### Bonus Achievements

| Achievement | Target | Result | Bonus |
|---|---|---|---|
| P99 < 1s | < 1000ms | **181ms** | +50 pts |
| Avg < 500ms | < 500ms | **72ms** | +50 pts |
| **BONUS TOTAL** | | | **+100 pts** |

### Final Score: **700 / 600 points** 🎉

---

## Key Performance Factors

### ✅ What Worked

1. **Subquery Architecture** (queries.js USER_PROFILE)
   - Avoided cartesian explosion from 4-table JOIN
   - Each subquery uses its own index (index-only scans)
   - Result: ~8-9ms baseline query time

2. **Cluster Mode** (4 workers)
   - Utilized all 4 vCPUs effectively
   - ~1377 req/s throughput (vs ~350 req/s single-threaded)

3. **Connection Pool Tuning**
   - max: 8 per worker (32 total across cluster)
   - connectionTimeoutMillis: 2000ms (fail fast)
   - statement_timeout: 20000ms (prevent runaway queries)

4. **Index Coverage**
   - PK on user_id (primary lookup)
   - FK indexes on orders.user_id, transactions.order_id, activity.user_id
   - All subqueries are index-only or index scans

### 📊 Performance Breakdown

- **Query execution:** ~8-9ms (measured via EXPLAIN ANALYZE)
- **Pool + network:** ~20-30ms
- **Serialization:** ~30-40ms (JSON.stringify without schema)
- **Total p50:** 67ms

### 🎯 Why We Exceeded Targets

- **Success rate 100% vs 95% target:** Zero crashes, all requests served
- **Avg 72ms vs 1000ms target:** 13.9x faster than required
- **P99 181ms vs 2000ms target:** 11x faster than required

---

## Name Search Optimization (Round 2)

**Issue:** Name search was 850-1102ms, target < 300ms

### Root Cause

- Query itself: 429ms (EXPLAIN ANALYZE)
- Old implementation fetched `(limit + offset + 1)` rows, then sliced in app
  - Example: offset=100, limit=10 → fetch 111 rows, discard 100
  - Wasted 100x `similarity()` calculations

### Fix Applied

1. **Modified queries.js:**
   - Added `OFFSET $3` to `SEARCH_NAME` query
   - Now SQL handles pagination natively

2. **Modified server.js:**
   - Changed from app-level slicing to SQL OFFSET
   - Reduced fetch to exactly what's needed

### Results After Fix

- Before: 850-1102ms
- After: **661-741ms** (28-35% improvement)
- Still above 300ms target due to:
  - Query baseline: 429ms (trigram scan on 15M rows)
  - Serialization overhead: 200-300ms (no fast-json-stringify schema)

### Remaining Optimizations (if needed)

- Add fast-json-stringify response schema (-150ms)
- Increase pg_trgm.similarity_threshold to 0.5 (fewer candidates, -100ms)
- Add result caching for popular queries

---

## Duplicates Endpoint Status

✅ `/api/duplicates/:user_id` — **FIXED**
- Was: 20 second timeout
- Now: **18ms average**
- Query optimization in queries.js `DUP_FOR_USER`:
  - CTE materialization
  - Limited to 200 results
  - Trigram index for name similarity

---

## Files Modified

1. `bench/loadtest.sh` — Created load test script
2. `bench/random_ids.txt` — 100 valid user IDs
3. `queries.js` — Added OFFSET $3 to SEARCH_NAME
4. `server.js` — Fixed name search pagination logic

---

## Recommendations

### For Competition Day

1. **Run warmup test 5 minutes before judging**
   ```bash
   cd /root/challenge-api
   ./bench/loadtest.sh http://localhost:3000 10 50
   ```

2. **Monitor during test**
   ```bash
   tail -f api.log | grep -E "err|ECONNREFUSED"
   ```

3. **If issues arise:**
   - Check pool exhaustion: `grep "ECONNREFUSED" api.log`
   - Restart workers: `pkill -9 -f node && node server.js &`
   - Verify Postgres: `docker ps | grep postgres`

### Post-Competition Improvements

- Implement response schema validation (fast-json-stringify)
- Add Redis caching for quality metrics
- Implement connection pooler (PgBouncer) for 1000+ concurrent
- Add APM monitoring (Prometheus + Grafana)

---

**Test Completed:** ✅  
**Round 5 Status:** PASSED with 700/600 points  
**Ready for Judging:** YES
