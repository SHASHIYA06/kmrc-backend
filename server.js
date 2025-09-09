// server.js - Final Working Version
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// ✅ Fix CORS for Netlify
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

// ✅ AI Analysis Endpoint
app.post('/api/gemini/analyze', async (req, res) => {
  const { fileContents, query } = req.body;

  if (!fileContents || !query) {
    return res.status(400).json({ error: 'Missing fileContents or query' });
  }

  // ✅ Mock response (replace with real Gemini later)
  const mockResponse = {
    technicalSummary: `Query: "${query}" processed successfully. Found relevant data in ${fileContents.length} document(s).`,
    laymanSummary: "The system found information related to your query in the selected files.",
    wireDetails: [
      { id: "W-001", spec: "1.5mm²", from: "Panel A", to: "Motor B" }
    ],
    components: [
      { name: "Relay X1", type: "Electromechanical", specs: { voltage: "24VDC" } }
    ],
    architectureSuggestion: "graph TD; A[Panel] --> B(Motor); A --> C(Relay);"
  };

  res.json(mockResponse);
});

// ✅ Start server on 0.0.0.0 (required by Render)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 RAG server running on http://0.0.0.0:${PORT}`);
  console.log(`✅ Access your app at https://kmrc-backend.onrender.com`);
});
