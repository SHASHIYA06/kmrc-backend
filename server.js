import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", backend: "KMRC Summarizer" });
});

// Summarize endpoint
app.post("/summarize-text", async (req, res) => {
  const { query, text } = req.body;
  if (!text) return res.json({ error: "No text provided" });

  try {
    // -----------------------------
    // Option 1: Local Ollama (free)
    // -----------------------------
    if (process.env.USE_OLLAMA === "true") {
      const ollamaResponse = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama3",
          prompt: `Query: ${query}\n\nSummarize the following document:\n${text}`
        })
      });

      const raw = await ollamaResponse.text();
      let summary = "";
      raw.split("\n").forEach(line => {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.response) summary += parsed.response;
          } catch {}
        }
      });

      return res.json({ summary: summary || "No summary generated" });
    }

    // -----------------------------
    // Option 2: Remote API (Groq)
    // -----------------------------
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "mixtral-8x7b-32768",
        messages: [
          { role: "system", content: "You are a helpful assistant that summarizes KMRC project documents." },
          { role: "user", content: text }
        ]
      })
    });

    const data = await response.json();
    res.json({ summary: data.choices?.[0]?.message?.content || "No summary" });

  } catch (err) {
    console.error(err);
    res.json({ error: err.toString() });
  }
});

// Listen
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Backend running on http://localhost:${PORT}`));
