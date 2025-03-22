const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const Papa = require('papaparse');
const { createObjectCsvWriter } = require('csv-writer');

// Base data directory
const DATA_DIR = path.join(__dirname, './data/ema');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// EMA data file paths (based on the files you have)
const EMA_FILES = {
  MEDICINES: path.join(DATA_DIR, 'medicines_output_medicines_en.csv'),
  ORPHANS: path.join(DATA_DIR, 'medicines_output_orphan_designations_en.csv'),
  REFERRALS: path.join(DATA_DIR, 'medicines_output_referrals_en.csv'),
  DHPC: path.join(DATA_DIR, 'medicines_output_dhpc_en.csv'),
  PSUSA: path.join(DATA_DIR, 'medicines_output_periodic_safety_update_report_single_assessments_en.csv'),
  SHORTAGES: path.join(DATA_DIR, 'medicines_output_shortages_en.csv')
};

// Field mappings based on the CSV structure (we'll determine these when reading the files)
const FIELD_MAPPINGS = {
  MEDICINES: {
    name: 'Medicine',
    status: null, // Will be determined when parsing
    therapeutic_area: null,
    active_substance: null,
    authorisation_date: null
  },
  ORPHANS: {
    name: 'Orphan designation',
    condition: null,
    status: null,
    decision_date: null,
    sponsor: null
  },
  DHPC: {
    title: 'Direct healthcare professional communication (DHPC)',
    reason: null,
    medicine: null,
    date: null
  },
  PSUSA: {
    substance: 'Periodic safety update report single assessments (PSUSA)',
    procedure: null,
    outcome: null,
    date: null
  },
  REFERRALS: {
    title: 'Referral',
    substance: null,
    type: null,
    status: null,
    date: null
  },
  SHORTAGES: {
    title: 'Shortage',
    medicine: null,
    reason: null,
    date: null,
    status: null
  }
};

/**
 * Get actual field names from the CSV headers
 * @param {string} filePath - Path to the CSV file
 * @returns {Promise<Object>} - Object with field mappings
 */
async function getFieldMappings(filePath, fileType) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return resolve(null);
    }

    const parser = fs.createReadStream(filePath)
      .pipe(csv())
      .on('headers', (headers) => {
        parser.destroy(); // Stop after getting headers
        
        let mappings = {...FIELD_MAPPINGS[fileType]};
        
        // Map fields based on header content
        headers.forEach(header => {
          if (!header) return;
          
          const lowerHeader = header.toLowerCase();
          
          // Map specific fields based on the file type
          switch (fileType) {
            case 'MEDICINES':
              if (lowerHeader.includes('status')) mappings.status = header;
              if (lowerHeader.includes('therapeutic') || lowerHeader.includes('area')) mappings.therapeutic_area = header;
              if (lowerHeader.includes('substance')) mappings.active_substance = header;
              if (lowerHeader.includes('authorisation') || lowerHeader.includes('date')) mappings.authorisation_date = header;
              break;
            case 'ORPHANS':
              if (lowerHeader.includes('condition')) mappings.condition = header;
              if (lowerHeader.includes('status')) mappings.status = header;
              if (lowerHeader.includes('date')) mappings.decision_date = header;
              if (lowerHeader.includes('sponsor')) mappings.sponsor = header;
              break;
            case 'DHPC':
              if (lowerHeader.includes('reason')) mappings.reason = header;
              if (lowerHeader.includes('medicine')) mappings.medicine = header;
              if (lowerHeader.includes('date')) mappings.date = header;
              break;
            case 'PSUSA':
              if (lowerHeader.includes('procedure')) mappings.procedure = header;
              if (lowerHeader.includes('outcome')) mappings.outcome = header;
              if (lowerHeader.includes('date')) mappings.date = header;
              break;
            case 'REFERRALS':
              if (lowerHeader.includes('substance')) mappings.substance = header;
              if (lowerHeader.includes('type')) mappings.type = header;
              if (lowerHeader.includes('status')) mappings.status = header;
              if (lowerHeader.includes('date')) mappings.date = header;
              break;
            case 'SHORTAGES':
              if (lowerHeader.includes('medicine')) mappings.medicine = header;
              if (lowerHeader.includes('reason')) mappings.reason = header;
              if (lowerHeader.includes('date')) mappings.date = header;
              if (lowerHeader.includes('status')) mappings.status = header;
              break;
          }
        });
        
        resolve(mappings);
      })
      .on('error', (err) => {
        reject(err);
      });
  });
}

/**
 * Initialize field mappings for all files
 */
async function initializeFieldMappings() {
  try {
    // Get field mappings for each file type
    const medicinesMappings = await getFieldMappings(EMA_FILES.MEDICINES, 'MEDICINES');
    const orphansMappings = await getFieldMappings(EMA_FILES.ORPHANS, 'ORPHANS');
    const dhpcMappings = await getFieldMappings(EMA_FILES.DHPC, 'DHPC');
    const psusaMappings = await getFieldMappings(EMA_FILES.PSUSA, 'PSUSA');
    const referralsMappings = await getFieldMappings(EMA_FILES.REFERRALS, 'REFERRALS');
    const shortagesMappings = await getFieldMappings(EMA_FILES.SHORTAGES, 'SHORTAGES');
    
    // Update global field mappings
    if (medicinesMappings) FIELD_MAPPINGS.MEDICINES = medicinesMappings;
    if (orphansMappings) FIELD_MAPPINGS.ORPHANS = orphansMappings;
    if (dhpcMappings) FIELD_MAPPINGS.DHPC = dhpcMappings;
    if (psusaMappings) FIELD_MAPPINGS.PSUSA = psusaMappings;
    if (referralsMappings) FIELD_MAPPINGS.REFERRALS = referralsMappings;
    if (shortagesMappings) FIELD_MAPPINGS.SHORTAGES = shortagesMappings;
    
    console.log('Field mappings initialized:', FIELD_MAPPINGS);
  } catch (error) {
    console.error('Error initializing field mappings:', error);
  }
}

/**
 * Search EMA data for a specific drug name
 * @param {string} drugName - Drug name to search for
 * @returns {Promise<Object>} - Search results
 */
async function searchEmaDrugData(drugName) {
  if (!drugName) {
    return { error: 'No drug name provided' };
  }
  
  // Initialize field mappings if not already done
  await initializeFieldMappings();
  
  // Normalize drug name for search
  const normalizedDrugName = drugName.toLowerCase().trim();
  
  try {
    // Search results
    const results = {
      medicines: [],
      orphans: [],
      referrals: [],
      dhpc: [],
      psusa: [],
      shortages: []
    };
    
    // Search in medicines data
    if (fs.existsSync(EMA_FILES.MEDICINES)) {
      results.medicines = await searchCsvFile(EMA_FILES.MEDICINES, normalizedDrugName);
    }
    
    // Search in orphans data
    if (fs.existsSync(EMA_FILES.ORPHANS)) {
      results.orphans = await searchCsvFile(EMA_FILES.ORPHANS, normalizedDrugName);
    }
    
    // Search in referrals data
    if (fs.existsSync(EMA_FILES.REFERRALS)) {
      results.referrals = await searchCsvFile(EMA_FILES.REFERRALS, normalizedDrugName);
    }
    
    // Search in DHPC data
    if (fs.existsSync(EMA_FILES.DHPC)) {
      results.dhpc = await searchCsvFile(EMA_FILES.DHPC, normalizedDrugName);
    }
    
    // Search in PSUSA data
    if (fs.existsSync(EMA_FILES.PSUSA)) {
      results.psusa = await searchCsvFile(EMA_FILES.PSUSA, normalizedDrugName);
    }
    
    // Search in shortages data
    if (fs.existsSync(EMA_FILES.SHORTAGES)) {
      results.shortages = await searchCsvFile(EMA_FILES.SHORTAGES, normalizedDrugName);
    }
    
    return {
      query: drugName,
      results,
      total: {
        medicines: results.medicines.length,
        orphans: results.orphans.length,
        referrals: results.referrals.length,
        dhpc: results.dhpc.length,
        psusa: results.psusa.length,
        shortages: results.shortages.length
      }
    };
  } catch (error) {
    console.error(`Error searching EMA data for ${drugName}:`, error);
    return { error: 'Error searching EMA data', details: error.message };
  }
}

/**
 * Search a CSV file for a drug name
 * @param {string} filePath - Path to the CSV file
 * @param {string} searchTerm - Term to search for
 * @returns {Promise<Array>} - Matching records
 */
async function searchCsvFile(filePath, searchTerm) {
  return new Promise((resolve, reject) => {
    const results = [];
    
    fs.createReadStream(filePath)
      .pipe(csv({
        skipLines: 0,
        headers: true,
        mapHeaders: ({ header }) => header.trim()
      }))
      .on('data', (data) => {
        // Check all fields for the search term
        const isMatch = Object.entries(data).some(([key, value]) => {
          return value && 
                 typeof value === 'string' && 
                 value.toLowerCase().includes(searchTerm);
        });
        
        if (isMatch) {
          // Clean up the data object by removing empty fields
          const cleanData = {};
          Object.entries(data).forEach(([key, value]) => {
            if (value !== null && value !== undefined && value !== '') {
              cleanData[key] = value;
            }
          });
          
          results.push(cleanData);
        }
      })
      .on('end', () => {
        resolve(results);
      })
      .on('error', (err) => {
        reject(err);
      });
  });
}

/**
 * Process a manually uploaded EMA file
 * @param {string} fileType - Type of file (dhpc, psusa, etc.)
 * @param {string} filePath - Path to the uploaded file
 * @returns {Promise<Object>} - Processing result
 */
async function processUploadedEmaFile(fileType, filePath) {
  try {
    let targetPath;
    
    switch (fileType.toLowerCase()) {
      case 'dhpc':
        targetPath = EMA_FILES.DHPC;
        break;
      case 'psusa':
        targetPath = EMA_FILES.PSUSA;
        break;
      case 'medicines':
        targetPath = EMA_FILES.MEDICINES;
        break;
      case 'orphans':
        targetPath = EMA_FILES.ORPHANS;
        break;
      case 'referrals':
        targetPath = EMA_FILES.REFERRALS;
        break;
      case 'shortages':
        targetPath = EMA_FILES.SHORTAGES;
        break;
      default:
        return { error: 'Unsupported file type' };
    }
    
    // Read uploaded file
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    // Parse the file
    const parseResult = Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true
    });
    
    if (parseResult.errors && parseResult.errors.length > 0) {
      return {
        error: 'Error parsing file',
        details: parseResult.errors
      };
    }
    
    // Write to target file
    fs.writeFileSync(targetPath, fileContent);
    
    // Reset field mappings to pick up new headers
    await initializeFieldMappings();
    
    return {
      success: true,
      records: parseResult.data.length,
      message: `Successfully processed ${parseResult.data.length} records`
    };
  } catch (error) {
    console.error(`Error processing uploaded file:`, error);
    return { error: 'Error processing file', details: error.message };
  }
}

/**
 * Get EMA data status (which files are available and when they were last updated)
 * @returns {Object} - Data status
 */
function getEmaDataStatus() {
  const status = {};
  
  // Check each data file
  for (const [key, filePath] of Object.entries(EMA_FILES)) {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      const recordCount = countCsvRecords(filePath);
      
      status[key.toLowerCase()] = {
        available: true,
        lastUpdated: stats.mtime,
        records: recordCount,
        path: filePath,
        filename: path.basename(filePath)
      };
    } else {
      status[key.toLowerCase()] = {
        available: false
      };
    }
  }
  
  return status;
}

/**
 * Count the number of records in a CSV file
 * @param {string} filePath - Path to the CSV file
 * @returns {number} - Number of records
 */
function countCsvRecords(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    return Math.max(0, lines.length - 1); // Subtract header row
  } catch (error) {
    console.error(`Error counting records in ${filePath}:`, error);
    return 0;
  }
}

// Initialize field mappings on module load
initializeFieldMappings().catch(err => {
  console.error('Error during initialization:', err);
});

module.exports = {
  searchEmaDrugData,
  processUploadedEmaFile,
  getEmaDataStatus,
  initializeFieldMappings
};