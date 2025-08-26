// server.js
// RAG Server for KMRCL — SHASHI SHEKHAR MISHRA
// Features: Extraction (PDF/IMG/DOCX/XLSX/CSV) → Chunk → Embeddings (Gemini) → In-memory Vector Store → Ask

import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import pdf from "pdf-parse";
import Tesseract from "tesseract.js";
import fetch from "node-fetch";
import mammoth from "mammoth";
import cors from "cors";
import dotenv from "dotenv";
import xlsx from "xlsx";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json({ limit: "25mb" }));

/* ------------------------------ Globals ------------------------------ */

const VECTOR_STORE = [];
let NEXT_ID = 1;

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;
const MAX_SNIPPETS = 12;
const MAX_EMBED_TEXT = 6000;

function ensureEnv() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY missing in environment.");
  }
}

function readTextSafe(filePath) {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return ""; }
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
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

/* ------------------------------ Extraction ------------------------------ */

async function extractText(filePath, mimetype) {
  try {
    // PDF
    if (mimetype === "application/pdf") {
      const data = await pdf(fs.readFileSync(filePath));
      if (data && data.text && data.text.trim()) return data.text;
      // Fallback OCR (scanned)
      const ocr = await Tesseract.recognize(filePath, "eng");
      return ocr.data.text || "";
    }

    // Images
    if (/^image\//i.test(mimetype)) {
      const ocr = await Tesseract.recognize(filePath, "eng");
      return ocr.data.text || "";
    }

    // DOCX
    if (mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || "";
    }

    // XLSX / XLS
    if (
      mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimetype === "application/vnd.ms-excel"
    ) {
      const workbook = xlsx.readFile(filePath);
      let out = [];
      workbook.SheetNames.forEach(sheetName => {
        const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true });
        const filtered = sheet.filter(row => row && row.some(c => c !== null && c !== undefined && String(c).trim() !== ""));
        if (filtered.length) {
          out.push(`Sheet: ${sheetName}\n${filtered.map(r => r.map(c => (c===undefined||c===null)?"":String(c)).join(" | ")).join("\n")}`);
        }
      });
      return out.join("\n\n");
    }

    // CSV / plain text
    if (mimetype === "text/csv" || mimetype === "text/plain") {
      return readTextSafe(filePath);
    }

    if (/json|xml|html/.test(mimetype)) {
      return readTextSafe(filePath);
    }

    return "";
  } catch (err) {
    console.error("❌ extractText error:", err);
    return "";
  }
}

/* ------------------------------ Gemini API ------------------------------ */

async function geminiEmbed(text) {
  ensureEnv();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`;
  const body = {
    content: { parts: [{ text: text.slice(0, MAX_EMBED_TEXT) }] },
    taskType: "RETRIEVAL_DOCUMENT",
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Gemini chat error ${res.status}: ${raw}`);
  const data = JSON.parse(raw);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response from Gemini.";
}

/* ------------------------------ Indexing (Ingest) ------------------------------ */

// /ingest — multipart upload of files; server will extract + embed + add to VECTOR_STORE
app.post("/ingest", upload.array("files"), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: "No files uploaded" });

    let added = 0;
    for (const file of req.files) {
      const filePath = file.path;
      const mimetype = file.mimetype || "application/octet-stream";
      const fileName = file.originalname;

      const raw = await extractText(filePath, mimetype);
      // cleanup temp file
      try { fs.unlinkSync(filePath); } catch (e) {}

      if (!raw || !raw.trim()) continue;

      const chunks = chunkText(raw);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const emb = await geminiEmbed(chunk);
        VECTOR_STORE.push({
          id: NEXT_ID++,
          fileName,
          mime: mimetype,
          meta: {},
          system: req.body.system || "",
          subsystem: req.body.subsystem || "",
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
    console.error("❌ /ingest error:", err);
    res.status(500).json({ error: err.message });
  }
});

// /ingest-json — ingest pre-extracted JSON documents
app.post("/ingest-json", async (req, res) => {
  try {
    const { documents } = req.body;
    if (!documents?.length) return res.status(400).json({ error: "No documents provided" });

    let added = 0;
    for (const doc of documents) {
      const fileName = doc.fileName || doc.name || "Untitled";
      const mimetype = doc.mime || doc.meta || "text/plain";
      const system = doc.system || "";
      const subsystem = doc.subsystem || "";
      const raw = String(doc.text || "");

      if (!raw.trim()) continue;

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
    console.error("❌ /ingest-json error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Clear index
app.post("/clear", (req, res) => {
  VECTOR_STORE.length = 0;
  NEXT_ID = 1;
  res.json({ ok: true, total: 0 });
});

/* ------------------------------ Ask (RAG QA) ------------------------------ */

app.post("/ask", async (req, res) => {
  try {
    const { query, k = MAX_SNIPPETS, system = "", subsystem = "" } = req.body;
    if (!query) return res.status(400).json({ error: "Missing query" });
    if (VECTOR_STORE.length === 0) return res.status(400).json({ error: "Index is empty. Ingest files first." });

    const qEmb = await geminiEmbed(query);

    const candidates = VECTOR_STORE.filter(x => {
      const sysOk = system ? (x.system || "").toLowerCase().includes(system.toLowerCase()) : true;
      const subOk = subsystem ? (x.subsystem || "").toLowerCase().includes(subsystem.toLowerCase()) : true;
      return sysOk && subOk;
    });

    const scored = candidates.map(c => ({ ...c, score: cosineSim(qEmb, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(k, candidates.length));

    const contextBlocks = scored.map((c, idx) =>
      `[[${idx+1}]] File: ${c.fileName} (pos ${c.position})\n${c.chunk}`
    ).join("\n\n---\n\n");

    const prompt = `
You are a precise document analyst for metro rolling stock & maintenance.
Answer the user's query **only** using the context snippets below.
If data appears in tables (CSV-like), read them as matrices and preserve columns.
When the user asks for "matrix/table", output an HTML table.
Always cite sources by [index] at the end of the relevant sentences.

User Query:
${query}

Context Snippets (with citations):
${contextBlocks}

Instructions:
- Prefer specifics (job cards, door systems, DCU, etc.).
- If multiple sheets/sections mention the same item, merge them.
- If you generate a table, use clean HTML: <table><thead><tr>...</tr></thead><tbody>...</tbody></table>.
- If insufficient info, say what’s missing and suggest the most relevant files by name with [index].
`;

    const answer = await geminiChat(prompt);

    const sources = scored.map((s, i) => ({
      ref: i + 1,
      fileName: s.fileName,
      position: s.position,
      score: Number(s.score.toFixed(4)),
      preview: s.chunk.slice(0, 400) + (s.chunk.length > 400 ? "…" : "")
    }));

    res.json({ result: answer, sources, used: scored.length, totalIndexed: VECTOR_STORE.length });
  } catch (err) {
    console.error("❌ /ask error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------ Compatibility Endpoints ------------------------------ */

// summarize-multi — ingest JSON docs transiently then ask
app.post("/summarize-multi", async (req, res) => {
  try {
    const { query, files } = req.body;
    if (!query || !files?.length) {
      return res.status(400).json({ error: "Missing query or files" });
    }
    const docs = files.map(f => ({
      fileName: f.name,
      text: f.text,
      mime: f.meta || "text/plain",
      system: f.system || "",
      subsystem: f.subsystem || "",
      meta: {}
    }));
    // ingest-json
    const ingestResp = await fetch(`http://localhost:${process.env.PORT || 3000}/ingest-json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documents: docs })
    });
    const ingestData = await ingestResp.json();
    if (!ingestResp.ok) {
      console.warn("ingest-json failed", ingestData);
    }
    // ask
    const askRes = await fetch(`http://localhost:${process.env.PORT || 3000}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, k: MAX_SNIPPETS })
    });
    const data = await askRes.json();
    if (askRes.ok) return res.json(data);
    return res.status(500).json({ error: data.error || "RAG error" });
  } catch (err) {
    console.error("❌ /summarize-multi error:", err);
    res.status(500).json({ error: err.message });
  }
});

// search-multi — ingest JSON docs then ask with keyword
app.post("/search-multi", async (req, res) => {
  try {
    const { keyword, files } = req.body;
    if (!keyword || !files?.length) {
      return res.status(400).json({ error: "Missing keyword or files" });
    }
    const docs = files.map(f => ({
      fileName: f.name,
      text: f.text,
      mime: f.meta || "text/plain",
      system: f.system || "",
      subsystem: f.subsystem || "",
      meta: {}
    }));
    await fetch(`http://localhost:${process.env.PORT || 3000}/ingest-json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documents: docs })
    });

    const askRes = await fetch(`http://localhost:${process.env.PORT || 3000}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: keyword, k: MAX_SNIPPETS })
    });
    const data = await askRes.json();
    if (askRes.ok) return res.json(data);
    return res.status(500).json({ error: data.error || "RAG error" });
  } catch (err) {
    console.error("❌ /search-multi error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------ Diagnostics ------------------------------ */

app.get("/health", (req, res) => res.json({ ok: true, indexed: VECTOR_STORE.length }));
app.get("/stats", (req, res) => {
  const byFile = {};
  VECTOR_STORE.forEach(v => { byFile[v.fileName] = (byFile[v.fileName] || 0) + 1; });
  res.json({ totalChunks: VECTOR_STORE.length, byFile });
});

/* ------------------------------ Server ------------------------------ */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 RAG server running on http://localhost:${PORT}`);
});
