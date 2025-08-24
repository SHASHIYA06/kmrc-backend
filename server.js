// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();

// ---------- Hard checks ----------
if (!process.env.GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY is missing in .env");
}
console.log("✅ FRONTEND_URL:", process.env.FRONTEND_URL || "(not set)");

// ---------- CORS ----------
const allowList = [
  process.env.FRONTEND_URL,               // your Netlify site
  "http://localhost:5173",                // vite dev (optional)
  "http://localhost:3001"                 // alt dev (optional)
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin / server-2-server / curl (no origin)
    if (!origin) return cb(null, true);

    // Allow exact matches in allowList
    if (allowList.some(o => origin === o)) return cb(null, true);

    // Allow Netlify deploy previews (subdomains)
    if (/^https:\/\/[a-z0-9-]+--.*\.netlify\.app$/.test(origin)) return cb(null, true);

    // If you want to strictly lock down, replace with: cb(new Error("CORS blocked"), false)
    return cb(null, true);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.options("*", cors());

// ---------- Body size (big docs!) ----------
app.use(express.json({ limit: "50mb" }));

// ---------- Utils ----------
function normalize(s) {
  return (s || "")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkText(text, size = 1800, overlap = 200) {
  const clean = normalize(text);
  if (!clean) return [];
  const chunks = [];
  for (let i = 0; i < clean.length; i += size - overlap) {
    chunks.push(clean.slice(i, i + size));
  }
  return chunks;
}

function scoreChunk(query, chunk) {
  const q = normalize(query).toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const c = chunk.toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (t.length < 2) continue;
    const matches = c.split(t).length - 1;
    score += matches * (t.length >= 5 ? 3 : 1);
  }
  score += Math.min(chunk.length / 500, 5);
  return score;
}

function selectTopChunks(query, files, maxChars = 20000, maxChunks = 50) {
  const all = [];
  for (const f of files) {
    const chunks = chunkText(f.text);
    chunks.forEach((ch, idx) => {
      all.push({
        file: f.name || "unknown",
        idx,
        text: ch,
        score: scoreChunk(query, ch),
      });
    });
  }
  all.sort((a, b) => b.score - a.score);

  const picked = [];
  let total = 0;
  for (const item of all) {
    if (total + item.text.length > maxChars) break;
    picked.push(item);
    total += item.text.length;
    if (picked.length >= maxChunks) break;
  }
  return picked;
}

function buildPrompt(query, files, systemInstruction) {
  const tops = selectTopChunks(query, files);
  const ctx = tops.map(t =>
    `<<<FILE:${t.file} | CHUNK:${t.idx}>>>\n${t.text}\n<<<END>>>`
  ).join("\n");

  return `
[ROLE]
${systemInstruction}

[GUIDELINES]
- Use only the provided document context; cite (filename §chunkN) when specific.
- If wiring/architecture is implied, add a Mermaid diagram:
\`\`\`mermaid
flowchart TD
  A[Source] --> B[Processor]
  B --> C[Sink]
\`\`\`
- If tracing wires end-to-end, output an ordered checklist and reference where evidence appears.
- If information is missing, say so and suggest where to look.

[USER QUERY]
${query}

[DOCUMENT CONTEXT]
${ctx}
`.trim();
}

async function callGemini(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const body = {
    contents: [{ role: "user", parts: [{ text }]}]
  };

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (netErr) {
    // This is the one that usually causes "TypeError: Failed to fetch" → surfaces as "Load failed" in frontend
    console.error("🌐 Network error calling Gemini:", netErr);
    throw new Error("Network error contacting Gemini. Check server outbound egress and HTTPS.");
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "(no body)");
    console.error("❌ Gemini API error:", res.status, errText);
    throw new Error(`Gemini API ${res.status}`);
  }

  const data = await res.json();
  const textOut = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return textOut || "No response.";
}

// ---------- Routes ----------
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "KMRC Gemini Backend", ts: Date.now() });
});

app.post("/summarize-multi", async (req, res) => {
  try {
    const { query, files } = req.body;
    if (!query || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "Missing query or files[]" });
    }

    const cleanFiles = files
      .filter(f => f?.text && typeof f.text === "string")
      .map(f => ({ name: f.name || "unknown", text: normalize(f.text) }));

    if (!cleanFiles.length) {
      return res.status(400).json({ error: "Files provided but no usable text extracted." });
    }

    const prompt = buildPrompt(query, cleanFiles, "You are KMRC Metro Document Intelligence Assistant.");
    const result = await callGemini(prompt);
    res.json({ result });
  } catch (e) {
    console.error("summarize-multi error:", e);
    res.status(500).json({ error: e.message || "Summarize failed" });
  }
});

app.post("/circuit-arch", async (req, res) => {
  try {
    const { query, files } = req.body;
    if (!query || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "Missing query or files[]" });
    }

    const focus = `${query}
Focus on circuits, architecture, I/O, connectors, cable tags, terminals, protections, and end‑to‑end signal flow.`;
    const cleanFiles = files
      .filter(f => f?.text && typeof f.text === "string")
      .map(f => ({ name: f.name || "unknown", text: normalize(f.text) }));

    const prompt = buildPrompt(focus, cleanFiles, "You are a metro architecture & wiring specialist. Explain step-by-step, cite evidence, and include Mermaid if useful.");
    const result = await callGemini(prompt);
    res.json({ result });
  } catch (e) {
    console.error("circuit-arch error:", e);
    res.status(500).json({ error: e.message || "Circuit/Arch failed" });
  }
});

// NEW: structured JSON search
app.post("/search-structured", async (req, res) => {
  try {
    const { query, files } = req.body;
    if (!query || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "Missing query or files[]" });
    }

    const keywords = normalize(query).toLowerCase().split(/\s+/).filter(Boolean);
    const cleanFiles = files
      .filter(f => f?.text && typeof f.text === "string")
      .map(f => ({ name: f.name || "unknown", text: normalize(f.text) }));

    // Keyword filter → keep only lines that include any keyword (pre-filter before RAG)
    const keywordFiltered = cleanFiles.map(f => {
      const lines = f.text.split(/[\r\n]+/);
      const hitLines = lines.filter(line => {
        const L = line.toLowerCase();
        return keywords.some(k => k.length >= 2 && L.includes(k));
      });
      return { name: f.name, text: hitLines.join("\n") || f.text.slice(0, 3000) };
    });

    const jsonSpec = `
Return ONLY valid JSON matching this schema:
{
  "keywordSummary": string,
  "files": [
    {
      "file": string,
      "matches": number,
      "details": [
        {
          "system": string | null,
          "subsystem": string | null,
          "component": string | null,
          "diagram": string | null,        // short description
          "wireTrace": string[] | null,    // ordered hop list
          "evidence": string[]             // references like "DMC CAB.pdf §chunk 3"
        }
      ]
    }
  ]
}`;

    const prompt = buildPrompt(
      `User wants structured results for: "${query}".
Identify systems/subsystems/components, summarize any wiring or diagram context, and produce trace steps if possible.
Output must be ONLY JSON (no markdown fence). Use evidence references like "filename §chunk N".`,
      keywordFiltered,
      "You are a technical data extractor. Produce strict JSON by the given schema."
    );

    const raw = await callGemini(`${jsonSpec}\n\n${prompt}`);

    // Try to parse; if model wrapped in anything, strip code fences etc.
    const cleaned = raw
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // fallback: return the raw for inspection
      return res.status(200).json({ raw, note: "Model did not return strict JSON. Inspect 'raw'." });
    }

    res.json(parsed);
  } catch (e) {
    console.error("search-structured error:", e);
    res.status(500).json({ error: e.message || "Search structured failed" });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
