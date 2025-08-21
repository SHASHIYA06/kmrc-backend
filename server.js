// server.js (Ollama version)
import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

app.post("/summarize", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.json({ error: "No text provided" });

  try {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3",   // or "mistral", "phi3", etc.
        prompt: "Summarize the following document:\n" + text
      })
    });

    const data = await response.json();
    res.json({ summary: data.response || "No summary generated" });

  } catch (err) {
    res.json({ error: err.toString() });
  }
});

app.listen(5000, () => console.log("LLM Proxy running on http://localhost:5000"));
