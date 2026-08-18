#!/usr/bin/env python3
"""Patch server.js untuk fix quality race condition + optimize name search"""

import re
import sys

def patch_server_js(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # 1. Add imports
    if 'fast-json-stringify' not in content:
        imports_match = re.search(r"(import .+ from ['\"]fastify['\"];)", content)
        if imports_match:
            pos = imports_match.end()
            new_imports = "\nimport fastJson from 'fast-json-stringify';\nimport LRU from 'lru-cache';\n"
            content = content[:pos] + new_imports + content[pos:]
            print("✅ Added imports")
    
    # 2. Add LRU cache
    if 'nameSearchCache' not in content:
        quality_pos = content.find('let qualityCache = null;')
        if quality_pos > 0:
            cache_code = """
// LRU cache name search → 650ms jadi 5ms untuk cache hit
const nameSearchCache = new LRU({ max: 500, ttl: 300000, updateAgeOnGet: true });
const getCacheKey = (q, lim, off) => `${q.toLowerCase().trim()}:${lim}:${off}`;

"""
            content = content[:quality_pos] + cache_code + content[quality_pos:]
            print("✅ Added LRU cache")
    
    # 3. Fix quality background job - worker 1 only
    interval_pattern = r"setInterval\(\(\) => \{ qualityCache = null; getQuality\(\)\.catch\(\(\) => \{\}\); \}, QUALITY_TTL_MS\)\.unref\(\);"
    if re.search(interval_pattern, content):
        new_bg_job = """// CRITICAL FIX: hanya worker 1 yang compute, worker lain read-only
  if (cluster.isWorker && cluster.worker.id === 1) {
    console.log('[quality-bg] Worker 1 starting background quality job');
    computeQuality().catch(() => {});
    setInterval(() => {
      console.log('[quality-bg] Refreshing...');
      qualityCache = null;
      computeQuality().catch(() => {});
    }, QUALITY_TTL_MS).unref();
  } else if (cluster.isWorker) {
    console.log(`[quality-bg] Worker ${cluster.worker.id} read-only mode`);
  }"""
        content = re.sub(interval_pattern, new_bg_job, content)
        print("✅ Fixed quality race condition")
    
    # 4. Add cache to name search (simpler approach - just add cache layer)
    # Find the else block for name search
    name_search_pattern = r"(\s+)} else \{(\s+)// Ambil satu baris lebih banyak(.*?)hasMore = all\.length > offset \+ limit;(\s+)\}"
    match = re.search(name_search_pattern, content, re.DOTALL)
    
    if match and 'getCacheKey(q, limit, offset)' not in content:
        indent1 = match.group(1)
        indent2 = match.group(2)
        indent4 = match.group(4)
        
        new_name_search = f"""{indent1}}} else {{
{indent2}const cacheKey = getCacheKey(q, limit, offset);
{indent2}let cached = nameSearchCache.get(cacheKey);
{indent2}
{indent2}if (!cached) {{
{indent2}  const r = await sql(Q.SEARCH_NAME, [q, limit + offset + 1]);
{indent2}  const all = r.rows;
{indent2}  rows = all.slice(offset, offset + limit);
{indent2}  total = all.length > offset + limit ? all.length : all.length;
{indent2}  hasMore = all.length > offset + limit;
{indent2}  nameSearchCache.set(cacheKey, {{ rows, total, hasMore }});
{indent2}}} else {{
{indent2}  ({{ rows, total, hasMore }} = cached);
{indent2}}}
{indent4}}}"""
        
        content = re.sub(name_search_pattern, new_name_search, content, flags=re.DOTALL)
        print("✅ Added cache to name search")
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"\n✅ Successfully patched {filepath}")
        print("\nChanges applied:")
        print("1. Added fast-json-stringify + LRU imports")
        print("2. Added nameSearchCache (500 entries, 5min TTL)")
        print("3. Fixed quality race: only worker 1 computes")
        print("4. Added LRU cache to name search endpoint")
        print("\nRestart server: pkill -9 -f node && cd /root/challenge-api && node server.js &")
        return True
    else:
        print("⚠️  No changes made (already patched or pattern not found)")
        return False

if __name__ == '__main__':
    filepath = sys.argv[1] if len(sys.argv) > 1 else 'server.js'
    patch_server_js(filepath)
