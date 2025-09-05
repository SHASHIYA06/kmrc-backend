const fetch = require('node-fetch');
const { sanitizeContent } = require('../utils/sanitizer');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;

exports.analyzeDocuments = async (req, res) => {
  const { fileContents, query } = req.body;

  const combinedText = fileContents
    .map(f => `File: ${f.name}\nContent:\n${f.content.substring(0, 2000)}...`)
    .join('\n\n');

  const prompt = `
You are an expert AI engineer analyzing metro electrical documentation.
Analyze the following documents and answer the query in detail.

Provide:
1. A technical/engineering summary
2. A layman's summary
3. Extracted wire details, components, BOM, specs
4. If relevant, describe the system architecture and suggest a diagram structure

Documents:
${combinedText}

Query: "${query}"

Respond in structured JSON with:
{
  "technicalSummary": "",
  "laymanSummary": "",
  "wireDetails": [],
  "components": [],
  "architectureSuggestion": ""
}
`;

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      })
    });

    const data = await response.json();
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('No response from Gemini');
    }

    const rawOutput = data.candidates[0].content.parts[0].text;
    let parsed;
    try {
      parsed = JSON.parse(rawOutput);
    } catch (e) {
      parsed = { raw: rawOutput };
    }

    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: 'Gemini API failed', details: error.message });
  }
};
