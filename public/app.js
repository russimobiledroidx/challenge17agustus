// app.js — dashboard Customer Intelligence Platform.
// Tanpa framework, tanpa build step, tanpa dependency eksternal.

const $ = s => document.querySelector(s);
const fmt = n => (n == null ? '—' : Number(n).toLocaleString('id-ID'));
const esc = s => (s == null ? '' : String(s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));

const ICON = {
  empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  warn:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
};

// Waktu respons diberi warna supaya target performa langsung terbaca:
// hijau memenuhi target, amber di atasnya.
const timing = (msVal, target) =>
  `<span class="${msVal <= target ? 'fast' : 'slow'}"><b>${msVal} ms</b></span>`;

async function api(path) {
  const t0 = performance.now();
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  return { body, status: res.status, ok: res.ok, clientMs: Math.round(performance.now() - t0) };
}

const emptyState = (msg) => `<div class="state">${ICON.empty}<div>${esc(msg)}</div></div>`;
const errorState = (msg) => `<div class="error">${ICON.warn}<div>${esc(msg)}</div></div>`;
const loadingState = (msg) => `<div class="state"><div class="spin"></div>${esc(msg)}</div>`;

function table(cols, rows, cell) {
  if (!rows.length) return emptyState('Tidak ada hasil untuk kriteria ini.');
  return `<div class="tablewrap"><table>
    <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${cell(r).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

// ---------------- tema ----------------
const root = document.documentElement;
$('#theme').onclick = () => {
  const cur = root.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark'
    : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch {}
};
try { const t = localStorage.getItem('theme'); if (t) root.setAttribute('data-theme', t); } catch {}

// ---------------- tab ----------------
const loaded = new Set();
document.querySelectorAll('.tabs button').forEach(btn => btn.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b === btn)));
  document.querySelectorAll('main section').forEach(s => { s.hidden = s.id !== 'p-' + btn.dataset.tab; });
  if (btn.dataset.tab === 'quality' && !loaded.has('quality')) { loaded.add('quality'); loadQuality(); }
});

// ---------------- header ----------------
(async () => {
  try {
    const { body, ok } = await api('/api/health');
    if (!ok) throw new Error('health gagal');
    $('#c-users').innerHTML = `${fmt(body.actual_records)} users`;
    $('#c-db').className = 'chip live';
    $('#c-db').innerHTML = '<span class="dot"></span>database connected';
  } catch {
    $('#c-users').textContent = '—';
    $('#c-db').className = 'chip down';
    $('#c-db').innerHTML = '<span class="dot"></span>API tidak merespons';
  }
})();

// ---------------- Search ----------------
const TARGET = { email: 100, phone: 100, user_id: 50, name: 300 };

async function doSearch() {
  const q = $('#s-q').value.trim(), type = $('#s-type').value;
  if (!q) { $('#s-out').innerHTML = errorState('Masukkan kata kunci terlebih dahulu.'); return; }
  $('#s-go').disabled = true;
  $('#s-out').innerHTML = loadingState('Mencari di 15 juta baris…');
  $('#s-meta').innerHTML = '';
  try {
    const { body, ok, clientMs } = await api(
      `/api/search?q=${encodeURIComponent(q)}&type=${type}&limit=20&offset=0`);
    if (!ok) throw new Error(body.error || `Gagal (HTTP ${body.status || '?'})`);
    $('#s-meta').innerHTML =
      `<span><b>${fmt(body.total)}</b> hasil</span>
       <span>server ${timing(body.took_ms, TARGET[type])}</span>
       <span>target &lt;${TARGET[type]} ms</span>
       <span>round-trip <b>${clientMs} ms</b></span>`;
    $('#s-out').innerHTML = table(
      ['User ID', 'Nama', 'Email', 'Telepon', 'Status', 'Dibuat'], body.results, r => [
        `<td class="mono">${r.user_id}</td>`,
        `<td>${r.full_name ? esc(r.full_name) : '<span class="tag neutral">kosong</span>'}</td>`,
        `<td class="mono">${r.email_valid ? esc(r.user_email)
            : '<span class="tag bad">nomor HP, bukan email</span>'}</td>`,
        `<td class="mono">${r.msisdn ? esc(r.msisdn) : '<span class="tag neutral">—</span>'}</td>`,
        `<td class="num">${r.status ?? '—'}</td>`,
        `<td class="mono">${r.created_at ? new Date(r.created_at).toLocaleDateString('id-ID') : '—'}</td>`,
      ]);
  } catch (e) {
    $('#s-out').innerHTML = errorState(e.message);
  } finally { $('#s-go').disabled = false; }
}
$('#s-go').onclick = doSearch;
$('#s-q').onkeydown = e => { if (e.key === 'Enter') doSearch(); };

// ---------------- Data Quality ----------------
// Agregasi 15 juta baris memakan puluhan detik. Server membalas 202 selama
// hitungan berjalan; UI menampilkan progres dan mencoba lagi, bukan error.
function gauge(label, present, total, note) {
  const pct = total ? (present / total) * 100 : 0;
  const cls = pct > 80 ? '' : pct > 40 ? 'warn' : 'bad';
  return `<div class="card">
    <div class="k">${esc(label)}</div>
    <div class="v">${pct.toFixed(1)}%</div>
    <div class="meter ${cls}"><i style="width:${Math.min(pct, 100)}%"></i></div>
    <div class="n">${fmt(present)} dari ${fmt(total)}${note ? ' · ' + esc(note) : ''}</div>
  </div>`;
}

let qTries = 0;
async function loadQuality() {
  if (!qTries) $('#q-out').innerHTML =
    loadingState('Menghitung metrik dari 15 juta baris. Ini berjalan langsung di database, bukan angka simpanan.');
  try {
    const { body, status, ok, clientMs } = await api('/api/quality');

    if (status === 202) {                       // masih dihitung
      qTries++;
      $('#q-out').innerHTML = loadingState(
        `Agregasi berjalan… percobaan ${qTries}. Halaman akan memuat otomatis begitu selesai.`);
      setTimeout(loadQuality, 4000);
      return;
    }
    if (!ok) throw new Error(body.error || 'Gagal memuat metrik');
    // Penjaga tambahan: jangan pernah membaca .email dari objek yang tidak ada.
    if (!body || !body.quality_metrics) throw new Error('Respons tidak berisi quality_metrics');

    qTries = 0;
    const m = body.quality_metrics, T = body.total_records;
    const st = Object.entries(m.status.distribution)
      .sort((a, b) => Number(a[0]) - Number(b[0]));

    $('#q-out').innerHTML = `
      <div class="metabar">
        <span>dihitung <b>${new Date(body.analyzed_at).toLocaleTimeString('id-ID')}</b></span>
        <span>durasi agregasi <b>${fmt(body.computed_in_ms)} ms</b></span>
        <span>round-trip <b>${clientMs} ms</b></span>
        <span><b>${fmt(T)}</b> baris dianalisis</span>
      </div>

      <h2>Ringkasan</h2>
      <div class="grid">
        <div class="card"><div class="k">Quality Score</div><div class="v">${body.quality_score}</div>
          <div class="n">rata-rata tertimbang kelengkapan</div></div>
        ${gauge('Email terisi', m.email.present, T, `${fmt(m.email.missing_count)} berisi nomor HP`)}
        ${gauge('Telepon terisi', m.phone.present, T, `${fmt(m.phone.malformed)} tidak valid`)}
        ${gauge('Tanggal lahir terisi', m.birth_date.present, T, `${fmt(m.birth_date.impossible_dates)} mustahil`)}
        ${gauge('Nama terisi', T - (m.email.total - m.email.total), T)}
        <div class="card"><div class="k">Hobbies kosong</div>
          <div class="v">${m.hobbies.null_percent}%</div>
          <div class="meter bad"><i style="width:${Math.min(m.hobbies.null_percent, 100)}%"></i></div>
          <div class="n">${fmt(m.hobbies.null_count)} baris — spec menyebut 10%</div></div>
      </div>

      <h2>Duplikat &amp; keunikan</h2>
      <div class="grid">
        <div class="card"><div class="k">Email unik</div><div class="v">${fmt(m.email.unique)}</div>
          <div class="n">${fmt(m.email.duplicate_count)} nilai dipakai lebih dari sekali</div></div>
        <div class="card"><div class="k">Telepon unik</div><div class="v">${fmt(m.phone.unique)}</div>
          <div class="n">${fmt(m.phone.duplicate_count)} nilai dipakai lebih dari sekali</div></div>
        <div class="card"><div class="k">Email format salah</div><div class="v">${fmt(m.email.invalid_format)}</div>
          <div class="n">tidak cocok pola alamat email</div></div>
      </div>

      <h2>Distribusi status</h2>
      <div class="note">Spec menyebut hanya tiga nilai (-1, 0, 1). Data asli punya
        <strong>${st.length}</strong> nilai berbeda — angka di bawah dihitung langsung dari database.</div>
      <div class="tablewrap"><table>
        <thead><tr><th>status</th><th>jumlah</th><th>porsi</th><th></th></tr></thead>
        <tbody>${st.map(([k, v]) => `<tr>
          <td class="mono"><code>${esc(k)}</code></td>
          <td class="num">${fmt(v)}</td>
          <td class="num">${((v / T) * 100).toFixed(3)}%</td>
          <td style="width:40%"><div class="meter"><i style="width:${(v / T) * 100}%"></i></div></td>
        </tr>`).join('')}</tbody>
      </table></div>

      <h2>Masalah terdeteksi</h2>
      ${table(['Kolom', 'Jenis masalah', 'Jumlah', 'Contoh', 'Severity'], body.data_issues, i => [
        `<td class="mono"><code>${esc(i.field)}</code></td>`,
        `<td>${esc(i.issue_type)}</td>`,
        `<td class="num">${fmt(i.count)}</td>`,
        `<td class="mono" style="color:var(--fg-muted)">${esc((i.examples || []).join(', '))}</td>`,
        `<td><span class="tag ${i.severity === 'high' ? 'bad' : i.severity === 'medium' ? 'warn' : 'info'}">${esc(i.severity)}</span></td>`,
      ])}`;
  } catch (e) {
    qTries = 0;
    $('#q-out').innerHTML = errorState(e.message) +
      `<p class="hint" style="margin-top:12px">Coba buka ulang tab ini, atau panggil
       <code>/api/quality</code> langsung untuk melihat respons mentahnya.</p>`;
  }
}

// ---------------- Duplicates ----------------
$('#d-go').onclick = async () => {
  const method = $('#d-method').value;
  const limit = Math.min(Math.max(parseInt($('#d-limit').value, 10) || 20, 1), 200);
  $('#d-go').disabled = true;
  $('#d-out').innerHTML = loadingState('Menganalisis lintas tabel…');
  $('#d-meta').innerHTML = '';
  try {
    const { body, ok, clientMs } = await api(`/api/duplicates/find?method=${method}&limit=${limit}`);
    if (!ok) throw new Error(body.error || 'Analisis gagal');
    const groups = body.duplicate_groups || [];
    const note = groups[0]?.confidence_note;
    $('#d-meta').innerHTML =
      `<span><b>${fmt(body.total_groups_found)}</b> grup</span>
       <span><b>${fmt(body.total_duplicate_users)}</b> user terlibat</span>
       <span>server ${timing(body.took_ms, 2000)}</span>
       <span>target &lt;2000 ms</span>
       <span>round-trip <b>${clientMs} ms</b></span>`;
    $('#d-out').innerHTML =
      (note ? `<div class="note"><strong>Catatan metode.</strong> ${esc(note)}</div>` : '') +
      table(['#', 'Atribut bersama', 'Jumlah user', 'Contoh user ID', 'Confidence'], groups, g => [
        `<td class="num">${g.group_id}</td>`,
        `<td class="mono"><code>${esc(g.shared_attribute)}</code></td>`,
        `<td class="num">${fmt(g.user_count)}</td>`,
        `<td class="mono" style="color:var(--fg-muted)">${esc((g.user_ids || []).slice(0, 5).join(', '))}${(g.user_ids || []).length > 5 ? ' …' : ''}</td>`,
        `<td><span class="tag ${g.confidence === 'high' ? 'ok' : g.confidence === 'medium' ? 'warn' : 'neutral'}">${esc(g.confidence)}</span></td>`,
      ]);
  } catch (e) { $('#d-out').innerHTML = errorState(e.message); }
  finally { $('#d-go').disabled = false; }
};

// ---------------- User Profile ----------------
$('#p-go').onclick = async () => {
  const id = $('#p-id').value.trim();
  $('#p-go').disabled = true;
  $('#p-out').innerHTML = loadingState('Menggabungkan 4 tabel…');
  $('#p-meta').innerHTML = '';
  try {
    const { body, ok, clientMs } = await api(`/api/user-profile/${encodeURIComponent(id)}`);
    if (!ok) throw new Error(body.error || 'User tidak ditemukan');
    const p = body.profile;
    $('#p-meta').innerHTML =
      `<span>server ${timing(body.took_ms, 1000)}</span>
       <span>round-trip <b>${clientMs} ms</b></span>
       <span>4 tabel digabung</span>`;
    $('#p-out').innerHTML = `
      <div class="grid">
        <div class="card"><div class="k">Nama</div>
          <div class="v sm">${p.full_name ? esc(p.full_name) : '<span class="tag neutral">kosong</span>'}</div>
          <div class="n">${p.email_valid ? esc(p.user_email) : 'email tidak valid'}</div></div>
        <div class="card"><div class="k">Order</div><div class="v">${fmt(body.orders.count)}</div>
          <div class="n">nilai Rp ${fmt(body.orders.total_amount)}</div></div>
        <div class="card"><div class="k">Transaksi</div><div class="v">${fmt(body.transactions.total_amount)}</div>
          <div class="n">total nilai transaksi</div></div>
        <div class="card"><div class="k">Aktivitas</div><div class="v">${fmt(body.activity.count)}</div>
          <div class="n">${body.activity.last_activity
              ? 'terakhir ' + new Date(body.activity.last_activity).toLocaleString('id-ID')
              : 'belum ada aktivitas'}</div></div>
      </div>
      <h2>Aktivitas terbaru</h2>
      ${table(['Tipe', 'Waktu', 'IP'], body.activity.recent || [], a => [
        `<td><span class="tag info">${esc(a.activity_type)}</span></td>`,
        `<td class="mono">${new Date(a.activity_timestamp).toLocaleString('id-ID')}</td>`,
        `<td class="mono"><code>${esc(a.ip_address)}</code></td>`,
      ])}`;
  } catch (e) { $('#p-out').innerHTML = errorState(e.message); }
  finally { $('#p-go').disabled = false; }
};
