import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

// Gemini API helper
import fetch from "node-fetch";

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

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Gemini API Error: ${res.status} ${errorText}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
}


  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response from Gemini.";
}

// Multi-file summarize
app.post("/summarize-multi", async (req, res) => {
  try {
    const { query, files } = req.body;
    if (!query || !files?.length) {
      return res.status(400).json({ error: "Missing query or files" });
    }

    let prompt = `User query: ${query}\n\nFiles:\n`;
    files.forEach((file, i) => {
      const safeText = (file.text || "").replace(/[\u0000-\u001F\u007F-\u009F]/g, " ");
      prompt += `---\nFile ${i + 1} (${file.name}):\n${safeText}\n`;
    });

    const result = await callGemini(prompt, "You are a Metro AI assistant.");
    res.json({ result });
  } catch (error) {
    console.error("Error in summarize-multi:", error);
    res.status(500).json({ error: "AI summarize failed." });
  }
});

// Architecture & circuit search
app.post("/circuit-arch", async (req, res) => {
  try {
    const { query, files } = req.body;
    if (!query || !files?.length) {
      return res.status(400).json({ error: "Missing query or files" });
    }

    let prompt = `User request: ${query}\nAnalyze the following files for architecture, circuits, and wire details:\n`;
    files.forEach((file, i) => {
      prompt += `---\nFile ${i + 1} (${file.name}):\n${file.text}\n`;
    });

    const result = await callGemini(prompt, "You are a Metro architecture AI assistant. Provide detailed architecture and circuit info.");
    const diagram_url = "https://yourapp.com/static/sample-architecture.png"; // Replace with real diagram logic

    res.json({ result, diagram_url });
  } catch (error) {
    console.error("circuit-arch error:", error);
    res.status(500).json({ error: "Failed Gemini circuit-arch" });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", backend: "KMRC Gemini API Backend" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
