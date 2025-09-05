const express = require('express');
const { authUrl, callback, checkAuth } = require('../controllers/authController');

const router = express.Router();

router.get('/url', authUrl);
router.post('/callback', callback);
router.get('/status', checkAuth);

module.exports = router;
