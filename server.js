import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || "*"  // Allow only your frontend domain, or * for dev
}));
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", backend: "KMRC Summarizer with DeepSeek" });
});

// Summarize endpoint using OpenRouter DeepSeek model
app.post("/summarize-text", async (req, res) => {
  const { query, text } = req.body;
  if (!text) return res.status(400).json({ error: "No text provided" });

  try {
    // Using OpenRouter API with OpenAI SDK compatible client
    const openai = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": process.env.FRONTEND_URL,
        "X-Title": "KMRC Summarizer Backend",
      },
    });

    // Construct the prompt/messages
    const messages = [
      { role: "system", content: "You are a helpful assistant that summarizes KMRC project documents." },
      { role: "user", content: `Query: ${query}\n\n${text}` }
    ];

    // Call the chat completion endpoint
    const completion = await openai.chat.completions.create({
      model: "deepseek/deepseek-chat-v3-0324:free",
      messages,
    });

    res.json({ summary: completion.choices?.[0]?.message?.content || "No summary generated" });

  } catch (err) {
    console.error("Error during summarization:", err);
    res.status(500).json({ error: "Failed to fetch summary" });
  }
});

// Listen on the specified PORT
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
