const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const router = express.Router();

// API endpoints
const FDA_BASE_URL = 'https://api.fda.gov/device';
const ECFR_BASE_URL = 'https://www.ecfr.gov/api/versioner/v1/full';
const FEDERAL_REGISTER_URL = 'https://www.federalregister.gov/api/v1/articles';

// Helper function for FDA API requests
async function fdaRequest(endpoint, params = {}) {
  try {
    const response = await axios.get(`${FDA_BASE_URL}${endpoint}`, {
      params: { limit: 100, ...params },
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching from ${endpoint}:`, error.message);
    return { results: [], error: error.message };
  }
}

// Enhanced helper function for FDA API requests with pagination
async function fdaRequestWithPagination(endpoint, params = {}, maxResults = 1000) {
  try {
    const allResults = [];
    let skip = 0;
    const limit = 100;
    let hasMoreData = true;
    
    console.log(`Fetching paginated data from ${endpoint}...`);
    
    while (hasMoreData && allResults.length < maxResults) {
      const requestParams = {
        limit,
        skip,
        ...params
      };
      
      const response = await axios.get(`${FDA_BASE_URL}${endpoint}`, {
        params: requestParams,
        timeout: 15000
      });
      
      const data = response.data;
      
      if (data.results && data.results.length > 0) {
        allResults.push(...data.results);
        skip += limit;
        
        if (data.results.length < limit || 
            (data.meta?.results?.total && allResults.length >= data.meta.results.total)) {
          hasMoreData = false;
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
      } else {
        hasMoreData = false;
      }
    }
    
    console.log(`Fetched ${allResults.length} total results from ${endpoint}`);
    
    return {
      results: allResults,
      meta: {
        totalFetched: allResults.length,
        disclaimer: 'Results fetched with pagination'
      }
    };
    
  } catch (error) {
    console.error(`Error fetching paginated data from ${endpoint}:`, error.message);
    return { 
      results: [], 
      error: error.message,
      meta: { totalFetched: 0 }
    };
  }
}

// Smart search term analysis with company/device distinction
function analyzeSearchTerm(searchTerm, searchMode = 'auto') {
  const term = searchTerm.toLowerCase().trim();
  
  // If mode is explicitly set, use it
  if (searchMode === 'company') {
    return {
      type: 'company',
      mode: 'company',
      searchStrategies: [
        { endpoint: '510k', field: 'applicant', value: searchTerm },
        { endpoint: 'pma', field: 'applicant', value: searchTerm },
        { endpoint: 'registrationlisting', field: 'establishment_name', value: searchTerm },
        { endpoint: 'recall', field: 'recalling_firm', value: searchTerm },
        { endpoint: 'event', field: 'manufacturer_name', value: searchTerm },
        { endpoint: 'udi', field: 'company_name', value: searchTerm }
      ]
    };
  }
  
  if (searchMode === 'device') {
    return {
      type: 'device',
      mode: 'device',
      searchStrategies: [
        { endpoint: '510k', field: 'device_name', value: searchTerm },
        { endpoint: 'pma', field: 'trade_name', value: searchTerm },
        { endpoint: 'classification', field: 'device_name', value: searchTerm },
        { endpoint: 'recall', field: 'product_description', value: searchTerm },
        { endpoint: 'event', field: 'device.device_name', value: searchTerm },
        { endpoint: 'udi', field: 'device_description', value: searchTerm }
      ]
    };
  }
  
  // Auto-detection logic
  // K-number pattern
  if (/^k\d{6}$/i.test(term)) {
    return {
      type: 'k-number',
      mode: 'device',
      searchStrategies: [
        { endpoint: '510k', field: 'k_number', value: searchTerm.toUpperCase() },
        { endpoint: 'classification', field: 'k_number', value: searchTerm.toUpperCase() },
        { endpoint: 'recall', field: 'k_numbers', value: searchTerm.toUpperCase() }
      ]
    };
  }
  
  // PMA number pattern
  if (/^p\d{6}$/i.test(term)) {
    return {
      type: 'pma-number',
      mode: 'device',
      searchStrategies: [
        { endpoint: 'pma', field: 'pma_number', value: searchTerm.toUpperCase() },
        { endpoint: 'recall', field: 'pma_numbers', value: searchTerm.toUpperCase() }
      ]
    };
  }
  
  // Company indicators
  const companyIndicators = ['inc', 'corp', 'ltd', 'llc', 'co', 'company', 'corporation', 'medical', 'healthcare', 'pharma', 'medtronic', 'abbott', 'pfizer', 'johnson', 'boston scientific'];
  const isCompany = companyIndicators.some(indicator => term.includes(indicator));
  
  if (isCompany) {
    return {
      type: 'company',
      mode: 'company',
      searchStrategies: [
        { endpoint: '510k', field: 'applicant', value: searchTerm },
        { endpoint: 'pma', field: 'applicant', value: searchTerm },
        { endpoint: 'registrationlisting', field: 'establishment_name', value: searchTerm },
        { endpoint: 'recall', field: 'recalling_firm', value: searchTerm },
        { endpoint: 'event', field: 'manufacturer_name', value: searchTerm },
        { endpoint: 'udi', field: 'company_name', value: searchTerm }
      ]
    };
  }
  
  // Default to device
  return {
    type: 'device',
    mode: 'device',
    searchStrategies: [
      { endpoint: '510k', field: 'device_name', value: searchTerm },
      { endpoint: 'pma', field: 'trade_name', value: searchTerm },
      { endpoint: 'classification', field: 'device_name', value: searchTerm },
      { endpoint: 'recall', field: 'product_description', value: searchTerm },
      { endpoint: 'event', field: 'device.device_name', value: searchTerm },
      { endpoint: 'udi', field: 'device_description', value: searchTerm }
    ]
  };
}

// Enhanced search functions with better error handling
async function smartSearch510k(searchTerm, analysis) {
  const strategies = analysis.searchStrategies.filter(s => s.endpoint === '510k');
  
  if (strategies.length === 0) {
    const searchFields = [
      `device_name:"${searchTerm}"`,
      `applicant:"${searchTerm}"`,
      `k_number:"${searchTerm}"`
    ];
    const search = searchFields.join(' OR ');
    return await fdaRequestWithPagination('/510k.json', { search }, 1000);
  }
  
  for (const strategy of strategies) {
    try {
      const result = await fdaRequestWithPagination('/510k.json', { 
        search: `${strategy.field}:"${strategy.value}"` 
      }, 1000);
      
      if (result.results && result.results.length > 0) {
        return result;
      }
    } catch (error) {
      console.log(`510k strategy failed for ${strategy.field}: ${error.message}`);
    }
  }
  
  // Fallback search
  return await fdaRequestWithPagination('/510k.json', { 
    search: `device_name:"${searchTerm}" OR applicant:"${searchTerm}"` 
  }, 1000);
}

async function smartSearchPMA(searchTerm, analysis) {
  const strategies = analysis.searchStrategies.filter(s => s.endpoint === 'pma');
  
  if (strategies.length === 0) {
    const searchFields = [
      `generic_name:"${searchTerm}"`,
      `trade_name:"${searchTerm}"`,
      `applicant:"${searchTerm}"`
    ];
    const search = searchFields.join(' OR ');
    return await fdaRequestWithPagination('/pma.json', { search }, 1000);
  }
  
  for (const strategy of strategies) {
    try {
      const result = await fdaRequestWithPagination('/pma.json', { 
        search: `${strategy.field}:"${strategy.value}"` 
      }, 1000);
      
      if (result.results && result.results.length > 0) {
        return result;
      }
    } catch (error) {
      console.log(`PMA strategy failed for ${strategy.field}: ${error.message}`);
    }
  }
  
  return await fdaRequestWithPagination('/pma.json', { 
    search: `trade_name:"${searchTerm}" OR applicant:"${searchTerm}"` 
  }, 1000);
}

async function smartSearchClassification(searchTerm, analysis) {
  try {
    const strategies = analysis.searchStrategies.filter(s => s.endpoint === 'classification');
    
    if (strategies.length === 0) {
      const searchFields = [
        `device_name:"${searchTerm}"`,
        `medical_specialty_description:"${searchTerm}"`,
        `product_code:"${searchTerm}"`
      ];
      const search = searchFields.join(' OR ');
      return await fdaRequestWithPagination('/classification.json', { search }, 1000);
    }
    
    for (const strategy of strategies) {
      try {
        const result = await fdaRequestWithPagination('/classification.json', { 
          search: `${strategy.field}:"${strategy.value}"` 
        }, 1000);
        
        if (result.results && result.results.length > 0) {
          return result;
        }
      } catch (error) {
        console.log(`Classification strategy failed for ${strategy.field}: ${error.message}`);
      }
    }
    
    // Fallback search
    return await fdaRequestWithPagination('/classification.json', { 
      search: `device_name:"${searchTerm}"` 
    }, 1000);
    
  } catch (error) {
    console.error(`Classification search error: ${error.message}`);
    return { 
      results: [], 
      error: `Classification search failed: ${error.message}`,
      meta: { totalFetched: 0 }
    };
  }
}

async function smartSearchRecalls(searchTerm, analysis) {
  const strategies = analysis.searchStrategies.filter(s => s.endpoint === 'recall');
  
  if (strategies.length === 0) {
    const searchFields = [
      `product_description:"${searchTerm}"`,
      `recalling_firm:"${searchTerm}"`
    ];
    const search = searchFields.join(' OR ');
    return await fdaRequestWithPagination('/recall.json', { search }, 1000);
  }
  
  for (const strategy of strategies) {
    try {
      const result = await fdaRequestWithPagination('/recall.json', { 
        search: `${strategy.field}:"${strategy.value}"` 
      }, 1000);
      
      if (result.results && result.results.length > 0) {
        return result;
      }
    } catch (error) {
      console.log(`Recall strategy failed for ${strategy.field}: ${error.message}`);
    }
  }
  
  return await fdaRequestWithPagination('/recall.json', { 
    search: `product_description:"${searchTerm}" OR recalling_firm:"${searchTerm}"` 
  }, 1000);
}

async function smartSearchAdverseEvents(searchTerm, analysis) {
  const strategies = analysis.searchStrategies.filter(s => s.endpoint === 'event');
  
  if (strategies.length === 0) {
    const searchFields = [
      `device.generic_name:"${searchTerm}"`,
      `device.brand_name:"${searchTerm}"`,
      `manufacturer_name:"${searchTerm}"`
    ];
    const search = searchFields.join(' OR ');
    return await fdaRequestWithPagination('/event.json', { search }, 1000);
  }
  
  for (const strategy of strategies) {
    try {
      const result = await fdaRequestWithPagination('/event.json', { 
        search: `${strategy.field}:"${strategy.value}"` 
      }, 1000);
      
      if (result.results && result.results.length > 0) {
        return result;
      }
    } catch (error) {
      console.log(`Adverse event strategy failed for ${strategy.field}: ${error.message}`);
    }
  }
  
  return await fdaRequestWithPagination('/event.json', { 
    search: `device.generic_name:"${searchTerm}" OR manufacturer_name:"${searchTerm}"` 
  }, 1000);
}

async function smartSearchRegistrations(searchTerm, analysis) {
  const strategies = analysis.searchStrategies.filter(s => s.endpoint === 'registrationlisting');
  
  if (strategies.length === 0) {
    const searchFields = [
      `establishment_name:"${searchTerm}"`,
      `products.openfda.device_name:"${searchTerm}"`
    ];
    const search = searchFields.join(' OR ');
    return await fdaRequestWithPagination('/registrationlisting.json', { search }, 1000);
  }
  
  for (const strategy of strategies) {
    try {
      const result = await fdaRequestWithPagination('/registrationlisting.json', { 
        search: `${strategy.field}:"${strategy.value}"` 
      }, 1000);
      
      if (result.results && result.results.length > 0) {
        return result;
      }
    } catch (error) {
      console.log(`Registration strategy failed for ${strategy.field}: ${error.message}`);
    }
  }
  
  return await fdaRequestWithPagination('/registrationlisting.json', { 
    search: `establishment_name:"${searchTerm}"` 
  }, 1000);
}

async function smartSearchUDI(searchTerm, analysis) {
  const strategies = analysis.searchStrategies.filter(s => s.endpoint === 'udi');
  
  if (strategies.length === 0) {
    const searchFields = [
      `device_description:"${searchTerm}"`,
      `brand_name:"${searchTerm}"`,
      `company_name:"${searchTerm}"`
    ];
    const search = searchFields.join(' OR ');
    return await fdaRequestWithPagination('/udi.json', { search }, 1000);
  }
  
  for (const strategy of strategies) {
    try {
      const result = await fdaRequestWithPagination('/udi.json', { 
        search: `${strategy.field}:"${strategy.value}"` 
      }, 1000);
      
      if (result.results && result.results.length > 0) {
        return result;
      }
    } catch (error) {
      console.log(`UDI strategy failed for ${strategy.field}: ${error.message}`);
    }
  }
  
  return await fdaRequestWithPagination('/udi.json', { 
    search: `device_description:"${searchTerm}" OR company_name:"${searchTerm}"` 
  }, 1000);
}

async function smartSearchEnforcement(searchTerm, analysis) {
  const searchFields = [
    `product_description:"${searchTerm}"`,
    `recalling_firm:"${searchTerm}"`
  ];
  const search = searchFields.join(' OR ');
  return await fdaRequestWithPagination('/enforcement.json', { search }, 1000);
}

// Updated getAllFDAData function with search mode
async function getAllFDAData(searchTerm, searchMode = 'auto', maxResults = 1000) {
  console.log(`Smart FDA search for: ${searchTerm} (mode: ${searchMode}, max ${maxResults} per endpoint)`);
  
  const searchAnalysis = analyzeSearchTerm(searchTerm, searchMode);
  console.log(`Search type detected: ${searchAnalysis.type}, mode: ${searchAnalysis.mode}`);
  
  const results = await Promise.allSettled([
    smartSearch510k(searchTerm, searchAnalysis),
    smartSearchPMA(searchTerm, searchAnalysis),
    smartSearchRecalls(searchTerm, searchAnalysis),
    smartSearchAdverseEvents(searchTerm, searchAnalysis),
    smartSearchEnforcement(searchTerm, searchAnalysis),
    smartSearchRegistrations(searchTerm, searchAnalysis),
    smartSearchUDI(searchTerm, searchAnalysis),
    smartSearchClassification(searchTerm, searchAnalysis)
  ]);

  const [
    fiveOneOk,
    pma,
    recalls,
    adverseEvents,
    enforcement,
    registrations,
    udi,
    classification
  ] = results.map(result => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error('FDA API call failed:', result.reason.message);
      return { results: [], error: result.reason.message, meta: { totalFetched: 0 } };
    }
  });

  const successfulEndpoints = [];
  const failedEndpoints = [];
  
  const endpointNames = ['510k', 'pma', 'recalls', 'adverseEvents', 'enforcement', 'registrations', 'udi', 'classification'];
  const endpointResults = [fiveOneOk, pma, recalls, adverseEvents, enforcement, registrations, udi, classification];
  
  let totalRecords = 0;
  endpointResults.forEach((result, index) => {
    const count = result.results?.length || 0;
    totalRecords += count;
    
    if (count > 0) {
      successfulEndpoints.push(`${endpointNames[index]} (${count})`);
    } else if (result.error) {
      failedEndpoints.push(endpointNames[index]);
    }
  });
  
  console.log(`FDA API Summary - Total Records: ${totalRecords}`);
  console.log(`Successful: [${successfulEndpoints.join(', ')}]`);
  if (failedEndpoints.length > 0) {
    console.log(`Failed: [${failedEndpoints.join(', ')}]`);
  }

  return {
    fiveOneOk,
    pma,
    recalls,
    adverseEvents,
    enforcement,
    registrations,
    udi,
    classification,
    _metadata: {
      successfulEndpoints,
      failedEndpoints,
      totalEndpoints: endpointNames.length,
      totalRecords,
      maxResultsPerEndpoint: maxResults,
      searchType: searchAnalysis.type,
      searchMode: searchAnalysis.mode
    }
  };
}

// Enhanced profile creation for company vs device
function createEnhancedProfile(searchTerm, fdaData, ecfrData, applicableParts, searchMode) {
  const isCompanySearch = searchMode === 'company' || fdaData._metadata?.searchMode === 'company';
  
  const profile = {
    searchTerm,
    searchType: fdaData._metadata?.searchType || 'unknown',
    searchMode: fdaData._metadata?.searchMode || searchMode || 'device',
    isCompanySearch,
    overview: {
      totalFDARecords: fdaData._metadata?.totalRecords || 0,
      regulatoryComplexity: 'Unknown',
      primaryClassification: isCompanySearch ? 'Multiple Devices' : 'Unknown',
      marketStatus: 'Unknown'
    },
    regulatory: {
      applicableParts: applicableParts?.length || 0,
      deviceClasses: [],
      pathways: [],
      exemptions: [],
      regulationNumbers: []
    },
    safety: {
      recallCount: fdaData.recalls?.results?.length || 0,
      adverseEventCount: fdaData.adverseEvents?.results?.length || 0,
      riskLevel: 'Unknown'
    },
    market: {
      active510k: fdaData.fiveOneOk?.results?.length || 0,
      activePMA: fdaData.pma?.results?.length || 0,
      currentRegistrations: fdaData.registrations?.results?.length || 0,
      udiRecords: fdaData.udi?.results?.length || 0
    },
    recommendations: [],
    keyRegulations: [],
    companyInfo: {
      manufacturers: [],
      applicants: [],
      facilities: [],
      devicePortfolio: []
    }
  };

  // Enhanced company information extraction
  const companies = new Set();
  const applicants = new Set();
  const facilities = new Set();
  const deviceTypes = new Set();
  
  [fdaData.fiveOneOk, fdaData.pma, fdaData.registrations].forEach(dataset => {
    if (dataset?.results) {
      dataset.results.forEach(item => {
        if (item.applicant) applicants.add(item.applicant);
        if (item.company_name) companies.add(item.company_name);
        if (item.establishment_name) facilities.add(item.establishment_name);
        if (item.manufacturer_name) companies.add(item.manufacturer_name);
        if (item.device_name) deviceTypes.add(item.device_name);
        if (item.trade_name) deviceTypes.add(item.trade_name);
        if (item.generic_name) deviceTypes.add(item.generic_name);
      });
    }
  });
  
  profile.companyInfo.manufacturers = Array.from(companies).slice(0, 10);
  profile.companyInfo.applicants = Array.from(applicants).slice(0, 10);
  profile.companyInfo.facilities = Array.from(facilities).slice(0, 10);
  profile.companyInfo.devicePortfolio = Array.from(deviceTypes).slice(0, 15);

  // Device classification analysis
  const classLevels = new Set();
  const regulationNumbers = new Set();
  
  [fdaData.classification, fdaData.fiveOneOk, fdaData.pma].forEach(dataset => {
    if (dataset?.results) {
      dataset.results.forEach(item => {
        if (item.device_class) classLevels.add(item.device_class);
        if (item.openfda?.device_class) classLevels.add(item.openfda.device_class);
        if (item.regulation_number) regulationNumbers.add(item.regulation_number);
        if (item.openfda?.regulation_number) regulationNumbers.add(item.openfda.regulation_number);
      });
    }
  });

  profile.regulatory.deviceClasses = Array.from(classLevels);
  profile.regulatory.regulationNumbers = Array.from(regulationNumbers);

  // Different complexity analysis for companies vs devices
  if (isCompanySearch) {
    const deviceCount = profile.companyInfo.devicePortfolio.length;
    const facilityCount = profile.companyInfo.facilities.length;
    const hasMultipleClasses = classLevels.size > 1;
    
    if (deviceCount > 10 || facilityCount > 5 || hasMultipleClasses) {
      profile.overview.regulatoryComplexity = 'High';
    } else if (deviceCount > 3 || facilityCount > 2) {
      profile.overview.regulatoryComplexity = 'Medium';
    } else if (deviceCount > 0) {
      profile.overview.regulatoryComplexity = 'Low';
    }
    
    profile.overview.primaryClassification = classLevels.size > 1 ? 
      `Multiple Classes (${Array.from(classLevels).join(', ')})` : 
      classLevels.size === 1 ? `Primarily Class ${Array.from(classLevels)[0]}` : 'Various Devices';
  } else {
    // Device-specific analysis (existing logic)
    const hasClassIII = classLevels.has('III') || classLevels.has('3');
    const hasClassII = classLevels.has('II') || classLevels.has('2');
    const hasClassI = classLevels.has('I') || classLevels.has('1');
    
    if (hasClassIII) {
      profile.overview.regulatoryComplexity = 'High';
      profile.overview.primaryClassification = 'Class III';
    } else if (hasClassII) {
      profile.overview.regulatoryComplexity = 'Medium';
      profile.overview.primaryClassification = 'Class II';
    } else if (hasClassI) {
      profile.overview.regulatoryComplexity = 'Low';
      profile.overview.primaryClassification = 'Class I';
    }
  }

  // Risk and pathway analysis
  if (profile.safety.recallCount > 5 || profile.safety.adverseEventCount > 10) {
    profile.safety.riskLevel = 'High';
  } else if (profile.safety.recallCount > 0 || profile.safety.adverseEventCount > 0) {
    profile.safety.riskLevel = 'Medium';
  } else {
    profile.safety.riskLevel = 'Low';
  }

  // Market status
  if (profile.market.active510k > 0 || profile.market.activePMA > 0) {
    profile.overview.marketStatus = isCompanySearch ? 'Active FDA Portfolio' : 'FDA Cleared/Approved';
  } else if (profile.market.currentRegistrations > 0) {
    profile.overview.marketStatus = 'Registered';
  } else if (profile.overview.totalFDARecords > 0) {
    profile.overview.marketStatus = 'Has FDA History';
  }

  // Generate recommendations
  if (isCompanySearch) {
    if (profile.companyInfo.devicePortfolio.length > 5) {
      profile.recommendations.push('Large device portfolio - consider centralized regulatory strategy');
    }
    if (profile.companyInfo.facilities.length > 1) {
      profile.recommendations.push('Multiple facilities - ensure consistent QSR compliance across sites');
    }
    if (profile.safety.riskLevel === 'High') {
      profile.recommendations.push('High safety event profile - implement enhanced post-market surveillance');
    }
  } else {
    if (classLevels.has('III')) {
      profile.recommendations.push('PMA pathway required - plan 2-3+ years for approval');
    } else if (classLevels.has('II')) {
      profile.recommendations.push('510(k) clearance pathway - identify predicate devices');
    }
  }

  return profile;
}
// Function to get eCFR regulation text
async function getECFRRegulation(regulationNumber) {
  try {
    if (!regulationNumber) return null;
    
    // Parse regulation number (e.g., "872.3200" -> title 21, part 872, section 3200)
    const parts = regulationNumber.split('.');
    if (parts.length !== 2) return null;
    
    const part = parts[0];
    const section = parts[1];
    
    console.log(`Fetching eCFR regulation ${regulationNumber} (part ${part}, section ${section})`);
    
    // Use the actual eCFR renderer API endpoint
    const url = `https://www.ecfr.gov/api/renderer/v1/content/enhanced/2025-06-26/title-21?chapter=I&subchapter=H&part=${part}`;
    const response = await axios.get(url, { 
      timeout: 15000,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; FDA-Device-Search/1.0)'
      }
    });
    
    // Parse the HTML response to find the specific regulation
    const regulation = parseECFRHtml(response.data, part, section);
    
    if (!regulation) {
      console.log(`No regulation data found for ${regulationNumber}`);
      return null;
    }
    
    return {
      regulationNumber,
      title: regulation?.title || 'Regulation text not found',
      text: regulation?.text || '',
      identification: regulation?.identification || '',
      classification: regulation?.classification || '',
      requirements: extractRequirements(regulation?.text || ''),
      classificationCriteria: extractClassificationCriteria(regulation?.text || ''),
      testingRequirements: extractTestingRequirements(regulation?.text || ''),
      url: `https://www.ecfr.gov/current/title-21/chapter-I/subchapter-H/part-${part}/section-${part}.${section}`,
      deviceClass: regulation?.deviceClass || 'Unknown',
      exemptions: regulation?.exemptions || []
    };
  } catch (error) {
    console.error(`Error fetching eCFR data for ${regulationNumber}:`, error.message);
    return null;
  }
}

// Helper to parse eCFR HTML content and find specific regulation
function parseECFRHtml(htmlContent, part, section) {
  try {
    const cheerio = require('cheerio');
    const $ = cheerio.load(htmlContent);
    
    // Look for the specific section using multiple strategies
    const sectionId = `${part}.${section}`;
    
    // Strategy 1: Look for section with exact ID
    let sectionElement = $(`#${sectionId}`);
    
    // Strategy 2: Look for section using data attributes or text content
    if (sectionElement.length === 0) {
      sectionElement = $(`.section`).filter(function() {
        return $(this).attr('id') === sectionId || 
               $(this).find('h4').text().includes(sectionId);
      });
    }
    
    // Strategy 3: Look for any element containing the section number in its text
    if (sectionElement.length === 0) {
      sectionElement = $('div').filter(function() {
        const text = $(this).find('h4').first().text();
        return text.includes(`§ ${sectionId}`) || text.includes(`${sectionId}`);
      });
    }
    
    if (sectionElement.length === 0) {
      console.log(`Section ${sectionId} not found in eCFR HTML`);
      // Let's try to find what sections ARE available
      const availableSections = [];
      $('div.section').each(function() {
        const id = $(this).attr('id');
        const title = $(this).find('h4').first().text();
        if (id) availableSections.push(id);
        if (title.includes('§ 872.')) availableSections.push(title);
      });
      console.log('Available sections found:', availableSections.slice(0, 10));
      return null;
    }
    
    // Extract section title
    const titleElement = sectionElement.find('h4').first();
    const title = titleElement.text().trim();
    
    // Extract identification paragraph - look for text containing "Identification"
    let identification = '';
    sectionElement.find('p').each(function() {
      const text = $(this).text();
      if (text.includes('Identification.') && text.length > 50) {
        identification = text.replace(/^\([a-z]\)\s*Identification\.\s*/i, '').trim();
        return false; // break the loop
      }
    });
    
    // Extract classification paragraph - look for text containing "Classification"
    let classification = '';
    sectionElement.find('p').each(function() {
      const text = $(this).text();
      if (text.includes('Classification.') && text.length > 20) {
        classification = text.replace(/^\([a-z]\)\s*Classification\.\s*/i, '').trim();
        return false; // break the loop
      }
    });
    
    // Get all text content from the section
    const fullText = sectionElement.text();
    
    // Extract device class (I, II, III)
    const deviceClass = extractDeviceClass(classification);
    
    // Extract exemptions
    const exemptions = extractExemptions(classification);
    
    return {
      title,
      text: fullText,
      identification,
      classification,
      deviceClass,
      exemptions
    };
    
  } catch (error) {
    console.error('Error parsing eCFR HTML:', error);
    return null;
  }
}

// Helper to extract clean text from paragraph elements
function extractParagraphText(element) {
  if (!element || element.length === 0) return '';
  
  const cheerio = require('cheerio');
  const $ = cheerio.load(element.html());
  
  // Remove links and citations, keep just the text content
  $('a').remove();
  $('.fr-reference').remove();
  $('.cfr').remove();
  
  return $.text().trim();
}

// Extract device class from classification text
function extractDeviceClass(classificationText) {
  if (!classificationText) return 'Unknown';
  
  const classMatch = classificationText.match(/Class\s+(I{1,3}|1|2|3)/i);
  if (classMatch) {
    const classValue = classMatch[1].toUpperCase();
    // Convert Roman numerals to Arabic numbers
    if (classValue === 'I') return 'I';
    if (classValue === 'II') return 'II';
    if (classValue === 'III') return 'III';
    return classValue;
  }
  
  return 'Unknown';
}

// Extract exemption information
function extractExemptions(classificationText) {
  if (!classificationText) return [];
  
  const exemptions = [];
  
  if (classificationText.includes('exempt from the premarket notification')) {
    exemptions.push('510(k) exempt');
  }
  
  if (classificationText.includes('exempt from the current good manufacturing practice')) {
    exemptions.push('QSR exempt (if not sterile)');
  }
  
  if (classificationText.includes('special controls')) {
    exemptions.push('Requires special controls');
  }
  
  return exemptions;
}

// Enhanced requirements extraction
function extractRequirements(text) {
  const requirements = [];
  const patterns = [
    /must\s+([^.;]+)/gi,
    /shall\s+([^.;]+)/gi,
    /required\s+to\s+([^.;]+)/gi,
    /device\s+is\s+intended\s+([^.;]+)/gi,
    /special\s+control[s]?\s*[:]\s*([^.;]+)/gi,
    /premarket\s+approval\s+([^.;]+)/gi
  ];
  
  patterns.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) {
      requirements.push(...matches.map(match => match.trim()));
    }
  });
  
  return [...new Set(requirements)].slice(0, 10); // Limit to top 10 unique requirements
}

// Enhanced classification criteria extraction
function extractClassificationCriteria(text) {
  const criteria = [];
  const patterns = [
    /Class\s+(I{1,3}|1|2|3)\s*\([^)]*\)/gi,
    /general\s+controls/gi,
    /special\s+controls/gi,
    /premarket\s+approval/gi,
    /510\(k\)\s+exempt/gi,
    /prescription\s+use/gi
  ];
  
  patterns.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) {
      criteria.push(...matches.map(match => match.trim()));
    }
  });
  
  return [...new Set(criteria)];
}

// Enhanced testing requirements extraction
function extractTestingRequirements(text) {
  const tests = [];
  const patterns = [
    /biocompatibility\s+([^.;]+)/gi,
    /sterilization\s+([^.;]+)/gi,
    /electrical\s+safety\s+([^.;]+)/gi,
    /clinical\s+(?:testing|studies|data)\s+([^.;]+)/gi,
    /performance\s+testing\s+([^.;]+)/gi,
    /ISO\s+\d+[^.\s]*\s*([^.;]*)/gi,
    /ASTM\s+[A-Z]\d+[^.\s]*\s*([^.;]*)/gi
  ];
  
  patterns.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) {
      tests.push(...matches.map(match => match.trim()));
    }
  });
  
  return [...new Set(tests)].slice(0, 8); // Limit to top 8 unique requirements
}

// Get Federal Register notices
async function getFederalRegisterNotices(searchTerm) {
  try {
    const response = await axios.get(FEDERAL_REGISTER_URL, {
      params: {
        'conditions[term]': searchTerm,
        'conditions[agencies][]': 'food-and-drug-administration',
        'per_page': 20,
        'order': 'relevance'
      },
      timeout: 10000
    });
    
    return response.data.results?.map(notice => ({
      title: notice.title,
      summary: notice.abstract,
      date: notice.publication_date,
      type: notice.type,
      url: notice.html_url,
      docketNumber: notice.docket_id,
      cfr_references: notice.cfr_references || []
    })) || [];
  } catch (error) {
    console.error('Error fetching Federal Register data:', error.message);
    return [];
  }
}

// Get FDA guidance documents
async function getFDAGuidance(searchTerm) {
  try {
    // FDA doesn't have a public API for guidance documents, so we'll simulate
    // In practice, you might scrape their guidance database or use a different approach
    const guidanceUrl = `https://www.fda.gov/medical-devices/device-regulation-and-guidance/guidance-documents-medical-devices-and-radiation-emitting-products`;
    
    // This is a placeholder - you'd need to implement actual scraping or use FDA's search
    return {
      searchTerm,
      guidanceDocuments: [
        {
          title: `Guidance for ${searchTerm} Devices`,
          type: 'Draft Guidance',
          date: '2024-01-15',
          url: 'https://www.fda.gov/guidance-example',
          summary: 'FDA guidance on regulatory requirements and recommendations'
        }
      ],
      note: 'Guidance documents require web scraping or manual collection - this is a placeholder'
    };
  } catch (error) {
    console.error('Error fetching FDA guidance:', error.message);
    return { guidanceDocuments: [], error: error.message };
  }
}

// Get international regulatory data (placeholder for future enhancement)
async function getInternationalData(searchTerm) {
  return {
    searchTerm,
    sources: {
      'Health Canada': { status: 'Not implemented', url: 'https://health-products.canada.ca/mdall-limh/' },
      'CE Marking (EU)': { status: 'Not implemented', url: 'https://ec.europa.eu/growth/single-market/ce-marking_en' },
      'TGA (Australia)': { status: 'Not implemented', url: 'https://www.tga.gov.au/' },
      'PMDA (Japan)': { status: 'Not implemented', url: 'https://www.pmda.go.jp/english/' }
    },
    note: 'International regulatory data integration available for future enhancement'
  };
}

// Enhanced main search route with all sources
router.get('/enhanced-search', async (req, res) => {
  try {
    const { q: searchTerm } = req.query;
    
    if (!searchTerm) {
      return res.status(400).json({ error: 'Search term (q) is required' });
    }

    console.log(`Enhanced search for: ${searchTerm}`);
    
    // Get basic FDA data (from previous implementation)
    const [
      fiveOneOk,
      pma,
      recalls,
      adverseEvents,
      enforcement,
      registrations,
      udi,
      classification
    ] = await Promise.all([
      search510k(searchTerm),
      searchPMA(searchTerm),
      searchRecalls(searchTerm),
      searchAdverseEvents(searchTerm),
      searchEnforcement(searchTerm),
      searchRegistrations(searchTerm),
      searchUDI(searchTerm),
      searchClassification(searchTerm)
    ]);

    // Get regulatory enrichment data
    const [
      federalRegisterNotices,
      fdaGuidance,
      internationalData
    ] = await Promise.all([
      getFederalRegisterNotices(searchTerm),
      getFDAGuidance(searchTerm),
      getInternationalData(searchTerm)
    ]);

    // Extract regulation numbers for eCFR lookup
    const regulationNumbers = extractRegulationNumbers({
      classification,
      fiveOneOk,
      pma
    });

    // Get eCFR regulation details
    const ecfrData = await Promise.all(
      regulationNumbers.map(regNum => getECFRRegulation(regNum))
    );

    // Link and enrich all data
    const enrichedData = await enrichWithRegulatoryData({
      fdaData: {
        fiveOneOk,
        pma,
        recalls,
        adverseEvents,
        enforcement,
        registrations,
        udi,
        classification
      },
      regulatoryData: {
        ecfr: ecfrData.filter(item => item !== null),
        federalRegister: federalRegisterNotices,
        guidance: fdaGuidance,
        international: internationalData
      }
    });

    // Generate comprehensive analysis
    const comprehensiveAnalysis = generateComprehensiveAnalysis(enrichedData, searchTerm);

    res.json({
      searchTerm,
      timestamp: new Date().toISOString(),
      analysis: comprehensiveAnalysis,
      data: enrichedData,
      sources: {
        'FDA APIs': 'api.fda.gov',
        'eCFR': 'ecfr.gov',
        'Federal Register': 'federalregister.gov',
        'FDA Guidance': 'fda.gov/guidance',
        'International': 'Various (placeholder)'
      }
    });

  } catch (error) {
    console.error('Enhanced search error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Extract regulation numbers from FDA data
function extractRegulationNumbers(data) {
  const regNumbers = new Set();
  
  // From classification data
  if (data.classification.results) {
    data.classification.results.forEach(item => {
      if (item.regulation_number) {
        regNumbers.add(item.regulation_number);
      }
    });
  }
  
  // From 510(k) data
  if (data.fiveOneOk.results) {
    data.fiveOneOk.results.forEach(item => {
      if (item.openfda?.regulation_number) {
        regNumbers.add(item.openfda.regulation_number);
      }
    });
  }
  
  // From PMA data
  if (data.pma.results) {
    data.pma.results.forEach(item => {
      if (item.openfda?.regulation_number) {
        regNumbers.add(item.openfda.regulation_number);
      }
    });
  }
  
  return Array.from(regNumbers);
}

// Enrich FDA data with regulatory information
async function enrichWithRegulatoryData({ fdaData, regulatoryData }) {
  const enriched = { ...fdaData };
  
  // Add regulatory context to each FDA record
  Object.keys(enriched).forEach(key => {
    if (enriched[key].results) {
      enriched[key].results = enriched[key].results.map(item => {
        const regulationNumber = item.regulation_number || 
          item.openfda?.regulation_number;
        
        const regulatoryContext = {
          ecfrRegulation: null,
          relatedNotices: [],
          guidanceDocuments: [],
          complianceRequirements: []
        };
        
        // Find matching eCFR regulation
        if (regulationNumber) {
          regulatoryContext.ecfrRegulation = regulatoryData.ecfr.find(
            reg => reg?.regulationNumber === regulationNumber
          );
        }
        
        // Find related Federal Register notices
        regulatoryContext.relatedNotices = regulatoryData.federalRegister.filter(
          notice => notice.title.toLowerCase().includes(
            (item.device_name || item.generic_name || '').toLowerCase()
          )
        );
        
        return {
          ...item,
          _regulatoryContext: regulatoryContext
        };
      });
    }
  });
  
  // Add standalone regulatory data
  enriched.regulatoryEnrichment = regulatoryData;
  
  return enriched;
}

// Generate comprehensive regulatory analysis
function generateComprehensiveAnalysis(data, searchTerm) {
  const analysis = {
    regulatoryComplexity: 'Unknown',
    keyRegulations: [],
    complianceRequirements: [],
    marketAccessStrategy: [],
    riskAssessment: {
      level: 'Unknown',
      factors: []
    },
    recommendations: [],
    deviceClassification: {
      classes: [],
      pathways: [],
      exemptions: []
    }
  };
  
  // Analyze regulatory complexity
  const uniqueRegulations = new Set();
  const classLevels = new Set();
  const exemptions = new Set();
  
  // Extract regulation data from eCFR
  Object.values(data).forEach(dataset => {
    if (dataset.results) {
      dataset.results.forEach(item => {
        if (item._regulatoryContext?.ecfrRegulation) {
          const reg = item._regulatoryContext.ecfrRegulation;
          uniqueRegulations.add(reg.regulationNumber);
          if (reg.deviceClass && reg.deviceClass !== 'Unknown') {
            classLevels.add(reg.deviceClass);
          }
          if (reg.exemptions) {
            reg.exemptions.forEach(ex => exemptions.add(ex));
          }
        }
        if (item.device_class) {
          classLevels.add(item.device_class);
        }
      });
    }
  });
  
  // Determine complexity based on classes and regulations
  const hasClassIII = classLevels.has('III') || classLevels.has('3');
  const hasClassII = classLevels.has('II') || classLevels.has('2');
  const multipleRegulations = uniqueRegulations.size > 3;
  
  if (hasClassIII || multipleRegulations) {
    analysis.regulatoryComplexity = 'High';
  } else if (hasClassII || uniqueRegulations.size > 1) {
    analysis.regulatoryComplexity = 'Medium';
  } else {
    analysis.regulatoryComplexity = 'Low';
  }
  
  // Extract key regulations with enhanced detail
  analysis.keyRegulations = Array.from(uniqueRegulations).map(regNum => {
    const ecfrData = data.regulatoryEnrichment?.ecfr?.find(
      reg => reg?.regulationNumber === regNum
    );
    return {
      number: regNum,
      title: ecfrData?.title || 'Unknown',
      deviceClass: ecfrData?.deviceClass || 'Unknown',
      requirements: ecfrData?.requirements || [],
      exemptions: ecfrData?.exemptions || [],
      url: ecfrData?.url
    };
  });
  
  // Device classification summary
  analysis.deviceClassification.classes = Array.from(classLevels);
  analysis.deviceClassification.exemptions = Array.from(exemptions);
  
  // Determine regulatory pathways
  if (hasClassIII) {
    analysis.deviceClassification.pathways.push('PMA (Premarket Approval)');
  }
  if (hasClassII || classLevels.has('I')) {
    const has510kExempt = exemptions.has('510(k) exempt');
    if (has510kExempt) {
      analysis.deviceClassification.pathways.push('510(k) Exempt');
    } else {
      analysis.deviceClassification.pathways.push('510(k) Clearance');
    }
  }
  
  // Risk assessment
  const recallCount = data.recalls?.results?.length || 0;
  const adverseEventCount = data.adverseEvents?.results?.length || 0;
  
  if (recallCount > 5 || adverseEventCount > 10 || hasClassIII) {
    analysis.riskAssessment.level = 'High';
    analysis.riskAssessment.factors.push('Class III device or multiple safety issues');
  } else if (recallCount > 0 || adverseEventCount > 0 || hasClassII) {
    analysis.riskAssessment.level = 'Medium';
    analysis.riskAssessment.factors.push('Class II device or some safety concerns');
  } else {
    analysis.riskAssessment.level = 'Low';
    analysis.riskAssessment.factors.push('Class I device with no significant safety issues');
  }
  
  // Generate specific recommendations
  if (hasClassIII) {
    analysis.recommendations.push('PMA pathway required - plan 2-3+ years for approval');
    analysis.recommendations.push('Extensive clinical trials likely required');
  } else if (hasClassII) {
    analysis.recommendations.push('510(k) clearance pathway - identify predicate devices');
    if (!exemptions.has('510(k) exempt')) {
      analysis.recommendations.push('Prepare 510(k) submission with substantial equivalence data');
    }
  } else {
    analysis.recommendations.push('Class I device - minimal FDA oversight required');
  }
  
  if (exemptions.has('QSR exempt (if not sterile)')) {
    analysis.recommendations.push('Consider QSR exemption if device is not sterile');
  }
  
  if (analysis.regulatoryComplexity === 'High') {
    analysis.recommendations.push('Engage regulatory consultant early in development');
  }
  
  if (uniqueRegulations.size > 1) {
    analysis.recommendations.push('Review multiple CFR sections for complete compliance');
  }
  
  return analysis;
}


async function search510k(searchTerm, maxResults = 1000) {
  const searchFields = [
    `device_name:"${searchTerm}"`,
    `applicant:"${searchTerm}"`,
    `k_number:"${searchTerm}"`,
    `product_code:"${searchTerm}"`,
    `openfda.device_name:"${searchTerm}"`,
    `openfda.medical_specialty_description:"${searchTerm}"`
  ];
  
  const search = searchFields.join(' OR ');
  return await fdaRequestWithPagination('/510k.json', { search }, maxResults);
}

async function searchPMA(searchTerm, maxResults = 1000) {
  const searchFields = [
    `generic_name:"${searchTerm}"`,
    `trade_name:"${searchTerm}"`,
    `applicant:"${searchTerm}"`,
    `pma_number:"${searchTerm}"`,
    `product_code:"${searchTerm}"`
  ];
  
  const search = searchFields.join(' OR ');
  return await fdaRequestWithPagination('/pma.json', { search }, maxResults);
}

async function searchRecalls(searchTerm, maxResults = 1000) {
  const searchFields = [
    `product_description:"${searchTerm}"`,
    `recalling_firm:"${searchTerm}"`,
    `product_code:"${searchTerm}"`,
    `k_numbers:"${searchTerm}"`,
    `pma_numbers:"${searchTerm}"`,
    `reason_for_recall:"${searchTerm}"`
  ];
  
  const search = searchFields.join(' OR ');
  return await fdaRequestWithPagination('/recall.json', { search }, maxResults);
}

async function searchAdverseEvents(searchTerm, maxResults = 1000) {
  const searchFields = [
    `device.generic_name:"${searchTerm}"`,
    `device.brand_name:"${searchTerm}"`,
    `device.manufacturer_d_name:"${searchTerm}"`,
    `device.device_name:"${searchTerm}"`,
    `manufacturer_name:"${searchTerm}"`
  ];
  
  const search = searchFields.join(' OR ');
  return await fdaRequestWithPagination('/event.json', { search }, maxResults);
}

async function searchEnforcement(searchTerm, maxResults = 1000) {
  const searchFields = [
    `product_description:"${searchTerm}"`,
    `recalling_firm:"${searchTerm}"`,
    `product_code:"${searchTerm}"`,
    `reason_for_recall:"${searchTerm}"`
  ];
  
  const search = searchFields.join(' OR ');
  return await fdaRequestWithPagination('/enforcement.json', { search }, maxResults);
}

async function searchRegistrations(searchTerm, maxResults = 1000) {
  const searchFields = [
    `products.product_code:"${searchTerm}"`,
    `products.openfda.device_name:"${searchTerm}"`,
    `products.openfda.medical_specialty_description:"${searchTerm}"`,
    `proprietary_name:"${searchTerm}"`
  ];
  
  const search = searchFields.join(' OR ');
  return await fdaRequestWithPagination('/registrationlisting.json', { search }, maxResults);
}

async function searchUDI(searchTerm, maxResults = 1000) {
  const searchFields = [
    `device_description:"${searchTerm}"`,
    `brand_name:"${searchTerm}"`,
    `company_name:"${searchTerm}"`,
    `catalog_number:"${searchTerm}"`,
    `version_or_model_number:"${searchTerm}"`
  ];
  
  const search = searchFields.join(' OR ');
  return await fdaRequestWithPagination('/udi.json', { search }, maxResults);
}

async function searchClassification(searchTerm, maxResults = 1000) {
  const searchFields = [
    `device_name:"${searchTerm}"`,
    `medical_specialty_description:"${searchTerm}"`,
    `product_code:"${searchTerm}"`,
    `regulation_number:"${searchTerm}"`
  ];
  
  const search = searchFields.join(' OR ');
  return await fdaRequestWithPagination('/classification.json', { search }, maxResults);
}

// Route to get complete eCFR part document
router.get('/ecfr-part/:part', async (req, res) => {
  try {
    const { part } = req.params;
    
    // Validate part number
    const validParts = {
      '862': 'Clinical Chemistry and Clinical Toxicology Devices',
      '864': 'Hematology and Pathology Devices', 
      '866': 'Immunology and Microbiology Devices',
      '868': 'Anesthesiology Devices',
      '870': 'Cardiovascular Devices',
      '872': 'Dental Devices',
      '874': 'Ear, Nose, and Throat Devices',
      '876': 'Gastroenterology-Urology Devices',
      '878': 'General and Plastic Surgery Devices',
      '880': 'General Hospital and Personal Use Devices',
      '882': 'Neurological Devices',
      '884': 'Obstetrical and Gynecological Devices',
      '886': 'Ophthalmic Devices',
      '888': 'Orthopedic Devices',
      '890': 'Physical Medicine Devices',
      '892': 'Radiology Devices'
    };
    
    if (!validParts[part]) {
      return res.status(400).json({ 
        error: 'Invalid part number',
        validParts: Object.keys(validParts),
        description: 'Use part numbers 862-892 for medical device regulations'
      });
    }
    
    console.log(`Fetching complete eCFR Part ${part}: ${validParts[part]}`);
    
    const partDocument = await getCompleteECFRPart(part);
    
    if (!partDocument) {
      return res.status(404).json({ 
        error: `Could not fetch eCFR Part ${part}`,
        part,
        description: validParts[part]
      });
    }
    
    res.json({
      part,
      title: `21 CFR Part ${part}`,
      description: validParts[part],
      timestamp: new Date().toISOString(),
      url: `https://www.ecfr.gov/current/title-21/chapter-I/subchapter-H/part-${part}`,
      data: partDocument
    });
    
  } catch (error) {
    console.error(`Error fetching eCFR Part ${req.params.part}:`, error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Route to search within a specific eCFR part
router.get('/ecfr-part/:part/search', async (req, res) => {
  try {
    const { part } = req.params;
    const { q: searchTerm } = req.query;
    
    if (!searchTerm) {
      return res.status(400).json({ error: 'Search term (q) is required' });
    }
    
    console.log(`Searching eCFR Part ${part} for: ${searchTerm}`);
    
    const partDocument = await getCompleteECFRPart(part);
    if (!partDocument) {
      return res.status(404).json({ error: `Could not fetch eCFR Part ${part}` });
    }
    
    // Search within the part document
    const searchResults = searchWithinECFRPart(partDocument, searchTerm);
    
    res.json({
      part,
      searchTerm,
      timestamp: new Date().toISOString(),
      matchCount: searchResults.length,
      results: searchResults
    });
    
  } catch (error) {
    console.error(`Error searching eCFR Part ${req.params.part}:`, error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Function to get complete eCFR part document
async function getCompleteECFRPart(part) {
  try {
    const url = `https://www.ecfr.gov/api/renderer/v1/content/enhanced/2025-06-26/title-21?chapter=I&subchapter=H&part=${part}`;
    const response = await axios.get(url, { 
      timeout: 30000, // Longer timeout for complete documents
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; FDA-Device-Search/1.0)'
      }
    });
    
    return parseCompleteECFRPart(response.data, part);
    
  } catch (error) {
    console.error(`Error fetching eCFR Part ${part}:`, error.message);
    return null;
  }
}

// Parse complete eCFR part document
function parseCompleteECFRPart(htmlContent, part) {
  try {
    const cheerio = require('cheerio');
    const $ = cheerio.load(htmlContent);
    
    const partData = {
      partNumber: part,
      title: '',
      authority: '',
      source: '',
      subparts: [],
      sections: [],
      fullText: '',
      summary: {
        totalSections: 0,
        deviceTypes: [],
        classDistribution: { classI: 0, classII: 0, classIII: 0 }
      }
    };
    
    // Extract part title
    const partTitle = $(`#part-${part} h1`).first().text().trim();
    partData.title = partTitle;
    
    // Extract authority and source
    partData.authority = $(`#part-${part} .authority p`).text().trim();
    partData.source = $(`#part-${part} .source p`).text().trim();
    
    // Parse all subparts
    $(`#part-${part} .subpart`).each(function() {
      const subpartId = $(this).attr('id');
      const subpartTitle = $(this).find('h2').first().text().trim();
      
      const subpart = {
        id: subpartId,
        title: subpartTitle,
        sections: []
      };
      
      // Parse sections within this subpart
      $(this).find('.section').each(function() {
        const section = parseECFRSection($, $(this), part);
        if (section) {
          subpart.sections.push(section);
          partData.sections.push(section);
          
          // Update statistics
          partData.summary.totalSections++;
          if (section.deviceClass) {
            if (section.deviceClass.includes('I')) partData.summary.classDistribution.classI++;
            if (section.deviceClass.includes('II')) partData.summary.classDistribution.classII++;
            if (section.deviceClass.includes('III')) partData.summary.classDistribution.classIII++;
          }
          
          // Extract device types for summary
          if (section.identification && section.identification.length > 50) {
            const deviceType = extractDeviceType(section.identification);
            if (deviceType && !partData.summary.deviceTypes.includes(deviceType)) {
              partData.summary.deviceTypes.push(deviceType);
            }
          }
        }
      });
      
      partData.subparts.push(subpart);
    });
    
    // Get full text content
    partData.fullText = $(`#part-${part}`).text().replace(/\s+/g, ' ').trim();
    
    // Limit device types to most common ones
    partData.summary.deviceTypes = partData.summary.deviceTypes.slice(0, 20);
    
    return partData;
    
  } catch (error) {
    console.error('Error parsing complete eCFR part:', error);
    return null;
  }
}

// Parse individual eCFR section
function parseECFRSection($, sectionElement, part) {
  try {
    const sectionId = sectionElement.attr('id');
    if (!sectionId) return null;
    
    const titleElement = sectionElement.find('h4').first();
    const title = titleElement.text().trim();
    
    // Extract identification
    let identification = '';
    sectionElement.find('p').each(function() {
      const text = $(this).text();
      if (text.includes('Identification.') && text.length > 50) {
        identification = text.replace(/^\([a-z]\)\s*Identification\.\s*/i, '').trim();
        return false;
      }
    });
    
    // Extract classification
    let classification = '';
    sectionElement.find('p').each(function() {
      const text = $(this).text();
      if (text.includes('Classification.') && text.length > 20) {
        classification = text.replace(/^\([a-z]\)\s*Classification\.\s*/i, '').trim();
        return false;
      }
    });
    
    const fullText = sectionElement.text();
    const deviceClass = extractDeviceClass(classification);
    const exemptions = extractExemptions(classification);
    
    return {
      sectionId,
      title,
      identification,
      classification,
      deviceClass,
      exemptions,
      fullText,
      url: `https://www.ecfr.gov/current/title-21/chapter-I/subchapter-H/part-${part}/section-${sectionId}`
    };
    
  } catch (error) {
    console.error('Error parsing eCFR section:', error);
    return null;
  }
}

// Extract device type from identification text
function extractDeviceType(identification) {
  if (!identification) return null;
  
  // Look for device type patterns
  const patterns = [
    /is\s+an?\s+([^.]{10,60})\s+(?:device|system|equipment|instrument)/i,
    /is\s+a\s+([^.]{10,60})\s+intended/i,
    /([A-Z][a-z]+(?:\s+[a-z]+)*)\s+is\s+a\s+device/i
  ];
  
  for (const pattern of patterns) {
    const match = identification.match(pattern);
    if (match && match[1]) {
      return match[1].trim().toLowerCase();
    }
  }
  
  return null;
}

// Search within eCFR part document
function searchWithinECFRPart(partDocument, searchTerm) {
  const results = [];
  const searchRegex = new RegExp(searchTerm, 'gi');
  
  partDocument.sections.forEach(section => {
    const matches = [];
    
    // Check if search term appears in title
    if (searchRegex.test(section.title)) {
      matches.push({ field: 'title', context: section.title });
    }
    
    // Check identification text
    if (section.identification && searchRegex.test(section.identification)) {
      const context = extractContext(section.identification, searchTerm, 100);
      matches.push({ field: 'identification', context });
    }
    
    // Check classification text
    if (section.classification && searchRegex.test(section.classification)) {
      const context = extractContext(section.classification, searchTerm, 100);
      matches.push({ field: 'classification', context });
    }
    
    // Check full text
    if (searchRegex.test(section.fullText)) {
      const context = extractContext(section.fullText, searchTerm, 150);
      matches.push({ field: 'fullText', context });
    }
    
    if (matches.length > 0) {
      results.push({
        section: section.sectionId,
        title: section.title,
        deviceClass: section.deviceClass,
        url: section.url,
        matches
      });
    }
  });
  
  return results;
}

// Extract context around search term
function extractContext(text, searchTerm, contextLength = 100) {
  const regex = new RegExp(`(.{0,${contextLength/2}})${searchTerm}(.{0,${contextLength/2}})`, 'i');
  const match = text.match(regex);
  
  if (match) {
    return `...${match[1]}${match[0]}${match[2]}...`.replace(/\s+/g, ' ').trim();
  }
  
  return text.substring(0, contextLength) + '...';
}

// Comprehensive device intelligence endpoint
// Main device intelligence route with search mode support
router.get('/device-intelligence', async (req, res) => {
  try {
    const { q: searchTerm, mode: searchMode = 'auto' } = req.query;
    
    if (!searchTerm) {
      return res.status(400).json({ error: 'Search term (q) is required' });
    }

    console.log(`Device Intelligence Search for: ${searchTerm} (mode: ${searchMode})`);
    
    // Get FDA data with search mode
    const fdaData = await getAllFDAData(searchTerm, searchMode);
    
    // Generate charts data
    const chartsData = generateChartsData(fdaData);
    
    // Identify applicable eCFR parts (for device searches)
    let applicableParts = [];
    let ecfrData = {};
    
    if (searchMode !== 'company') {
      applicableParts = identifyApplicableECFRParts(fdaData, searchTerm);
      if (applicableParts.length > 0) {
        ecfrData = await getApplicableECFRData(applicableParts, searchTerm);
      }
    }
    
    // Create profile
    const deviceProfile = createEnhancedProfile(searchTerm, fdaData, ecfrData, applicableParts, searchMode);
    
    res.json({
      searchTerm,
      searchMode,
      timestamp: new Date().toISOString(),
      profile: deviceProfile,
      data: {
        fda: fdaData,
        ecfr: ecfrData,
        charts: chartsData
      },
      applicableParts,
      sources: {
        fdaAPIs: Object.keys(fdaData).filter(key => 
          key !== '_metadata' && fdaData[key].results?.length > 0
        ),
        ecfrParts: applicableParts.map(p => `${p.part} - ${p.description}`)
      }
    });

  } catch (error) {
    console.error('Device intelligence search error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});


// Generate interactive charts data
function generateChartsData(fdaData) {
  const endpointNames = ['510k', 'pma', 'recalls', 'adverseEvents', 'enforcement', 'registrations', 'udi', 'classification'];
  const endpointData = [fdaData.fiveOneOk, fdaData.pma, fdaData.recalls, fdaData.adverseEvents, fdaData.enforcement, fdaData.registrations, fdaData.udi, fdaData.classification];
  
  // Source distribution chart
  const sourceDistribution = endpointNames.map((name, index) => ({
    name: name === 'fiveOneOk' ? '510(k)' : name.charAt(0).toUpperCase() + name.slice(1),
    value: endpointData[index]?.results?.length || 0,
    color: getChartColor(index)
  })).filter(item => item.value > 0);

  // Timeline data (last 5 years)
  const timelineData = generateTimelineData(fdaData);
  
  // Device class distribution
  const classDistribution = generateClassDistribution(fdaData);
  
  // Safety events over time
  const safetyTimeline = generateSafetyTimeline(fdaData);

  return {
    sourceDistribution,
    timeline: timelineData,
    classDistribution,
    safetyTimeline
  };
}

function getChartColor(index) {
  const colors = ['#3B82F6', '#10B981', '#EF4444', '#F59E0B', '#8B5CF6', '#06B6D4', '#EC4899', '#6B7280'];
  return colors[index % colors.length];
}

function generateTimelineData(fdaData) {
  const years = {};
  const currentYear = new Date().getFullYear();
  
  // Initialize last 5 years
  for (let i = 4; i >= 0; i--) {
    const year = currentYear - i;
    years[year] = { year, clearances: 0, recalls: 0, adverseEvents: 0 };
  }
  
  // Count 510k clearances by year
  if (fdaData.fiveOneOk?.results) {
    fdaData.fiveOneOk.results.forEach(item => {
      if (item.decision_date) {
        const year = new Date(item.decision_date).getFullYear();
        if (years[year]) {
          years[year].clearances++;
        }
      }
    });
  }
  
  // Count PMA approvals by year
  if (fdaData.pma?.results) {
    fdaData.pma.results.forEach(item => {
      if (item.decision_date) {
        const year = new Date(item.decision_date).getFullYear();
        if (years[year]) {
          years[year].clearances++;
        }
      }
    });
  }
  
  // Count recalls by year
  if (fdaData.recalls?.results) {
    fdaData.recalls.results.forEach(item => {
      if (item.event_date_initiated) {
        const year = new Date(item.event_date_initiated).getFullYear();
        if (years[year]) {
          years[year].recalls++;
        }
      }
    });
  }
  
  // Count adverse events by year
  if (fdaData.adverseEvents?.results) {
    fdaData.adverseEvents.results.forEach(item => {
      if (item.date_received) {
        const year = new Date(item.date_received).getFullYear();
        if (years[year]) {
          years[year].adverseEvents++;
        }
      }
    });
  }
  
  return Object.values(years);
}

function generateClassDistribution(fdaData) {
  const classes = { 'I': 0, 'II': 0, 'III': 0, 'Unknown': 0 };
  
  [fdaData.classification, fdaData.fiveOneOk, fdaData.pma].forEach(dataset => {
    if (dataset?.results) {
      dataset.results.forEach(item => {
        const deviceClass = item.device_class || item.openfda?.device_class;
        if (deviceClass) {
          if (classes[deviceClass] !== undefined) {
            classes[deviceClass]++;
          } else {
            classes['Unknown']++;
          }
        } else {
          classes['Unknown']++;
        }
      });
    }
  });
  
  return Object.entries(classes)
    .filter(([key, value]) => value > 0)
    .map(([key, value]) => ({
      name: `Class ${key}`,
      value,
      color: key === 'I' ? '#10B981' : key === 'II' ? '#F59E0B' : key === 'III' ? '#EF4444' : '#6B7280'
    }));
}

function generateSafetyTimeline(fdaData) {
  const months = {};
  const currentDate = new Date();
  
  // Initialize last 12 months
  for (let i = 11; i >= 0; i--) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    months[key] = { 
      month: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      recalls: 0, 
      adverseEvents: 0 
    };
  }
  
  // Count recalls by month
  if (fdaData.recalls?.results) {
    fdaData.recalls.results.forEach(item => {
      if (item.event_date_initiated) {
        const date = new Date(item.event_date_initiated);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (months[key]) {
          months[key].recalls++;
        }
      }
    });
  }
  
  // Count adverse events by month
  if (fdaData.adverseEvents?.results) {
    fdaData.adverseEvents.results.forEach(item => {
      if (item.date_received) {
        const date = new Date(item.date_received);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (months[key]) {
          months[key].adverseEvents++;
        }
      }
    });
  }
  
  return Object.values(months);
}






// Get all FDA data for a device with fallback handling
// async function getAllFDAData(searchTerm) {
//   console.log(`Fetching FDA data for: ${searchTerm}`);
  
//   // Use Promise.allSettled to continue even if some endpoints fail
//   const results = await Promise.allSettled([
//     search510k(searchTerm),
//     searchPMA(searchTerm),
//     searchRecalls(searchTerm),
//     searchAdverseEvents(searchTerm),
//     searchEnforcement(searchTerm),
//     searchRegistrations(searchTerm),
//     searchUDI(searchTerm),
//     searchClassification(searchTerm)
//   ]);

//   // Process results and handle failures gracefully
//   const [
//     fiveOneOk,
//     pma,
//     recalls,
//     adverseEvents,
//     enforcement,
//     registrations,
//     udi,
//     classification
//   ] = results.map(result => {
//     if (result.status === 'fulfilled') {
//       return result.value;
//     } else {
//       console.error('FDA API call failed:', result.reason.message);
//       return { results: [], error: result.reason.message };
//     }
//   });

//   // Log successful vs failed endpoints
//   const successfulEndpoints = [];
//   const failedEndpoints = [];
  
//   const endpointNames = ['510k', 'pma', 'recalls', 'adverseEvents', 'enforcement', 'registrations', 'udi', 'classification'];
//   const endpointResults = [fiveOneOk, pma, recalls, adverseEvents, enforcement, registrations, udi, classification];
  
//   endpointResults.forEach((result, index) => {
//     if (result.results && result.results.length > 0) {
//       successfulEndpoints.push(endpointNames[index]);
//     } else if (result.error) {
//       failedEndpoints.push(endpointNames[index]);
//     }
//   });
  
//   console.log(`FDA API Summary - Successful: [${successfulEndpoints.join(', ')}], Failed: [${failedEndpoints.join(', ')}]`);

//   return {
//     fiveOneOk,
//     pma,
//     recalls,
//     adverseEvents,
//     enforcement,
//     registrations,
//     udi,
//     classification,
//     _metadata: {
//       successfulEndpoints,
//       failedEndpoints,
//       totalEndpoints: endpointNames.length
//     }
//   };
// }

// Updated getAllFDAData function with configurable max results
// async function getAllFDAData(searchTerm, maxResults = 1000) {
//   console.log(`Fetching FDA data for: ${searchTerm} (max ${maxResults} per endpoint)`);
  
//   // Use Promise.allSettled to continue even if some endpoints fail
//   const results = await Promise.allSettled([
//     search510k(searchTerm, maxResults),
//     searchPMA(searchTerm, maxResults),
//     searchRecalls(searchTerm, maxResults),
//     searchAdverseEvents(searchTerm, maxResults),
//     searchEnforcement(searchTerm, maxResults),
//     searchRegistrations(searchTerm, maxResults),
//     searchUDI(searchTerm, maxResults),
//     searchClassification(searchTerm, maxResults)
//   ]);

//   // Process results and handle failures gracefully
//   const [
//     fiveOneOk,
//     pma,
//     recalls,
//     adverseEvents,
//     enforcement,
//     registrations,
//     udi,
//     classification
//   ] = results.map(result => {
//     if (result.status === 'fulfilled') {
//       return result.value;
//     } else {
//       console.error('FDA API call failed:', result.reason.message);
//       return { results: [], error: result.reason.message, meta: { totalFetched: 0 } };
//     }
//   });

//   // Log successful vs failed endpoints with counts  
//   const successfulEndpoints = [];
//   const failedEndpoints = [];
  
//   const endpointNames = ['510k', 'pma', 'recalls', 'adverseEvents', 'enforcement', 'registrations', 'udi', 'classification'];
//   const endpointResults = [fiveOneOk, pma, recalls, adverseEvents, enforcement, registrations, udi, classification];
  
//   let totalRecords = 0;
//   endpointResults.forEach((result, index) => {
//     const count = result.results?.length || 0;
//     totalRecords += count;
    
//     if (count > 0) {
//       successfulEndpoints.push(`${endpointNames[index]} (${count})`);
//     } else if (result.error) {
//       failedEndpoints.push(endpointNames[index]);
//     }
//   });
  
//   console.log(`FDA API Summary - Total Records: ${totalRecords}`);
//   console.log(`Successful: [${successfulEndpoints.join(', ')}]`);
//   if (failedEndpoints.length > 0) {
//     console.log(`Failed: [${failedEndpoints.join(', ')}]`);
//   }

//   return {
//     fiveOneOk,
//     pma,
//     recalls,
//     adverseEvents,
//     enforcement,
//     registrations,
//     udi,
//     classification,
//     _metadata: {
//       successfulEndpoints,
//       failedEndpoints,
//       totalEndpoints: endpointNames.length,
//       totalRecords,
//       maxResultsPerEndpoint: maxResults
//     }
//   };
// }


// Identify applicable eCFR parts based on FDA data
function identifyApplicableECFRParts(fdaData, searchTerm) {
  const partMapping = {
    '862': { description: 'Clinical Chemistry and Clinical Toxicology Devices', keywords: ['chemistry', 'toxicology', 'blood', 'urine', 'clinical', 'laboratory', 'analyzer', 'glucose', 'cholesterol'] },
    '864': { description: 'Hematology and Pathology Devices', keywords: ['hematology', 'pathology', 'blood', 'cell', 'microscope', 'centrifuge', 'hemoglobin'] },
    '866': { description: 'Immunology and Microbiology Devices', keywords: ['immunology', 'microbiology', 'bacteria', 'virus', 'culture', 'antibody', 'antigen', 'test'] },
    '868': { description: 'Anesthesiology Devices', keywords: ['anesthesia', 'anesthetic', 'ventilator', 'breathing', 'airway', 'oxygen', 'gas'] },
    '870': { description: 'Cardiovascular Devices', keywords: ['heart', 'cardiac', 'cardiovascular', 'pacemaker', 'defibrillator', 'stent', 'catheter', 'blood pressure', 'ecg', 'ekg'] },
    '872': { description: 'Dental Devices', keywords: ['dental', 'tooth', 'teeth', 'oral', 'mouth', 'gum', 'implant', 'filling', 'crown', 'bridge'] },
    '874': { description: 'Ear, Nose, and Throat Devices', keywords: ['ear', 'nose', 'throat', 'hearing', 'ent', 'otolaryngology', 'cochlear', 'tinnitus', 'sinus'] },
    '876': { description: 'Gastroenterology-Urology Devices', keywords: ['gastro', 'urology', 'stomach', 'kidney', 'bladder', 'endoscope', 'catheter', 'dialysis'] },
    '878': { description: 'General and Plastic Surgery Devices', keywords: ['surgery', 'surgical', 'scalpel', 'suture', 'implant', 'plastic', 'cosmetic'] },
    '880': { description: 'General Hospital and Personal Use Devices', keywords: ['hospital', 'bed', 'wheelchair', 'thermometer', 'syringe', 'bandage', 'personal'] },
    '882': { description: 'Neurological Devices', keywords: ['neuro', 'brain', 'nerve', 'spinal', 'stimulator', 'electrode', 'eeg', 'epilepsy'] },
    '884': { description: 'Obstetrical and Gynecological Devices', keywords: ['obstetric', 'gynecological', 'pregnancy', 'fetal', 'contraceptive', 'menstrual'] },
    '886': { description: 'Ophthalmic Devices', keywords: ['eye', 'ophthalmic', 'vision', 'lens', 'contact', 'retina', 'glaucoma', 'cataract'] },
    '888': { description: 'Orthopedic Devices', keywords: ['orthopedic', 'bone', 'joint', 'hip', 'knee', 'spine', 'fracture', 'prosthetic'] },
    '890': { description: 'Physical Medicine Devices', keywords: ['physical', 'rehabilitation', 'therapy', 'exercise', 'mobility', 'walker', 'crutch'] },
    '892': { description: 'Radiology Devices', keywords: ['radiology', 'x-ray', 'mri', 'ct', 'ultrasound', 'imaging', 'scanner', 'radiation'] }
  };

  const applicableParts = [];
  const searchText = searchTerm.toLowerCase();
  
  // Check direct keyword matches
  Object.entries(partMapping).forEach(([part, info]) => {
    const score = info.keywords.filter(keyword => 
      searchText.includes(keyword) || keyword.includes(searchText)
    ).length;
    
    if (score > 0) {
      applicableParts.push({
        part,
        description: info.description,
        relevanceScore: score,
        matchType: 'keyword'
      });
    }
  });

  // Check FDA data for regulation numbers and product codes
  Object.values(fdaData).forEach(dataset => {
    if (dataset.results) {
      dataset.results.forEach(item => {
        // Check regulation numbers
        const regNumber = item.regulation_number || item.openfda?.regulation_number;
        if (regNumber) {
          const part = regNumber.split('.')[0];
          if (partMapping[part] && !applicableParts.find(p => p.part === part)) {
            applicableParts.push({
              part,
              description: partMapping[part].description,
              relevanceScore: 10, // High score for direct regulation match
              matchType: 'regulation',
              regulationNumber: regNumber
            });
          }
        }

        // Check medical specialty
        const specialty = item.medical_specialty_description || item.openfda?.medical_specialty_description;
        if (specialty) {
          Object.entries(partMapping).forEach(([part, info]) => {
            if (info.description.toLowerCase().includes(specialty.toLowerCase()) ||
                specialty.toLowerCase().includes(info.description.toLowerCase())) {
              if (!applicableParts.find(p => p.part === part)) {
                applicableParts.push({
                  part,
                  description: info.description,
                  relevanceScore: 8,
                  matchType: 'specialty',
                  specialty
                });
              }
            }
          });
        }
      });
    }
  });

  // Sort by relevance score and return top matches
  return applicableParts
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 5); // Limit to top 5 most relevant parts
}

// Get eCFR data for applicable parts
async function getApplicableECFRData(applicableParts, searchTerm) {
  const ecfrData = {};
  
  for (const partInfo of applicableParts) {
    try {
      console.log(`Fetching eCFR Part ${partInfo.part}: ${partInfo.description}`);
      
      // Get the complete part document
      const partDocument = await getCompleteECFRPart(partInfo.part);
      
      if (partDocument) {
        // Search within the part for relevant sections
        const searchResults = searchWithinECFRPart(partDocument, searchTerm);
        
        ecfrData[partInfo.part] = {
          partInfo,
          document: partDocument,
          searchResults,
          relevantSections: searchResults.slice(0, 10) // Top 10 most relevant sections
        };
      }
    } catch (error) {
      console.error(`Error fetching eCFR Part ${partInfo.part}:`, error.message);
    }
  }
  
  return ecfrData;
}

// Create comprehensive device profile
function createDeviceProfile(searchTerm, fdaData, ecfrData, applicableParts) {
  const profile = {
    deviceName: searchTerm,
    overview: {
      totalFDARecords: 0,
      regulatoryComplexity: 'Unknown',
      primaryClassification: 'Unknown',
      marketStatus: 'Unknown'
    },
    regulatory: {
      applicableParts: applicableParts.length,
      deviceClasses: [],
      pathways: [],
      exemptions: []
    },
    safety: {
      recallCount: 0,
      adverseEventCount: 0,
      riskLevel: 'Unknown'
    },
    market: {
      active510k: 0,
      activePMA: 0,
      currentRegistrations: 0,
      udiRecords: 0
    },
    recommendations: [],
    keyRegulations: [],
    applicableStandards: []
  };

  // Analyze FDA data
  Object.entries(fdaData).forEach(([key, data]) => {
    if (data.results?.length > 0) {
      profile.overview.totalFDARecords += data.results.length;
      
      if (key === 'recalls') profile.safety.recallCount = data.results.length;
      if (key === 'adverseEvents') profile.safety.adverseEventCount = data.results.length;
      if (key === 'fiveOneOk') profile.market.active510k = data.results.length;
      if (key === 'pma') profile.market.activePMA = data.results.length;
      if (key === 'registrations') profile.market.currentRegistrations = data.results.length;
      if (key === 'udi') profile.market.udiRecords = data.results.length;
    }
  });

  // Analyze eCFR data
  Object.values(ecfrData).forEach(partData => {
    if (partData.searchResults?.length > 0) {
      partData.searchResults.forEach(result => {
        if (result.deviceClass && !profile.regulatory.deviceClasses.includes(result.deviceClass)) {
          profile.regulatory.deviceClasses.push(result.deviceClass);
        }
      });
      
      // Extract key regulations
      profile.keyRegulations.push(...partData.searchResults.slice(0, 3).map(result => ({
        section: result.section,
        title: result.title,
        deviceClass: result.deviceClass,
        part: partData.partInfo.part,
        url: result.url
      })));
    }
  });

  // Determine regulatory pathways
  if (profile.regulatory.deviceClasses.includes('III')) {
    profile.regulatory.pathways.push('PMA (Premarket Approval)');
    profile.overview.regulatoryComplexity = 'High';
  }
  if (profile.regulatory.deviceClasses.includes('II')) {
    profile.regulatory.pathways.push('510(k) Clearance');
    if (profile.overview.regulatoryComplexity === 'Unknown') {
      profile.overview.regulatoryComplexity = 'Medium';
    }
  }
  if (profile.regulatory.deviceClasses.includes('I')) {
    profile.regulatory.pathways.push('Class I (Minimal Requirements)');
    if (profile.overview.regulatoryComplexity === 'Unknown') {
      profile.overview.regulatoryComplexity = 'Low';
    }
  }

  // Determine primary classification
  if (profile.regulatory.deviceClasses.length > 0) {
    profile.overview.primaryClassification = `Class ${profile.regulatory.deviceClasses.sort().reverse()[0]}`;
  }

  // Risk assessment
  if (profile.safety.recallCount > 5 || profile.safety.adverseEventCount > 10) {
    profile.safety.riskLevel = 'High';
  } else if (profile.safety.recallCount > 0 || profile.safety.adverseEventCount > 0) {
    profile.safety.riskLevel = 'Medium';
  } else {
    profile.safety.riskLevel = 'Low';
  }

  // Market status
  if (profile.market.active510k > 0 || profile.market.activePMA > 0) {
    profile.overview.marketStatus = 'FDA Cleared/Approved';
  } else if (profile.market.currentRegistrations > 0) {
    profile.overview.marketStatus = 'Registered';
  } else {
    profile.overview.marketStatus = 'Unknown';
  }

  // Generate recommendations
  if (profile.regulatory.deviceClasses.includes('III')) {
    profile.recommendations.push('PMA required - Plan 2-3+ years for approval process');
    profile.recommendations.push('Extensive clinical trials likely required');
  } else if (profile.regulatory.deviceClasses.includes('II')) {
    profile.recommendations.push('510(k) pathway available - Identify predicate devices');
  }

  if (profile.safety.riskLevel === 'High') {
    profile.recommendations.push('Conduct thorough safety analysis before development');
  }

  if (applicableParts.length > 2) {
    profile.recommendations.push('Multiple CFR parts apply - Review all applicable regulations');
  }

  return profile;
}

module.exports = router;