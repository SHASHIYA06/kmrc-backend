const { google } = require('googleapis');
const fetch = require('node-fetch');
const { extractTextFromPDF } = require('../utils/ocr');
const { sanitizeContent } = require('../utils/sanitizer');

let oauth2Client;

const getAuthClient = (req) => {
  if (!oauth2Client) {
    oauth2Client = new google.auth.OAuth2();
  }
  oauth2Client.setCredentials(req.session.tokens);
  return oauth2Client;
};

exports.listFiles = async (req, res) => {
  try {
    const auth = getAuthClient(req);
    const drive = google.drive({ version: 'v3', auth });

    const folderId = process.env.MAIN_DRIVE_FOLDER_ID;
    const query = `'${folderId}' in parents and trashed = false`;

    const response = await drive.files.list({ q: query, fields: 'files(id, name, mimeType, modifiedTime)' });
    res.json(response.data.files);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list files', details: error.message });
  }
};

exports.getFileContent = async (req, res) => {
  const { fileId } = req.params;
  try {
    const auth = getAuthClient(req);
    const drive = google.drive({ version: 'v3', auth });

    const file = await drive.files.get({ fileId, fields: 'name, mimeType' });
    const fileName = file.data.name;
    const mimeType = file.data.mimeType;

    let content = '';

    if (mimeType === 'application/pdf') {
      const buffer = await drive.files.export({ fileId, mimeType: 'application/pdf' }).then(r => r.data);
      content = await extractTextFromPDF(buffer);
    } else if (mimeType.startsWith('image/')) {
      const buffer = await drive.files.get({ fileId, alt: 'media' }).then(r => r.data);
      content = await extractTextFromPDF(buffer); // Tesseract handles images
    } else {
      const buffer = await drive.files.export({ fileId, mimeType: 'text/plain' }).then(r => r.data);
      content = buffer.toString('utf8');
    }

    res.json({
      name: fileName,
      content: sanitizeContent(content)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read file', details: error.message });
  }
};
