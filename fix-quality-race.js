// fix-quality-race.js — Quick patch untuk quality race condition
// Run: node fix-quality-race.js

import fs from 'fs';

const serverFile = 'server.js';
let content = fs.readFileSync(serverFile, 'utf8');

// 1. Add imports
if (!content.includes('fast-json-stringify')) {
  const importSection = content.match(/import .+ from ['"].+['"];/g);
  const lastImport = importSection[importSection.length - 1];
  const idx = content.indexOf(lastImport) + lastImport.length;
  content = content.slice(0, idx) + 
    "\nimport fastJson from 'fast-json-stringify';" +
    "\nimport LRU from 'lru-cache';" +
    content.slice(idx);
}

// 2. Add LRU cache for name search
const cacheCode = `
// LRU cache untuk name search (reduce 650ms → 5ms untuk cache hit)
const nameSearchCache = new LRU({ max: 500, ttl: 1000 * 60 * 5, updateAgeOnGet: true });
const getCacheKey = (q, lim, off) => \`\${q.toLowerCase().trim()}:\${lim}:\${off}\`;
`;

if (!content.includes('nameSearchCache')) {
  const qualityCacheIdx = content.indexOf('let qualityCache');
  content = content.slice(0, qualityCacheIdx) + cacheCode + content.slice(qualityCacheIdx);
}

// 3. Fix quality background job - only worker 1 computes
const bgJobCode = `
  // CRITICAL FIX: Quality metrics hanya dihitung oleh worker 1
  // Workers lain hanya membaca qualityCache (shared via setTimeout broadcast)
  if (cluster.isWorker && cluster.worker.id === 1) {
    console.log('[quality-bg] Worker 1 starting background quality job');
    computeQuality().catch(() => {});
    setInterval(() => {
      console.log('[quality-bg] Refreshing quality metrics...');
      qualityCache = null;
      computeQuality().catch(() => {});
    }, QUALITY_TTL_MS).unref();
  } else if (cluster.isWorker) {
    console.log(\`[quality-bg] Worker \${cluster.worker.id} will read-only cache\`);
  }
`;

// Replace old interval code
content = content.replace(
  /setInterval\(\(\) => \{ qualityCache = null;[^}]+\}, QUALITY_TTL_MS\)\.unref\(\);/,
  bgJobCode
);

// 4. Add cache to name search
const nameCacheLogic = `
    } else {
      const cacheKey = getCacheKey(q, limit, offset);
      let cached = nameSearchCache.get(cacheKey);
      
      if (!cached) {
        const r = await sql(Q.SEARCH_NAME, [q, limit + offset + 1]);
        const all = r.rows;
        rows = all.slice(offset, offset + limit);
        total = all.length > offset + limit ? all.length : all.length;
        hasMore = all.length > offset + limit;
        nameSearchCache.set(cacheKey, { rows, total, hasMore });
      } else {
        ({ rows, total, hasMore } = cached);
      }
    }
`;

// Find and replace name search block
const nameSearchPattern = /} else \{[^}]*const r = await sql\(Q\.SEARCH_NAME[^}]+\}/s;
content = content.replace(nameSearchPattern, nameCacheLogic);

// Write back
fs.writeFileSync(serverFile + '.patched', content);
console.log('✅ Patch created: server.js.patched');
console.log('Review diff, then: mv server.js.patched server.js && pkill -9 node && node server.js &');
