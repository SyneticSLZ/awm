const express = require('express');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const app = express();

// Global data stores
let warningLetters = [];
let recentInspections = [];
let historicalInspections = [];
let projectAreasSet = new Set();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Data loading functions
async function loadWarningLetters() {
  try {
    console.log('Loading warning letters data...');
    
    // Path to warning letters data file
    const wlFilePath = path.join(__dirname, 'data/warning_letters.json');
    
    // Check if file exists
    if (fs.existsSync(wlFilePath)) {
      // Read and parse warning letters data
      const rawData = fs.readFileSync(wlFilePath, 'utf8');
      warningLetters = JSON.parse(rawData);
      console.log(`Loaded ${warningLetters.length} warning letters`);
    } else {
      console.warn('Warning letters data file not found. Using empty array.');
      warningLetters = [];
    }
  } catch (error) {
    console.error('Error loading warning letters data:', error);
    warningLetters = [];
  }
}

// Helper function to read a CSV file and process its rows
const readCSV = (filePath, dataArray, processRow) => {
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .on('error', (err) => {
        console.warn(`Warning: Could not read CSV file (${filePath}):`, err.message);
        resolve([]); // Return empty array as fallback
      })
      .pipe(csv())
      .on('data', (row) => {
        const processedRow = processRow(row);
        if (processedRow) dataArray.push(processedRow);
      })
      .on('end', () => {
        resolve(dataArray);
      });
  });
};

// Load inspection data
async function loadInspectionData() {
  try {
    console.log('Loading inspection data...');
    
    // Clear the arrays
    recentInspections = [];
    historicalInspections = [];
    projectAreasSet.clear();
    
    // Define paths to CSV files
    const file1Path = path.join(__dirname, 'data/e18f4f87-a73a-42c6-ae4e-9a3b76245bdc.csv');
    const file2Path = path.join(__dirname, 'data/NonClinical_Labs_Inspections_List_(10-1-2000_through_10-1-2024).csv');
    
    // Process recent inspections (file 1)
    await readCSV(file1Path, recentInspections, (row) => {
      // Process the row according to expected structure
      return {
        "Record Date": row["Record Date"],
        "Legal Name": row["Legal Name"],
        "Record Type": row["Record Type"],
        "FEI Number": row["FEI Number"],
        "Download": row["Download"]
      };
    });
    
    // Process historical inspections (file 2)
    await readCSV(file2Path, historicalInspections, (row) => {
      // Match the exact structure from the provided CSV
      const processedRow = {
        "District": row["District"],
        "Firm Name": row["Firm Name"],
        "City": row["City"],
        "State": row["State"],
        "Zip": row["Zip"],
        "Country/Area": row["Country/Area"],
        "Inspection End Date": row["Inspection End Date"],
        "Project Area": row["Project Area"],
        "Center/Program Area": row["Center/Program Area"],
        "Inspection Classification": row["Inspection Classification"]
      };
      
      // Add to project areas collection
      if (processedRow["Project Area"]) {
        projectAreasSet.add(processedRow["Project Area"]);
      }
      
      return processedRow;
    });
    
    console.log(`Loaded ${recentInspections.length} recent inspections and ${historicalInspections.length} historical inspections`);
    
    // Handle empty data with sample values if needed
    if (recentInspections.length === 0) {
      recentInspections.push({
        "Record Date": "2023-01-01",
        "Legal Name": "Sample Pharmaceutical",
        "Record Type": "Form 483",
        "FEI Number": "12345"
      });
      console.log('Added sample recent inspection data');
    }
    
    if (historicalInspections.length === 0) {
      historicalInspections.push({
        "District": "Sample District",
        "Firm Name": "Sample Labs",
        "City": "Sample City",
        "State": "CA", 
        "Zip": "90210",
        "Country/Area": "United States",
        "Inspection End Date": "10/15/2022",
        "Project Area": "Quality Control",
        "Center/Program Area": "CDER",
        "Inspection Classification": "NAI"
      });
      
      projectAreasSet.add("Quality Control");
      projectAreasSet.add("Manufacturing");
      console.log('Added sample historical inspection data');
    }
    
  } catch (error) {
    console.error('Error loading inspection data:', error);
  }
}

// Load all data on server startup
async function initializeData() {
  await Promise.all([
    loadWarningLetters(),
    loadInspectionData()
  ]);
  console.log('All data loaded successfully');
}

// Helper function to normalize company names for better matching
function normalizeCompanyName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/(\s*(inc\.?|llc|corp\.?|corporation|company|co\.?|ltd\.?|limited)\s*)$/i, '')
    .trim();
}

// Helper function to determine if a warning letter is veterinary
function isVeterinary(letter) {
  const vetKeywords = ['animal', 'vet', 'veterinary', 'livestock', 'pet', 'cattle', 'poultry', 'swine', 'equine', 'fish', 'aquatic', 'cow', 'horse', 'dog', 'cat'];
  const title = (letter.companyName || '').toLowerCase();
  const subject = (letter.subject || '').toLowerCase();
  const content = (letter.fullContent || '').toLowerCase();
  
  return vetKeywords.some(keyword => 
    title.includes(keyword) || 
    subject.includes(keyword) || 
    content.includes(keyword)
  );
}

// API ENDPOINTS

// Get inspection data
app.get('/api/inspection-data', (req, res) => {
  try {
    res.json({
      recentInspections: recentInspections,
      historicalInspections: historicalInspections,
      projectAreas: Array.from(projectAreasSet)
    });
  } catch (error) {
    console.error('Error in API endpoint:', error);
    res.status(500).json({ error: 'Failed to process inspection data', details: error.message });
  }
});

// Recent Inspections for Companies
app.get('/api/inspections/recent', (req, res) => {
  try {
    const companiesString = req.query.companies || '';
    const companies = companiesString.split(',').map(c => c.trim()).filter(Boolean);
    
    if (companies.length === 0) {
      return res.json({ results: [] });
    }
    
    // For each company, find matching inspections
    let filteredInspections = [];
    
    companies.forEach(company => {
      const normalizedCompany = normalizeCompanyName(company);
      
      // Filter inspections for this company
      const matchingInspections = recentInspections.filter(inspection => {
        const inspectionCompany = normalizeCompanyName(inspection["Legal Name"] || '');
        return inspectionCompany.includes(normalizedCompany) || normalizedCompany.includes(inspectionCompany);
      });
      
      filteredInspections = [...filteredInspections, ...matchingInspections];
    });
    
    // Remove duplicates (if any)
    const uniqueInspections = Array.from(new Map(filteredInspections.map(i => 
      [i["FEI Number"], i]
    )).values());
    
    res.json({ results: uniqueInspections });
  } catch (error) {
    console.error('Error fetching recent inspections:', error);
    res.status(500).json({ error: 'Failed to fetch recent inspections' });
  }
});


// Historical Inspections for Companies
app.get('/api/inspections/historical', (req, res) => {
  try {
    const companiesString = req.query.companies || '';
    const companies = companiesString.split(',').map(c => c.trim()).filter(Boolean);
    
    if (companies.length === 0) {
      return res.json({ results: [] });
    }
    
    // For each company, find matching historical inspections
    let filteredInspections = [];
    
    companies.forEach(company => {
      const normalizedCompany = normalizeCompanyName(company);
      
      // Filter inspections for this company
      const matchingInspections = historicalInspections.filter(inspection => {
        const inspectionCompany = normalizeCompanyName(inspection["Firm Name"] || '');
        return inspectionCompany.includes(normalizedCompany) || normalizedCompany.includes(inspectionCompany);
      });
      
      filteredInspections = [...filteredInspections, ...matchingInspections];
    });
    
    // Remove duplicates by creating a unique key for each inspection
    const getInspectionKey = insp => `${insp["Firm Name"]}-${insp["Inspection End Date"]}-${insp["Project Area"]}`;
    const uniqueInspections = Array.from(new Map(filteredInspections.map(i => 
      [getInspectionKey(i), i]
    )).values());
    
    res.json({ results: uniqueInspections });
  } catch (error) {
    console.error('Error fetching historical inspections:', error);
    res.status(500).json({ error: 'Failed to fetch historical inspections' });
  }
});

// Get warning letter statistics
app.get('/api/wl/stats', (req, res) => {
  try {
    // Count total letters
    const totalLetters = warningLetters.length;

    // Find date range
    const dates = warningLetters
      .map(letter => letter.letterIssueDate)
      .filter(date => date && date.trim() !== '')
      .sort();

    const dateRange = {
      earliest: dates[0] || 'Unknown',
      latest: dates[dates.length - 1] || 'Unknown'
    };

    // Count by issuing office
    const officeCount = {};
    warningLetters.forEach(letter => {
      const office = letter.issuingOffice || 'Unknown';
      officeCount[office] = (officeCount[office] || 0) + 1;
    });

    // Get top issuing offices
    const topOffices = Object.entries(officeCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([office, count]) => ({ office, count }));

    // Get recent letters
    const recentLetters = warningLetters
      .sort((a, b) => {
        const dateA = new Date(a.letterIssueDate || 0);
        const dateB = new Date(b.letterIssueDate || 0);
        return dateB - dateA;
      })
      .slice(0, 10)
      .map(letter => ({
        id: letter.id || letter.letterId,
        letterIssueDate: letter.letterIssueDate,
        companyName: letter.companyName,
        subject: letter.subject
      }));

    res.json({
      totalLetters,
      dateRange,
      topOffices,
      recentLetters
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// Search for warning letters - improved version
app.get('/api/wl/search', (req, res) => {
  try {
    const {
      term = '',          // Company name
      field = 'all',      // Search field
      dateFrom = '',      // Start date
      dateTo = '',        // End date
      page = 1,           // Current page
      perPage = 20,       // Items per page
      type = '',          // Human or Veterinary
      issuingOffice = '', // Specific issuing office
      issueDate = '',     // Filter by year
      offset = 0,         // Alternative to page for pagination
      limit = 10,         // Alternative to perPage
      search = ''         // Additional search term
    } = req.query;

    // Convert pagination parameters
    const pageNum = parseInt(page);
    const itemsPerPage = parseInt(limit || perPage);
    const skipItems = parseInt(offset) || (pageNum - 1) * itemsPerPage;

    // Filter letters based on search criteria
    let filteredLetters = [...warningLetters];

    // Filter by company name (term)
    if (term.trim()) {
      const searchTerm = term.toLowerCase();
      
      if (field === 'companyName') {
        filteredLetters = filteredLetters.filter(letter => 
          letter.companyName && letter.companyName.toLowerCase().includes(searchTerm)
        );
      } else {
        // Default to all fields
        filteredLetters = filteredLetters.filter(letter => 
          (letter.companyName && letter.companyName.toLowerCase().includes(searchTerm)) ||
          (letter.subject && letter.subject.toLowerCase().includes(searchTerm)) ||
          (letter.fullContent && letter.fullContent.toLowerCase().includes(searchTerm))
        );
      }
    }

    // Filter by human/veterinary type
    if (type && type !== 'all') {
      filteredLetters = filteredLetters.filter(letter => 
        type === 'veterinary' ? isVeterinary(letter) : !isVeterinary(letter)
      );
    }

    // Filter by issuing office
    if (issuingOffice && issuingOffice !== 'all') {
      filteredLetters = filteredLetters.filter(letter => 
        letter.issuingOffice === issuingOffice
      );
    }

    // Filter by year (issueDate)
    if (issueDate && issueDate !== 'all') {
      const year = issueDate.toString();
      filteredLetters = filteredLetters.filter(letter => {
        if (!letter.letterIssueDate) return false;
        return letter.letterIssueDate.includes(year);
      });
    }

    // Additional search term filter
    if (search && search.trim()) {
      const additionalTerm = search.toLowerCase();
      filteredLetters = filteredLetters.filter(letter => 
        (letter.subject && letter.subject.toLowerCase().includes(additionalTerm)) ||
        (letter.fullContent && letter.fullContent.toLowerCase().includes(additionalTerm))
      );
    }

    // Filter by date range
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      filteredLetters = filteredLetters.filter(letter => {
        if (!letter.letterIssueDate) return false;
        return new Date(letter.letterIssueDate) >= fromDate;
      });
    }

    if (dateTo) {
      const toDate = new Date(dateTo);
      filteredLetters = filteredLetters.filter(letter => {
        if (!letter.letterIssueDate) return false;
        return new Date(letter.letterIssueDate) <= toDate;
      });
    }

    // Sort by date (most recent first)
    filteredLetters.sort((a, b) => {
      const dateA = new Date(a.letterIssueDate || 0);
      const dateB = new Date(b.letterIssueDate || 0);
      return dateB - dateA;
    });

    // Calculate pagination
    const totalResults = filteredLetters.length;
    const totalPages = Math.ceil(totalResults / itemsPerPage);
    
    // Slice the results for current page
    const paginatedLetters = filteredLetters.slice(skipItems, skipItems + itemsPerPage);

    // Format results for response
    const results = paginatedLetters.map(letter => ({
      id: letter.id || letter.letterId,
      letterId: letter.letterId,
      letterIssueDate: letter.letterIssueDate,
      companyName: letter.companyName,
      issuingOffice: letter.issuingOffice,
      subject: letter.subject,
      companyUrl: letter.companyUrl,
      excerpt: letter.excerpt || (letter.fullContent ? letter.fullContent.substring(0, 200) + '...' : '')
    }));

    // Return data in format expected by frontend
    res.json({
      results,
      total: totalResults,
      page: pageNum,
      limit: itemsPerPage,
      totalPages
    });
  } catch (error) {
    console.error('Error searching letters:', error);
    res.status(500).json({ error: 'Failed to search warning letters' });
  }
});

// Get a specific warning letter
app.get('/api/wl/letter/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    // Find letter by ID
    const letter = warningLetters.find(l => 
      l.id === id || l.letterId === id
    );

    if (!letter) {
      return res.status(404).json({ error: 'Warning letter not found' });
    }

    res.json(letter);
  } catch (error) {
    console.error('Error getting letter details:', error);
    res.status(500).json({ error: 'Failed to get letter details' });
  }
});

// Advanced search with multiple terms
app.post('/api/wl/advanced-search', (req, res) => {
  try {
    const { terms, operator = 'AND', page = 1, perPage = 20 } = req.body;
    
    if (!terms || !Array.isArray(terms) || terms.length === 0) {
      return res.status(400).json({ error: 'Search terms are required' });
    }

    const pageNum = parseInt(page);
    const itemsPerPage = parseInt(perPage);

    // Perform search
    let filteredLetters = [...warningLetters];

    if (operator.toUpperCase() === 'AND') {
      // ALL terms must match
      terms.forEach(term => {
        const searchTerm = term.toLowerCase();
        filteredLetters = filteredLetters.filter(letter => 
          (letter.companyName && letter.companyName.toLowerCase().includes(searchTerm)) ||
          (letter.subject && letter.subject.toLowerCase().includes(searchTerm)) ||
          (letter.fullContent && letter.fullContent.toLowerCase().includes(searchTerm))
        );
      });
    } else {
      // ANY term can match (OR)
      filteredLetters = filteredLetters.filter(letter => 
        terms.some(term => {
          const searchTerm = term.toLowerCase();
          return (letter.companyName && letter.companyName.toLowerCase().includes(searchTerm)) ||
            (letter.subject && letter.subject.toLowerCase().includes(searchTerm)) ||
            (letter.fullContent && letter.fullContent.toLowerCase().includes(searchTerm));
        })
      );
    }

    // Sort by date (most recent first)
    filteredLetters.sort((a, b) => {
      const dateA = new Date(a.letterIssueDate || 0);
      const dateB = new Date(b.letterIssueDate || 0);
      return dateB - dateA;
    });

    // Calculate pagination
    const totalResults = filteredLetters.length;
    const totalPages = Math.ceil(totalResults / itemsPerPage);
    
    // Slice the results for current page
    const startIndex = (pageNum - 1) * itemsPerPage;
    const paginatedLetters = filteredLetters.slice(startIndex, startIndex + itemsPerPage);

    // Format results for response
    const results = paginatedLetters.map(letter => ({
      id: letter.id || letter.letterId,
      letterId: letter.letterId,
      letterIssueDate: letter.letterIssueDate,
      companyName: letter.companyName,
      issuingOffice: letter.issuingOffice,
      subject: letter.subject,
      companyUrl: letter.companyUrl,
      excerpt: letter.excerpt || (letter.fullContent ? letter.fullContent.substring(0, 200) + '...' : '')
    }));

    res.json({
      results,
      total: totalResults,
      page: pageNum,
      limit: itemsPerPage,
      totalPages
    });
  } catch (error) {
    console.error('Error performing advanced search:', error);
    res.status(500).json({ error: 'Failed to perform advanced search' });
  }
});

// Get distinct issuing offices for dropdown selection
app.get('/api/wl/issuing-offices', (req, res) => {
  try {
    const offices = new Set();
    
    warningLetters.forEach(letter => {
      if (letter.issuingOffice && letter.issuingOffice.trim() !== '') {
        offices.add(letter.issuingOffice);
      }
    });
    
    const sortedOffices = Array.from(offices).sort();
    
    res.json(sortedOffices);
  } catch (error) {
    console.error('Error getting issuing offices:', error);
    res.status(500).json({ error: 'Failed to get issuing offices' });
  }
});

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Initialize data on server startup
  initializeData();
});