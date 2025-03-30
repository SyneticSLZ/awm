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
// router.get('/drug/:drugName', async (req, res) => {
//   try {
// console.log("trying")
//     const drugName = req.params.drugName;
//     if (!drugName) {
//       return res.status(400).json({ error: 'Drug name is required' });
//     }
    
//     const results = await emaProcessor.searchEmaDrugData(drugName);
//     console.log(results)
//     res.json(results);
//   } catch (error) {
//     console.error('Error searching EMA data:', error);
//     res.status(500).json({ error: 'Error searching EMA data', details: error.message });
//   }
// });


/**
 * @route GET /api/ema/drug/:drugName
 * @desc Search EMA data for a specific drug using fuzzy matching
 * @access Public
 */
router.get('/drug/:drugName', async (req, res) => {
  try {
    console.log("Searching for drug:", req.params.drugName);
    
    const drugName = req.params.drugName;
    if (!drugName) {
      return res.status(400).json({ error: 'Drug name is required' });
    }
    
    // Get threshold from query parameter (default: 0.7)
    const threshold = parseFloat(req.query.threshold) || 0.7;
    
    // Validate threshold
    if (threshold < 0 || threshold > 1) {
      return res.status(400).json({ 
        error: 'Threshold must be between 0 and 1' 
      });
    }
    
    const results = await emaProcessor.searchEmaDrugData(drugName, threshold);
    
    // Add search metadata
    const response = {
      ...results,
      searchMetadata: {
        threshold,
        timestamp: new Date(),
        query: drugName
      }
    };
    
    console.log(`Found ${JSON.stringify(response.total)} matches for "${drugName}" with threshold ${threshold}`);
    res.json(response);
  } catch (error) {
    console.error('Error searching EMA data:', error);
    res.status(500).json({ 
      error: 'Error searching EMA data', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});



/**
 * @route GET /api/ema/condition/:conditionName
 * @desc Search EMA data for drugs associated with a specific condition
 * @access Public
 */
router.get('/condition/:conditionName', async (req, res) => {
  try {
    console.log("Searching for condition:", req.params.conditionName);
    
    const conditionName = req.params.conditionName;
    if (!conditionName) {
      return res.status(400).json({ error: 'Condition name is required' });
    }
    
    // Optional query parameters
    const threshold = parseFloat(req.query.threshold) || 0.7; // Fuzzy matching threshold
    const yearsThreshold = parseInt(req.query.years) || null; // Optional time filter
    
    // Validate parameters
    if (threshold < 0 || threshold > 1) {
      return res.status(400).json({ 
        error: 'Threshold must be between 0 and 1' 
      });
    }
    if (yearsThreshold && (yearsThreshold < 1 || yearsThreshold > 20)) {
      return res.status(400).json({ 
        error: 'Years threshold must be between 1 and 20' 
      });
    }
    
    const results = await emaProcessor.searchEmaConditionData(conditionName, { 
      threshold, 
      yearsThreshold 
    });
    
    const response = {
      ...results,
      searchMetadata: {
        threshold,
        yearsThreshold,
        timestamp: new Date(),
        query: conditionName
      }
    };
    
    console.log(`Found ${JSON.stringify(response.total)} matches for condition "${conditionName}"`);
    res.json(response);
  } catch (error) {
    console.error('Error searching EMA condition data:', error);
    res.status(500).json({ 
      error: 'Error searching EMA condition data', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});
/**
 * @route GET /api/ema/treatment-resistant-depression
 * @desc Find recent drugs targeting treatment-resistant depression
 * @access Public
 */
router.get('/treatment-resistant-depression', async (req, res) => {
  try {
    console.log("Searching for treatment-resistant depression drugs");
    
    // Get years threshold from query parameter (default: 5)
    const yearsThreshold = parseInt(req.query.years) || 5;
    
    // Validate years parameter
    if (yearsThreshold < 1 || yearsThreshold > 20) {
      return res.status(400).json({ 
        error: 'Years threshold must be between 1 and 20' 
      });
    }
    
    const results = await emaProcessor.findTreatmentResistantDepressionDrugs(yearsThreshold);
    
    // Add search metadata
    const response = {
      ...results,
      searchMetadata: {
        yearsThreshold,
        timestamp: new Date(),
        query: `Recent treatment-resistant depression drugs (last ${yearsThreshold} years)`
      }
    };
    
    console.log(`Found ${results.total} depression drugs, ${results.treatmentResistantCount} specifically for treatment-resistant depression`);
    res.json(response);
  } catch (error) {
    console.error('Error finding depression drugs:', error);
    res.status(500).json({ 
      error: 'Error finding depression drugs', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
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