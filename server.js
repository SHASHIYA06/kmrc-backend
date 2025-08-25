import express from "express";
import multer from "multer";
import fs from "fs";
import pdf from "pdf-parse";
import Tesseract from "tesseract.js";
import fetch from "node-fetch";
import mammoth from "mammoth";
import cors from "cors";
import dotenv from "dotenv";

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
 * Extract text from PDF/Images/DOCX
 */
async function extractText(filePath, mimetype) {
  try {
    if (mimetype === "application/pdf") {
      const data = await pdf(fs.readFileSync(filePath));
      if (data.text.trim()) return data.text;

      // fallback OCR if scanned
      return (await Tesseract.recognize(filePath, "eng")).data.text;
    }

    if (mimetype.startsWith("image/")) {
      return (await Tesseract.recognize(filePath, "eng")).data.text;
    }

    if (mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
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

  const body = {
    contents: [
      {
        parts: [{ text: prompt }]
      }
    ]
  };

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
 * Endpoint: summarize across multiple files (Drive JSON mode)
 */
app.post("/summarize-multi", async (req, res) => {
  try {
    const { query, files } = req.body;
    if (!query || !files?.length) {
      return res.status(400).json({ error: "Missing query or files" });
    }

    // Build prompt with structured context
    let prompt = `📄 User query: ${query}\n\nHere are the provided files with extracted contents:\n\n`;
    files.forEach((f, i) => {
      prompt += `#${i + 1} File: ${f.name}\nSystem: ${f.system || "N/A"} | Subsystem: ${f.subsystem || "N/A"} | Meta: ${f.meta || ""}\n---\n${f.text?.substring(0, 800)}...\n\n`;
    });

    const result = await callGemini(prompt);
    res.json({ result });
  } catch (err) {
    console.error("❌ summarize-multi error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint: keyword search (supports both JSON + file upload modes)
 */
app.post("/search-multi", upload.array("files"), async (req, res) => {
  try {
    let keyword, files;

    // Case 1: JSON mode (from Drive metadata + OCR text)
    if (req.is("application/json")) {
      keyword = req.body.keyword;
      files = req.body.files;
      if (!keyword || !files?.length) {
        return res.status(400).json({ error: "Missing keyword or files" });
      }

      let matches = [];
      for (const f of files) {
        if (f.text?.toLowerCase().includes(keyword.toLowerCase())) {
          matches.push({
            file: f.name,
            system: f.system || "",
            subsystem: f.subsystem || "",
            excerpt: f.text.substring(0, 500) + "..."
          });
        }
      }

      // Build structured table for AI
      const table = matches.map(m =>
        `${m.file} | ${m.system} | ${m.subsystem} | ${m.excerpt}`
      ).join("\n");

      const result = await callGemini(
        `The user searched for keyword: "${keyword}". Here are the matches (in tabular form):\n${table}\n\nAnswer the query strictly based on this data.`
      );

      return res.json({ result, matches });
    }

    // Case 2: File upload mode
    keyword = req.body.keyword;
    if (!keyword || !req.files?.length) {
      return res.status(400).json({ error: "Missing keyword or uploaded files" });
    }

    let matches = [];
    for (const file of req.files) {
      const text = await extractText(file.path, file.mimetype);
      fs.unlinkSync(file.path);

      if (text.toLowerCase().includes(keyword.toLowerCase())) {
        matches.push({
          file: file.originalname,
          excerpt: text.substring(0, 500) + "..."
        });
      }
    }

    let response = "Matches:\n";
    matches.forEach(m => {
      response += `\nFile: ${m.file}\nExcerpt: ${m.excerpt}\n`;
    });

    const result = await callGemini(
      `The user searched for keyword: "${keyword}". Here are raw matches:\n${response}\n\nSummarize and explain findings clearly.`
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
