import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fetch from "node-fetch";
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

    // OCR for scan.pdf only
    if (file && file.mimetype === "application/pdf") {
      fileText = await processOCR(file.path);
      fs.unlinkSync(file.path); // delete temp file after OCR
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

// Circuit diagram generation stub (could call a drawing library/API)
app.post("/circuit-diagram", async (req, res) => {
  try {
    const { wire_number } = req.body;
    // Here you could add logic to lookup wire details and generate a diagram.
    res.json({ 
      wire: wire_number, 
      details: `Full details for wire ${wire_number} goes here.`,
      diagram_url: "https://your_app.com/static/diagrams/example.png"
    });
  } catch (e) {
    res.status(500).json({ error: "Diagram creation failed." });
  }
});

// Export summary endpoint (returns plain text for download)
app.post("/export-summary", async (req, res) => {
  try {
    const { summary } = req.body;
    res.header("Content-Type", "text/plain");
    res.send(summary || "No summary!");
  } catch (e) {
    res.status(500).send("Export error.");
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", backend: "KMRC Metro AI Doc App" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
