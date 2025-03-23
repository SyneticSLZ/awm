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

// /**
//  * Search EMA data for a specific drug name
//  * @param {string} drugName - Drug name to search for
//  * @returns {Promise<Object>} - Search results
//  */
// async function searchEmaDrugData(drugName) {
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
//       results.medicines = await searchCsvFile(EMA_FILES.MEDICINES, normalizedDrugName);
//     }
    
//     // Search in orphans data
//     if (fs.existsSync(EMA_FILES.ORPHANS)) {
//       results.orphans = await searchCsvFile(EMA_FILES.ORPHANS, normalizedDrugName);
//     }
    
//     // Search in referrals data
//     if (fs.existsSync(EMA_FILES.REFERRALS)) {
//       results.referrals = await searchCsvFile(EMA_FILES.REFERRALS, normalizedDrugName);
//     }
    
//     // Search in DHPC data
//     if (fs.existsSync(EMA_FILES.DHPC)) {
//       results.dhpc = await searchCsvFile(EMA_FILES.DHPC, normalizedDrugName);
//     }
    
//     // Search in PSUSA data
//     if (fs.existsSync(EMA_FILES.PSUSA)) {
//       results.psusa = await searchCsvFile(EMA_FILES.PSUSA, normalizedDrugName);
//     }
    
//     // Search in shortages data
//     if (fs.existsSync(EMA_FILES.SHORTAGES)) {
//       results.shortages = await searchCsvFile(EMA_FILES.SHORTAGES, normalizedDrugName);
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
//  * Search a CSV file for a drug name
//  * @param {string} filePath - Path to the CSV file
//  * @param {string} searchTerm - Term to search for
//  * @returns {Promise<Array>} - Matching records
//  */
// async function searchCsvFile(filePath, searchTerm) {
//   return new Promise((resolve, reject) => {
//     const results = [];
    
//     fs.createReadStream(filePath)
//       .pipe(csv({
//         skipLines: 0,
//         headers: true,
//         mapHeaders: ({ header }) => header.trim()
//       }))
//       .on('data', (data) => {
//         // Check all fields for the search term
//         const isMatch = Object.entries(data).some(([key, value]) => {
//           return value && 
//                  typeof value === 'string' && 
//                  value.toLowerCase().includes(searchTerm);
//         });
        
//         if (isMatch) {
//           // Clean up the data object by removing empty fields
//           const cleanData = {};
//           Object.entries(data).forEach(([key, value]) => {
//             if (value !== null && value !== undefined && value !== '') {
//               cleanData[key] = value;
//             }
//           });
          
//           results.push(cleanData);
//         }
//       })
//       .on('end', () => {
//         resolve(results);
//       })
//       .on('error', (err) => {
//         reject(err);
//       });
//   });
// }

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

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Distance score
 */
function levenshteinDistance(a, b) {
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

/**
 * Search a CSV file for a drug name with fuzzy matching
 * @param {string} filePath - Path to the CSV file
 * @param {string} searchTerm - Term to search for
 * @param {number} threshold - Similarity threshold (0-1), default 0.7
 * @returns {Promise<Array>} - Matching records with similarity scores
 */
async function searchCsvFile(filePath, searchTerm, threshold = 0.7) {
  return new Promise((resolve, reject) => {
    const results = [];
    
    fs.createReadStream(filePath)
      .pipe(csv({
        skipLines: 0,
        headers: true,
        mapHeaders: ({ header }) => header.trim()
      }))
      .on('data', (data) => {
        // Track highest similarity score for this record
        let highestSimilarity = 0;
        let matchingField = '';
        
        // Check all fields for similarity
        Object.entries(data).forEach(([key, value]) => {
          if (!value || typeof value !== 'string') return;
          
          // Split value into words for more accurate matching
          const words = value.split(/\s+/);
          
          // Check whole value
          const wholeSimilarity = calculateSimilarity(value, searchTerm);
          if (wholeSimilarity > highestSimilarity) {
            highestSimilarity = wholeSimilarity;
            matchingField = key;
          }
          
          // Check individual words (for multi-word values)
          words.forEach(word => {
            if (word.length < 3) return; // Skip very short words
            
            const wordSimilarity = calculateSimilarity(word, searchTerm);
            if (wordSimilarity > highestSimilarity) {
              highestSimilarity = wordSimilarity;
              matchingField = key;
            }
          });
          
          // Check for exact substring (case insensitive)
          if (value.toLowerCase().includes(searchTerm.toLowerCase())) {
            const containsSimilarity = 0.9; // High similarity for substring match
            if (containsSimilarity > highestSimilarity) {
              highestSimilarity = containsSimilarity;
              matchingField = key;
            }
          }
        });
        
        // Only include results above threshold
        if (highestSimilarity >= threshold) {
          // Clean up the data object by removing empty fields
          const cleanData = {};
          Object.entries(data).forEach(([key, value]) => {
            if (value !== null && value !== undefined && value !== '') {
              cleanData[key] = value;
            }
          });
          
          // Add similarity info
          cleanData._similarity = highestSimilarity;
          cleanData._matchField = matchingField;
          
          results.push(cleanData);
        }
      })
      .on('end', () => {
        // Sort results by similarity (highest first)
        results.sort((a, b) => b._similarity - a._similarity);
        resolve(results);
      })
      .on('error', (err) => {
        reject(err);
      });
  });
}

/**
 * Search EMA data for a specific drug name using fuzzy matching
 * @param {string} drugName - Drug name to search for
 * @param {number} threshold - Optional similarity threshold (0-1) 
 * @returns {Promise<Object>} - Search results
 */
async function searchEmaDrugData(drugName, threshold = 0.7) {
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
      results.medicines = await searchCsvFile(EMA_FILES.MEDICINES, normalizedDrugName, threshold);
    }
    
    // Search in orphans data
    if (fs.existsSync(EMA_FILES.ORPHANS)) {
      results.orphans = await searchCsvFile(EMA_FILES.ORPHANS, normalizedDrugName, threshold);
    }
    
    // Search in referrals data
    if (fs.existsSync(EMA_FILES.REFERRALS)) {
      results.referrals = await searchCsvFile(EMA_FILES.REFERRALS, normalizedDrugName, threshold);
    }
    
    // Search in DHPC data
    if (fs.existsSync(EMA_FILES.DHPC)) {
      results.dhpc = await searchCsvFile(EMA_FILES.DHPC, normalizedDrugName, threshold);
    }
    
    // Search in PSUSA data
    if (fs.existsSync(EMA_FILES.PSUSA)) {
      results.psusa = await searchCsvFile(EMA_FILES.PSUSA, normalizedDrugName, threshold);
    }
    
    // Search in shortages data
    if (fs.existsSync(EMA_FILES.SHORTAGES)) {
      results.shortages = await searchCsvFile(EMA_FILES.SHORTAGES, normalizedDrugName, threshold);
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
 * Function to find recent drugs targeting treatment-resistant depression
 * @param {number} yearsThreshold - Consider drugs authorized within this many years as recent (default: 5)
 * @returns {Promise<Object>} - Matching depression treatment drugs
 */
async function findTreatmentResistantDepressionDrugs(yearsThreshold = 5) {
  // Initialize field mappings if not already done
  await initializeFieldMappings();
  
  try {
    // Check if medicines file exists
    if (!fs.existsSync(EMA_FILES.MEDICINES)) {
      return { error: 'Medicines data file not found' };
    }
    
    // List of keywords related to depression treatments
    const depressionKeywords = [
      'depression', 'depressive', 'antidepressant', 'mood disorder',
      'major depressive disorder', 'mdd', 'trd', 'treatment-resistant depression',
      'treatment resistant depression', 'refractory depression'
    ];
    
    // More specific treatment-resistant depression keywords
    const resistantDepressionKeywords = [
      'treatment-resistant', 'treatment resistant', 'refractory', 
      'trd', 'inadequate response', 'failed treatment'
    ];
    
    // Calculate the date threshold for recent drugs
    const currentDate = new Date();
    const thresholdDate = new Date();
    thresholdDate.setFullYear(currentDate.getFullYear() - yearsThreshold);
    
    // Store results
    const results = [];
    
    // Read and process the medicines file
    return new Promise((resolve, reject) => {
      fs.createReadStream(EMA_FILES.MEDICINES)
        .pipe(csv({
          skipLines: 0,
          headers: true,
          mapHeaders: ({ header }) => header.trim()
        }))
        .on('data', (data) => {
          // Determine authorization date
          let authDate = null;
          let dateField = FIELD_MAPPINGS.MEDICINES.authorisation_date;
          
          if (dateField && data[dateField]) {
            authDate = parseDate(data[dateField]);
          } else {
            // Try to find any date field if the mapped one isn't available
            Object.entries(data).forEach(([key, value]) => {
              if (!authDate && key.toLowerCase().includes('date') && value) {
                authDate = parseDate(value);
              }
            });
          }
          
          // Skip if we can't determine the date or if it's older than the threshold
          if (!authDate || authDate < thresholdDate) {
            return;
          }
          
          // Check if it's related to depression
          let isDepressionDrug = false;
          let isTreatmentResistant = false;
          
          // First check therapeutic area and indication fields
          const therapeuticField = FIELD_MAPPINGS.MEDICINES.therapeutic_area;
          const nameField = FIELD_MAPPINGS.MEDICINES.name;
          
          // Check all fields for depression keywords
          Object.entries(data).forEach(([key, value]) => {
            if (value && typeof value === 'string') {
              const lowerValue = value.toLowerCase();
              
              // Check for depression keywords
              if (!isDepressionDrug) {
                isDepressionDrug = depressionKeywords.some(keyword => 
                  lowerValue.includes(keyword)
                );
              }
              
              // Check for treatment-resistant keywords
              if (!isTreatmentResistant) {
                isTreatmentResistant = resistantDepressionKeywords.some(keyword => 
                  lowerValue.includes(keyword)
                );
              }
            }
          });
          
          // Add to results if it's a depression drug
          if (isDepressionDrug) {
            // Clean up the data object by removing empty fields
            const cleanData = {};
            Object.entries(data).forEach(([key, value]) => {
              if (value !== null && value !== undefined && value !== '') {
                cleanData[key] = value;
              }
            });
            
            // Add our analysis flags
            cleanData._isTreatmentResistant = isTreatmentResistant;
            cleanData._authDate = authDate.toISOString().split('T')[0];
            
            results.push(cleanData);
          }
        })
        .on('end', () => {
          // Sort by date, newest first
          results.sort((a, b) => {
            return new Date(b._authDate) - new Date(a._authDate);
          });
          
          // Return the results
          resolve({
            total: results.length,
            treatmentResistantCount: results.filter(item => item._isTreatmentResistant).length,
            results: results
          });
        })
        .on('error', (err) => {
          reject(err);
        });
    });
  } catch (error) {
    console.error(`Error finding depression drugs:`, error);
    return { error: 'Error searching for depression drugs', details: error.message };
  }
}

/**
 * Helper function to parse date strings in various formats
 * @param {string} dateString - The date string to parse
 * @returns {Date|null} - Parsed date or null if invalid
 */
function parseDate(dateString) {
  if (!dateString) return null;
  
  // Try different date formats
  const formats = [
    // ISO format
    /^(\d{4})-(\d{2})-(\d{2})$/,
    // European format
    /^(\d{2})\/(\d{2})\/(\d{4})$/,
    /^(\d{2})-(\d{2})-(\d{4})$/,
    // US format
    /^(\d{2})\/(\d{2})\/(\d{4})$/,
    // Text format (e.g., "12 January 2020")
    /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/
  ];
  
  let date = null;
  
  // Try parsing with Date constructor first
  date = new Date(dateString);
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  // Try regex patterns
  for (const format of formats) {
    const match = dateString.match(format);
    if (match) {
      // Handle each format accordingly
      if (format === formats[0]) {
        // ISO: YYYY-MM-DD
        date = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
      } else if (format === formats[1] || format === formats[2]) {
        // European: DD/MM/YYYY or DD-MM-YYYY
        date = new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
      } else if (format === formats[3]) {
        // US: MM/DD/YYYY
        date = new Date(parseInt(match[3]), parseInt(match[1]) - 1, parseInt(match[2]));
      } else if (format === formats[4]) {
        // Text format: DD Month YYYY
        const months = {
          'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
          'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
        };
        const month = months[match[2].toLowerCase()];
        if (month !== undefined) {
          date = new Date(parseInt(match[3]), month, parseInt(match[1]));
        }
      }
      
      if (date && !isNaN(date.getTime())) {
        return date;
      }
    }
  }
  
  // If all else fails, try to extract a year at minimum
  const yearMatch = dateString.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    return new Date(parseInt(yearMatch[1]), 0, 1);
  }
  
  return null;
}
module.exports = {
  searchEmaDrugData,
  processUploadedEmaFile,
  getEmaDataStatus,
  initializeFieldMappings,
  findTreatmentResistantDepressionDrugs
};