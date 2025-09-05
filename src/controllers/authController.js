const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

exports.authUrl = (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file'
    ],
    prompt: 'consent'
  });
  res.json({ url: authUrl });
};

exports.callback = async (req, res) => {
  const { code } = req.body;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    req.session.tokens = tokens;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to authenticate' });
  }
};

exports.checkAuth = (req, res) => {
  if (req.session.tokens) {
    res.json({ authenticated: true });
  } else {
    res.json({ authenticated: false });
  }
};
