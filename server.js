// server.js (Render deployment version - OpenAI API)
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

// POST /summarize
app.post("/summarize", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.json({ error: "No text provided" });

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",   // fast & cheap model, change to gpt-4o if needed
        messages: [
          { role: "system", content: "You are a helpful assistant that summarizes documents." },
          { role: "user", content: `Summarize this document:\n\n${text}` }
        ],
        temperature: 0.3
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.json({ error: data.error.message });
    }

    const summary = data.choices?.[0]?.message?.content || "No summary generated";
    res.json({ summary });

  } catch (err) {
    res.json({ error: err.toString() });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
