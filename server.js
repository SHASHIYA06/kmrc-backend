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

// ✅ Enable CORS for your frontend
app.use(cors({
  origin: process.env.FRONTEND_URL,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
}));

app.use(express.json());


// ---- Gemini API Call ----
async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  console.log("🔎 Sending prompt to Gemini, length:", prompt.length);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("❌ Gemini API Error:", errorText);
    throw new Error(`Gemini API Error: ${res.status}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
}

// ---- File Text Extraction ----
async function extractTextFromFile(filePath, mimetype) {
  console.log(`📂 Extracting from ${filePath} (${mimetype})`);

  if (mimetype === "application/pdf") {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdf(dataBuffer);

    if (!pdfData.text.trim()) {
      console.log("🟡 Empty PDF text, using OCR...");
      const { data: { text } } = await Tesseract.recognize(filePath, "eng");
      return text;
    }
    return pdfData.text;
  }

  if (mimetype.includes("image")) {
    const { data: { text } } = await Tesseract.recognize(filePath, "eng");
    return text;
  }

  if (mimetype.includes("word") || mimetype.includes("officedocument")) {
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (mimetype.includes("text")) {
    return fs.readFileSync(filePath, "utf-8");
  }

  throw new Error(`Unsupported file type: ${mimetype}`);
}

// ---- Multi-file Summarization ----
app.post("/summarize-multi", async (req, res) => {
  try {
    const { query, files } = req.body;
    if (!query || !files?.length) {
      return res.status(400).json({ error: "Missing query or files" });
    }

    let prompt = `User query: ${query}\n\nFiles:\n`;
    files.forEach((file, i) => {
      prompt += `---\nFile ${i + 1} (${file.name}):\n${file.text}\n`;
    });

    const result = await callGemini(prompt);
    res.json({ result });
  } catch (error) {
    console.error("summarize-multi error:", error);
    res.status(500).json({ error: error.message });
  }
});


// ---- Multi-file Search with JSON Output ----
app.post("/search-multi", upload.array("files"), async (req, res) => {
  try {
    const { keyword } = req.body;
    const files = req.files;

    if (!keyword || !files?.length) {
      return res.status(400).json({ error: "Missing keyword or files" });
    }

    let extractedSections = [];

    for (const file of files) {
      try {
        const text = await extractTextFromFile(file.path, file.mimetype);

        // find only lines containing the keyword
        const relevant = text
          .split("\n")
          .filter(line => line.toLowerCase().includes(keyword.toLowerCase()))
          .join("\n");

        if (relevant.trim()) {
          extractedSections.push({
            file: file.originalname,
            matches: relevant
          });
        }
      } catch (err) {
        extractedSections.push({
          file: file.originalname,
          error: err.message
        });
      }
    }

    const structuredPrompt = `
You are a technical assistant. The user is searching for '${keyword}' across multiple engineering documents.

Here are extracted relevant sections:
${JSON.stringify(extractedSections, null, 2)}

Please return structured JSON with the following format:
{
  "keyword": "${keyword}",
  "files": [
    {
      "file": "filename",
      "details": [
        {
          "system": "system name (if found)",
          "subsystem": "subsystem details (if found)",
          "diagram": "diagram description or explanation (if found)",
          "trace": "step by step tracing information if applicable"
        }
      ]
    }
  ]
}
`;

    const result = await callGemini(structuredPrompt);

    res.json({ result, extractedSections });

    files.forEach(f => fs.unlinkSync(f.path));
  } catch (error) {
    console.error("search-multi error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ---- Start ----
app.listen(3000, () =>
  console.log("🚀 Server running at http://localhost:3000")
);
