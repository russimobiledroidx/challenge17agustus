# API Documentation

**Customer Intelligence Platform — REST API**

Base URL: `http://localhost:3000` atau `http://157.245.151.141:3000`

---

## 📋 Table of Contents

1. [Authentication](#authentication)
2. [Health Check](#health-check)
3. [Search API](#search-api)
4. [Data Quality](#data-quality)
5. [Duplicate Detection](#duplicate-detection)
6. [User Profile](#user-profile)
7. [Error Handling](#error-handling)
8. [Rate Limiting](#rate-limiting)

---

## 🔐 Authentication

**Current version: No authentication required**

Future versions may implement API keys or JWT tokens.

---

## 1. Health Check

### GET /health
### GET /api/health

Check API and database connectivity.

**Performance Target:** < 500ms

#### Request

```http
GET /health HTTP/1.1
Host: localhost:3000
```

#### Response 200 OK

```json
{
  "status": "ready",
  "total_records": 15000000,
  "actual_records": 14999896,
  "database": "connected",
  "timestamp": "2026-08-17T10:30:45.123Z",
  "ok": true
}
```

#### Response Fields

| Field | Type | Description |
|---|---|---|
| `status` | string | Always "ready" if API is operational |
| `total_records` | integer | Spec-defined total (15M) |
| `actual_records` | integer | True count in database |
| `database` | string | Database connection status |
| `timestamp` | string (ISO 8601) | Server timestamp |
| `ok` | boolean | Quick health indicator |

#### Example

```bash
curl http://localhost:3000/health

# With jq for pretty output
curl -s http://localhost:3000/health | jq
```

---

## 2. Search API

### GET /api/search

Search customers by email, phone, user_id, or name.

**Performance Targets:**
- Email/Phone/User ID: < 100ms
- Name (fuzzy): < 300ms (actual: ~650ms with cache)

#### Request Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `q` | string | ✅ | Search query |
| `type` | string | ✅ | Search type: `email`, `phone`, `user_id`, `name` |
| `limit` | integer | ❌ | Results per page (default: 10, max: 100) |
| `offset` | integer | ❌ | Pagination offset (default: 0) |

#### Search Types

##### 1. Email Search

**Exact match, case-insensitive**

```http
GET /api/search?q=user@example.com&type=email&limit=10
```

**Response 200 OK**

```json
{
  "query": "user@example.com",
  "type": "email",
  "limit": 10,
  "offset": 0,
  "results": [
    {
      "user_id": 12345,
      "full_name": "John Doe",
      "user_email": "user@example.com",
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

##### 2. Phone Search

**Normalized match (08xx = 628xx = +628xx)**

```http
GET /api/search?q=081234567890&type=phone&limit=10
```

**Features:**
- Auto-normalization (removes +, spaces, hyphens)
- Compares last 9 digits
- Output masked for privacy: `0812*****890`

##### 3. User ID Search

**Exact match**

```http
GET /api/search?q=12345&type=user_id
```

**Note:** Returns single result or empty array

##### 4. Name Search (Fuzzy)

**Trigram similarity matching**

```http
GET /api/search?q=john&type=name&limit=10&offset=0
```

**Features:**
- Partial match
- Typo-tolerant
- Similarity score included
- Sorted by relevance

**Response includes similarity:**

```json
{
  "results": [
    {
      "user_id": 12345,
      "full_name": "John Doe",
      "sim": 0.85,
      ...
    }
  ]
}
```

#### Response Fields

| Field | Type | Description |
|---|---|---|
| `user_id` | integer | Unique user identifier |
| `full_name` | string \| null | Customer full name |
| `user_email` | string \| null | Email address |
| `email_valid` | boolean | True if email format valid |
| `msisdn` | string \| null | Phone number (masked: `0812*****890`) |
| `status` | integer | User status (-2, -1, 0, 1, 2, 3) |
| `created_at` | string | Account creation timestamp |
| `sim` | number | Name similarity score (name search only, 0-1) |

#### Error Responses

**400 Bad Request — Missing query**

```json
{
  "error": "parameter q wajib diisi",
  "query": "",
  "type": "email"
}
```

**400 Bad Request — Invalid type**

```json
{
  "error": "type tidak dikenal: invalid",
  "allowed": ["email", "phone", "user_id", "name"]
}
```

**400 Bad Request — Invalid phone**

```json
{
  "error": "nomor telepon minimal 9 digit",
  "query": "123"
}
```

#### Examples

```bash
# Email search
curl "http://localhost:3000/api/search?q=test@example.com&type=email"

# Phone search (normalized)
curl "http://localhost:3000/api/search?q=081234567890&type=phone"
curl "http://localhost:3000/api/search?q=%2B6281234567890&type=phone"  # Same result

# Name search with pagination
curl "http://localhost:3000/api/search?q=john&type=name&limit=20&offset=40"

# User ID search
curl "http://localhost:3000/api/search?q=29270919&type=user_id"
```

---

## 3. Data Quality

### GET /api/quality

Comprehensive data quality metrics across 15M records.

**Performance:** < 1s (cached, refreshes every 60s)

#### Request

```http
GET /api/quality HTTP/1.1
Host: localhost:3000
```

#### Response 200 OK

```json
{
  "total_records": 14999896,
  "analyzed_at": "2026-08-17T10:30:45.123Z",
  "computed_in_ms": 35420,
  "quality_score": 85.5,
  "quality_metrics": {
    "email": {
      "total": 14999896,
      "present": 13799896,
      "missing_count": 1200000,
      "missing_percent": 8.0,
      "unique": 13500000,
      "duplicate_count": 11605,
      "invalid_format": 2840927
    },
    "phone": {
      "total": 14999896,
      "present": 12052001,
      "missing_count": 2947895,
      "missing_percent": 19.65,
      "unique": 8500000,
      "duplicate_count": 3552001,
      "malformed": 125000
    },
    "birth_date": {
      "total": 14999896,
      "present": 7015054,
      "missing_count": 7984842,
      "missing_percent": 53.2,
      "impossible_dates": 1019932,
      "future_dates": 220
    },
    "hobbies": {
      "total": 14999896,
      "null_count": 14474748,
      "null_percent": 96.5,
      "with_special_chars": 299663,
      "with_emoji": 299663
    },
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
      "field": "full_name",
      "issue_type": "system_error_literal",
      "count": 194403,
      "examples": ["[CHARACTER_NOT_ALLOWED]"],
      "severity": "high"
    },
    {
      "field": "email",
      "issue_type": "phone_in_email_field",
      "count": 2840927,
      "examples": ["6285821452268"],
      "severity": "high"
    },
    {
      "field": "birth_date",
      "issue_type": "impossible_date",
      "count": 1019932,
      "examples": ["0001-01-01"],
      "severity": "medium"
    }
  ]
}
```

#### Response 202 Accepted — Computing

If metrics not yet cached:

```json
{
  "status": "computing",
  "message": "Agregasi 15 juta baris sedang berjalan di background. Coba lagi dalam beberapa detik.",
  "retry_after": 5
}
```

**Note:** Computation runs in background. Retry after 5-10 seconds.

### GET /api/metrics

Compact quality summary.

#### Response 200 OK

```json
{
  "duplicates": 11605,
  "missing_fields": 2947895,
  "quality_score": 85.5,
  "analyzed_at": "2026-08-17T10:30:45.123Z"
}
```

#### Quality Score Formula

```
quality_score = weighted average of field completeness
              = 35% email + 30% phone + 20% birth_date + 15% name
```

#### Examples

```bash
# Full metrics
curl http://localhost:3000/api/quality | jq

# Compact summary
curl http://localhost:3000/api/metrics | jq

# Check if ready (should be 200, not 202)
curl -i http://localhost:3000/api/quality
```

---

## 4. Duplicate Detection

### GET /api/duplicates/find

Find potential duplicate accounts by detection method.

**Performance:** < 2s per method

#### Request Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `method` | string | ✅ | Detection method (see below) |
| `limit` | integer | ❌ | Max groups to return (default: 50, max: 200) |

#### Detection Methods

| Method | Confidence | Description |
|---|---|---|
| `ip_address` | High | Users sharing same IP (same device/location) |
| `email` | High | Exact email match (case-insensitive) |
| `phone` | High | Exact phone match (normalized) |
| `order` | Medium | Similar purchase patterns |
| `activity` | Low | Similar activity timestamps |

#### Request Example

```http
GET /api/duplicates/find?method=ip_address&limit=50
```

#### Response 200 OK

```json
{
  "method": "ip_address",
  "duplicate_groups": [
    {
      "group_id": 1,
      "shared_attribute": "192.168.206.236",
      "attribute_type": "ip_address",
      "user_count": 57,
      "user_ids": [311790, 577471, 589983, 17487790, ...],
      "user_names": ["User A", "User B", "User C", ...],
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

### GET /api/duplicates/:user_id

Find all potential duplicates for specific user.

**Performance:** < 100ms

#### Request Example

```http
GET /api/duplicates/29270919
```

#### Response 200 OK

```json
{
  "user_id": 29270919,
  "duplicates": [
    {
      "user_id": 67890,
      "full_name": "Similar Name",
      "user_email": "same@email.com",
      "msisdn": "0812*****890",
      "email_match": true,
      "phone_match": false,
      "name_similarity": 0.85,
      "overall_score": 0.92,
      "confidence": "high"
    }
  ],
  "count": 3,
  "took_ms": 18.45
}
```

**Score calculation:**
```
overall_score = 0.5 * email_match + 0.3 * phone_match + 0.2 * name_similarity
```

#### Response 404 Not Found

```json
{
  "error": "user tidak ditemukan",
  "user_id": 999999999
}
```

### POST /api/duplicates

Alternative method (returns all high-confidence duplicates).

#### Request

```http
POST /api/duplicates HTTP/1.1
Content-Type: application/json

{}
```

#### Response

Same as GET `/api/duplicates/find?method=email` (top email duplicates).

#### Examples

```bash
# IP-based duplicates
curl "http://localhost:3000/api/duplicates/find?method=ip_address&limit=10"

# Email duplicates
curl "http://localhost:3000/api/duplicates/find?method=email&limit=50"

# Check specific user
curl "http://localhost:3000/api/duplicates/29270919"

# POST method
curl -X POST http://localhost:3000/api/duplicates \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## 5. User Profile

### GET /api/user-profile/:user_id

Get complete user profile with orders, transactions, and activity.

**Performance:** 
- Single request: ~9ms
- Under load (100 concurrent): 72ms avg, 181ms p99

**Joins 4 tables:** user + orders + transactions + activity

#### Request Example

```http
GET /api/user-profile/29270919 HTTP/1.1
```

#### Response 200 OK

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
      },
      {
        "activity_type": "BROWSE",
        "activity_timestamp": "2026-08-15T14:30:05Z",
        "ip_address": "192.168.1.1"
      }
    ]
  },
  "took_ms": 9.21
}
```

#### Response Fields

**Profile:**
- Same fields as search results
- `email_valid`: Boolean flag (true if valid email format)
- `msisdn`: Masked phone number

**Orders:**
- `count`: Total orders
- `total_amount`: Sum of all order amounts

**Transactions:**
- `total_amount`: Sum of all transaction amounts

**Activity:**
- `count`: Total activities
- `last_activity`: Most recent activity timestamp
- `recent`: Last 20 activities (array)

#### Response 404 Not Found

```json
{
  "error": "user tidak ditemukan",
  "user_id": 999999999
}
```

#### Examples

```bash
# Basic request
curl http://localhost:3000/api/user-profile/29270919

# Pretty print
curl -s http://localhost:3000/api/user-profile/29270919 | jq

# Extract specific fields
curl -s http://localhost:3000/api/user-profile/29270919 | jq '.profile.full_name, .orders.count'

# Performance measurement
curl -w "\nTime: %{time_total}s\n" http://localhost:3000/api/user-profile/29270919
```

---

## 6. Error Handling

### Standard Error Response

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": { "additional": "context" }
}
```

### HTTP Status Codes

| Code | Meaning | When |
|---|---|---|
| **200** | OK | Successful request |
| **202** | Accepted | Quality metrics computing (retry in 5s) |
| **400** | Bad Request | Invalid parameters |
| **404** | Not Found | Resource not found (user, etc.) |
| **500** | Internal Server Error | Unexpected error |
| **503** | Service Unavailable | Database down |

### Common Errors

**400 — Invalid search type:**
```json
{
  "error": "type tidak dikenal: invalid_type",
  "allowed": ["email", "phone", "user_id", "name"]
}
```

**400 — Missing query parameter:**
```json
{
  "error": "parameter q wajib diisi",
  "query": "",
  "type": "email"
}
```

**404 — User not found:**
```json
{
  "error": "user tidak ditemukan",
  "user_id": 999999999
}
```

**500 — Database error:**
```json
{
  "error": "database query failed",
  "code": "DB_ERROR"
}
```

---

## 7. Rate Limiting

**Current version: No rate limiting**

Future versions may implement:
- 100 requests/minute per IP
- 1000 requests/hour per API key

---

## 8. OpenAPI Specification

### Swagger UI

**Available at:** `http://localhost:3000/docs` (if enabled)

### OpenAPI JSON

Download spec: `http://localhost:3000/api-docs.json`

---

## 📊 Performance Summary

| Endpoint | Target | Actual | Notes |
|---|---|---|---|
| `/health` | < 500ms | ~5ms | Cached estimate |
| `/api/search?type=email` | < 100ms | ~45ms | Index scan |
| `/api/search?type=phone` | < 100ms | ~50ms | Normalized match |
| `/api/search?type=name` | < 300ms | ~650ms | Trigram scan, cache helps |
| `/api/quality` | < 1s | < 1ms | Cached (refresh 60s) |
| `/api/duplicates/find` | < 2s | ~450ms | IP method |
| `/api/user-profile/:id` | N/A | ~9ms | 4-table JOIN |
| **Load test (100 concurrent)** | > 95% success | **100%** | 72ms avg, 181ms p99 |

---

## 🔧 Best Practices

### Pagination

```bash
# First page
curl "http://localhost:3000/api/search?q=john&type=name&limit=20&offset=0"

# Second page
curl "http://localhost:3000/api/search?q=john&type=name&limit=20&offset=20"

# Check has_more field
jq '.has_more' response.json
```

### Caching

- Name search results cached (5 min TTL, 500 entries)
- Quality metrics cached (60s refresh)
- Cache key: `query:limit:offset`

### Error Recovery

```bash
# Retry logic for 202 Accepted
while true; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/quality)
  if [ "$STATUS" = "200" ]; then
    curl http://localhost:3000/api/quality
    break
  fi
  echo "Computing... retry in 5s"
  sleep 5
done
```

---

## 📝 Changelog

**v1.0.0 — August 2026**
- Initial release
- All 5 rounds implemented
- Load test verified (100% success rate)

---

**API Documentation — 17 Agustus Coding Festival ✅**
