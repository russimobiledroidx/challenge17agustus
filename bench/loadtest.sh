#!/bin/bash
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
DURATION="${2:-60}"
CONCURRENCY="${3:-100}"

echo "=== Load Test Round 5 ==="
echo "Target    : $BASE_URL/api/user-profile/:user_id"
echo "Duration  : ${DURATION}s"
echo "Concurrent: $CONCURRENCY"
echo

if ! curl -sf "$BASE_URL/api/health" >/dev/null; then
  echo "❌ API tidak hidup"
  exit 1
fi
echo "✅ API hidup"

# ID yang VALID dari database (sudah dicek dengan SELECT)
IDS=(21312686 74838118 70454533 48841312 16496066 35330960 67307032 25092082 19630545 36521393 20179892 25253629 26911378 21527340 35602578 36025920 33052270 26353422 26954994 26920838 29270919)

RANDOM_ID=${IDS[$RANDOM % ${#IDS[@]}]}
TEST_URL="$BASE_URL/api/user-profile/$RANDOM_ID"

echo "🎯 Testing: $TEST_URL"
echo

if command -v autocannon &> /dev/null; then
  autocannon -c "$CONCURRENCY" -d "$DURATION" -j "$TEST_URL" | tee /tmp/loadtest_result.json | jq '{
    requests_total: .requests.total,
    requests_persec: .requests.average,
    duration_sec: .duration,
    latency_avg_ms: .latency.mean,
    latency_p50_ms: .latency.p50,
    latency_p99_ms: .latency.p99,
    latency_max_ms: .latency.max,
    errors: .errors,
    timeouts: .timeouts,
    non2xx: (.non2xx // 0),
    success_rate_pct: (100 - (((.non2xx // 0) + .timeouts + .errors) / .requests.total * 100))
  }'
else
  echo "❌ autocannon tidak tersedia"
  exit 1
fi

echo
echo "✅ Selesai — /tmp/loadtest_result.json"
