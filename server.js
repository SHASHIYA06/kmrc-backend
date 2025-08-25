import express from "express";
import multer from "multer";
import fs from "fs";
import pdf from "pdf-parse";
import Tesseract from "tesseract.js";
import fetch from "node-fetch";
import mammoth from "mammoth";
import cors from "cors";
import dotenv from "dotenv";
import xlsx from "xlsx";   // ✅ Excel support

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json());

/**
 * Extract text OR structured table from files
 */
async function extractText(filePath, mimetype) {
  try {
    if (mimetype === "application/pdf") {
      const data = await pdf(fs.readFileSync(filePath));
      if (data.text.trim()) return data.text;
      return (await Tesseract.recognize(filePath, "eng")).data.text;
    }

    if (mimetype.startsWith("image/")) {
      return (await Tesseract.recognize(filePath, "eng")).data.text;
    }

    if (mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    }

    // 📊 Excel
    if (
      mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimetype === "application/vnd.ms-excel"
    ) {
      const workbook = xlsx.readFile(filePath);
      let structuredTables = [];
      workbook.SheetNames.forEach(sheetName => {
        const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
        structuredTables.push({
          sheet: sheetName,
          rows: sheet
        });
      });
      return JSON.stringify(structuredTables, null, 2);
    }

    // 📑 CSV
    if (mimetype === "text/csv") {
      return fs.readFileSync(filePath, "utf8");
    }

    return "";
  } catch (err) {
    console.error("❌ extractText error:", err);
    return "";
  }
}

/**
 * Call Gemini API
 */
async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const body = { contents: [{ parts: [{ text: prompt }]}] };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Gemini API Error: ${res.status} ${text}`);

  const data = JSON.parse(text);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "⚠️ No response from Gemini.";
}

/**
 * Split large text into chunks for Gemini
 */
function chunkText(text, chunkSize = 4000) {
  let chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.substring(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Deep AI Search + Summarization with Excel/CSV matrix support
 */
app.post("/summarize-multi", async (req, res) => {
  try {
    const { query, files } = req.body;
    if (!query || !files?.length) {
      return res.status(400).json({ error: "Missing query or files" });
    }

    let allSummaries = [];

    for (const f of files) {
      if (!f.text) continue;

      const isExcel = f.name.endsWith(".xlsx") || f.name.endsWith(".xls") || f.name.endsWith(".csv");

      let fileSummary;
      if (isExcel) {
        // 📊 Special handling for Excel/CSV
        fileSummary = await callGemini(
          `User query: "${query}". The following is structured tabular data from file: ${f.name}.
Format the answer as an interactive HTML table if possible.

Data:\n${f.text}`
        );
      } else {
        // Normal file → chunk text
        const chunks = chunkText(f.text, 4000);
        let summaries = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunkPrompt = `User query: "${query}"\n\nFile: ${f.name}\nSystem: ${f.system || "N/A"}\nSubsystem: ${f.subsystem || "N/A"}\n\nContent chunk ${i+1}/${chunks.length}:\n${chunks[i]}\n\nAnswer based ONLY on this chunk.`;
          summaries.push(await callGemini(chunkPrompt));
        }

        fileSummary = await callGemini(
          `User query: "${query}". Merge these partial summaries into one structured answer:\n${summaries.join("\n\n")}`
        );
      }

      allSummaries.push(`📄 File: ${f.name}\n${fileSummary}`);
    }

    // Final merged answer
    const finalAnswer = await callGemini(
      `User query: "${query}". Combine and refine the following file-level summaries into one comprehensive structured report:\n\n${allSummaries.join("\n\n")}`
    );

    res.json({ result: finalAnswer, details: allSummaries });
  } catch (err) {
    console.error("❌ summarize-multi error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Keyword Search with Excel/CSV matrix support
 */
app.post("/search-multi", upload.array("files"), async (req, res) => {
  try {
    let keyword, files;

    if (req.is("application/json")) {
      keyword = req.body.keyword;
      files = req.body.files;
      if (!keyword || !files?.length) {
        return res.status(400).json({ error: "Missing keyword or files" });
      }

      let matches = [];
      for (const f of files) {
        if (f.name.endsWith(".xlsx") || f.name.endsWith(".xls") || f.name.endsWith(".csv")) {
          // Search inside Excel/CSV JSON text
          if (f.text.toLowerCase().includes(keyword.toLowerCase())) {
            matches.push({ file: f.name, excerpt: f.text.substring(0, 1000) + "..." });
          }
        } else {
          const chunks = chunkText(f.text || "", 4000);
          chunks.forEach((chunk, i) => {
            if (chunk.toLowerCase().includes(keyword.toLowerCase())) {
              matches.push({
                file: f.name,
                system: f.system || "",
                subsystem: f.subsystem || "",
                excerpt: chunk.substring(0, 500) + "..."
              });
            }
          });
        }
      }

      const table = matches.map(m =>
        `${m.file} | ${m.system || ""} | ${m.subsystem || ""} | ${m.excerpt}`
      ).join("\n");

      const result = await callGemini(
        `The user searched for keyword: "${keyword}". Present matches in structured tabular format.\n\n${table}`
      );

      return res.json({ result, matches });
    }

    // File upload mode
    keyword = req.body.keyword;
    if (!keyword || !req.files?.length) {
      return res.status(400).json({ error: "Missing keyword or uploaded files" });
    }

    let matches = [];
    for (const file of req.files) {
      const text = await extractText(file.path, file.mimetype);
      fs.unlinkSync(file.path);

      if (text.toLowerCase().includes(keyword.toLowerCase())) {
        matches.push({ file: file.originalname, excerpt: text.substring(0, 1000) + "..." });
      }
    }

    const response = matches.map(m =>
      `File: ${m.file}\nExcerpt: ${m.excerpt}`
    ).join("\n\n");

    const result = await callGemini(
      `User searched for keyword: "${keyword}". Present matches in structured matrix/table format.\n\n${response}`
    );

    res.json({ result, matches });
  } catch (err) {
    console.error("❌ search-multi error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
