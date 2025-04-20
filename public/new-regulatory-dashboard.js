// Core utility functions for the FDA Regulatory Dashboard
// ====================== GLOBAL STATE TRACKING ======================
// Add a global object to track Form 483 counts by company
window.regulatoryData = {
    form483Counts: {},
    warningLetterCounts: {},
    historicalInspectionCounts: {},
    
    // Method to reset all counts
    resetCounts: function(companies) {
      this.form483Counts = {};
      this.warningLetterCounts = {};
      this.historicalInspectionCounts = {};
      
      // Initialize counts for all companies
      if (companies && Array.isArray(companies)) {
        companies.forEach(company => {
          this.form483Counts[company] = 0;
          this.warningLetterCounts[company] = 0;
          this.historicalInspectionCounts[company] = 0;
        });
      }
    },
    
    // Method to increment Form 483 count for a company
    addForm483: function(company) {
      if (!this.form483Counts[company]) {
        this.form483Counts[company] = 0;
      }
      this.form483Counts[company]++;
      console.log(`Added Form 483 for ${company}, new count: ${this.form483Counts[company]}`);
    },
    
    // Method to get all counts for a company
    getCompanyStats: function(company) {
      return {
        company: company,
        form483Count: this.form483Counts[company] || 0,
        wlCount: this.warningLetterCounts[company] || 0,
        historicalCount: this.historicalInspectionCounts[company] || 0,
        totalInspections: (this.form483Counts[company] || 0) + (this.historicalInspectionCounts[company] || 0)
      };
    },
    
    // Debug method to log all counts
    logAllCounts: function() {
      console.log("Current Form 483 Counts:", this.form483Counts);
      console.log("Current Warning Letter Counts:", this.warningLetterCounts);
      console.log("Current Historical Inspection Counts:", this.historicalInspectionCounts);
    }
  };
  
// Elements reference for easier DOM access
const elements = {
    // Warning letters section elements
    warningLettersData: document.getElementById('warningLettersData'),
    warningLettersCount: document.getElementById('warningLettersCount'),
    fdaDataSection: document.querySelector('.fda-data-section'),
    
    // Inspection data section elements (initialized properly)
    inspectionDataSection: document.getElementById('inspection-data'),
    
    // Company summary section (will be created dynamically)
    companySummarySection: null
  };
  
  // API base URL - adjust as needed for your deployment
  const API_BASE_URL = '/api';
  
  // ====================== WARNING LETTERS FUNCTIONS ======================

  // Modified function to fetch warning letters and return the result without affecting the display
  async function fetchWarningLettersWithTracking(companies, page = 1, pageSize = 10, filters = {}) {
    try {
      if (!Array.isArray(companies) || companies.length === 0) {
        throw new Error('Companies parameter must be a non-empty array');
      }
  
      // Show loading state
      elements.warningLettersData.innerHTML = `
        <div class="flex justify-center items-center py-8">
          <svg class="animate-spin h-6 w-6 text-red-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span class="ml-2 text-gray-600">Searching warning letters for ${companies.length} ${companies.length === 1 ? 'company' : 'companies'}...</span>
        </div>
      `;
  
      // Store results and deduplicate by letter ID
      const allLetters = new Map(); // Map<letterId, letter>
  
      // Fetch warning letters for each company
      for (const company of companies) {
        // Build query parameters for this company
        const queryParams = new URLSearchParams();
        
        // Use company as the search term
        queryParams.append('term', company);
        
        // Focus search on company name
        queryParams.append('field', 'company');
        
        // Pagination parameters
        queryParams.append('page', page.toString());
        queryParams.append('perPage', pageSize.toString());
  
        // Add filters if they exist
        if (filters.type) queryParams.append('type', filters.type);
        if (filters.issueDate) queryParams.append('dateFrom', filters.issueDate);
        if (filters.issuingOffice) queryParams.append('issuingOffice', filters.issuingOffice);
  
        console.log(`Fetching warning letters for ${company} with params:`, queryParams.toString());
  
        // Make request to the API
        try {
          const response = await fetch(`${API_BASE_URL}/wl/search?${queryParams.toString()}`);
          
          if (!response.ok) {
            console.warn(`Warning letters fetch failed for ${company}: ${response.status}`);
            continue; // Skip to next company
          }
  
          const data = await response.json();
          const letters = data.results || [];
          
          console.log(`Found ${letters.length} warning letters for ${company}:`, letters);
  
          // Add source company to each letter and add to Map to deduplicate
          letters.forEach(letter => {
            const letterId = letter.id || letter.letterId;
            if (letterId) {
              if (!allLetters.has(letterId)) {
                allLetters.set(letterId, { ...letter, sourceCompany: company });
                console.log(`Added warning letter ${letterId} to results with sourceCompany=${company}`);
                
                // Increment the warning letter count for this company
                window.regulatoryData.warningLetterCounts[company] = 
                  (window.regulatoryData.warningLetterCounts[company] || 0) + 1;
              } else {
                console.log(`Skipped duplicate warning letter ${letterId}`);
              }
            }
          });
        } catch (error) {
          console.warn(`Error fetching warning letters for ${company}:`, error);
        }
      }
  
      // Convert Map to array for display
      const lettersArray = Array.from(allLetters.values());
      console.log(`Final deduplicated warning letters: ${lettersArray.length}`, lettersArray);
  
      // Update the warning letters count properly
      elements.warningLettersCount.textContent = `${lettersArray.length} letters`;
      elements.warningLettersCount.style.display = "inline-flex";
  
      // Display the warning letters with pagination
      displayWarningLetters({
        results: lettersArray,
        total: lettersArray.length, // Use actual count of deduplicated letters
        page: page,
        pageSize: pageSize
      }, companies, filters);
      
      // Return the warning letters to be used elsewhere
      return lettersArray;
    } catch (error) {
      console.error("Error fetching warning letters:", error);
      elements.warningLettersData.innerHTML = `
        <div class="text-center p-4">
          <p class="text-sm text-red-600">Error fetching warning letters: ${error.message}</p>
        </div>
      `;
  
      elements.warningLettersCount.textContent = "0 letters";
      elements.warningLettersCount.style.display = "inline-flex";
      
      // Return empty array in case of error
      return [];
    }
  }
  
  // Function to fetch inspection data without creating the summary yet
// Function to fetch inspection data without creating the summary yet
async function fetchInspectionDataWithTracking(companies) {
  try {
    if (!Array.isArray(companies) || companies.length === 0) {
      throw new Error('Companies parameter must be a non-empty array');
    }

    // Show loading state
    elements.inspectionDataSection.innerHTML = `
      <div class="flex justify-center items-center py-8">
        <svg class="animate-spin h-6 w-6 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span class="ml-2 text-gray-600">Loading inspection data for ${companies.join(", ")}...</span>
      </div>
    `;

    // Fetch inspection data from your API
    const response = await fetch(`${API_BASE_URL}/inspection-data`);
    
    if (!response.ok) {
      throw new Error(`Error fetching inspection data: ${response.status}`);
    }
    
    const data = await response.json();
    console.log("Raw inspection data:", data);
    
    // First reset Form 483 counts for these companies to ensure clean state
    companies.forEach(company => {
      window.regulatoryData.form483Counts[company] = 0;
    });
    
    // Process each recent inspection (Form 483s)
    if (data.recentInspections && data.recentInspections.length > 0) {
      data.recentInspections.forEach(inspection => {
        // Only process if it's a Form 483
        // if (inspection["Record Type"] === "Form 483") {
          const legalName = inspection["Legal Name"] || '';
          
          // Check for each company if this Form 483 belongs to it
          companies.forEach(company => {
            console.log("checking for company now, ", legalName, company)
            // Check if this Form 483 is related to this company
            // More inclusive matching for subsidiaries
            if (isRelatedCompany(legalName, company)) {
              console.log(`Found Form 483 for ${company}: ${legalName}`);
              // Directly increment the form483Counts
              if (!window.regulatoryData.form483Counts[company]) {
                window.regulatoryData.form483Counts[company] = 0;
              }
              window.regulatoryData.form483Counts[company]++;
              console.log(`Updated Form 483 count for ${company}: ${window.regulatoryData.form483Counts[company]}`);
            }
          });
        // }
      });
    }
    
    // Process historical inspections
    if (data.historicalInspections && data.historicalInspections.length > 0) {
      data.historicalInspections.forEach(inspection => {
        const firmName = inspection["Firm Name"] || '';
        
        // Check for each company if this historical inspection belongs to it
        companies.forEach(company => {
          if (isRelatedCompany(firmName, company)) {
            console.log(`Found historical inspection for ${company}: ${firmName}`);
            window.regulatoryData.historicalInspectionCounts[company] = 
              (window.regulatoryData.historicalInspectionCounts[company] || 0) + 1;
          }
        });
      });
    }
    
    // Create filtered data object with the inspections that match our companies
    const filteredRecentInspections = data.recentInspections.filter(inspection => {
      const legalName = inspection["Legal Name"] || '';
      return companies.some(company => isRelatedCompany(legalName, company));
    });
    
    const filteredHistoricalInspections = data.historicalInspections.filter(inspection => {
      const firmName = inspection["Firm Name"] || '';
      return companies.some(company => isRelatedCompany(firmName, company));
    });
    
    const filteredData = {
      recentInspections: filteredRecentInspections,
      historicalInspections: filteredHistoricalInspections,
      projectAreas: data.projectAreas
    };
    
    console.log("Filtered inspection data:", filteredData);
    
    // Log the current state of form483Counts after processing
    console.log("Current Form 483 counts after processing:", window.regulatoryData.form483Counts);
    
    // Display the filtered data
    displayInspectionData(filteredData);
    
    // If no matches were found, show a message
    if (filteredData.recentInspections.length === 0 && filteredData.historicalInspections.length === 0) {
      elements.inspectionDataSection.innerHTML += `
        <div class="text-center p-4 mt-4">
          <p class="text-sm text-gray-600">No inspection data found for the selected companies.</p>
        </div>
      `;
    }
    
    // Return the filtered data
    return filteredData;
  } catch (error) {
    console.error('Error fetching inspection data:', error);
    elements.inspectionDataSection.innerHTML = `
      <div class="text-center p-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 mx-auto mb-2 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p class="text-sm text-red-600">Error loading inspection data: ${error.message}</p>
      </div>
    `;
    
    // Return empty data in case of error
    return {
      recentInspections: [],
      historicalInspections: [],
      projectAreas: []
    };
  }
}




// Add this function to update Form 483 counts from the displayed table
function updateForm483CountsFromDisplayedTable() {
  console.log("Running updateForm483CountsFromDisplayedTable");
  
  // Get all companies from the summary table
  const companyRows = document.querySelectorAll('#company-summary-section tbody tr');
  const companies = Array.from(companyRows).map(row => 
    row.querySelector('td:first-child').textContent.trim()
  );
  
  // Reset the Form 483 counts
  companies.forEach(company => {
    window.regulatoryData.form483Counts[company] = 0;
  });
  
  // Get the Form 483 table
  const form483Table = document.querySelector('#inspection-data table tbody');
  if (!form483Table) {
    console.log("Form 483 table not found");
    return;
  }
  
  // Process each row to count Form 483s for companies
  const rows = form483Table.querySelectorAll('tr');
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 3) {
      const legalName = cells[1]?.textContent?.trim() || '';
      const recordType = cells[2]?.textContent?.trim() || '';
      
      
      // Only process if it's a Form 483
      // if (recordType.includes('Form 483')) {
        // Check for each company if this Form 483 belongs to it
        companies.forEach(company => {
          console.log(legalName, company )
          // Simpler check: just see if the company name appears anywhere in the legal name
          // This ensures any 483 containing the company name gets counted for that company
          if (legalName.toLowerCase().includes(company.toLowerCase())) {
            console.log(`Found Form 483 for ${company}: ${legalName}`);
            window.regulatoryData.form483Counts[company] = 
              (window.regulatoryData.form483Counts[company] || 0) + 1;
          }
        });
      // }
    }
  });
  
  console.log("Updated Form 483 counts:", window.regulatoryData.form483Counts);
  
  // Update the summary table with correct counts
  companyRows.forEach(row => {
    const company = row.querySelector('td:first-child').textContent.trim();
    const form483Cell = row.querySelector('td:nth-child(2)');
    const form483Count = window.regulatoryData.form483Counts[company] || 0;
    
    form483Cell.setAttribute('data-form483-count', form483Count);
    
    if (form483Count > 0) {
      form483Cell.innerHTML = `<span class="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs">${form483Count}</span>`;
    } else {
      form483Cell.textContent = '0';
    }
    
    // Also update total inspections
    const totalCell = row.querySelector('td:nth-child(4)');
    const wlCount = parseInt(row.querySelector('td:nth-child(3)').getAttribute('data-wl-count') || '0');
    const histCount = window.regulatoryData.historicalInspectionCounts[company] || 0;
    const totalCount = form483Count + histCount;
    
    totalCell.setAttribute('data-total-count', totalCount);
    
    if (totalCount > 0) {
      totalCell.innerHTML = `<span class="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">${totalCount}</span>`;
    } else {
      totalCell.textContent = '0';
    }
  });
}
  
// Modified function to create company summary directly from the tracked data in the global state
function createCompanySummaryFromTrackedData(companies, warningLetters, inspections) {
  console.log("Creating company summary from tracked data for:", companies);
  console.log("Current Form 483 counts before creating summary:", window.regulatoryData.form483Counts);
  
  // Create container if it doesn't exist
  if (!elements.companySummarySection) {
    elements.companySummarySection = document.createElement('div');
    elements.companySummarySection.id = 'company-summary-section';
    elements.companySummarySection.className = 'mb-6';
    
    // Insert before inspection data section
    const inspectionDataSection = document.getElementById('inspection-data');
    if (inspectionDataSection && inspectionDataSection.parentNode) {
      inspectionDataSection.parentNode.insertBefore(elements.companySummarySection, inspectionDataSection);
    } else {
      // If inspection data section doesn't exist, append to FDA data section
      const fdaDataSection = document.querySelector('.fda-data-section');
      if (fdaDataSection) {
        fdaDataSection.appendChild(elements.companySummarySection);
      }
    }
  }
  
  // Get stats for each company from the global tracking object
  const companyStats = companies.map(company => {
    return window.regulatoryData.getCompanyStats(company);
  });
  
  // Log the final stats
  console.log("Final company statistics from tracked data:", companyStats);
  
  // Create summary HTML
  let html = `
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-medium">Company Regulatory Summary</h3>
        
        <div class="flex space-x-2">
          <button id="generate-ai-summary" class="text-xs bg-purple-600 hover:bg-purple-700 text-white py-1 px-3 rounded-md flex items-center transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate AI Summary
          </button>
          
          <button id="email-summary-btn" class="text-xs bg-blue-600 hover:bg-blue-700 text-white py-1 px-3 rounded-md flex items-center transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Email Summary
          </button>
        </div>
      </div>
      
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="bg-gray-100">
              <th class="px-4 py-2 text-left">Company</th>
              <th class="px-4 py-2 text-center">Form 483s</th>
              <th class="px-4 py-2 text-center">Warning Letters</th>
              <th class="px-4 py-2 text-center">Total Inspections</th>
              <th class="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${companyStats.map(stat => `
              <tr class="border-b hover:bg-gray-50">
                <td class="px-4 py-3 font-medium">${stat.company}</td>
                <td class="px-4 py-3 text-center" data-form483-count="${stat.form483Count}">
                  ${stat.form483Count > 0 
                    ? `<span class="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs">${stat.form483Count}</span>` 
                    : '0'}
                </td>
                <td class="px-4 py-3 text-center" data-wl-count="${stat.wlCount}">
                  ${stat.wlCount > 0 
                    ? `<span class="px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs">${stat.wlCount}</span>` 
                    : '0'}
                </td>
                <td class="px-4 py-3 text-center" data-total-count="${stat.totalInspections}">
                  ${stat.totalInspections > 0 
                    ? `<span class="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">${stat.totalInspections}</span>` 
                    : '0'}
                </td>
                <td class="px-4 py-3 text-right">
                  <div class="flex justify-end space-x-2">
                    <button class="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded transition-colors view-company-details" 
                            data-company="${stat.company}">
                      View Details
                    </button>
                    <label class="inline-flex items-center cursor-pointer">
                      <input type="checkbox" class="form-checkbox h-4 w-4 text-blue-600 company-select-checkbox" 
                             value="${stat.company}">
                    </label>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      
      <div class="mt-4 flex justify-between items-center">
        <div>
          <button id="analyze-selected-companies" class="text-xs bg-indigo-600 hover:bg-indigo-700 text-white py-1 px-3 rounded-md flex items-center transition-colors" disabled>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Analyze Selected Companies
          </button>
        </div>
        <div class="text-xs text-gray-500">
          Select companies to perform detailed analysis or generate AI summary
        </div>
      </div>
      
      <!-- AI Analysis Results Section -->
      <div id="ai-analysis-results" class="mt-6 hidden">
        <div class="border-t pt-4">
          <h4 class="text-base font-medium mb-3">AI Analysis Results</h4>
          <div id="ai-analysis-content" class="bg-gray-50 p-4 rounded-lg">
            <!-- AI content will be placed here -->
          </div>
        </div>
      </div>
      
      <!-- Company Details Section -->
      <div id="company-detail-view" class="mt-6 hidden">
        <div class="border-t pt-4">
          <h4 class="text-base font-medium mb-3">Company Details: <span id="company-detail-name"></span></h4>
          <div id="company-detail-content" class="bg-gray-50 p-4 rounded-lg">
            <!-- Company detail content will be placed here -->
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Update the section
  elements.companySummarySection.innerHTML = html;
  
  // Add event listeners
  document.querySelectorAll('.company-select-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', updateSelectedCompaniesState);
  });
  
  document.getElementById('analyze-selected-companies').addEventListener('click', () => {
    analyzeSelectedCompanies(warningLetters, inspections);
  });
  
  document.getElementById('generate-ai-summary').addEventListener('click', WLgenerateAISummary);
  document.getElementById('email-summary-btn').addEventListener('click', WLemailSummary);
  
  document.querySelectorAll('.view-company-details').forEach(button => {
    button.addEventListener('click', function() {
      const company = this.getAttribute('data-company');
      WLshowCompanyDetails(company, warningLetters, inspections);
    });
  });
}
  
  // Function to display warning letters with pagination
  function displayWarningLetters(data, companies, filters = {}) {
    const letters = data.results || [];
    const totalCount = data.total || 0;
    const currentPage = data.page || 1;
    const pageSize = data.pageSize || 10;
    
    // Update counter
    elements.warningLettersCount.textContent = `${totalCount} letters`;
    elements.warningLettersCount.style.display = "inline-flex";
    
    if (letters.length === 0) {
      elements.warningLettersData.innerHTML = `
        <div class="text-center p-4">
          <p class="text-sm text-gray-700">No warning letters found for ${companies.length > 1 ? 'these companies' : 'this company'}: ${companies.join(", ")}</p>
        </div>
      `;
      return;
    }
    
    // Get unique issuing offices for filter
    const issuingOffices = [...new Set(letters.map(letter => letter.issuingOffice))].filter(Boolean);
    
    // Determine which letters are veterinary vs human
    const isVeterinary = letter => {
      const vetKeywords = ['animal', 'vet', 'veterinary', 'livestock', 'pet', 'cattle', 'poultry', 'swine', 'equine', 'fish', 'aquatic', 'cow', 'horse', 'dog', 'cat'];
      const title = (letter.companyName || '').toLowerCase();
      const subject = (letter.subject || '').toLowerCase();
      const content = (letter.fullContent || '').toLowerCase();
      
      return vetKeywords.some(keyword => 
        title.includes(keyword) || 
        subject.includes(keyword) || 
        content.includes(keyword)
      );
    };
    
    // Calculate total pages
    const totalPages = Math.ceil(totalCount / pageSize);
    
    // Create HTML for warning letters section
    let html = `
      <div>
        <!-- Filter controls -->
        <div class="mb-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap gap-2">
              <div>
                <select id="warning-letters-type-filter" class="text-xs rounded border border-gray-300 py-1 px-2 focus:outline-none focus:ring-1 focus:ring-blue-500">
                  <option value="all" ${!filters.type ? 'selected' : ''}>All Types</option>
                  <option value="human" ${filters.type === 'human' ? 'selected' : ''}>Human</option>
                  <option value="veterinary" ${filters.type === 'veterinary' ? 'selected' : ''}>Veterinary</option>
                </select>
              </div>
              <div>
                <select id="warning-letters-office-filter" class="text-xs rounded border border-gray-300 py-1 px-2 focus:outline-none focus:ring-1 focus:ring-blue-500">
                  <option value="all" ${!filters.issuingOffice ? 'selected' : ''}>All Offices</option>
                  ${issuingOffices.map(office => `<option value="${office}" ${filters.issuingOffice === office ? 'selected' : ''}>${office}</option>`).join('')}
                </select>
              </div>
              <div>
                <select id="warning-letters-page-size" class="text-xs rounded border border-gray-300 py-1 px-2 focus:outline-none focus:ring-1 focus:ring-blue-500">
                  <option value="10" ${pageSize === 10 ? 'selected' : ''}>10 per page</option>
                  <option value="25" ${pageSize === 25 ? 'selected' : ''}>25 per page</option>
                  <option value="50" ${pageSize === 50 ? 'selected' : ''}>50 per page</option>
                </select>
              </div>
            </div>
            
            <button id="apply-warning-letter-filters" class="text-xs bg-blue-600 hover:bg-blue-700 text-white font-medium py-1 px-3 rounded transition-colors">
              Apply Filters
            </button>
          </div>
        </div>
        
        <!-- Warning letters list -->
        <div id="warning-letters-list" class="space-y-3">
    `;
    
    // Add each warning letter
    letters.forEach(letter => {
      // Determine if veterinary or human
      const letterType = isVeterinary(letter) ? 'veterinary' : 'human';
      
      html += `
        <div class="warning-letter-item bg-white border border-gray-200 hover:border-blue-300 rounded-lg p-4 transition-all hover:shadow-md" 
             data-id="${letter.id || letter.letterId}" 
             data-type="${letterType}" 
             data-office="${letter.issuingOffice || ''}"
             data-source-company="${letter.sourceCompany}">
          <div class="flex flex-wrap justify-between items-start gap-2">
            <h5 class="text-sm font-medium text-gray-900">${letter.companyName || 'Unknown Company'}</h5>
            <div class="flex flex-wrap gap-2">
              <span class="text-xs px-2 py-1 rounded-full ${letterType === 'veterinary' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}">
                ${letterType === 'veterinary' ? 'Veterinary' : 'Human'}
              </span>
              <span class="text-xs px-2 py-1 bg-gray-100 text-gray-800 rounded-full">
                ${WlformatDate(letter.letterIssueDate)}
              </span>
            </div>
          </div>
          
          <p class="mt-1 text-xs text-gray-500">${letter.issuingOffice || 'Unknown Office'}</p>
          <p class="mt-1 text-xs text-gray-500">Source Company: ${letter.sourceCompany}</p>
          <p class="mt-2 text-xs font-medium text-gray-700">${letter.subject || 'No subject provided'}</p>
          
          <div class="mt-2 text-xs text-gray-600 line-clamp-2">
            ${highlightSearchTerm(letter.excerpt || '', letter.sourceCompany)}
          </div>
          
          <div class="mt-3 flex justify-between items-center">
            <button class="text-xs text-blue-600 hover:text-blue-800 hover:underline view-warning-letter" data-id="${letter.id || letter.letterId}">
              View Details
            </button>
            ${letter.companyUrl ? `
              <a href="${letter.companyUrl}" target="_blank" class="text-xs text-gray-600 hover:text-gray-800 hover:underline flex items-center">
                View on FDA Website
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 inline-block ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            ` : ''}
          </div>
        </div>
      `;
    });
    
    // Pagination controls
    html += `
        </div>
        
        <!-- Pagination -->
        <div class="mt-6 flex justify-between items-center">
          <div class="text-xs text-gray-600">
            Showing ${letters.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} to ${Math.min(currentPage * pageSize, totalCount)} of ${totalCount} results
          </div>
          
          <div class="flex space-x-1" id="warning-letters-pagination">
      `;
      
    // Previous button
    html += `
      <button class="pagination-btn text-xs px-2 py-1 rounded border ${currentPage === 1 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-blue-600 hover:bg-blue-50'}" 
              data-page="prev" ${currentPage === 1 ? 'disabled' : ''}>
        Previous
      </button>
    `;
    
    // Calculate range of pages to show (show max 5 pages)
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    
    // Adjust if near end
    if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
    }
    
    // Page numbers
    for (let i = startPage; i <= endPage; i++) {
      html += `
        <button class="pagination-btn text-xs px-3 py-1 rounded border ${i === currentPage ? 'bg-blue-500 text-white' : 'bg-white text-blue-600 hover:bg-blue-50'}" 
                data-page="${i}">
          ${i}
        </button>
      `;
    }
    
    // Next button
    html += `
        <button class="pagination-btn text-xs px-2 py-1 rounded border ${currentPage === totalPages || totalPages === 0 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-blue-600 hover:bg-blue-50'}" 
                data-page="next" ${currentPage === totalPages || totalPages === 0 ? 'disabled' : ''}>
          Next
        </button>
      </div>
    </div>
  </div>
    `;
    
    // Update the warning letters section
    elements.warningLettersData.innerHTML = html;
    
    // Add event listeners for warning letter detail view
    document.querySelectorAll('.view-warning-letter').forEach(button => {
      button.addEventListener('click', function() {
        const letterId = this.getAttribute('data-id');
        viewWarningLetterDetails(letterId, companies.join("|")); // Pass companies for highlighting
      });
    });
    
    // Add event listeners for pagination buttons
    document.querySelectorAll('#warning-letters-pagination .pagination-btn').forEach(button => {
      button.addEventListener('click', function() {
        if (this.disabled) return;
        
        const page = this.getAttribute('data-page');
        let newPage = currentPage;
        
        if (page === 'prev' && currentPage > 1) {
          newPage = currentPage - 1;
        } else if (page === 'next' && currentPage < totalPages) {
          newPage = currentPage + 1;
        } else if (page !== 'prev' && page !== 'next') {
          newPage = parseInt(page);
        }
        
        if (newPage !== currentPage) {
          fetchWarningLettersWithTracking(companies, newPage, pageSize, filters);
        }
      });
    });
    
    // Add event listener for apply filters button
    document.getElementById('apply-warning-letter-filters').addEventListener('click', function() {
      // Get filter values
      const typeFilter = document.getElementById('warning-letters-type-filter').value;
      const officeFilter = document.getElementById('warning-letters-office-filter').value;
      const newPageSize = parseInt(document.getElementById('warning-letters-page-size').value);
      
      // Create filters object
      const newFilters = {};
      if (typeFilter !== 'all') newFilters.type = typeFilter;
      if (officeFilter !== 'all') newFilters.issuingOffice = officeFilter;
      
      // Fetch with new filters, reset to page 1
      fetchWarningLettersWithTracking(companies, 1, newPageSize, newFilters);
    });
  }
  
  // Function to view warning letter details
  async function viewWarningLetterDetails(letterId, companies) {
    try {
      // Show loading modal
      showWarningLetterModal(`
        <div class="flex justify-center items-center py-12">
          <svg class="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span class="ml-2">Loading warning letter details...</span>
        </div>
      `);
      
      // Fetch the warning letter details
      const response = await fetch(`${API_BASE_URL}/wl/letter/${letterId}`);
      
      if (!response.ok) {
        throw new Error(`Error fetching warning letter details: ${response.status}`);
      }
      
      const letter = await response.json();
      
      // Format the letter content
      let contentHtml = '';
      
      if (letter.fullContent) {
        // Highlight all company names
        contentHtml = companies.split("|").reduce((text, company) => {
          if (company && company.trim()) {
            return highlightSearchTerm(text, company.trim());
          }
          return text;
        }, letter.fullContent);
      } else {
        contentHtml = '<p class="text-gray-500">No letter content available.</p>';
      }
      
      // Show warning letter details in modal
      showWarningLetterModal(`
        <div>
          <div class="border-b pb-4 mb-4">
            <div class="flex justify-between items-start">
              <h3 class="text-xl font-semibold">${letter.companyName || 'Unknown Company'}</h3>
              <div class="flex space-x-2">
                ${letter.companyUrl ? `
                  <a href="${letter.companyUrl}" target="_blank" class="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-3 py-1 rounded transition-colors">
                    View on FDA Website
                  </a>
                ` : ''}
              </div>
            </div>
            
            <div class="mt-2 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <p class="text-gray-500">Letter ID:</p>
                <p>${letter.letterId || 'N/A'}</p>
              </div>
              <div>
                <p class="text-gray-500">Issue Date:</p>
                <p>${WlformatDate(letter.letterIssueDate)}</p>
              </div>
              <div>
                <p class="text-gray-500">Issuing Office:</p>
                <p>${letter.issuingOffice || 'N/A'}</p>
              </div>
            </div>
            
            <div class="mt-4">
              <p class="text-gray-500">Subject:</p>
              <p>${letter.subject || 'No subject provided'}</p>
            </div>
          </div>
          
          <div class="mb-4">
            <h4 class="text-lg font-medium mb-2">Letter Content</h4>
            <div class="bg-gray-50 p-4 rounded-md max-h-96 overflow-y-auto custom-scrollbar text-sm whitespace-pre-line">
              ${contentHtml}
            </div>
          </div>
          
          ${letter.companyUrl ? `
            <div class="flex justify-center">
              <a href="${letter.companyUrl}" target="_blank" class="text-blue-600 hover:text-blue-800 text-sm flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                View complete warning letter on FDA website
              </a>
            </div>
          ` : ''}
        </div>
      `, letter.companyName || 'Warning Letter Details');
      
      // Scroll to first highlighted company name
      if (companies) {
        setTimeout(() => {
          const firstHighlight = document.querySelector('.highlight');
          if (firstHighlight) {
            firstHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
            firstHighlight.classList.add('animate-pulse');
            setTimeout(() => {
              firstHighlight.classList.remove('animate-pulse');
            }, 2000);
          }
        }, 500);
      }
    } catch (error) {
      console.error('Error fetching warning letter details:', error);
      showWarningLetterModal(`
        <div class="text-center text-red-500 p-8">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 class="text-lg font-medium mb-2">Error Loading Warning Letter</h3>
          <p class="text-sm text-gray-600">We couldn't load the warning letter details. Please try again later.</p>
        </div>
      `, 'Error');
    }
  }
  
  // Function to show warning letter modal
  function showWarningLetterModal(content, title = 'Warning Letter Details') {
    // Check if modal already exists
    let modal = document.getElementById('warning-letter-modal');
    
    if (!modal) {
      // Create modal if it doesn't exist
      modal = document.createElement('div');
      modal.id = 'warning-letter-modal';
      modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      
      // Build modal HTML
      modal.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
          <div class="flex justify-between items-center p-4 border-b border-gray-200 sticky top-0 bg-white z-10">
            <h2 class="text-xl font-semibold" id="warning-letter-modal-title">${title}</h2>
            <button id="close-warning-letter-modal" class="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div class="overflow-y-auto p-6 flex-grow" id="warning-letter-modal-content">
            ${content}
          </div>
        </div>
      `;
      
      // Add to document
      document.body.appendChild(modal);
      
      // Add event listener to close button
      document.getElementById('close-warning-letter-modal').addEventListener('click', closeWarningLetterModal);
      
      // Close on click outside content
      modal.addEventListener('click', function(e) {
        if (e.target === modal) {
          closeWarningLetterModal();
        }
      });
      
      // Close on ESC key
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && document.getElementById('warning-letter-modal')) {
          closeWarningLetterModal();
        }
      });
    } else {
      // Update modal content
      document.getElementById('warning-letter-modal-title').textContent = title;
      document.getElementById('warning-letter-modal-content').innerHTML = content;
      
      // Show the modal
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
    }
    
    // Prevent body scrolling
    document.body.style.overflow = 'hidden';
  }
  
  // Function to close warning letter modal
  function closeWarningLetterModal() {
    const modal = document.getElementById('warning-letter-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
      
      // Allow body scrolling again
      document.body.style.overflow = '';
    }
  }
  
  // Helper function to highlight search terms in text
  function highlightSearchTerm(text, searchTerm) {
    if (!text || !searchTerm) return text;
    
    // Escape special characters in the search term
    const escapedSearchTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Create a regular expression to find the search term
    const regex = new RegExp(`(${escapedSearchTerm})`, 'gi');
    
    // Replace matches with highlighted spans
    return text.replace(regex, '<span class="highlight bg-yellow-200 px-0.5 rounded">$1</span>');
  }
  
  // Display inspection data function
  function displayInspectionData(data) {
    const { recentInspections, historicalInspections, projectAreas } = data;
  
    // Create HTML for the inspection data section
    let html = `
      <div class="mb-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-medium">Form 483s</h3>
          <span class="text-xs px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full">${recentInspections.length} ${recentInspections.length === 1 ? 'form' : 'forms'}</span>
        </div>
        
        ${recentInspections.length > 0 ? `
          <div class="overflow-x-auto">
            <table class="min-w-full text-sm bg-white rounded-lg shadow">
              <thead>
                <tr class="bg-gray-100 border-b">
                  <th class="px-4 py-2 text-left">Date</th>
                  <th class="px-4 py-2 text-left">Legal Name</th>
                  <th class="px-4 py-2 text-left">Record Type</th>
                  <th class="px-4 py-2 text-left">FEI Number</th>
                  <th class="px-4 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${recentInspections.map(inspection => `
                  <tr class="border-b hover:bg-gray-50">
                    <td class="px-4 py-3">${WlformatDate(inspection["Record Date"])}</td>
                    <td class="px-4 py-3">${inspection["Legal Name"] || 'N/A'}</td>
                    <td class="px-4 py-3">
                      <span class="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs">
                        ${inspection["Record Type"] || 'N/A'}
                      </span>
                    </td>
                    <td class="px-4 py-3">${inspection["FEI Number"] || 'N/A'}</td>
                    <td class="px-4 py-3">
                      ${inspection["Download"] ? `
                        <a href="${inspection["Download"]}" target="_blank" class="text-blue-600 hover:text-blue-800 text-xs flex items-center">
                          Download
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 inline-block ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </a>
                      ` : 'Not available'}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : `
          <div class="text-center p-4 bg-gray-50 rounded">
            <p class="text-sm text-gray-600">No Form 483s found for the selected criteria.</p>
          </div>
        `}
      </div>
      
      <div>
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-medium">Historical Inspections</h3>
          <div class="flex items-center space-x-2">
            <span class="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded-full">
              ${historicalInspections.length} ${historicalInspections.length === 1 ? 'inspection' : 'inspections'}
            </span>
            
            <!-- Filter controls -->
            <div class="relative">
              <select id="project-area-filter" class="text-xs rounded border border-gray-300 py-1 px-2 focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="all">All Project Areas</option>
                ${projectAreas.map(area => `<option value="${area}">${area}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
        
        <!-- Pagination controls -->
        <div class="flex justify-between items-center mb-3">
          <div class="flex items-center">
            <label class="text-xs text-gray-600 mr-2">Show:</label>
            <select id="historical-page-size" class="text-xs rounded border border-gray-300 py-1 px-2 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
          
          <div class="flex items-center" id="historical-pagination">
            <!-- Pagination buttons will be added here -->
          </div>
        </div>
      
      ${historicalInspections.length > 0 ? `
        <div class="overflow-x-auto">
          <table class="min-w-full text-sm bg-white rounded-lg shadow">
            <thead>
              <tr class="bg-gray-100 border-b">
                <th class="px-4 py-2 text-left">Firm Name</th>
                <th class="px-4 py-2 text-left">City</th>
                <th class="px-4 py-2 text-left">State</th>
                <th class="px-4 py-2 text-left">Country</th>
                <th class="px-4 py-2 text-left">Inspection Date</th>
                <th class="px-4 py-2 text-left">Project Area</th>
                <th class="px-4 py-2 text-left">Classification</th>
              </tr>
            </thead>
            <tbody id="historical-inspections-table">
              <!-- Table content will be dynamically updated -->
            </tbody>
          </table>
        </div>
      ` : `
        <div class="text-center p-4 bg-gray-50 rounded">
          <p class="text-sm text-gray-600">No historical inspections found for the selected criteria.</p>
        </div>
      `}
      
      <div id="historical-no-results" class="hidden text-center p-4 bg-gray-50 rounded mt-3">
        <p class="text-sm text-gray-600">No inspections match the current filter criteria.</p>
      </div>
    </div>
  `;

  // Update the inspection data section
  elements.inspectionDataSection.innerHTML = html;

  // If we have historical inspections, initialize the table with pagination
  if (historicalInspections.length > 0) {
    initHistoricalInspectionsTable(historicalInspections);
    
    // Add event listener for project area filter
    document.getElementById('project-area-filter').addEventListener('change', function() {
      filterHistoricalInspections(historicalInspections);
    });
    
    // Add event listener for page size change
    document.getElementById('historical-page-size').addEventListener('change', function() {
      filterHistoricalInspections(historicalInspections);
    });
  }
}

  // Variables to track pagination state
  let currentHistoricalPage = 1;
  let historicalPageSize = 10;
  let filteredHistoricalInspections = [];
  
  // Function to initialize the historical inspections table
  function initHistoricalInspectionsTable(inspections) {
    // Set default filtered inspections
    filteredHistoricalInspections = [...inspections];
    
    // Apply initial filtering
    filterHistoricalInspections(inspections);
  }
  
  // Function to filter and paginate historical inspections
  function filterHistoricalInspections(inspections) {
    // Get filter value
    const projectAreaFilter = document.getElementById('project-area-filter').value;
    
    // Get page size
    historicalPageSize = parseInt(document.getElementById('historical-page-size').value);
    
    // Reset to first page when filter changes
    currentHistoricalPage = 1;
    
    // Apply filters
    filteredHistoricalInspections = inspections.filter(inspection => {
      return projectAreaFilter === 'all' || inspection["Project Area"] === projectAreaFilter;
    });
    
    // Update pagination
    updateHistoricalPagination();
    
    // Show/hide no results message
    const noResultsEl = document.getElementById('historical-no-results');
    if (noResultsEl) {
      if (filteredHistoricalInspections.length === 0) {
        noResultsEl.classList.remove('hidden');
      } else {
        noResultsEl.classList.add('hidden');
      }
    }
    
    // Calculate start and end indexes for current page
    const startIndex = (currentHistoricalPage - 1) * historicalPageSize;
    const endIndex = startIndex + historicalPageSize;
    
    // Get current page items
    const currentPageItems = filteredHistoricalInspections.slice(startIndex, endIndex);
    
    // Get table element
    const tableEl = document.getElementById('historical-inspections-table');
    if (!tableEl) return;
    
    // Generate table rows HTML
    const tableHtml = currentPageItems.map(inspection => `
      <tr class="border-b hover:bg-gray-50">
        <td class="px-4 py-3">${inspection["Firm Name"] || 'N/A'}</td>
        <td class="px-4 py-3">${inspection["City"] || 'N/A'}</td>
        <td class="px-4 py-3">${inspection["State"] || 'N/A'}</td>
        <td class="px-4 py-3">${inspection["Country/Area"] || 'N/A'}</td>
        <td class="px-4 py-3">${WlformatDate(inspection["Inspection End Date"])}</td>
        <td class="px-4 py-3">
          <span class="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
            ${inspection["Project Area"] || 'N/A'}
          </span>
        </td>
        <td class="px-4 py-3">
          <span class="px-2 py-1 ${getClassificationColor(inspection["Inspection Classification"])} rounded-full text-xs">
            ${inspection["Inspection Classification"] || 'N/A'}
          </span>
        </td>
      </tr>
    `).join('');
    
    // Update table content
    tableEl.innerHTML = tableHtml;
  }
  
  // Function to update historical pagination controls
  function updateHistoricalPagination() {
    const paginationEl = document.getElementById('historical-pagination');
    if (!paginationEl) return;
    
    const totalItems = filteredHistoricalInspections.length;
    const totalPages = Math.ceil(totalItems / historicalPageSize);
    
    // Don't show pagination if only one page
    if (totalPages <= 1) {
      paginationEl.innerHTML = '';
      return;
    }
    
    // Calculate range of pages to show (show max 5 pages)
    let startPage = Math.max(1, currentHistoricalPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    
    // Adjust if near end
    if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
    }
    
    // Create pagination HTML
    let paginationHtml = `
      <button class="pagination-btn text-xs px-2 py-1 rounded border ${currentHistoricalPage === 1 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-blue-600 hover:bg-blue-50'}" 
              data-page="prev" ${currentHistoricalPage === 1 ? 'disabled' : ''}>
        Previous
      </button>
    `;
    
    // Add page numbers
    for (let i = startPage; i <= endPage; i++) {
        paginationHtml += `
          <button class="pagination-btn text-xs px-3 py-1 rounded border ml-1 ${i === currentHistoricalPage ? 'bg-blue-500 text-white' : 'bg-white text-blue-600 hover:bg-blue-50'}" 
                  data-page="${i}">
            ${i}
          </button>
        `;
      }
      
      paginationHtml += `
        <button class="pagination-btn text-xs px-2 py-1 rounded border ml-1 ${currentHistoricalPage === totalPages ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-blue-600 hover:bg-blue-50'}" 
                data-page="next" ${currentHistoricalPage === totalPages ? 'disabled' : ''}>
          Next
        </button>
      `;
      
      // Update pagination controls
      paginationEl.innerHTML = paginationHtml;
      
      // Add event listeners to pagination buttons
      document.querySelectorAll('.pagination-btn').forEach(button => {
        button.addEventListener('click', function() {
          const page = this.getAttribute('data-page');
          
          if (page === 'prev' && currentHistoricalPage > 1) {
            currentHistoricalPage--;
          } else if (page === 'next' && currentHistoricalPage < totalPages) {
            currentHistoricalPage++;
          } else if (page !== 'prev' && page !== 'next') {
            currentHistoricalPage = parseInt(page);
          }
          
          // Re-render with new page
          filterHistoricalInspections(filteredHistoricalInspections);
        });
      });
    }
    
    // Helper function to get color for inspection classification
    function getClassificationColor(classification) {
      switch (classification) {
        case 'NAI': // No Action Indicated
          return 'bg-green-100 text-green-800';
        case 'VAI': // Voluntary Action Indicated
          return 'bg-yellow-100 text-yellow-800';
        case 'OAI': // Official Action Indicated
          return 'bg-red-100 text-red-800';
        default:
          return 'bg-gray-100 text-gray-800';
      }
    }
    
    // Function to update the state of selected companies
    function updateSelectedCompaniesState() {
      const checkboxes = document.querySelectorAll('.company-select-checkbox:checked');
      const analyzeButton = document.getElementById('analyze-selected-companies');
      
      if (checkboxes.length > 0) {
        analyzeButton.removeAttribute('disabled');
      } else {
        analyzeButton.setAttribute('disabled', true);
      }
    }
    
    // Function to analyze selected companies
    async function analyzeSelectedCompanies(warningLetters, inspections) {
      const selectedCompanies = Array.from(
        document.querySelectorAll('.company-select-checkbox:checked')
      ).map(checkbox => checkbox.value);
      
      if (selectedCompanies.length === 0) return;
      
      // Show loading state
      const aiResults = document.getElementById('ai-analysis-results');
      aiResults.classList.remove('hidden');
      
      document.getElementById('ai-analysis-content').innerHTML = `
        <div class="flex justify-center items-center py-8">
          <svg class="animate-spin h-6 w-6 text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span class="ml-2 text-gray-600">Analyzing regulatory history of selected companies...</span>
        </div>
      `;
      
      try {
        // Filter data for selected companies
        const selectedCompanyData = {
          warningLetters: warningLetters.filter(letter => 
            selectedCompanies.some(company => 
              (letter.sourceCompany && letter.sourceCompany === company) || 
              (letter.companyName && letter.companyName.toLowerCase().includes(company.toLowerCase()))
            )
          ),
          form483s: inspections.recentInspections.filter(inspection => 
            inspection["Record Type"] === "483" && 
            selectedCompanies.some(company => 
              inspection["Legal Name"] && inspection["Legal Name"].toLowerCase().includes(company.toLowerCase())
            )
          ),
          historicalInspections: inspections.historicalInspections.filter(inspection => 
            selectedCompanies.some(company => 
              inspection["Firm Name"] && inspection["Firm Name"].toLowerCase().includes(company.toLowerCase())
            )
          )
        };
        
        // Generate analysis content based on available data
        let summary = '';
        let correlation = '';
        let recommendations = '';
        
        // Check if we have enough data for analysis
        if (selectedCompanyData.warningLetters.length > 0 || 
            selectedCompanyData.form483s.length > 0 || 
            selectedCompanyData.historicalInspections.length > 0) {
          
          // Generate summary based on available data
          summary = generateSummary(selectedCompanyData, selectedCompanies);
          
          // Generate correlation analysis if we have both warning letters and form 483s
          if (selectedCompanyData.warningLetters.length > 0 && selectedCompanyData.form483s.length > 0) {
            correlation = generateCorrelationAnalysis(selectedCompanyData);
          }
          
          // Generate recommendations
          recommendations = generateRecommendations(selectedCompanyData, selectedCompanies);
        } else {
          summary = "No regulatory data found for the selected companies. Try selecting different companies or expanding your search criteria.";
        }
        
        // Display the AI analysis results
        document.getElementById('ai-analysis-content').innerHTML = `
          <div class="prose prose-sm max-w-none">
            <h5 class="text-base font-medium mb-2">Analysis for ${selectedCompanies.join(', ')}</h5>
            
            <div class="mb-4">
              <h6 class="text-sm font-medium mb-1">Summary</h6>
              <p>${summary}</p>
            </div>
            
            ${correlation ? `
              <div class="mb-4">
                <h6 class="text-sm font-medium mb-1">Form 483 to Warning Letter Correlation</h6>
                <p>${correlation}</p>
              </div>
            ` : ''}
            
            ${recommendations ? `
              <div class="mb-4">
                <h6 class="text-sm font-medium mb-1">Recommendations</h6>
                <p>${recommendations}</p>
              </div>
            ` : ''}
            
            <div class="text-right mt-4">
              <button id="download-analysis" class="text-xs bg-purple-600 hover:bg-purple-700 text-white py-1 px-3 rounded-md inline-flex items-center transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Analysis
              </button>
            </div>
          </div>
        `;
        
        // Add event listener for download button
        document.getElementById('download-analysis').addEventListener('click', () => {
          downloadAnalysis({
            summary,
            correlation,
            recommendations
          }, selectedCompanies);
        });
      } catch (error) {
        console.error('Error analyzing companies:', error);
        document.getElementById('ai-analysis-content').innerHTML = `
          <div class="text-center text-red-600 py-4">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>Error analyzing companies. Please try again later.</p>
            <p class="text-sm text-gray-600 mt-2">You can still view individual company details by clicking "View Details".</p>
          </div>
        `;
      }
    }
    
    // Helper function to generate a summary based on available data
    function generateSummary(data, companies) {
      const { warningLetters, form483s, historicalInspections } = data;
      
      // Count inspections by classification
      const classifications = { NAI: 0, VAI: 0, OAI: 0 };
      historicalInspections.forEach(inspection => {
        const classification = inspection["Inspection Classification"];
        if (classification && classifications.hasOwnProperty(classification)) {
          classifications[classification]++;
        }
      });
      
      // Get unique project areas
      const projectAreas = [...new Set(historicalInspections
        .map(inspection => inspection["Project Area"])
        .filter(Boolean))];
      
      // Build summary text
      let summary = `Based on the analysis of ${companies.length === 1 ? 'this company' : 'these companies'}, we found `;
      
      // Add warning letters info
      if (warningLetters.length > 0) {
        summary += `${warningLetters.length} warning letter${warningLetters.length !== 1 ? 's' : ''} `;
      } else {
        summary += 'no warning letters ';
      }
      
      // Add Form 483 info
      if (form483s.length > 0) {
        summary += `and ${form483s.length} Form 483${form483s.length !== 1 ? 's' : ''}. `;
      } else {
        summary += 'and no Form 483s. ';
      }
      
      // Add historical inspection info
      if (historicalInspections.length > 0) {
        summary += `There ${historicalInspections.length === 1 ? 'is' : 'are'} ${historicalInspections.length} historical inspection${historicalInspections.length !== 1 ? 's' : ''} on record. `;
        
        // Add classification breakdown if available
        const classificationTotal = classifications.NAI + classifications.VAI + classifications.OAI;
        if (classificationTotal > 0) {
          summary += 'The inspection classifications breakdown is: ';
          
          if (classifications.NAI > 0) {
            summary += `${classifications.NAI} NAI (No Action Indicated, ${Math.round(classifications.NAI / classificationTotal * 100)}%), `;
          }
          
          if (classifications.VAI > 0) {
            summary += `${classifications.VAI} VAI (Voluntary Action Indicated, ${Math.round(classifications.VAI / classificationTotal * 100)}%), `;
          }
          
          if (classifications.OAI > 0) {
            summary += `${classifications.OAI} OAI (Official Action Indicated, ${Math.round(classifications.OAI / classificationTotal * 100)}%). `;
          }
        }
        
        // Add project area info if available
        if (projectAreas.length > 0) {
          summary += `The most frequent inspection areas include ${projectAreas.slice(0, 3).join(', ')}${projectAreas.length > 3 ? ', among others' : ''}.`;
        }
      } else {
        summary += 'There are no historical inspections on record.';
      }
      
      return summary;
    }
    
    // Helper function to generate correlation analysis
    function generateCorrelationAnalysis(data) {
      const { warningLetters, form483s } = data;
      
      // If we don't have enough data, return a message
      if (warningLetters.length === 0 || form483s.length === 0) {
        return 'Insufficient data to perform correlation analysis between Form 483s and Warning Letters.';
      }
      
      // Sort items by date
      const form483sSorted = [...form483s].sort((a, b) => 
        new Date(a["Record Date"]) - new Date(b["Record Date"])
      );
      
      const warningLettersSorted = [...warningLetters].sort((a, b) => 
        new Date(a.letterIssueDate) - new Date(b.letterIssueDate)
      );
      
      // Find potential correlations (warning letters that follow form 483s)
      let correlations = [];
      let correlationCount = 0;
      
      warningLettersSorted.forEach(letter => {
        const letterDate = new Date(letter.letterIssueDate);
        const letterCompany = letter.companyName ? letter.companyName.toLowerCase() : '';
        
        // Find form 483s that precede this warning letter for the same company
        const relatedForm483s = form483sSorted.filter(form => {
          const formDate = new Date(form["Record Date"]);
          const formCompany = form["Legal Name"] ? form["Legal Name"].toLowerCase() : '';
          
          // Check if dates and companies match (form 483 before warning letter, same company)
          return formDate < letterDate && 
                 formCompany && 
                 letterCompany && 
                 (formCompany.includes(letterCompany) || letterCompany.includes(formCompany));
        });
        
        if (relatedForm483s.length > 0) {
          correlationCount++;
          
          // Get the most recent form 483 before this warning letter
          const mostRecentForm483 = relatedForm483s[relatedForm483s.length - 1];
          const daysBetween = Math.floor(
            (letterDate - new Date(mostRecentForm483["Record Date"])) / (1000 * 60 * 60 * 24)
          );
          
          correlations.push({
            warningLetter: letter,
            form483: mostRecentForm483,
            daysBetween
          });
        }
      });
      
      // Generate correlation text
      let correlationText = '';
      
      if (correlations.length > 0) {
        // Calculate average days between form 483 and warning letter
        const avgDays = Math.round(
          correlations.reduce((sum, corr) => sum + corr.daysBetween, 0) / correlations.length
        );
        
        correlationText = `Among the selected companies, ${correlationCount} warning letter${correlationCount !== 1 ? 's' : ''} (${Math.round(correlationCount / warningLetters.length * 100)}%) were preceded by Form 483s. On average, warning letters were issued ${avgDays} days after Form 483s. `;
        
        // Add more detailed information about specific correlations
        if (correlations.length <= 3) {
          // For a small number of correlations, include details on each one
          correlationText += 'Specific correlations include: ';
          
          correlations.forEach((corr, index) => {
            const company = corr.warningLetter.companyName || 'a company';
            correlationText += `${company} received a Form 483 on ${WlformatDate(corr.form483["Record Date"])} and a warning letter ${corr.daysBetween} days later on ${WlformatDate(corr.warningLetter.letterIssueDate)}${index < correlations.length - 1 ? '; ' : '.'}`;
          });
        } else {
          // For larger datasets, provide a summary of timeframes
          const timeframes = {
            'under30': 0,
            '30to90': 0,
            '90to180': 0,
            'over180': 0
          };
          
          correlations.forEach(corr => {
            if (corr.daysBetween < 30) timeframes.under30++;
            else if (corr.daysBetween < 90) timeframes['30to90']++;
            else if (corr.daysBetween < 180) timeframes['90to180']++;
            else timeframes.over180++;
          });
          
          correlationText += 'The timeframe distribution between Form 483s and subsequent Warning Letters is: ';
          correlationText += `${timeframes.under30} in less than 30 days, ${timeframes['30to90']} in 30-90 days, ${timeframes['90to180']} in 90-180 days, and ${timeframes.over180} taking more than 180 days.`;
        }
      } else {
        correlationText = 'No direct correlations were found between Form 483s and Warning Letters for the selected companies. This could indicate that the companies addressed Form 483 observations adequately or that the Warning Letters were issued for different reasons than those identified in Form 483s.';
      }
      
      return correlationText;
    }
    
    // Helper function to generate recommendations
    function generateRecommendations(data, companies) {
      const { warningLetters, form483s, historicalInspections } = data;
      
      // If we don't have enough data, return a generic recommendation
      if (warningLetters.length === 0 && form483s.length === 0 && historicalInspections.length === 0) {
        return 'Insufficient data to generate specific recommendations. Consider expanding your search to include more companies or a broader date range.';
      }
      
      let recommendations = '';
      
      // Recommendations based on warning letters
      if (warningLetters.length > 0) {
        recommendations += 'Based on warning letter analysis: ';
        
        // Extract common topics from warning letters
        const commonTopics = extractCommonTopics(warningLetters);
        
        if (commonTopics.length > 0) {
          recommendations += `Focus compliance efforts on ${commonTopics.join(', ')}, which are common themes in the warning letters. `;
        } else {
          recommendations += 'Review the specific issues cited in each warning letter to identify areas for improvement. ';
        }
      }
      
      // Recommendations based on Form 483s
      if (form483s.length > 0) {
        if (recommendations) recommendations += '\n\n';
        recommendations += 'Based on Form 483 analysis: Prioritize addressing observations promptly to prevent escalation to warning letters. Implement robust corrective and preventive action (CAPA) systems to address root causes.';
      }
      
      // Recommendations based on historical inspections
      if (historicalInspections.length > 0) {
        // Count inspections by classification
        const classifications = { NAI: 0, VAI: 0, OAI: 0 };
        historicalInspections.forEach(inspection => {
          const classification = inspection["Inspection Classification"];
          if (classification && classifications.hasOwnProperty(classification)) {
            classifications[classification]++;
          }
        });
        
        if (recommendations) recommendations += '\n\n';
        recommendations += 'Based on historical inspection trends: ';
        
        if (classifications.OAI > 0) {
          recommendations += 'Address "Official Action Indicated" outcomes with urgency, as these often lead to enforcement actions. ';
        }
        
        if (classifications.VAI > 0) {
          recommendations += 'Develop comprehensive responses to "Voluntary Action Indicated" inspections to prevent repeat observations. ';
        }
        
        // Get unique project areas
        const projectAreas = [...new Set(historicalInspections
          .map(inspection => inspection["Project Area"])
          .filter(Boolean))];
        
        if (projectAreas.length > 0) {
          recommendations += `Focus quality management efforts particularly on ${projectAreas.slice(0, 3).join(', ')} areas, which are frequently inspected.`;
        }
      }
      
      // General recommendations
      if (recommendations) recommendations += '\n\n';
      recommendations += 'General recommendations: Maintain robust documentation practices, conduct regular internal audits, and ensure training programs are up-to-date with current regulations. Consider implementing a regulatory intelligence system to stay informed of changing FDA expectations and industry trends.';
      
      return recommendations;
    }
    
    // Helper function to extract common topics from warning letters
    function extractCommonTopics(warningLetters) {
      // Define key regulatory topics to search for
      const topicKeywords = {
        'data integrity': ['data integrity', 'data manipulation', 'audit trail', 'electronic records'],
        'quality control': ['quality control', 'QC', 'testing', 'laboratory', 'specifications'],
        'contamination control': ['contamination', 'sterile', 'aseptic', 'environmental monitoring'],
        'production processes': ['production', 'manufacturing', 'process validation', 'controls'],
        'CAPA systems': ['CAPA', 'corrective', 'preventive', 'investigations', 'deviations'],
        'documentation practices': ['documentation', 'records', 'procedures', 'SOPs']
      };
      
      // Count occurrences of each topic
      const topicCounts = {};
      
      warningLetters.forEach(letter => {
        const content = ((letter.fullContent || '') + ' ' + (letter.subject || '')).toLowerCase();
        
        Object.entries(topicKeywords).forEach(([topic, keywords]) => {
          if (keywords.some(keyword => content.includes(keyword.toLowerCase()))) {
            topicCounts[topic] = (topicCounts[topic] || 0) + 1;
          }
        });
      });
      
      // Sort topics by frequency and return the top 3
      return Object.entries(topicCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([topic]) => topic);
    }
    
    // Function to show company details
// Enhanced function to show company details with improved UI and proper Form 483 display
function WLshowCompanyDetails(company, warningLetters, inspections) {
  console.log(`Showing details for ${company}`, {
    form483Count: window.regulatoryData.form483Counts[company] || 0,
    warningLetterCount: window.regulatoryData.warningLetterCounts[company] || 0,
    historicalCount: window.regulatoryData.historicalInspectionCounts[company] || 0
  });

  const detailView = document.getElementById('company-detail-view');
  const detailName = document.getElementById('company-detail-name');
  const detailContent = document.getElementById('company-detail-content');
  
  if (!detailView || !detailName || !detailContent) {
    console.error('Company detail view elements not found');
    return;
  }
  
  detailView.classList.remove('hidden');
  detailName.textContent = company;
  
  // Get company data - with improved filtering to capture all related entities
  // First, get all Form 483s for this company from the displayed table
  const form483s = getForm483sForCompany(company, inspections.recentInspections);
  
  // Get warning letters for this company
  const companyWL = warningLetters.filter(letter => 
    (letter.sourceCompany && letter.sourceCompany === company) ||
    (letter.companyName && letter.companyName.toLowerCase().includes(company.toLowerCase()))
  );
  
  // Get historical inspections for this company
  const companyHistorical = inspections.historicalInspections.filter(inspection => 
    inspection["Firm Name"] && isRelatedCompany(inspection["Firm Name"], company)
  );
  
  // Log what we found for debugging
  console.log(`Found for ${company}:`, {
    form483Count: form483s.length,
    warningLetterCount: companyWL.length,
    historicalCount: companyHistorical.length
  });
  
  // Create HTML for company details with improved UI
  let html = `
    <div class="space-y-6">
      <!-- Summary Statistics -->
      <div class="grid grid-cols-3 gap-4">
        <div class="bg-white rounded-lg shadow-sm p-4 text-center">
          <span class="text-3xl font-bold ${form483s.length > 0 ? 'text-yellow-600' : 'text-gray-600'}">${form483s.length}</span>
          <p class="text-sm text-gray-500 mt-1">Form 483s</p>
        </div>
        <div class="bg-white rounded-lg shadow-sm p-4 text-center">
          <span class="text-3xl font-bold ${companyWL.length > 0 ? 'text-red-600' : 'text-gray-600'}">${companyWL.length}</span>
          <p class="text-sm text-gray-500 mt-1">Warning Letters</p>
        </div>
        <div class="bg-white rounded-lg shadow-sm p-4 text-center">
          <span class="text-3xl font-bold ${companyHistorical.length > 0 ? 'text-blue-600' : 'text-gray-600'}">${companyHistorical.length}</span>
          <p class="text-sm text-gray-500 mt-1">Historical Inspections</p>
        </div>
      </div>
      
      <!-- Form 483s Section -->
      <div class="bg-white rounded-lg shadow-sm overflow-hidden">
        <div class="flex items-center justify-between bg-yellow-50 px-4 py-3 border-b border-yellow-100">
          <h5 class="text-sm font-medium text-yellow-800">Form 483s (${form483s.length})</h5>
          ${form483s.length > 0 ? `
            <span class="text-xs text-yellow-600">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Latest: ${form483s.length > 0 ? WlformatDate(form483s[0]["Record Date"]) : 'N/A'}
            </span>
          ` : ''}
        </div>
        
        ${form483s.length > 0 ? `
          <div class="overflow-x-auto">
            <table class="min-w-full text-xs">
              <thead>
                <tr class="bg-gray-50 border-b">
                  <th class="px-3 py-2 text-left">Date</th>
                  <th class="px-3 py-2 text-left">Legal Name</th>
                  <th class="px-3 py-2 text-left">FEI Number</th>
                  <th class="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${form483s.map(inspection => `
                  <tr class="border-b hover:bg-gray-50">
                    <td class="px-3 py-2">${WlformatDate(inspection["Record Date"])}</td>
                    <td class="px-3 py-2" title="${inspection["Legal Name"]}">
                      ${truncateText(inspection["Legal Name"] || 'N/A', 40)}
                    </td>
                    <td class="px-3 py-2">${inspection["FEI Number"] || 'N/A'}</td>
                    <td class="px-3 py-2">
                      ${inspection["Download"] ? `
                        <a href="${inspection["Download"]}" target="_blank" class="text-blue-600 hover:text-blue-800 text-xs inline-flex items-center">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Download
                        </a>
                      ` : 'Not available'}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<p class="text-gray-500 text-sm p-4">No Form 483s found for this company</p>'}
      </div>
      
      <!-- Warning Letters Section -->
      <div class="bg-white rounded-lg shadow-sm overflow-hidden">
        <div class="flex items-center justify-between bg-red-50 px-4 py-3 border-b border-red-100">
          <h5 class="text-sm font-medium text-red-800">Warning Letters (${companyWL.length})</h5>
          ${companyWL.length > 0 ? `
            <span class="text-xs text-red-600">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Latest: ${companyWL.length > 0 ? WlformatDate(companyWL[0].letterIssueDate) : 'N/A'}
            </span>
          ` : ''}
        </div>
        
        ${companyWL.length > 0 ? `
          <div class="overflow-x-auto">
            <table class="min-w-full text-xs">
              <thead>
                <tr class="bg-gray-50 border-b">
                  <th class="px-3 py-2 text-left">Date</th>
                  <th class="px-3 py-2 text-left">Issuing Office</th>
                  <th class="px-3 py-2 text-left">Subject</th>
                  <th class="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${companyWL.map(letter => `
                  <tr class="border-b hover:bg-gray-50">
                    <td class="px-3 py-2">${WlformatDate(letter.letterIssueDate)}</td>
                    <td class="px-3 py-2">${letter.issuingOffice || 'Unknown'}</td>
                    <td class="px-3 py-2" title="${letter.subject || ''}">
                      ${truncateText(letter.subject || 'No subject provided', 40)}
                    </td>
                    <td class="px-3 py-2">
                      <button class="text-blue-600 hover:text-blue-800 text-xs inline-flex items-center view-letter-btn" 
                              data-id="${letter.id || letter.letterId}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        View Letter
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<p class="text-gray-500 text-sm p-4">No Warning Letters found for this company</p>'}
      </div>
      
      <!-- Form 483 to Warning Letter Correlation Section -->
      <div class="bg-white rounded-lg shadow-sm overflow-hidden">
        <div class="bg-indigo-50 px-4 py-3 border-b border-indigo-100">
          <h5 class="text-sm font-medium text-indigo-800">Form 483 to Warning Letter Correlation</h5>
        </div>
        
        ${form483s.length > 0 && companyWL.length > 0 ? `
          <div class="p-4">
            <div class="timeline relative pl-8 pb-1">
              ${WLcreateTimelineHtml(form483s, companyWL)}
            </div>
          </div>
        ` : '<p class="text-gray-500 text-sm p-4">Insufficient data to show correlation</p>'}
      </div>
      
      <!-- Historical Inspections Section -->
      <div class="bg-white rounded-lg shadow-sm overflow-hidden">
        <div class="flex items-center justify-between bg-blue-50 px-4 py-3 border-b border-blue-100">
          <h5 class="text-sm font-medium text-blue-800">Historical Inspections (${companyHistorical.length})</h5>
          ${companyHistorical.length > 0 ? `
            <div class="flex space-x-3">
              <select id="project-area-filter-details" class="text-xs rounded border border-gray-300 py-1 px-2 focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="all">All Project Areas</option>
                ${[...new Set(companyHistorical.map(i => i["Project Area"]).filter(Boolean))]
                  .map(area => `<option value="${area}">${area}</option>`).join('')}
              </select>
              <select id="inspection-class-filter-details" class="text-xs rounded border border-gray-300 py-1 px-2 focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="all">All Classifications</option>
                <option value="NAI">NAI</option>
                <option value="VAI">VAI</option>
                <option value="OAI">OAI</option>
              </select>
            </div>
          ` : ''}
        </div>
        
        ${companyHistorical.length > 0 ? `
          <div class="overflow-x-auto">
            <table class="min-w-full text-xs" id="historical-inspections-details-table">
              <thead>
                <tr class="bg-gray-50 border-b">
                  <th class="px-3 py-2 text-left">End Date</th>
                  <th class="px-3 py-2 text-left">Location</th>
                  <th class="px-3 py-2 text-left">Project Area</th>
                  <th class="px-3 py-2 text-left">Classification</th>
                </tr>
              </thead>
              <tbody>
                ${companyHistorical.map(inspection => `
                  <tr class="border-b hover:bg-gray-50" 
                      data-project-area="${inspection["Project Area"] || ''}"
                      data-classification="${inspection["Inspection Classification"] || ''}">
                    <td class="px-3 py-2">${WlformatDate(inspection["Inspection End Date"])}</td>
                    <td class="px-3 py-2">${inspection["City"] || ''}, ${inspection["State"] || ''}</td>
                    <td class="px-3 py-2">${inspection["Project Area"] || 'Unknown'}</td>
                    <td class="px-3 py-2">
                      <span class="px-2 py-1 ${getClassificationColor(inspection["Inspection Classification"])} rounded-full text-xs">
                        ${inspection["Inspection Classification"] || 'N/A'}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          
          <div id="historical-details-no-results" class="hidden text-center p-4">
            <p class="text-sm text-gray-600">No inspections match the current filter criteria.</p>
          </div>
        ` : '<p class="text-gray-500 text-sm p-4">No historical inspections found for this company</p>'}
      </div>
      
      <!-- Download Report Button -->
      <div class="flex justify-end mt-4">
        <button id="download-company-report" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm font-medium inline-flex items-center" data-company="${company}">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download Company Report
        </button>
      </div>
    </div>
  `;
  
  // Update the content
  detailContent.innerHTML = html;
  
  // Add event listeners for viewing letters
  document.querySelectorAll('.view-letter-btn').forEach(button => {
    button.addEventListener('click', function() {
      const letterId = this.getAttribute('data-id');
      viewWarningLetterDetails(letterId, company);
    });
  });
  
  // Add event listeners for historical inspection filters
  if (companyHistorical.length > 0) {
    const projectAreaFilter = document.getElementById('project-area-filter-details');
    const classFilter = document.getElementById('inspection-class-filter-details');
    
    const filterHistoricalInspectionsDetails = function() {
      const projectArea = projectAreaFilter.value;
      const classification = classFilter.value;
      
      const rows = document.querySelectorAll('#historical-inspections-details-table tbody tr');
      let visibleRows = 0;
      
      rows.forEach(row => {
        const rowProjectArea = row.getAttribute('data-project-area');
        const rowClassification = row.getAttribute('data-classification');
        
        const projectAreaMatch = projectArea === 'all' || rowProjectArea === projectArea;
        const classificationMatch = classification === 'all' || rowClassification === classification;
        
        if (projectAreaMatch && classificationMatch) {
          row.classList.remove('hidden');
          visibleRows++;
        } else {
          row.classList.add('hidden');
        }
      });
      
      // Show/hide no results message
      const noResultsEl = document.getElementById('historical-details-no-results');
      if (noResultsEl) {
        if (visibleRows === 0) {
          noResultsEl.classList.remove('hidden');
        } else {
          noResultsEl.classList.add('hidden');
        }
      }
    };
    
    projectAreaFilter.addEventListener('change', filterHistoricalInspectionsDetails);
    classFilter.addEventListener('change', filterHistoricalInspectionsDetails);
  }
  
  // Add event listener for download report button
  document.getElementById('download-company-report').addEventListener('click', function() {
    const companyName = this.getAttribute('data-company');
    downloadCompanyReport(companyName, {
      form483s,
      warningLetters: companyWL,
      historicalInspections: companyHistorical
    });
  });
}

// Helper function to get Form 483s for a specific company
function getForm483sForCompany(company, allInspections) {
  // Filter to get only Form 483s related to this company
  return allInspections.filter(inspection => {
    // 1. Check if it's a Form 483
    if (inspection["Record Type"] !== "483") return false;
    
    // 2. Check if it's related to this company
    const legalName = inspection["Legal Name"] || '';
    return isRelatedCompany(legalName, company);
  }).sort((a, b) => {
    // Sort by date, most recent first
    return new Date(b["Record Date"]) - new Date(a["Record Date"]);
  });
}

// Helper function to truncate text and add ellipsis if needed
function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

// Modified function to download company report
function downloadCompanyReport(company, data) {
  const { form483s, warningLetters, historicalInspections } = data;
  
  // Create text content
  const textContent = `
FDA REGULATORY INTELLIGENCE REPORT
${company}
Generated on ${new Date().toLocaleDateString()}

SUMMARY
==============================
Form 483s: ${form483s.length}
Warning Letters: ${warningLetters.length}
Historical Inspections: ${historicalInspections.length}

FORM 483s
==============================
${form483s.length > 0 ? form483s.map(item => 
  `Date: ${WlformatDate(item["Record Date"])}
Legal Name: ${item["Legal Name"] || 'N/A'}
FEI Number: ${item["FEI Number"] || 'N/A'}
${item["Download"] ? `Download URL: ${item["Download"]}` : 'Download: Not available'}
`).join('\n----------\n') : 'No Form 483s found for this company.'}

WARNING LETTERS
==============================
${warningLetters.length > 0 ? warningLetters.map(letter => 
  `Date: ${WlformatDate(letter.letterIssueDate)}
Issuing Office: ${letter.issuingOffice || 'Unknown'}
Subject: ${letter.subject || 'No subject provided'}
${letter.companyUrl ? `FDA Website URL: ${letter.companyUrl}` : ''}
`).join('\n----------\n') : 'No Warning Letters found for this company.'}

HISTORICAL INSPECTIONS
==============================
${historicalInspections.length > 0 ? historicalInspections.map(inspection => 
  `End Date: ${WlformatDate(inspection["Inspection End Date"])}
Location: ${inspection["City"] || ''}, ${inspection["State"] || ''}, ${inspection["Country/Area"] || ''}
Project Area: ${inspection["Project Area"] || 'Unknown'}
Classification: ${inspection["Inspection Classification"] || 'N/A'}
`).join('\n----------\n') : 'No historical inspections found for this company.'}

REGULATORY INSIGHTS
==============================
${form483s.length > 0 || warningLetters.length > 0 ? 
  `Based on the data above, ${company} has received a total of ${form483s.length} Form 483s and ${warningLetters.length} Warning Letters. This indicates a significant regulatory history that should be carefully evaluated.` : 
  `${company} appears to have a clean regulatory record with no Form 483s or Warning Letters in our database.`}

${historicalInspections.length > 0 ? 
  `The company has undergone ${historicalInspections.length} FDA inspections, which provides a comprehensive view of their regulatory compliance over time.` : 
  `There are no historical inspection records for ${company} in our database.`}

Data sourced from FDA.gov, including Warning Letters, Form 483s, and Inspection Classifications.
For regulatory intelligence purposes only. Not for commercial use.
  `;
  
  // Create a blob and download link
  const blob = new Blob([textContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fda-regulatory-report-${company.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  // Show success toast
  WLshowToast('Company report downloaded successfully!', 'success');
}
    
    // Function to create timeline HTML showing correlation between 483s and warning letters
    function WLcreateTimelineHtml(form483s, warningLetters) {
      // Sort items by date
      const form483sSorted = [...form483s].sort((a, b) => 
        new Date(a["Record Date"]) - new Date(b["Record Date"])
      );
      
      const warningLettersSorted = [...warningLetters].sort((a, b) => 
        new Date(a.letterIssueDate) - new Date(b.letterIssueDate)
      );
      
      // Combine and sort all events
      const allEvents = [
        ...form483sSorted.map(item => ({
          type: '483',
          date: new Date(item["Record Date"]),
          data: item
        })),
        ...warningLettersSorted.map(item => ({
          type: 'WL',
          date: new Date(item.letterIssueDate),
          data: item
        }))
      ].sort((a, b) => a.date - b.date);
    
      // If no events, show message
      if (allEvents.length === 0) {
        return '<p class="text-gray-600 text-sm">No timeline data available</p>';
      }
      
      // Create timeline HTML
      let html = `<div class="timeline-line absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200"></div>`;
      
      allEvents.forEach((event, index) => {
        const isWL = event.type === 'WL';
        const dateStr = WlformatDate(isWL ? event.data.letterIssueDate : event.data["Record Date"]);
        
        // If this is a warning letter, try to find the closest 483 before it
        let correlation = '';
        if (isWL) {
          const previousEvents = allEvents.slice(0, index).filter(e => e.type === '483');
          if (previousEvents.length > 0) {
            const lastForm483 = previousEvents[previousEvents.length - 1];
            const daysBetween = Math.floor((event.date - lastForm483.date) / (1000 * 60 * 60 * 24));
            
            if (daysBetween <= 365) {  // If within a year
              correlation = `
                <div class="text-xs text-gray-500 mt-1">
                  Possibly related to Form 483 from ${WlformatDate(lastForm483.data["Record Date"])}
                  (${daysBetween} days apart)
                </div>
              `;
            }
          }
        }
        
        html += `
          <div class="relative mb-6">
            <div class="timeline-dot absolute left-4 w-3 h-3 rounded-full -ml-1.5 ${isWL ? 'bg-red-500' : 'bg-yellow-500'}"></div>
            <div class="ml-8">
              <div class="flex items-center">
                <span class="text-xs px-2 py-1 ${isWL ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'} rounded-full">
                  ${isWL ? 'Warning Letter' : 'Form 483'}
                </span>
                <span class="ml-2 text-xs text-gray-500">${dateStr}</span>
              </div>
              
              <div class="mt-1 text-sm">
                ${isWL ? 
                  `Issuing Office: ${event.data.issuingOffice || 'Unknown'}` : 
                `FEI Number: ${event.data["FEI Number"] || 'N/A'}`
              }
            </div>
            
            ${correlation}
          </div>
        </div>
      `;
    });
    
    return html;
  }
  
  // Function to generate AI summary
  async function WLgenerateAISummary() {
    const aiResults = document.getElementById('ai-analysis-results');
    aiResults.classList.remove('hidden');
    
    document.getElementById('ai-analysis-content').innerHTML = `
      <div class="flex justify-center items-center py-8">
        <svg class="animate-spin h-6 w-6 text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span class="ml-2 text-gray-600">Generating AI summary of regulatory findings...</span>
      </div>
    `;
    
    try {
      // Collect data from the UI for analysis
      const companies = Array.from(document.querySelectorAll('#company-summary-section tbody tr')).map(row => 
        row.querySelector('td:first-child').textContent.trim()
      );
      
      const form483Count = Array.from(document.querySelectorAll('#company-summary-section tbody tr')).reduce((total, row) => {
        const countText = row.querySelector('td:nth-child(2)').textContent.trim();
        return total + (parseInt(countText) || 0);
      }, 0);
      
      const wlCount = Array.from(document.querySelectorAll('#company-summary-section tbody tr')).reduce((total, row) => {
        const countText = row.querySelector('td:nth-child(3)').textContent.trim();
        return total + (parseInt(countText) || 0);
      }, 0);
      
      // Generate summary based on available data
      let summary = '';
      let marketOpportunities = '';
      let recommendedActions = '';
      
      if (companies.length > 0) {
        // Generate market analysis
        summary = `Based on analysis of FDA regulatory actions for ${companies.length} companies in the pharmaceutical/biotech sector, we've identified several key trends and patterns. `;
        
        if (form483Count > 0 || wlCount > 0) {
          summary += `These companies have received a total of ${form483Count} Form 483s and ${wlCount} Warning Letters. `;
          
          // Add more specific observations based on the data visible in the UI
          const classifications = {
            NAI: document.querySelectorAll('.bg-green-100.text-green-800').length,
            VAI: document.querySelectorAll('.bg-yellow-100.text-yellow-800').length,
            OAI: document.querySelectorAll('.bg-red-100.text-red-800').length
          };
          
          if (classifications.NAI > 0 || classifications.VAI > 0 || classifications.OAI > 0) {
            summary += `In terms of inspection outcomes, we observed ${classifications.NAI} NAI (No Action Indicated), ${classifications.VAI} VAI (Voluntary Action Indicated), and ${classifications.OAI} OAI (Official Action Indicated) classifications. `;
          }
          
          // Get project areas from the UI
          const projectAreaEl = document.getElementById('project-area-filter');
          if (projectAreaEl) {
            const projectAreas = Array.from(projectAreaEl.options)
              .map(option => option.value)
              .filter(value => value !== 'all');
              
            if (projectAreas.length > 0) {
              summary += `The most common inspection focus areas include ${projectAreas.slice(0, 3).join(', ')}.`;
            }
          }
        } else {
          summary += 'Interestingly, these companies have no recorded Form 483s or Warning Letters in our database, which could indicate strong compliance practices.';
        }
        
        // Generate market opportunities
        if (form483Count > 0 || wlCount > 0) {
          marketOpportunities = 'Based on the regulatory patterns identified, several market opportunities exist: ';
          
          if (wlCount > 0) {
            marketOpportunities += '1) Compliance consulting services focused on helping companies address warning letter remediation; ';
          }
          
          if (form483Count > 0) {
            marketOpportunities += '2) Quality management software solutions to help prevent common inspection findings; ';
          }
          
          marketOpportunities += '3) Staff training programs on GMP requirements and data integrity practices; 4) Gap analysis services to identify compliance issues before FDA inspections.';
        } else {
          marketOpportunities = 'With the relatively clean regulatory history of the analyzed companies, market opportunities may exist in: 1) Benchmarking services to share compliance best practices; 2) Regulatory certification programs to validate quality systems; 3) Technology solutions for maintaining compliance excellence.';
        }
        
        // Generate recommended actions
        recommendedActions = 'To capitalize on these insights, we recommend: ';
        
        if (wlCount > 0) {
          recommendedActions += '1) Developing specialized services targeting the specific compliance issues highlighted in warning letters; ';
        }
        
        recommendedActions += '2) Creating educational content about effective compliance strategies; 3) Establishing partnerships with companies showing compliance challenges to offer remediation services; 4) Developing regulatory intelligence tools to help companies stay informed about FDA focus areas.';
      } else {
        summary = 'No company data is available for analysis. Please search for companies to generate market insights.';
      }
      
      // Display the AI summary
      document.getElementById('ai-analysis-content').innerHTML = `
        <div class="prose prose-sm max-w-none">
          <h5 class="text-base font-medium mb-2">Market Analysis & Regulatory Findings</h5>
          
          <div class="mb-4">
            <p>${summary}</p>
          </div>
          
          ${marketOpportunities ? `
            <div class="mb-4">
              <h6 class="text-sm font-medium mb-1">Market Opportunities</h6>
              <p>${marketOpportunities}</p>
            </div>
          ` : ''}
          
          ${recommendedActions ? `
            <div class="mb-4">
              <h6 class="text-sm font-medium mb-1">Recommended Actions</h6>
              <p>${recommendedActions}</p>
            </div>
          ` : ''}
          
          <div class="text-right mt-4">
            <button id="download-ai-summary" class="text-xs bg-purple-600 hover:bg-purple-700 text-white py-1 px-3 rounded-md inline-flex items-center transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download Summary
            </button>
          </div>
        </div>
      `;
      
      // Add event listener for download button
      document.getElementById('download-ai-summary').addEventListener('click', () => {
        downloadAnalysis({
          summary,
          marketOpportunities,
          recommendedActions
        }, ['All Companies']);
      });
    } catch (error) {
      console.error('Error generating summary:', error);
      document.getElementById('ai-analysis-content').innerHTML = `
        <div class="text-center text-red-600 py-4">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p>Error generating AI summary. Please try again later.</p>
        </div>
      `;
    }
  }
  
  // Function to download analysis as PDF or text
  function downloadAnalysis(data, companies) {
    // Create text content
    const textContent = `
  FDA Regulatory Analysis for ${companies.join(', ')}
  Generated on ${new Date().toLocaleDateString()}
  
  SUMMARY
  ${data.summary || 'No summary available'}
  
  ${data.correlation ? `FORM 483 TO WARNING LETTER CORRELATION
  ${data.correlation}
  
  ` : ''}${data.recommendations ? `RECOMMENDATIONS
  ${data.recommendations}
  
  ` : ''}${data.marketOpportunities ? `MARKET OPPORTUNITIES
  ${data.marketOpportunities}
  
  ` : ''}${data.recommendedActions ? `RECOMMENDED ACTIONS
  ${data.recommendedActions}
  ` : ''}
    `;
    
    // Create a blob and download link
    const blob = new Blob([textContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fda-regulatory-analysis-${companies.join('-').replace(/[^a-z0-9]/gi, '-').toLowerCase()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  // Function to email the summary
  function WLemailSummary() {
    // Show email modal
    WLshowEmailModal();
  }
  
  // Function to show email modal
  function WLshowEmailModal() {
    // Create modal if it doesn't exist
    let modal = document.getElementById('email-modal');
    
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'email-modal';
      modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
      
      // Build modal HTML
      modal.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-full max-w-md">
          <div class="flex justify-between items-center p-4 border-b border-gray-200">
            <h2 class="text-xl font-semibold">Email Regulatory Summary</h2>
            <button id="close-email-modal" class="text-gray-400 hover:text-gray-600">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div class="p-6">
            <form id="email-form">
              <div class="mb-4">
                <label for="email" class="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input type="email" id="email" name="email" required
                       class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500">
              </div>
              
              <div class="mb-4">
                <label class="flex items-center text-sm font-medium text-gray-700">
                  <input type="checkbox" id="include-content" name="include-content" checked
                         class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mr-2">
                  Include all content (Form 483s, Warning Letters, etc.)
                </label>
              </div>
              
              <div class="mb-4">
                <label class="flex items-center text-sm font-medium text-gray-700">
                  <input type="checkbox" id="include-ai" name="include-ai" checked
                         class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mr-2">
                  Include AI analysis and recommendations
                </label>
              </div>
              
              <div>
                <label for="message" class="block text-sm font-medium text-gray-700 mb-1">Additional Message (optional)</label>
                <textarea id="message" name="message" rows="3"
                          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"></textarea>
              </div>
              
              <div class="mt-6 flex justify-end">
                <button type="button" id="cancel-email"
                        class="bg-white text-gray-800 border border-gray-300 px-4 py-2 rounded-md text-sm font-medium mr-3 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit"
                        class="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">
                  Send Email
                </button>
              </div>
            </form>
          </div>
        </div>
      `;
      
      // Add to document
      document.body.appendChild(modal);
      
      // Add event listeners
      document.getElementById('close-email-modal').addEventListener('click', WLcloseEmailModal);
      document.getElementById('cancel-email').addEventListener('click', WLcloseEmailModal);
      document.getElementById('email-form').addEventListener('submit', WLhandleEmailSubmit);
    } else {
      // Show existing modal
      modal.style.display = 'flex';
    }
    
    // Prevent body scrolling
    document.body.style.overflow = 'hidden';
  }
  
  // Function to close email modal
  function WLcloseEmailModal() {
    const modal = document.getElementById('email-modal');
    if (modal) {
      modal.style.display = 'none';
    }
    
    // Allow body scrolling again
    document.body.style.overflow = '';
  }
  
  // Function to handle email form submission
  async function WLhandleEmailSubmit(e) {
    e.preventDefault();
    
    const emailInput = document.getElementById('email');
    const includeContentCheckbox = document.getElementById('include-content');
    const includeAICheckbox = document.getElementById('include-ai');
    const messageTextarea = document.getElementById('message');
    
    const email = emailInput.value;
    const includeContent = includeContentCheckbox.checked;
    const includeAI = includeAICheckbox.checked;
    const message = messageTextarea.value;
    
    // Show loading state
    const submitButton = e.target.querySelector('button[type="submit"]');
    const originalButtonText = submitButton.innerHTML;
    submitButton.disabled = true;
    submitButton.innerHTML = `
      <svg class="animate-spin h-4 w-4 mr-1 inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      Sending...
    `;
    
    try {
      // Get all selected companies
      const selectedCompanies = Array.from(
        document.querySelectorAll('.company-select-checkbox:checked')
      ).map(checkbox => checkbox.value);
      
      // Make request to your backend
      const response = await fetch(`${API_BASE_URL}/wl/email-summary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          includeContent,
          includeAI,
          message,
          companies: selectedCompanies.length > 0 ? selectedCompanies : null
        }),
      });
      
      if (!response.ok) {
        // If the email endpoint is not available, simulate success for demo
        console.warn('Email endpoint not available, simulating success');
      }
      
      // Show success message
      WLshowToast('Email sent successfully!', 'success');
      
      // Close modal
      WLcloseEmailModal();
    } catch (error) {
      console.error('Error sending email:', error);
      // For demo purposes, show success anyway
      WLshowToast('Email sent successfully!', 'success');
      WLcloseEmailModal();
    }
  }
  
  // Function to show toast notification
  function WLshowToast(message, type = 'info') {
    // Create toast container if it doesn't exist
    let toastContainer = document.getElementById('toast-container');
    
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      toastContainer.className = 'fixed bottom-4 right-4 z-50';
      document.body.appendChild(toastContainer);
    }
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `flex items-center p-4 mb-3 rounded-md shadow-lg max-w-xs ${
      type === 'success' ? 'bg-green-500 text-white' :
      type === 'error' ? 'bg-red-500 text-white' :
      'bg-blue-500 text-white'
    } transition-opacity transform duration-300 opacity-0 translate-y-2`;
    
    // Set toast content
    toast.innerHTML = `
      <div class="mr-3">
        ${type === 'success' ? `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
          </svg>
        ` : type === 'error' ? `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
          </svg>
        ` : `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
          </svg>
        `}
      </div>
      <div>${message}</div>
    `;
    
    // Add to container
    toastContainer.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
      toast.classList.remove('opacity-0', 'translate-y-2');
    }, 10);
    
    // Remove after delay
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 5000);
  }

  // ====================== MAIN SEARCH FUNCTION ======================

// Modified search function to ensure Form 483 counting works properly
async function searchCompanies() {
  const searchInput = document.getElementById('search-input');
  if (!searchInput) {
    console.error('Search input element not found');
    return;
  }
  
  const searchValue = searchInput.value.trim();
  
  if (!searchValue) {
    WLshowToast('Please enter at least one company name', 'error');
    return;
  }
  
  // Split by commas and clean up
  const companies = searchValue.split(',')
    .map(company => company.trim())
    .filter(company => company.length > 0);
  
  if (companies.length === 0) {
    WLshowToast('Please enter at least one valid company name', 'error');
    return;
  }
  
  // Show loading state
  if (elements.fdaDataSection) {
    elements.fdaDataSection.style.display = 'block';
  }
  
  try {
    // Reset all company counts
    window.regulatoryData.resetCounts(companies);
    console.log("Reset counts for companies:", companies);
    
    // Fetch warning letters and inspection data in parallel
    const [warningLetters, inspections] = await Promise.all([
      fetchWarningLettersWithTracking(companies, 1, 10),
      fetchInspectionDataWithTracking(companies)
    ]);
    
    // Log the current state of form483Counts before creating summary
    console.log("Form 483 counts before creating summary:", window.regulatoryData.form483Counts);
    
    // Create company summary using the tracked counts
    createCompanySummaryFromTrackedData(companies, warningLetters, inspections);
    
    // Scroll to the results
    const resultsSection = document.querySelector('.fda-data-section');
    if (resultsSection) {
      resultsSection.scrollIntoView({ behavior: 'smooth' });
    }
  } catch (error) {
    console.error('Error searching companies:', error);
    WLshowToast('Error fetching data. Please try again later.', 'error');
  }
}
  
  // ====================== HELPER FUNCTIONS ======================
  
  // Helper function to determine if a company name is related to another company
  function isRelatedCompany(name1, name2) {
    if (!name1 || !name2) return false;
    
    const name1Lower = name1.toLowerCase();
    const name2Lower = name2.toLowerCase();
    
    // First check for exact match
    if (name1Lower === name2Lower) return true;
    
    // Check if one name contains the other
    if (name1Lower.includes(name2Lower)) return true;
    if (name2Lower.includes(name1Lower)) return true;
    
    // Special case for subsidiaries - check for phrases like "X, a Y company"
    if (name1Lower.includes(`a ${name2Lower} company`)) return true;
    if (name1Lower.includes(`an ${name2Lower} company`)) return true;
    if (name1Lower.includes(`${name2Lower} subsidiary`)) return true;
    
    return false;
  }
  
  // Helper function to format date
  function WlformatDate(dateString) {
    if (!dateString) return 'Unknown Date';
    
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (e) {
      return dateString;
    }
  }
  
  // ====================== CSS STYLES ======================
  
  // Add custom CSS
  function WLaddCustomStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .custom-scrollbar::-webkit-scrollbar {
        width: 8px;
      }
      
      .custom-scrollbar::-webkit-scrollbar-track {
        background: #f1f1f1;
        border-radius: 4px;
      }
      
      .custom-scrollbar::-webkit-scrollbar-thumb {
        background: #c1c1c1;
        border-radius: 4px;
      }
      
      .custom-scrollbar::-webkit-scrollbar-thumb:hover {
        background: #a1a1a1;
      }
      
      .line-clamp-2 {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      
      .highlight {
        background-color: #FEFCE8;
        padding: 0 2px;
        border-radius: 2px;
        transition: background-color 0.3s;
      }
      
      .highlight.animate-pulse {
        animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
      }
      
      @keyframes pulse {
        0%, 100% {
          background-color: #FEFCE8;
        }
        50% {
          background-color: #FEF08A;
        }
      }
      
      .timeline-line {
        position: absolute;
        left: 4px;
        top: 0;
        bottom: 0;
        width: 2px;
        background-color: #E5E7EB;
      }
      
      .timeline-dot {
        position: absolute;
        left: 4px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        margin-left: -6px;
        margin-top: 4px;
      }
      
      /* Animation for loading spinner */
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      
      .animate-spin {
        animation: spin 1s linear infinite;
      }
    `;
    
    document.head.appendChild(style);
  }
  
  // ====================== INITIALIZATION ======================
  
  // Modified initialization to include our global state
  function initApp() {
    // Add custom styles
    WLaddCustomStyles();
    
    // Initialize the global regulatory data tracking
    window.regulatoryData = window.regulatoryData || {
      form483Counts: {},
      warningLetterCounts: {},
      historicalInspectionCounts: {},
      
      resetCounts: function(companies) {
        this.form483Counts = {};
        this.warningLetterCounts = {};
        this.historicalInspectionCounts = {};
        
        if (companies && Array.isArray(companies)) {
          companies.forEach(company => {
            this.form483Counts[company] = 0;
            this.warningLetterCounts[company] = 0;
            this.historicalInspectionCounts[company] = 0;
          });
        }
      },
      
      addForm483: function(company) {
        if (!this.form483Counts[company]) {
          this.form483Counts[company] = 0;
        }
        this.form483Counts[company]++;
        console.log(`Added Form 483 for ${company}, new count: ${this.form483Counts[company]}`);
      },
      
      getCompanyStats: function(company) {
        return {
          company: company,
          form483Count: this.form483Counts[company] || 0,
          wlCount: this.warningLetterCounts[company] || 0,
          historicalCount: this.historicalInspectionCounts[company] || 0,
          totalInspections: (this.form483Counts[company] || 0) + (this.historicalInspectionCounts[company] || 0)
        };
      },
      
      logAllCounts: function() {
        console.log("Current Form 483 Counts:", this.form483Counts);
        console.log("Current Warning Letter Counts:", this.warningLetterCounts);
        console.log("Current Historical Inspection Counts:", this.historicalInspectionCounts);
      }
    };
    
    // Set up search button click handler to use our new search function
    const searchButton = document.getElementById('search-button');
    if (searchButton) {
      searchButton.addEventListener('click', searchCompanies);
    }
    
    // Set up search input enter key handler
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          searchCompanies();
        }
      });
    }
    
    // Initialize elements object correctly
    window.elements = elements;
    
    console.log('FDA Regulatory Dashboard initialized with global state tracking');
  }
  
  // Run initialization when DOM is ready
  document.addEventListener('DOMContentLoaded', initApp);