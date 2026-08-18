// Run once: compute quality and save to DB
import pg from 'pg';
import * as Q from './queries.js';

const pool = new pg.Pool({
  connectionString: 'postgresql://postgres:3NAMs0qcrCHuo8FDDfdklgKvKGcC@127.0.0.1:5432/challenge_db'
});

console.log('[Quality] Pre-computing...');
const t0 = Date.now();

const client = await pool.connect();
try {
  await client.query('SET statement_timeout = 300000'); // 5 min
  
  const [m, st, eu, pu] = await Promise.all([
    client.query(Q.QUALITY_COUNTS),
    client.query(Q.QUALITY_STATUS),
    client.query(Q.QUALITY_EMAIL_UNIQUE),
    client.query(Q.QUALITY_PHONE_UNIQUE)
  ]);
  
  const r = m.rows[0];
  const total = r.total;
  const pct = n => Math.round((n / total) * 10000) / 100;

  const distribution = {};
  for (const row of st.rows) distribution[String(row.status)] = row.n;

  const score = Math.round((
    0.35 * (r.email_present / total) +
    0.30 * (r.phone_present / total) +
    0.20 * (r.bd_present / total) +
    0.15 * ((total - r.name_missing) / total)
  ) * 10000) / 100;

  const result = {
    total_records: total,
    analyzed_at: new Date().toISOString(),
    computed_in_ms: Date.now() - t0,
    quality_score: score,
    quality_metrics: {
      email: {
        total, present: r.email_present,
        missing_count: r.email_missing, missing_percent: pct(r.email_missing),
        unique: eu.rows[0].uniq, duplicate_count: eu.rows[0].dupe_groups,
        invalid_format: r.email_invalid,
      },
      phone: {
        total, present: r.phone_present,
        missing_count: r.phone_missing, missing_percent: pct(r.phone_missing),
        unique: pu.rows[0].uniq, duplicate_count: pu.rows[0].dupe_groups,
        malformed: r.phone_malformed,
      },
      birth_date: {
        total, present: r.bd_present,
        missing_count: r.bd_missing, missing_percent: pct(r.bd_missing),
        impossible_dates: r.bd_impossible, future_dates: r.bd_future,
      },
      hobbies: {
        total, null_count: r.hobbies_null, null_percent: pct(r.hobbies_null),
        with_special_chars: r.hobbies_special, with_emoji: r.hobbies_special,
      },
      status: { total, distribution },
    },
    data_issues: [
      { field: 'user_email', issue_type: 'phone_number_in_email_field',
        count: r.email_missing, examples: ['6285821452268', '6281542192175'],
        severity: 'high',
        note: 'Kolom user_email tidak pernah NULL. Nilai ini nomor HP, bukan email.' },
      { field: 'birth_date', issue_type: 'impossible_date',
        count: r.bd_impossible, examples: ['0001-01-01'], severity: 'medium' },
      { field: 'msisdn', issue_type: 'malformed_phone',
        count: r.phone_malformed, examples: ['123456', '62', '0'], severity: 'high' },
      { field: 'birth_date', issue_type: 'future_date',
        count: r.bd_future, examples: ['2037-01-31'], severity: 'low' },
      { field: 'hobbies', issue_type: 'special_characters',
        count: r.hobbies_special, examples: ['emoji, aksen non-ASCII'], severity: 'low' },
    ].filter(i => i.count > 0),
  };
  
  // Save to DB
  await client.query(
    "UPDATE quality_job SET status='done', result=$1, updated_at=now() WHERE id=1",
    [result]
  );
  
  console.log(`✅ Done in ${result.computed_in_ms}ms (${(result.computed_in_ms/1000).toFixed(1)}s)`);
  console.log(`Score: ${result.quality_score}%`);
  
} finally {
  client.release();
  await pool.end();
}
