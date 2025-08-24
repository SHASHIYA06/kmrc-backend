import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import multer from "multer";
import fs from "fs";
import Tesseract from "tesseract.js";

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());
const upload = multer({ dest: "uploads/" });

function processOCR(filePath) {
  return Tesseract.recognize(filePath, "eng", { logger: m => console.log(m) })
    .then(({ data: { text } }) => text)
    .catch(() => "");
}

app.post("/summarize-file", upload.single("file"), async (req, res) => {
  try {
    let fileText = "";
    const file = req.file;

    if (file && file.mimetype === "application/pdf") {
      fileText = await processOCR(file.path);
      fs.unlinkSync(file.path);
    } else if (file) {
      fileText = fs.readFileSync(file.path, "utf8");
      fs.unlinkSync(file.path);
    } else {
      fileText = req.body.text || "";
    }
    const { query } = req.body;
    const prompt = `User question: ${query}\n\nFile Content:\n${fileText}`;

    const openai = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": process.env.FRONTEND_URL,
        "X-Title": "KMRC Summarizer Backend"
      },
    });

    const completion = await openai.chat.completions.create({
      model: "deepseek/deepseek-chat-v3-0324:free",
      messages: [
        { role: "system", content: "You are a helpful assistant for Metro projects. Respond with deep details, extract all circuit, wire, and architecture info." },
        { role: "user", content: prompt }
      ],
    });

    res.json({ summary: completion.choices[0].message.content });
  } catch (error) {
    console.error("Summarize-file error:", error);
    res.status(500).json({ error: "Failed to process file or request." });
  }
});

// New endpoint: summarize multiple files based on query + file contents
app.post("/summarize-multi", async (req, res) => {
  try {
    const { query, files } = req.body;
    if (!query || !files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "Missing or invalid query/files in request." });
    }

    // Combine file contents into one prompt
    let prompt = `User query: ${query}\n\nFiles content details (combine info for full context):\n`;
    files.forEach((file, i) => {
      prompt += `\n--- File ${i + 1} (${file.name}):\n${file.text}\n`;
    });

    const openai = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
    });

    const completion = await openai.chat.completions.create({
      model: "deepseek/deepseek-chat-v3-0324:free",
      messages: [
        { role: "system", content: "You are an expert Metro assistant AI. Answer the query with maximum relevant details based on the combined files provided." },
        { role: "user", content: prompt }
      ],
    });

    res.json({ result: completion.choices[0].message.content });
  } catch (e) {
    console.error("summarize-multi error:", e);
    res.status(500).json({ error: "Multi-file AI summary failed." });
  }
});

// New endpoint: architecture & circuit detail extraction with example diagram URL
app.post("/circuit-arch", async (req, res) => {
  try {
    const { query, files } = req.body;
    if (!query || !files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "Missing or invalid query/files in request." });
    }

    // Build prompt similarly combining relevant data
    let prompt = `User request: ${query}\n\nAnalyze files for architecture, circuits, wires info:\n`;
    files.forEach((file, i) => {
      prompt += `\n--- File ${i + 1} (${file.name}):\n${file.text}\n`;
    });

    const openai = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
    });

    const completion = await openai.chat.completions.create({
      model: "deepseek/deepseek-chat-v3-0324:free",
      messages: [
        { role: "system", content: "You are a Metro technical AI helping with architecture & circuit diagrams. Summarize all details and if possible provide a structured diagram URL." },
        { role: "user", content: prompt }
      ],
    });

    // For demonstration, sending a static diagram URL — replace with your generated diagram logic if any
    const diagram_url = "https://your-app.com/static/sample-architecture.png";

    res.json({ 
      result: completion.choices[0].message.content,
      diagram_url
    });
  } catch (e) {
    console.error("circuit-arch error:", e);
    res.status(500).json({ error: "Circuit architecture AI extraction failed." });
  }
});

// Health check route
app.get("/health", (req, res) => {
  res.json({ status: "ok", backend: "KMRC Metro AI Multi-file Backend" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
