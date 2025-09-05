const Tesseract = require('tesseract.js');
const pdf = require('pdf-parse');

exports.extractTextFromPDF = async (buffer) => {
  try {
    const result = await Tesseract.recognize(buffer, 'eng');
    return result.data.text;
  } catch (error) {
    console.error('OCR failed:', error);
    return '[OCR Failed]';
  }
};
