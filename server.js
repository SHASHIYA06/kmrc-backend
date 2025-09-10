// server.js - Fixed version
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const Tesseract = require('tesseract.js');
const fetch = require('node-fetch');
const mammoth = require('mammoth');
const cors = require('cors');
const xlsx = require('xlsx');

const app = express();
const upload = multer({ dest: 'uploads/' });

/* ------------------------------ CORS/JSON ------------------------------ */
app.use(
  cors({
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);
app.use(express.json({ limit: '15mb' }));

/* ------------------------------ Globals ------------------------------ */
const VECTOR_STORE = [];
let NEXT_ID = 1;
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;
const MAX_SNIPPETS = 12;
const MAX_EMBED_TEXT = 6000;

/* ------------------------------ Utilities ------------------------------ */
function ensureEnv() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY missing in environment.');
  }
}

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (!text) return [];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + size, text.length);
    const chunk = text.slice(i, end);
    chunks.push(chunk);
    if (end === text.length) break;
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return chunks;
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

function toCSVTable(rows) {
  if (!rows || !rows.length) return '';
  return rows.map(r => r.map(v => String(v ?? '').replace(/\r?\n/g, ' ').trim()).join(',')).join('\n');
}

function looksTabular(text) {
  if (!text) return false;
  const lines = text.split(/\r?\n/).slice(0, 30);
  const commas = lines.map(l => (l.match(/,/g) || []).length);
  const avg = commas.reduce((a, b) => a + b, 0) / Math.max(1, commas.length);
  return avg > 2;
}

function getInternalBase() {
  const port = process.env.PORT || 3000;
  return `http://127.0.0.1:${port}`;
}

/* ------------------------------ Tabular helpers ------------------------------ */
function xlsxToTables(filePath) {
  const workbook = xlsx.readFile(filePath);
  const tables = [];
  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    const aoa = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true });
    if (!aoa || !aoa.length) return;
    const headers = (aoa[0] || []).map(h => String(h ?? '').trim());
    const rows = [];
    for (let r = 1; r < aoa.length; r++) {
      const rowAoA = aoa[r] || [];
      const obj = {};
      headers.forEach((h, i) => {
        obj[h || `Col${i + 1}`] = rowAoA[i] ?? '';
      });
      const anyVal = Object.values(obj).some(v => String(v).trim() !== '');
      if (anyVal) rows.push(obj);
    }
    if (rows.length) tables.push({ sheetName, headers, rows });
  });
  return tables;
}

function csvToTable(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (lines.length < 2) return null;
  const split = (s) => s.split(',');
  const headers = split(lines[0]).map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const vals = split(line);
    const obj = {};
    headers.forEach((h, i) => (obj[h || `Col${i + 1}`] = (vals[i] ?? '').trim()));
    return obj;
  });
  if (!rows.length) return null;
  return { headers, rows };
}

function tableRowToString(fileName, sheetName, headers, rowObj) {
  const pairs = headers.map(h => `${h}: ${String(rowObj[h] ?? '').toString().replace(/\s+/g, ' ').trim()}`);
  return `FILE: ${fileName}${sheetName ? ` | SHEET: ${sheetName}` : ''} | ${pairs.join(' | ')}`;
}

/* ------------------------------ Extraction ------------------------------ */
async function extractText(filePath, mimetype) {
  try {
    // PDF
    if (mimetype === 'application/pdf') {
      const pdfBuffer = fs.readFileSync(filePath);
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      let text = '';
      for (let i = 0; i < pdfDoc.getPageCount(); i++) {
        const page = pdfDoc.getPage(i);
        // Note: pdf-lib doesn't extract text directly, so we'll use a fallback
        // In production, you might want to use a different library or service for PDF text extraction
        text += `[PDF Page ${i + 1}] `;
      }
      // If we need actual text extraction, we can fall back to Tesseract for scanned PDFs
      if (text.trim() === '') {
        const ocr = await Tesseract.recognize(filePath, 'eng');
        return ocr.data.text || '';
      }
      return text;
    }
    // Images (png/jpg/jpeg/webp/tiff/bmp)
    if (/^image\//i.test(mimetype)) {
      const ocr = await Tesseract.recognize(filePath, 'eng');
      return ocr.data.text || '';
    }
    // DOCX
    if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || '';
    }
    // XLSX / XLS
    if (
      mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimetype === 'application/vnd.ms-excel'
    ) {
      const workbook = xlsx.readFile(filePath);
      let out = [];
      workbook.SheetNames.forEach(sheetName => {
        const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true });
        const filtered = sheet.filter(row =>
          row && row.some(c => c !== null && c !== undefined && String(c).trim() !== '')
        );
        if (filtered.length) {
          out.push(`Sheet: ${sheetName}\n${toCSVTable(filtered)}`);
        }
      });
      return out.join('\n\n');
    }
    // CSV / plain text
    if (mimetype === 'text/csv' || mimetype === 'text/plain') {
      return readTextSafe(filePath);
    }
    // JSON/XML/HTML
    if (/json|xml|html/.test(mimetype)) {
      return readTextSafe(filePath);
    }
    return '';
  } catch (err) {
    console.error('❌ extractText error:', err);
    return '';
  }
}

/* ------------------------------ Gemini API ------------------------------ */
async function geminiEmbed(text) {
  ensureEnv();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`;
  const body = {
    content: { parts: [{ text: text.slice(0, MAX_EMBED_TEXT) }] },
    taskType: 'RETRIEVAL_DOCUMENT',
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini embed error ${res.status}: ${raw}`);
  }
  const data = JSON.parse(raw);
  return data.embedding?.values || [];
}

async function geminiChat(prompt) {
  ensureEnv();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const body = { contents: [{ parts: [{ text: prompt }] }] };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Gemini chat error ${res.status}: ${raw}`);
  const data = JSON.parse(raw);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from Gemini.';
}

/* ------------------------------ Indexing (Ingest) ------------------------------ */
app.post('/ingest', upload.array('files'), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });
    let added = 0;
    for (const file of req.files) {
      const filePath = file.path;
      const mimetype = file.mimetype || 'application/octet-stream';
      const fileName = file.originalname;
      let didRowIngest = false;
      try {
        if (
          mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
          mimetype === 'application/vnd.ms-excel'
        ) {
          const tables = xlsxToTables(filePath);
          for (const t of tables) {
            for (let i = 0; i < t.rows.length; i++) {
              const rowStr = tableRowToString(fileName, t.sheetName, t.headers, t.rows[i]);
              const emb = await geminiEmbed(rowStr);
              VECTOR_STORE.push({
                id: NEXT_ID++,
                fileName,
                mime: mimetype,
                meta: { type: 'row', sheetName: t.sheetName, headers: t.headers },
                system: req.body.system || '',
                subsystem: req.body.subsystem || '',
                chunk: rowStr,
                embedding: emb,
                sourceId: fileName,
                position: i,
              });
              added++;
            }
          }
          didRowIngest = true;
        }
      } catch (e) {
        console.warn('Row-level XLSX ingest warning:', e.message);
      }
      const raw = await extractText(filePath, mimetype);
      fs.unlinkSync(filePath);
      if (!raw || !raw.trim()) continue;
      const chunks = chunkText(raw);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const emb = await geminiEmbed(chunk);
        VECTOR_STORE.push({
          id: NEXT_ID++,
          fileName,
          mime: mimetype,
          meta: didRowIngest ? { type: 'chunk+row' } : {},
          system: req.body.system || '',
          subsystem: req.body.subsystem || '',
          chunk,
          embedding: emb,
          sourceId: fileName,
          position: i,
        });
        added++;
      }
    }
    res.json({ ok: true, added, total: VECTOR_STORE.length });
  } catch (err) {
    console.error('❌ /ingest error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/ingest-json', async (req, res) => {
  try {
    const { documents } = req.body;
    if (!documents?.length) return res.status(400).json({ error: 'No documents provided' });
    let added = 0;
    for (const doc of documents) {
      const fileName = doc.fileName || doc.name || 'Untitled';
      const mimetype = doc.mime || doc.meta || 'text/plain';
      const system = doc.system || '';
      const subsystem = doc.subsystem || '';
      const raw = String(doc.text || '');
      if (!raw.trim()) continue;
      try {
        if ((mimetype === 'text/csv' || looksTabular(raw))) {
          const parsed = csvToTable(raw);
          if (parsed) {
            parsed.rows.forEach(async (row, idx) => {
              const rowStr = tableRowToString(fileName, '', parsed.headers, row);
              const emb = await geminiEmbed(rowStr);
              VECTOR_STORE.push({
                id: NEXT_ID++,
                fileName,
                mime: mimetype,
                meta: { type: 'row', headers: parsed.headers },
                system,
                subsystem,
                chunk: rowStr,
                embedding: emb,
                sourceId: fileName,
                position: idx,
              });
              added++;
            });
          }
        }
      } catch (e) {
        console.warn('Row-level CSV ingest warning:', e.message);
      }
      const chunks = chunkText(raw);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const emb = await geminiEmbed(chunk);
        VECTOR_STORE.push({
          id: NEXT_ID++,
          fileName,
          mime: mimetype,
          meta: doc.meta || {},
          system,
          subsystem,
          chunk,
          embedding: emb,
          sourceId: fileName,
          position: i,
        });
        added++;
      }
    }
    res.json({ ok: true, added, total: VECTOR_STORE.length });
  } catch (err) {
    console.error('❌ /ingest-json error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/clear', (req, res) => {
  VECTOR_STORE.length = 0;
  NEXT_ID = 1;
  res.json({ ok: true, total: 0 });
});

/* ------------------------------ Ask (RAG QA) ------------------------------ */
app.post('/ask', async (req, res) => {
  try {
    const { query, k = MAX_SNIPPETS, system = '', subsystem = '' } = req.body;
    if (!query) return res.status(400).json({ error: 'Missing query' });
    if (VECTOR_STORE.length === 0) return res.status(400).json({ error: 'Index is empty. Ingest files first.' });
    const qEmb = await geminiEmbed(query);
    const candidates = VECTOR_STORE.filter(x => {
      const sysOk = system ? (x.system || '').toLowerCase().includes(system.toLowerCase()) : true;
      const subOk = subsystem ? (x.subsystem || '').toLowerCase().includes(subsystem.toLowerCase()) : true;
      return sysOk && subOk;
    });
    const scored = candidates
      .map(c => ({ ...c, score: cosineSim(qEmb, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(k, candidates.length));
    const hasTabular = scored.some(s => looksTabular(s.chunk) || (s.meta && (s.meta.type === 'row' || s.meta.headers)));
    const contextBlocks = scored
      .map((c, idx) => `[[${idx + 1}]] File: ${c.fileName} (pos ${c.position})\n${c.chunk}`)
      .join('\n\n---\n\n');
    const prompt = `
You are a precise document analyst for metro rolling stock & maintenance.
Answer the user's query using ONLY the context snippets below.
Always add bracketed citations like [1], [2] next to the specific sentences they support.
User Query:
${query}
Context Snippets (with citations):
${contextBlocks}
Formatting rules:
- ${hasTabular ? 'Because context is tabular or user likely needs a matrix:' : 'If the user explicitly asks for table/matrix:'}
  • Return results as **pure HTML**, not Markdown.
  • Use semantic HTML tables when appropriate.
  • For lists, use <ul><li>...</li></ul>.
- After the main answer, include an expandable Sources block:
  <details><summary>Sources</summary>
    <ol>
      <li>FileName (pos N) — brief hint</li>
      ...
    </ol>
  </details>
`;
    const answer = await geminiChat(prompt);
    const sources = scored.map((s, i) => ({
      ref: i + 1,
      fileName: s.fileName,
      position: s.position,
      score: Number(s.score.toFixed(4)),
      preview: s.chunk.slice(0, 400) + (s.chunk.length > 400 ? '…' : ''),
    }));
    res.json({
      result: answer,
      sources,
      used: scored.length,
      totalIndexed: VECTOR_STORE.length,
      result_format: hasTabular ? 'html' : 'auto',
      has_tabular: !!hasTabular,
    });
  } catch (err) {
    console.error('❌ /ask error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------ Compatibility Endpoints ------------------------------ */
app.post('/summarize-multi', async (req, res) => {
  try {
    const { query, files } = req.body;
    if (!query || !files?.length) {
      return res.status(400).json({ error: 'Missing query or files' });
    }
    const docs = files.map(f => ({
      fileName: f.name,
      text: f.text,
      mime: f.meta || 'text/plain',
      system: f.system || '',
      subsystem: f.subsystem || '',
      meta: {},
    }));
    const base = getInternalBase();
    await fetch(`${base}/ingest-json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documents: docs }),
    });
    const askRes = await fetch(`${base}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, k: MAX_SNIPPETS }),
    });
    const data = await askRes.json();
    if (askRes.ok) return res.json(data);
    return res.status(500).json({ error: data.error || 'RAG error' });
  } catch (err) {
    console.error('❌ /summarize-multi error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/search-multi', async (req, res) => {
  try {
    const { keyword, files } = req.body;
    if (!keyword || !files?.length) {
      return res.status(400).json({ error: 'Missing keyword or files' });
    }
    const docs = files.map(f => ({
      fileName: f.name,
      text: f.text,
      mime: f.meta || 'text/plain',
      system: f.system || '',
      subsystem: f.subsystem || '',
      meta: {},
    }));
    const base = getInternalBase();
    await fetch(`${base}/ingest-json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documents: docs }),
    });
    const askRes = await fetch(`${base}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: keyword, k: MAX_SNIPPETS }),
    });
    const data = await askRes.json();
    if (askRes.ok) return res.json(data);
    return res.status(500).json({ error: data.error || 'RAG error' });
  } catch (err) {
    console.error('❌ /search-multi error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------ Diagnostics ------------------------------ */
app.get('/health', (req, res) => res.json({ ok: true, indexed: VECTOR_STORE.length }));
app.get('/stats', (req, res) => {
  const byFile = {};
  VECTOR_STORE.forEach(v => {
    byFile[v.fileName] = (byFile[v.fileName] || 0) + 1;
  });
  res.json({ totalChunks: VECTOR_STORE.length, byFile });
});

/* ------------------------------ Server ------------------------------ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 RAG server running on http://0.0.0.0:${PORT}`);
  console.log(`✅ Access your app at https://kmrc-backend.onrender.com`);
});
