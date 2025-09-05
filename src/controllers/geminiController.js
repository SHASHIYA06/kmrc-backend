// backend/src/controllers/geminiController.js
const fetch = require('node-fetch');
const { sanitizeContent } = require('../utils/sanitizer');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;

exports.analyzeDocuments = async (req, res) => {
  const { fileContents, query } = req.body;

  if (!fileContents || !query) {
    return res.status(400).json({ error: 'Missing fileContents or query' });
  }

  const combinedText = fileContents
    .map(f => `File: ${f.name}\nContent:\n${f.content.substring(0, 2000)}...`)
    .join('\n\n');

  // 🔥 Critical: Force Gemini to return valid JSON
  const prompt = `
You are an expert metro systems engineer. Analyze the documents and respond in **valid JSON only**.
Do not add explanations outside JSON.

Respond with:
{
  "technicalSummary": "Detailed technical explanation",
  "laymanSummary": "Simple explanation for non-engineers",
  "wireDetails": [
    { "id": "W1", "spec": "1.5mm²", "from": "Panel A", "to": "Motor B" }
  ],
  "components": [
    { "name": "Relay X1", "type": "Electromechanical", "specs": { "voltage": "24VDC" } }
  ],
  "architectureSuggestion": "Mermaid.js flowchart code or description"
}

Documents:
${combinedText}

Query: "${query}"

Return only the JSON object. No extra text.
`;

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errText}`);
    }

    const data = await response.json();

    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('No response from Gemini');
    }

    const rawOutput = data.candidates[0].content.parts[0].text.trim();

    let parsed;
    try {
      // Strip any markdown or extra text
      const jsonText = rawOutput.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(jsonText);
    } catch (parseError) {
      // Fallback: return raw text if JSON fails
      console.warn('Gemini returned invalid JSON, returning raw:', rawOutput);
      parsed = {
        technicalSummary: `AI Response (not JSON): ${rawOutput.substring(0, 500)}...`,
        laymanSummary: "Could not parse detailed response.",
        wireDetails: [],
        components: [],
        architectureSuggestion: ""
      };
    }

    res.json(parsed);
  } catch (error) {
    console.error('Gemini API failed:', error);
    res.status(500).json({ 
      error: 'AI analysis failed', 
      details: error.message,
      raw: error.raw // for debugging
    });
  }
};
