const express = require('express');
const { listFiles, getFileContent } = require('../controllers/driveController');

const router = express.Router();

router.get('/files', listFiles);
router.get('/file/:fileId', getFileContent);

module.exports = router;
