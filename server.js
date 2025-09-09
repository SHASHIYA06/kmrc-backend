// server.js - Minimal, working version
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

//  ✅  Use Render's PORT
const PORT = process.env.PORT || 5000;

//  ✅  Fix CORS
app.use(cors({
  origin: ['https://bemlkmrcldocuemt.netlify.app', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '15mb' }));

//  ✅  Health check
app.get('/', (req, res) => {
  res.send('<h1> ✅  Backend is LIVE</h1><p><a href="/api/health">Check Health</a></p>');
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    time: new Date().toISOString(),
    message: 'Backend is working correctly'
  });
});

//  ✅  Fixed AI endpoint
app.post('/api/gemini/analyze', (req, res) => {
  const { fileContents, query } = req.body;
  
  // Log for debugging
  console.log('Received AI request:', { 
    query, 
    fileCount: fileContents?.length,
    firstFileName: fileContents?.[0]?.name
  });
  
  // Mock response (replace with real Gemini later)
  const mockResponse = {
    technicalSummary: `Query: "${query}" processed successfully on ${new Date().toISOString()}. Found relevant data in ${fileContents?.length || 0} document(s).`,
    laymanSummary: "The system found information related to your query in the selected files. No critical issues were identified.",
    wireDetails: [
      { id: "W-3001-A", spec: "1.5mm² Red", from: "Panel 3001", to: "Motor A" },
      { id: "W-3001-B", spec: "2.5mm² Blue", from: "Panel 3001", to: "Brake Unit" },
      { id: "W-3001-C", spec: "4.0mm² Black", from: "Panel 3001", to: "HVAC System" }
    ],
    components: [
      { name: "Relay X1", type: "Electromechanical", specs: { voltage: "24VDC", contacts: "SPDT", rating: "10A" } },
      { name: "Contactor C1", type: "Magnetic", specs: { voltage: "220VAC", poles: "3", rating: "25A" } }
    ],
    architectureSuggestion: "graph TD\nA[Main Power Supply] --> B[Panel 3001]\nB --> C[Motor A]\nB --> D[Brake Unit]\nB --> E[HVAC System]\nB --> F[Lighting Circuit]"
  };
  
  // Send valid JSON
  res.json(mockResponse);
});

//  ✅  Start server on 0.0.0.0 (required by Render)
app.listen(PORT, '0.0.0.0', () => {
  console.log(` 🚀  RAG server running on http://0.0.0.0:${PORT}`);
  console.log(` ✅  Access your app at https://kmrc-backend.onrender.com`);
});
