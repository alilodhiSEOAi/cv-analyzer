const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tone = n => n >= 75 ? 'good' : n >= 50 ? 'mid' : 'bad';
const color = n => `var(--${tone(n)})`;
const MAX_MB = 4;

// ---- scroll reveal, year, copy email
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));
$('yr').textContent = new Date().getFullYear();
$('copy-mail').addEventListener('click', async e => {
  try { await navigator.clipboard.writeText('alilodhiseo@gmail.com'); e.target.textContent = 'Copied!'; }
  catch { e.target.textContent = 'alilodhiseo@gmail.com'; }
  setTimeout(() => e.target.textContent = 'Copy email', 2000);
});

// ---- file picker + drag and drop
const fileInput = $('cv'), drop = $('drop');
fileInput.addEventListener('change', () => showFile(fileInput.files[0]));
['dragover', 'dragenter'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', ev => { fileInput.files = ev.dataTransfer.files; showFile(fileInput.files[0]); });
function showFile(f) {
  if (!f) return;
  $('drop-title').textContent = f.name;
  $('drop-sub').textContent = (f.size / 1024).toFixed(0) + ' KB · click to change';
}
const toBase64 = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.onerror = no; r.readAsDataURL(f); });

// ---- submit
$('form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('error'); err.hidden = true;
  const file = fileInput.files[0];
  if (!file && $('cv_text').value.trim().length < 80) { err.textContent = 'Upload a CV file or paste at least a few lines of CV text.'; err.hidden = false; return; }
  if (file && file.size > MAX_MB * 1024 * 1024) { err.textContent = `File is too large. Maximum is ${MAX_MB} MB.`; err.hidden = false; return; }

  $('submit').disabled = true; $('loading').hidden = false; $('result').hidden = true;
  try {
    const body = { cv_text: $('cv_text').value, job_title: $('job_title').value, job_description: $('job_description').value };
    if (file) { body.file_name = file.name; body.file_base64 = await toBase64(file); }
    const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({ error: 'Server timed out. Try a shorter CV or try again.' }));
    if (!res.ok) throw new Error(data.error || 'Analysis failed');
    renderResult(data); loadStats(); if (adminKey()) loadHistory();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  finally { $('submit').disabled = false; $('loading').hidden = true; }
});

const list = arr => (arr || []).map(x => `<li>${esc(x)}</li>`).join('');
const chips = (arr, cls = '') => (arr || []).map(x => `<span class="chip ${cls}">${esc(x)}</span>`).join('');
const ring = (n, label) => `<div class="ring-wrap"><div class="ring" style="--p:${n};--c:${color(n)}"><b>${n}</b></div>${label}</div>`;

function renderResult(r) {
  const el = $('result');
  el.innerHTML = `
    <div class="r-head">
      ${ring(r.overall_score ?? 0, 'CV score')}
      ${r.match_score != null ? ring(r.match_score, 'Job match') : ''}
      <div>
        <h3>${esc(r.candidate_name || 'Unnamed candidate')}</h3>
        <p>${esc(r.email || '')}${r.experience_years != null ? ' · ' + esc(r.experience_years) + ' years experience' : ''}</p>
        <p>${esc(r.summary)}</p>
      </div>
    </div>
    <div class="r-grid">
      <div class="full"><h4>Skills found</h4><div class="chips">${chips(r.skills)}</div></div>
      <div><h4>Strengths</h4><ul>${list(r.strengths)}</ul></div>
      <div><h4>Weaknesses</h4><ul>${list(r.weaknesses)}</ul></div>
      ${(r.missing_keywords || []).length ? `<div class="full"><h4>Missing keywords</h4><div class="chips">${chips(r.missing_keywords, 'miss')}</div></div>` : ''}
      <div class="full"><h4>How to improve</h4><ul>${list(r.suggestions)}</ul></div>
    </div>`;
  el.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- admin history (protected by ADMIN_KEY on the server)
const adminKey = () => sessionStorage.getItem('adminKey') || '';
const authHeaders = () => ({ 'x-admin-key': adminKey() });

async function loadHistory() {
  const res = await fetch('/api/analyses', { headers: authHeaders() });
  if (res.status === 401) { sessionStorage.removeItem('adminKey'); $('table-wrap').hidden = true; $('admin-msg').textContent = 'Wrong password.'; return; }
  const rows = await res.json();
  $('admin-msg').textContent = '';
  $('table-wrap').hidden = false;
  $('rows').innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td>${esc(r.candidate_name || 'Unnamed')}<br><small>${esc(r.email || '')}</small></td>
      <td>${esc(r.job_title || '–')}</td>
      <td class="pill ${tone(r.overall_score)}">${r.overall_score}</td>
      <td class="pill ${r.match_score != null ? tone(r.match_score) : ''}">${r.match_score ?? '–'}</td>
      <td>${new Date(r.created_at).toLocaleDateString()}</td>
      <td><button class="link" data-view="${r.id}">View</button><button class="link del" data-del="${r.id}">Delete</button></td>
    </tr>`).join('') : '<tr><td colspan="6" class="muted">No analyses saved yet.</td></tr>';
}
$('admin-form').addEventListener('submit', e => {
  e.preventDefault();
  sessionStorage.setItem('adminKey', $('admin-key').value);
  loadHistory();
});
$('rows').addEventListener('click', async e => {
  const v = e.target.dataset.view, d = e.target.dataset.del;
  if (v) renderResult(await (await fetch('/api/analyses/' + v, { headers: authHeaders() })).json());
  if (d && confirm('Delete this analysis?')) { await fetch('/api/analyses/' + d, { method: 'DELETE', headers: authHeaders() }); loadHistory(); loadStats(); }
});

async function loadStats() {
  try {
    const s = await (await fetch('/api/stats')).json();
    $('st-total').textContent = s.total ?? 0;
    $('st-avg').textContent = s.avg_score ?? '–';
    $('st-best').textContent = s.best ?? '–';
  } catch {}
}
loadStats(); if (adminKey()) loadHistory();
