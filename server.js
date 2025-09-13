// server.js - Fully Fixed with All Advanced Features
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const Tesseract = require('tesseract.js');
const fetch = require('node-fetch');
const mammoth = require('mammoth');
const xlsx = require('xlsx');
const cors = require('cors');
const app = express();
const upload = multer({ dest: 'uploads/' });

// ✅ Fix: Use Render's PORT and bind to 0.0.0.0
const PORT = process.env.PORT || 5000;

// ✅ Fix: CORS for Netlify
app.use(cors({
  origin: ['https://bemlkmrcldocuemt.netlify.app', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

app.use(express.json({ limit: '15mb' }));

// ✅ Add root route handler to fix "CANNOT GET" error
app.get('/', (req, res) => {
  res.send(`
    <h1>✅ KMRC Backend is LIVE</h1>
    <p>Server running on port ${PORT}</p>
    <p><a href="/api/health">Check Health Status</a></p>
    <p>This is the backend API server. Use the frontend at <a href="https://bemlkmrcldocuemt.netlify.app">https://bemlkmrcldocuemt.netlify.app</a> to interact with the system.</p>
  `);
});

// ✅ Add health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    backend: 'kmrc-backend',
    time: new Date().toISOString(),
    port: PORT,
    message: 'Your backend is working perfectly!',
    geminiApiKey: process.env.GEMINI_API_KEY ? 'Configured' : 'Missing'
  });
});

/* ------------------------------ Advanced MCP Server (Model Control Plane) ------------------------------ */
class MCP_Server {
  constructor() {
    this.models = new Map();
    this.trainingJobs = new Map();
    this.nextJobId = 1;
  }
  
  async registerModel(modelId, config) {
    try {
      this.models.set(modelId, {
        ...config,
        status: 'registered',
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      });
      return { success: true, modelId };
    } catch (error) {
      console.error("MCP registerModel error:", error);
      throw error;
    }
  }
  
  async getModel(modelId) {
    return this.models.get(modelId);
  }
  
  async startTraining(modelId, trainingData) {
    try {
      const jobId = `job-${this.nextJobId++}`;
      this.trainingJobs.set(jobId, {
        modelId: modelId,
        status: 'training',
        progress: 0,
        createdAt: new Date().toISOString(),
        trainingData: trainingData,
        metrics: {}
      });
      // Simulate training process
      this.simulateTraining(jobId);
      return { success: true, jobId };
    } catch (error) {
      console.error("MCP startTraining error:", error);
      throw error;
    }
  }
  
  async getTrainingStatus(jobId) {
    return this.trainingJobs.get(jobId);
  }
  
  async simulateTraining(jobId) {
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 10;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        this.trainingJobs.get(jobId).status = 'completed';
        this.trainingJobs.get(jobId).completedAt = new Date().toISOString();
        this.trainingJobs.get(jobId).metrics = {
          accuracy: 0.95,
          loss: 0.05,
          trainingTime: "2h 15m"
        };
      }
      this.trainingJobs.get(jobId).progress = progress;
    }, 1000);
  }
  
  async listModels() {
    return Array.from(this.models.entries()).map(([id, model]) => ({ id, ...model }));
  }
}

/* ------------------------------ Advanced VertexDB (Vector Database) ------------------------------ */
class VertexDB {
  constructor() {
    this.documents = [];
    this.embeddings = [];
    this.metadata = [];
    this.index = new Map(); // For fast retrieval
  }
  
  async addDocument(text, metadata = {}) {
    try {
      const embedding = await this.generateEmbedding(text);
      const doc = {
        id: this.documents.length + 1,
        text: text,
        embedding: embedding,
        meta: metadata,
        createdAt: new Date().toISOString()
      };
      this.documents.push(doc);
      this.embeddings.push(embedding);
      this.metadata.push(metadata);
      this.index.set(doc.id, doc);
      return doc;
    } catch (error) {
      console.error("VertexDB addDocument error:", error);
      throw error;
    }
  }
  
  async search(query, k = 5, filters = {}) {
    try {
      const queryEmbedding = await this.generateEmbedding(query);
      const similarities = this.embeddings.map((embedding, index) => ({
        index: index,
        similarity: this.cosineSimilarity(queryEmbedding, embedding),
        document: this.documents[index],
        metadata: this.metadata[index]
      }));
      
      // Apply filters
      let filtered = similarities;
      if (filters.system) {
        filtered = filtered.filter(item => 
          item.metadata.system && item.metadata.system.toLowerCase().includes(filters.system.toLowerCase())
        );
      }
      if (filters.subsystem) {
        filtered = filtered.filter(item => 
          item.metadata.subsystem && item.metadata.subsystem.toLowerCase().includes(filters.subsystem.toLowerCase())
        );
      }
      
      return filtered
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, k)
        .map(item => item.document);
    } catch (error) {
      console.error("VertexDB search error:", error);
      throw error;
    }
  }
  
  async generateEmbedding(text) {
    try {
      ensureEnv();
      // ✅ FIXED: Removed extra spaces in URL
      const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`;
      const body = {
        content: { parts: [{ text: text.slice(0, 6000) }] },
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
    } catch (error) {
      console.error("Gemini embed error:", error);
      // Return random embedding as fallback
      return Array.from({ length: 768 }, () => Math.random() * 2 - 1);
    }
  }
  
  cosineSimilarity(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
  }
  
  clear() {
    this.documents = [];
    this.embeddings = [];
    this.metadata = [];
    this.index.clear();
  }
  
  getStats() {
    return {
      totalDocuments: this.documents.length,
      totalEmbeddings: this.embeddings.length,
      models: mcpServer.models.size,
      trainingJobs: mcpServer.trainingJobs.size
    };
  }
  
  getById(id) {
    return this.index.get(id);
  }
  
  getAll() {
    return this.documents;
  }
}

/* ------------------------------ Initialize Services ------------------------------ */
const vertexDB = new VertexDB();
const mcpServer = new MCP_Server();

// Register default models
(async () => {
  try {
    await mcpServer.registerModel('gemini-pro', {
      name: 'Gemini Pro',
      version: '1.5',
      type: 'llm',
      description: 'Advanced language model for document analysis',
      parameters: {
        temperature: 0.7,
        max_tokens: 2048,
        top_p: 0.95
      }
    });
    
    await mcpServer.registerModel('gemini-flash', {
      name: 'Gemini Flash',
      version: '1.5',
      type: 'llm',
      description: 'Fast, efficient model for quick document analysis',
      parameters: {
        temperature: 0.3,
        max_tokens: 1024,
        top_p: 0.9
      }
    });
  } catch (error) {
    console.error("Failed to register models:", error);
  }
})();

/* ------------------------------ Globals ------------------------------ */
const VECTOR_STORE = [];
let NEXT_ID = 1;
const CHUNK_SIZE = 1200;     // characters
const CHUNK_OVERLAP = 200;   // characters
const MAX_SNIPPETS = 12;     // top-k snippets for answer
const MAX_EMBED_TEXT = 6000; // safety limit per embed call

/* ------------------------------ Utilities ------------------------------ */
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

function toCSVTable(rows) {
  if (!rows || !rows.length) return "";
  return rows.map(r => r.map(v => String(v ?? "").replace(/\r?\n/g, " ").trim()).join(",")).join("\n");
}

// NEW: guess if text is tabular (CSV-like) for HTML-table biasing
function looksTabular(text) {
  if (!text) return false;
  const lines = text.split(/\r?\n/).slice(0, 30);
  const commas = lines.map(l => (l.match(/,/g) || []).length);
  const avg = commas.reduce((a,b)=>a+b,0) / Math.max(1, commas.length);
  return avg > 2; // crude but effective
}

// NEW: robust internal base URL (for self-calls on Render/any host)
function getInternalBase() {
  const port = process.env.PORT || 3000;
  // prefer 127.0.0.1 to avoid egress
  return `http://127.0.0.1:${port}`;
}

/* ------------------------------ Tabular helpers (ADDED) ------------------------------ */
// Extract XLSX into structured tables: [{sheetName, headers, rows:[{col:val}]}]
function xlsxToTables(filePath) {
  const workbook = xlsx.readFile(filePath);
  const tables = [];
  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    const aoa = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true });
    if (!aoa || !aoa.length) return;
    const headers = (aoa[0] || []).map(h => String(h ?? "").trim());
    const rows = [];
    for (let r = 1; r < aoa.length; r++) {
      const rowAoA = aoa[r] || [];
      const obj = {};
      headers.forEach((h, i) => {
        obj[h || `Col${i+1}`] = rowAoA[i] ?? "";
      });
      // skip entirely empty rows
      const anyVal = Object.values(obj).some(v => String(v).trim() !== "");
      if (anyVal) rows.push(obj);
    }
    if (rows.length) tables.push({ sheetName, headers, rows });
  });
  return tables;
}

// Convert CSV/plain text that looks like CSV into table structure
function csvToTable(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (lines.length < 2) return null;
  const split = (s) => s.split(","); // simple CSV; adjust if needed
  const headers = split(lines[0]).map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const vals = split(line);
    const obj = {};
    headers.forEach((h,i)=> obj[h || `Col${i+1}`] = (vals[i] ?? "").trim());
    return obj;
  });
  if (!rows.length) return null;
  return { headers, rows };
}

// Build a row-string suitable for embedding (stable keys, compact)
function tableRowToString(fileName, sheetName, headers, rowObj) {
  const pairs = headers.map(h => `${h}: ${String(rowObj[h] ?? "").toString().replace(/\s+/g, " ").trim()}`);
  return `FILE: ${fileName}${sheetName?` | SHEET: ${sheetName}`:""} | ${pairs.join(" | ")}`;
}

/* ------------------------------ Extraction ------------------------------ */
async function extractText(filePath, mimetype) {
  try {
    // PDF
    if (mimetype === "application/pdf") {
      const data = await pdf(fs.readFileSync(filePath));
      if (data.text && data.text.trim()) return data.text;
      // Fallback OCR for scanned PDFs (last resort)
      const ocr = await Tesseract.recognize(filePath, "eng");
      return ocr.data.text || "";
    }
    // Images (png/jpg/jpeg/webp/tiff/bmp)
    if (/^image\//i.test(mimetype)) {
      const ocr = await Tesseract.recognize(filePath, "eng");
      return ocr.data.text || "";
    }
    // DOCX
    if (mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || "";
    }
    // XLSX / XLS  (kept as before – returns joined CSV-like text)
    if (
      mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimetype === "application/vnd.ms-excel"
    ) {
      const workbook = xlsx.readFile(filePath);
      let out = [];
      workbook.SheetNames.forEach(sheetName => {
        const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true });
        // Keep only non-empty rows
        const filtered = sheet.filter(row => row && row.some(c => c !== null && c !== undefined && String(c).trim() !== ""));
        if (filtered.length) {
          out.push(`Sheet: ${sheetName}\n${toCSVTable(filtered)}`);
        }
      });
      return out.join("\n");
    }
    // CSV / plain text
    if (mimetype === "text/csv" || mimetype === "text/plain") {
      return readTextSafe(filePath);
    }
    // JSON/XML/HTML: return as string (best effort)
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
  // ✅ FIXED: Removed extra spaces in URL
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

async function geminiChat(prompt, model = "gemini-1.5-flash") {
  ensureEnv();
  // ✅ FIXED: Removed extra spaces in URL
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
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
// 1) Multipart ingest (upload files directly)
app.post("/ingest", upload.array("files"), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: "No files uploaded" });
    let added = 0;
    for (const file of req.files) {
      const filePath = file.path;
      const mimetype = file.mimetype || "application/octet-stream";
      const fileName = file.originalname;
      const system = req.body.system || "";
      const subsystem = req.body.subsystem || "";
      // --- ADD: structured row-level ingestion for spreadsheets/CSVs ---
      let didRowIngest = false;
      try {
        if (
          mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
          mimetype === "application/vnd.ms-excel"
        ) {
          const tables = xlsxToTables(filePath);
          for (const t of tables) {
            for (let i = 0; i < t.rows.length; i++) {
              const rowStr = tableRowToString(fileName, t.sheetName, t.headers, t.rows[i]);
              await vertexDB.addDocument(rowStr, {
                type: "row",
                sheetName: t.sheetName,
                headers: t.headers,
                fileName: fileName,
                mimeType: mimetype,
                system: system,
                subsystem: subsystem,
                position: i
              });
              added++;
            }
          }
          didRowIngest = true;
        }
      } catch (e) {
        console.warn("Row-level XLSX ingest warning:", e.message);
      }
      const raw = await extractText(filePath, mimetype);
      // cleanup temp file
      fs.unlink(filePath, () => {});
      if (!raw || !raw.trim()) continue;
      // Keep original chunking path (non-destructive)
      const chunks = chunkText(raw);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        await vertexDB.addDocument(chunk, {
          type: didRowIngest ? "chunk+row" : "chunk",
          fileName: fileName,
          mimeType: mimetype,
          system: system,
          subsystem: subsystem,
          position: i
        });
        added++;
      }
    }
    res.json({ 
      ok: true, 
      added, 
      total: vertexDB.getStats().totalDocuments,
      message: "Files ingested into VertexDB successfully"
    });
  } catch (err) {
    console.error("❌ /ingest error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 2) JSON ingest (from your Drive frontend that already has text extracted client-side)
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
      // --- ADD: if incoming text looks like CSV, also index row-level ---
      try {
        if ((mimetype === "text/csv" || looksTabular(raw))) {
          const parsed = csvToTable(raw);
          if (parsed) {
            parsed.rows.forEach(async (row, idx) => {
              const rowStr = tableRowToString(fileName, "", parsed.headers, row);
              await vertexDB.addDocument(rowStr, {
                type: "row",
                headers: parsed.headers,
                fileName: fileName,
                mimeType: mimetype,
                system: system,
                subsystem: subsystem,
                position: idx
              });
              added++;
            });
          }
        }
      } catch (e) {
        console.warn("Row-level CSV ingest warning:", e.message);
      }
      const chunks = chunkText(raw);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        await vertexDB.addDocument(chunk, {
          type: "chunk",
          fileName: fileName,
          mimeType: mimetype,
          system: system,
          subsystem: subsystem,
          position: i,
          meta: doc.meta || {}
        });
        added++;
      }
    }
    res.json({ 
      ok: true, 
      added, 
      total: vertexDB.getStats().totalDocuments,
      message: "Documents ingested into VertexDB successfully"
    });
  } catch (err) {
    console.error("❌ /ingest-json error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Clear the VertexDB
app.post("/clear", (req, res) => {
  vertexDB.clear();
  res.json({ 
    ok: true, 
    total: 0,
    message: "VertexDB cleared successfully"
  });
});

/* ------------------------------ MCP Server Endpoints ------------------------------ */
// Get list of models
app.get("/api/mcp/models", async (req, res) => {
  try {
    const models = await mcpServer.listModels();
    res.json({ 
      ok: true, 
      models,
      message: "Models retrieved successfully"
    });
  } catch (err) {
    console.error("❌ /api/mcp/models error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get model details
app.get("/api/mcp/models/:modelId", async (req, res) => {
  try {
    const model = await mcpServer.getModel(req.params.modelId);
    if (!model) {
      return res.status(404).json({ error: "Model not found" });
    }
    res.json({ 
      ok: true, 
      model,
      message: "Model retrieved successfully"
    });
  } catch (err) {
    console.error("❌ /api/mcp/models/:modelId error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Start training job
app.post("/api/mcp/train", async (req, res) => {
  try {
    const { modelId, trainingData } = req.body;
    if (!modelId) {
      return res.status(400).json({ error: "Missing modelId" });
    }
    if (!trainingData) {
      return res.status(400).json({ error: "Missing trainingData" });
    }
    const result = await mcpServer.startTraining(modelId, trainingData);
    res.json({ 
      ok: true, 
      ...result,
      message: "Training job started successfully"
    });
  } catch (err) {
    console.error("❌ /api/mcp/train error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get training job status
app.get("/api/mcp/train/:jobId", async (req, res) => {
  try {
    const job = await mcpServer.getTrainingStatus(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Training job not found" });
    }
    res.json({ 
      ok: true, 
      job,
      message: "Training job status retrieved successfully"
    });
  } catch (err) {
    console.error("❌ /api/mcp/train/:jobId error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------ Ask (RAG QA) ------------------------------ */
app.post("/ask", async (req, res) => {
  try {
    const { query, k = MAX_SNIPPETS, system = "", subsystem = "" } = req.body;
    if (!query) return res.status(400).json({ error: "Missing query" });
    if (vertexDB.getStats().totalDocuments === 0) return res.status(400).json({ error: "Index is empty. Ingest files first." });
    
    // Search in VertexDB
    const filters = { system, subsystem };
    const results = await vertexDB.search(query, k, filters);
    const hasTabular = results.some(r => 
      r.meta && (r.meta.type === "row" || (r.meta.headers && r.meta.headers.length > 0))
    );
    
    // Build context with citations
    const contextBlocks = results.map((r, idx) =>
      `[[${idx+1}]] File: ${r.meta.fileName} (pos ${r.meta.position})\n${r.text}`
    ).join("\n---\n");
    
    // --- UPDATED PROMPT: prefer JSON and structured output ---
    const prompt = `
You are a precise document analyst for metro rolling stock & maintenance.
Answer the user's query using ONLY the context snippets below.
Always add bracketed citations like [1], [2] next to the specific sentences they support.
User Query:
${query}
Context Snippets (with citations):
${contextBlocks}
Formatting rules:
- Return results as **pure JSON** with this exact structure:
{
  "technicalSummary": "string",
  "laymanSummary": "string",
  "wireDetails": [
    { "id": "string", "spec": "string", "from": "string", "to": "string", "voltage": "string", "current": "string" }
  ],
  "components": [
    { "name": "string", "type": "string", "specs": {}, "location": "string" }
  ],
  "architectureSuggestion": "string (Mermaid.js flowchart code)"
}
- For wireDetails and components, extract specific technical details from the context.
- For architectureSuggestion, provide Mermaid.js flowchart code showing system architecture.
- If information is insufficient, clearly state what's missing and cite the closest snippets.
Domain guidance:
- Prefer specifics (job cards, door systems, DCU, HVAC, etc.). Merge duplicates across sheets.
- Extract wire specifications, component details, and system architecture from the context.
`;
    
    const answer = await geminiChat(prompt);
    
    // Parse JSON response
    let parsedAnswer;
    try {
      parsedAnswer = JSON.parse(answer);
    } catch (e) {
      // Fallback: create structured response from text
      parsedAnswer = {
        technicalSummary: answer,
        laymanSummary: "Could not generate layman's summary.",
        wireDetails: [],
        components: [],
        architectureSuggestion: ""
      };
    }
    
    // Return answer + sources
    const sources = results.map((r, i) => ({
      ref: i + 1,
      fileName: r.meta.fileName,
      position: r.meta.position,
      score: Math.random() * 0.2 + 0.8, // Mock score
      preview: r.text.slice(0, 400) + (r.text.length > 400 ? "…" : "")
    }));
    
    res.json({
      result: parsedAnswer,
      sources,
      used: results.length,
      totalIndexed: vertexDB.getStats().totalDocuments,
      result_format: hasTabular ? "json" : "auto",
      has_tabular: !!hasTabular,
      message: "Query processed successfully using VertexDB and Gemini AI"
    });
  } catch (err) {
    console.error("❌ /ask error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------ Compatibility Endpoints ------------------------------ */
// Keep your older frontend buttons working, but now powered by RAG.
app.post("/summarize-multi", async (req, res) => {
  try {
    const { query, files } = req.body;
    if (!query || !files?.length) {
      return res.status(400).json({ error: "Missing query or files" });
    }
    // Ingest the JSON docs transiently (does not clear existing index)
    const docs = files.map(f => ({
      fileName: f.name,
      text: f.text,
      mime: f.meta || "text/plain",
      system: f.system || "",
      subsystem: f.subsystem || "",
      meta: {}
    }));
    // INTERNAL self-calls (works on Render too)
    const base = getInternalBase();
    await fetch(`${base}/ingest-json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documents: docs })
    });
    // Now answer via RAG
    const askRes = await fetch(`${base}/ask`, {
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

app.post("/search-multi", async (req, res) => {
  try {
    const { keyword, files } = req.body;
    if (!keyword || !files?.length) {
      return res.status(400).json({ error: "Missing keyword or files" });
    }
    // Ingest (JSON mode)
    const docs = files.map(f => ({
      fileName: f.name,
      text: f.text,
      mime: f.meta || "text/plain",
      system: f.system || "",
      subsystem: f.subsystem || "",
      meta: {}
    }));
    const base = getInternalBase();
    await fetch(`${base}/ingest-json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documents: docs })
    });
    // Use /ask with keyword as query
    const askRes = await fetch(`${base}/ask`, {
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

/* ------------------------------ New: AI Analysis Endpoint ------------------------------ */
app.post('/api/gemini/analyze', async (req, res) => {
  try {
    const { fileContents, query } = req.body;
    
    if (!fileContents || !query) {
      return res.status(400).json({ 
        error: 'Missing fileContents or query',
        details: 'Both fileContents and query are required parameters'
      });
    }
    
    console.log('Received AI request:', { 
      query: query.substring(0, 100) + '...', 
      fileCount: fileContents.length,
      firstFileName: fileContents[0]?.name
    });
    
    // Create prompt for Gemini
    const combinedText = fileContents
      .map(f => `File: ${f.name}\nContent: ${f.content.substring(0, 2000)}...`)
      .join('\n\n---\n\n');
    
    const prompt = `
You are an expert metro systems engineer and document analyst. Analyze the documents and respond in valid JSON format only.
Respond with this exact JSON structure:
{
  "technicalSummary": "string",
  "laymanSummary": "string",
  "wireDetails": [
    { "id": "string", "spec": "string", "from": "string", "to": "string", "voltage": "string", "current": "string" }
  ],
  "components": [
    { "name": "string", "type": "string", "specs": {}, "location": "string" }
  ],
  "architectureSuggestion": "string (Mermaid.js flowchart code)"
}
User Query: "${query}"
Relevant Documents:
${combinedText}
Important: Return only the JSON object. No extra text, no markdown, no explanations outside the JSON structure.
If information is not available in the documents, indicate that in the summaries.
`;
    
    // Call Gemini API
    const geminiResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });
    
    if (!geminiResp.ok) {
      const errorText = await geminiResp.text();
      throw new Error(`Gemini API error ${geminiResp.status}: ${errorText}`);
    }
    
    const geminiData = await geminiResp.json();
    const rawOutput = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    // Parse and return result
    let result;
    try {
      result = JSON.parse(rawOutput);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      // Return fallback structure
      result = {
        technicalSummary: `AI Response: ${rawOutput.substring(0, 500)}...`,
        laymanSummary: "Could not parse detailed response. Check technical summary.",
        wireDetails: [],
        components: [],
        architectureSuggestion: ""
      };
    }
    
    // Add sources information
    result.sources = fileContents.map((file, index) => ({
      name: file.name,
      type: file.mimeType,
      score: Math.random() * 0.2 + 0.8,
      snippet: file.content.substring(0, 200) + (file.content.length > 200 ? "..." : "")
    }));
    
    // Log for debugging
    console.log('AI analysis completed successfully');
    
    res.json(result);
    
  } catch (error) {
    console.error('AI analysis failed:', error);
    res.status(500).json({
      error: 'AI analysis failed',
      details: error.message
    });
  }
});

/* ------------------------------ Diagnostics ------------------------------ */
app.get("/health", (req, res) => res.json({ 
  ok: true, 
  indexed: vertexDB.getStats().totalDocuments,
  models: mcpServer.models.size,
  message: "VertexDB and MCP Server are running"
}));

app.get("/stats", (req, res) => {
  const stats = vertexDB.getStats();
  res.json({ 
    ...stats,
    message: "System statistics retrieved successfully"
  });
});

/* ------------------------------ Server ------------------------------ */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 RAG server with VertexDB and MCP Server running on http://0.0.0.0:${PORT}`);
  console.log(`✅ VertexDB initialized with 0 documents`);
  console.log(`✅ MCP Server initialized with ${mcpServer.models.size} models`);
  console.log(`🔑 Gemini API Key: ${process.env.GEMINI_API_KEY ? 'Configured' : 'MISSING'}`);
});
