const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const emaProcessor = require('./ema-processor.js');

// Configure multer for file uploads
const upload = multer({
  dest: path.join(__dirname, '../uploads/'),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max file size
  }
});

/**
 * @route GET /api/ema/status
 * @desc Get EMA data status
 * @access Public
 */
router.get('/status', async (req, res) => {
  try {
    const status = emaProcessor.getEmaDataStatus();
    res.json({ status, timestamp: new Date() });
  } catch (error) {
    console.error('Error getting EMA data status:', error);
    res.status(500).json({ error: 'Error getting EMA data status', details: error.message });
  }
});

/**
 * @route GET /api/ema/drug/:drugName
 * @desc Search EMA data for a specific drug
 * @access Public
 */
router.get('/drug/:drugName', async (req, res) => {
  try {
console.log("trying")
    const drugName = req.params.drugName;
    if (!drugName) {
      return res.status(400).json({ error: 'Drug name is required' });
    }
    
    const results = await emaProcessor.searchEmaDrugData(drugName);
    console.log(results)
    res.json(results);
  } catch (error) {
    console.error('Error searching EMA data:', error);
    res.status(500).json({ error: 'Error searching EMA data', details: error.message });
  }
});

/**
 * @route POST /api/ema/upload/:fileType
 * @desc Upload and process an EMA data file
 * @access Public
 */
router.post('/upload/:fileType', upload.single('file'), async (req, res) => {
  try {
    const fileType = req.params.fileType;
    const filePath = req.file?.path;
    
    if (!fileType) {
      return res.status(400).json({ error: 'File type is required' });
    }
    
    if (!filePath) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const result = await emaProcessor.processUploadedEmaFile(fileType, filePath);
    
    // Clean up uploaded file
    fs.unlinkSync(filePath);
    
    res.json(result);
  } catch (error) {
    console.error('Error processing uploaded file:', error);
    res.status(500).json({ error: 'Error processing uploaded file', details: error.message });
  }
});

/**
 * @route POST /api/ema/refresh
 * @desc Manually refresh EMA data
 * @access Public
 */
router.post('/refresh', async (req, res) => {
  try {
    await emaProcessor.checkAndRefreshData();
    const status = emaProcessor.getEmaDataStatus();
    res.json({ 
      message: 'Data refresh completed',
      status,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error refreshing EMA data:', error);
    res.status(500).json({ error: 'Error refreshing EMA data', details: error.message });
  }
});

module.exports = router;