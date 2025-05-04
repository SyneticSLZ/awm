const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const Papa = require('papaparse');
const FuzzySet = require('fuzzyset.js');
const { createObjectCsvWriter } = require('csv-writer');
const { normalizeEmaData } = require('./ema-data-normalizer');
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
// const FIELD_MAPPINGS = {
//   MEDICINES: {
//     name: 'Medicine',
//     status: null, // Will be determined when parsing
//     therapeutic_area: null,
//     active_substance: null,
//     authorisation_date: null
//   },
//   ORPHANS: {
//     name: 'Orphan designation',
//     condition: null,
//     status: null,
//     decision_date: null,
//     sponsor: null
//   },
//   DHPC: {
//     title: 'Direct healthcare professional communication (DHPC)',
//     reason: null,
//     medicine: null,
//     date: null
//   },
//   PSUSA: {
//     substance: 'Periodic safety update report single assessments (PSUSA)',
//     procedure: null,
//     outcome: null,
//     date: null
//   },
//   REFERRALS: {
//     title: 'Referral',
//     substance: null,
//     type: null,
//     status: null,
//     date: null
//   },
//   SHORTAGES: {
//     title: 'Shortage',
//     medicine: null,
//     reason: null,
//     date: null,
//     status: null
//   }
// };

// Updated FIELD_MAPPINGS object with more comprehensive mappings
const FIELD_MAPPINGS = {
  MEDICINES: {
    name: 'Name of medicine',
    status: 'Medicine status',
    therapeutic_area: 'Therapeutic area (MeSH)',
    active_substance: 'Active substance',
    authorisation_date: 'Marketing authorisation date',
    therapeutic_indication: 'Therapeutic indication',
    atc_code: 'ATC code (human)',
    orphan: 'Orphan medicine',
    ema_number: 'EMA product number',
    url: 'Medicine URL',
    _all_headers: [] // Will be populated during initialization
  },
  ORPHANS: {
    name: 'Medicine name',
    status: 'Status',
    intended_use: 'Intended use',
    decision_date: 'Date of designation / refusal',
    eu_number: 'EU designation number',
    active_substance: 'Active substance',
    _all_headers: [] // Will be populated during initialization
  },
  DHPC: {
    title: 'Direct healthcare professional communication (DHPC)',
    medicine: 'Name of medicine',
    reason: 'Reason',
    date: 'Publication date',
    _all_headers: [] // Will be populated during initialization
  },
  PSUSA: {
    substance: 'Periodic safety update report single assessments (PSUSA)',
    procedure: 'Procedure',
    outcome: 'Outcome',
    date: 'Publication date',
    _all_headers: [] // Will be populated during initialization
  },
  REFERRALS: {
    title: 'Referral',
    substance: 'Active substance',
    type: 'Type of procedure',
    status: 'Status',
    date: 'Publication date',
    _all_headers: [] // Will be populated during initialization
  },
  SHORTAGES: {
    title: 'Shortage',
    medicine: 'Medicine name',
    reason: 'Reason for shortage',
    date: 'Publication date',
    status: 'Status',
    _all_headers: [] // Will be populated during initialization
  }
};
/**
 * Improved functions for handling EMA medicine and orphan data
 */

async function getFieldMappings(filePath, fileType) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      console.log(`File not found: ${filePath}`);
      return resolve(null);
    }

    console.log(`Detecting field mappings for ${fileType} file: ${filePath}`);

    // Define specific field name patterns to look for based on file type
    const fieldPatterns = {
      MEDICINES: {
        name: ['name of medicine', 'medicine name', 'name', 'product'],
        status: ['medicine status', 'status'],
        therapeutic_area: ['therapeutic area', 'indication', 'mesh', 'therapeutic area (mesh)'],
        active_substance: ['active substance', 'inn', 'substance', 'international non-proprietary name (inn) / common name'],
        authorisation_date: ['authorisation date', 'marketing authorisation date', 'decision date', 'european commission decision date'],
        therapeutic_indication: ['therapeutic indication', 'indication'],
        atc_code: ['atc code', 'atc', 'atc code (human)'],
        orphan: ['orphan', 'orphan medicine'],
        ema_number: ['ema product number', 'product number'],
        url: ['medicine url', 'url']
      },
      ORPHANS: {
        name: ['medicine name', 'name', 'orphan designation', 'designation'],
        status: ['status'],
        intended_use: ['intended use', 'treatment', 'condition'],
        decision_date: ['date of designation', 'designation date', 'decision date'],
        eu_number: ['eu designation number', 'designation number'],
        active_substance: ['active substance', 'substance']
      },
      DHPC: {
        title: ['direct healthcare professional communication (dhpc)', 'dhpc type', 'name of medicine'],
        medicine: ['name of medicine', 'medicine'],
        reason: ['reason', 'dhpc type', 'regulatory outcome'],
        date: ['publication date', 'dissemination date', 'first published date']
      },
      PSUSA: {
        substance: ['active substance', 'active substances in scope of procedure'],
        procedure: ['procedure number', 'procedure'],
        outcome: ['regulatory outcome', 'outcome'],
        date: ['first published date', 'last updated date']
      },
      REFERRALS: {
        title: ['referral name', 'name'],
        substance: ['active substance', 'international non-proprietary name (inn) / common name'],
        type: ['referral type', 'type'],
        status: ['current status', 'status'],
        date: ['procedure start date', 'first published date', 'last updated date']
      },
      SHORTAGES: {
        title: ['medicine affected', 'shortage'],
        medicine: ['medicine affected', 'medicine'],
        reason: ['reason for shortage', 'reason'],
        status: ['supply shortage status', 'status'],
        date: ['start of shortage date', 'first published date']
      }
    };

    let fileContent = '';
    const readStream = fs.createReadStream(filePath, { encoding: 'utf8' });

    readStream.on('data', (chunk) => {
      fileContent += chunk;
    });

    readStream.on('end', () => {
      try {
        console.log(`Read ${fileContent.length} bytes from ${filePath}`);
        
        // Use Papa Parse to get headers more reliably
        const parsedData = Papa.parse(fileContent, {
          header: true,
          skipEmptyLines: true,
          preview: 5 // Get a few rows to ensure we see all headers
        });

        const headers = parsedData.meta.fields || [];
        console.log(`Detected ${headers.length} headers:`, headers);
        
        // Create an initial mapping object
        let mappings = {};
        
        // Initialize fields to null for the specific file type
        if (fieldPatterns[fileType]) {
          Object.keys(fieldPatterns[fileType]).forEach(field => {
            mappings[field] = null;
          });
        }

        // Map fields based on header content using the patterns
        headers.forEach(header => {
          if (!header) return;
          
          const lowerHeader = header.toLowerCase().trim();
          console.log(`Processing header: "${lowerHeader}"`);
          
          // Match each header against our patterns for this file type
          const patterns = fieldPatterns[fileType];
          if (patterns) {
            Object.entries(patterns).forEach(([field, keywords]) => {
              // If we haven't found a match for this field yet, check if this header matches
              if (!mappings[field]) {
                const matches = keywords.some(keyword => {
                  const match = lowerHeader.includes(keyword) || 
                              levenshteinDistance(lowerHeader, keyword) <= 3; // Allow for small typos
                  if (match) {
                    console.log(`Matched ${field} to "${header}" using pattern "${keyword}"`);
                  }
                  return match;
                });
                
                if (matches) {
                  mappings[field] = header;
                }
              }
            });
          }
        });

        // If we couldn't find critical fields, try fallbacks based on position or content
        if (fileType === 'MEDICINES' && !mappings.name && headers.length > 1) {
          // Second column is often the medicine name
          mappings.name = headers[1];
          console.log(`Using fallback for medicine name: ${headers[1]}`);
        }
        
        if (fileType === 'ORPHANS' && !mappings.name && headers.length > 0) {
          // First column is often the medicine name in orphan designations
          mappings.name = headers[0];
          console.log(`Using fallback for orphan name: ${headers[0]}`);
        }

        // Store all headers so we can search all fields even if unmapped
        mappings._all_headers = headers;
        
        console.log(`Field mappings for ${fileType}:`, mappings);
        resolve(mappings);
      } catch (error) {
        console.error(`Error parsing headers for ${fileType}:`, error);
        reject(error);
      }
    });

    readStream.on('error', (err) => {
      console.error(`Error reading file ${filePath}:`, err);
      reject(err);
    });
  });
}

async function searchCsvFile(filePath, searchTerm, fieldMappings, threshold = 0.7) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      console.log(`File not found: ${filePath}`);
      return resolve([]);
    }

    // Normalize search term
    const normalizedSearchTerm = searchTerm.toLowerCase().trim();
    console.log(`Searching for "${normalizedSearchTerm}" in ${filePath} with threshold ${threshold}`);
    
    let results = [];

    // Read and parse the file with Papa Parse for better handling
    fs.readFile(filePath, 'utf8', (err, fileContent) => {
      if (err) {
        console.error(`Error reading file ${filePath}:`, err);
        return reject(err);
      }

      try {
        // Clean the file content - remove BOM and normalize line endings
        const cleanContent = fileContent
          .replace(/^\uFEFF/, '') // Remove BOM
          .replace(/\r\n/g, '\n'); // Normalize line endings
        
        // Parse CSV
        const parseOptions = {
          header: true,
          skipEmptyLines: true,
          transformHeader: header => header ? header.trim() : '',
          // Additional transform function to clean empty strings and whitespace
          transform: function(value) {
            if (value === undefined || value === null) return '';
            value = value.toString().trim();
            return value === '' ? null : value;
          }
        };
        
        const parsedData = Papa.parse(cleanContent, parseOptions);

        if (parsedData.errors && parsedData.errors.length > 0) {
          console.warn(`Warnings when parsing ${filePath}:`, parsedData.errors);
        }
        
        console.log(`Parsed ${parsedData.data.length} rows from ${filePath}`);

        // Track matched columns for debugging
        const matchedColumns = new Set();
        
        // Process each record
        parsedData.data.forEach(record => {
          let highestSimilarity = 0;
          let matchingField = '';
          let directMatch = false;

          // Check each field in the record for matches
          Object.entries(record).forEach(([field, value]) => {
            if (!value || typeof value !== 'string' || value.trim() === '') {
              return;
            }

            const normalizedValue = value.toLowerCase().trim();
            
            // Priority to exact matches
            if (normalizedValue === normalizedSearchTerm) {
              highestSimilarity = 1;
              matchingField = field;
              directMatch = true;
              matchedColumns.add(field);
              console.log(`Exact match found in field "${field}": "${value}"`);
              return;
            }

            // Check if value contains the search term
            if (normalizedValue.includes(normalizedSearchTerm)) {
              const containSimilarity = 0.9; // High score for substring match
              if (containSimilarity > highestSimilarity) {
                highestSimilarity = containSimilarity;
                matchingField = field;
                matchedColumns.add(field);
                console.log(`Substring match found in field "${field}": "${value}" contains "${normalizedSearchTerm}"`);
              }
            }

            // Check similarity with entire value
            const similarity = calculateSimilarity(normalizedValue, normalizedSearchTerm);
            if (similarity > highestSimilarity) {
              highestSimilarity = similarity;
              matchingField = field;
              matchedColumns.add(field);
            }

            // Check each word in multi-word values
            normalizedValue.split(/\s+/).forEach(word => {
              if (word.length < 3) return; // Skip very short words
              
              const wordSimilarity = calculateSimilarity(word, normalizedSearchTerm);
              if (wordSimilarity > highestSimilarity) {
                highestSimilarity = wordSimilarity;
                matchingField = field;
                matchedColumns.add(field);
              }
            });
          });

          // Only include results above threshold
          if (highestSimilarity >= threshold) {
            // Create a clean record with consistent field names
            const cleanRecord = {
              _similarity: highestSimilarity,
              _matchField: matchingField,
              _directMatch: directMatch
            };

            // Map fields using our field mappings if available
            if (fieldMappings) {
              Object.entries(fieldMappings).forEach(([mappedField, headerName]) => {
                if (headerName && headerName !== '_all_headers' && record[headerName] !== undefined) {
                  cleanRecord[mappedField] = record[headerName];
                }
              });
            }

            // Include all original fields as well
            Object.entries(record).forEach(([field, value]) => {
              if (value !== null && value !== undefined && value.trim() !== '') {
                // Use a prefix for original fields to avoid conflicts
                const fieldName = `_original_${field}`;
                cleanRecord[fieldName] = value;
              }
            });

            results.push(cleanRecord);
          }
        });
        
        if (matchedColumns.size > 0) {
          console.log(`Search matched in columns: ${Array.from(matchedColumns).join(', ')}`);
        }
        console.log(`Found ${results.length} matches for "${normalizedSearchTerm}"`);

        // Sort results by similarity score (highest first)
        results.sort((a, b) => {
          // Direct matches first
          if (a._directMatch && !b._directMatch) return -1;
          if (!a._directMatch && b._directMatch) return 1;
          // Then by similarity score
          return b._similarity - a._similarity;
        });

        resolve(results);
      } catch (error) {
        console.error(`Error parsing CSV file ${filePath}:`, error);
        reject(error);
      }
    });
  });
}

/**
 * Improved search for EMA drug data
 * @param {string} drugName - Drug name to search for
 * @param {number} threshold - Similarity threshold (0-1), default 0.7
 * @returns {Promise<Object>} - Search results with improved data extraction
 */
async function searchEmaDrugData(drugName, threshold = 0.7) {
  if (!drugName) {
    return { error: 'No drug name provided' };
  }
  
  try {
    // Initialize field mappings
    await initializeFieldMappings();
    
    // Normalize drug name for search
    const normalizedDrugName = drugName.toLowerCase().trim();
    console.log(`Searching for "${normalizedDrugName}" with threshold ${threshold}`);
    
    // Search results structure
    const results = {
      medicines: [],
      orphans: [],
      referrals: [],
      dhpc: [],
      psusa: [],
      shortages: []
    };
    
    // Search in medicines data with improved field mappings
    if (fs.existsSync(EMA_FILES.MEDICINES)) {
      const medicinesResults = await searchCsvFile(
        EMA_FILES.MEDICINES, 
        normalizedDrugName, 
        FIELD_MAPPINGS.MEDICINES,
        threshold
      );
      
      // Normalize the medicine results
      results.medicines = normalizeEmaData(medicinesResults);
      console.log(`Found ${results.medicines.length} medicine results`);
    }
    
    // Search in orphans data with improved field mappings
    if (fs.existsSync(EMA_FILES.ORPHANS)) {
      const orphansResults = await searchCsvFile(
        EMA_FILES.ORPHANS, 
        normalizedDrugName, 
        FIELD_MAPPINGS.ORPHANS,
        threshold
      );
      
      // Normalize the orphan results
      results.orphans = normalizeEmaData(orphansResults);
      console.log(`Found ${results.orphans.length} orphan results`);
    }
    
    // Search in other data files (can be extended with similar improvements)
    if (fs.existsSync(EMA_FILES.REFERRALS)) {
      const referralsResults = await searchCsvFile(
        EMA_FILES.REFERRALS, 
        normalizedDrugName,
        FIELD_MAPPINGS.REFERRALS,
        threshold
      );
      
      // Normalize the referrals results
      results.referrals = normalizeEmaData(referralsResults);
      console.log(`Found ${results.referrals.length} referral results`);
    }
    
    if (fs.existsSync(EMA_FILES.DHPC)) {
      const dhpcResults = await searchCsvFile(
        EMA_FILES.DHPC, 
        normalizedDrugName,
        FIELD_MAPPINGS.DHPC,
        threshold
      );
      
      // Normalize the DHPC results
      results.dhpc = normalizeEmaData(dhpcResults);
      console.log(`Found ${results.dhpc.length} safety communication results`);
    }
    
    if (fs.existsSync(EMA_FILES.PSUSA)) {
      const psusaResults = await searchCsvFile(
        EMA_FILES.PSUSA, 
        normalizedDrugName,
        FIELD_MAPPINGS.PSUSA,
        threshold
      );
      
      // Normalize the PSUSA results
      results.psusa = normalizeEmaData(psusaResults);
      console.log(`Found ${results.psusa.length} PSUSA results`);
    }
    
    if (fs.existsSync(EMA_FILES.SHORTAGES)) {
      const shortagesResults = await searchCsvFile(
        EMA_FILES.SHORTAGES, 
        normalizedDrugName,
        FIELD_MAPPINGS.SHORTAGES,
        threshold
      );
      
      // Normalize the shortages results
      results.shortages = normalizeEmaData(shortagesResults);
      console.log(`Found ${results.shortages.length} shortage results`);
    }
    
    // Return comprehensive results
    return {
      query: drugName,
      queryNormalized: normalizedDrugName,
      searchThreshold: threshold,
      results,
      total: {
        medicines: results.medicines.length,
        orphans: results.orphans.length,
        referrals: results.referrals.length,
        dhpc: results.dhpc.length,
        psusa: results.psusa.length,
        shortages: results.shortages.length,
        all: results.medicines.length + results.orphans.length + 
             results.referrals.length + results.dhpc.length + 
             results.psusa.length + results.shortages.length
      }
    };
  } catch (error) {
    console.error(`Error searching EMA data for ${drugName}:`, error);
    return { 
      error: 'Error searching EMA data', 
      details: error.message,
      stack: error.stack
    };
  }
}


/**
 * Get EMA data status
 * @returns {boolean|Object} - Status information or true if all data is available
 */
function getEmaDataStatus() {
  try {
    // Check if data files exist
    const status = {
      medicines: {
        available: fs.existsSync(EMA_FILES.MEDICINES),
        lastUpdated: fs.existsSync(EMA_FILES.MEDICINES) ? 
          fs.statSync(EMA_FILES.MEDICINES).mtime : null
      },
      orphans: {
        available: fs.existsSync(EMA_FILES.ORPHANS),
        lastUpdated: fs.existsSync(EMA_FILES.ORPHANS) ? 
          fs.statSync(EMA_FILES.ORPHANS).mtime : null
      },
      referrals: {
        available: fs.existsSync(EMA_FILES.REFERRALS),
        lastUpdated: fs.existsSync(EMA_FILES.REFERRALS) ? 
          fs.statSync(EMA_FILES.REFERRALS).mtime : null
      },
      dhpc: {
        available: fs.existsSync(EMA_FILES.DHPC),
        lastUpdated: fs.existsSync(EMA_FILES.DHPC) ? 
          fs.statSync(EMA_FILES.DHPC).mtime : null
      },
      psusa: {
        available: fs.existsSync(EMA_FILES.PSUSA),
        lastUpdated: fs.existsSync(EMA_FILES.PSUSA) ? 
          fs.statSync(EMA_FILES.PSUSA).mtime : null
      },
      shortages: {
        available: fs.existsSync(EMA_FILES.SHORTAGES),
        lastUpdated: fs.existsSync(EMA_FILES.SHORTAGES) ? 
          fs.statSync(EMA_FILES.SHORTAGES).mtime : null
      }
    };
    
    // Get most recent update
    let mostRecentUpdate = null;
    Object.values(status).forEach(fileStatus => {
      if (fileStatus.available && fileStatus.lastUpdated) {
        if (!mostRecentUpdate || fileStatus.lastUpdated > mostRecentUpdate) {
          mostRecentUpdate = fileStatus.lastUpdated;
        }
      }
    });
    
    status.lastUpdate = mostRecentUpdate;
    status.allAvailable = Object.values(status).every(s => s.available);
    
    return status;
  } catch (error) {
    console.error('Error checking EMA data status:', error);
    return false;
  }
}

/**
 * Process an uploaded EMA file
 * @param {string} fileType - Type of file (medicines, orphans, etc.)
 * @param {string} filePath - Path to the uploaded file
 * @returns {Promise<Object>} - Processing results
 */
async function processUploadedEmaFile(fileType, filePath) {
  try {
    // Validate file type
    const validFileTypes = ['medicines', 'orphans', 'dhpc', 'psusa', 'referrals', 'shortages'];
    if (!validFileTypes.includes(fileType.toLowerCase())) {
      return { error: `Invalid file type: ${fileType}. Valid types are: ${validFileTypes.join(', ')}` };
    }
    
    // Map file type to destination path
    const destFile = getDestinationFile(fileType);
    if (!destFile) {
      return { error: `Could not determine destination file for type: ${fileType}` };
    }
    
    // Create data directory if it doesn't exist
    const dataDir = path.dirname(destFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Read the uploaded file
    const fileContent = await fs.promises.readFile(filePath, 'utf8');
    
    // Process and validate the file
    const result = await validateAndProcessCsvFile(fileContent, fileType);
    
    if (result.error) {
      return result;
    }
    
    // Write processed data to destination file
    await fs.promises.writeFile(destFile, fileContent);
    
    // Update field mappings
    await initializeFieldMappings();
    
    return {
      success: true,
      fileType,
      destination: destFile,
      records: result.records,
      message: `File processed successfully. ${result.records} records found.`
    };
  } catch (error) {
    console.error(`Error processing uploaded file for ${fileType}:`, error);
    return { error: `Error processing file: ${error.message}` };
  }
}

/**
 * Validate and process a CSV file
 * @param {string} fileContent - CSV file content
 * @param {string} fileType - Type of file
 * @returns {Promise<Object>} - Validation results
 */
async function validateAndProcessCsvFile(fileContent, fileType) {
  try {
    // Parse CSV
    const parsedData = Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true
    });
    
    if (parsedData.errors && parsedData.errors.length > 0) {
      return { 
        error: 'CSV parsing errors detected', 
        details: parsedData.errors 
      };
    }
    
    // Check if the file has any rows
    if (!parsedData.data || parsedData.data.length === 0) {
      return { error: 'No data rows found in the CSV file' };
    }
    
    // Check if the file has the expected headers based on the file type
    const headers = parsedData.meta.fields || [];
    const expectedHeaders = getExpectedHeaders(fileType);
    
    if (expectedHeaders.length > 0) {
      const foundRequiredHeaders = expectedHeaders.filter(header => 
        headers.some(h => h.toLowerCase().includes(header.toLowerCase()))
      );
      
      if (foundRequiredHeaders.length < expectedHeaders.length * 0.5) {
        return { 
          error: 'Missing required headers', 
          details: `File is missing too many required headers for type: ${fileType}`,
          found: headers,
          expected: expectedHeaders
        };
      }
    }
    
    return {
      success: true,
      records: parsedData.data.length,
      headers
    };
  } catch (error) {
    console.error(`Error validating CSV file for ${fileType}:`, error);
    return { error: `Error validating file: ${error.message}` };
  }
}

/**
 * Get the destination file path for a file type
 * @param {string} fileType - Type of file
 * @returns {string|null} - Destination file path or null
 */
function getDestinationFile(fileType) {
  switch (fileType.toLowerCase()) {
    case 'medicines':
      return EMA_FILES.MEDICINES;
    case 'orphans':
      return EMA_FILES.ORPHANS;
    case 'dhpc':
      return EMA_FILES.DHPC;
    case 'psusa':
      return EMA_FILES.PSUSA;
    case 'referrals':
      return EMA_FILES.REFERRALS;
    case 'shortages':
      return EMA_FILES.SHORTAGES;
    default:
      return null;
  }
}

/**
 * Get expected headers for a file type
 * @param {string} fileType - Type of file
 * @returns {Array<string>} - Expected headers
 */
function getExpectedHeaders(fileType) {
  switch (fileType.toLowerCase()) {
    case 'medicines':
      return ['Medicine', 'Name', 'Status', 'Active substance', 'Therapeutic area'];
    case 'orphans':
      return ['Medicine name', 'Orphan designation', 'Status', 'Active substance', 'Intended use'];
    case 'dhpc':
      return ['DHPC', 'communication', 'Medicine', 'Publication date'];
    case 'psusa':
      return ['PSUSA', 'safety', 'Active substance', 'Procedure'];
    case 'referrals':
      return ['Referral', 'Status', 'Active substance'];
    case 'shortages':
      return ['Shortage', 'Medicine', 'Status', 'Reason'];
    default:
      return [];
  }
}

/**
 * Check and refresh EMA data
 * @returns {Promise<boolean>} - Success flag
 */
async function checkAndRefreshData() {
  try {
    // For now, just reinitialize field mappings
    await initializeFieldMappings();
    return true;
  } catch (error) {
    console.error('Error refreshing EMA data:', error);
    return false;
  }
}



function getValueForField(obj, fieldName) {
  // Direct field access
  if (obj[fieldName] !== undefined && obj[fieldName] !== null && obj[fieldName] !== '') {
    return obj[fieldName];
  }
  
  // Look for similar field names
  for (const key in obj) {
    // Skip internal properties
    if (key.startsWith('_similarity') || key.startsWith('_matchField') || key.startsWith('_directMatch')) {
      continue;
    }
    
    if (key.toLowerCase().includes(fieldName.toLowerCase())) {
      if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
        return obj[key];
      }
    }
  }
  
  // Check in original fields
  for (const key in obj) {
    if (key.startsWith('_original_')) {
      const originalKey = key.substring(10).toLowerCase();
      if (originalKey.includes(fieldName.toLowerCase()) || 
          fieldName.toLowerCase().includes(originalKey)) {
        return obj[key];
      }
    }
  }
  
  return null;
}

/**
 * Improved search for EMA condition data
 * @param {string} conditionName - Condition name to search for
 * @param {Object} options - Search options including threshold and years
 * @returns {Promise<Object>} - Search results for the condition
 */
async function searchEmaConditionData(conditionName, options = {}) {
  const { threshold = 0.7, yearsThreshold = null } = options;

  // Validate inputs
  if (!conditionName || typeof conditionName !== 'string') {
    return { error: 'Condition name is required and must be a string' };
  }
  
  try {
    // Initialize field mappings
    await initializeFieldMappings();
    
    // Normalize condition name
    const normalizedCondition = conditionName.toLowerCase().trim();
    
    // Results structure
    const results = {
      medicines: [],
      orphans: [],
      referrals: [],
      dhpc: [],
      psusa: [],
      shortages: []
    };
    
    // Date filtering helper
    const currentYear = new Date().getFullYear();
    const isRecent = (dateStr) => {
      if (!yearsThreshold || !dateStr) return true;
      const date = parseDate(dateStr);
      return date && (currentYear - date.getFullYear()) <= yearsThreshold;
    };
    
    // Search medicines data for the condition
    if (fs.existsSync(EMA_FILES.MEDICINES)) {
      // Read file content
      const fileContent = await fs.promises.readFile(EMA_FILES.MEDICINES, 'utf8');
      
      // Parse CSV
      const parsedData = Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true
      });
      
      // Find condition matches in therapeutic area or indication fields
      parsedData.data.forEach(record => {
        let conditionMatch = false;
        let matchField = '';
        let matchStrength = 0;
        
        // Fields that might contain condition information
        const conditionFields = [
          'Therapeutic area (MeSH)',
          'Therapeutic indication',
          'Therapeutic area',
          'Indication',
          'MeSH'
        ];
        
        // Check all fields - some may not be in our mapping but still have the data
        Object.entries(record).forEach(([field, value]) => {
          if (!value || typeof value !== 'string' || value.trim() === '') {
            return;
          }
          
          const normalizedValue = value.toLowerCase().trim();
          
          // Check if a condition-related field contains our search term
          const isConditionField = conditionFields.some(cf => 
            field.toLowerCase().includes(cf.toLowerCase())
          );
          
          // Prioritize condition fields but check all fields
          let fieldMultiplier = isConditionField ? 1.2 : 1;
          
          // Check for exact or partial matches
          if (normalizedValue === normalizedCondition) {
            matchStrength = 1 * fieldMultiplier;
            matchField = field;
            conditionMatch = true;
          } else if (normalizedValue.includes(normalizedCondition)) {
            const strength = 0.9 * fieldMultiplier;
            if (strength > matchStrength) {
              matchStrength = strength;
              matchField = field;
              conditionMatch = true;
            }
          } else {
            // Check similarity
            const similarity = calculateSimilarity(normalizedValue, normalizedCondition) * fieldMultiplier;
            if (similarity > matchStrength && similarity >= threshold) {
              matchStrength = similarity;
              matchField = field;
              conditionMatch = true;
            }
            
            // Also check individual words for multi-word conditions
            normalizedValue.split(/\s+/).forEach(word => {
              if (word.length < 4) return; // Skip very short words
              
              const wordSimilarity = calculateSimilarity(word, normalizedCondition) * fieldMultiplier;
              if (wordSimilarity > matchStrength && wordSimilarity >= threshold) {
                matchStrength = wordSimilarity;
                matchField = field;
                conditionMatch = true;
              }
            });
          }
        });
        
        // If we found a match above threshold
        if (conditionMatch && matchStrength >= threshold) {
          // Get date for time filtering
          let dateField = FIELD_MAPPINGS.MEDICINES.authorisation_date;
          let dateValue = dateField ? record[dateField] : null;
          
          // Try other date fields if main one doesn't exist
          if (!dateValue) {
            Object.entries(record).forEach(([field, value]) => {
              if (!dateValue && field.toLowerCase().includes('date') && value) {
                dateValue = value;
              }
            });
          }
          
          // Apply date filter if needed
          if (isRecent(dateValue)) {
            // Create a cleaned record with better field names
            const cleanedRecord = {
              _similarity: matchStrength,
              _matchField: matchField
            };
            
            // Map known fields
            if (FIELD_MAPPINGS.MEDICINES) {
              Object.entries(FIELD_MAPPINGS.MEDICINES).forEach(([mappedField, headerName]) => {
                if (headerName && headerName !== '_all_headers' && record[headerName] !== undefined) {
                  cleanedRecord[mappedField] = record[headerName];
                }
              });
            }
            
            // Add all original fields with a prefix
            Object.entries(record).forEach(([field, value]) => {
              if (value !== null && value !== undefined && value.trim() !== '') {
                cleanedRecord[`_original_${field}`] = value;
              }
            });
            
            // Add to results
            results.medicines.push(cleanedRecord);
          }
        }
      });
      
      // Sort by similarity
      results.medicines.sort((a, b) => b._similarity - a._similarity);
    }
    
    // Search orphans data for the condition
    if (fs.existsSync(EMA_FILES.ORPHANS)) {
      // Read file content
      const fileContent = await fs.promises.readFile(EMA_FILES.ORPHANS, 'utf8');
      
      // Parse CSV
      const parsedData = Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true
      });
      
      // Find condition matches in intended use or treatment fields
      parsedData.data.forEach(record => {
        let conditionMatch = false;
        let matchField = '';
        let matchStrength = 0;
        
        // Fields that might contain condition information
        const conditionFields = [
          'Intended use',
          'Treatment',
          'Condition'
        ];
        
        // Check all fields
        Object.entries(record).forEach(([field, value]) => {
          if (!value || typeof value !== 'string' || value.trim() === '') {
            return;
          }
          
          const normalizedValue = value.toLowerCase().trim();
          
          // Check if a condition-related field contains our search term
          const isConditionField = conditionFields.some(cf => 
            field.toLowerCase().includes(cf.toLowerCase())
          );
          
          // Prioritize condition fields but check all fields
          let fieldMultiplier = isConditionField ? 1.2 : 1;
          
          // Check for exact or partial matches
          if (normalizedValue === normalizedCondition) {
            matchStrength = 1 * fieldMultiplier;
            matchField = field;
            conditionMatch = true;
          } else if (normalizedValue.includes(normalizedCondition)) {
            const strength = 0.9 * fieldMultiplier;
            if (strength > matchStrength) {
              matchStrength = strength;
              matchField = field;
              conditionMatch = true;
            }
          } else {
            // Check similarity
            const similarity = calculateSimilarity(normalizedValue, normalizedCondition) * fieldMultiplier;
            if (similarity > matchStrength && similarity >= threshold) {
              matchStrength = similarity;
              matchField = field;
              conditionMatch = true;
            }
            
            // Also check individual words for multi-word conditions
            normalizedValue.split(/\s+/).forEach(word => {
              if (word.length < 4) return; // Skip very short words
              
              const wordSimilarity = calculateSimilarity(word, normalizedCondition) * fieldMultiplier;
              if (wordSimilarity > matchStrength && wordSimilarity >= threshold) {
                matchStrength = wordSimilarity;
                matchField = field;
                conditionMatch = true;
              }
            });
          }
        });
        
        // If we found a match above threshold
        if (conditionMatch && matchStrength >= threshold) {
          // Get date for time filtering
          let dateField = FIELD_MAPPINGS.ORPHANS.decision_date;
          let dateValue = dateField ? record[dateField] : null;
          
          // Try other date fields if main one doesn't exist
          if (!dateValue) {
            Object.entries(record).forEach(([field, value]) => {
              if (!dateValue && field.toLowerCase().includes('date') && value) {
                dateValue = value;
              }
            });
          }
          
          // Apply date filter if needed
          if (isRecent(dateValue)) {
            // Create a cleaned record with better field names
            const cleanedRecord = {
              _similarity: matchStrength,
              _matchField: matchField
            };
            
            // Map known fields
            if (FIELD_MAPPINGS.ORPHANS) {
              Object.entries(FIELD_MAPPINGS.ORPHANS).forEach(([mappedField, headerName]) => {
                if (headerName && headerName !== '_all_headers' && record[headerName] !== undefined) {
                  cleanedRecord[mappedField] = record[headerName];
                }
              });
            }
            
            // Add all original fields with a prefix
            Object.entries(record).forEach(([field, value]) => {
              if (value !== null && value !== undefined && value.trim() !== '') {
                cleanedRecord[`_original_${field}`] = value;
              }
            });
            
            // Add to results
            results.orphans.push(cleanedRecord);
          }
        }
      });
      
      // Sort by similarity
      results.orphans.sort((a, b) => b._similarity - a._similarity);
    }
    
    // For other file types, similar approach could be implemented
    
    // Return comprehensive results
    return {
      query: conditionName,
      queryNormalized: normalizedCondition,
      searchThreshold: threshold,
      yearsThreshold: yearsThreshold,
      results,
      total: {
        medicines: results.medicines.length,
        orphans: results.orphans.length,
        referrals: results.referrals.length,
        dhpc: results.dhpc.length,
        psusa: results.psusa.length,
        shortages: results.shortages.length,
        all: results.medicines.length + results.orphans.length + 
             results.referrals.length + results.dhpc.length + 
             results.psusa.length + results.shortages.length
      }
    };
  } catch (error) {
    console.error(`Error searching EMA condition data for ${conditionName}:`, error);
    return { 
      error: 'Error searching EMA condition data', 
      details: error.message,
      stack: error.stack
    };
  }
}
/**
 * Continuation of improved functions for handling EMA medicine and orphan data
 */

/**
 * Helper function to parse date strings with enhanced formats (continued)
 * @param {string} dateString - The date string to parse
 * @returns {Date|null} - Parsed date or null if invalid
 */
function parseDate(dateString) {
  if (!dateString || typeof dateString !== 'string') return null;
  dateString = dateString.trim();
  if (dateString === '') return null;
  
  // Try standard date parsing first
  let date = new Date(dateString);
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  // Define regex patterns for different date formats
  const formats = [
    // ISO format: YYYY-MM-DD
    {
      pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
      handler: (m) => new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]))
    },
    // European format: DD/MM/YYYY
    {
      pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
      handler: (m) => new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]))
    },
    // European with dashes: DD-MM-YYYY
    {
      pattern: /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
      handler: (m) => new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]))
    },
    // US format: MM/DD/YYYY
    {
      pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
      handler: (m) => new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]))
    },
    // Date with text month: DD Month YYYY or Month DD, YYYY
    {
      pattern: /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$|^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
      handler: (m) => {
        const months = {
          'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
          'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11,
          'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'jun': 5, 'jul': 6, 'aug': 7, 
          'sep': 8, 'sept': 8, 'oct': 9, 'nov': 10, 'dec': 11
        };
        
        if (m[2]) { // DD Month YYYY
          const month = months[m[2].toLowerCase()];
          if (month !== undefined) {
            return new Date(parseInt(m[3]), month, parseInt(m[1]));
          }
        } else { // Month DD, YYYY
          const month = months[m[4].toLowerCase()];
          if (month !== undefined) {
            return new Date(parseInt(m[6]), month, parseInt(m[5]));
          }
        }
        return null;
      }
    },
    // Year only: YYYY
    {
      pattern: /^(20\d{2})$/,
      handler: (m) => new Date(parseInt(m[1]), 0, 1)
    }
  ];
  
  // Try each format
  for (const format of formats) {
    const match = dateString.match(format.pattern);
    if (match) {
      date = format.handler(match);
      if (date && !isNaN(date.getTime())) {
        return date;
      }
    }
  }
  
  // Last resort - try to extract a year
  const yearMatch = dateString.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    return new Date(parseInt(yearMatch[1]), 0, 1);
  }
  
  return null;
}

async function initializeFieldMappings() {
  try {
    console.log('Initializing field mappings...');
    
    // Get field mappings for each file type with enhanced detection
    const medicinesMappings = await getFieldMappings(EMA_FILES.MEDICINES, 'MEDICINES');
    const orphansMappings = await getFieldMappings(EMA_FILES.ORPHANS, 'ORPHANS');
    const dhpcMappings = await getFieldMappings(EMA_FILES.DHPC, 'DHPC');
    const psusaMappings = await getFieldMappings(EMA_FILES.PSUSA, 'PSUSA');
    const referralsMappings = await getFieldMappings(EMA_FILES.REFERRALS, 'REFERRALS');
    const shortagesMappings = await getFieldMappings(EMA_FILES.SHORTAGES, 'SHORTAGES');
    
    // Update global field mappings
    if (medicinesMappings) {
      console.log('Medicine mappings:', medicinesMappings);
      FIELD_MAPPINGS.MEDICINES = medicinesMappings;
    }
    if (orphansMappings) {
      console.log('Orphan mappings:', orphansMappings);
      FIELD_MAPPINGS.ORPHANS = orphansMappings;
    }
    if (dhpcMappings) {
      console.log('DHPC mappings:', dhpcMappings);
      FIELD_MAPPINGS.DHPC = dhpcMappings;
    }
    if (psusaMappings) {
      console.log('PSUSA mappings:', psusaMappings);
      FIELD_MAPPINGS.PSUSA = psusaMappings;
    }
    if (referralsMappings) {
      console.log('Referrals mappings:', referralsMappings);
      FIELD_MAPPINGS.REFERRALS = referralsMappings;
    }
    if (shortagesMappings) {
      console.log('Shortages mappings:', shortagesMappings);
      FIELD_MAPPINGS.SHORTAGES = shortagesMappings;
    }
    
    console.log('Field mappings initialization complete');
  } catch (error) {
    console.error('Error initializing field mappings:', error);
  }
}

function extractRowData(row, fileType) {
  // Base extraction object
  const extracted = {
    raw: { ...row }, // Store the raw data
    normalized: {} // Store the normalized data
  };
  
  // Define patterns for common fields across all file types
  const commonPatterns = {
    url: ['url', 'medicine url', 'dhpc url', 'psusa url', 'referral url', 'shortage url', 'orphan designation url']
  };
  
  // Standard field extractors by file type
  const extractors = {
    MEDICINES: {
      name: (row) => extractByPatterns(row, ['name of medicine', 'medicine name', 'name', 'product']),
      status: (row) => extractByPatterns(row, ['medicine status', 'status']),
      therapeutic_area: (row) => extractByPatterns(row, ['therapeutic area', 'therapeutic area (mesh)', 'indication', 'mesh']),
      active_substance: (row) => extractByPatterns(row, ['active substance', 'inn', 'substance', 'international non-proprietary name (inn) / common name']),
      authorisation_date: (row) => formatDate(extractByPatterns(row, [
        'authorisation date', 'marketing authorisation date', 'decision date', 'european commission decision date'
      ])),
      therapeutic_indication: (row) => extractByPatterns(row, ['therapeutic indication', 'indication']),
      atc_code: (row) => extractByPatterns(row, ['atc code', 'atc', 'atc code (human)']),
      orphan_status: (row) => extractByPatterns(row, ['orphan', 'orphan medicine']),
      ema_number: (row) => extractByPatterns(row, ['ema product number', 'product number']),
      category: (row) => extractByPatterns(row, ['category']),
      additional_monitoring: (row) => extractByPatterns(row, ['additional monitoring']),
      url: (row) => extractByPatterns(row, commonPatterns.url)
    },
    ORPHANS: {
      name: (row) => extractByPatterns(row, ['medicine name', 'name', 'orphan designation', 'designation']),
      status: (row) => extractByPatterns(row, ['status']),
      intended_use: (row) => extractByPatterns(row, ['intended use', 'treatment', 'condition']),
      decision_date: (row) => formatDate(extractByPatterns(row, [
        'date of designation', 'designation date', 'decision date', 'date of designation / refusal'
      ])),
      eu_number: (row) => extractByPatterns(row, ['eu designation number', 'designation number']),
      active_substance: (row) => extractByPatterns(row, ['active substance', 'substance']),
      url: (row) => extractByPatterns(row, commonPatterns.url)
    },
    DHPC: {
      title: (row) => extractByPatterns(row, ['direct healthcare professional communication (dhpc)', 'dhpc type']),
      medicine: (row) => extractByPatterns(row, ['name of medicine', 'medicine']),
      reason: (row) => extractByPatterns(row, ['reason', 'dhpc type', 'regulatory outcome']),
      date: (row) => formatDate(extractByPatterns(row, ['publication date', 'dissemination date', 'first published date'])),
      active_substance: (row) => extractByPatterns(row, ['active substances', 'active substance']),
      url: (row) => extractByPatterns(row, commonPatterns.url)
    },
    PSUSA: {
      substance: (row) => extractByPatterns(row, ['active substance', 'active substances in scope of procedure']),
      procedure: (row) => extractByPatterns(row, ['procedure number', 'procedure']),
      outcome: (row) => extractByPatterns(row, ['regulatory outcome', 'outcome']),
      date: (row) => formatDate(extractByPatterns(row, ['first published date', 'last updated date'])),
      url: (row) => extractByPatterns(row, commonPatterns.url)
    },
    REFERRALS: {
      title: (row) => extractByPatterns(row, ['referral name', 'name']),
      substance: (row) => extractByPatterns(row, ['active substance', 'international non-proprietary name (inn) / common name']),
      type: (row) => extractByPatterns(row, ['referral type', 'type']),
      status: (row) => extractByPatterns(row, ['current status', 'status']),
      date: (row) => formatDate(extractByPatterns(row, ['procedure start date', 'first published date', 'last updated date'])),
      safety: (row) => extractByPatterns(row, ['safety referral?']),
      url: (row) => extractByPatterns(row, commonPatterns.url)
    },
    SHORTAGES: {
      title: (row) => extractByPatterns(row, ['medicine affected', 'shortage']),
      medicine: (row) => extractByPatterns(row, ['medicine affected', 'medicine']),
      reason: (row) => extractByPatterns(row, ['reason for shortage', 'reason']),
      status: (row) => extractByPatterns(row, ['supply shortage status', 'status']),
      date: (row) => formatDate(extractByPatterns(row, ['start of shortage date', 'first published date'])),
      expected_resolution: (row) => extractByPatterns(row, ['expected resolution', 'expected resolution date']),
      active_substance: (row) => extractByPatterns(row, ['international non-proprietary name (inn) or common name', 'active substance']),
      url: (row) => extractByPatterns(row, commonPatterns.url)
    }
  };
  
  // Apply extractors based on file type
  if (extractors[fileType]) {
    Object.entries(extractors[fileType]).forEach(([field, extractor]) => {
      const value = extractor(row);
      if (value !== null && value !== undefined && value !== '') {
        extracted.normalized[field] = value;
      }
    });
  }
  
  // Log missing critical fields for debugging
  if (fileType === 'MEDICINES' && !extracted.normalized.name) {
    console.warn('Missing critical field "name" in MEDICINES row:', row);
  } else if (fileType === 'ORPHANS' && !extracted.normalized.name) {
    console.warn('Missing critical field "name" in ORPHANS row:', row);
  }
  
  return extracted;
}

// Improved extract field by patterns function
function extractByPatterns(obj, possibleKeys) {
  if (!obj) return null;
  
  // Try exact match on keys
  for (const key of possibleKeys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      return obj[key];
    }
  }
  
  // Try case-insensitive match
  for (const key of possibleKeys) {
    const lowerKey = key.toLowerCase();
    for (const objKey in obj) {
      if (objKey.toLowerCase() === lowerKey && obj[objKey] !== undefined && obj[objKey] !== null && obj[objKey] !== '') {
        return obj[objKey];
      }
    }
  }
  
  // Try partial match (field contains key)
  for (const key of possibleKeys) {
    const lowerKey = key.toLowerCase();
    for (const objKey in obj) {
      if (objKey.toLowerCase().includes(lowerKey) && obj[objKey] !== undefined && obj[objKey] !== null && obj[objKey] !== '') {
        return obj[objKey];
      }
    }
    
    // Try reversed (key contains field)
    for (const objKey in obj) {
      const lowerObjKey = objKey.toLowerCase();
      if (lowerKey.includes(lowerObjKey) && obj[objKey] !== undefined && obj[objKey] !== null && obj[objKey] !== '') {
        return obj[objKey];
      }
    }
  }
  
  // Handle special case: Content in a numbered field (_1, _2, etc.)
  if (possibleKeys.includes('name') || possibleKeys.includes('title')) {
    for (const objKey in obj) {
      if (/^_\d+$/.test(objKey) && obj[objKey] !== undefined && obj[objKey] !== null && obj[objKey] !== '') {
        const numValue = parseInt(objKey.substring(1));
        if (numValue <= 3) { // Usually name/title is in the first few columns
          return obj[objKey];
        }
      }
    }
  }
  
  return null;
}

// Truncate text with ellipsis
function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  
  return text.substring(0, maxLength) + '...';
}

/**
 * Format a date string to ISO format
 * @param {string} dateString - Date string to format
 * @returns {string|null} - Formatted date or null if invalid
 */
function formatDate(dateString) {
  if (!dateString) return null;
  
  const date = parseDate(dateString);
  if (date) {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD
  }
  
  return dateString; // Return original if parsing failed
}

/**
 * Process a CSV file with enhanced error handling and data extraction
 * @param {string} filePath - Path to the CSV file
 * @param {string} fileType - Type of file (MEDICINES, ORPHANS, etc.)
 * @returns {Promise<Array>} - Processed data
 */
async function processCSVFile(filePath, fileType) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      console.log(`File not found: ${filePath}`);
      return resolve([]);
    }
    
    fs.readFile(filePath, 'utf8', (err, fileContent) => {
      if (err) {
        console.error(`Error reading ${filePath}:`, err);
        return reject(err);
      }
      
      try {
        console.log(`Processing ${fileType} file: ${filePath}`);
        
        // Clean the file content - remove BOM and normalize line endings
        const cleanContent = fileContent
          .replace(/^\uFEFF/, '') // Remove BOM
          .replace(/\r\n/g, '\n'); // Normalize line endings
        
        console.log(`File size: ${cleanContent.length} bytes`);
        
        // Get the first few lines to inspect
        const firstLines = cleanContent.split('\n').slice(0, 10).join('\n');
        console.log(`First few lines of file:\n${firstLines}`);
        
        // Parse with PapaParse for better handling
        const parseOptions = {
          header: true,
          skipEmptyLines: true,
          transformHeader: header => header ? header.trim() : '',
          // Additional transform function to clean empty strings and whitespace
          transform: function(value) {
            if (value === undefined || value === null) return '';
            value = value.toString().trim();
            return value === '' ? null : value;
          }
        };
        
        const parseResult = Papa.parse(cleanContent, parseOptions);
        
        if (parseResult.errors && parseResult.errors.length > 0) {
          console.warn(`Warnings when parsing ${filePath}:`, parseResult.errors);
        }
        
        console.log(`Parsed ${parseResult.data.length} rows from ${fileType} file`);
        
        // Log the first row to see the structure
        if (parseResult.data.length > 0) {
          console.log('Sample row:', JSON.stringify(parseResult.data[0], null, 2));
          console.log('Detected headers:', parseResult.meta.fields);
        }
        
        // Process each row with enhanced data extraction
        const processedData = parseResult.data
          .filter(row => Object.keys(row).length > 0) // Filter out empty rows
          .map(row => {
            const extracted = extractRowData(row, fileType);
            console.log(`Extracted ${Object.keys(extracted.normalized).length} fields for row`);
            return extracted;
          });
        
        console.log(`Successfully processed ${processedData.length} rows from ${fileType} file`);
        resolve(processedData);
      } catch (error) {
        console.error(`Error processing ${filePath}:`, error);
        reject(error);
      }
    });
  });
}

/**
 * Get comprehensive data for a specific medicine
 * @param {string} medicineName - Name of the medicine to look up
 * @returns {Promise<Object>} - Comprehensive data about the medicine
 */
// Get comprehensive data for a specific medicine
async function getMedicineData(medicineName) {
  if (!medicineName) {
    return { error: 'No medicine name provided' };
  }
  
  try {
    // First search for the medicine using the enhanced search function
    const searchResults = await searchEmaDrugData(medicineName, 0.8);
    
    if (searchResults.error) {
      return searchResults;
    }
    
    // If no results found, try a more relaxed search
    if (searchResults.total.all === 0) {
      console.log(`No exact matches found for "${medicineName}". Trying with relaxed threshold.`);
      const relaxedResults = await searchEmaDrugData(medicineName, 0.6);
      return {
        ...relaxedResults,
        note: 'No exact matches found, showing similar results with relaxed threshold'
      };
    }
    
    // Extract the best match
    let bestMatch = null;
    let bestMatchScore = 0;
    
    // First check medicines
    if (searchResults.results.medicines.length > 0) {
      bestMatch = {
        type: 'medicine',
        data: searchResults.results.medicines[0]
      };
      bestMatchScore = searchResults.results.medicines[0]._similarity;
      console.log(`Found best match in medicines: ${getValueForField(searchResults.results.medicines[0], 'name')} (score: ${bestMatchScore})`);
    }
    
    // Check orphans
    if (searchResults.results.orphans.length > 0) {
      const topOrphan = searchResults.results.orphans[0];
      if (!bestMatch || topOrphan._similarity > bestMatchScore) {
        bestMatch = {
          type: 'orphan',
          data: topOrphan
        };
        bestMatchScore = topOrphan._similarity;
        console.log(`Found best match in orphans: ${getValueForField(topOrphan, 'name')} (score: ${bestMatchScore})`);
      }
    }
    
    // If we found a good match, gather more comprehensive data
    if (bestMatch && bestMatchScore > 0.75) {
      console.log(`Processing best match (${bestMatch.type}) with score ${bestMatchScore}`);
      
      // Gather related information
      const medicineInfo = {
        name: medicineName,
        bestMatch: bestMatch,
        related: {
          dhpc: searchResults.results.dhpc,
          psusa: searchResults.results.psusa,
          shortages: searchResults.results.shortages,
          referrals: searchResults.results.referrals
        }
      };
      
      // Add additional fields from other datasets
      if (bestMatch.type === 'medicine') {
        // If we found a medicine, look for related orphan designations
        const orphanMatches = searchResults.results.orphans.filter(orphan => {
          // Try to match based on active substance
          const medicineSubstance = getValueForField(bestMatch.data, 'active_substance');
          const orphanSubstance = getValueForField(orphan, 'active_substance');
          
          if (medicineSubstance && orphanSubstance) {
            const similarity = calculateSimilarity(medicineSubstance, orphanSubstance);
            if (similarity > 0.8) {
              console.log(`Found related orphan designation based on substance similarity (${similarity})`);
              return true;
            }
          }
          return false;
        });
        
        medicineInfo.related.orphanDesignations = orphanMatches;
        console.log(`Found ${orphanMatches.length} related orphan designations`);
      } else if (bestMatch.type === 'orphan') {
        // If we found an orphan, look for related medicines
        const medicineMatches = searchResults.results.medicines.filter(medicine => {
          // Try to match based on active substance
          const orphanSubstance = getValueForField(bestMatch.data, 'active_substance');
          const medicineSubstance = getValueForField(medicine, 'active_substance');
          
          if (orphanSubstance && medicineSubstance) {
            const similarity = calculateSimilarity(orphanSubstance, medicineSubstance);
            if (similarity > 0.8) {
              console.log(`Found related medicine based on substance similarity (${similarity})`);
              return true;
            }
          }
          return false;
        });
        
        medicineInfo.related.medicines = medicineMatches;
        console.log(`Found ${medicineMatches.length} related medicines`);
      }
      
      // Add normalized data fields to each item
      if (medicineInfo.bestMatch && medicineInfo.bestMatch.data) {
        medicineInfo.bestMatch.data = normalizeDataFields(medicineInfo.bestMatch.data);
      }
      
      // Normalize related items
      for (const category in medicineInfo.related) {
        if (Array.isArray(medicineInfo.related[category])) {
          medicineInfo.related[category] = medicineInfo.related[category].map(
            item => normalizeDataFields(item)
          );
        }
      }
      
      return {
        query: medicineName,
        result: medicineInfo,
        matchQuality: bestMatchScore > 0.9 ? 'Excellent' : 
                     bestMatchScore > 0.8 ? 'Good' : 
                     bestMatchScore > 0.7 ? 'Fair' : 'Poor'
      };
    }
    
    // If no good match found, return all potential matches
    console.log(`No definitive match found for "${medicineName}", returning all potential matches`);
    return {
      query: medicineName,
      result: searchResults,
      note: 'No definitive match found, showing all potential matches'
    };
  } catch (error) {
    console.error(`Error getting data for medicine ${medicineName}:`, error);
    return { 
      error: 'Error retrieving medicine data', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
  }
}

/**
 * Helper function to normalize data fields for better display
 * @param {Object} item - Data item to normalize
 * @returns {Object} - Normalized data item
 */
function normalizeDataFields(item) {
  if (!item) return item;
  
  // Create a new normalized object
  const normalized = { ...item };
  
  // Define standard field names to extract if not already present
  const standardFields = {
    name: ['name', 'Name of medicine', 'Medicine name', '_1'],
    status: ['status', 'Medicine status', 'Status', '_3'],
    active_substance: ['active_substance', 'Active substance', '_6', '_7', '_2'],
    therapeutic_area: ['therapeutic_area', 'Therapeutic area (MeSH)', '_8', '_13'],
    therapeutic_indication: ['therapeutic_indication', 'Therapeutic indication', '_15', '_11'],
    atc_code: ['atc_code', 'ATC code (human)', '_12'],
    authorisation_date: ['authorisation_date', 'Marketing authorisation date', '_29', '_31', '_36', '_22'],
    ema_number: ['ema_number', 'EMA product number', '_2'],
    url: ['url', 'Medicine URL', '_34', '_38']
  };
  
  // Extract standard fields if not already present
  Object.entries(standardFields).forEach(([field, possibleSources]) => {
    if (!normalized[field]) {
      for (const source of possibleSources) {
        if (normalized[source]) {
          normalized[field] = normalized[source];
          break;
        }
        
        // Also check in _original_ fields
        const originalKey = `_original_${source}`;
        if (normalized[originalKey]) {
          normalized[field] = normalized[originalKey];
          break;
        }
      }
    }
  });
  
  // Special handling for URLs - ensure they are valid
  if (normalized.url) {
    if (!normalized.url.startsWith('http')) {
      normalized.url = `https://${normalized.url}`;
    }
  } else {
    // Look for any field that might contain a URL
    Object.entries(normalized).forEach(([key, value]) => {
      if (typeof value === 'string' && 
          (value.includes('ema.europa.eu') || value.includes('www.')) && 
          !normalized.url) {
        normalized.url = value.startsWith('http') ? value : `https://${value}`;
      }
    });
  }
  
  // Extract information from _original_ fields with better naming
  Object.keys(normalized).forEach(key => {
    if (key.startsWith('_original_')) {
      const fieldName = key.substring(10).toLowerCase()
        .replace(/[\s:-]+/g, '_')
        .replace(/^_+|_+$/g, '');
      
      if (!fieldName.match(/^\d+$/) && !normalized[fieldName]) {
        normalized[fieldName] = normalized[key];
      }
    }
  });
  
  return normalized;
}



/**
 * Advanced function to find medicines for a specific condition
 * @param {string} conditionName - Name of the condition to search for
 * @param {Object} options - Search options
 * @returns {Promise<Object>} - Medicines and treatments for the condition
 */
async function findMedicinesForCondition(conditionName, options = {}) {
  const { threshold = 0.7, yearsThreshold = null, includeRelated = false } = options;

  if (!conditionName) {
    return { error: 'No condition name provided' };
  }
  
  try {
    // Search for the condition in EMA data with improved normalization
    const conditionResults = await searchEmaConditionData(conditionName, {
      threshold,
      yearsThreshold
    });
    
    if (conditionResults.error) {
      return conditionResults;
    }
    
    // Organize medicines by therapeutic area/indication
    const organizedResults = {
      directMatches: [],
      relatedConditions: {}
    };
    
    // Process medicines results
    conditionResults.results.medicines.forEach(medicine => {
      // Get the therapeutic area or indication
      const area = getValueForField(medicine, 'therapeutic_area') || 'Unknown';
      
      // Normalize the area name
      const areaKey = area.toLowerCase();
      
      // Check if this is a direct match to our condition
      if (calculateSimilarity(areaKey, conditionName.toLowerCase()) > 0.85) {
        organizedResults.directMatches.push(medicine);
      } else {
        // Add to related conditions
        if (includeRelated) {
          if (!organizedResults.relatedConditions[area]) {
            organizedResults.relatedConditions[area] = [];
          }
          organizedResults.relatedConditions[area].push(medicine);
        }
      }
    });
    
    // Process orphan results similarly
    conditionResults.results.orphans.forEach(orphan => {
      // Get the intended use/condition
      const condition = getValueForField(orphan, 'intended_use') || 'Unknown';
      
      // Normalize the condition name
      const conditionKey = condition.toLowerCase();
      
      // Check if this is a direct match to our condition
      if (calculateSimilarity(conditionKey, conditionName.toLowerCase()) > 0.85) {
        organizedResults.directMatches.push(orphan);
      } else {
        // Add to related conditions
        if (includeRelated) {
          if (!organizedResults.relatedConditions[condition]) {
            organizedResults.relatedConditions[condition] = [];
          }
          organizedResults.relatedConditions[condition].push(orphan);
        }
      }
    });
    
    // Sort direct matches by authorization date (newest first)
    organizedResults.directMatches.sort((a, b) => {
      const dateA = getValueForField(a, 'authorisation_date') || getValueForField(a, 'decision_date') || '';
      const dateB = getValueForField(b, 'authorisation_date') || getValueForField(b, 'decision_date') || '';
      return dateB.localeCompare(dateA);
    });
    
    // For each related condition, sort by date as well
    if (includeRelated) {
      Object.keys(organizedResults.relatedConditions).forEach(condition => {
        organizedResults.relatedConditions[condition].sort((a, b) => {
          const dateA = getValueForField(a, 'authorisation_date') || getValueForField(a, 'decision_date') || '';
          const dateB = getValueForField(b, 'authorisation_date') || getValueForField(b, 'decision_date') || '';
          return dateB.localeCompare(dateA);
        });
      });
    }
    
    return {
      query: conditionName,
      results: organizedResults,
      total: {
        directMatches: organizedResults.directMatches.length,
        relatedConditions: Object.keys(organizedResults.relatedConditions).length,
        allRelatedMedicines: Object.values(organizedResults.relatedConditions)
          .reduce((sum, medicines) => sum + medicines.length, 0)
      }
    };
  } catch (error) {
    console.error(`Error finding medicines for condition ${conditionName}:`, error);
    return { 
      error: 'Error searching for condition treatments', 
      details: error.message 
    };
  }
}

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Distance score
 */
function levenshteinDistance(a, b) {
  if (!a || !b) return a ? a.length : b ? b.length : 0;
  
  const matrix = [];

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score between two strings (0-1)
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Similarity score (higher is more similar)
 */
function calculateSimilarity(a, b) {
  if (!a || !b) return 0;
  
  // Convert to lowercase for comparison
  const str1 = a.toLowerCase().trim();
  const str2 = b.toLowerCase().trim();
  
  // Exact match
  if (str1 === str2) return 1;
  
  // Check if exact drug name is a substring match
  // For example, "ketamine hydrochloride" contains "ketamine"
  if (str1.includes(str2) && (
      str1.startsWith(str2 + ' ') || 
      str1.includes(' ' + str2 + ' ') || 
      str1.endsWith(' ' + str2)
     )) {
    return 0.95;
  }
  
  if (str2.includes(str1) && (
      str2.startsWith(str1 + ' ') || 
      str2.includes(' ' + str1 + ' ') || 
      str2.endsWith(' ' + str1)
     )) {
    return 0.9;
  }
  
  // For very short strings, be more strict
  if (str1.length < 4 || str2.length < 4) {
    // For short terms, they should be very similar to match
    const distance = levenshteinDistance(str1, str2);
    if (distance > 1) return 0; // Only allow 1 character difference for short terms
    return 0.85;
  }
  
  // Check first few characters as a strong signal
  // Many drug names share the same prefix - this is important
  const prefixLength = Math.min(4, Math.floor(str1.length / 2), Math.floor(str2.length / 2));
  if (str1.substring(0, prefixLength) !== str2.substring(0, prefixLength)) {
    // If the first few characters don't match at all, reduce similarity significantly
    // This helps prevent "ketamine" from matching "caffeine" just because they share the suffix
    return 0.2; 
  }
  
  // Calculate Levenshtein distance
  const distance = levenshteinDistance(str1, str2);
  
  // For drug names, be more strict about distance
  if (distance > Math.min(str1.length, str2.length) / 2) {
    return 0.3; // Too many changes needed, probably different drugs
  }
  
  // Convert distance to similarity score with more emphasis on closeness
  const maxLength = Math.max(str1.length, str2.length);
  let similarity = 1 - (distance / maxLength);
  
  // Boost similarity if they share significant beginning parts
  const sharedPrefixLength = getSharedPrefixLength(str1, str2);
  if (sharedPrefixLength >= 4) {
    similarity += 0.1; // Boost score for names sharing significant prefix
  }
  
  return Math.min(similarity, 1); // Cap at 1
}

/**
 * Get the length of the shared prefix between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Length of shared prefix
 */
function getSharedPrefixLength(a, b) {
  let i = 0;
  const minLength = Math.min(a.length, b.length);
  
  while (i < minLength && a[i] === b[i]) {
    i++;
  }
  
  return i;
}

function getEmaDataStatus(){
  return true
}


// Add to ema-processor.js
async function generateAISummary(drugName, data) {
  try {
    console.log(`Generating AI summary for ${drugName}`);
    
    if (!data || !data.results) {
      console.error('Invalid data for AI summary');
      return { error: 'Invalid data provided for AI summary' };
    }
    
    // Extract relevant data for the summary
    const medicines = data.results.medicines || [];
    const orphans = data.results.orphans || [];
    const dhpc = data.results.dhpc || [];
    const psusa = data.results.psusa || [];
    const shortages = data.results.shortages || [];
    const referrals = data.results.referrals || [];
    
    // Create summary context
    const context = {
      drugName,
      medicinesCount: medicines.length,
      orphansCount: orphans.length,
      dhpcCount: dhpc.length,
      psusaCount: psusa.length,
      shortagesCount: shortages.length,
      referralsCount: referrals.length,
      
      // Extract key details from medicines
      medicines: medicines.map(med => ({
        name: findField(med, ['name', 'Name of medicine', '_1']) || 'Unknown',
        status: findField(med, ['status', 'Medicine status', '_3']) || 'Unknown',
        substance: findField(med, ['active_substance', 'Active substance', '_6', '_7']) || 'Not specified',
        therapeuticArea: findField(med, ['therapeutic_area', 'Therapeutic area (MeSH)', '_8', '_13']) || 'Not specified',
        indication: findField(med, ['therapeutic_indication', 'Therapeutic indication', '_15']) || 'Not specified',
        authorisationDate: findField(med, ['authorisation_date', '_enhancedAuthDate', 'Marketing authorisation date', '_29', '_31', '_36']) || 'Unknown'
      })),
      
      // Extract key details from other data types
      orphans: orphans.map(o => ({
        name: findField(o, ['name', 'Medicine name', '_1', 'Orphan designation']) || 'Unknown',
        substance: findField(o, ['active_substance', 'Active substance', '_2']) || 'Not specified',
        condition: findField(o, ['intended_use', '_enhancedIntendedUse', 'Intended use', '_3']) || 'Not specified',
        status: findField(o, ['status', 'Status', '_4', '_5']) || 'Unknown'
      })),
      
      safetyIssues: dhpc.map(s => ({
        title: findField(s, ['title', 'Direct healthcare professional communication (DHPC)', '_1', '_2']) || 'Unknown',
        date: findField(s, ['date', '_5', '_6']) || 'Unknown',
        reason: findField(s, ['reason', '_7', '_8']) || 'Not specified'
      })),
      
      shortages: shortages.map(s => ({
        medicine: findField(s, ['medicine', 'Medicine affected', '_1']) || 'Unknown',
        status: findField(s, ['status', 'Supply shortage status', '_6', '_7']) || 'Unknown',
        reason: findField(s, ['reason', '_4', '_5']) || 'Not specified',
        expected: findField(s, ['expected_resolution', 'Expected resolution', '_10']) || 'Unknown'
      }))
    };
    
    console.log('Context prepared for AI summary');
    
    // Generate summary using AI service (mock implementation for now)
    // In a real implementation, you would call an AI service API
    // For this example, we'll generate a structured summary based on the context
    
    const summary = generateStructuredSummary(context);
    console.log('AI summary generated successfully');
    
    return {
      summary,
      context,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error generating AI summary:', error);
    return { 
      error: 'Error generating AI summary', 
      details: error.message 
    };
  }
}
function generateStructuredSummary(context) {
  const { drugName, medicines, orphans, safetyIssues, shortages } = context;
  
  // Format date for the summary
  const currentDate = new Date();
  const formattedDate = currentDate.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
  
  let summaryHtml = `
    <div class="prose max-w-none">
      <h2 class="text-2xl font-bold mb-4">EMA Data Summary for ${drugName}</h2>
      <p class="text-sm text-gray-500 mb-6">This summary was generated on ${formattedDate} based on data from the European Medicines Agency.</p>
  `;
  
  // Add overview section
  summaryHtml += `
      <h3 class="text-xl font-semibold mt-6 mb-3">Overview</h3>
      <p>
        The European Medicines Agency (EMA) database contains 
        <span class="font-medium">${medicines.length} authorised medicine${medicines.length !== 1 ? 's' : ''}</span> and 
        <span class="font-medium">${orphans.length} orphan designation${orphans.length !== 1 ? 's' : ''}</span> 
        related to <span class="font-medium">${drugName}</span>.
        ${safetyIssues.length > 0 ? `There ${safetyIssues.length === 1 ? 'is' : 'are'} <span class="font-medium">${safetyIssues.length} safety communication${safetyIssues.length !== 1 ? 's' : ''}</span>.` : ''}
        ${shortages.length > 0 ? `There ${shortages.length === 1 ? 'is' : 'are'} <span class="font-medium">${shortages.length} reported shortage${shortages.length !== 1 ? 's' : ''}</span>.` : ''}
      </p>
  `;
  
  // Add medicine details if available
  if (medicines.length > 0) {
    summaryHtml += `
      <h3 class="text-xl font-semibold mt-6 mb-3">Authorised Medicines</h3>
      <div class="space-y-4">
    `;
    
    // Get unique therapeutic areas
    const allTherapeuticAreas = medicines
      .map(med => med.therapeuticArea)
      .filter(area => area && area !== 'Not specified')
      .join(';')
      .split(/[;,]/)
      .map(area => area.trim())
      .filter(area => area);
    
    const uniqueTherapeuticAreas = [...new Set(allTherapeuticAreas)];
    
    if (uniqueTherapeuticAreas.length > 0) {
      summaryHtml += `
        <p>
          <span class="font-medium">${drugName}</span> is approved for use in the following therapeutic areas:
        </p>
        <ul class="list-disc pl-6 mb-4">
          ${uniqueTherapeuticAreas.map(area => `<li>${area}</li>`).join('')}
        </ul>
      `;
    }
    
    // Add the most recent medicine details
    const sortedMedicines = [...medicines].sort((a, b) => {
      const dateA = a.authorisationDate || '';
      const dateB = b.authorisationDate || '';
      return dateB.localeCompare(dateA);
    });
    
    if (sortedMedicines.length > 0) {
      const recentMedicine = sortedMedicines[0];
      summaryHtml += `
        <p>
          The most recent authorisation for ${drugName} is <span class="font-medium">${recentMedicine.name}</span>, 
          which received ${recentMedicine.status.toLowerCase()} on ${formatDateForSummary(recentMedicine.authorisationDate)}.
          ${recentMedicine.indication && recentMedicine.indication !== 'Not specified' 
            ? `Its therapeutic indication is: <span class="italic">${truncateText(recentMedicine.indication, 300)}</span>` 
            : ''}
        </p>
      `;
    }
    
    summaryHtml += `</div>`;
  }
  
  // Add orphan designation details if available
  if (orphans.length > 0) {
    summaryHtml += `
      <h3 class="text-xl font-semibold mt-6 mb-3">Orphan Designations</h3>
      <div class="space-y-4">
    `;
    
    // Get unique conditions
    const allConditions = orphans
      .map(o => o.condition)
      .filter(condition => condition && condition !== 'Not specified')
      .join(';')
      .split(/[;,]/)
      .map(condition => condition.trim())
      .filter(condition => condition);
    
    const uniqueConditions = [...new Set(allConditions)];
    
    if (uniqueConditions.length > 0) {
      summaryHtml += `
        <p>
          <span class="font-medium">${drugName}</span> has orphan designation(s) for:
        </p>
        <ul class="list-disc pl-6 mb-4">
          ${uniqueConditions.map(condition => `<li>${condition}</li>`).join('')}
        </ul>
      `;
    }
    
    summaryHtml += `</div>`;
  }
  
  // Add safety issues if available
  if (safetyIssues.length > 0) {
    summaryHtml += `
      <h3 class="text-xl font-semibold mt-6 mb-3">Safety Concerns</h3>
      <div class="space-y-4">
        <p>There ${safetyIssues.length === 1 ? 'has been one safety communication' : `have been ${safetyIssues.length} safety communications`} related to ${drugName}:</p>
        <ul class="list-disc pl-6 mb-4">
          ${safetyIssues.map(issue => 
            `<li><span class="font-medium">${formatDateForSummary(issue.date)}</span>: ${issue.title}${issue.reason ? ` - ${issue.reason}` : ''}</li>`
          ).join('')}
        </ul>
      </div>
    `;
  }
  
  // Add shortage information if available
  if (shortages.length > 0) {
    summaryHtml += `
      <h3 class="text-xl font-semibold mt-6 mb-3">Supply Shortages</h3>
      <div class="space-y-4">
        <p>There ${shortages.length === 1 ? 'is one reported shortage' : `are ${shortages.length} reported shortages`} for ${drugName}:</p>
        <ul class="list-disc pl-6 mb-4">
          ${shortages.map(shortage => 
            `<li><span class="font-medium">${shortage.medicine}</span> - Status: ${shortage.status}${shortage.expected ? `, Expected resolution: ${shortage.expected}` : ''}${shortage.reason ? ` - Reason: ${shortage.reason}` : ''}</li>`
          ).join('')}
        </ul>
      </div>
    `;
  }
  
  // Add conclusion and disclaimer
  summaryHtml += `
      <h3 class="text-xl font-semibold mt-6 mb-3">Conclusions</h3>
      <p>
        ${drugName} ${medicines.length > 0 ? `is an authorized medicine ${orphans.length > 0 ? 'with orphan designation(s) ' : ''}` : orphans.length > 0 ? 'has orphan designation(s) ' : 'appears in the EMA database '}
        for ${uniqueConditions().length > 0 ? uniqueConditions().join(', ') : uniqueTherapeuticAreas().length > 0 ? uniqueTherapeuticAreas().join(', ') : 'various medical conditions'}.
        ${safetyIssues.length > 0 ? `Healthcare professionals should be aware of the ${safetyIssues.length} safety communication(s) related to this medicine.` : ''}
        ${shortages.length > 0 ? `There ${shortages.length === 1 ? 'is' : 'are'} currently ${shortages.length} supply shortage(s) that may affect availability.` : ''}
      </p>
      
      <div class="mt-8 pt-4 border-t border-gray-200 text-sm text-gray-500">
        <p>Disclaimer: This summary is generated automatically based on data from the European Medicines Agency (EMA). 
        For complete and up-to-date information, please refer to the official EMA website.</p>
      </div>
    </div>
  `;
  
  return summaryHtml;
  
  // Helper functions for the summary
  function uniqueTherapeuticAreas() {
    const areas = medicines
      .map(med => med.therapeuticArea)
      .filter(area => area && area !== 'Not specified')
      .join(';')
      .split(/[;,]/)
      .map(area => area.trim())
      .filter(area => area);
    
    return [...new Set(areas)];
  }
  
  function uniqueConditions() {
    const conditions = orphans
      .map(o => o.condition)
      .filter(condition => condition && condition !== 'Not specified')
      .join(';')
      .split(/[;,]/)
      .map(condition => condition.trim())
      .filter(condition => condition);
    
    return [...new Set(conditions)];
  }
}

// Helper function to format date specifically for the summary
function formatDateForSummary(dateString) {
  if (!dateString || dateString === 'Unknown') return 'Unknown date';
  
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return dateString; // Return the original string if it's not a valid date
    }
    
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  } catch (error) {
    return dateString;
  }
}

// Helper function for extracting a field value from an object
function findField(obj, possibleKeys) {
  if (!obj) return null;
  
  // First try direct match
  for (const key of possibleKeys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      return obj[key];
    }
  }
  
  // Try case-insensitive match
  for (const key of possibleKeys) {
    const lowerKey = key.toLowerCase();
    for (const objKey in obj) {
      if (objKey.toLowerCase() === lowerKey && obj[objKey] !== undefined && obj[objKey] !== null && obj[objKey] !== '') {
        return obj[objKey];
      }
    }
  }
  
  // Try partial match
  for (const key of possibleKeys) {
    const lowerKey = key.toLowerCase();
    for (const objKey in obj) {
      if (objKey.toLowerCase().includes(lowerKey) && obj[objKey] !== undefined && obj[objKey] !== null && obj[objKey] !== '') {
        return obj[objKey];
      }
    }
  }
  
  return null;
}


// Export all functions
module.exports = {
  generateAISummary,
  searchEmaDrugData,
  searchEmaConditionData,
  getEmaDataStatus,
  initializeFieldMappings,
  getMedicineData,
  findMedicinesForCondition,
  processCSVFile,
  extractRowData,
  parseDate,
  calculateSimilarity
};


// /**
//  * Get actual field names from the CSV headers
//  * @param {string} filePath - Path to the CSV file
//  * @returns {Promise<Object>} - Object with field mappings
//  */
// async function getFieldMappings(filePath, fileType) {
//   return new Promise((resolve, reject) => {
//     if (!fs.existsSync(filePath)) {
//       return resolve(null);
//     }

//     const parser = fs.createReadStream(filePath)
//       .pipe(csv())
//       .on('headers', (headers) => {
//         parser.destroy(); // Stop after getting headers
        
//         let mappings = {...FIELD_MAPPINGS[fileType]};
        
//         // Map fields based on header content
//         headers.forEach(header => {
//           if (!header) return;
          
//           const lowerHeader = header.toLowerCase();
          
//           // Map specific fields based on the file type
//           switch (fileType) {
//             case 'MEDICINES':
//               if (lowerHeader.includes('status')) mappings.status = header;
//               if (lowerHeader.includes('therapeutic') || lowerHeader.includes('area')) mappings.therapeutic_area = header;
//               if (lowerHeader.includes('substance')) mappings.active_substance = header;
//               if (lowerHeader.includes('authorisation') || lowerHeader.includes('date')) mappings.authorisation_date = header;
//               break;
//             case 'ORPHANS':
//               if (lowerHeader.includes('condition')) mappings.condition = header;
//               if (lowerHeader.includes('status')) mappings.status = header;
//               if (lowerHeader.includes('date')) mappings.decision_date = header;
//               if (lowerHeader.includes('sponsor')) mappings.sponsor = header;
//               break;
//             case 'DHPC':
//               if (lowerHeader.includes('reason')) mappings.reason = header;
//               if (lowerHeader.includes('medicine')) mappings.medicine = header;
//               if (lowerHeader.includes('date')) mappings.date = header;
//               break;
//             case 'PSUSA':
//               if (lowerHeader.includes('procedure')) mappings.procedure = header;
//               if (lowerHeader.includes('outcome')) mappings.outcome = header;
//               if (lowerHeader.includes('date')) mappings.date = header;
//               break;
//             case 'REFERRALS':
//               if (lowerHeader.includes('substance')) mappings.substance = header;
//               if (lowerHeader.includes('type')) mappings.type = header;
//               if (lowerHeader.includes('status')) mappings.status = header;
//               if (lowerHeader.includes('date')) mappings.date = header;
//               break;
//             case 'SHORTAGES':
//               if (lowerHeader.includes('medicine')) mappings.medicine = header;
//               if (lowerHeader.includes('reason')) mappings.reason = header;
//               if (lowerHeader.includes('date')) mappings.date = header;
//               if (lowerHeader.includes('status')) mappings.status = header;
//               break;
//           }
//         });
        
//         resolve(mappings);
//       })
//       .on('error', (err) => {
//         reject(err);
//       });
//   });
// }

// /**
//  * Initialize field mappings for all files
//  */
// async function initializeFieldMappings() {
//   try {
//     // Get field mappings for each file type
//     const medicinesMappings = await getFieldMappings(EMA_FILES.MEDICINES, 'MEDICINES');
//     const orphansMappings = await getFieldMappings(EMA_FILES.ORPHANS, 'ORPHANS');
//     const dhpcMappings = await getFieldMappings(EMA_FILES.DHPC, 'DHPC');
//     const psusaMappings = await getFieldMappings(EMA_FILES.PSUSA, 'PSUSA');
//     const referralsMappings = await getFieldMappings(EMA_FILES.REFERRALS, 'REFERRALS');
//     const shortagesMappings = await getFieldMappings(EMA_FILES.SHORTAGES, 'SHORTAGES');
    
//     // Update global field mappings
//     if (medicinesMappings) FIELD_MAPPINGS.MEDICINES = medicinesMappings;
//     if (orphansMappings) FIELD_MAPPINGS.ORPHANS = orphansMappings;
//     if (dhpcMappings) FIELD_MAPPINGS.DHPC = dhpcMappings;
//     if (psusaMappings) FIELD_MAPPINGS.PSUSA = psusaMappings;
//     if (referralsMappings) FIELD_MAPPINGS.REFERRALS = referralsMappings;
//     if (shortagesMappings) FIELD_MAPPINGS.SHORTAGES = shortagesMappings;
    
//     console.log('Field mappings initialized:', FIELD_MAPPINGS);
//   } catch (error) {
//     console.error('Error initializing field mappings:', error);
//   }
// }


// /**
//  * Search EMA data for drugs associated with a specific condition
//  * @param {string} conditionName - The clinical condition to search for (e.g., "Major Depressive Disorder")
//  * @param {Object} options - Search options
//  * @param {number} options.threshold - Fuzzy matching threshold (0 to 1, default: 0.7)
//  * @param {number|null} options.yearsThreshold - Filter results to last X years (optional)
//  * @returns {Object} - Results with categorized data and totals
//  */
// async function searchEmaConditionData(conditionName, options = {}) {
//   const { threshold = 0.7, yearsThreshold = null } = options;

//   // Validate inputs
//   if (!conditionName || typeof conditionName !== 'string') {
//     throw new Error('Condition name is required and must be a string');
//   }
//   if (threshold < 0 || threshold > 1) {
//     throw new Error('Threshold must be between 0 and 1');
//   }
//   if (yearsThreshold !== null && (yearsThreshold < 1 || yearsThreshold > 20)) {
//     throw new Error('Years threshold must be between 1 and 20');
//   }

//   // Initialize results structure
//   const results = {
//     medicines: [],
//     orphans: [],
//     dhpc: [],
//     psusa: [],
//     shortages: [],
//     referrals: []
//   };
//   const total = {
//     medicines: 0,
//     orphans: 0,
//     dhpc: 0,
//     psusa: 0,
//     shortages: 0,
//     referrals: 0
//   };

//   // Date filtering helper
//   const currentYear = new Date().getFullYear();
//   const isRecent = (dateStr) => {
//     if (!yearsThreshold || !dateStr) return true;
//     const date = new Date(dateStr);
//     return !isNaN(date.getTime()) && (currentYear - date.getFullYear()) <= yearsThreshold;
//   };

//   // Fuzzy matching setup
//   const fuzzySet = new FuzzySet();
//   const conditionLower = conditionName.toLowerCase();

//   // Search Medicines (therapeutic area, indication)
//   this.data.medicines.forEach(item => {
//     const therapeuticArea = (item._8 || item._13 || '').toLowerCase();
//     const indication = (item._15 || '').toLowerCase();
//     const text = `${therapeuticArea} ${indication}`.trim();
    
//     if (text) {
//       fuzzySet.add(text);
//       const match = fuzzySet.get(conditionLower, null, threshold);
//       if (match && match[0][0] >= threshold) {
//         const authDate = item._29 || item._31 || item._36;
//         if (isRecent(authDate)) {
//           results.medicines.push(item);
//         }
//       }
//     }
//   });
//   total.medicines = results.medicines.length;

//   // Search Orphans (condition field)
//   this.data.orphans.forEach(item => {
//     const orphanCondition = (item._2 || item._3 || '').toLowerCase();
    
//     if (orphanCondition) {
//       fuzzySet.add(orphanCondition);
//       const match = fuzzySet.get(conditionLower, null, threshold);
//       if (match && match[0][0] >= threshold) {
//         const decisionDate = item._6 || item._7;
//         if (isRecent(decisionDate)) {
//           results.orphans.push(item);
//         }
//       }
//     }
//   });
//   total.orphans = results.orphans.length;

//   // Search DHPC (medicine name, reason)
//   this.data.dhpc.forEach(item => {
//     const title = (item['Direct healthcare professional communication (DHPC)'] || item._1 || item._2 || '').toLowerCase();
//     const medicine = (item._3 || item._4 || '').toLowerCase();
//     const reason = (item._7 || item._8 || '').toLowerCase();
//     const text = `${title} ${medicine} ${reason}`.trim();
    
//     if (text) {
//       fuzzySet.add(text);
//       const match = fuzzySet.get(conditionLower, null, threshold);
//       if (match && match[0][0] >= threshold) {
//         const date = item._5 || item._6;
//         if (isRecent(date)) {
//           results.dhpc.push(item);
//         }
//       }
//     }
//   });
//   total.dhpc = results.dhpc.length;

//   // Search PSUSA (substance, procedure)
//   this.data.psusa.forEach(item => {
//     const substance = (item['Periodic safety update report single assessments (PSUSA)'] || item._1 || item._2 || '').toLowerCase();
//     const procedure = (item._4 || '').toLowerCase();
//     const text = `${substance} ${procedure}`.trim();
    
//     if (text) {
//       fuzzySet.add(text);
//       const match = fuzzySet.get(conditionLower, null, threshold);
//       if (match && match[0][0] >= threshold) {
//         const date = item._6;
//         if (isRecent(date)) {
//           results.psusa.push(item);
//         }
//       }
//     }
//   });
//   total.psusa = results.psusa.length;

//   // Search Shortages (medicine, reason)
//   this.data.shortages.forEach(item => {
//     const medicine = (item.Shortage || item._1 || '').toLowerCase();
//     const reason = (item._4 || item._5 || '').toLowerCase();
//     const text = `${medicine} ${reason}`.trim();
    
//     if (text) {
//       fuzzySet.add(text);
//       const match = fuzzySet.get(conditionLower, null, threshold);
//       if (match && match[0][0] >= threshold) {
//         const date = item._8 || item._9;
//         if (isRecent(date)) {
//           results.shortages.push(item);
//         }
//       }
//     }
//   });
//   total.shortages = results.shortages.length;

//   // Search Referrals (medicine, substance)
//   this.data.referrals.forEach(item => {
//     const medicine = (item._1 || '').toLowerCase();
//     const substance = (item._2 || '').toLowerCase();
//     const text = `${medicine} ${substance}`.trim();
    
//     if (text) {
//       fuzzySet.add(text);
//       const match = fuzzySet.get(conditionLower, null, threshold);
//       if (match && match[0][0] >= threshold) {
//         const date = item._17 || item._18 || item._19;
//         if (isRecent(date)) {
//           results.referrals.push(item);
//         }
//       }
//     }
//   });
//   total.referrals = results.referrals.length;

//   return { results, total };
// }
// // /**
// //  * Search EMA data for a specific drug name
// //  * @param {string} drugName - Drug name to search for
// //  * @returns {Promise<Object>} - Search results
// //  */
// // async function searchEmaDrugData(drugName) {
// //   if (!drugName) {
// //     return { error: 'No drug name provided' };
// //   }
  
// //   // Initialize field mappings if not already done
// //   await initializeFieldMappings();
  
// //   // Normalize drug name for search
// //   const normalizedDrugName = drugName.toLowerCase().trim();
  
// //   try {
// //     // Search results
// //     const results = {
// //       medicines: [],
// //       orphans: [],
// //       referrals: [],
// //       dhpc: [],
// //       psusa: [],
// //       shortages: []
// //     };
    
// //     // Search in medicines data
// //     if (fs.existsSync(EMA_FILES.MEDICINES)) {
// //       results.medicines = await searchCsvFile(EMA_FILES.MEDICINES, normalizedDrugName);
// //     }
    
// //     // Search in orphans data
// //     if (fs.existsSync(EMA_FILES.ORPHANS)) {
// //       results.orphans = await searchCsvFile(EMA_FILES.ORPHANS, normalizedDrugName);
// //     }
    
// //     // Search in referrals data
// //     if (fs.existsSync(EMA_FILES.REFERRALS)) {
// //       results.referrals = await searchCsvFile(EMA_FILES.REFERRALS, normalizedDrugName);
// //     }
    
// //     // Search in DHPC data
// //     if (fs.existsSync(EMA_FILES.DHPC)) {
// //       results.dhpc = await searchCsvFile(EMA_FILES.DHPC, normalizedDrugName);
// //     }
    
// //     // Search in PSUSA data
// //     if (fs.existsSync(EMA_FILES.PSUSA)) {
// //       results.psusa = await searchCsvFile(EMA_FILES.PSUSA, normalizedDrugName);
// //     }
    
// //     // Search in shortages data
// //     if (fs.existsSync(EMA_FILES.SHORTAGES)) {
// //       results.shortages = await searchCsvFile(EMA_FILES.SHORTAGES, normalizedDrugName);
// //     }
    
// //     return {
// //       query: drugName,
// //       results,
// //       total: {
// //         medicines: results.medicines.length,
// //         orphans: results.orphans.length,
// //         referrals: results.referrals.length,
// //         dhpc: results.dhpc.length,
// //         psusa: results.psusa.length,
// //         shortages: results.shortages.length
// //       }
// //     };
// //   } catch (error) {
// //     console.error(`Error searching EMA data for ${drugName}:`, error);
// //     return { error: 'Error searching EMA data', details: error.message };
// //   }
// // }

// // /**
// //  * Search a CSV file for a drug name
// //  * @param {string} filePath - Path to the CSV file
// //  * @param {string} searchTerm - Term to search for
// //  * @returns {Promise<Array>} - Matching records
// //  */
// // async function searchCsvFile(filePath, searchTerm) {
// //   return new Promise((resolve, reject) => {
// //     const results = [];
    
// //     fs.createReadStream(filePath)
// //       .pipe(csv({
// //         skipLines: 0,
// //         headers: true,
// //         mapHeaders: ({ header }) => header.trim()
// //       }))
// //       .on('data', (data) => {
// //         // Check all fields for the search term
// //         const isMatch = Object.entries(data).some(([key, value]) => {
// //           return value && 
// //                  typeof value === 'string' && 
// //                  value.toLowerCase().includes(searchTerm);
// //         });
        
// //         if (isMatch) {
// //           // Clean up the data object by removing empty fields
// //           const cleanData = {};
// //           Object.entries(data).forEach(([key, value]) => {
// //             if (value !== null && value !== undefined && value !== '') {
// //               cleanData[key] = value;
// //             }
// //           });
          
// //           results.push(cleanData);
// //         }
// //       })
// //       .on('end', () => {
// //         resolve(results);
// //       })
// //       .on('error', (err) => {
// //         reject(err);
// //       });
// //   });
// // }

// /**
//  * Process a manually uploaded EMA file
//  * @param {string} fileType - Type of file (dhpc, psusa, etc.)
//  * @param {string} filePath - Path to the uploaded file
//  * @returns {Promise<Object>} - Processing result
//  */
// async function processUploadedEmaFile(fileType, filePath) {
//   try {
//     let targetPath;
    
//     switch (fileType.toLowerCase()) {
//       case 'dhpc':
//         targetPath = EMA_FILES.DHPC;
//         break;
//       case 'psusa':
//         targetPath = EMA_FILES.PSUSA;
//         break;
//       case 'medicines':
//         targetPath = EMA_FILES.MEDICINES;
//         break;
//       case 'orphans':
//         targetPath = EMA_FILES.ORPHANS;
//         break;
//       case 'referrals':
//         targetPath = EMA_FILES.REFERRALS;
//         break;
//       case 'shortages':
//         targetPath = EMA_FILES.SHORTAGES;
//         break;
//       default:
//         return { error: 'Unsupported file type' };
//     }
    
//     // Read uploaded file
//     const fileContent = fs.readFileSync(filePath, 'utf8');
    
//     // Parse the file
//     const parseResult = Papa.parse(fileContent, {
//       header: true,
//       skipEmptyLines: true
//     });
    
//     if (parseResult.errors && parseResult.errors.length > 0) {
//       return {
//         error: 'Error parsing file',
//         details: parseResult.errors
//       };
//     }
    
//     // Write to target file
//     fs.writeFileSync(targetPath, fileContent);
    
//     // Reset field mappings to pick up new headers
//     await initializeFieldMappings();
    
//     return {
//       success: true,
//       records: parseResult.data.length,
//       message: `Successfully processed ${parseResult.data.length} records`
//     };
//   } catch (error) {
//     console.error(`Error processing uploaded file:`, error);
//     return { error: 'Error processing file', details: error.message };
//   }
// }

// /**
//  * Get EMA data status (which files are available and when they were last updated)
//  * @returns {Object} - Data status
//  */
// function getEmaDataStatus() {
//   const status = {};
  
//   // Check each data file
//   for (const [key, filePath] of Object.entries(EMA_FILES)) {
//     if (fs.existsSync(filePath)) {
//       const stats = fs.statSync(filePath);
//       const recordCount = countCsvRecords(filePath);
      
//       status[key.toLowerCase()] = {
//         available: true,
//         lastUpdated: stats.mtime,
//         records: recordCount,
//         path: filePath,
//         filename: path.basename(filePath)
//       };
//     } else {
//       status[key.toLowerCase()] = {
//         available: false
//       };
//     }
//   }
  
//   return status;
// }

// /**
//  * Count the number of records in a CSV file
//  * @param {string} filePath - Path to the CSV file
//  * @returns {number} - Number of records
//  */
// function countCsvRecords(filePath) {
//   try {
//     const content = fs.readFileSync(filePath, 'utf8');
//     const lines = content.split('\n').filter(line => line.trim().length > 0);
//     return Math.max(0, lines.length - 1); // Subtract header row
//   } catch (error) {
//     console.error(`Error counting records in ${filePath}:`, error);
//     return 0;
//   }
// }

// // Initialize field mappings on module load
// initializeFieldMappings().catch(err => {
//   console.error('Error during initialization:', err);
// });

// /**
//  * Calculate Levenshtein distance between two strings
//  * @param {string} a - First string
//  * @param {string} b - Second string
//  * @returns {number} - Distance score
//  */
// function levenshteinDistance(a, b) {
//   const matrix = [];

//   // Initialize matrix
//   for (let i = 0; i <= b.length; i++) {
//     matrix[i] = [i];
//   }
//   for (let j = 0; j <= a.length; j++) {
//     matrix[0][j] = j;
//   }

//   // Fill matrix
//   for (let i = 1; i <= b.length; i++) {
//     for (let j = 1; j <= a.length; j++) {
//       if (b.charAt(i - 1) === a.charAt(j - 1)) {
//         matrix[i][j] = matrix[i - 1][j - 1];
//       } else {
//         matrix[i][j] = Math.min(
//           matrix[i - 1][j - 1] + 1, // substitution
//           matrix[i][j - 1] + 1,     // insertion
//           matrix[i - 1][j] + 1      // deletion
//         );
//       }
//     }
//   }

//   return matrix[b.length][a.length];
// }

// /**
//  * Calculate similarity score between two strings (0-1)
//  * @param {string} a - First string
//  * @param {string} b - Second string
//  * @returns {number} - Similarity score (higher is more similar)
//  */
// function calculateSimilarity(a, b) {
//   if (!a || !b) return 0;
  
//   // Convert to lowercase for comparison
//   const str1 = a.toLowerCase().trim();
//   const str2 = b.toLowerCase().trim();
  
//   // Exact match
//   if (str1 === str2) return 1;
  
//   // Check if exact drug name is a substring match
//   // For example, "ketamine hydrochloride" contains "ketamine"
//   if (str1.includes(str2) && (
//       str1.startsWith(str2 + ' ') || 
//       str1.includes(' ' + str2 + ' ') || 
//       str1.endsWith(' ' + str2)
//      )) {
//     return 0.95;
//   }
  
//   if (str2.includes(str1) && (
//       str2.startsWith(str1 + ' ') || 
//       str2.includes(' ' + str1 + ' ') || 
//       str2.endsWith(' ' + str1)
//      )) {
//     return 0.9;
//   }
  
//   // For very short strings, be more strict
//   if (str1.length < 4 || str2.length < 4) {
//     // For short terms, they should be very similar to match
//     const distance = levenshteinDistance(str1, str2);
//     if (distance > 1) return 0; // Only allow 1 character difference for short terms
//     return 0.85;
//   }
  
//   // Check first few characters as a strong signal
//   // Many drug names share the same prefix - this is important
//   const prefixLength = Math.min(4, Math.floor(str1.length / 2), Math.floor(str2.length / 2));
//   if (str1.substring(0, prefixLength) !== str2.substring(0, prefixLength)) {
//     // If the first few characters don't match at all, reduce similarity significantly
//     // This helps prevent "ketamine" from matching "caffeine" just because they share the suffix
//     return 0.2; 
//   }
  
//   // Calculate Levenshtein distance
//   const distance = levenshteinDistance(str1, str2);
  
//   // For drug names, be more strict about distance
//   if (distance > Math.min(str1.length, str2.length) / 2) {
//     return 0.3; // Too many changes needed, probably different drugs
//   }
  
//   // Convert distance to similarity score with more emphasis on closeness
//   const maxLength = Math.max(str1.length, str2.length);
//   let similarity = 1 - (distance / maxLength);
  
//   // Boost similarity if they share significant beginning parts
//   const sharedPrefixLength = getSharedPrefixLength(str1, str2);
//   if (sharedPrefixLength >= 4) {
//     similarity += 0.1; // Boost score for names sharing significant prefix
//   }
  
//   return Math.min(similarity, 1); // Cap at 1
// }

// /**
//  * Get the length of the shared prefix between two strings
//  * @param {string} a - First string
//  * @param {string} b - Second string
//  * @returns {number} - Length of shared prefix
//  */
// function getSharedPrefixLength(a, b) {
//   let i = 0;
//   const minLength = Math.min(a.length, b.length);
  
//   while (i < minLength && a[i] === b[i]) {
//     i++;
//   }
  
//   return i;
// }

// /**
//  * Search a CSV file for a drug name with fuzzy matching
//  * @param {string} filePath - Path to the CSV file
//  * @param {string} searchTerm - Term to search for
//  * @param {number} threshold - Similarity threshold (0-1), default 0.7
//  * @returns {Promise<Array>} - Matching records with similarity scores
//  */
// async function searchCsvFile(filePath, searchTerm, threshold = 0.7) {
//   return new Promise((resolve, reject) => {
//     const results = [];
    
//     fs.createReadStream(filePath)
//       .pipe(csv({
//         skipLines: 0,
//         headers: true,
//         mapHeaders: ({ header }) => header.trim()
//       }))
//       .on('data', (data) => {
//         // Track highest similarity score for this record
//         let highestSimilarity = 0;
//         let matchingField = '';
        
//         // Check all fields for similarity
//         Object.entries(data).forEach(([key, value]) => {
//           if (!value || typeof value !== 'string') return;
          
//           // Split value into words for more accurate matching
//           const words = value.split(/\s+/);
          
//           // Check whole value
//           const wholeSimilarity = calculateSimilarity(value, searchTerm);
//           if (wholeSimilarity > highestSimilarity) {
//             highestSimilarity = wholeSimilarity;
//             matchingField = key;
//           }
          
//           // Check individual words (for multi-word values)
//           words.forEach(word => {
//             if (word.length < 3) return; // Skip very short words
            
//             const wordSimilarity = calculateSimilarity(word, searchTerm);
//             if (wordSimilarity > highestSimilarity) {
//               highestSimilarity = wordSimilarity;
//               matchingField = key;
//             }
//           });
          
//           // Check for exact substring (case insensitive)
//           if (value.toLowerCase().includes(searchTerm.toLowerCase())) {
//             const containsSimilarity = 0.9; // High similarity for substring match
//             if (containsSimilarity > highestSimilarity) {
//               highestSimilarity = containsSimilarity;
//               matchingField = key;
//             }
//           }
//         });
        
//         // Only include results above threshold
//         if (highestSimilarity >= threshold) {
//           // Clean up the data object by removing empty fields
//           const cleanData = {};
//           Object.entries(data).forEach(([key, value]) => {
//             if (value !== null && value !== undefined && value !== '') {
//               cleanData[key] = value;
//             }
//           });
          
//           // Add similarity info
//           cleanData._similarity = highestSimilarity;
//           cleanData._matchField = matchingField;
          
//           results.push(cleanData);
//         }
//       })
//       .on('end', () => {
//         // Sort results by similarity (highest first)
//         results.sort((a, b) => b._similarity - a._similarity);
//         resolve(results);
//       })
//       .on('error', (err) => {
//         reject(err);
//       });
//   });
// }

// /**
//  * Search EMA data for a specific drug name using fuzzy matching
//  * @param {string} drugName - Drug name to search for
//  * @param {number} threshold - Optional similarity threshold (0-1) 
//  * @returns {Promise<Object>} - Search results
//  */
// async function searchEmaDrugData(drugName, threshold = 0.7) {
//   if (!drugName) {
//     return { error: 'No drug name provided' };
//   }
  
//   // Initialize field mappings if not already done
//   await initializeFieldMappings();
  
//   // Normalize drug name for search
//   const normalizedDrugName = drugName.toLowerCase().trim();
  
//   try {
//     // Search results
//     const results = {
//       medicines: [],
//       orphans: [],
//       referrals: [],
//       dhpc: [],
//       psusa: [],
//       shortages: []
//     };
    
//     // Search in medicines data
//     if (fs.existsSync(EMA_FILES.MEDICINES)) {
//       results.medicines = await searchCsvFile(EMA_FILES.MEDICINES, normalizedDrugName, threshold);
//     }
    
//     // Search in orphans data
//     if (fs.existsSync(EMA_FILES.ORPHANS)) {
//       results.orphans = await searchCsvFile(EMA_FILES.ORPHANS, normalizedDrugName, threshold);
//     }
    
//     // Search in referrals data
//     if (fs.existsSync(EMA_FILES.REFERRALS)) {
//       results.referrals = await searchCsvFile(EMA_FILES.REFERRALS, normalizedDrugName, threshold);
//     }
    
//     // Search in DHPC data
//     if (fs.existsSync(EMA_FILES.DHPC)) {
//       results.dhpc = await searchCsvFile(EMA_FILES.DHPC, normalizedDrugName, threshold);
//     }
    
//     // Search in PSUSA data
//     if (fs.existsSync(EMA_FILES.PSUSA)) {
//       results.psusa = await searchCsvFile(EMA_FILES.PSUSA, normalizedDrugName, threshold);
//     }
    
//     // Search in shortages data
//     if (fs.existsSync(EMA_FILES.SHORTAGES)) {
//       results.shortages = await searchCsvFile(EMA_FILES.SHORTAGES, normalizedDrugName, threshold);
//     }
    
//     return {
//       query: drugName,
//       results,
//       total: {
//         medicines: results.medicines.length,
//         orphans: results.orphans.length,
//         referrals: results.referrals.length,
//         dhpc: results.dhpc.length,
//         psusa: results.psusa.length,
//         shortages: results.shortages.length
//       }
//     };
//   } catch (error) {
//     console.error(`Error searching EMA data for ${drugName}:`, error);
//     return { error: 'Error searching EMA data', details: error.message };
//   }
// }


// /**
//  * Function to find recent drugs targeting treatment-resistant depression
//  * @param {number} yearsThreshold - Consider drugs authorized within this many years as recent (default: 5)
//  * @returns {Promise<Object>} - Matching depression treatment drugs
//  */
// async function findTreatmentResistantDepressionDrugs(yearsThreshold = 5) {
//   // Initialize field mappings if not already done
//   await initializeFieldMappings();
  
//   try {
//     // Check if medicines file exists
//     if (!fs.existsSync(EMA_FILES.MEDICINES)) {
//       return { error: 'Medicines data file not found' };
//     }
    
//     // List of keywords related to depression treatments
//     const depressionKeywords = [
//       'depression', 'depressive', 'antidepressant', 'mood disorder',
//       'major depressive disorder', 'mdd', 'trd', 'treatment-resistant depression',
//       'treatment resistant depression', 'refractory depression'
//     ];
    
//     // More specific treatment-resistant depression keywords
//     const resistantDepressionKeywords = [
//       'treatment-resistant', 'treatment resistant', 'refractory', 
//       'trd', 'inadequate response', 'failed treatment'
//     ];
    
//     // Calculate the date threshold for recent drugs
//     const currentDate = new Date();
//     const thresholdDate = new Date();
//     thresholdDate.setFullYear(currentDate.getFullYear() - yearsThreshold);
    
//     // Store results
//     const results = [];
    
//     // Read and process the medicines file
//     return new Promise((resolve, reject) => {
//       fs.createReadStream(EMA_FILES.MEDICINES)
//         .pipe(csv({
//           skipLines: 0,
//           headers: true,
//           mapHeaders: ({ header }) => header.trim()
//         }))
//         .on('data', (data) => {
//           // Determine authorization date
//           let authDate = null;
//           let dateField = FIELD_MAPPINGS.MEDICINES.authorisation_date;
          
//           if (dateField && data[dateField]) {
//             authDate = parseDate(data[dateField]);
//           } else {
//             // Try to find any date field if the mapped one isn't available
//             Object.entries(data).forEach(([key, value]) => {
//               if (!authDate && key.toLowerCase().includes('date') && value) {
//                 authDate = parseDate(value);
//               }
//             });
//           }
          
//           // Skip if we can't determine the date or if it's older than the threshold
//           if (!authDate || authDate < thresholdDate) {
//             return;
//           }
          
//           // Check if it's related to depression
//           let isDepressionDrug = false;
//           let isTreatmentResistant = false;
          
//           // First check therapeutic area and indication fields
//           const therapeuticField = FIELD_MAPPINGS.MEDICINES.therapeutic_area;
//           const nameField = FIELD_MAPPINGS.MEDICINES.name;
          
//           // Check all fields for depression keywords
//           Object.entries(data).forEach(([key, value]) => {
//             if (value && typeof value === 'string') {
//               const lowerValue = value.toLowerCase();
              
//               // Check for depression keywords
//               if (!isDepressionDrug) {
//                 isDepressionDrug = depressionKeywords.some(keyword => 
//                   lowerValue.includes(keyword)
//                 );
//               }
              
//               // Check for treatment-resistant keywords
//               if (!isTreatmentResistant) {
//                 isTreatmentResistant = resistantDepressionKeywords.some(keyword => 
//                   lowerValue.includes(keyword)
//                 );
//               }
//             }
//           });
          
//           // Add to results if it's a depression drug
//           if (isDepressionDrug) {
//             // Clean up the data object by removing empty fields
//             const cleanData = {};
//             Object.entries(data).forEach(([key, value]) => {
//               if (value !== null && value !== undefined && value !== '') {
//                 cleanData[key] = value;
//               }
//             });
            
//             // Add our analysis flags
//             cleanData._isTreatmentResistant = isTreatmentResistant;
//             cleanData._authDate = authDate.toISOString().split('T')[0];
            
//             results.push(cleanData);
//           }
//         })
//         .on('end', () => {
//           // Sort by date, newest first
//           results.sort((a, b) => {
//             return new Date(b._authDate) - new Date(a._authDate);
//           });
          
//           // Return the results
//           resolve({
//             total: results.length,
//             treatmentResistantCount: results.filter(item => item._isTreatmentResistant).length,
//             results: results
//           });
//         })
//         .on('error', (err) => {
//           reject(err);
//         });
//     });
//   } catch (error) {
//     console.error(`Error finding depression drugs:`, error);
//     return { error: 'Error searching for depression drugs', details: error.message };
//   }
// }

// /**
//  * Helper function to parse date strings in various formats
//  * @param {string} dateString - The date string to parse
//  * @returns {Date|null} - Parsed date or null if invalid
//  */
// function parseDate(dateString) {
//   if (!dateString) return null;
  
//   // Try different date formats
//   const formats = [
//     // ISO format
//     /^(\d{4})-(\d{2})-(\d{2})$/,
//     // European format
//     /^(\d{2})\/(\d{2})\/(\d{4})$/,
//     /^(\d{2})-(\d{2})-(\d{4})$/,
//     // US format
//     /^(\d{2})\/(\d{2})\/(\d{4})$/,
//     // Text format (e.g., "12 January 2020")
//     /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/
//   ];
  
//   let date = null;
  
//   // Try parsing with Date constructor first
//   date = new Date(dateString);
//   if (!isNaN(date.getTime())) {
//     return date;
//   }
  
//   // Try regex patterns
//   for (const format of formats) {
//     const match = dateString.match(format);
//     if (match) {
//       // Handle each format accordingly
//       if (format === formats[0]) {
//         // ISO: YYYY-MM-DD
//         date = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
//       } else if (format === formats[1] || format === formats[2]) {
//         // European: DD/MM/YYYY or DD-MM-YYYY
//         date = new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
//       } else if (format === formats[3]) {
//         // US: MM/DD/YYYY
//         date = new Date(parseInt(match[3]), parseInt(match[1]) - 1, parseInt(match[2]));
//       } else if (format === formats[4]) {
//         // Text format: DD Month YYYY
//         const months = {
//           'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
//           'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
//         };
//         const month = months[match[2].toLowerCase()];
//         if (month !== undefined) {
//           date = new Date(parseInt(match[3]), month, parseInt(match[1]));
//         }
//       }
      
//       if (date && !isNaN(date.getTime())) {
//         return date;
//       }
//     }
//   }
  
//   // If all else fails, try to extract a year at minimum
//   const yearMatch = dateString.match(/\b(20\d{2})\b/);
//   if (yearMatch) {
//     return new Date(parseInt(yearMatch[1]), 0, 1);
//   }
  
//   return null;
// }
// module.exports = {
//   searchEmaDrugData,
//   searchEmaConditionData,
//   processUploadedEmaFile,
//   getEmaDataStatus,
//   initializeFieldMappings,
//   findTreatmentResistantDepressionDrugs
// };