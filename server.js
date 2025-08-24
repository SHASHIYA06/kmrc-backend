import express from "express";
import multer from "multer";
import fs from "fs";
import pdf from "pdf-parse";
import Tesseract from "tesseract.js";
import fetch from "node-fetch";
import mammoth from "mammoth";

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(express.json());

// ---- Gemini API Call ----
async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const body = { contents: [{ parts: [{ text: prompt }] }] };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Gemini API Error: ${res.status} ${errorText}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
}

// ---- File Text Extraction ----
async function extractTextFromFile(filePath, mimetype) {
  if (mimetype === "application/pdf") {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdf(dataBuffer);

    // if text empty → fallback to OCR
    if (!pdfData.text.trim()) {
      console.log("PDF seems scanned, using OCR...");
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

// ---- API Route ----
app.post("/summarize-multi", upload.array("files"), async (req, res) => {
  try {
    const { query } = req.body;
    const files = req.files;

    if (!query || !files?.length) {
      return res.status(400).json({ error: "Missing query or files" });
    }

    let prompt = `User query: ${query}\n\nExtracted file data:\n`;

    for (const file of files) {
      try {
        const text = await extractTextFromFile(file.path, file.mimetype);
        prompt += `---\nFile: ${file.originalname}\n${text}\n`;
      } catch (err) {
        prompt += `---\nFile: ${file.originalname}\n[Error extracting: ${err.message}]\n`;
      }
    }

    const result = await callGemini(prompt);
    res.json({ result });

    // cleanup
    files.forEach(f => fs.unlinkSync(f.path));
  } catch (error) {
    console.error("summarize-multi error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ---- Start ----
app.listen(3000, () => console.log("🚀 Server running on http://localhost:3000"));
