const express = require('express');
const cors = require('cors');
// const sqlite3 = require('sqlite3').verbose();
// const { open } = require('sqlite');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const cheerio = require('cheerio');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Constants
const FDA_DRUGSFDA_URL = 'https://api.fda.gov/drug/drugsfda.json';
const FDA_LABEL_URL = 'https://api.fda.gov/drug/label.json';
const FDA_ENFORCEMENT_URL = 'https://api.fda.gov/drug/enforcement.json';
const DRUGS_FDA_DOCS_BASE = 'https://www.accessdata.fda.gov/drugsatfda_docs';
const DAILYMED_API_URL = 'https://dailymed.nlm.nih.gov/dailymed/services/v2';
const ORANGE_BOOK_API_URL = 'https://api.fda.gov/drug/orangebook.json'; // Live FDA Orange Book API
const GUIDANCE_API_URL = 'https://api.fda.gov/guidance/guidances.json'; // Live FDA Guidance API


// Local Orange Book Data
let orangeBookData = {
  products: [],
  patents: [],
  exclusivity: []
};

// Load Orange Book JSON files on startup
function loadOrangeBookData() {
  try {
    const files = {
      products: 'products_data.json',
      patents: 'patent_data.json',
      exclusivity: 'exclusivity_data.json'
    };

    Object.keys(files).forEach(key => {
      const filePath = path.join(__dirname, files[key]);
      if (fs.existsSync(filePath)) {
        const jsonData = fs.readFileSync(filePath, 'utf8');
        orangeBookData[key] = JSON.parse(jsonData);
        console.log(`Loaded ${orangeBookData[key].length} ${key} from ${files[key]}`);
      } else {
        console.warn(`Warning: ${files[key]} not found. Starting with empty ${key} dataset.`);
        orangeBookData[key] = [];
      }
    });
  } catch (error) {
    console.error('Error loading Orange Book data:', error);
    orangeBookData = { products: [], patents: [], exclusivity: [] };
  }
}

// Helper functions
const formatYear = (date) => date ? date.substring(0, 4) : 'unknown';

const handleApiError = (error, res, customMessage = 'Internal server error') => {
  console.error(customMessage, error.message);
  if (error.response) {
    return res.status(error.response.status).json({
      error: `API Error: ${error.response.status}`,
      details: error.response.data
    });
  } else if (error.request) {
    return res.status(503).json({ error: 'No response from service. Please try again.' });
  } else {
    return res.status(500).json({ error: customMessage });
  }
};
async function scrapeApprovalDate(appNumber) {
  const url = `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appNumber.replace(/[^0-9]/g, '')}`;
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    const dateText = $('td:contains("Approval Date")').next().text().trim();
    return dateText ? new Date(dateText).toISOString().substring(0, 10) : null;
  } catch (error) {
    console.error(`Error scraping approval date for ${appNumber}:`, error.message);
    return null;
  }
}
/**
 * Search for drugs by name (brand or generic)
 * GET /api/drug/:drugName?type=brand|generic|indication
 */
// app.get('/api/drug/:drugName', async (req, res) => {
//   const { drugName } = req.params;
//   const searchType = req.query.type || 'brand';
  
//   let searchParam;
//   switch (searchType) {
//     case 'generic': searchParam = 'openfda.generic_name'; break;
//     case 'indication': searchParam = 'openfda.indication'; break;
//     case 'brand': default: searchParam = 'openfda.brand_name'; break;
//   }
  
//   try {
//     const response = await axios.get(`${FDA_DRUGSFDA_URL}?search=${searchParam}:"${drugName}"&limit=100`);
//     const results = response.data.results || [];
//     if (!results.length) return res.json({ error: 'No results found' });
    
//     const categorizedDrugs = {};
    
//     for (const drug of results) {
//       const appNumber = drug.application_number;
//       const products = drug.products || [];
//       const submissions = drug.submissions || [];
      
//       // FIXED: Better approval date extraction logic
//       let approvalDate = 'Unknown';
      
//       // First try to find ORIG-1 or submission number 1
//       const originalApproval = submissions.find(s => 
//         (s.submission_number === '1' || s.submission_number === 'ORIG-1') && 
//         (s.submission_status === 'AP' || s.submission_status === 'Approved')
//       );
      
//       // If not found, look for any approval
//       if (originalApproval) {
//         approvalDate = originalApproval.submission_status_date;
//       } else {
//         const anyApproval = submissions.find(s => 
//           s.submission_status === 'AP' || s.submission_status === 'Approved'
//         );
//         if (anyApproval) {
//           approvalDate = anyApproval.submission_status_date;
//         }
//       }
      
//       // If still no date found, try web scraping as fallback
//       if (!approvalDate || approvalDate === 'Unknown') {
//         approvalDate = await scrapeApprovalDate(appNumber) || 'Unknown';
//       }
      
//       const year = formatYear(approvalDate);
//       const basePath = appNumber.startsWith('ANDA') ? 'anda' : 'nda';
//       const cleanAppNumber = appNumber.replace(/[^0-9A-Za-z-]/g, '');

//       for (const product of products) {
//         if (!product.brand_name) continue;
        
//         const brandName = product.brand_name.toLowerCase();
//         const activeIngredients = product.active_ingredients || [];
//         const strength = activeIngredients.map(ing => `${ing.name} ${ing.strength}`).join(', ') || 'Unknown';
        
//         if (!categorizedDrugs[brandName]) categorizedDrugs[brandName] = {};
//         if (!categorizedDrugs[brandName][strength]) categorizedDrugs[brandName][strength] = [];
        
//         // FIXED: More robust PDF link construction with better path handling
//         const appNumWithoutPrefix = appNumber.replace(/^[A-Za-z]+/i, '');
//         const pdfLinks = {
//           approvalLetter: year && approvalDate !== 'Unknown' ? 
//             `${DRUGS_FDA_DOCS_BASE}/${basePath}/${cleanAppNumber.substring(0,6)}/${year}/${cleanAppNumber}_Approv.pdf` : null,
//           label: year && approvalDate !== 'Unknown' ? 
//             `${DRUGS_FDA_DOCS_BASE}/${basePath}/${cleanAppNumber.substring(0,6)}/${year}/${cleanAppNumber}_lbl.pdf` : null,
//           medicalReview: year && approvalDate !== 'Unknown' ? 
//             `${DRUGS_FDA_DOCS_BASE}/${basePath}/${cleanAppNumber.substring(0,6)}/${year}/${cleanAppNumber}_Medr.pdf` : null,
//         };
        
//         categorizedDrugs[brandName][strength].push({
//           brandName: product.brand_name,
//           drug: drug,
//           applicationNumber: appNumber,
//           approvalDate,
//           submissions: submissions.map(s => ({
//             submissionNumber: s.submission_number,
//             status: s.submission_status,
//             date: s.submission_status_date,
//             type: s.submission_type
//           })),
//           pdfLinks,
//           fdaPage: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appNumber.replace(/[^0-9]/g, '')}`,
//           sponsorName: drug.sponsor_name,
//           activeIngredients,
//           manufacturerName: drug.openfda?.manufacturer_name?.[0] || drug.sponsor_name,
//           dosageForm: product.dosage_form,
//           route: product.route,
//           marketingStatus: product.marketing_status,
//         });
//       }
//     }
    
//     res.json(categorizedDrugs);
//   } catch (error) {
//     handleApiError(error, res, 'Error fetching drug data');
//   }
// });

app.get('/api/drug/:drugName', async (req, res) => {
  console.log("194")
  const { drugName } = req.params;
  const searchType = req.query.type || 'brand';
  
  let searchParam;
  switch (searchType) {
    case 'generic': searchParam = 'openfda.generic_name'; break;
    case 'indication': searchParam = 'openfda.indication'; break;
    case 'brand': default: searchParam = 'openfda.brand_name'; break;
  }
  
  try {
    const response = await axios.get(`${FDA_DRUGSFDA_URL}?search=${searchParam}:"${drugName}"&limit=100`);
    const results = response.data.results || [];
    if (!results.length) return res.json({ error: 'No results found' });
    
    const categorizedDrugs = {};
    
    for (const drug of results) {
      const appNumber = drug.application_number;
      const products = drug.products || [];
      const submissions = drug.submissions || [];
      
      // Improved approval date extraction logic
      let approvalDate = 'Unknown';
      
      // First try to find ORIG-1 or submission number 1
      const originalApproval = submissions.find(s => 
        (s.submission_number === '1' || s.submission_number === 'ORIG-1') && 
        (s.submission_status === 'AP' || s.submission_status === 'Approved')
      );
      
      // If not found, look for any approval
      if (originalApproval) {
        approvalDate = originalApproval.submission_status_date;
      } else {
        const anyApproval = submissions.find(s => 
          s.submission_status === 'AP' || s.submission_status === 'Approved'
        );
        if (anyApproval) {
          approvalDate = anyApproval.submission_status_date;
        }
      }
      
      // If still no date found, try web scraping as fallback
      if (!approvalDate || approvalDate === 'Unknown') {
        approvalDate = await scrapeApprovalDate(appNumber) || 'Unknown';
      }

      for (const product of products) {
        if (!product.brand_name) continue;
        
        const brandName = product.brand_name.toLowerCase();
        const activeIngredients = product.active_ingredients || [];
        const strength = activeIngredients.map(ing => `${ing.name} ${ing.strength}`).join(', ') || 'Unknown';
        
        if (!categorizedDrugs[brandName]) categorizedDrugs[brandName] = {};
        if (!categorizedDrugs[brandName][strength]) categorizedDrugs[brandName][strength] = [];
        
        // Instead of constructing links here, we'll indicate they should be fetched on demand
        categorizedDrugs[brandName][strength].push({
          brandName: product.brand_name,
          drug: drug,
          applicationNumber: appNumber,
          approvalDate,
          submissions: submissions.map(s => ({
            submissionNumber: s.submission_number,
            status: s.submission_status,
            date: s.submission_status_date,
            type: s.submission_type
          })),
          // Just store a flag to indicate we need to get documents for this application
          hasDocuments: true,
          fdaPage: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appNumber.replace(/[^0-9]/g, '')}`,
          sponsorName: drug.sponsor_name,
          activeIngredients,
          manufacturerName: drug.openfda?.manufacturer_name?.[0] || drug.sponsor_name,
          dosageForm: product.dosage_form,
          route: product.route,
          marketingStatus: product.marketing_status,
        });
      }
    }
    
    res.json(categorizedDrugs);
  } catch (error) {
    handleApiError(error, res, 'Error fetching drug data');
  }
});

async function scrapeFdaDocLinks(appNumber) {
  const cleanAppNumber = appNumber.replace(/[^0-9]/g, '');
  const baseUrl = 'https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm';
  
  try {
    // First, try to get the application page
    const response = await axios.get(`${baseUrl}?event=overview.process&ApplNo=${cleanAppNumber}`);
    const $ = cheerio.load(response.data);
    
    // Look for links to reviews
    const links = {};
    
    // Check for the reviews tab link
    const reviewsTabLink = $('a:contains("Reviews")').attr('href');
    
    if (reviewsTabLink) {
      // Follow the reviews tab link
      const reviewsUrl = reviewsTabLink.startsWith('http') ? 
        reviewsTabLink : 
        `https://www.accessdata.fda.gov/scripts/cder/daf/${reviewsTabLink}`;
      
      const reviewsResponse = await axios.get(reviewsUrl);
      const $reviews = cheerio.load(reviewsResponse.data);
      
      // Look for PDF links in the reviews page
      $reviews('a[href$=".pdf"]').each((i, el) => {
        const linkText = $reviews(el).text().trim();
        const linkHref = $reviews(el).attr('href');
        
        // Full link if it's already absolute, otherwise make it absolute
        const fullLink = linkHref.startsWith('http') ? 
          linkHref : 
          `https://www.accessdata.fda.gov${linkHref.startsWith('/') ? '' : '/'}${linkHref}`;
        
        // Categorize links based on text
        if (linkText.toLowerCase().includes('letter') || linkHref.toLowerCase().includes('approv')) {
          links.approvalLetter = fullLink;
        } else if (linkText.toLowerCase().includes('label') || linkHref.toLowerCase().includes('lbl')) {
          links.label = fullLink;
        } else if (linkText.toLowerCase().includes('review') || linkHref.toLowerCase().includes('medr')) {
          links.medicalReview = fullLink;
        } else if (linkText.toLowerCase().includes('chemistry') || linkHref.toLowerCase().includes('chemr')) {
          links.chemistryReview = fullLink;
        } else if (linkText.toLowerCase().includes('clinical')) {
          links.clinicalReview = fullLink;
        } else if (linkText.toLowerCase().includes('summary')) {
          links.summaryReview = fullLink;
        } else {
          // For other PDFs, store with numerical keys
          const key = `otherDocument${Object.keys(links).filter(k => k.startsWith('otherDocument')).length + 1}`;
          links[key] = fullLink;
        }
      });
      
      // Check for a TOC link (Table of Contents for reviews)
      $reviews('a:contains("Table of Contents")').each((i, el) => {
        const tocHref = $reviews(el).attr('href');
        if (tocHref) {
          links.reviewTOC = tocHref.startsWith('http') ? 
            tocHref : 
            `https://www.accessdata.fda.gov${tocHref.startsWith('/') ? '' : '/'}${tocHref}`;
        }
      });
    }
    
    // Check for any PDF links on the main page too
    $('a[href$=".pdf"]').each((i, el) => {
      const linkText = $(el).text().trim();
      const linkHref = $(el).attr('href');
      
      // Full link if it's already absolute, otherwise make it absolute
      const fullLink = linkHref.startsWith('http') ? 
        linkHref : 
        `https://www.accessdata.fda.gov${linkHref.startsWith('/') ? '' : '/'}${linkHref}`;
      
      // Only add if we don't already have this type of link
      if (linkText.toLowerCase().includes('letter') && !links.approvalLetter) {
        links.approvalLetter = fullLink;
      } else if (linkText.toLowerCase().includes('label') && !links.label) {
        links.label = fullLink;
      } else if (linkText.toLowerCase().includes('review') && !links.medicalReview) {
        links.medicalReview = fullLink;
      }
    });
    
    // If scraping found no links, fall back to constructing them
    if (Object.keys(links).length === 0) {
      return constructFdaDocLinks(appNumber);
    }
    
    return links;
  } catch (error) {
    console.error(`Error scraping FDA doc links for ${appNumber}:`, error.message);
    // Fall back to constructing links
    return constructFdaDocLinks(appNumber);
  }
}

// Fallback function to construct FDA document links based on patterns
function constructFdaDocLinks(appNumber, approvalDate) {
  // Format the approval date for use in URLs
  let year = 'unknown';
  if (approvalDate && approvalDate !== 'Unknown') {
    // Handle YYYYMMDD format
    if (/^\d{8}$/.test(approvalDate)) {
      year = approvalDate.substring(0, 4);
    } 
    // Handle YYYY-MM-DD format
    else if (/^\d{4}-\d{2}-\d{2}$/.test(approvalDate)) {
      year = approvalDate.substring(0, 4);
    }
    // Handle other date formats
    else {
      try {
        const date = new Date(approvalDate);
        if (!isNaN(date.getTime())) {
          year = date.getFullYear().toString();
        }
      } catch (e) {
        console.error("Error parsing approval date:", e);
      }
    }
  }
  
  // Determine application type and format number
  const isAnda = appNumber.startsWith('ANDA');
  const isNda = appNumber.startsWith('NDA');
  const appType = isAnda ? 'anda' : 'nda';
  
  // Clean the application number
  const cleanAppNumber = appNumber.replace(/[^0-9]/g, '');
  
  if (year === 'unknown') {
    // Try older style FDA links if we don't have a year
    return {
      approvalLetter: `https://www.accessdata.fda.gov/drugsatfda_docs/${appType}/${cleanAppNumber}_Approv.pdf`,
      label: `https://www.accessdata.fda.gov/drugsatfda_docs/${appType}/${cleanAppNumber}_lbl.pdf`,
      medicalReview: `https://www.accessdata.fda.gov/drugsatfda_docs/${appType}/${cleanAppNumber}.pdf`,
      reviewTOC: `https://www.accessdata.fda.gov/drugsatfda_docs/${appType}/${cleanAppNumber}TOC.cfm`
    };
  }
  
  // Try multiple formats based on year
  const links = {};
  
  // Format 1: Modern format with prefixed application type (post-2010)
  links.approvalLetter = `https://www.accessdata.fda.gov/drugsatfda_docs/${appType}/${year}/${appNumber}_Approv.pdf`;
  links.label = `https://www.accessdata.fda.gov/drugsatfda_docs/${appType}/${year}/${appNumber}_Lbl.pdf`;
  
  // Format the review document TOC and general PDF
  links.reviewTOC = `https://www.accessdata.fda.gov/drugsatfda_docs/${appType}/${year}/${appNumber}TOC.cfm`;
  links.medicalReview = `https://www.accessdata.fda.gov/drugsatfda_docs/${appType}/${year}/${cleanAppNumber}.pdf`;
  
  // Format 2: Year-based directory structure
  links.approvalLetter2 = `https://www.accessdata.fda.gov/drugsatfda_docs/${appType}/${year}/${cleanAppNumber}_Approv.pdf`;
  links.label2 = `https://www.accessdata.fda.gov/drugsatfda_docs/${appType}/${year}/${cleanAppNumber}_lbl.pdf`;
  
  // Format 3: Direct year and number
  links.medicalReview2 = `https://www.accessdata.fda.gov/drugsatfda_docs/${appType}/${year}/${cleanAppNumber}.PDF`;
  
  return links;
}

// Updated endpoint to get FDA document links
app.get('/api/documents/:appNumber', async (req, res) => {
  console.log("448")
  const { appNumber } = req.params;
  
  try {
    // First get application data to get approval date
    const response = await axios.get(`${FDA_DRUGSFDA_URL}?search=application_number:"${appNumber}"&limit=1`);
    const drugData = response.data.results?.[0];
    
    let approvalDate = 'Unknown';
    if (drugData) {
      const submissions = drugData.submissions || [];
      
      // Find original approval first
      const originalApproval = submissions.find(s => 
        (s.submission_number === '1' || s.submission_number === 'ORIG-1') && 
        (s.submission_status === 'AP' || s.submission_status === 'Approved')
      );
      
      // If not found, look for any approval
      if (originalApproval) {
        approvalDate = originalApproval.submission_status_date;
      } else {
        const anyApproval = submissions.find(s => 
          s.submission_status === 'AP' || s.submission_status === 'Approved'
        );
        if (anyApproval) {
          approvalDate = anyApproval.submission_status_date;
        }
      }
    }
    
    // Try to scrape FDA website for document links
    const docLinks = await scrapeFdaDocLinks(appNumber);
    
    // If scraping fails, construct links based on patterns
    const links = Object.keys(docLinks).length > 0 ? 
      docLinks : 
      constructFdaDocLinks(appNumber, approvalDate);
    
    res.json({ links });
  } catch (error) {
    handleApiError(error, res, 'Error fetching FDA document links');
  }
});

/**
 * Get DailyMed data for a drug by ingredient name
 * GET /api/dailymed/:ingredient
 */
app.get('/api/dailymed/:ingredient', async (req, res) => {
  console.log("497")
  const { ingredient } = req.params;
  
  try {
    // For better results, clean up the ingredient name 
    // by removing any dosage information or parentheses
    const cleanIngredient = ingredient
      .replace(/\s*\(.*?\)\s*/g, '') // Remove parentheses and their content
      .replace(/\d+\s*mg|\d+\s*mcg|\d+\s*mL/gi, '') // Remove dosages
      .trim();
    
    const response = await axios.get(`${DAILYMED_API_URL}/spls.json?ingredient=${encodeURIComponent(cleanIngredient)}`);
    const data = response.data;
    
    if (!data.data || data.data.length === 0) {
      return res.json({ error: 'No DailyMed data found' });
    }
    
    const labelInfo = await Promise.all(
      data.data.slice(0, 5).map(async (label) => {
        try {
          // Use proper Accept header to avoid 415 errors
          const detailsResponse = await axios.get(`${DAILYMED_API_URL}/spls/${label.setid}.json`, {
            headers: { 
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            }
          });
          const details = detailsResponse.data;
          
          // Format the published date properly
          let formattedDate = label.published;
          try {
            if (label.published) {
              const pubDate = new Date(label.published);
              if (!isNaN(pubDate.getTime())) {
                // Format as YYYY-MM-DD
                formattedDate = pubDate.toISOString().split('T')[0];
              }
            }
          } catch (e) {
            console.error("Error formatting DailyMed date:", e);
          }
          
          return {
            setId: label.setid,
            title: details.title || label.title,
            published: formattedDate,
            labelUrl: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${label.setid}`,
            packageUrl: details.packaging_uris?.[0] 
              ? `https://dailymed.nlm.nih.gov/dailymed/image.cfm?setid=${label.setid}&type=img`
              : null,
            activeIngredients: details.active_ingredients || [],
            ndc: details.package_ndc?.join(', ') || 'N/A',
            rxcui: details.rxcui || 'N/A',
            // Add more useful information if available
            manufacturer: details.labeler || 'N/A',
            dosageForm: details.dosage_forms_and_strengths || 'N/A'
          };
        } catch (error) {
          console.error(`Error fetching details for label ${label.setid}:`, error.message);
          
          // Format the published date even when detail fetch fails
          let formattedDate = label.published;
          try {
            if (label.published) {
              const pubDate = new Date(label.published);
              if (!isNaN(pubDate.getTime())) {
                formattedDate = pubDate.toISOString().split('T')[0];
              }
            }
          } catch (e) {
            console.error("Error formatting DailyMed date:", e);
          }
          
          // Return basic info when detailed fetch fails
          return {
            setId: label.setid,
            title: label.title,
            published: formattedDate,
            labelUrl: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${label.setid}`
          };
        }
      })
    );
    
    res.json({ label_info: labelInfo });
  } catch (error) {
    handleApiError(error, res, 'Error fetching DailyMed data');
  }
});


app.get('/api/dailymed/recent', async (req, res) => {
  console.log("593")
  try {
    // DailyMed API doesn't have a direct "sort by date" option, so we'll fetch SPLs and sort manually
    const response = await axios.get(`${DAILYMED_API_URL}/spls.json?limit=50`);
    const results = response.data.data || [];
    
    if (!results.length) return res.json({ error: 'No recent labels found' });
    
    // Sort by published date (most recent first)
    const sortedResults = results.sort((a, b) => new Date(b.published) - new Date(a.published));
    
    const recentLabels = await Promise.all(
      sortedResults.slice(0, 50).map(async (label) => {
        try {
          const detailsResponse = await axios.get(`${DAILYMED_API_URL}/spls/${label.setid}.json`, {
            headers: { 'Accept': 'application/json' }
          });
          const details = detailsResponse.data;
          
          return {
            setId: label.setid,
            title: details.title || label.title,
            publishedDate: details.published || label.published,
            activeIngredients: details.active_ingredients?.map(ing => ({
              name: ing.name,
              strength: ing.strength || 'N/A'
            })) || [],
            ndc: details.package_ndc?.join(', ') || 'N/A',
            rxcui: details.rxcui || 'N/A',
            labelUrl: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${label.setid}`,
            packageUrl: details.packaging_uris?.[0] 
              ? `https://dailymed.nlm.nih.gov/dailymed/image.cfm?setid=${label.setid}&type=img`
              : null
          };
        } catch (error) {
          console.error(`Error fetching details for label ${label.setid}:`, error.message);
          return {
            setId: label.setid,
            title: label.title,
            publishedDate: label.published,
            labelUrl: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${label.setid}`
          };
        }
      })
    );
    
    res.json({ recentLabels });
  } catch (error) {
    handleApiError(error, res, 'Error fetching recent DailyMed labels');
  }
});

/**
 * Search for drug labels by name or condition in DailyMed
 * GET /api/dailymed/search?q=query&type=drug|condition
 */
app.get('/api/dailymed/search', async (req, res) => {
  console.log("650")
  const { q: query } = req.query;
  const searchType = req.query.type || 'drug';
  
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }
  
  try {
    // DailyMed search by ingredient for drugs, or we'll need to filter manually for conditions
    let searchUrl = searchType === 'drug' 
      ? `${DAILYMED_API_URL}/spls.json?ingredient=${encodeURIComponent(query)}`
      : `${DAILYMED_API_URL}/spls.json`; // Fetch all and filter for conditions
    
    const response = await axios.get(searchUrl, {
      headers: { 'Accept': 'application/json' }
    });
    let results = response.data.data || [];
    
    if (!results.length) return res.json({ error: 'No results found' });
    
    // For condition search, filter results manually since DailyMed doesn't have a direct indication search
    if (searchType === 'condition') {
      results = await Promise.all(
        results.map(async (label) => {
          const detailsResponse = await axios.get(`${DAILYMED_API_URL}/spls/${label.setid}.json`, {
            headers: { 'Accept': 'application/json' }
          });
          const details = detailsResponse.data;
          // Check if the condition is mentioned in the title or indications (simplified)
          const hasCondition = details.title?.toLowerCase().includes(query.toLowerCase()) ||
                              details.indications_and_usage?.toLowerCase().includes(query.toLowerCase());
          return hasCondition ? label : null;
        })
      );
      results = results.filter(label => label !== null);
    }
    
    if (!results.length) return res.json({ error: 'No results found after filtering' });
    
    const searchResults = await Promise.all(
      results.slice(0, 50).map(async (label) => {
        try {
          const detailsResponse = await axios.get(`${DAILYMED_API_URL}/spls/${label.setid}.json`, {
            headers: { 'Accept': 'application/json' }
          });
          const details = detailsResponse.data;
          
          return {
            setId: label.setid,
            title: details.title || label.title,
            publishedDate: details.published || label.published,
            activeIngredients: details.active_ingredients?.map(ing => ({
              name: ing.name,
              strength: ing.strength || 'N/A'
            })) || [],
            indications: details.indications_and_usage || 'N/A',
            ndc: details.package_ndc?.join(', ') || 'N/A',
            rxcui: details.rxcui || 'N/A',
            labelUrl: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${label.setid}`,
            packageUrl: details.packaging_uris?.[0] 
              ? `https://dailymed.nlm.nih.gov/dailymed/image.cfm?setid=${label.setid}&type=img`
              : null
          };
        } catch (error) {
          console.error(`Error fetching details for label ${label.setid}:`, error.message);
          return {
            setId: label.setid,
            title: label.title,
            publishedDate: label.published,
            labelUrl: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${label.setid}`
          };
        }
      })
    );
    
    res.json({ results: searchResults });
  } catch (error) {
    handleApiError(error, res, 'Error searching DailyMed data');
  }
});


/**
 * Get Orange Book data for a specific application
 * GET /api/orangebook/:appNumber
 */
/**
 * Enhanced Orange Book endpoint with patents
 * GET /api/orangebook/:appNumber
 */
// Added new endpoint for recent submissions
app.get('/api/recent', async (req, res) => {
  try {
    // Get recent DailyMed submissions
    const dailymedPromise = axios.get(`${DAILYMED_API_URL}/spls.json?limit=10`);
    
    // Get recent FDA drug approvals 
    const fdaApprovalPromise = axios.get(`${FDA_DRUGSFDA_URL}?search=submissions.submission_status:"AP"&limit=10&sort=submissions.submission_status_date:desc`);
    
    // Execute promises in parallel
    const [dailymedRes, fdaApprovalRes] = await Promise.all([dailymedPromise, fdaApprovalPromise]);
    
    // Process DailyMed data
    const recentDailyMed = dailymedRes.data.data.map(item => {
      // Ensure we have a properly formatted date for DailyMed submissions
      let formattedDate = item.published;
      try {
        if (item.published) {
          // Try to standardize the date format
          const pubDate = new Date(item.published);
          if (!isNaN(pubDate.getTime())) {
            formattedDate = pubDate.toISOString().split('T')[0]; // YYYY-MM-DD format
          }
        }
      } catch (e) {
        console.error("Error formatting DailyMed date:", e);
      }
      
      return {
        title: item.title,
        type: 'DailyMed',
        date: formattedDate,
        url: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${item.setid}`
      };
    });
    
    // Process FDA approval data with improved date handling
    const recentApprovals = fdaApprovalRes.data.results.map(item => {
      const appNumber = item.application_number;
      
      // Find the most recent approval submission
      const approvals = item.submissions
        .filter(s => s.submission_status === 'AP' || s.submission_status === 'Approved')
        .sort((a, b) => {
          // Handle YYYYMMDD format common in FDA dates
          // Convert to YYYY-MM-DD for comparison if possible
          let dateA = a.submission_status_date;
          let dateB = b.submission_status_date;
          
          if (/^\d{8}$/.test(dateA)) {
            dateA = `${dateA.substring(0, 4)}-${dateA.substring(4, 6)}-${dateA.substring(6, 8)}`;
          }
          
          if (/^\d{8}$/.test(dateB)) {
            dateB = `${dateB.substring(0, 4)}-${dateB.substring(4, 6)}-${dateB.substring(6, 8)}`;
          }
          
          return new Date(dateB) - new Date(dateA);
        });
      
      const latestApproval = approvals[0];
      
      // Get product name
      const brandName = item.products?.[0]?.brand_name || 
                        item.openfda?.brand_name?.[0] || 
                        item.openfda?.generic_name?.[0] || 
                        'Unknown';
      
      // Format the date properly
      let formattedDate = 'Unknown';
      if (latestApproval?.submission_status_date) {
        const dateStr = latestApproval.submission_status_date;
        if (/^\d{8}$/.test(dateStr)) {
          // Convert YYYYMMDD to YYYY-MM-DD
          formattedDate = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
        } else {
          formattedDate = dateStr;
        }
      }
      
      return {
        title: `${brandName} (${appNumber})`,
        type: 'FDA Approval',
        date: formattedDate,
        url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appNumber.replace(/[^0-9]/g, '')}`
      };
    });
    
    // Combine all data, sort by date (newest first) and limit to 20 items
    const allRecent = [...recentDailyMed, ...recentApprovals]
      .filter(item => item.date && item.date !== 'Unknown')
      .sort((a, b) => {
        try {
          return new Date(b.date) - new Date(a.date);
        } catch (e) {
          return 0; // In case of invalid dates
        }
      })
      .slice(0, 20);
    
    res.json({ recentSubmissions: allRecent });
  } catch (error) {
    handleApiError(error, res, 'Error fetching recent submissions');
  }
});
// Fix for Orange Book API endpoint
// New Orange Book Search Endpoint
app.get('/api/orangebook/search', (req, res) => {
  console.log("849")
  const { q: query } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  const searchTerm = query.toLowerCase();
  const results = {
    products: [],
    patents: [],
    exclusivity: []
  };

  // Search Products
  results.products = orangeBookData.products.filter(product =>
    Object.values(product).some(val =>
      String(val).toLowerCase().includes(searchTerm)
    )
  );

  // Search Patents
  results.patents = orangeBookData.patents.filter(patent =>
    Object.values(patent).some(val =>
      String(val).toLowerCase().includes(searchTerm)
    )
  );

  // Search Exclusivity
  results.exclusivity = orangeBookData.exclusivity.filter(exclusivity =>
    Object.values(exclusivity).some(val =>
      String(val).toLowerCase().includes(searchTerm)
    )
  );

  res.json({
    results: {
      products: results.products.slice(0, 50), // Limit results for performance
      patents: results.patents.slice(0, 50),
      exclusivity: results.exclusivity.slice(0, 50)
    },
    total: {
      products: results.products.length,
      patents: results.patents.length,
      exclusivity: results.exclusivity.length
    }
  });
});

// Existing /api/orangebook/:appNumber endpoint (updated to include local data as fallback)
app.get('/api/orangebook/:appNumber', async (req, res) => {
  console.log("900")
  const { appNumber } = req.params;

  try {
    // Try live FDA Orange Book API first
    const response = await axios.get(`${ORANGE_BOOK_API_URL}?search=application_number:"${appNumber}"&limit=10`);
    const results = response.data.results || [];

    if (results.length) {
      const drugData = results[0];
      return res.json({
        applicationNumber: drugData.application_number,
        patents: drugData.patent?.map(p => ({
          patentNo: p.patent_number,
          expirationDate: p.expiration_date,
          drugSubstance: p.drug_substance_flag === 'Y',
          drugProduct: p.drug_product_flag === 'Y',
          useCode: p.patent_use_code || 'N/A'
        })) || [],
        exclusivities: drugData.exclusivity?.map(e => ({
          code: e.exclusivity_code,
          expirationDate: e.expiration_date
        })) || []
      });
    }

    // Fallback to local JSON data if API returns no results
    const localResults = {
      applicationNumber: appNumber,
      patents: orangeBookData.patents.filter(p => p['New Drug Application (NDA) Number'] === appNumber),
      exclusivities: orangeBookData.exclusivity.filter(e => e['New Drug Application (NDA) Number'] === appNumber)
    };

    if (localResults.patents.length || localResults.exclusivities.length) {
      return res.json({
        applicationNumber: appNumber,
        patents: localResults.patents.map(p => ({
          patentNo: p['Patent Number'],
          expirationDate: p['Patent Expire Date'],
          drugSubstance: p['Drug Substance Flag'] === 'Y',
          drugProduct: p['Drug Product Flag'] === 'Y',
          useCode: p['Patent Use Code'] || 'N/A'
        })),
        exclusivities: localResults.exclusivities.map(e => ({
          code: e['Exclusivity Code'],
          expirationDate: e['Exclusivity Date']
        }))
      });
    }

    // If no data found in API or local files
    res.json({
      applicationNumber: appNumber,
      patents: [],
      exclusivities: []
    });
  } catch (error) {
    // Fallback to local data on API error
    const localResults = {
      applicationNumber: appNumber,
      patents: orangeBookData.patents.filter(p => p['New Drug Application (NDA) Number'] === appNumber),
      exclusivities: orangeBookData.exclusivity.filter(e => e['New Drug Application (NDA) Number'] === appNumber)
    };

    res.json({
      applicationNumber: appNumber,
      patents: localResults.patents.map(p => ({
        patentNo: p['Patent Number'],
        expirationDate: p['Patent Expire Date'],
        drugSubstance: p['Drug Substance Flag'] === 'Y',
        drugProduct: p['Drug Product Flag'] === 'Y',
        useCode: p['Patent Use Code'] || 'N/A'
      })),
      exclusivities: localResults.exclusivities.map(e => ({
        code: e['Exclusivity Code'],
        expirationDate: e['Exclusivity Date']
      }))
    });
  }
});

/**
 * Scrape Orange Book data as a fallback
 */
async function scrapeOrangeBook(appNumber) {
  const url = `https://www.accessdata.fda.gov/scripts/cder/ob/results_product.cfm?Appl_Type=${appNumber.startsWith('A') ? 'A' : 'N'}&Appl_No=${appNumber.replace(/[^0-9]/g, '')}`;
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    
    const patents = [];
    const exclusivities = [];
    
    $('table#patent tbody tr').each((i, row) => {
      const cols = $(row).find('td');
      patents.push({
        patentNo: $(cols[0]).text().trim(),
        expirationDate: $(cols[1]).text().trim(),
        drugSubstance: $(cols[2]).text().trim() === 'Yes',
        drugProduct: $(cols[3]).text().trim() === 'Yes',
        useCode: $(cols[4]).text().trim() || 'N/A'
      });
    });
    
    $('table#exclusivity tbody tr').each((i, row) => {
      const cols = $(row).find('td');
      exclusivities.push({
        code: $(cols[0]).text().trim(),
        expirationDate: $(cols[1]).text().trim()
      });
    });
    
    return {
      applicationNumber: appNumber,
      patents: patents.length > 0 ? patents : null,
      exclusivities: exclusivities.length > 0 ? exclusivities : null
    };
  } catch (error) {
    console.error(`Error scraping Orange Book for ${appNumber}:`, error.message);
    return null;
  }
}

/**
 * Search for guidance documents relevant to a drug
 * GET /api/guidances?q=query
 */
app.get('/api/guidances', async (req, res) => {
  const { q } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }
  
  try {
    // Try FDA guidance API
    const response = await axios.get(`${GUIDANCE_API_URL}?search="${q}"&limit=10`);
    const results = response.data.results || [];
    
    if (!results.length) {
      // Return empty valid response instead of error
      return res.json({ guidances: [] });
    }
    
    const guidances = results.map(g => ({
      title: g.title,
      source: 'FDA',
      date: g.publication_date,
      url: g.url || `https://www.fda.gov/regulatory-information/search-fda-guidance-documents`,
      description: g.title // Using title as description since API lacks detailed description
    }));
    
    res.json({ guidances });
  } catch (error) {
    // Return empty valid array instead of error
    res.json({ guidances: [] });
  }
});

// Fix for Application Data endpoint
app.get('/api/application/:appNumber', async (req, res) => {
  const { appNumber } = req.params;
  
  try {
    const response = await axios.get(`${FDA_DRUGSFDA_URL}?search=application_number:"${appNumber}"&limit=1`);
    const drugData = response.data.results?.[0];
    if (!drugData) return res.json({ 
      error: 'No data found',
      approvalHistory: { originalApproval: {}, supplements: [] },
      products: [],
      therapeuticEquivalents: []
    });
    
    // Get approval date using the improved logic
    let approval = drugData.submissions?.find(s => 
      (s.submission_number === '1' || s.submission_number === 'ORIG-1') && 
      (s.submission_status === 'AP' || s.submission_status === 'Approved')
    );
    
    if (!approval) {
      approval = drugData.submissions?.find(s => 
        s.submission_status === 'AP' || s.submission_status === 'Approved'
      ) || {};
    }
    
    let approvalDate = approval.submission_status_date;
    if (!approvalDate || approvalDate === 'Unknown') {
      approvalDate = await scrapeApprovalDate(appNumber) || 'Unknown';
    }
    
    const year = formatYear(approvalDate);
    const basePath = appNumber.startsWith('ANDA') ? 'anda' : 'nda';
    const cleanAppNumber = appNumber.replace(/[^0-9A-Za-z-]/g, '');

    // Fixed PDF links
    const pdfLinks = {
      approvalLetter: year && approvalDate !== 'Unknown' ? 
        `${DRUGS_FDA_DOCS_BASE}/${basePath}/${cleanAppNumber.substring(0,6)}/${year}/${cleanAppNumber}_Approv.pdf` : null,
      label: year && approvalDate !== 'Unknown' ? 
        `${DRUGS_FDA_DOCS_BASE}/${basePath}/${cleanAppNumber.substring(0,6)}/${year}/${cleanAppNumber}_lbl.pdf` : null,
      review: year && approvalDate !== 'Unknown' ? 
        `${DRUGS_FDA_DOCS_BASE}/${basePath}/${cleanAppNumber.substring(0,6)}/${year}/${cleanAppNumber}_Medr.pdf` : null,
    };

    const result = {
      drugData: drugData,
      applicationNumber: drugData.application_number,
      company: drugData.sponsor_name,
      products: drugData.products?.map(p => ({
        drugName: p.brand_name,
        activeIngredients: p.active_ingredients?.map(ai => `${ai.name} ${ai.strength}`).join('; ') || 'N/A',
        strength: p.active_ingredients?.map(ai => `${ai.name} ${ai.strength}`).join(', ') || 'Unknown',
        dosageFormRoute: `${p.dosage_form || 'Unknown'};${p.route || 'Unknown'}`,
        marketingStatus: p.marketing_status,
        teCode: p.te_code || 'N/A'
      })) || [],
      approvalHistory: {
        originalApproval: {
          actionDate: approvalDate,
          submission: approval.submission_number || 'ORIG-1',
          actionType: approval.submission_status || 'Approval',
          classification: approval.submission_type || 'N/A',
          letters: pdfLinks.approvalLetter,
          labels: pdfLinks.label,
          review: pdfLinks.review
        },
        supplements: drugData.submissions
          ?.filter(s => s.submission_status !== 'Approved' || s.submission_number !== approval.submission_number)
          .map(s => {
            const suppYear = formatYear(s.submission_status_date);
            return {
              actionDate: s.submission_status_date || 'Unknown',
              submission: s.submission_number,
              supplementCategories: s.submission_type || 'N/A',
              letters: suppYear ? `${DRUGS_FDA_DOCS_BASE}/${basePath}/${cleanAppNumber.substring(0,6)}/${suppYear}/${cleanAppNumber}_Approv.pdf` : null,
              labels: suppYear ? `${DRUGS_FDA_DOCS_BASE}/${basePath}/${cleanAppNumber.substring(0,6)}/${suppYear}/${cleanAppNumber}_lbl.pdf` : null,
              review: suppYear ? `${DRUGS_FDA_DOCS_BASE}/${basePath}/${cleanAppNumber.substring(0,6)}/${suppYear}/${cleanAppNumber}_Medr.pdf` : null
            };
          }) || []
      },
      // Add empty therapeutic equivalents section to prevent errors
      therapeuticEquivalents: []
    };

    res.json(result);
  } catch (error) {
    handleApiError(error, res, 'Error fetching application data');
  }
});
/**
 * Search for TRD (Treatment-Resistant Depression) drugs
 * GET /api/trd-depression
 */
// Update the DailyMed endpoint to fetch specific drug data based on application number or drug name
app.get('/api/dailymed/drug/:identifier', async (req, res) => {
  const { identifier } = req.params;
  let searchTerm = '';
  
  try {
    // Check if we're dealing with an application number or drug name
    if (identifier.startsWith('NDA') || identifier.startsWith('ANDA')) {
      // If application number, first try to get drug name from FDA API
      const response = await axios.get(`${FDA_DRUGSFDA_URL}?search=application_number:"${identifier}"&limit=1`);
      const drugData = response.data.results?.[0];
      
      if (drugData) {
        // Use brand name, generic name, or just search by application number
        searchTerm = drugData.openfda?.brand_name?.[0] || 
                     drugData.openfda?.generic_name?.[0] || 
                     drugData.products?.[0]?.brand_name || 
                     identifier;
      } else {
        searchTerm = identifier;
      }
    } else {
      // If not an application number, use the identifier directly
      searchTerm = identifier;
    }
    
    // Clean up the search term for better results
    searchTerm = searchTerm
      .replace(/\s*\(.*?\)\s*/g, '') // Remove parentheses and their content
      .replace(/\d+\s*mg|\d+\s*mcg|\d+\s*mL/gi, '') // Remove dosages
      .trim();
    
    // For drug names, we'll search in DailyMed using multiple approaches
    const dmResponse = await axios.get(`${DAILYMED_API_URL}/spls.json?drug_name=${encodeURIComponent(searchTerm)}&limit=10`, {
      headers: { 'Accept': 'application/json' }
    });
    
    let labelData = dmResponse.data.data || [];
    
    // If no results by drug name, try searching by ingredient
    if (labelData.length === 0) {
      const ingredientResponse = await axios.get(`${DAILYMED_API_URL}/spls.json?ingredient=${encodeURIComponent(searchTerm)}&limit=10`, {
        headers: { 'Accept': 'application/json' }
      });
      labelData = ingredientResponse.data.data || [];
    }
    
    // If still no results, try with partial matching
    if (labelData.length === 0) {
      // Split search term into words and try with the first substantive word
      const words = searchTerm.split(/\s+/);
      if (words.length > 1) {
        const mainWord = words[0].length < 3 ? words[1] : words[0]; // Skip short articles
        const partialResponse = await axios.get(`${DAILYMED_API_URL}/spls.json?drug_name=${encodeURIComponent(mainWord)}&limit=10`, {
          headers: { 'Accept': 'application/json' }
        });
        labelData = partialResponse.data.data || [];
      }
    }
    
    if (!labelData || labelData.length === 0) {
      return res.json({ error: 'No DailyMed data found for this drug' });
    }
    
    // Get detailed information for each label (limited to first 5 for performance)
    const labelInfo = await Promise.all(
      labelData.slice(0, 5).map(async (label) => {
        try {
          const detailsResponse = await axios.get(`${DAILYMED_API_URL}/spls/${label.setid}.json`, {
            headers: { 
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            }
          });
          const details = detailsResponse.data;
          
          // Format the published date properly
          let formattedDate = label.published;
          try {
            if (label.published) {
              const pubDate = new Date(label.published);
              if (!isNaN(pubDate.getTime())) {
                formattedDate = pubDate.toISOString().split('T')[0];
              }
            }
          } catch (e) {
            console.error("Error formatting DailyMed date:", e);
          }
          
          return {
            setId: label.setid,
            title: details.title || label.title,
            published: formattedDate,
            labelUrl: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${label.setid}`,
            packageUrl: details.packaging_uris?.[0] 
              ? `https://dailymed.nlm.nih.gov/dailymed/image.cfm?setid=${label.setid}&type=img`
              : null,
            activeIngredients: details.active_ingredients || [],
            ndc: details.package_ndc?.join(', ') || 'N/A',
            rxcui: details.rxcui || 'N/A',
            manufacturer: details.labeler || details.labeler_name || 'N/A',
            dosageForm: details.dosage_forms_and_strengths || 'N/A',
            indications: details.indications_and_usage || 'N/A'
          };
        } catch (error) {
          console.error(`Error fetching details for label ${label.setid}:`, error.message);
          
          // Format the published date even when detail fetch fails
          let formattedDate = label.published;
          try {
            if (label.published) {
              const pubDate = new Date(label.published);
              if (!isNaN(pubDate.getTime())) {
                formattedDate = pubDate.toISOString().split('T')[0];
              }
            }
          } catch (e) {
            console.error("Error formatting DailyMed date:", e);
          }
          
          // Return basic info when detailed fetch fails
          return {
            setId: label.setid,
            title: label.title,
            published: formattedDate,
            labelUrl: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${label.setid}`
          };
        }
      })
    );
    
    res.json({ label_info: labelInfo });
  } catch (error) {
    handleApiError(error, res, 'Error fetching DailyMed data');
  }
});

// Updated function to correctly format FDA document links
function getFdaDocLinks(appNumber, approvalDate) {
  // Format the approval date for use in URLs
  let year = 'unknown';
  if (approvalDate && approvalDate !== 'Unknown') {
    // Handle YYYYMMDD format
    if (/^\d{8}$/.test(approvalDate)) {
      year = approvalDate.substring(0, 4);
    } 
    // Handle YYYY-MM-DD format
    else if (/^\d{4}-\d{2}-\d{2}$/.test(approvalDate)) {
      year = approvalDate.substring(0, 4);
    }
    // Handle other date formats
    else {
      try {
        const date = new Date(approvalDate);
        if (!isNaN(date.getTime())) {
          year = date.getFullYear().toString();
        }
      } catch (e) {
        console.error("Error parsing approval date:", e);
      }
    }
  }
  
  // Determine application type and format number
  const isAnda = appNumber.startsWith('ANDA');
  const isNda = appNumber.startsWith('NDA');
  const appType = isAnda ? 'anda' : isNda ? 'nda' : 'unknown';
  
  // Clean the application number
  const cleanAppNumber = appNumber.replace(/[^0-9]/g, '');
  
  // Different link formats based on approval year
  if (year === 'unknown') {
    return {
      approvalLetter: null,
      label: null,
      review: null
    };
  }
  
  // Modern format (post-2010)
  if (parseInt(year) >= 2010) {
    return {
      approvalLetter: `https://www.accessdata.fda.gov/drugsatfda_docs/${appType}/${year}/${appNumber}_Approv.pdf`,
      label: `https://www.accessdata.fda.gov/drugsatfda_docs/${appType}/${year}/${appNumber}_Lbl.pdf`,
      review: `https://www.accessdata.fda.gov/drugsatfda_docs/${appType}/${year}/${appNumber}TOC.cfm`
    };
  }
  
  // Older format (pre-2010)
  return {
    approvalLetter: `https://www.accessdata.fda.gov/drugsatfda_docs/${appType}/${year}/${cleanAppNumber}_Approv.pdf`,
    label: `https://www.accessdata.fda.gov/drugsatfda_docs/${appType}/${year}/${cleanAppNumber}_lbl.pdf`,
    review: `https://www.accessdata.fda.gov/drugsatfda_docs/${appType}/${year}/${cleanAppNumber}TOC.cfm`
  };
}

// Update TRD Depression API to handle grouping better
app.get('/api/trd-depression', async (req, res) => {
  try {
    const searchTerms = [
      'esketamine', 'spravato', 'ketamine', 'brexanolone', 'zulresso', 
      'fluoxetine', 'prozac', 'olanzapine', 'symbyax'
    ];
    
    const searchQuery = searchTerms.map(term => `(openfda.brand_name:"${term}" OR openfda.generic_name:"${term}")`).join(' OR ');
    
    const response = await axios.get(`${FDA_DRUGSFDA_URL}?search=(${searchQuery}) AND _exists_:submissions.submission_status_date&limit=100`);
    const results = response.data.results || [];
    
    if (!results.length) {
      return res.json({ error: 'No TRD depression drugs found' });
    }
    
    const categorizedDrugs = {
      'Primary TRD Treatments': [],
      'Adjunctive Therapies': [],
      'Other Antidepressants': []
    };
    
    results.forEach(drug => {
      const products = drug.products || [];
      const submissions = drug.submissions || [];
      
      // Improved approval date extraction
      let approvalDate = 'Unknown';
      
      // Find original approval first
      const originalApproval = submissions.find(s => 
        (s.submission_number === '1' || s.submission_number === 'ORIG-1') && 
        (s.submission_status === 'AP' || s.submission_status === 'Approved')
      );
      
      // If not found, look for any approval
      if (originalApproval) {
        approvalDate = originalApproval.submission_status_date;
      } else {
        const anyApproval = submissions.find(s => 
          s.submission_status === 'AP' || s.submission_status === 'Approved'
        );
        if (anyApproval) {
          approvalDate = anyApproval.submission_status_date;
        }
      }
      
      // Format the date properly
      let formattedDate = 'Unknown';
      if (approvalDate !== 'Unknown') {
        // Check for YYYYMMDD format
        if (/^\d{8}$/.test(approvalDate)) {
          formattedDate = `${approvalDate.substring(0, 4)}-${approvalDate.substring(4, 6)}-${approvalDate.substring(6, 8)}`;
        } else {
          formattedDate = approvalDate;
        }
      }
      
      products.forEach(product => {
        if (!product.brand_name) return;
        
        const brandName = product.brand_name;
        const genericNames = product.active_ingredients?.map(ing => ing.name).join(', ') || '';
        
        // Get correct document links
        const docLinks = getFdaDocLinks(drug.application_number, approvalDate);
        
        const drugData = {
          brandName,
          genericName: genericNames,
          applicationNumber: drug.application_number,
          approvalDate: formattedDate,
          manufacturer: drug.sponsor_name,
          indication: getIndicationForDrug(brandName, genericNames),
          fdaPage: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${drug.application_number.replace(/[^0-9]/g, '')}`,
          activeIngredients: product.active_ingredients || [],
          // Add FDA document links
          pdfLinks: docLinks
        };
        
        const lowerBrand = brandName.toLowerCase();
        const lowerGeneric = genericNames.toLowerCase();
        
        if (lowerBrand.includes('spravato') || lowerGeneric.includes('esketamine') ||
            lowerBrand.includes('zulresso') || lowerGeneric.includes('brexanolone')) {
          categorizedDrugs['Primary TRD Treatments'].push(drugData);
        } else if (lowerBrand.includes('symbyax') || 
                  (lowerGeneric.includes('fluoxetine') && lowerGeneric.includes('olanzapine'))) {
          categorizedDrugs['Adjunctive Therapies'].push(drugData);
        } else {
          categorizedDrugs['Other Antidepressants'].push(drugData);
        }
      });
    });
    
    // Remove empty categories
    Object.keys(categorizedDrugs).forEach(key => {
      if (categorizedDrugs[key].length === 0) delete categorizedDrugs[key];
    });
    
    res.json(categorizedDrugs);
  } catch (error) {
    handleApiError(error, res, 'Error fetching TRD depression data');
  }
});
// app.get('/api/trd-depression', async (req, res) => {
//   try {
//     const searchTerms = [
//       'esketamine', 'spravato', 'ketamine', 'brexanolone', 'zulresso', 
//       'fluoxetine', 'prozac', 'olanzapine', 'symbyax'
//     ];
    
//     const searchQuery = searchTerms.map(term => `(openfda.brand_name:"${term}" OR openfda.generic_name:"${term}")`).join(' OR ');
    
//     const response = await axios.get(`${FDA_DRUGSFDA_URL}?search=(${searchQuery}) AND _exists_:submissions.submission_status_date&limit=100`);
//     const results = response.data.results || [];
    
//     if (!results.length) {
//       return res.json({ error: 'No TRD depression drugs found' });
//     }
    
//     const categorizedDrugs = {
//       'Primary TRD Treatments': [],
//       'Adjunctive Therapies': [],
//       'Other Antidepressants': []
//     };
    
//     results.forEach(drug => {
//       const products = drug.products || [];
//       const submissions = drug.submissions || [];
//       const approval = submissions.find(s => s.submission_status === 'Approved');
//       const approvalDate = approval?.submission_status_date || 'Unknown';
      
//       products.forEach(product => {
//         if (!product.brand_name) return;
        
//         const brandName = product.brand_name;
//         const genericNames = product.active_ingredients?.map(ing => ing.name).join(', ') || '';
        
//         const drugData = {
//           brandName,
//           genericName: genericNames,
//           applicationNumber: drug.application_number,
//           approvalDate,
//           manufacturer: drug.sponsor_name,
//           indication: getIndicationForDrug(brandName, genericNames),
//           fdaPage: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${drug.application_number.replace(/[^0-9]/g, '')}`,
//           activeIngredients: product.active_ingredients || []
//         };
        
//         if (brandName.toLowerCase().includes('spravato') || genericNames.toLowerCase().includes('esketamine') ||
//             brandName.toLowerCase().includes('zulresso') || genericNames.toLowerCase().includes('brexanolone')) {
//           categorizedDrugs['Primary TRD Treatments'].push(drugData);
//         } else if (brandName.toLowerCase().includes('symbyax') || 
//                   (genericNames.toLowerCase().includes('fluoxetine') && genericNames.toLowerCase().includes('olanzapine'))) {
//           categorizedDrugs['Adjunctive Therapies'].push(drugData);
//         } else {
//           categorizedDrugs['Other Antidepressants'].push(drugData);
//         }
//       });
//     });
    
//     Object.keys(categorizedDrugs).forEach(key => {
//       if (categorizedDrugs[key].length === 0) delete categorizedDrugs[key];
//     });
    
//     res.json(categorizedDrugs);
//   } catch (error) {
//     handleApiError(error, res, 'Error fetching TRD depression data');
//   }
// });

/**
 * Helper function to get indication for specific drugs
 */
function getIndicationForDrug(brandName, genericName) {
  const lowerBrand = brandName.toLowerCase();
  const lowerGeneric = genericName.toLowerCase();
  
  if (lowerBrand.includes('spravato') || lowerGeneric.includes('esketamine')) {
    return 'Treatment-resistant depression in adults';
  } else if (lowerBrand.includes('zulresso') || lowerGeneric.includes('brexanolone')) {
    return 'Treatment of postpartum depression in adults';
  } else if (lowerBrand.includes('symbyax') || 
            (lowerGeneric.includes('fluoxetine') && lowerGeneric.includes('olanzapine'))) {
    return 'Treatment-resistant depression, depressive episodes associated with Bipolar I Disorder';
  } else if (lowerGeneric.includes('fluoxetine')) {
    return 'Major depressive disorder, obsessive-compulsive disorder, panic disorder, bulimia nervosa';
  } else {
    return 'Depression and related disorders';
  }
}



// In-memory data store
let warningLetters = [];

// Middleware
app.use(cors({
  origin: '*', // Allow all origins for development
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Load data from JSON file
function loadData() {
  try {
    const dataPath = path.join(__dirname, 'warning_letters.json');
    
    if (fs.existsSync(dataPath)) {
      const jsonData = fs.readFileSync(dataPath, 'utf8');
      warningLetters = JSON.parse(jsonData);
      console.log(`Loaded ${warningLetters.length} warning letters from JSON file`);
    } else {
      console.log('Warning: warning_letters.json not found. Starting with empty dataset.');
      warningLetters = [];
    }
  } catch (error) {
    console.error('Error loading data:', error);
    warningLetters = [];
  }
}

// Format date consistently
function formatDate(dateString) {
  if (!dateString) return null;
  
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date.toISOString().split('T')[0]; // YYYY-MM-DD
  } catch (error) {
    return dateString;
  }
}

// Routes

// GET /all - Returns all warning letters
app.get('/all', (req, res) => {
  // Default sort by postedDate descending
  const sorted = [...warningLetters].sort((a, b) => {
    const dateA = a.postedDate ? new Date(a.postedDate).getTime() : 0;
    const dateB = b.postedDate ? new Date(b.postedDate).getTime() : 0;
    return dateB - dateA;
  });
  
  res.json(sorted);
});

// GET /search - Search and filter warning letters
app.get('/search', (req, res) => {
  try {
    const { query, days, dateFrom, dateTo, office, subject, hasResponse, hasCloseout, sort, direction } = req.query;
    
    let results = [...warningLetters];
    
    // Text search across multiple columns
    if (query) {
      const searchTerm = query.toLowerCase();
      results = results.filter(letter => {
        return (letter.companyName && letter.companyName.toLowerCase().includes(searchTerm)) ||
               (letter.subject && letter.subject.toLowerCase().includes(searchTerm)) ||
               (letter.issuingOffice && letter.issuingOffice.toLowerCase().includes(searchTerm));
      });
    }
    
    // Date filter - days
    if (days) {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(days));
      const daysAgoStr = daysAgo.toISOString().split('T')[0];
      
      results = results.filter(letter => {
        if (!letter.postedDate) return false;
        // Handle different date formats
        const letterDate = formatDate(letter.postedDate);
        return letterDate && letterDate >= daysAgoStr;
      });
    }
    
    // Date filter - custom range
    if (dateFrom) {
      results = results.filter(letter => {
        if (!letter.postedDate) return false;
        const letterDate = formatDate(letter.postedDate);
        return letterDate && letterDate >= dateFrom;
      });
    }
    
    if (dateTo) {
      results = results.filter(letter => {
        if (!letter.postedDate) return false;
        const letterDate = formatDate(letter.postedDate);
        return letterDate && letterDate <= dateTo;
      });
    }
    
    // Office filter
    if (office) {
      results = results.filter(letter => {
        return letter.issuingOffice && letter.issuingOffice.toLowerCase().includes(office.toLowerCase());
      });
    }
    
    // Subject filter
    if (subject) {
      results = results.filter(letter => {
        return letter.subject && letter.subject.toLowerCase().includes(subject.toLowerCase());
      });
    }
    
    // Response/closeout filters
    if (hasResponse === 'true') {
      results = results.filter(letter => {
        return letter.responseLetter && letter.responseLetter.trim() !== '';
      });
    }
    
    if (hasCloseout === 'true') {
      results = results.filter(letter => {
        return letter.closeoutLetter && letter.closeoutLetter.trim() !== '';
      });
    }
    
    // Sorting
    if (sort) {
      const sortDir = direction === 'asc' ? 1 : -1;
      
      results.sort((a, b) => {
        const valA = a[sort] || '';
        const valB = b[sort] || '';
        
        // Special handling for dates
        if (sort === 'postedDate' || sort === 'letterIssueDate') {
          const dateA = valA ? new Date(valA).getTime() : 0;
          const dateB = valB ? new Date(valB).getTime() : 0;
          return sortDir * (dateA - dateB);
        }
        
        // Default string comparison
        return sortDir * valA.toString().localeCompare(valB.toString());
      });
    } else {
      // Default sort by postedDate descending
      results.sort((a, b) => {
        const dateA = a.postedDate ? new Date(a.postedDate).getTime() : 0;
        const dateB = b.postedDate ? new Date(b.postedDate).getTime() : 0;
        return dateB - dateA;
      });
    }
    
    res.json(results);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search error', details: err.message });
  }
});

// GET /search-terms - Get unique terms for autocomplete
app.get('/search-terms', (req, res) => {
  try {
    const terms = new Set();
    
    // Get company names
    warningLetters.forEach(letter => {
      if (letter.companyName && letter.companyName.trim() !== '') {
        terms.add(letter.companyName);
      }
    });
    
    // Get issuing offices
    warningLetters.forEach(letter => {
      if (letter.issuingOffice && letter.issuingOffice.trim() !== '') {
        terms.add(letter.issuingOffice);
      }
    });
    
    // Extract common words from subjects
    const subjectTexts = warningLetters
      .map(letter => letter.subject)
      .filter(subject => subject && subject.trim() !== '');
    
    const commonTerms = extractCommonTerms(subjectTexts);
    commonTerms.forEach(term => terms.add(term));
    
    res.json(Array.from(terms));
  } catch (err) {
    console.error('Error getting search terms:', err);
    res.status(500).json({ error: 'Error getting search terms', details: err.message });
  }
});

// Helper function to extract common terms from text
function extractCommonTerms(texts) {
  const termCounts = {};
  const stopWords = new Set(['and', 'or', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'of']);
  
  texts.forEach(text => {
    if (!text) return;
    
    // Split by common separators and filter out short or common words
    const words = text.split(/[\s,\/\(\)]+/)
      .map(word => word.toLowerCase().trim())
      .filter(word => word.length > 3 && !stopWords.has(word));
    
    // Count occurrences
    words.forEach(word => {
      termCounts[word] = (termCounts[word] || 0) + 1;
    });
  });
  
  // Return terms that appear multiple times
  return Object.entries(termCounts)
    .filter(([_, count]) => count > 2)
    .map(([term, _]) => term);
}

// GET /stats - Get statistics about the warning letters
app.get('/stats', (req, res) => {
  try {
    const stats = {};
    
    // Total count
    stats.totalLetters = warningLetters.length;
    
    // Count by year
    const yearCounts = {};
    warningLetters.forEach(letter => {
      if (letter.postedDate) {
        // Handle different date formats
        const dateStr = formatDate(letter.postedDate);
        if (dateStr) {
          const year = dateStr.substring(0, 4);
          yearCounts[year] = (yearCounts[year] || 0) + 1;
        }
      }
    });
    
    stats.lettersByYear = Object.entries(yearCounts)
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => b.year - a.year);
    
    // Count by issuing office
    const officeCounts = {};
    warningLetters.forEach(letter => {
      if (letter.issuingOffice) {
        officeCounts[letter.issuingOffice] = (officeCounts[letter.issuingOffice] || 0) + 1;
      }
    });
    
    stats.lettersByOffice = Object.entries(officeCounts)
      .map(([issuingOffice, count]) => ({ issuingOffice, count }))
      .sort((a, b) => b.count - a.count);
    
    // Count letters with response or closeout
    stats.lettersWithResponse = warningLetters.filter(letter => 
      letter.responseLetter && letter.responseLetter.trim() !== ''
    ).length;
    
    stats.lettersWithCloseout = warningLetters.filter(letter => 
      letter.closeoutLetter && letter.closeoutLetter.trim() !== ''
    ).length;
    
    res.json(stats);
  } catch (err) {
    console.error('Error getting statistics:', err);
    res.status(500).json({ error: 'Error getting statistics', details: err.message });
  }
});

// GET /letter/:id - Get a specific letter by ID
app.get('/letter/:id', (req, res) => {
  try {
    const { id } = req.params;
    const letter = warningLetters.find(l => l.id === parseInt(id));
    
    if (!letter) {
      return res.status(404).json({ error: 'Letter not found' });
    }
    
    res.json(letter);
  } catch (err) {
    console.error('Error getting letter:', err);
    res.status(500).json({ error: 'Error getting letter', details: err.message });
  }
});

// Serve static files from the 'public' directory for the frontend
app.use(express.static('public'));

// Serve the frontend for any other route (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
function startServer() {
  try {
    // Load data from JSON file
    loadOrangeBookData();
    loadData();
    
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
  }
}
const PORT = process.env.PORT || 3000;
startServer();

// let db;

// async function initDatabase() {
//     try {
//       // Open the database
//       db = await open({
//         filename: path.join(__dirname, 'warning_letters.db'),
//         driver: sqlite3.Database
//       });
//       console.log('Connected to the SQLite database.');
//     } catch (error) {
//       console.error('Database connection error:', error);
//       process.exit(1); // Exit if we can't connect to the database
//     }
//   }

// // Helper function to format dates consistently
// function formatDate(dateString) {
//   if (!dateString) return null;
  
//   try {
//     const date = new Date(dateString);
//     if (isNaN(date.getTime())) return dateString; // If not a valid date, return as is
    
//     return date.toISOString().split('T')[0]; // Format as YYYY-MM-DD
//   } catch (error) {
//     return dateString;
//   }
// }

// // Helper function to extract common terms from text
// function extractCommonTerms(texts) {
//   const termCounts = {};
//   const stopWords = new Set(['and', 'or', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'of']);
  
//   texts.forEach(text => {
//     if (!text) return;
    
//     // Split by common separators and filter out short or common words
//     const words = text.split(/[\s,\/\(\)]+/)
//       .map(word => word.toLowerCase().trim())
//       .filter(word => word.length > 3 && !stopWords.has(word));
    
//     // Count occurrences
//     words.forEach(word => {
//       termCounts[word] = (termCounts[word] || 0) + 1;
//     });
//   });
  
//   // Return terms that appear multiple times
//   return Object.entries(termCounts)
//     .filter(([_, count]) => count > 2)
//     .map(([term, _]) => term);
// }

// // Routes

// // GET /all - Returns all warning letters
// app.get('/all', async (req, res) => {
//   try {
//     const rows = await db.all('SELECT * FROM warning_letters ORDER BY postedDate DESC');
//     res.json(rows);
//   } catch (err) {
//     console.error('Database error:', err);
//     res.status(500).json({ error: 'Database error', details: err.message });
//   }
// });

// // GET /search - Search and filter warning letters
// app.get('/search', async (req, res) => {
//   try {
//     const { query, days, dateFrom, dateTo, office, subject, hasResponse, hasCloseout } = req.query;
    
//     let sql = 'SELECT * FROM warning_letters WHERE 1=1';
//     const params = [];
    
//     // Text search across multiple columns
//     if (query) {
//       sql += ' AND (companyName LIKE ? OR subject LIKE ? OR issuingOffice LIKE ?)';
//       const searchTerm = `%${query}%`;
//       params.push(searchTerm, searchTerm, searchTerm);
//     }
    
//     // Date filter - days
//     if (days) {
//       const daysAgo = new Date();
//       daysAgo.setDate(daysAgo.getDate() - parseInt(days));
//       sql += ' AND date(postedDate) >= date(?)';
//       params.push(daysAgo.toISOString().split('T')[0]);
//     }
    
//     // Date filter - custom range
//     if (dateFrom) {
//       sql += ' AND date(postedDate) >= date(?)';
//       params.push(dateFrom);
//     }
    
//     if (dateTo) {
//       sql += ' AND date(postedDate) <= date(?)';
//       params.push(dateTo);
//     }
    
//     // Office filter
//     if (office) {
//       sql += ' AND issuingOffice LIKE ?';
//       params.push(`%${office}%`);
//     }
    
//     // Subject filter
//     if (subject) {
//       sql += ' AND subject LIKE ?';
//       params.push(`%${subject}%`);
//     }
    
//     // Response/closeout filters
//     if (hasResponse === 'true') {
//       sql += " AND responseLetter IS NOT NULL AND responseLetter != ''";
//     }
    
//     if (hasCloseout === 'true') {
//       sql += " AND closeoutLetter IS NOT NULL AND closeoutLetter != ''";
//     }
    
//     sql += ' ORDER BY postedDate DESC';
    
//     const rows = await db.all(sql, params);
//     res.json(rows);
//   } catch (err) {
//     console.error('Search error:', err);
//     res.status(500).json({ error: 'Search error', details: err.message });
//   }
// });

// // GET /search-terms - Get unique terms for autocomplete
// app.get('/search-terms', async (req, res) => {
//   try {
//     const terms = new Set();
    
//     // Get company names
//     const companyRows = await db.all(
//       "SELECT DISTINCT companyName FROM warning_letters WHERE companyName IS NOT NULL AND companyName != ''"
//     );
//     companyRows.forEach(row => terms.add(row.companyName));
    
//     // Get issuing offices
//     const officeRows = await db.all(
//       "SELECT DISTINCT issuingOffice FROM warning_letters WHERE issuingOffice IS NOT NULL AND issuingOffice != ''"
//     );
//     officeRows.forEach(row => terms.add(row.issuingOffice));
    
//     // Get common words from subjects
//     const subjectRows = await db.all(
//       "SELECT subject FROM warning_letters WHERE subject IS NOT NULL AND subject != ''"
//     );
    
//     // Extract common terms from subjects
//     const commonTerms = extractCommonTerms(subjectRows.map(row => row.subject));
//     commonTerms.forEach(term => terms.add(term));
    
//     res.json(Array.from(terms));
//   } catch (err) {
//     console.error('Error getting search terms:', err);
//     res.status(500).json({ error: 'Error getting search terms', details: err.message });
//   }
// });

// // GET /stats - Get statistics about the warning letters
// app.get('/stats', async (req, res) => {
//   try {
//     const stats = {};
    
//     // Total count
//     const countResult = await db.get('SELECT COUNT(*) as total FROM warning_letters');
//     stats.totalLetters = countResult.total;
    
//     // Count by year
//     const yearCounts = await db.all(`
//       SELECT 
//         strftime('%Y', postedDate) as year, 
//         COUNT(*) as count 
//       FROM warning_letters 
//       WHERE postedDate IS NOT NULL 
//       GROUP BY year 
//       ORDER BY year DESC
//     `);
//     stats.lettersByYear = yearCounts;
    
//     // Count by issuing office
//     const officeCounts = await db.all(`
//       SELECT 
//         issuingOffice, 
//         COUNT(*) as count 
//       FROM warning_letters 
//       WHERE issuingOffice IS NOT NULL 
//       GROUP BY issuingOffice 
//       ORDER BY count DESC
//     `);
//     stats.lettersByOffice = officeCounts;
    
//     // Count letters with response or closeout
//     const responseResult = await db.get(
//       "SELECT COUNT(*) as count FROM warning_letters WHERE responseLetter IS NOT NULL AND responseLetter != ''"
//     );
//     stats.lettersWithResponse = responseResult.count;
    
//     const closeoutResult = await db.get(
//       "SELECT COUNT(*) as count FROM warning_letters WHERE closeoutLetter IS NOT NULL AND closeoutLetter != ''"
//     );
//     stats.lettersWithCloseout = closeoutResult.count;
    
//     res.json(stats);
//   } catch (err) {
//     console.error('Error getting statistics:', err);
//     res.status(500).json({ error: 'Error getting statistics', details: err.message });
//   }
// });

// // GET /letter/:id - Get a specific letter by ID
// app.get('/letter/:id', async (req, res) => {
//   try {
//     const { id } = req.params;
//     const letter = await db.get('SELECT * FROM warning_letters WHERE id = ?', [id]);
    
//     if (!letter) {
//       return res.status(404).json({ error: 'Letter not found' });
//     }
    
//     res.json(letter);
//   } catch (err) {
//     console.error('Error getting letter:', err);
//     res.status(500).json({ error: 'Error getting letter', details: err.message });
//   }
// });

// // Start the server
// async function startServer() {
//   try {
//     await initDatabase();
    
//     app.listen(PORT, () => {
//       console.log(`Server running on http://localhost:${PORT}`);
//     });
//   } catch (err) {
//     console.error('Failed to start server:', err);
//   }
// }


// startServer();
// 
// app.listen(PORT, () => {
//   startServer();
//   console.log(`Backend running on http://localhost:${PORT}`);
// });