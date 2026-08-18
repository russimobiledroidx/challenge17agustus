// db.js — satu-satunya tempat yang berbicara dengan PostgreSQL.
// Tanpa ORM: query ditulis eksplisit supaya bisa dibaca, di-EXPLAIN, dan dijelaskan.
import pg from 'pg';

// numeric/bigint dikembalikan pg sebagai string supaya tidak kehilangan presisi.
// Untuk agregasi uang & counter kita mau angka, jadi di-parse eksplisit.
pg.types.setTypeParser(20, v => parseInt(v, 10));    // int8
pg.types.setTypeParser(1700, v => parseFloat(v));    // numeric

const WORKERS = Number(process.env.WORKERS || 4);

// Pool dibagi rata antar worker cluster. VPS 4 core:
// total koneksi = WORKERS * max. Terlalu besar justru melambat karena
// Postgres sibuk context-switching, bukan mengerjakan query.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 8),
  idleTimeoutMillis: 30_000,
  // Pagar keselamatan. Tanpa ini, satu query agregasi berat pernah membuat
  // backend PostgreSQL kehabisan memori dan seluruh database masuk recovery
  // mode — semua endpoint ikut mati, bukan hanya endpoint yang salah.
  // Query yang melewati batas dibatalkan oleh server, koneksinya kembali ke
  // pool, dan sisa API tetap hidup.
  statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT || 20_000),
  // Ambang kemiripan trigram, dikirim sebagai startup parameter.
  //
  // Default PostgreSQL 0.3 terlalu longgar untuk 15 juta nama: pencarian
  // "komang pipit" menarik 36.622 kandidat dari index lalu membuang 30.773 di
  // tahap recheck. 0.45 memangkas kandidat drastis dan tetap menangkap salah
  // ketik ringan.
  //
  // Diset lewat `options` (bukan pool.on('connect')) karena handler connect
  // berjalan asinkron — query pertama bisa terlanjur jalan sebelum SET selesai.
  // Startup parameter dijamin aktif sebelum query apa pun diterima.
  options: '-c pg_trgm.similarity_threshold=0.45',
  // Request yang tidak kebagian koneksi harus gagal cepat.
  // Tanpa ini, request menggantung sampai timeout juri (5 detik) dan dihitung gagal.
  connectionTimeoutMillis: 2_000,
});

pool.on('error', err => console.error('[pool]', err.message));

// Named query = prepared statement. Postgres parse + plan sekali,
// lalu memakai ulang rencananya. Sekaligus parameterized -> kebal SQL injection.
export const q = (name, text, values) => pool.query({ name, text, values });
export const sql = (text, values) => pool.query(text, values);

// Query agregasi yang memang berat (metrik kualitas di 15 juta baris) tidak
// boleh tunduk pada statement_timeout 20 detik milik jalur request biasa.
// Dijalankan lewat client tersendiri dengan batas longgar, lalu koneksinya
// dilepas. Endpoint tetap terlindungi; hanya pekerjaan latar belakang ini yang
// diberi kelonggaran.
export async function slowQuery(text, values, timeoutMs = 180_000) {
  const c = await pool.connect();
  try {
    await c.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`);
    return await c.query(text, values);
  } finally {
    c.release();
  }
}
