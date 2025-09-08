// server.js - Final Working Version
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// ✅ Fix: CORS for Netlify
app.use(cors({
  origin: ['https://bemlkmrcldocuemt.netlify.app', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '15mb' }));

// ✅ Health check
app.get('/', (req, res) => {
  res.send(`
    <h1>✅ kmrc-backend is LIVE</h1>
    <p>Server running on port ${PORT}</p>
    <p><a href="/api/health">Go to /api/health</a></p>
  `);
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    backend: 'kmrc-backend',
    time: new Date().toISOString(),
    port: PORT,
    message: 'Your backend is working!'
  });
});

// ✅ Safe JSON parser
function safeJsonParse(str) {
  try {
    const cleaned = str.replace(/^```json\s*|\s*```$/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn('JSON parse failed:', e.message);
    return {
      technicalSummary: `Parsing error: ${str.substring(0, 300)}...`,
      laymanSummary: "Could not parse response.",
      wireDetails: [],
      components: [],
      architectureSuggestion: ""
    };
  }
}

// ✅ Gemini API call
async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Gemini API error');

  return data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
}

// ✅ ✅ CORRECT AI ENDPOINT
app.post('/api/gemini/analyze', async (req, res) => {
  const { fileContents, query } = req.body;

  if (!fileContents || !query) {
    return res.status(400).json({ error: 'Missing fileContents or query' });
  }

  const combinedText = fileContents
    .map(f => `File: ${f.name}\n${f.content.substring(0, 2000)}...`)
    .join('\n\n');

  const prompt = `
Respond **only** with a valid JSON object. No extra text, no markdown.

{
  "technicalSummary": "Detailed technical explanation",
  "laymanSummary": "Simple explanation for non-engineers",
  "wireDetails": [
    { "id": "W1", "spec": "1.5mm²", "from": "Panel A", "to": "Motor B" }
  ],
  "components": [
    { "name": "Relay X1", "type": "Electromechanical", "specs": { "voltage": "24VDC" } }
  ],
  "architectureSuggestion": "graph TD; A[Panel 3001] --> B(Motor A);"
}

Query: "${query}"
Documents: ${combinedText}

Return only the JSON object.
`;

  try {
    const rawOutput = await callGemini(prompt);
    const result = safeJsonParse(rawOutput);
    res.json(result);
  } catch (error) {
    console.error('Gemini API failed:', error);
    res.status(500).json({
      error: 'AI analysis failed',
      details: error.message
    });
  }
});

// ✅ Start server on 0.0.0.0
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 RAG server running on http://0.0.0.0:${PORT}`);
  console.log(`✅ Access your app at https://kmrc-backend.onrender.com`);
});
