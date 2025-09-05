const express = require('express');
const { analyzeDocuments } = require('../controllers/geminiController');

const router = express.Router();

router.post('/analyze', analyzeDocuments);

module.exports = router;
