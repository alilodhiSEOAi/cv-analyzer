const mysql = require('mysql2/promise');

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const json = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let pool, ready;
function getPool() {
  if (!pool) pool = mysql.createPool({
    host: process.env.DB_HOST, port: +process.env.DB_PORT || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'false' ? undefined : { minVersion: 'TLSv1.2', rejectUnauthorized: process.env.DB_SSL_STRICT !== 'false' },
    connectionLimit: 3, waitForConnections: true
  });
  return pool;
}
function init() {
  if (!ready) ready = getPool().query(`CREATE TABLE IF NOT EXISTS analyses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    candidate_name VARCHAR(150) NULL, email VARCHAR(150) NULL, job_title VARCHAR(150) NULL, file_name VARCHAR(255) NULL,
    overall_score TINYINT UNSIGNED NOT NULL DEFAULT 0, match_score TINYINT UNSIGNED NULL,
    result_json JSON NOT NULL, cv_text MEDIUMTEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_created (created_at))`).catch(e => { ready = null; throw e; });
  return ready;
}

async function askGemini(cvText, jobTitle, jobDesc) {
  const prompt = `You are an expert recruiter and ATS specialist. Analyze the CV below${jobDesc ? ' against the job description' : ''}.
Return ONLY valid JSON with exactly these keys:
{"candidate_name": string, "email": string,
 "overall_score": integer 0-100 (CV quality, clarity, impact),
 "match_score": integer 0-100 or null (null if no job description),
 "summary": string (2-3 sentences), "skills": string[], "experience_years": number,
 "strengths": string[], "weaknesses": string[],
 "missing_keywords": string[] (keywords from the job description absent in the CV),
 "suggestions": string[] (specific, actionable improvements)}
Job title: ${jobTitle || 'Not provided'}
Job description: ${jobDesc || 'Not provided'}
CV:
"""${cvText.slice(0, 20000)}"""`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } }
    })
  });
  if (!res.ok) throw new Error('Gemini API error ' + res.status);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty response');
  return JSON.parse(text.replace(/^```json|```$/g, '').trim());
}

exports.handler = async (event) => {
  try {
    const route = event.path.replace(/^\/(\.netlify\/functions\/)?api/, '') || '/';
    const method = event.httpMethod;
    const isAdmin = !!process.env.ADMIN_KEY && event.headers['x-admin-key'] === process.env.ADMIN_KEY;
    const adminOnly = (method === 'GET' && route !== '/stats') || method === 'DELETE';
    if (route !== '/analyze' && adminOnly && !isAdmin) return json(401, { error: 'Admin password required' });

    await init();
    const db = getPool();

    if (method === 'POST' && route === '/analyze') {
      const b = JSON.parse(event.body || '{}');
      let cvText = (b.cv_text || '').trim(), fileName = null;
      if (b.file_base64) {
        fileName = String(b.file_name || 'cv').slice(0, 255);
        const buf = Buffer.from(b.file_base64, 'base64');
        cvText = /\.pdf$/i.test(fileName) ? (await require('pdf-parse/lib/pdf-parse.js')(buf)).text.trim() : buf.toString('utf8').trim();
      }
      if (cvText.length < 80) return json(400, { error: 'CV text is too short or unreadable. Upload a text-based PDF or paste the CV text.' });
      const jobTitle = String(b.job_title || '').trim().slice(0, 150);
      const jobDesc = String(b.job_description || '').trim().slice(0, 8000);
      const r = await askGemini(cvText, jobTitle, jobDesc);
      const clamp = n => (Number.isFinite(+n) ? Math.max(0, Math.min(100, Math.round(+n))) : null);
      const [ins] = await db.execute(
        `INSERT INTO analyses (candidate_name,email,job_title,file_name,overall_score,match_score,result_json,cv_text) VALUES (?,?,?,?,?,?,?,?)`,
        [r.candidate_name || null, r.email || null, jobTitle || null, fileName, clamp(r.overall_score) ?? 0,
         jobDesc ? clamp(r.match_score) : null, JSON.stringify(r), cvText]);
      return json(200, { id: ins.insertId, job_title: jobTitle, ...r });
    }
    if (method === 'GET' && route === '/stats') {
      const [[s]] = await db.query('SELECT COUNT(*) AS total, ROUND(AVG(overall_score)) AS avg_score, MAX(overall_score) AS best FROM analyses');
      return json(200, s);
    }
    if (method === 'GET' && route === '/analyses') {
      const [rows] = await db.query('SELECT id,candidate_name,email,job_title,overall_score,match_score,created_at FROM analyses ORDER BY id DESC LIMIT 50');
      return json(200, rows);
    }
    const m = route.match(/^\/analyses\/(\d+)$/);
    if (m && method === 'GET') {
      const [rows] = await db.execute('SELECT id,job_title,result_json FROM analyses WHERE id = ?', [m[1]]);
      if (!rows.length) return json(404, { error: 'Not found' });
      const r = typeof rows[0].result_json === 'string' ? JSON.parse(rows[0].result_json) : rows[0].result_json;
      return json(200, { id: rows[0].id, job_title: rows[0].job_title, ...r });
    }
    if (m && method === 'DELETE') { await db.execute('DELETE FROM analyses WHERE id = ?', [m[1]]); return json(200, { ok: true }); }
    return json(404, { error: 'Route not found' });
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message });
  }
};
