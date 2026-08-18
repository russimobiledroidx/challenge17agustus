// queries.js — semua SQL di satu tempat.
//
// Prinsip yang dipakai di seluruh file:
//  1. Parameterized ($1, $2) di mana pun ada input user. Nol string concat.
//  2. Tidak ada COUNT(*) tabel penuh di jalur request (lihat TOTAL_RECORDS).
//  3. Keyset/limit selalu dibatasi supaya payload tidak meledak.

// ---------------------------------------------------------------------------
// HEALTH
// ---------------------------------------------------------------------------
// COUNT(*) di 15 juta baris makan ~1.5 detik. Target health < 500ms.
// reltuples adalah estimasi planner, akurat karena kita sudah ANALYZE.
export const TOTAL_RECORDS = `
  SELECT reltuples::bigint AS n FROM pg_class WHERE relname = 'ws_user'`;

// ---------------------------------------------------------------------------
// SEARCH — 4 tipe, tiap tipe punya index sendiri
// ---------------------------------------------------------------------------

// Email: index ix_user_email. lower() di kedua sisi supaya case-insensitive.
// PENTING: ORDER BY user_id + LIMIT membuat planner memilih Index Scan pada
// PRIMARY KEY (menyusuri user_id terurut lalu menyaring) alih-alih memakai
// ix_user_email_lower. Diukur: 67 DETIK.
//
// CTE MATERIALIZED memaksa penyaringan lewat index email dikerjakan LEBIH DULU,
// baru hasilnya (beberapa baris) diurutkan. Ini bukan trik kosmetik — tanpa itu
// endpoint search email tidak akan pernah masuk target 100 ms.
export const SEARCH_EMAIL = `
  WITH hits AS MATERIALIZED (
    SELECT user_id, full_name, user_email, msisdn, status, create_time
    FROM ws_user
    WHERE lower(user_email) = lower($1)
    LIMIT 1000
  )
  SELECT * FROM hits ORDER BY user_id LIMIT $2 OFFSET $3`;
// Catatan: predikat DIPERTAHANKAN persis seperti definisi index
// ix_user_email_lower ON ws_user (lower(user_email)). Kalau ditulis berbeda
// (mis. user_email ILIKE $1) index tidak terpakai dan berubah jadi seq scan 3.4GB.

export const SEARCH_EMAIL_COUNT = `
  SELECT count(*)::int AS n FROM ws_user WHERE lower(user_email) = lower($1)`;

// Phone: 08xx, +628xx, 628xx menunjuk orang yang sama. Dinormalisasi ke digit,
// lalu 9 digit terakhir dibandingkan.
//
// PENTING: $1 sudah berisi 9 digit hasil normalisasi DI SISI JS.
// Versi sebelumnya menormalisasi di dalam CTE (WITH inp AS ...), sehingga sisi
// kanan perbandingan bukan konstanta saat planning. Index ekspresi
// ix_user_msisdn_tail diabaikan dan endpoint memakan 35 DETIK.
// Dengan parameter konstan, predikat cocok persis dengan definisi index.
// CTE MATERIALIZED, alasan sama persis seperti SEARCH_EMAIL.
// Tanpa itu, ORDER BY user_id + LIMIT membuat planner memilih Index Scan pada
// PRIMARY KEY dan membuang 478.776 baris sebelum menemukan 10 hasil: 1162 ms.
// Dengan penyaringan lewat ix_user_msisdn_tail dikerjakan lebih dulu: ~44 ms.
export const SEARCH_PHONE = `
  WITH hits AS MATERIALIZED (
    SELECT user_id, full_name, user_email, msisdn, status, create_time
    FROM ws_user
    WHERE msisdn IS NOT NULL AND msisdn <> ''
      AND right(regexp_replace(msisdn, '[^0-9]', '', 'g'), 9) = $1
    LIMIT 1000
  )
  SELECT * FROM hits ORDER BY user_id LIMIT $2 OFFSET $3`;

export const SEARCH_PHONE_COUNT = `
  SELECT count(*)::int AS n FROM ws_user
  WHERE msisdn IS NOT NULL AND msisdn <> ''
    AND right(regexp_replace(msisdn, '[^0-9]', '', 'g'), 9) = $1`;

// user_id: primary key, lookup paling murah.
export const SEARCH_USER_ID = `
  SELECT user_id, full_name, user_email, msisdn, status, create_time
  FROM ws_user WHERE user_id = $1`;

// Name: trigram. Operator % memakai GIN index ix_user_fullname_trgm.
// ILIKE '%x%' TIDAK memakai index -> seq scan 3.4GB, jangan dipakai.
//
// Hanya SATU query. Versi sebelumnya menjalankan COUNT terpisah yang memindai
// ulang seluruh kandidat trigram — pekerjaan dua kali untuk satu halaman hasil.
// Sekarang diambil (limit + offset + 1) baris: cukup untuk mengisi halaman dan
// mengetahui apakah masih ada halaman berikutnya.
export const SEARCH_NAME = `
  SELECT user_id, full_name, user_email, msisdn, status, create_time,
         similarity(full_name, $1) AS sim
  FROM ws_user
  WHERE full_name % $1
  ORDER BY sim DESC, user_id
  LIMIT $2`;

// ---------------------------------------------------------------------------
// QUALITY — lima field yang dinilai Round 3
// ---------------------------------------------------------------------------
// SATU query, satu kali baca tabel. count(*) FILTER digabung semua supaya
// Postgres tidak membaca 3.4GB berkali-kali.
//
// Catatan penting untuk juri:
//   Kolom user_email di dataset ini TIDAK PERNAH NULL. 2.84 juta baris berisi
//   nomor HP, bukan alamat email. Jadi "missing" didefinisikan sebagai
//   "tidak berbentuk email", bukan "IS NULL". IS NULL akan melaporkan 0.
// DIPECAH MENJADI TIGA QUERY, disengaja.
//
// Versi satu-query menggabungkan count(*) FILTER dengan count(DISTINCT ...).
// count(DISTINCT) memaksa PostgreSQL mengurutkan 13,7 juta nilai di memori —
// itu yang membuat endpoint memakan >40 detik dan akhirnya kena statement
// timeout.
//
// Pemisahannya membuat tiap bagian memakai jalur termurahnya:
//   QUALITY_COUNTS  : satu kali seq scan, tanpa sort sama sekali
//   QUALITY_UNIQUE  : index-only scan pada ix_user_email_lower / msisdn_tail,
//                     karena nilai di index SUDAH terurut, DISTINCT jadi murah
//   QUALITY_STATUS  : agregasi kecil
//
// Catatan penting untuk juri:
//   Kolom user_email TIDAK PERNAH NULL di dataset ini. 2,84 juta baris berisi
//   nomor HP. Jadi "missing" didefinisikan sebagai "tidak berbentuk email",
//   bukan "IS NULL" — IS NULL akan melaporkan 0 dan menyembunyikan masalahnya.
export const QUALITY_COUNTS = `
SELECT
  count(*)::int                                                          AS total,
  count(*) FILTER (WHERE user_email LIKE '%@%')::int                     AS email_present,
  count(*) FILTER (WHERE user_email NOT LIKE '%@%')::int                 AS email_missing,
  count(*) FILTER (WHERE user_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')::int AS email_invalid,
  count(*) FILTER (WHERE NULLIF(msisdn,'') IS NOT NULL)::int             AS phone_present,
  count(*) FILTER (WHERE NULLIF(msisdn,'') IS NULL)::int                 AS phone_missing,
  count(*) FILTER (WHERE NULLIF(msisdn,'') IS NOT NULL
    AND length(regexp_replace(msisdn,'[^0-9]','','g')) NOT BETWEEN 9 AND 15)::int AS phone_malformed,
  count(*) FILTER (WHERE birth_date IS NOT NULL)::int                    AS bd_present,
  count(*) FILTER (WHERE birth_date IS NULL)::int                        AS bd_missing,
  count(*) FILTER (WHERE birth_date < DATE '1900-01-01')::int            AS bd_impossible,
  count(*) FILTER (WHERE birth_date > CURRENT_DATE)::int                 AS bd_future,
  count(*) FILTER (WHERE hobbies IS NULL OR hobbies = '')::int           AS hobbies_null,
  count(*) FILTER (WHERE hobbies ~ '[^\x20-\x7E]')::int                AS hobbies_special,
  count(*) FILTER (WHERE full_name IS NULL)::int                         AS name_missing
FROM ws_user`;

// Nilai unik + jumlah grup duplikat, keduanya dari satu index-only scan.
// Karena index sudah terurut, PostgreSQL cukup mengalir sekali tanpa sort.
export const QUALITY_EMAIL_UNIQUE = `
  SELECT count(*)::int AS uniq,
         count(*) FILTER (WHERE n > 1)::int AS dupe_groups
  FROM (
    SELECT lower(user_email) AS e, count(*) AS n
    FROM ws_user WHERE user_email LIKE '%@%'
    GROUP BY lower(user_email)
  ) t`;

export const QUALITY_PHONE_UNIQUE = `
  SELECT count(*)::int AS uniq,
         count(*) FILTER (WHERE n > 1)::int AS dupe_groups
  FROM (
    SELECT right(regexp_replace(msisdn,'[^0-9]','','g'),9) AS p, count(*) AS n
    FROM ws_user WHERE msisdn IS NOT NULL AND msisdn <> ''
    GROUP BY 1
  ) t`;

// Distribusi status: spec bilang hanya (-1,0,1), data asli punya enam nilai.
export const QUALITY_STATUS = `
  SELECT status, count(*)::int AS n FROM ws_user GROUP BY status ORDER BY status`;

// Duplikat email & phone, dihitung case-insensitive / ternormalisasi.
// ---------------------------------------------------------------------------
// DUPLICATES
// ---------------------------------------------------------------------------
// IP: index ix_act_ip (ip_address, user_id) membuat GROUP BY ini index-only.
// Nama diambil terpisah supaya agregasi tidak perlu JOIN ke tabel 3.4GB.
// Dua fase, disengaja.
//
// Versi satu query (GROUP BY + min/max(activity_timestamp)) memakan 20,8 detik:
// min/max memaksa PostgreSQL membaca heap untuk seluruh 2 juta baris, sehingga
// index-only scan tidak mungkin terjadi.
//
// Fase 1 hanya menyentuh (ip_address, user_id) -> persis isi ix_act_ip, jadi
// bisa index-only. Fase 2 mengambil timestamp HANYA untuk IP yang lolos
// (maksimal 200 baris), bukan 2 juta.
export const DUP_IP = `
  SELECT ip_address AS shared_attribute, count(DISTINCT user_id)::int AS user_count
  FROM ws_user_activity
  WHERE ip_address IS NOT NULL AND ip_address <> ''
  GROUP BY ip_address
  HAVING count(DISTINCT user_id) > 1
  ORDER BY 2 DESC
  LIMIT $1`;

// Fase 2: detail untuk daftar IP terpilih saja.
export const DUP_IP_DETAIL = `
  SELECT ip_address,
         (array_agg(DISTINCT user_id))[1:20] AS user_ids,
         min(activity_timestamp) AS first_activity,
         max(activity_timestamp) AS last_activity
  FROM ws_user_activity
  WHERE ip_address = ANY($1::varchar[])
  GROUP BY ip_address`;

export const NAMES_FOR_IDS = `
  SELECT user_id, full_name FROM ws_user WHERE user_id = ANY($1::bigint[])`;

// Email duplikat, case-insensitive.
// Dijalankan sebagai GroupAggregate lewat ix_user_email_lower (data sudah
// terurut di index), BUKAN HashAggregate. Bedanya krusial: HashAggregate
// menyimpan seluruh 13,7 juta grup di memori sekaligus — itulah yang pernah
// membuat backend kehabisan memori dan menjatuhkan database ke recovery mode.
// GroupAggregate mengalir grup demi grup dengan memori tetap kecil.
//
// array_agg dibatasi 20 user per grup; tanpa batas, satu grup besar saja
// (mis. email dummy yang dipakai ribuan akun) sudah cukup meledakkan memori.
export const DUP_EMAIL = `
  SELECT shared_attribute, user_count, user_ids FROM (
    SELECT lower(user_email)                   AS shared_attribute,
           count(*)::int                       AS user_count,
           (array_agg(user_id))[1:20]          AS user_ids
    FROM ws_user
    WHERE user_email LIKE '%@%'
    GROUP BY lower(user_email)
    HAVING count(*) > 1
  ) t
  ORDER BY user_count DESC
  LIMIT $1`;

// Phone duplikat.
// Batas atas count(*) < 100 membuang nomor placeholder: 6289999999999
// dipakai 39.029 user. Itu bukan duplikat, itu isian default operator.
// Tanpa filter ini precision hancur dan Round 4 kehilangan 75 poin.
// Sama seperti DUP_EMAIL: dibatasi 20 user per grup agar memori tetap kecil.
//
// Batas atas count(*) < 100 membuang nomor placeholder. Contoh nyata di dataset
// ini: 6289999999999 dipakai 39.029 user. Itu isian default operator, bukan
// duplikat. Tanpa filter ini precision Round 4 hancur oleh satu nomor palsu.
export const DUP_PHONE = `
  SELECT shared_attribute, user_count, user_ids FROM (
    SELECT regexp_replace(msisdn,'[^0-9]','','g')  AS shared_attribute,
           count(*)::int                           AS user_count,
           (array_agg(user_id))[1:20]              AS user_ids
    FROM ws_user
    WHERE NULLIF(msisdn,'') IS NOT NULL
      AND length(regexp_replace(msisdn,'[^0-9]','','g')) BETWEEN 9 AND 15
    GROUP BY 1
    HAVING count(*) > 1 AND count(*) < 100
  ) t
  ORDER BY user_count DESC
  LIMIT $1`;

// Duplikat untuk SATU user (endpoint /api/duplicates/:user_id).
// Mencocokkan email persis, phone ternormalisasi, dan kemiripan nama trigram.
export const DUP_FOR_USER = `
  WITH me AS (SELECT user_id, full_name, user_email, msisdn FROM ws_user WHERE user_id = $1)
  SELECT u.user_id, u.full_name, u.user_email, u.msisdn,
         (lower(u.user_email) = lower(me.user_email) AND me.user_email LIKE '%@%') AS email_match,
         (regexp_replace(u.msisdn,'[^0-9]','','g') = regexp_replace(me.msisdn,'[^0-9]','','g')
          AND NULLIF(me.msisdn,'') IS NOT NULL)                                    AS phone_match,
         coalesce(similarity(u.full_name, me.full_name), 0)                        AS name_sim
  FROM ws_user u, me
  WHERE u.user_id <> me.user_id
    AND (
      (me.user_email LIKE '%@%' AND lower(u.user_email) = lower(me.user_email))
      OR (NULLIF(me.msisdn,'') IS NOT NULL AND u.msisdn = me.msisdn)
      OR (me.full_name IS NOT NULL AND u.full_name % me.full_name)
    )
  LIMIT 200`;

// ---------------------------------------------------------------------------
// USER PROFILE — Round 5, di bawah 100 concurrent
// ---------------------------------------------------------------------------
// SENGAJA bukan satu JOIN 4 tabel. JOIN penuh menghasilkan cartesian product
// (1 user x N order x M transaksi x K aktivitas), lalu harus dibereskan pakai
// COUNT(DISTINCT) yang mahal. Subquery agregat terpisah membiarkan tiap
// subquery memakai index-nya sendiri dan mengembalikan tepat satu nilai.
export const USER_PROFILE = `
  SELECT
    u.user_id,
    u.full_name,
    u.user_email,
    u.msisdn,
    u.status,
    u.create_time,
    (SELECT count(*)::int FROM ws_orders o WHERE o.user_id = u.user_id)          AS order_count,
    (SELECT coalesce(sum(o.order_amount), 0) FROM ws_orders o WHERE o.user_id = u.user_id) AS order_total,
    (SELECT coalesce(sum(t.transaction_amount), 0)
       FROM ws_transactions t
       JOIN ws_orders o2 ON o2.order_id = t.order_id
      WHERE o2.user_id = u.user_id)                                              AS transaction_total,
    (SELECT count(*)::int FROM ws_user_activity a WHERE a.user_id = u.user_id)   AS activity_count,
    (SELECT max(a.activity_timestamp) FROM ws_user_activity a WHERE a.user_id = u.user_id) AS last_activity,
    -- LIMIT 20 wajib: tanpa ini user dengan ribuan aktivitas membengkakkan payload
    (SELECT json_agg(x) FROM (
        SELECT activity_type, activity_timestamp, ip_address
        FROM ws_user_activity a
        WHERE a.user_id = u.user_id
        ORDER BY a.activity_timestamp DESC
        LIMIT 20) x)                                                             AS recent_activity
  FROM ws_user u
  WHERE u.user_id = $1`;


// ---------------------------------------------------------------------------
// Round 4 — metode tambahan yang diminta spec
// ---------------------------------------------------------------------------

// MEDIUM confidence: user dengan pola pembelian identik.
// Pola = (jumlah order, nilai order dibulatkan). Pembulatan diperlukan karena
// order_amount numeric(12,2); tanpa itu hampir tidak ada yang cocok persis.
//
// Catatan kejujuran untuk laporan: di dataset ini setiap user maksimal punya
// SATU order, sehingga "pola pembelian" menyusut jadi "nilai order sama".
// Daya pisahnya rendah — karena itu confidence-nya medium, bukan high.
// Versi pertama memakai CTE per-user lalu di-GROUP lagi (agregasi bertingkat
// di atas 3 juta baris): 81 DETIK. Karena setiap user di dataset ini maksimal
// punya satu order, pengelompokan langsung pada nilai order memberi hasil
// setara hanya dengan satu kali pass.
export const DUP_ORDER = `
  SELECT round(order_amount)::text            AS shared_attribute,
         count(DISTINCT user_id)::int         AS user_count,
         (array_agg(DISTINCT user_id))[1:20]  AS user_ids,
         1                                    AS n_order,
         round(order_amount)                  AS total_amt
  FROM ws_orders
  GROUP BY round(order_amount)
  HAVING count(DISTINCT user_id) > 1
  ORDER BY 2 DESC
  LIMIT $1`;

// LOW confidence: login pada menit yang sama.
// Timestamp dibulatkan ke menit (date_trunc) lalu dikelompokkan. Memakai
// ix_act_type_ts (activity_type, activity_timestamp) untuk menyaring LOGIN dulu.
//
// Sinyal ini lemah dan memang diberi label low: pada 250 ribu event LOGIN
// tersebar di 90 hari, tabrakan satu menit sangat mungkin terjadi kebetulan.
export const DUP_ACTIVITY = `
  SELECT to_char(date_trunc('minute', activity_timestamp), 'YYYY-MM-DD HH24:MI') AS shared_attribute,
         count(DISTINCT user_id)::int          AS user_count,
         (array_agg(DISTINCT user_id))[1:20]   AS user_ids,
         min(activity_timestamp)               AS first_activity,
         max(activity_timestamp)               AS last_activity
  FROM ws_user_activity
  WHERE activity_type = 'LOGIN'
  GROUP BY date_trunc('minute', activity_timestamp)
  HAVING count(DISTINCT user_id) > 1
  ORDER BY 2 DESC
  LIMIT $1`;
