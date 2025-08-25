// server.js (Upgraded)
// Node + ESM (import) style. Ensure "type": "module" in package.json or adapt to require().

import express from "express";
import multer from "multer";
import fs from "fs";
import pdf from "pdf-parse";
import Tesseract from "tesseract.js";
import fetch from "node-fetch";
import mammoth from "mammoth";
import xlsx from "xlsx";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });

// Increase JSON size limits (adjust if you need bigger)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

/* -----------------------
   Utilities & Helpers
   ----------------------- */

function safeTrim(s, n = 20000) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "\n\n[...truncated...]" : s;
}

/**
 * chunkText: split long text into manageable chunks (characters)
 */
function chunkText(text, chunkSize = 4000) {
  if (!text) return [];
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * inferTableFromExcelText
 * Accepts a 2D array (sheet) or CSV lines → returns Markdown table + JSON rows (header inferred)
 */
function sheetToMarkdownAndJson(sheet2d) {
  if (!Array.isArray(sheet2d) || sheet2d.length === 0) {
    return { markdown: "", rows: [] };
  }
  const header = sheet2d[0].map((h, i) => (h === undefined || h === null || String(h).trim() === "" ? `col_${i+1}` : String(h)));
  const rows = sheet2d.slice(1).map((row) => {
    const obj = {};
    for (let i = 0; i < header.length; i++) {
      obj[header[i]] = row[i] !== undefined && row[i] !== null ? String(row[i]) : "";
    }
    return obj;
  });

  // Markdown header
  const mdHeader = `| ${header.join(" | ")} |`;
  const mdSep = `| ${header.map(() => "---").join(" | ")} |`;
  const mdRows = rows.map(r => `| ${header.map(h => (r[h] || "") .replace(/\|/g, " ")).join(" | ")} |`);
  const markdown = [mdHeader, mdSep, ...mdRows].join("\n");
  return { markdown, rows };
}

/* -----------------------
   Extract text from file
   Supports PDF, image, DOCX, XLSX/XLS/CSV, plain text
   ----------------------- */
async function extractText(filePath, mimetype, originalName = "") {
  try {
    // PDF
    if (mimetype === "application/pdf") {
      const data = await pdf(fs.readFileSync(filePath));
      const plainText = (data && data.text) ? data.text.trim() : "";
      if (plainText && plainText.replace(/\s+/g, "").length > 30) {
        return { text: plainText, isOCR: false, structured: null };
      }
      // fallback OCR: render pages via tesseract using buffer path
      const ocr = await Tesseract.recognize(filePath, "eng");
      return { text: ocr.data.text || "", isOCR: true, structured: null };
    }

    // Images
    if (/^image\//.test(mimetype)) {
      const ocr = await Tesseract.recognize(filePath, "eng");
      return { text: ocr.data.text || "", isOCR: true, structured: null };
    }

    // DOCX (Word)
    if (mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const result = await mammoth.extractRawText({ path: filePath });
      return { text: result.value || "", isOCR: false, structured: null };
    }

    // Excel: xlsx / xls
    if (
      mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimetype === "application/vnd.ms-excel" ||
      path.extname(originalName).toLowerCase().match(/\.xls|\.xlsx|\.csv/)
    ) {
      // read workbook
      try {
        const workbook = xlsx.readFile(filePath, { cellDates: true });
        let combinedMarkdown = "";
        let combinedJson = {};
        workbook.SheetNames.forEach((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          const arr = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false });
          if (arr && arr.length) {
            const { markdown, rows } = sheetToMarkdownAndJson(arr);
            combinedMarkdown += `\n\nSheet: ${sheetName}\n${markdown}\n`;
            combinedJson[sheetName] = rows;
          }
        });
        return { text: combinedMarkdown.trim(), isOCR: false, structured: combinedJson };
      } catch (e) {
        // fallback to raw CSV read
        try {
          const raw = fs.readFileSync(filePath, "utf8");
          return { text: raw, isOCR: false, structured: null };
        } catch (ee) {
          return { text: "", isOCR: false, structured: null };
        }
      }
    }

    // CSV text/plain
    if (mimetype === "text/csv" || mimetype === "text/plain") {
      const raw = fs.readFileSync(filePath, "utf8");
      return { text: raw, isOCR: false, structured: null };
    }

    // Unknown binary → return empty
    return { text: "", isOCR: false, structured: null };
  } catch (err) {
    console.error("extractText error:", err);
    return { text: "", isOCR: false, structured: null };
  }
}

/* -----------------------
   Gemini call wrapper (system prompt enforced)
   ----------------------- */

async function callGemini(rawPrompt) {
  // Wrap with a clear system instruction to prevent "I cannot access local files"
  const systemWrapper = `
⚠️ SYSTEM INSTRUCTIONS FOR DOCUMENT ANALYSIS BOT:
- You are a highly capable document analyst.
- The user has provided extracted file content (text or tables) inline in this prompt.
- DO NOT say "I cannot access local files" or similar. The content is already provided.
- If the provided content is tabular (spreadsheet/CSV), infer the headers from the first row and present results in an HTML table or markdown table as requested by the user.
- Provide structured, concise and step-by-step answers. When asked for "matrix" or "table", output an HTML <table> or Markdown table.
- If asked to list items, provide numbered lists. Be factual and cite the filename when referencing data.
- Keep answers focused on the provided data only.

USER PROMPT BELOW:
${rawPrompt}
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const body = { contents: [{ parts: [{ text: systemWrapper }] }] };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // note: you may set timeout logic outside
  });

  const txt = await res.text();
  if (!res.ok) {
    // include response body in error for debugging
    throw new Error(`Gemini API Error: ${res.status} ${txt}`);
  }

  try {
    const data = JSON.parse(txt);
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (err) {
    // If parsing fails, return raw text
    return txt;
  }
}

/* -----------------------
   Endpoints
   ----------------------- */

/**
 * POST /summarize-multi
 * Two modes:
 * - JSON mode: { query, files: [{ name, text, system?, subsystem? , structured? }] }
 * - Upload mode: multipart form-data with files (multer)
 *
 * Returns: { result: "...", details: [...] }
 */
app.post("/summarize-multi", upload.array("files"), async (req, res) => {
  try {
    // Accept both JSON and upload (multer) modes:
    let query, incomingFiles;

    if (req.is("application/json") && req.body.files) {
      // JSON mode (frontend extracted on client)
      query = req.body.query;
      incomingFiles = req.body.files; // expected: [{ name, text, system?, subsystem?, structured? }]
    } else if (req.files && req.files.length) {
      // Upload mode - extract server-side
      query = req.body.query;
      incomingFiles = [];
      for (const f of req.files) {
        const ext = path.extname(f.originalname).toLowerCase();
        const extracted = await extractText(f.path, f.mimetype, f.originalname);
        // cleanup file
        try { fs.unlinkSync(f.path); } catch (e) {}
        incomingFiles.push({
          name: f.originalname,
          text: extracted.text || "",
          structured: extracted.structured || null,
          system: req.body.system || "",
          subsystem: req.body.subsystem || "",
          meta: f.mimetype
        });
      }
    } else {
      return res.status(400).json({ error: "Missing query or files" });
    }

    if (!query || !incomingFiles?.length) {
      return res.status(400).json({ error: "Missing query or files" });
    }

    // Build file-level summaries
    const allSummaries = [];

    for (const f of incomingFiles) {
      if (!f.text || f.text.trim().length === 0) {
        allSummaries.push(`📄 File: ${f.name}\n(No textual content extracted)`);
        continue;
      }

      const isExcel =
        f.name.toLowerCase().endsWith(".xlsx") ||
        f.name.toLowerCase().endsWith(".xls") ||
        f.name.toLowerCase().endsWith(".csv") ||
        (f.structured && Object.keys(f.structured).length > 0);

      if (isExcel) {
        // Send the full table content (or a trimmed version if huge) and ask for table output
        const prepared = safeTrim(f.text, 200000); // allow big table but cap server size
        const prompt = `
You are given spreadsheet content extracted from file "${f.name}".
IMPORTANT: The spreadsheet content is provided below between the markers.
Do NOT say you cannot access local files — the data is present below.
When answering, always present tabular results (HTML table or Markdown table) where applicable.
User Query: "${query}"

--- BEGIN SPREADSHEET DATA ---
${prepared}
--- END SPREADSHEET DATA ---

Provide a concise, structured answer focused only on this spreadsheet. If the user asked to "show job cards" or "list top 10", return a table with appropriate columns and the requested number of rows.
`;
        const fileSummary = await callGemini(prompt);
        allSummaries.push(`📄 File: ${f.name}\n${fileSummary}`);
      } else {
        // For large text: chunk & summarize each chunk, then merge
        const chunks = chunkText(f.text || "", 3500);
        const chunkSummaries = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunkPrompt = `
User query: "${query}"
File: ${f.name}
System: ${f.system || "N/A"}
Subsystem: ${f.subsystem || "N/A"}
Chunk ${i + 1}/${chunks.length} content below. Answer ONLY from this chunk,
produce concise, factual output and mark content source.

--- CHUNK CONTENT ---
${safeTrim(chunks[i], 5000)}
--- END CHUNK CONTENT ---
`;
          const chunkResult = await callGemini(chunkPrompt);
          chunkSummaries.push(chunkResult);
        }
        // merge chunk summaries
        const mergedPrompt = `
You are given partial summaries (from chunks) for file "${f.name}".
Combine them into one coherent, structured summary that answers: "${query}"
Partial summaries:
${chunkSummaries.join("\n\n---\n\n")}
`;
        const merged = await callGemini(mergedPrompt);
        allSummaries.push(`📄 File: ${f.name}\n${merged}`);
      }
    }

    // Final merge across files
    const finalPrompt = `
User Query: "${query}"
Combine the following file-level summaries (do not invent facts; only use the summaries).
When possible, provide an overall structured report, and if requested provide tables or step-by-step instructions.
File summaries:
${allSummaries.join("\n\n===\n\n")}
`;
    const finalAnswer = await callGemini(finalPrompt);

    res.json({ result: finalAnswer, details: allSummaries });
  } catch (err) {
    console.error("summarize-multi error:", err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

/**
 * POST /search-multi
 * Keyword-centric micro-search across provided files (JSON mode) or uploaded files
 */
app.post("/search-multi", upload.array("files"), async (req, res) => {
  try {
    let keyword, incomingFiles;

    if (req.is("application/json") && req.body.files) {
      keyword = req.body.keyword;
      incomingFiles = req.body.files;
    } else if (req.files && req.files.length) {
      keyword = req.body.keyword;
      incomingFiles = [];
      for (const f of req.files) {
        const extracted = await extractText(f.path, f.mimetype, f.originalname);
        try { fs.unlinkSync(f.path); } catch (e) {}
        incomingFiles.push({
          name: f.originalname,
          text: extracted.text || "",
          structured: extracted.structured || null,
          meta: f.mimetype
        });
      }
    } else {
      return res.status(400).json({ error: "Missing keyword or files" });
    }

    if (!keyword || !incomingFiles?.length) {
      return res.status(400).json({ error: "Missing keyword or files" });
    }

    const matches = [];

    for (const f of incomingFiles) {
      const text = String(f.text || "");
      const isExcel =
        f.name.toLowerCase().endsWith(".xlsx") ||
        f.name.toLowerCase().endsWith(".xls") ||
        f.name.toLowerCase().endsWith(".csv") ||
        (f.structured && Object.keys(f.structured).length > 0);

      if (isExcel) {
        // search inside the text (which is markdown-like table)
        if (text.toLowerCase().includes(keyword.toLowerCase())) {
          matches.push({ file: f.name, excerpt: safeTrim(text, 2000), isExcel: true });
        }
      } else {
        // chunk-level search for textual content
        const chunks = chunkText(text || "", 3000);
        for (let i = 0; i < chunks.length; i++) {
          if (chunks[i].toLowerCase().includes(keyword.toLowerCase())) {
            matches.push({
              file: f.name,
              excerpt: safeTrim(chunks[i], 1200),
              chunkIndex: i + 1
            });
            // optionally break to avoid too many matches per file
            break;
          }
        }
      }
    }

    // Build a table like summary for Gemini to return nicely formatted output
    const tableLines = matches.map(m => `${m.file} | ${m.excerpt.replace(/\n/g, " ")}`).join("\n");

    const prompt = `
User searched for keyword: "${keyword}"
Do NOT say you cannot access local files. The matched text snippets are provided below.
Present results as an HTML table (columns: FileName, Excerpt) and then provide a short structured summary of findings.

--- Begin Matches ---
${tableLines || "[No matches found]"}
--- End Matches ---
`;

    const result = await callGemini(prompt);

    res.json({ result, matches });
  } catch (err) {
    console.error("search-multi error:", err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

/* Health */
app.get("/health", (req, res) => {
  res.json({ ok: true, status: "AI Document Backend", env: process.env.NODE_ENV || "dev" });
});

/* Start */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
