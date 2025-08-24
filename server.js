import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json({ limit: "25mb" })); // allow big payloads

// ---------- Gemini REST helper ----------
async function callGemini(prompt, systemInstruction = "You are a helpful assistant.") {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: `${systemInstruction}\n\n${prompt}` }]
      }
    ]
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
}

// ---------- RAG utilities (simple & fast) ----------
function normalize(s) {
  return (s || "")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkText(text, size = 1800, overlap = 200) {
  const clean = normalize(text);
  if (!clean) return [];
  let chunks = [];
  for (let i = 0; i < clean.length; i += size - overlap) {
    chunks.push(clean.slice(i, i + size));
  }
  return chunks;
}

function scoreChunk(query, chunk) {
  // Very small, effective keyword scorer
  const q = normalize(query).toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const c = chunk.toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (t.length < 2) continue;
    const matches = c.split(t).length - 1;
    score += matches * (t.length >= 5 ? 3 : 1);
  }
  // Favor denser chunks
  score += Math.min(chunk.length / 500, 5);
  return score;
}

function selectTopChunks(query, files, maxChars = 20000) {
  // files: [{name, text}]
  let all = [];
  for (const f of files) {
    const chunks = chunkText(f.text);
    chunks.forEach((ch, idx) => {
      all.push({
        file: f.name || "unknown",
        idx,
        text: ch,
        score: scoreChunk(query, ch)
      });
    });
  }
  all.sort((a, b) => b.score - a.score);

  let picked = [];
  let total = 0;
  for (const item of all) {
    if (total + item.text.length > maxChars) break;
    picked.push(item);
    total += item.text.length;
    if (picked.length >= 50) break; // guardrail
  }
  return picked;
}

function buildPrompt(query, files) {
  const top = selectTopChunks(query, files);
  const context = top
    .map(
      (t) =>
        `<<<FILE:${t.file} | CHUNK:${t.idx}>>>\n${t.text}\n<<<END>>>`
    )
    .join("\n");

  return `
[INSTRUCTIONS FOR MODEL]
- You have access to extracted document text from multiple files (including OCR from scanned PDFs).
- Answer the user’s query with precise, step-by-step reasoning.
- Cite the file name and chunk IDs when relevant (e.g., "DMC CAB.pdf §chunk 3").
- If the query implies architectures, circuits, wiring or system flows, include a Mermaid diagram in a fenced code block like:
\`\`\`mermaid
flowchart TD
  A[Source] --> B[Processor]
  B --> C[Output]
\`\`\`
- If the user asks to trace wires or end-to-end flow, produce an ordered checklist and cross-reference where evidence appears.
- If information is missing, say so, and suggest where to find it in the document tree.

[USER QUERY]
${query}

[DOCUMENT CONTEXT - TOP MATCHED CHUNKS]
${context}
`.trim();
}

// ---------- Endpoints ----------
app.post("/summarize-multi", async (req, res) => {
  try {
    const { query, files } = req.body;
    if (!query || !files?.length) {
      return res.status(400).json({ error: "Missing query or files" });
    }

    // files are expected like: [{name, text}]
    const cleanFiles = files
      .filter(f => f?.text)
      .map(f => ({ name: f.name || "unknown", text: normalize(f.text) }));

    if (!cleanFiles.length) {
      return res.status(400).json({ error: "No usable text extracted from files." });
    }

    const prompt = buildPrompt(query, cleanFiles);
    const result = await callGemini(prompt, "You are KMRC Metro Document Intelligence Assistant.");
    res.json({ result });
  } catch (err) {
    console.error("summarize-multi error:", err);
    res.status(500).json({ error: err.message || "AI summarize failed." });
  }
});

app.post("/circuit-arch", async (req, res) => {
  try {
    const { query, files } = req.body;
    if (!query || !files?.length) {
      return res.status(400).json({ error: "Missing query or files" });
    }

    const cleanFiles = files
      .filter(f => f?.text)
      .map(f => ({ name: f.name || "unknown", text: normalize(f.text) }));

    const archQuery =
      `${query}\n\nFocus on: architecture, circuits, wiring, signals, terminals, connectors, cable tags, panel I/O, and tracing from source to destination.`;

    const prompt = buildPrompt(archQuery, cleanFiles);
    const result = await callGemini(
      prompt,
      "You are a Metro architecture & circuits specialist. Explain step-by-step and include Mermaid when helpful."
    );

    // optional static diagram hook (keep for compatibility)
    const diagram_url = null;
    res.json({ result, diagram_url });
  } catch (err) {
    console.error("circuit-arch error:", err);
    res.status(500).json({ error: err.message || "Failed Gemini circuit-arch" });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", backend: "KMRC Gemini API Backend" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
