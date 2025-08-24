import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

// Multi-file summarize (adapted for Gemini API)
app.post("/summarize-multi", async (req, res) => {
  try {
    const { query, files } = req.body;
    if (!query || !files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "Missing query or files" });
    }

    let prompt = `User query: ${query}\n\nFiles:\n`;
    files.forEach((file, i) => {
      prompt += `---\nFile ${i + 1} (${file.name}):\n${file.text}\n`;
    });

    const completion = await openai.chat.completions.create({
      model: "gemini-2.0-flash",
      messages: [
        { role: "system", content: "You are an expert Metro AI assistant. Use provided files to answer the query in detail."},
        { role: "user", content: prompt }
      ],
    });

    res.json({ result: completion.choices[0].message.content });
  } catch(error) {
    console.error("summarize-multi error:", error);
    res.status(500).json({ error: "Failed Gemini summarize-multi" });
  }
});

// Architecture & circuit search endpoint
app.post("/circuit-arch", async (req, res) => {
  try {
    const { query, files } = req.body;
    if (!query || !files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "Missing query or files" });
    }

    let prompt = `User request: ${query}\nAnalyze the following files for architecture, circuits, and wire details:\n`;
    files.forEach((file, i) => {
      prompt += `---\nFile ${i + 1} (${file.name}):\n${file.text}\n`;
    });

    const completion = await openai.chat.completions.create({
      model: "gemini-2.0-flash",
      messages: [
        { role: "system", content: "You are a Metro architecture AI assistant. Provide detailed architecture and circuit info." },
        { role: "user", content: prompt }
      ],
    });

    // Example static diagram URL (replace with your diagram logic)
    const diagram_url = "https://yourapp.com/static/sample-architecture.png";

    res.json({ result: completion.choices[0].message.content, diagram_url });
  } catch(error) {
    console.error("circuit-arch error:", error);
    res.status(500).json({ error: "Failed Gemini circuit-arch" });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", backend: "KMRC Gemini API Backend" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
