const express = require('express');
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const axios = require('axios')
const app = express();
const PORT = process.env.PORT || 3000;

// Cache for FDA and EMA approvals
const approvalCache = {
  fda: {},
  ema: {}
};

// Input validation middleware
const FDAvalidateDrugName = (req, res, next) => {
  const { drugName } = req.params;
  if (!drugName || typeof drugName !== 'string' || drugName.length > 100) {
    return res.status(400).json({ error: 'Invalid drug name' });
  }
  next();
};



// Load and parse the EMA medicine data CSV file
let emaMedicines = [];
try {
  const csvFilePath = path.join(__dirname, 'medicines.csv');
  // Use utf8 encoding instead of cp1252 since Node.js doesn't directly support cp1252
  const csvData = fs.readFileSync(csvFilePath, { encoding: 'utf8' });
  const parsedData = Papa.parse(csvData, {
    header: true,
    skipEmptyLines: true,
    // Tell Papa Parse to be more flexible with parsing
    delimiter: ',', // Explicitly set delimiter
    dynamicTyping: false, // Keep everything as strings
    encoding: 'utf8'
  });
  emaMedicines = parsedData.data;
  console.log(`Loaded ${emaMedicines.length} medicines from EMA data`);
} catch (error) {
  console.error('Error loading EMA medicine data:', error.message);
  process.exit(1);
}
  
  

// Middleware to validate drug name parameter
const validateDrugName = (req, res, next) => {
  const { drugName } = req.params;
  
  if (!drugName || drugName.trim() === '') {
    return res.status(400).json({
      error: 'Invalid drug name',
      message: 'Drug name parameter cannot be empty',
      approved: false
    });
  }
  
  next();
};

// Search function to find drugs in EMA data
function searchDrugByName(drugName) {
  // Normalize the search term
  const normalizedDrugName = drugName.toLowerCase().trim();
  
  // Search in different fields
  return emaMedicines.filter(medicine => {
    // Check in Name of medicine
    if (medicine['Name of medicine'] && 
        medicine['Name of medicine'].toLowerCase().includes(normalizedDrugName)) {
      return true;
    }
    
    // Check in INN / common name
    if (medicine['International non-proprietary name (INN) / common name'] && 
        medicine['International non-proprietary name (INN) / common name'].toLowerCase().includes(normalizedDrugName)) {
      return true;
    }
    
    // Check in Active substance
    if (medicine['Active substance'] && 
        medicine['Active substance'].toLowerCase().includes(normalizedDrugName)) {
      return true;
    }
    
    return false;
  });
}

// Function to format EMA data in a structure similar to FDA API response
function formatEmaApprovalResponse(drugResults) {
  if (!drugResults || drugResults.length === 0) {
    return {
      approved: false,
      approvalDate: null,
      indications: [],
      marketingStatus: [],
      details: null
    };
  }
  
  // Get the first (most relevant) result
  const drugInfo = drugResults[0];
  
  // Determine approval status based on Medicine status
  const isApproved = drugInfo['Medicine status'] === 'Authorised';
  
  // Format the response
  const approvalStatus = {
    approved: isApproved,
    approvalDate: drugInfo['Marketing authorisation date'] || null,
    indications: [],
    marketingStatus: [],
    details: null
  };
  
  // Extract active substances as indications (similar to FDA API)
  if (drugInfo['Active substance']) {
    const substances = drugInfo['Active substance'].split(';');
    approvalStatus.indications = substances.map(s => s.trim());
  }
  
  // Set marketing status based on Medicine status
  approvalStatus.marketingStatus = [drugInfo['Medicine status']];
  
  // Add additional details
  approvalStatus.details = {
    applicationNumbers: [drugInfo['EMA product number'] || 'Unknown'],
    sponsorName: drugInfo['Marketing authorisation developer / applicant / holder'] || 'Unknown',
    therapeuticIndication: drugInfo['Therapeutic indication'] || 'Not specified'
  };
  
  return approvalStatus;
}

// API endpoint for EMA drug approval status
app.get('/api/ema-approval/:drugName', validateDrugName, (req, res) => {
  try {
    const { drugName } = req.params;
    
    // Check cache first
    if (approvalCache.ema[drugName]) {
      return res.json(approvalCache.ema[drugName]);
    }
    
    // Search for the drug in the EMA data
    const drugResults = searchDrugByName(drugName);
    
    // Format the response
    const approvalStatus = formatEmaApprovalResponse(drugResults);
    
    // Cache the result
    approvalCache.ema[drugName] = approvalStatus;
    
    res.json(approvalStatus);
  } catch (error) {
    console.error('Error with EMA API:', error.message);
    res.status(500).json({ 
      error: 'Error fetching EMA approval data',
      message: error.message,
      approved: false 
    });
  }
});



// FDA API endpoint (unchanged)
app.get('/api/fda-approval/:drugName', FDAvalidateDrugName, async (req, res) => {
  try {
    const { drugName } = req.params;

    if (approvalCache.fda[drugName]) {
      return res.json(approvalCache.fda[drugName]);
    }

    const url = `https://api.fda.gov/drug/drugsfda.json?search=openfda.brand_name:"${encodeURIComponent(drugName)}" OR openfda.generic_name:"${encodeURIComponent(drugName)}"&limit=5`;
    const response = await axios.get(url);

    let approvalStatus = {
      approved: false,
      approvalDate: null,
      indications: [],
      marketingStatus: [],
      details: null
    };

    if (response.data && response.data.results && response.data.results.length > 0) {
      approvalStatus.approved = true;
      const products = response.data.results.flatMap(r => r.products || []);
      if (products.length > 0) {
        approvalStatus.marketingStatus = [...new Set(products.map(p => p.marketing_status))];
        const appDates = response.data.results
          .filter(r => r.application_number && r.submissions)
          .flatMap(r => r.submissions
            .filter(s => s.submission_status === 'AP' && s.submission_status_date)
            .map(s => ({ date: s.submission_status_date, app: r.application_number }))
          );
        if (appDates.length > 0) {
          appDates.sort((a, b) => new Date(b.date) - new Date(a.date));
          approvalStatus.approvalDate = appDates[0].date;
        }
        approvalStatus.indications = [
          ...new Set(
            response.data.results
              .filter(r => r.products)
              .flatMap(r => r.products
                .filter(p => p.active_ingredients)
                .map(p => p.active_ingredients.map(i => i.name))
              )
              .flat()
          )
        ];
        approvalStatus.details = {
          applicationNumbers: [...new Set(response.data.results.map(r => r.application_number))],
          sponsorName: response.data.results[0].sponsor_name || 'Unknown'
        };
      }
    }

    approvalCache.fda[drugName] = approvalStatus;
    res.json(approvalStatus);
  } catch (error) {
    console.error('Error with FDA API:', error.message);
    res.status(500).json({ 
      error: 'Error fetching FDA approval data',
      message: error.message,
      approved: false 
    });
  }
});



// Combined endpoint (unchanged)
app.get('/api/drug-approval/:drugName', FDAvalidateDrugName, async (req, res) => {
  try {
    const { drugName } = req.params;
    const [fdaResponse, emaResponse] = await Promise.all([
      axios.get(`http://localhost:${PORT}/api/fda-approval/${drugName}`),
      axios.get(`http://localhost:${PORT}/api/ema-approval/${drugName}`)
    ]);

    res.json({
      drug: drugName,
      fda: fdaResponse.data,
      ema: emaResponse.data
    });
  } catch (error) {
    console.error('Error checking approvals:', error.message);
    res.status(500).json({ 
      error: 'Error checking drug approvals',
      message: error.message 
    });
  }
});
// For the existing FDA endpoint (included for reference)
// Your existing FDA endpoint code from the example

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`EMA API endpoint: http://localhost:${PORT}/api/ema-approval/:drugName`);
});

module.exports = app;