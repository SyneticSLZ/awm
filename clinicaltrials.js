// server.js - Updated for ClinicalTrials.gov API v2
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Papa = require('papaparse');
const { DOMParser } = require('xmldom');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const DataIntegration = require('./data-integration');
const emaRoutes = require('./ema-routes');
const cheerio = require('cheerio');
const https = require('https');
const fsextra = require('fs-extra');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const sharp = require('sharp');
const { fromPath } = require('pdf2pic');
const csv = require('csv-parser');
const { handlePubMedSearch } = require('./pubmed.js');
const nodemailer = require('nodemailer');
// const { handleDailyMedRequest } = require('./dailymed.js'); // Path to where you saved the code

const { OpenAI } = require('openai');
const rateLimit = require('express-rate-limit');

const { 
  DrugClassification, 
  FDAGuidance, 
  FDAApproval, 
  DailyMed, 
  OrangeBook,
  WarningLetters, 
  PubMed, 
  TreatmentEffectCalculator 
} = DataIntegration;


const FDA_DRUGSFDA_URL = 'https://api.fda.gov/drug/drugsfda.json';
const FDA_LABEL_URL = 'https://api.fda.gov/drug/label.json';
const FDA_ENFORCEMENT_URL = 'https://api.fda.gov/drug/enforcement.json';
const DRUGS_FDA_DOCS_BASE = 'https://www.accessdata.fda.gov/drugsatfda_docs';
const DAILYMED_API_URL = 'https://dailymed.nlm.nih.gov/dailymed/services/v2';
const ORANGE_BOOK_API_URL = 'https://api.fda.gov/drug/orangebook.json'; // Live FDA Orange Book API
const GUIDANCE_API_URL = 'https://api.fda.gov/guidance/guidances.json'; // Live FDA Guidance API




// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '10mb' }));
// Custom delay function (returns a promise that resolves after a specified time)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Rate limiter configuration (tracks requests without rejecting)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 , // 15 minutes
  max: 1000, // Max 100 requests per IP in the window
  standardHeaders: true, // Include RateLimit-* headers
  legacyHeaders: false, // Disable older X-RateLimit headers
  skipFailedRequests: true, // Don't count failed requests
  handler: async (req, res, next, options) => {
    // Instead of rejecting, delay the request
    const retryAfterMs = req.rateLimit.resetTime - Date.now(); // Time until window resets
    console.log(`Rate limit hit for IP ${req.ip}, delaying for ${retryAfterMs}ms`);
    await delay(retryAfterMs + 100); // Wait until the window resets (+ buffer)
    next(); // Process the request after delay
  },
});

// Apply rate limiter to all routes
app.use(apiLimiter);

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

app.get('/config', (req, res) => {
  res.json({
    apiUrl: process.env.PUBLIC_API_URL || 'http://localhost:3000/api', // Fallback for local testing
  });
});

// // Load and parse the EMA medicine data CSV file
// let emaMedicines = [];
// try {
//   const csvFilePath = path.join(__dirname, 'medicines.csv');
//   // Use utf8 encoding instead of cp1252 since Node.js doesn't directly support cp1252
//   const csvData = fs.readFileSync(csvFilePath, { encoding: 'utf8' });
//   const parsedData = Papa.parse(csvData, {
//     header: true,
//     skipEmptyLines: true,
//     // Tell Papa Parse to be more flexible with parsing
//     delimiter: ',', // Explicitly set delimiter
//     dynamicTyping: false, // Keep everything as strings
//     encoding: 'utf8'
//   });
//   emaMedicines = parsedData.data;
//   console.log(`Loaded ${emaMedicines.length} medicines from EMA data`);
// } catch (error) {
//   console.error('Error loading EMA medicine data:', error.message);
//   process.exit(1);
// }

let emaMedicines = [];
try {
  const csvFilePath = path.join(__dirname, 'medicines.csv');
  const fileStream = fs.createReadStream(csvFilePath, { encoding: 'utf8' });

  Papa.parse(fileStream, {
    header: true,
    skipEmptyLines: true,
    delimiter: ',',
    dynamicTyping: false,
    encoding: 'utf8',
    step: (result, parser) => {
      // Process each row incrementally
      emaMedicines.push(result.data);
      // Optional: Pause parsing if memory is a concern
      if (emaMedicines.length % 1000 === 0) {
        parser.pause();
        setTimeout(() => parser.resume(), 100); // Brief pause to allow GC
      }
    },
    complete: () => {
      console.log(`Loaded ${emaMedicines.length} medicines from EMA data`);
    },
    error: (error) => {
      console.error('Error parsing EMA medicine data:', error.message);
      process.exit(1);
    },
  });
} catch (error) {
  console.error('Error loading EMA medicine data:', error.message);
  process.exit(1);
}


let warningLetters = [];
try {
  const wdata = fs.readFileSync(path.join(__dirname, 'output/wl.json'), 'utf8');
  warningLetters = JSON.parse(wdata);
  console.log(`Loaded ${warningLetters.length} warning letters from file.`);
} catch (error) {
  console.error('Error loading warning letters data:', error);
  process.exit(1);
}

// Set up logging
const logDirectory = path.join(__dirname, 'logs');
if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory);
}

// Create a write stream for logging
const accessLogStream = fs.createWriteStream(
  path.join(logDirectory, 'access.log'),
  { flags: 'a' }
);

// Setup request logging
app.use(morgan('combined', { stream: accessLogStream }));
app.use(morgan('dev')); // Also log to console

// Detailed request logger middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  const originalSend = res.send;
  
  // Log request details
  const requestLog = {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl,
    query: req.query,
    body: req.body,
    headers: req.headers,
  };
  
  // console.log('📥 REQUEST:', JSON.stringify(requestLog, null, 2));
  
  // Capture the response
  res.send = function(body) {
    const responseTime = Date.now() - startTime;
    
    // Log response details (but limit large responses)
    const responseBody = typeof body === 'string' ? 
      (body.length > 1000 ? body.substring(0, 1000) + '... (truncated)' : body) : 
      'Non-string response (likely JSON)';
    
    const responseLog = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      responseSize: Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body), 'utf8'),
    };
    
    // console.log('📤 RESPONSE:', JSON.stringify(responseLog, null, 2));
    
    // Also log to file
    fs.appendFileSync(
      path.join(logDirectory, 'detailed.log'),
      JSON.stringify({
        request: requestLog,
        response: responseLog
      }) + '\n'
    );
    
    return originalSend.call(this, body);
  };
  
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Constants
const CLINICAL_TRIALS_API_BASE = 'https://clinicaltrials.gov/api/v2';
const DEFAULT_PAGE_SIZE = 20;
// Local Orange Book Data
let orangeBookData = {
  products: [],
  patents: [],
  exclusivity: []
};

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - The function to retry
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise} - Returns the result of the function
 */
async function retryRequest(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // If this was the last attempt, throw the error
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Calculate delay with exponential backoff
      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`Attempt ${attempt + 1}/${maxRetries + 1} failed. Retrying in ${delay}ms...`);
      
      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // This should never be reached, but just in case
  throw lastError;
}


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

/**
 * Helper function to handle API errors
 */
const handleApiError = (error, res) => {
  console.error('❌ API Error:', error.message);
  
  if (error.response) {
    // The request was made and the server responded with a status code
    // that falls out of the range of 2xx
    console.error('Status:', error.response.status);
    console.error('Headers:', error.response.headers);
    console.error('Data:', error.response.data);
    
    return res.status(error.response.status).json({
      error: true,
      message: 'Error fetching data from Clinical Trials API',
      details: error.response.data,
      status: error.response.status
    });
  } else if (error.request) {
    // The request was made but no response was received
    console.error('Request:', error.request);
    
    return res.status(503).json({
      error: true,
      message: 'No response received from Clinical Trials API',
      details: 'The request was made but no response was received'
    });
  } else {
    // Something happened in setting up the request that triggered an Error
    return res.status(500).json({
      error: true,
      message: 'Error setting up request to Clinical Trials API',
      details: error.message
    });
  }
};

/**
 * Middleware to validate pagination parameters
 */
const validatePagination = (req, res, next) => {
  let { page, pageSize } = req.query;
  
  // Validate and convert to numbers
  page = parseInt(page) || 1;
  pageSize = parseInt(pageSize) || DEFAULT_PAGE_SIZE;
  
  // Ensure values are within reasonable range
  if (page < 1) page = 1;
  if (pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
  if (pageSize > 1000) pageSize = 1000; // API maximum
  
  // Attach to request for later use
  req.pagination = { page, pageSize };
  
  next();
};

//######################################################################################################################################
//#######################################################################################################################################
// Required packages - make sure to install these
// npm install pdf-lib pdf-parse axios multer fs-extra sharp pdf2pic canvas


// Required packages
// const fs = require('fs');
// const path = require('path');
// const axios = require('axios');
// const multer = require('multer');
// const cheerio = require('cheerio');
// const https = require('https');
// const { PDFDocument } = require('pdf-lib');
// const pdfParse = require('pdf-parse');
// const sharp = require('sharp');
// const { fromPath } = require('pdf2pic');

// Create an HTTPS agent with relaxed SSL options


// Configure storage for uploaded PDF files
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'temp-uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
}).single('pdf');

// Grok API configuration - in production use environment variables
// const GROK_API_KEY = 'q2dqVZZgIN7RcBlnGlja2KS52sXSxeEKJxGM7K5Q29s0h3nX5JDXdIjr6rx4PpYshPti6iZAQYxs32J4';
const GROK_API_KEY = 'xai-oeLa2KzHaDJ0iGw06nlBBFemWQJR0PqL4xbgrIujbPvkNW6Zw5ij7o0jxXxQfDN8CIyKkBjolsRyTsKx';
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';











/**
 * Generate FDA summary using OpenAI
 * POST /api/generate-summary
 */
app.post('/api/generate-summary', async (req, res) => {
  try {
    const { prompt, maxTokens, temperature, drugName } = req.body;
    const grokApiKey = GROK_API_KEY;
    const grokApiUrl = GROK_API_URL; // Your Grok chat completions URL
    
    console.log(`Generating Grok summary for ${drugName}`);
    
    // Prepare the request for Grok API - FIXED to include model field
    const response = await axios.post(grokApiUrl, {
      model: "grok-2", // Add the required model field - update to your specific Grok model name if different
      messages: [
        // {
        //   role: "system",
        //   content: "You are a specialized AI assistant focused on FDA regulatory information analysis. Your task is to create detailed, well-structured HTML summaries of FDA data for pharmaceutical drugs. Focus on critical safety information, organized presentation, and actionable insights."
        // },

        { role: "system", 
          content: "You are an advanced AI assistant specializing in FDA regulatory information analysis for pharmaceutical drugs. Your task is to create visually appealing, highly structured, and responsive HTML summaries of FDA data, prioritizing critical safety information, dosing details, and actionable insights. Enhance the user experience with modern UI design, including vibrant colors, smooth animations, and a professional layout using Tailwind CSS and custom styles. Incorporate a dedicated section for research insights, ensuring all information is 100% accurate with verified, working links to credible sources (e.g., FDA.gov, DailyMed, peer-reviewed journals). Ensure the design is fully responsive across devices, with hover effects, clear typography, and intuitive navigation. Verify all data for accuracy as of the current date and include a footer with source attribution and update timestamp." 

        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: maxTokens || 1500,
      temperature: temperature || 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${grokApiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Extract the response content from Grok API
    const summary = response.data.choices[0].message.content.trim();
    
    res.json({ success: true, summary });
  } catch (error) {
    console.error('Grok API error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});


/**
 * Email the FDA summary to the user
 * POST /api/email-summary
 */
app.post('/api/email-summary', async (req, res) => {
  try {
    const { email, name, subject, content, drugName } = req.body;
    
    console.log(`Sending summary email to ${email} for ${drugName}`);
    
    // Create email transporter
    const transporter = nodemailer.createTransport({
      // Your email service configuration
      service: 'gmail',
      auth: {
        user: 'syneticslz@gmail.com',
        pass: 'gble ksdb ntdq hqlx'
      }
    });
    
    // Clean up the HTML content to ensure it's email-friendly
    let cleanContent = content;
    
    // Replace Tailwind classes with inline styles for email compatibility
    cleanContent = cleanContent.replace(/class="[^"]*"/g, (match) => {
      let styles = '';
      
      // Convert common Tailwind classes to inline styles
      if (match.includes('text-xl')) styles += 'font-size: 1.25rem; ';
      if (match.includes('font-semibold')) styles += 'font-weight: 600; ';
      if (match.includes('mb-4')) styles += 'margin-bottom: 1rem; ';
      if (match.includes('text-gray-600')) styles += 'color: #4b5563; ';
      if (match.includes('text-gray-700')) styles += 'color: #374151; ';
      if (match.includes('text-blue-800')) styles += 'color: #1e40af; ';
      if (match.includes('bg-blue-50')) styles += 'background-color: #eff6ff; ';
      if (match.includes('p-4')) styles += 'padding: 1rem; ';
      if (match.includes('rounded-lg')) styles += 'border-radius: 0.5rem; ';
      if (match.includes('border')) styles += 'border: 1px solid #e5e7eb; ';
      if (match.includes('border-blue-200')) styles += 'border-color: #bfdbfe; ';
      if (match.includes('grid')) styles += 'display: block; '; // Grids don't work well in email
      
      return styles ? `style="${styles}"` : '';
    });
    
    // Prepare HTML email
    const htmlEmail = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>FDA Summary for ${drugName}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            border-bottom: 2px solid #3b82f6;
            padding-bottom: 10px;
            margin-bottom: 20px;
          }
          .header h1 {
            color: #1e40af;
            margin-bottom: 5px;
          }
          .header h2 {
            color: #1e3a8a;
            margin-top: 0;
          }
          .content {
            background-color: #f0f9ff;
            border-left: 4px solid #3b82f6;
            padding: 15px;
            margin: 20px 0;
          }
          .footer {
            margin-top: 30px;
            font-size: 12px;
            color: #666;
            border-top: 1px solid #ddd;
            padding-top: 15px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>FDA Regulatory Summary</h1>
          <h2>${drugName}</h2>
        </div>
        
        <p>Hello ${name || 'there'},</p>
        
        <p>Here is the FDA regulatory summary you requested for ${drugName}:</p>
        
        <div class="content">
          ${cleanContent}
        </div>
        
        <div class="footer">
          <p>This summary was generated automatically based on FDA data as of ${new Date().toLocaleDateString()}.</p>
          <p><strong>Disclaimer:</strong> This information is provided for informational purposes only and should not be used for clinical decision making. Always consult official FDA documentation and healthcare professionals.</p>
        </div>
      </body>
      </html>
    `;
    
    // Send email
    await transporter.sendMail({
      from: `"FDA Data Portal" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: subject || `FDA Regulatory Summary for ${drugName}`,
      html: htmlEmail
    });
    
    res.json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    console.error('Email sending error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});




const DB_FILE = 'db.json';

// GET endpoint to read db.json
app.get('/api/db', (req, res) => {
  fs.readFile(DB_FILE, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading db.json:', err);
      // If file doesn't exist, create it with a default database
      if (err.code === 'ENOENT') {
        const defaultDb = { searches: {}, lastUpdated: new Date().toISOString() };
        fs.writeFile(DB_FILE, JSON.stringify(defaultDb, null, 2), (writeErr) => {
          if (writeErr) {
            console.error('Error creating db.json:', writeErr);
            return res.status(500).json({ error: 'Failed to create database' });
          }
          console.log('Created db.json with default database');
          return res.json(defaultDb);
        });
      } else {
        return res.status(500).json({ error: 'Failed to read database' });
      }
    } else {
      try {
        const parsedData = JSON.parse(data);
        res.json(parsedData);
      } catch (parseErr) {
        console.error('Error parsing db.json:', parseErr);
        res.status(500).json({ error: 'Invalid database format' });
      }
    }
  });
});

// POST endpoint to write to db.json
app.post('/api/db', (req, res) => {
  const data = req.body;
  // Validate input
  if (!data || typeof data !== 'object' || !data.searches) {
    return res.status(400).json({ error: 'Invalid database structure' });
  }
  fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), (err) => {
    if (err) {
      console.error('Error writing db.json:', err);
      return res.status(500).json({ error: 'Failed to write database' });
    }
    console.log('Successfully wrote to db.json');
    res.json({ success: true });
  });
});





//////////////////////////////////////// PUB ///////////////////////////////////////////////////////////////////////

// // PubMed E-utilities API constantsconst 
// EUTILS_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
// const RESULTS_PER_PAGE = 10;
// const NCBI_API_KEY = process.env.NCBI_API_KEY || ''; // Optional: Add your API key if you have one

// // Helper function to parse PubMed XML
// const parseXML = require('xml2js').parseString;

// // PubMed search API endpoint
// app.get('/api/pubmed', async (req, res) => {
//   try {
//     const term = req.query.term;
//     const page = parseInt(req.query.page) || 1;
//     const sortBy = req.query.sortBy || 'relevance';
//     const fullTextOnly = req.query.fullTextOnly === 'true';
    
//     if (!term) {
//       return res.status(400).json({ error: 'Search term is required' });
//     }
    
//     // Calculate start index for pagination
//     const start = (page - 1) * RESULTS_PER_PAGE;
    
//     // Build the search query
//     let searchQuery = term;
//     if (fullTextOnly) {
//       searchQuery += ' AND free full text[filter]';
//     }
    
//     // Sort parameter
//     let sortParam = '';
//     if (sortBy === 'date') {
//       sortParam = '&sort=pub+date+desc';
//     } else if (sortBy === 'citationCount') {
//       sortParam = '&sort=relevance';  // PubMed doesn't directly sort by citations, use relevance as fallback
//     }
    
//     // First, search for IDs using esearch
//     const apiKeyParam = NCBI_API_KEY ? `&api_key=${NCBI_API_KEY}` : '';
//     const searchUrl = `${EUTILS_BASE_URL}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(searchQuery)}&retmax=${RESULTS_PER_PAGE}&retstart=${start}${sortParam}&retmode=json${apiKeyParam}`;
    
//     const searchResponse = await axios.get(searchUrl);
//     const searchData = searchResponse.data.esearchresult;
//     const totalResults = parseInt(searchData.count) || 0;
//     const ids = searchData.idlist || [];
    
//     if (ids.length === 0) {
//       return res.json({ articles: [], totalResults: 0 });
//     }
    
//     // Then, fetch details for the IDs using esummary
//     const fetchUrl = `${EUTILS_BASE_URL}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json${apiKeyParam}`;
//     const fetchResponse = await axios.get(fetchUrl);
//     const summaryData = fetchResponse.data.result;
    
//     // Process the summaries to format articles
//     const articles = ids.map(pmid => {
//       const summary = summaryData[pmid];
      
//       if (!summary) {
//         return null;
//       }
      
//       // Extract authors
//       const authors = (summary.authors || [])
//         .filter(author => author.authtype === 'Author')
//         .map(author => author.name || '');
      
//       // Extract publication date
//       const pubDate = summary.pubdate || '';
      
//       // Extract journal name
//       const journal = summary.source || '';
      
//       // Extract title
//       const title = summary.title || '';
      
//       // Extract DOI
//       const articleIds = summary.articleids || [];
//       const doi = articleIds.find(id => id.idtype === 'doi')?.value || '';
      
//       return {
//         pmid,
//         title,
//         authors,
//         journal,
//         pubDate,
//         abstract: '', // We'll need to fetch abstracts separately
//         keywords: [], // Keywords typically not in summary
//         doi,
//         citationCount: null, // Not provided by PubMed API
//         fullTextUrl: fullTextOnly ? `https://www.ncbi.nlm.nih.gov/pmc/articles/pmid/${pmid}/` : ''
//       };
//     }).filter(Boolean); // Remove any null entries
    
//     // Optionally fetch abstracts for these articles
//     const abstractsUrl = `${EUTILS_BASE_URL}/efetch.fcgi?db=pubmed&id=${ids.join(',')}&rettype=abstract&retmode=xml${apiKeyParam}`;
//     const abstractsResponse = await axios.get(abstractsUrl);
    
//     // Parse XML to extract abstracts
//     parseXML(abstractsResponse.data, (err, result) => {
//       if (err) {
//         // If we can't parse abstracts, just return the articles without them
//         return res.json({
//           articles,
//           totalResults
//         });
//       }
      
//       try {
//         // Try to extract abstracts from the XML structure
//         const pubmedArticles = result.PubmedArticleSet?.PubmedArticle || [];
        
//         pubmedArticles.forEach((article, index) => {
//           const abstract = article.MedlineCitation?.[0]?.Article?.[0]?.Abstract?.[0]?.AbstractText || [];
          
//           // Join all abstract sections
//           const abstractText = abstract.map(text => {
//             // If text has attributes, it's a structured abstract
//             if (text.$ && text.$.Label) {
//               return `${text.$.Label}: ${text._}`;
//             }
//             return text;
//           }).join(' ');
          
//           // Extract keywords if available
//           const keywordsList = article.MedlineCitation?.[0]?.MeshHeadingList?.[0]?.MeshHeading || [];
//           const keywords = keywordsList.map(heading => {
//             return heading.DescriptorName?.[0]._ || '';
//           }).filter(Boolean);
          
//           // Update the article with abstract and keywords
//           if (articles[index]) {
//             articles[index].abstract = abstractText || 'No abstract available';
//             articles[index].keywords = keywords;
//           }
//         });
        
//         res.json({
//           articles,
//           totalResults
//         });
//       } catch (error) {
//         // If error parsing detailed XML, return what we have
//         console.error('Error parsing PubMed abstracts:', error);
//         res.json({
//           articles,
//           totalResults
//         });
//       }
//     });
    
//   } catch (error) {
//     console.error('PubMed API error:', error);
//     res.status(500).json({ 
//       error: 'Failed to fetch PubMed data',
//       message: error.message 
//     });
//   }
// });



// PubMed E-utilities API constants
const EUTILS_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const RESULTS_PER_PAGE = 10;
const nAPI_KEY = process.env.NCBI_API_KEY || ''; // Optional: Add your API key if you have one
const xml2js = require('xml2js'); 

// PubMed search API endpoint
/**
 * Endpoint to get PubMed publications
 */
// app.get('/api/pubmed', async (req, res) => {
//   try {
//     const term = req.query.term;
//     if (!term) {
//       return res.status(400).json({ error: 'Search term is required' });
//     }
    
//     console.log(`🔍 Fetching PubMed publications for: ${term}`);
    
//     // Call your existing function
//     const publications = await PubMed.searchPublications(term);
    
//     // Format response to match what frontend expects
//     res.json({
//       articles: publications, // Your publications array goes directly here
//       totalResults: publications.length // Or the actual total count if available
//     });
//   } catch (error) {
//     console.error('PubMed API error:', error);
//     res.status(500).json({ 
//       error: 'Failed to fetch PubMed data',
//       message: error.message 
//     });
//   }
// });

//////////////////////////////////////// 483 ///////////////////////////////////




app.get('/api/inspection-data', (req, res) => {
  try {
    // Define paths to CSV files
    const file1Path = path.join(__dirname, 'data/e18f4f87-a73a-42c6-ae4e-9a3b76245bdc.csv');
    const file2Path = path.join(__dirname, 'data/NonClinical_Labs_Inspections_List_(10-1-2000_through_10-1-2024).csv');
    
    const recentInspections = [];
    const historicalInspections = [];
    const projectAreasSet = new Set();
    
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
    
    // Process recent inspections (file 1)
    const processRecentInspections = async () => {
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
    };
    
// Process historical inspections (file 2)
const processHistoricalInspections = async () => {
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
    console.log(processedRow)
    return processedRow;
  });
};
    // Process both files and return response
    Promise.all([processRecentInspections(), processHistoricalInspections()])
      .then(() => {
        // If no data was loaded, provide sample data
        if (recentInspections.length === 0) {
          recentInspections.push({
            "Record Date": "2023-01-01",
            "Legal Name": "Sample Pharmaceutical",
            "Record Type": "Form 483",
            "FEI Number": 12345
          });
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
        }
        
        res.json({
          recentInspections: recentInspections,
          historicalInspections: historicalInspections,
          projectAreas: Array.from(projectAreasSet)
        });
      })
      .catch(err => {
        console.error("Error processing CSV data:", err);
        res.status(500).json({ error: 'Failed to process CSV data', details: err.message });
      });
    
  } catch (error) {
    console.error('Error in API endpoint:', error);
    res.status(500).json({ error: 'Failed to process inspection data', details: error.message });
  }
});



/////////////////////////////////////WL///////////////////////////////////////////////
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

// Search for warning letters
app.get('/api/wl/search', (req, res) => {
  try {
    const {
      term = '',
      field = 'all',
      dateFrom = '',
      dateTo = '',
      page = 1,
      perPage = 20
    } = req.query;

    const pageNum = parseInt(page);
    const itemsPerPage = parseInt(perPage);

    // Filter letters based on search criteria
    let filteredLetters = [...warningLetters];

    // Filter by search term
    if (term.trim()) {
      const searchTerm = term.toLowerCase();
      
      if (field === 'company') {
        filteredLetters = filteredLetters.filter(letter => 
          letter.companyName && letter.companyName.toLowerCase().includes(searchTerm)
        );
      } else if (field === 'subject') {
        filteredLetters = filteredLetters.filter(letter => 
          letter.subject && letter.subject.toLowerCase().includes(searchTerm)
        );
      } else if (field === 'content') {
        filteredLetters = filteredLetters.filter(letter => 
          letter.fullContent && letter.fullContent.toLowerCase().includes(searchTerm)
        );
      } else {
        // Search all fields
        filteredLetters = filteredLetters.filter(letter => 
          (letter.companyName && letter.companyName.toLowerCase().includes(searchTerm)) ||
          (letter.subject && letter.subject.toLowerCase().includes(searchTerm)) ||
          (letter.fullContent && letter.fullContent.toLowerCase().includes(searchTerm))
        );
      }
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
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalResults,
        perPage: itemsPerPage
      }
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
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalResults,
        perPage: itemsPerPage
      }
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
////////////////////////////////////////////////////////////WL///////////////////////////////////////////////////

app.use('/api/ema', emaRoutes);

// Add this route to fetch PDF document links from FDA website
// app.get('/api/fda-pdfs/:appNo', async (req, res) => {
//   try {
//     const appNo = req.params.appNo;
//     const url = `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appNo}`;
    
//     // Fetch HTML content
//     const html = await fetchHtml(url);
//     if (!html) {
//       return res.status(500).json({
//         error: 'Failed to fetch HTML content'
//       });
//     }
    
//     // Extract PDF links
//     const pdfLinks = extractPdfLinks(html);
    
//     if (pdfLinks.length === 0) {
//       return res.status(404).json({
//         message: 'No PDF links found',
//         total: 0,
//         results: []
//       });
//     }
    
//     // Return JSON response with PDF names and links
//     res.json({
//       message: 'PDF links retrieved successfully',
//       total: pdfLinks.length,
//       results: pdfLinks.map(link => ({
//         name: link.name,
//         url: link.url,
//         type: link.type
//       }))
//     });
    
//   } catch (error) {
//     console.error('API Error:', error);
//     res.status(500).json({
//       error: 'An error occurred while processing the request',
//       details: error.message
//     });
//   }
// });
// Route for analyzing FDA documents by URL
app.post('/api/analyze-fda-doc', async (req, res) => {
  const { pdfUrl } = req.body;
  
  if (!pdfUrl || !pdfUrl.toLowerCase().endsWith('.pdf')) {
    return res.status(400).json({ error: 'Valid PDF URL is required' });
  }
  
  try {
    // Create temp directory if it doesn't exist
    const tempDir = path.join(__dirname, 'temp-uploads');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Generate a unique filename
    const pdfFilename = `fda-doc-${Date.now()}.pdf`;
    const pdfPath = path.join(tempDir, pdfFilename);
    
    // Download the PDF
    console.log(`Downloading PDF from: ${pdfUrl}`);
    const response = await axios({
      method: 'get',
      url: pdfUrl,
      responseType: 'stream',
      timeout: 60000, // 60 seconds timeout
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Save the PDF to disk
    const writer = fs.createWriteStream(pdfPath);
    response.data.pipe(writer);
    
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    
    // Extract text content only from the PDF
    const text = await extractTextFromPDF(pdfPath);
    
    // Analyze the text content
    const summary = await analyzeTextWithGrokAPI(text);
    
    // Clean up the temp file
    try {
      fs.unlinkSync(pdfPath);
    } catch (error) {
      console.error('Error cleaning up file:', error);
    }
    
    res.json({
      success: true,
      summary: summary,
      documentUrl: pdfUrl,
      textLength: text.length
    });
    
  } catch (error) {
    console.error('FDA document analysis error:', error);
    res.status(500).json({ 
      error: 'Error analyzing FDA document',
      details: error.message
    });
  }
});

// Simplified function to extract text from PDF
async function extractTextFromPDF(pdfPath) {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const pdfData = await pdfParse(dataBuffer);
    const text = pdfData.text || '';
    
    console.log(`Extracted ${text.length} characters of text from PDF.`);
    return text;
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    return 'Error extracting text from PDF';
  }
}

// Function to send text to Grok API
async function analyzeTextWithGrokAPI(text) {
  try {
    // Truncate text if too long (Grok API may have limits)
    const truncatedText = text.length > 8000 ? text.substring(0, 8000) + '...' : text;
    
    const payload = {
      messages: [
        {
          role: "system",
          content: "You are an AI assistant that specializes in analyzing FDA documents. Provide a clear, concise summary of the key information in the document, focusing on: 1) Drug name and active ingredients, 2) Approved indications, 3) Important safety information, 4) Dosage recommendations, 5) Contraindications, and 6) Any special populations or warnings. Format your response with clear markdown headings."
        },
        {
          role: "user",
          content: [
            { 
              type: "text", 
              text: `Analyze and summarize this FDA document content:\n\n${truncatedText}` 
            }
          ]
        }
      ],
      model: "grok-2-latest",
      stream: false,
      temperature: 0
    };
    
    console.log('Sending request to Grok API...');
    
    const response = await axios.post(GROK_API_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer xai-${GROK_API_KEY}`
      },
      timeout: 60000 // 60 second timeout
    });
    
    console.log('Received response from Grok API');
    
    if (response.data && response.data.choices && response.data.choices[0]) {
      return response.data.choices[0].message.content;
    } else {
      console.error('Invalid response structure from Grok API:', JSON.stringify(response.data));
      throw new Error('Invalid response from Grok API');
    }
    
  } catch (error) {
    console.error('Grok API Error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
    
    // Fall back to a basic analysis if API fails
    return fallbackAnalysis(text, error);
  }
}

// Fallback function for when API calls fail
function fallbackAnalysis(text, error) {
  // Extract basic information from text
  const textSample = text.substring(0, 1000);
  
  let drugName = "Not identified";
  const drugNameMatch = text.match(/([A-Z][a-z]+|[A-Z]{2,})®|([A-Z][a-z]+|[A-Z]{2,})™|([A-Z][a-z]+|[A-Z]{2,})[\s\(][Tt]ablets|([A-Z][a-z]+|[A-Z]{2,})[\s\(][Cc]apsules/);
  if (drugNameMatch) {
    drugName = drugNameMatch[0];
  }
  
  return `
## FDA Document Analysis

**Note: This is a fallback analysis due to an error in the AI processing system.**
Error details: ${error.message}

### Basic Information Extracted
- **Drug Name (estimated)**: ${drugName}
- **Document Type**: FDA Document
- **Text Length**: ${text.length} characters

### Limited Analysis
The document appears to be an FDA regulatory document that would typically contain information about drug indications, safety information, dosing guidelines, and other regulatory content.

For a complete analysis, please try again later or consult the original document directly.
`;
}


// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: 'sk-proj-nxfaxu6gapHui2EF3q2uT3BlbkFJrU6892giVohI6KUpvig4'

});

// Your OpenAI Assistant ID
const ASSISTANT_ID = 'asst_4NqstKJU6mibzFI4oCFZ8CUt';

// API route to generate visualization
app.post('/api/generate-visualization', async (req, res) => {
  console.log("=== API ENDPOINT CALLED: /api/generate-visualization ===");
  console.log("Request body type:", typeof req.body);
  console.log("Request body keys:", Object.keys(req.body));
  
  try {
    const { trialData } = req.body;
    console.log("Trial data present:", !!trialData);
    
    if (!trialData) {
      console.log("ERROR: No trial data provided in request");
      return res.status(400).json({ error: 'Trial data is required' });
    }
    
    // Log sample of trial data (not too large to flood logs)
    console.log("Trial data sample:", JSON.stringify(trialData).substring(0, 200) + "...");
    
    // Check OpenAI setup
    console.log("OpenAI API key present:", !!process.env.OPENAI_API_KEY);
    console.log("Assistant ID:", ASSISTANT_ID);
    
    // Create a thread
    console.log("Creating thread...");
    let thread;
    try {
      thread = await openai.beta.threads.create();
      console.log("Thread created successfully:", thread.id);
    } catch (threadError) {
      console.error("ERROR creating thread:", threadError);
      return res.status(400).json({ 
        error: `Thread creation failed: ${threadError.message}`,
        details: threadError
      });
    }
    
    // Add a message to the thread
    console.log("Adding message to thread...");
    try {
      const message = await openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: `Generate a visualization dashboard for this clinical trial data using vanilla HTML, JavaScript, and Tailwind CSS. The code should be suitable for direct insertion into a div via innerHTML. Here's the trial data:\n\n${JSON.stringify(trialData, null, 2)}`
      });
      console.log("Message added successfully:", message.id);
    } catch (messageError) {
      console.error("ERROR creating message:", messageError);
      return res.status(400).json({ 
        error: `Message creation failed: ${messageError.message}`,
        details: messageError
      });
    }
    
    // Run the assistant
    console.log("Creating run with assistant...");
    let run;
    try {
      run = await openai.beta.threads.runs.create(thread.id, {
        assistant_id: ASSISTANT_ID,
      });
      console.log("Run created successfully:", run.id, "with status:", run.status);
    } catch (runError) {
      console.error("ERROR creating run:", runError);
      return res.status(400).json({ 
        error: `Run creation failed: ${runError.message}`,
        details: runError
      });
    }
    
    // Poll for completion
    console.log("Polling for run completion...");
    let completedRun;
    try {
      completedRun = await pollRunStatus(thread.id, run.id);
      console.log("Run completed with status:", completedRun.status);
    } catch (pollError) {
      console.error("ERROR polling run status:", pollError);
      return res.status(400).json({ 
        error: `Run polling failed: ${pollError.message}`,
        details: pollError
      });
    }
    
    if (completedRun.status !== 'completed') {
      console.log("Run did not complete successfully. Final status:", completedRun.status);
      return res.status(500).json({ 
        error: 'Assistant run failed', 
        status: completedRun.status 
      });
    }
    
    // Get the assistant's response
    console.log("Retrieving messages from thread...");
    let messages;
    try {
      messages = await openai.beta.threads.messages.list(thread.id);
      console.log("Messages retrieved successfully. Count:", messages.data.length);
    } catch (messagesError) {
      console.error("ERROR retrieving messages:", messagesError);
      return res.status(400).json({ 
        error: `Messages retrieval failed: ${messagesError.message}`,
        details: messagesError
      });
    }
    
    const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');
    console.log("Assistant messages count:", assistantMessages.length);
    
    if (assistantMessages.length === 0) {
      console.log("ERROR: No assistant messages found in the thread");
      return res.status(500).json({ error: 'No response from assistant' });
    }
    
    const latestMessage = assistantMessages[0];
    console.log("Latest message ID:", latestMessage.id);
    console.log("Message content types:", latestMessage.content.map(c => c.type).join(', '));
    
    // Parse the content to extract HTML and JavaScript
    let html = '';
    let javascript = '';
    
    for (const content of latestMessage.content) {


      if (content.type === 'text') {
        const text = content.text.value;
        console.log(text)
        console.log("Text content length:", text.length);
        console.log("Text content preview:", text.substring(0, 100) + "...");
        
        // Extract HTML code blocks
        const htmlMatches = text.match(/```html\n([\s\S]*?)\n```/g);
        console.log("HTML matches found:", !!htmlMatches, htmlMatches ? htmlMatches.length : 0);
        
        if (htmlMatches) {
          html = htmlMatches.map(match => match.replace(/```html\n/, '').replace(/\n```/, '')).join('\n');
          console.log("Extracted HTML length:", html.length);
        }
        
        // Extract JavaScript code blocks
        const jsMatches = text.match(/```javascript\n([\s\S]*?)\n```/g);
        console.log("JavaScript matches found:", !!jsMatches, jsMatches ? jsMatches.length : 0);
        
        if (jsMatches) {
          javascript = jsMatches.map(match => match.replace(/```javascript\n/, '').replace(/\n```/, '')).join('\n');
          console.log("Extracted JavaScript length:", javascript.length);
        }
      }
    }
    
    console.log("Sending response back to client...");
    console.log("HTML content present:", !!html && html.length > 0);
    console.log("JavaScript content present:", !!javascript && javascript.length > 0);
    console.log("returned html :", html, "js : ", javascript)
    res.json({ html, javascript });
    console.log("Response sent successfully");
    
  } catch (error) {
    console.error("UNHANDLED ERROR in generate-visualization endpoint:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({ 
      error: error.message,
      stack: error.stack 
    });
  }
});

// Add logging to the pollRunStatus function as well
async function pollRunStatus(threadId, runId, maxAttempts = 60) {
  console.log(`Started polling run status for thread ${threadId}, run ${runId}`);
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    attempts++;
    console.log(`Poll attempt ${attempts}/${maxAttempts}`);
    
    try {
      const run = await openai.beta.threads.runs.retrieve(threadId, runId);
      console.log(`Current run status: ${run.status}`);
      
      if (['completed', 'failed', 'cancelled', 'expired'].includes(run.status)) {
        console.log(`Run reached terminal status: ${run.status}`);
        return run;
      }
      
      // If the run requires action (e.g., function calling), handle it here
      if (run.status === 'requires_action') {
        console.log("Run requires action, but no action handling is implemented");
        // You would implement function calling handling here if needed
      }
      
      // Wait for 1 second before checking again
      console.log("Waiting 1 second before next poll attempt...");
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`ERROR during poll attempt ${attempts}:`, error);
      throw new Error(`Failed to poll run status: ${error.message}`);
    }
  }
  
  console.log(`Polling timed out after ${maxAttempts} attempts`);
  throw new Error('Timed out waiting for run to complete');
}
// // Route for analyzing PDF files uploaded directly
// app.post('/api/analyze-pdf', (req, res) => {
//   upload(req, res, async function (err) {
//     if (err) {
//       return res.status(400).json({ error: err.message });
//     }
    
//     if (!req.file) {
//       return res.status(400).json({ error: 'No PDF file uploaded' });
//     }
    
//     try {
//       const filePath = req.file.path;
      
//       // Extract both text and images from PDF
//       const { text, images } = await extractFromPDF(filePath);
      
//       // If no images found, just analyze the text
//       if (images.length === 0) {
//         const summary = await analyzeTextWithGrokAPI(text);
        
//         // Clean up the temp file
//         try {
//           fs.unlinkSync(filePath);
//         } catch (error) {
//           console.error('Error removing file:', error);
//         }
        
//         return res.json({
//           success: true,
//           summary: summary,
//           imageCount: 0
//         });
//       }
      
//       // If we have images, analyze them with the text context
//       const summary = await analyzeWithGrokAPI(text, images);
      
//       // Clean up the temp file and temp images
//       try {
//         fs.unlinkSync(filePath);
//         images.forEach(img => {
//           if (img.startsWith('file://')) {
//             const imgPath = img.replace('file://', '');
//             if (fs.existsSync(imgPath)) {
//               fs.unlinkSync(imgPath);
//             }
//           }
//         });
//       } catch (error) {
//         console.error('Error cleaning up files:', error);
//       }
      
//       res.json({
//         success: true,
//         summary: summary,
//         imageCount: images.length
//       });
      
//     } catch (error) {
//       console.error('PDF analysis error:', error);
//       res.status(500).json({ 
//         error: 'Error analyzing PDF',
//         details: error.message
//       });
//     }
//   });
// });

// // Route for analyzing FDA documents by URL
// app.post('/api/analyze-fda-doc', async (req, res) => {
//   const { pdfUrl } = req.body;
  
//   if (!pdfUrl || !pdfUrl.toLowerCase().endsWith('.pdf')) {
//     return res.status(400).json({ error: 'Valid PDF URL is required' });
//   }
  
//   try {
//     // Create temp directory if it doesn't exist
//     const tempDir = path.join(__dirname, 'temp-uploads');
//     if (!fs.existsSync(tempDir)) {
//       fs.mkdirSync(tempDir, { recursive: true });
//     }
    
//     // Generate a unique filename
//     const pdfFilename = `fda-doc-${Date.now()}.pdf`;
//     const pdfPath = path.join(tempDir, pdfFilename);
    
//     // Download the PDF
//     console.log(`Downloading PDF from: ${pdfUrl}`);
//     const response = await axios({
//       method: 'get',
//       url: pdfUrl,
//       responseType: 'stream',
//       timeout: 60000, // 60 seconds timeout
//       headers: {
//         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
//       }
//     });
    
//     // Save the PDF to disk
//     const writer = fs.createWriteStream(pdfPath);
//     response.data.pipe(writer);
    
//     await new Promise((resolve, reject) => {
//       writer.on('finish', resolve);
//       writer.on('error', reject);
//     });
    
//     // Extract content from the PDF
//     const { text, images } = await extractFromPDF(pdfPath);
    
//     // Analyze the content
//     let summary;
//     if (images.length > 0) {
//       summary = await analyzeWithGrokAPI(text, images);
//     } else {
//       summary = await analyzeTextWithGrokAPI(text);
//     }
    
//     // Clean up the temp file and temp images
//     try {
//       fs.unlinkSync(pdfPath);
//       images.forEach(img => {
//         if (img.startsWith('file://')) {
//           const imgPath = img.replace('file://', '');
//           if (fs.existsSync(imgPath)) {
//             fs.unlinkSync(imgPath);
//           }
//         }
//       });
//     } catch (error) {
//       console.error('Error cleaning up files:', error);
//     }
    
//     res.json({
//       success: true,
//       summary: summary,
//       documentUrl: pdfUrl,
//       imageCount: images.length,
//       textLength: text.length
//     });
    
//   } catch (error) {
//     console.error('FDA document analysis error:', error);
//     res.status(500).json({ 
//       error: 'Error analyzing FDA document',
//       details: error.message
//     });
//   }
// });

// // Function to fetch the HTML content from the URL
// async function fetchHtml(url) {
//   try {
//     const response = await axios.get(url, { 
//       httpsAgent,
//       headers: {
//         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
//       }
//     });
//     return response.data;
//   } catch (error) {
//     console.error(`Error fetching URL: ${error.message}`);
//     return null;
//   }
// }

// // Function to extract PDF links from the HTML content
// function extractPdfLinks(html) {
//   const $ = cheerio.load(html);
//   const links = [];
  
//   $('a').each((index, element) => {
//     const href = $(element).attr('href');
//     const text = $(element).text().trim();
    
//     if (href && (
//       href.includes('.pdf') || 
//       href.includes('drugsatfda_docs') ||
//       text.includes('PDF') ||
//       text.includes('Review') ||
//       text.includes('Label') ||
//       text.includes('Letter')
//     )) {
//       let fullUrl = href;
//       if (href.startsWith('/')) {
//         fullUrl = `https://www.accessdata.fda.gov${href}`;
//       } else if (!href.startsWith('http')) {
//         fullUrl = `https://www.accessdata.fda.gov/${href}`;
//       }
      
//       links.push({
//         name: text || 'No description',
//         url: fullUrl,
//         type: determineType(text, href)
//       });
//     }
//   });
  
//   return links;
// }

// // Function to determine the type of link
// function determineType(text, href) {
//   text = text.toLowerCase();
//   href = href.toLowerCase();
  
//   if (text.includes('review') || href.includes('review')) {
//     return 'Review';
//   } else if (text.includes('label') || href.includes('label') || href.includes('lbl')) {
//     return 'Label';
//   } else if (text.includes('letter') || href.includes('letter') || href.includes('ltr')) {
//     return 'Letter';
//   } else {
//     return 'Other';
//   }
// }

// // Function to extract text and images from a PDF
// async function extractFromPDF(pdfPath) {
//   // Extract text content
//   let text = '';
//   try {
//     const dataBuffer = fs.readFileSync(pdfPath);
//     const pdfData = await pdfParse(dataBuffer);
//     text = pdfData.text || '';
    
//     // Load the PDF to get the page count
//     const pdfDoc = await PDFDocument.load(dataBuffer);
//     const pageCount = pdfDoc.getPageCount();
    
//     console.log(`PDF has ${pageCount} pages. Extracted ${text.length} characters of text.`);
    
//     // Set up image extraction options
//     const options = {
//       density: 150,           // Medium density for balance of quality/speed
//       quality: 80,            // JPEG quality
//       format: "png",          // Output format
//       width: 1200,            // Target width in pixels
//       height: 1600,           // Target height in pixels
//       saveFilename: `page`,   // Output filename prefix
//       savePath: path.dirname(pdfPath),
//       page: null              // Indicates we'll do specific pages
//     };
    
//     // Create the PDF conversion instance
//     const convert = fromPath(pdfPath, options);
    
//     // Limit to processing first 3 pages for performance
//     const pagesToProcess = Math.min(pageCount, 3);
//     console.log(`Processing ${pagesToProcess} pages from PDF with ${pageCount} total pages`);
    
//     // Array to hold our image paths
//     const images = [];
    
//     // Convert pages to images
//     for (let i = 1; i <= pagesToProcess; i++) {
//       try {
//         console.log(`Converting page ${i} to image...`);
//         const result = await convert.convert(i);
        
//         // result.path contains the path to the saved image
//         const imgPath = result.path;
        
//         // Resize image for faster processing and API compatibility
//         try {
//           await sharp(imgPath)
//             .resize(800) // Resize to max width of 800px while maintaining aspect ratio
//             .toFile(`${imgPath.replace('.png', '')}-resized.png`);
          
//           // Use the resized version
//           const resizedPath = `${imgPath.replace('.png', '')}-resized.png`;
          
//           // For API usage, we use file:// protocol
//           images.push(`file://${resizedPath}`);
          
//           // Clean up the original large image
//           try {
//             fs.unlinkSync(imgPath);
//           } catch (error) {
//             console.error(`Error removing original image: ${error.message}`);
//           }
//         } catch (resizeError) {
//           console.error('Error resizing image:', resizeError);
//           // If resize fails, use the original
//           images.push(`file://${imgPath}`);
//         }
        
//       } catch (error) {
//         console.error(`Error converting page ${i} to image:`, error);
//       }
//     }
    
//     return { text, images };
    
//   } catch (error) {
//     console.error('Error in PDF extraction:', error);
//     return { text: text || 'Error extracting text', images: [] };
//   }
// }

// // Function to convert file paths to base64
// async function convertImagesToBase64(imagePaths) {
//   const base64Images = [];
  
//   for (const imgPath of imagePaths) {
//     if (imgPath.startsWith('file://')) {
//       const filePath = imgPath.replace('file://', '');
//       if (fs.existsSync(filePath)) {
//         try {
//           const data = fs.readFileSync(filePath);
//           const base64 = `data:image/png;base64,${data.toString('base64')}`;
//           base64Images.push(base64);
//         } catch (error) {
//           console.error('Error converting image to base64:', error);
//         }
//       }
//     } else {
//       base64Images.push(imgPath); // If already a data URL
//     }
//   }
  
//   return base64Images;
// }

// // Function to send text to Grok API
// async function analyzeTextWithGrokAPI(text) {
//   try {
//     // Truncate text if too long (Grok API may have limits)
//     const truncatedText = text.length > 8000 ? text.substring(0, 8000) + '...' : text;
    
//     const payload = {
//       messages: [
//         {
//           role: "system",
//           content: "You are an AI assistant that specializes in analyzing FDA documents. Provide a clear, concise summary of the key information in the document, focusing on: 1) Drug name and active ingredients, 2) Approved indications, 3) Important safety information, 4) Dosage recommendations, 5) Contraindications, and 6) Any special populations or warnings. Format your response with clear markdown headings."
//         },
//         {
//           role: "user",
//           content: [
//             { 
//               type: "text", 
//               text: `Analyze and summarize this FDA document content:\n\n${truncatedText}` 
//             }
//           ]
//         }
//       ],
//       model: "grok-2-latest", // Update this to the latest Grok model
//       stream: false,
//       temperature: 0
//     };
    
//     const response = await axios.post(GROK_API_URL, payload, {
//       headers: {
//         'Content-Type': 'application/json',
//         'Authorization': `Bearer xai-${GROK_API_KEY}`
//       },
//       timeout: 60000 // 60 second timeout
//     });
    
//     if (response.data && response.data.choices && response.data.choices[0]) {
//       return response.data.choices[0].message.content;
//     } else {
//       throw new Error('Invalid response from Grok API');
//     }
    
//   } catch (error) {
//     console.error('Grok API Error:', error);
//     // Fall back to a basic analysis if API fails
//     return fallbackAnalysis(text, error);
//   }
// }

// // Function to send text and images to Grok API
// async function analyzeWithGrokAPI(text, images) {
//   try {
//     // Truncate text if too long
//     const truncatedText = text.length > 5000 ? text.substring(0, 5000) + '...' : text;
    
//     // Convert file paths to base64
//     const base64Images = await convertImagesToBase64(images.slice(0, 3)); // Limit to 3 images
    
//     // Build the message content with both text and images
//     const content = [
//       { 
//         type: "text", 
//         text: `Analyze and summarize this FDA document with text and images. Focus on: 1) Drug name and active ingredients, 2) Approved indications, 3) Important safety information, 4) Dosage recommendations, 5) Contraindications, and 6) Any special populations or warnings. Format your response with clear markdown headings.\n\n${truncatedText}` 
//       }
//     ];
    
//     // Add images
//     base64Images.forEach(img => {
//       content.push({
//         type: "image_url",
//         image_url: { url: img }
//       });
//     });
    
//     const payload = {
//       messages: [
//         {
//           role: "system",
//           content: "You are an AI assistant that specializes in analyzing FDA documents. Provide a clear, concise summary of the key information in the document, focusing on the most important clinical information."
//         },
//         {
//           role: "user",
//           content: content
//         }
//       ],
//       model: "grok-2-latest", // Update this to the latest Grok model
//       stream: false,
//       temperature: 0
//     };
    
//     const response = await axios.post(GROK_API_URL, payload, {
//       headers: {
//         'Content-Type': 'application/json',
//         'Authorization': `Bearer xai-${GROK_API_KEY}`
//       },
//       timeout: 120000 // 120 second timeout for image processing
//     });
    
//     if (response.data && response.data.choices && response.data.choices[0]) {
//       return response.data.choices[0].message.content;
//     } else {
//       throw new Error('Invalid response from Grok API');
//     }
    
//   } catch (error) {
//     console.error('Grok API Error (with images):', error);
//     // Try text-only analysis if image analysis fails
//     try {
//       return await analyzeTextWithGrokAPI(text);
//     } catch (textError) {
//       console.error('Fallback text analysis failed:', textError);
//       return fallbackAnalysis(text, error);
//     }
//   }
// }

// // Fallback function for when API calls fail
// function fallbackAnalysis(text, error) {
//   // Extract basic information from text
//   const textSample = text.substring(0, 1000);
  
//   let drugName = "Not identified";
//   const drugNameMatch = text.match(/([A-Z][a-z]+|[A-Z]{2,})®|([A-Z][a-z]+|[A-Z]{2,})™|([A-Z][a-z]+|[A-Z]{2,})[\s\(][Tt]ablets|([A-Z][a-z]+|[A-Z]{2,})[\s\(][Cc]apsules/);
//   if (drugNameMatch) {
//     drugName = drugNameMatch[0];
//   }
  
//   return `
// ## FDA Document Analysis

// **Note: This is a fallback analysis due to an error in the AI processing system.**
// Error details: ${error.message}

// ### Basic Information Extracted
// - **Drug Name (estimated)**: ${drugName}
// - **Document Type**: FDA Document
// - **Text Length**: ${text.length} characters

// ### Limited Analysis
// The document appears to be an FDA regulatory document that would typically contain information about drug indications, safety information, dosing guidelines, and other regulatory content.

// For a complete analysis, please try again later or consult the original document directly.
// `;
// }

// // OpenAI fallback (if you want to implement a backup service)
// async function openAIFallback(text) {
//   try {
//     // This assumes you have the OpenAI package installed
//     // npm install openai
//     const { OpenAI } = require('openai');
    
//     const openai = new OpenAI({
//       apiKey: process.env.OPENAI_API_KEY || 'your-openai-api-key'
//     });
    
//     const truncatedText = text.length > 8000 ? text.substring(0, 8000) + '...' : text;
    
//     const response = await openai.chat.completions.create({
//       model: "gpt-4o",
//       messages: [
//         {
//           role: "system",
//           content: "You are an AI assistant that specializes in analyzing FDA documents. Provide a clear, concise summary of the key information in the document, focusing on: 1) Drug name and active ingredients, 2) Approved indications, 3) Important safety information, 4) Dosage recommendations, 5) Contraindications, and 6) Any special populations or warnings. Format your response with clear headings."
//         },
//         {
//           role: "user",
//           content: `Analyze and summarize this FDA document content:\n\n${truncatedText}`
//         }
//       ],
//       temperature: 0
//     });
    
//     return response.choices[0].message.content;
//   } catch (error) {
//     console.error('OpenAI API Error:', error);
//     return `Error generating summary with fallback API: ${error.message}`;
//   }
// }


// Create an HTTPS agent with relaxed SSL options
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});


// // Function to fetch the HTML content from the URL
// async function fetchHtml(url) {
//   try {
//     const response = await axios.get(url, { 
//       httpsAgent,
//       headers: {
//         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
//       }
//     });
//     return response.data;
//   } catch (error) {
//     console.error(`Error fetching URL: ${error.message}`);
//     return null;
//   }
// }

// // Function to extract PDF links from the HTML content
// function extractPdfLinks(html) {
//   const $ = cheerio.load(html);
//   const links = [];
  
//   $('a').each((index, element) => {
//     const href = $(element).attr('href');
//     const text = $(element).text().trim();
    
//     if (href && (
//       href.includes('.pdf') || 
//       href.includes('drugsatfda_docs') ||
//       text.includes('PDF') ||
//       text.includes('Review') ||
//       text.includes('Label') ||
//       text.includes('Letter')
//     )) {
//       let fullUrl = href;
//       if (href.startsWith('/')) {
//         fullUrl = `https://www.accessdata.fda.gov${href}`;
//       } else if (!href.startsWith('http')) {
//         fullUrl = `https://www.accessdata.fda.gov/${href}`;
//       }
      
//       links.push({
//         name: text || 'No description',
//         url: fullUrl,
//         type: determineType(text, href)
//       });
//     }
//   });
  
//   return links;
// }

// // Function to determine the type of link
// function determineType(text, href) {
//   text = text.toLowerCase();
//   href = href.toLowerCase();
  
//   if (text.includes('review') || href.includes('review')) {
//     return 'Review';
//   } else if (text.includes('label') || href.includes('label') || href.includes('lbl')) {
//     return 'Label';
//   } else if (text.includes('letter') || href.includes('letter') || href.includes('ltr')) {
//     return 'Letter';
//   } else {
//     return 'Other';
//   }
// }

// // API endpoint
// app.get('/api/fda-pdfs/:appNo', async (req, res) => {
//   try {
//     const appNoInput = req.params.appNo;
//     // Strip "NDA" prefix if present
//     const appNo = appNoInput.startsWith('NDA') ? appNoInput.substring(3) : appNoInput;
//     const url = `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appNo}`;
//     console.log(url)
//     // Fetch HTML content
//     const html = await fetchHtml(url);
//     if (!html) {
//       return res.status(500).json({
//         error: 'Failed to fetch HTML content'
//       });
//     }
    
//     // Extract PDF links
//     const pdfLinks = extractPdfLinks(html);
    
//     if (pdfLinks.length === 0) {
//       return res.status(404).json({
//         message: 'No PDF links found',
//         total: 0,
//         results: []
//       });
//     }
    
//     // Return JSON response with PDF names and links
//     res.json({
//       message: 'PDF links retrieved successfully',
//       total: pdfLinks.length,
//       results: pdfLinks.map(link => ({
//         name: link.name,
//         url: link.url,
//         type: link.type
//       }))
//     });
    
//   } catch (error) {
//     console.error('API Error:', error);
//     res.status(500).json({
//       error: 'An error occurred while processing the request',
//       details: error.message
//     });
//   }
// });



app.get('/api/fda-pdfs/:appNo', async (req, res) => {
  try {
    const appNoInput = req.params.appNo;
    // Strip "NDA" prefix if present
    const appNo = appNoInput.startsWith('NDA') ? appNoInput.substring(3) : appNoInput;
    
    // Try the DAF URL first
    const dafUrl = `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appNo}`;
    console.log(`Fetching primary URL: ${dafUrl}`);
    
    // Fetch HTML content
    let html = await fetchHtml(dafUrl);
    
    // If that fails or has no results, try the direct TOC URL
    if (!html || html.includes('No matching records found')) {
      const year = new Date().getFullYear(); // Current year as a fallback
      const tocUrl = `https://www.accessdata.fda.gov/drugsatfda_docs/nda/${year}/${appNo}s000TOC.cfm`;
      console.log(`No results from primary URL, trying TOC URL: ${tocUrl}`);
      html = await fetchHtml(tocUrl);
    }
    
    if (!html) {
      return res.status(500).json({
        error: 'Failed to fetch HTML content',
        message: 'Could not retrieve content from FDA databases for this application number.'
      });
    }
    
    // Extract PDF links
    let pdfLinks = await extractPdfLinks(html);
    
    // If still no PDFs, try some variations of the TOC URL
    if (pdfLinks.length === 0) {
      const yearsToTry = [new Date().getFullYear() - 1, new Date().getFullYear() - 2]; // Try previous years
      
      for (const year of yearsToTry) {
        const alternateTocUrl = `https://www.accessdata.fda.gov/drugsatfda_docs/nda/${year}/${appNo}Orig1s000TOC.cfm`;
        console.log(`Trying alternate TOC URL: ${alternateTocUrl}`);
        const alternateHtml = await fetchHtml(alternateTocUrl);
        
        if (alternateHtml) {
          const alternateLinks = await processTocPage(alternateHtml, alternateTocUrl);
          if (alternateLinks.length > 0) {
            pdfLinks = alternateLinks;
            break;
          }
        }
      }
    }
    
    // Group results by document type for better organization
    const groupedResults = {};
    pdfLinks.forEach(link => {
      const type = link.type;
      if (!groupedResults[type]) {
        groupedResults[type] = [];
      }
      groupedResults[type].push({
        name: link.name,
        url: link.url
      });
    });
    
    // If still no PDFs found
    if (pdfLinks.length === 0) {
      return res.status(404).json({
        message: `No PDF documents found for application number ${appNo}`,
        total: 0,
        results: []
      });
    }
    
    // Return JSON response with PDF names and links
    res.json({
      message: 'PDF links retrieved successfully',
      total: pdfLinks.length,
      groupedResults: groupedResults,
      results: pdfLinks.map(link => ({
        name: link.name,
        url: link.url,
        type: link.type
      }))
    });
    
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({
      error: 'An error occurred while processing the request',
      details: error.message
    });
  }
});

// Function to fetch the HTML content from the URL
async function fetchHtml(url) {
  try {
    const response = await axios.get(url, {
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 15000, // 15 seconds timeout
      maxRedirects: 5
    });
    
    // Check for error messages in the HTML
    if (response.data && 
        (response.data.includes('No matching records found') ||
         response.data.includes('Page Not Found') ||
         response.data.includes('Error 404'))) {
      console.log(`Page found but contains error message: ${url}`);
      return null;
    }
    
    return response.data;
  } catch (error) {
    console.error(`Error fetching URL: ${url}`);
    console.error(`Error details: ${error.message}`);
    
    // If the error has a response, log some details
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Headers: ${JSON.stringify(error.response.headers)}`);
    }
    
    return null;
  }
}

// Function to extract PDF links from the HTML content
async function extractPdfLinks(html) {
  const $ = cheerio.load(html);
  let links = [];
  
  // Process regular links
  $('a').each((index, element) => {
    const href = $(element).attr('href');
    const text = $(element).text().trim();
    
    // Skip if href is undefined or empty
    if (!href) return;
    
    // Skip known bad links and patterns
    if (href.includes('#collapse') || 
        href.includes('warning-letters') ||
        href.includes('javascript:') ||
        href.includes('accessdata.fda.gov/#') ||
        href === '#' ||
        href === '' ||
        href === 'javascript:void(0)') {
      return;
    }
    
    // Check if it's a PDF link or a link to a review/label/letter
    if (href.includes('.pdf') || 
        href.includes('drugsatfda_docs') ||
        text.includes('PDF') ||
        text.includes('Review') ||
        text.includes('Label') ||
        text.includes('Letter')) {
      
      let fullUrl = makeFullUrl(href);
      
      // Validate URL format to avoid malformed URLs
      if (!isValidUrl(fullUrl)) {
        console.log(`Skipping invalid URL: ${fullUrl}`);
        return;
      }
      
      links.push({
        name: text || 'No description',
        url: fullUrl,
        type: determineType(text, href)
      });
    }
  });
  
  // Look for TOC links and process them
  const tocLinks = links.filter(link => 
    link.url.includes('TOC.cfm') || 
    link.url.includes('toc.cfm') ||
    (link.url.includes('drugsatfda_docs') && link.type === 'Review')
  );
  
  if (tocLinks.length > 0) {
    for (const tocLink of tocLinks) {
      console.log(`Found TOC/review page link: ${tocLink.url}`);
      const tocHtml = await fetchHtml(tocLink.url);
      if (tocHtml) {
        const tocPdfLinks = await processTocPage(tocHtml, tocLink.url);
        links = links.concat(tocPdfLinks);
      }
    }
  }
  
  // Filter out duplicate URLs and invalid/broken links
  const uniqueLinks = [];
  const seenUrls = new Set();
  
  for (const link of links) {
    // Skip links with obviously broken URLs
    if (link.url.includes('#collapse') || 
        link.url.includes('accessdata.fda.gov/#') ||
        !isValidUrl(link.url)) {
      continue;
    }
    
    if (!seenUrls.has(link.url)) {
      seenUrls.add(link.url);
      uniqueLinks.push(link);
    }
  }
  
  return uniqueLinks;
}

// Function to validate URL format
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

// Process TOC page and extract PDF links using enhanced scraper logic
async function processTocPage(html, url) {
  const $ = cheerio.load(html);
  const links = [];
  
  // Get the base URL to construct absolute URLs
  let baseUrl = '';
  let currentPath = '';
  
  if (url) {
    try {
      const urlObj = new URL(url);
      baseUrl = urlObj.origin;
      currentPath = urlObj.pathname.split('/').slice(0, -1).join('/');
    } catch (error) {
      console.error(`Error parsing URL ${url}: ${error.message}`);
      // Fall back to default behavior
      baseUrl = 'https://www.accessdata.fda.gov';
      currentPath = '/drugsatfda_docs/nda';
    }
  } else {
    baseUrl = 'https://www.accessdata.fda.gov';
    currentPath = '/drugsatfda_docs/nda';
  }
  
  // Find all links to PDFs
  $('a[href$=".pdf"]').each((index, element) => {
    const relativeUrl = $(element).attr('href');
    const title = $(element).text().trim();
    
    // Skip if empty or doesn't end with PDF
    if (!relativeUrl || !relativeUrl.toLowerCase().endsWith('.pdf')) {
      return;
    }
    
    // Skip problematic URLs
    if (relativeUrl.includes('#collapse') || 
        relativeUrl.includes('accessdata.fda.gov/#') ||
        relativeUrl === '#' ||
        relativeUrl === '' ||
        relativeUrl === 'javascript:void(0)') {
      return;
    }
    
    // Construct absolute URL - handling different formats of relative URLs
    let absoluteUrl;
    if (relativeUrl.startsWith('http')) {
      // Already absolute
      absoluteUrl = relativeUrl;
    } else if (relativeUrl.startsWith('/')) {
      // Root-relative URL
      absoluteUrl = `${baseUrl}${relativeUrl}`;
    } else {
      // Document-relative URL
      absoluteUrl = `${baseUrl}${currentPath}/${relativeUrl}`;
    }
    
    // Validate the URL
    if (!isValidUrl(absoluteUrl)) {
      console.log(`Skipping invalid URL from TOC page: ${absoluteUrl}`);
      return;
    }
    
    // Get parent context for categorization
    let category = '';
    
    // Try to determine the category from the panel heading or other context
    const parentPanel = $(element).closest('.panel');
    if (parentPanel.length) {
      const panelHeading = parentPanel.find('.panel-heading').text().trim();
      if (panelHeading) {
        category = panelHeading;
      }
    }
    
    // If no category from panel, try to get context from nearby elements
    if (!category) {
      // Check previous heading or paragraph
      let prevElement = $(element).prev('h1, h2, h3, h4, h5, p, li');
      if (prevElement.length) {
        category = prevElement.text().trim();
      } else {
        // Try parent li or p
        const parentContext = $(element).closest('li, p');
        if (parentContext.length) {
          category = parentContext.text().trim().replace(title, '').trim();
        }
      }
    }
    
    // Map the category to a standardized type
    const type = standardizeType(category, title, relativeUrl);
    
    links.push({
      name: title || 'No description',
      url: absoluteUrl,
      type: type,
      originalCategory: category // Keep original for debugging
    });
  });
  
  return links;
}

// Function to make a full URL from a relative URL
function makeFullUrl(href) {
  if (href.startsWith('http')) {
    return href;
  } else if (href.startsWith('/')) {
    return `https://www.accessdata.fda.gov${href}`;
  } else {
    return `https://www.accessdata.fda.gov/${href}`;
  }
}

// Function to determine the type of link
function determineType(text, href) {
  text = text.toLowerCase();
  href = href.toLowerCase();
  
  if (text.includes('approval') || text.includes('approv')) {
    return 'Approval Letter';
  } else if (text.includes('review') || href.includes('review')) {
    if (text.includes('chemistry') || href.includes('chemr')) {
      return 'Chemistry Review';
    } else if (text.includes('clinical') || href.includes('clinicalr')) {
      return 'Clinical Review';
    } else if (text.includes('pharm') || href.includes('pharmr')) {
      return 'Pharmacology Review';
    } else if (text.includes('biopharm') || href.includes('biopharmr')) {
      return 'Biopharmaceutics Review';
    } else if (text.includes('micro') || href.includes('micror')) {
      return 'Microbiology Review';
    } else if (text.includes('statistical') || href.includes('statr')) {
      return 'Statistical Review';
    } else if (text.includes('medical') || href.includes('medr')) {
      return 'Medical Review';
    } else {
      return 'Review';
    }
  } else if (text.includes('label') || href.includes('label') || href.includes('lbl')) {
    if (text.includes('printed')) {
      return 'Printed Label';
    } else {
      return 'Label';
    }
  } else if (text.includes('letter') || href.includes('letter') || href.includes('ltr')) {
    return 'Letter';
  } else if (text.includes('correspondence') || href.includes('corres')) {
    return 'Correspondence';
  } else if (text.includes('admin') || href.includes('admin')) {
    return 'Administrative Document';
  } else {
    return 'Other';
  }
}

// Function to standardize type based on category, title and URL
function standardizeType(category, title, url) {
  const combinedText = (category + ' ' + title + ' ' + url).toLowerCase();
  
  // Map of key terms to standardized document types
  const typeMapping = [
    { terms: ['approval letter', 'approv'], type: 'Approval Letter' },
    { terms: ['chemistry review', 'chemr'], type: 'Chemistry Review' },
    { terms: ['clinical pharm', 'biopharm'], type: 'Clinical Pharmacology Biopharmaceutics Review' },
    { terms: ['micro review', 'microbiology'], type: 'Microbiology Review' },
    { terms: ['printed label', 'print lbl'], type: 'Printed Labeling' },
    { terms: ['label review', 'labeling review'], type: 'Labeling Reviews' },
    { terms: ['administrative', 'admin', 'correspondence', 'corres'], type: 'Administrative Document & Correspondence' },
    { terms: ['statistical review', 'stats'], type: 'Statistical Review' },
    { terms: ['medical review', 'medr'], type: 'Medical Review' },
    { terms: ['pharmacology', 'toxicology'], type: 'Pharmacology Review' },
    { terms: ['letter'], type: 'Letter' }
  ];
  
  // Find the first matching type
  for (const mapping of typeMapping) {
    if (mapping.terms.some(term => combinedText.includes(term))) {
      return mapping.type;
    }
  }
  
  // Default types based on partial matches
  if (combinedText.includes('review')) {
    return 'Review';
  } else if (combinedText.includes('label')) {
    return 'Label';
  }
  
  return 'Other';
}

// Function to validate URLs before adding them to the results
async function validateUrl(url) {
  try {
    const response = await axios.head(url, {
      httpsAgent,
      timeout: 5000
    });
    return response.status >= 200 && response.status < 400;
  } catch (error) {
    console.error(`URL validation failed for ${url}: ${error.message}`);
    return false;
  }
}

// app.get('/api/fda/drug/:drugName', async (req, res) => {
//   console.log("194")
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
      
//       // Improved approval date extraction logic
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

//       for (const product of products) {
//         if (!product.brand_name) continue;
        
//         const brandName = product.brand_name.toLowerCase();
//         const activeIngredients = product.active_ingredients || [];
//         const strength = activeIngredients.map(ing => `${ing.name} ${ing.strength}`).join(', ') || 'Unknown';
        
//         if (!categorizedDrugs[brandName]) categorizedDrugs[brandName] = {};
//         if (!categorizedDrugs[brandName][strength]) categorizedDrugs[brandName][strength] = [];
        
//         // Instead of constructing links here, we'll indicate they should be fetched on demand
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
//           // Just store a flag to indicate we need to get documents for this application
//           hasDocuments: true,
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


app.get('/api/fda/drug/:drugName', async (req, res) => {
  console.log("Fetching comprehensive FDA drug data");
  const { drugName } = req.params;
  const searchType = req.query.type || 'brand';

  try {
    // Initialize result structure
    const results = { 
      endpoints: {}, 
      combinedResults: []
    };

    // Define all FDA drug endpoints we'll query
    const endpoints = {
      drugsFda: "https://api.fda.gov/drug/drugsfda.json",
      label: "https://api.fda.gov/drug/label.json",
      ndc: "https://api.fda.gov/drug/ndc.json",
      enforcement: "https://api.fda.gov/drug/enforcement.json",
      event: "https://api.fda.gov/drug/event.json"
    };

    // Define search variations based on the drug name
    const searchVariations = [
      `*${drugName}*`,
      // You can add variations here like manufacturer names if needed
    ];

    // Process each endpoint
    for (const [endpointName, baseUrl] of Object.entries(endpoints)) {
      let endpointSuccess = false;
      
      // Try each search variation
      for (const variation of searchVariations) {
        if (endpointSuccess) continue; // Skip if we already have data
        
        try {
          // Build search query based on endpoint
          let searchQuery;
          
          switch (endpointName) {
            case "drugsFda":
              searchQuery = `search=openfda.brand_name:"${variation}"+OR+openfda.generic_name:"${variation}"+OR+sponsor_name:"${variation}"`;
              break;
            case "label":
              searchQuery = `search=openfda.brand_name:"${variation}"+OR+openfda.generic_name:"${variation}"+OR+openfda.manufacturer_name:"${variation}"`;
              break;
            case "ndc":
              searchQuery = `search=brand_name:"${variation}"+OR+generic_name:"${variation}"+OR+labeler_name:"${variation}"`;
              break;
            case "enforcement":
              searchQuery = `search=product_description:"${variation}"`;
              break;
            case "event":
              searchQuery = `search=patient.drug.medicinalproduct:"${variation}"+OR+patient.drug.openfda.brand_name:"${variation}"+OR+patient.drug.openfda.generic_name:"${variation}"`;
              break;
            default:
              searchQuery = `search=${variation}`;
          }
          
          // Make the API request with increased limit
          const url = `${baseUrl}?${searchQuery}&limit=100`;
          console.log(`Trying FDA ${endpointName} with search term: ${variation}`);
          
          const response = await axios.get(url, { timeout: 15000 });
          
          if (response.data && response.data.results && Array.isArray(response.data.results) && response.data.results.length > 0) {
            console.log(`Success! Found FDA data from ${endpointName} for ${variation}`);
            results.endpoints[endpointName] = {
              status: "success",
              count: response.data.results.length,
              data: response.data.results,
              searchTerm: variation
            };
            
            // Process the results based on endpoint type
            const processedResults = processEndpointResults(endpointName, response.data.results, variation);
            results.combinedResults = [...results.combinedResults, ...processedResults];
            
            endpointSuccess = true;
            break; // Exit the variations loop for this endpoint
          }
        } catch (error) {
          console.warn(`Failed FDA ${endpointName} request for ${variation}: ${error.message}`);
        }
      }
      
      // If no success with any variation, record the failure
      if (!endpointSuccess) {
        results.endpoints[endpointName] = {
          status: "error",
          error: "No data found across all search variations",
          statusCode: "404",
          data: []
        };
      }
    }
    
    // If no results found across all endpoints, add placeholder data
    if (results.combinedResults.length === 0) {
      results.combinedResults = [{
        source: "placeholder",
        name: drugName,
        description: `No FDA data found for ${drugName} across all endpoints`,
        date: "Unknown",
        status: "Unknown"
      }];
    }

    // Process drugsFda data into categorized format (as in your original code)
    const categorizedDrugs = {};
    
    if (results.endpoints.drugsFda && results.endpoints.drugsFda.status === "success") {
      for (const drug of results.endpoints.drugsFda.data) {
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
        
        for (const product of products) {
          if (!product.brand_name) continue;
          
          const brandName = product.brand_name.toLowerCase();
          const activeIngredients = product.active_ingredients || [];
          const strength = activeIngredients.map(ing => `${ing.name} ${ing.strength}`).join(', ') || 'Unknown';
          
          if (!categorizedDrugs[brandName]) categorizedDrugs[brandName] = {};
          if (!categorizedDrugs[brandName][strength]) categorizedDrugs[brandName][strength] = [];
          
          categorizedDrugs[brandName][strength].push({
            brandName: product.brand_name,
            applicationNumber: appNumber,
            approvalDate,
            submissions: submissions.map(s => ({
              submissionNumber: s.submission_number,
              status: s.submission_status,
              date: s.submission_status_date,
              type: s.submission_type
            })),
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
    }

    // Return both the raw endpoint results and the categorized drugs
    res.json({
      raw: results,
      categorized: categorizedDrugs
    });

  } catch (error) {
    console.error('Error fetching FDA drug data:', error);
    res.status(500).json({ 
      error: 'Error fetching drug data',
      message: error.message 
    });
  }
});

app.get('/api/fda/condition/:conditionName', async (req, res) => {
  console.log("Fetching FDA drug data by condition");
  const { conditionName } = req.params;

  try {
    // Initialize result structure
    const results = { 
      endpoints: {}, 
      combinedResults: []
    };

    // Define FDA endpoints (focus on 'label' first, others optional)
    const endpoints = {
      label: "https://api.fda.gov/drug/label.json",
      drugsFda: "https://api.fda.gov/drug/drugsfda.json" // Optional for additional details
    };

    // Process the 'label' endpoint first to get drugs by condition
    const labelBaseUrl = endpoints.label;
    const conditionSearchQuery = `search=indications_and_usage:"${conditionName}"`;
    const labelUrl = `${labelBaseUrl}?${conditionSearchQuery}&limit=100`;
    console.log(`Trying FDA label endpoint with condition: ${conditionName}`);

    const labelResponse = await axios.get(labelUrl, { timeout: 15000 });

    if (labelResponse.data && labelResponse.data.results && labelResponse.data.results.length > 0) {
      console.log(`Success! Found ${labelResponse.data.results.length} drugs for ${conditionName}`);
      results.endpoints.label = {
        status: "success",
        count: labelResponse.data.results.length,
        data: labelResponse.data.results,
        searchTerm: conditionName
      };

      // Extract drug names and details from label endpoint
      const drugs = labelResponse.data.results.map(result => ({
        brandName: result.openfda?.brand_name?.[0] || "Unknown",
        genericName: result.openfda?.generic_name?.[0] || "Unknown",
        indications: result.indications_and_usage?.[0] || "No indication details",
        manufacturer: result.openfda?.manufacturer_name?.[0] || result.sponsor_name || "Unknown"
      }));
      results.combinedResults = drugs;

      // Optionally fetch additional details from drugsFda using drug names
      if (endpoints.drugsFda) {
        const drugNames = drugs.map(d => d.brandName).filter(Boolean);
        for (const drugName of drugNames) {
          const drugSearchQuery = `search=openfda.brand_name:"${drugName}"`;
          const drugsFdaUrl = `${endpoints.drugsFda}?${drugSearchQuery}&limit=10`;
          try {
            const drugsFdaResponse = await axios.get(drugsFdaUrl, { timeout: 15000 });
            if (drugsFdaResponse.data && drugsFdaResponse.data.results) {
              results.endpoints.drugsFda = results.endpoints.drugsFda || { status: "success", data: [] };
              results.endpoints.drugsFda.data.push(...drugsFdaResponse.data.results);

              // Process drugsFda data into categorized format (from your original code)
              const categorizedDrugs = {};
              for (const drug of drugsFdaResponse.data.results) {
                const appNumber = drug.application_number;
                const products = drug.products || [];
                let approvalDate = "Unknown";
                const submissions = drug.submissions || [];
                const approval = submissions.find(s => s.submission_status === "AP" || s.submission_status === "Approved");
                if (approval) approvalDate = approval.submission_status_date;

                for (const product of products) {
                  if (!product.brand_name) continue;
                  const brandName = product.brand_name.toLowerCase();
                  const strength = product.active_ingredients?.map(ing => `${ing.name} ${ing.strength}`).join(", ") || "Unknown";
                  if (!categorizedDrugs[brandName]) categorizedDrugs[brandName] = {};
                  if (!categorizedDrugs[brandName][strength]) categorizedDrugs[brandName][strength] = [];

                  categorizedDrugs[brandName][strength].push({
                    brandName: product.brand_name,
                    applicationNumber: appNumber,
                    approvalDate,
                    fdaPage: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appNumber.replace(/[^0-9]/g, '')}`,
                    sponsorName: drug.sponsor_name,
                    dosageForm: product.dosage_form,
                    route: product.route,
                    marketingStatus: product.marketing_status
                  });
                }
              }
              results.categorized = categorizedDrugs;
            }
          } catch (error) {
            console.warn(`Failed to fetch drugsFda data for ${drugName}: ${error.message}`);
          }
        }
      }
    } else {
      results.endpoints.label = {
        status: "error",
        error: `No drugs found for condition ${conditionName}`,
        statusCode: "404",
        data: []
      };
      results.combinedResults = [{
        source: "placeholder",
        condition: conditionName,
        description: `No FDA data found for condition ${conditionName}`,
      }];
    }

    // Return the results
    res.json({
      raw: results,
      categorized: results.categorized || {}
    });

  } catch (error) {
    console.error(`Error fetching FDA data for condition ${conditionName}:`, error);
    res.status(500).json({ 
      error: "Error fetching condition data",
      message: error.message 
    });
  }
});

// Helper function to process results from different endpoints
function processEndpointResults(endpointName, results, searchTerm) {
  const processed = [];
  
  switch (endpointName) {
    case "drugsFda":
      // Process drug application data
      results.forEach(drug => {
        const products = drug.products || [];
        
        products.forEach(product => {
          processed.push({
            source: "drugsFda",
            type: "application",
            name: product.brand_name || drug.application_number,
            applicationNumber: drug.application_number,
            sponsorName: drug.sponsor_name,
            approvalType: drug.application_type,
            productType: product.dosage_form,
            status: product.marketing_status,
            description: `${product.brand_name || 'Unknown'} (${product.dosage_form || 'Unknown Dosage Form'})`
          });
        });
      });
      break;
      
    case "label":
      // Process drug labeling information
      results.forEach(label => {
        const brandName = label.openfda?.brand_name?.[0] || 'Unknown';
        const genericName = label.openfda?.generic_name?.[0] || 'Unknown';
        
        processed.push({
          source: "label",
          type: "label",
          name: brandName,
          genericName: genericName,
          manufacturerName: label.openfda?.manufacturer_name?.[0] || 'Unknown',
          description: label.indications_and_usage?.[0] || 'No indication information',
          warnings: label.warnings?.[0] || 'No warnings information',
          adverseReactions: label.adverse_reactions?.[0] || 'No adverse reactions information',
          dosageAdministration: label.dosage_and_administration?.[0] || 'No dosage information'
        });
      });
      break;
      
    case "ndc":
      // Process National Drug Code information
      results.forEach(ndc => {
        processed.push({
          source: "ndc",
          type: "product",
          name: ndc.brand_name || ndc.generic_name || 'Unknown',
          ndcCode: ndc.product_ndc,
          genericName: ndc.generic_name || 'Unknown',
          dosageForm: ndc.dosage_form,
          routeOfAdmin: ndc.route?.[0] || 'Unknown',
          packageDescription: ndc.packaging?.[0]?.description || 'No packaging information',
          labelerName: ndc.labeler_name,
          productType: ndc.product_type,
          description: `${ndc.brand_name || ndc.generic_name || 'Unknown'} (${ndc.dosage_form || 'Unknown Form'})`
        });
      });
      break;
      
    case "enforcement":
      // Process enforcement reports (recalls)
      results.forEach(report => {
        processed.push({
          source: "enforcement",
          type: "recall",
          name: report.openfda?.brand_name?.[0] || report.product_description || 'Unknown',
          recallNumber: report.recall_number,
          recallInitiationDate: report.recall_initiation_date,
          recallReason: report.reason_for_recall,
          status: report.status,
          classification: report.classification,
          description: report.product_description || 'No product description'
        });
      });
      break;
      
    case "event":
      // Process adverse event reports
      results.forEach(event => {
        // Find the drug matching our search term in the report
        const drugReports = event.patient?.drug || [];
        const relevantDrugs = drugReports.filter(drug => 
          (drug.medicinalproduct || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
          (drug.openfda?.brand_name?.[0] || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
          (drug.openfda?.generic_name?.[0] || '').toLowerCase().includes(searchTerm.toLowerCase())
        );
        
        if (relevantDrugs.length > 0) {
          const drug = relevantDrugs[0]; // Use the first matching drug
          
          processed.push({
            source: "event",
            type: "adverseEvent",
            name: drug.medicinalproduct || drug.openfda?.brand_name?.[0] || 'Unknown',
            genericName: drug.openfda?.generic_name?.[0] || 'Unknown',
            reportDate: event.receiptdate,
            seriousOutcomes: event.serious ? 'Yes' : 'No',
            reactions: event.patient?.reaction?.map(r => r.reactionmeddrapt || 'Unknown reaction').join(', ') || 'No reactions reported',
            description: `Adverse event report for ${drug.medicinalproduct || drug.openfda?.brand_name?.[0] || 'Unknown drug'}`
          });
        }
      });
      break;
      
    default:
      // Generic processing for other endpoints
      results.forEach(result => {
        processed.push({
          source: endpointName,
          name: result.openfda?.brand_name?.[0] || result.brand_name || result.generic_name || 'Unknown',
          description: `Data from ${endpointName} endpoint`,
          raw: result
        });
      });
  }
  
  return processed;
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

/**
 * DailyMed API search endpoint
 * 
 * This endpoint searches for drug information from the DailyMed API
 * based on a drug name provided in the URL parameter
 */

/**
 * DailyMed API search endpoint
 * 
 * This endpoint searches for drug information from the DailyMed API
 * based on a drug name provided in the URL parameter
 */

/**
 * Enhanced DailyMed API search endpoint
 * 
 * This endpoint searches for drug information from the DailyMed API
 * and formats it properly for the frontend display
 */

/**
 * DailyMed API search endpoint
 * 
 * This endpoint searches for drug information from the DailyMed API
 * and formats it properly for the frontend display
 */

// Add the DailyMed route
// app.get('/api/fda/dailymed/:drugName', handleDailyMedRequest);


// Drug API route
app.get('/api/fda/dailymed', async (req, res) => {
  const drugName = req.query.name;
  
  if (!drugName) {
    return res.status(400).json({ error: 'Drug name is required' });
  }
  
  try {
    const drugsData = await getAllDrugDataByName(drugName);
    
    if (drugsData && drugsData.length > 0) {
      return res.status(200).json(drugsData);
    } else {
      return res.status(404).json({ error: `No data found for drug: ${drugName}` });
    }
  } catch (error) {
    console.error(`Error processing request for ${drugName}:`, error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Main function to get all drug data by name
async function getAllDrugDataByName(drugName) {
  try {
    // Step 1: Search for the drug to get all SPL IDs
    const splIds = await searchAndGetAllSplIds(drugName);
    
    if (!splIds || splIds.length === 0) {
      console.error(`No results found for drug name: ${drugName}`);
      return [];
    }
    
    console.log(`Found ${splIds.length} SPL IDs for ${drugName}`);
    
    // Step 2: Get detailed data for each SPL ID
    const drugsDataPromises = splIds.map(splId => getDrugDataById(splId));
    const drugsData = await Promise.all(drugsDataPromises);
    
    // Filter out any null results
    return drugsData.filter(data => data !== null);
    
  } catch (error) {
    console.error(`Error getting data for ${drugName}:`, error);
    throw error;
  }
}

// Function to search DailyMed and return all matching SPL IDs
function searchAndGetAllSplIds(drugName) {
  return new Promise((resolve, reject) => {
    const encodedQuery = encodeURIComponent(drugName);
    const requestUrl = `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.xml?drug_name=${encodedQuery}`;
    
    https.get(requestUrl, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP error! Status: ${response.statusCode}`));
        return;
      }
      
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        try {
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(data, "text/xml");
          
          // Get all SPL IDs from the search results
          const splElements = xmlDoc.getElementsByTagName('setid');
          const splIds = [];
          
          for (let i = 0; i < splElements.length; i++) {
            const splId = splElements[i].textContent.trim();
            if (splId) {
              splIds.push(splId);
            }
          }
          
          resolve(splIds);
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

// Function to get detailed drug data using SPL ID
function getDrugDataById(splId) {
  return new Promise((resolve, reject) => {
    const requestUrl = `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${splId}.xml`;
    
    https.get(requestUrl, (response) => {
      if (response.statusCode !== 200) {
        console.warn(`HTTP error for SPL ID ${splId}! Status: ${response.statusCode}`);
        resolve(null); // Don't reject, just return null for this ID
        return;
      }
      
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        try {
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(data, "text/xml");
          
          // Extract the relevant information
          const drugInfo = extractDrugInfo(xmlDoc, splId);
          resolve(drugInfo);
        } catch (error) {
          console.warn(`Error parsing data for SPL ID ${splId}:`, error);
          resolve(null); // Don't reject, just return null for this ID
        }
      });
    }).on('error', (error) => {
      console.warn(`Network error for SPL ID ${splId}:`, error);
      resolve(null); // Don't reject, just return null for this ID
    });
  });
}

// Function to extract drug information from the XML document
function extractDrugInfo(xmlDoc, splId) {
  try {
    // Helper function to safely get text content
    const getTextContent = (element) => {
      if (!element) return null;
      return element.textContent.trim();
    };
    
    // Helper function to get all matching elements and extract their text content
    const getAllTextContent = (elements) => {
      const result = [];
      for (let i = 0; i < elements.length; i++) {
        const text = elements[i].textContent.trim();
        if (text) result.push(text);
      }
      return result;
    };
    
    // Extract basic information
    const titleElements = xmlDoc.getElementsByTagName('title');
    let title = "Unknown";
    
    // Look for the document title, which is typically one of the first title elements
    for (let i = 0; i < Math.min(5, titleElements.length); i++) {
      const text = getTextContent(titleElements[i]);
      if (text && text.length > 10) { // Assuming a meaningful title has at least 10 chars
        title = text;
        break;
      }
    }
    
    // Try to get more specific product name
    const productNameElements = xmlDoc.getElementsByTagName('name');
    let productName = null;
    
    for (let i = 0; i < productNameElements.length; i++) {
      const parent = productNameElements[i].parentNode;
      if (parent && (parent.nodeName === 'manufacturedProduct' || parent.nodeName === 'product')) {
        productName = getTextContent(productNameElements[i]);
        if (productName) break;
      }
    }
    
    if (!productName) {
      for (let i = 0; i < Math.min(3, productNameElements.length); i++) {
        productName = getTextContent(productNameElements[i]);
        if (productName) break;
      }
    }
    
    // Extract manufacturer (may be in different places in the XML)
    let manufacturer = null;
    const manufacturerOrgElements = xmlDoc.getElementsByTagName('manufacturerOrganization');
    for (let i = 0; i < manufacturerOrgElements.length; i++) {
      const nameElement = manufacturerOrgElements[i].getElementsByTagName('name')[0];
      if (nameElement) {
        manufacturer = getTextContent(nameElement);
        break;
      }
    }
    
    // If no manufacturer found, try alternative approach
    if (!manufacturer) {
      const orgElements = xmlDoc.getElementsByTagName('organization');
      for (let i = 0; i < orgElements.length; i++) {
        const nameElement = orgElements[i].getElementsByTagName('name')[0];
        if (nameElement) {
          manufacturer = getTextContent(nameElement);
          break;
        }
      }
    }
    
    // Extract active ingredients
    const ingredientElements = xmlDoc.getElementsByTagName('ingredient');
    const activeIngredients = [];
    
    for (let i = 0; i < ingredientElements.length; i++) {
      const ingredient = ingredientElements[i];
      const classCode = ingredient.getAttribute('classCode');
      
      if (classCode === 'ACTIB' || classCode === 'ACTIM') {
        const substanceElements = ingredient.getElementsByTagName('ingredientSubstance');
        if (substanceElements.length > 0) {
          const nameElement = substanceElements[0].getElementsByTagName('name')[0];
          if (nameElement) {
            activeIngredients.push(getTextContent(nameElement));
          }
        }
      }
    }
    
    // Extract dosage forms
    const formCodeElements = xmlDoc.getElementsByTagName('formCode');
    const dosageForms = [];
    
    for (let i = 0; i < formCodeElements.length; i++) {
      const displayName = formCodeElements[i].getAttribute('displayName');
      if (displayName && !dosageForms.includes(displayName)) {
        dosageForms.push(displayName);
      }
    }
    
    // Extract sections
    const sectionElements = xmlDoc.getElementsByTagName('section');
    let indications = "Not specified";
    let warnings = "Not specified";
    let dosage = "Not specified";
    let contraindications = "Not specified";
    let adverseReactions = "Not specified";
    let drugInteractions = "Not specified";
    
    for (let i = 0; i < sectionElements.length; i++) {
      const section = sectionElements[i];
      const titleElement = section.getElementsByTagName('title')[0];
      
      if (!titleElement) continue;
      
      const title = getTextContent(titleElement);
      const textElement = section.getElementsByTagName('text')[0];
      
      if (!textElement) continue;
      
      const text = getTextContent(textElement);
      
      if (title && text) {
        if (title.includes('INDICATIONS AND USAGE') || title.includes('USES')) {
          indications = text;
        } else if (title.includes('WARNINGS') || title.includes('BOXED WARNING')) {
          warnings = text;
        } else if (title.includes('DOSAGE AND ADMINISTRATION') || title.includes('DOSAGE')) {
          dosage = text;
        } else if (title.includes('CONTRAINDICATIONS')) {
          contraindications = text;
        } else if (title.includes('ADVERSE REACTIONS') || title.includes('SIDE EFFECTS')) {
          adverseReactions = text;
        } else if (title.includes('DRUG INTERACTIONS')) {
          drugInteractions = text;
        }
      }
    }
    
    // Extract document effective time (when the label was approved/updated)
    const effectiveTimeElements = xmlDoc.getElementsByTagName('effectiveTime');
    let effectiveTime = null;
    
    for (let i = 0; i < effectiveTimeElements.length; i++) {
      const valueElement = effectiveTimeElements[i].getAttribute('value');
      if (valueElement) {
        // Format YYYYMMDD to YYYY-MM-DD
        if (valueElement.length === 8) {
          effectiveTime = `${valueElement.substring(0, 4)}-${valueElement.substring(4, 6)}-${valueElement.substring(6, 8)}`;
          break;
        } else {
          effectiveTime = valueElement;
          break;
        }
      }
    }
    
    // Return structured data
    return {
      splId: splId,
      title: title,
      productName: productName || title,
      manufacturer: manufacturer || "Unknown",
      activeIngredients: activeIngredients.length > 0 ? activeIngredients : ["Unknown"],
      dosageForms: dosageForms.length > 0 ? dosageForms : ["Unknown"],
      indications: indications,
      warnings: warnings,
      dosage: dosage,
      contraindications: contraindications,
      adverseReactions: adverseReactions,
      drugInteractions: drugInteractions,
      effectiveTime: effectiveTime || "Unknown",
      labelUrl: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${splId}`
    };
  } catch (error) {
    console.error("Error extracting drug info:", error);
    return {
      splId: splId,
      error: "Failed to extract complete information"
    };
  }
}





// app.get('/api/fda/dailymed/:drug', async (req, res) => {
//   try {
//     const drugName = req.params.drug;
    
//     // Base URL for DailyMed API
//     const baseUrl = 'https://dailymed.nlm.nih.gov/dailymed/services/v2';
    
//     console.log(`[DailyMed] Searching for: ${drugName}`);
    
//     // Search for drug by name - explicitly request JSON format
//     const searchUrl = `${baseUrl}/drugnames.json?drug_name=${encodeURIComponent(drugName)}`;
    
//     const response = await fetch(searchUrl);
    
//     if (!response.ok) {
//       console.error(`[DailyMed] API error: ${response.status}`);
//       return res.json({ 
//         label_info: [] 
//       });
//     }
    
//     const data = await response.json();
//     console.log(`[DailyMed] Found ${data.data?.length || 0} results`);
    
//     // If no results found
//     if (!data.data || data.data.length === 0) {
//       return res.json({ 
//         label_info: [] 
//       });
//     }
    
//     // Transform the data to match frontend expectations
//     const labelInfo = [];
//     const processedSetIds = new Set(); // Track unique setIds to avoid duplicates
    
//     for (const drugInfo of data.data) {
//       // Skip if no setid or we've already processed this setId
//       if (!drugInfo.setid || processedSetIds.has(drugInfo.setid)) {
//         continue;
//       }
      
//       processedSetIds.add(drugInfo.setid);
      
//       // Create an entry with drug search information
//       const entry = {
//         title: drugInfo.drug_name || "Unknown Drug",
//         published: "N/A",
//         setId: drugInfo.setid,
//         // Use the correct URL format for direct link to drug info
//         labelUrl: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${drugInfo.setid}`,
//         // Add direct PDF download link
//         pdfUrl: `https://dailymed.nlm.nih.gov/dailymed/downloadpdffile.cfm?setId=${drugInfo.setid}`
//       };
      
//       // Add to our results
//       labelInfo.push(entry);
//     }
    
//     // Return the data in the format expected by the frontend
//     console.log(`[DailyMed] Returning ${labelInfo.length} formatted results`);
//     return res.json({
//       label_info: labelInfo
//     });
    
//   } catch (error) {
//     console.error('[DailyMed] Error:', error);
//     return res.json({ 
//       label_info: [],
//       error: true,
//       message: error.message
//     });
//   }
// });

// Optional: Additional endpoint to get all available information for a drug by setId
app.get('/api/fda/dailymed/details/:setId', async (req, res) => {
  try {
    const setId = req.params.setId;
    const baseUrl = 'https://dailymed.nlm.nih.gov/dailymed/services/v2';
    
    // Get detailed SPL information
    const splUrl = `${baseUrl}/spls/${setId}.json`;
    const splResponse = await fetch(splUrl);
    
    if (!splResponse.ok) {
      throw new Error(`DailyMed API returned status: ${splResponse.status}`);
    }
    
    const splData = await splResponse.json();
    
    // Get NDC codes
    const ndcUrl = `${baseUrl}/spls/${setId}/ndcs.json`;
    const ndcResponse = await fetch(ndcUrl);
    const ndcData = ndcResponse.ok ? await ndcResponse.json() : { data: [] };
    
    // Get packaging information
    const packagingUrl = `${baseUrl}/spls/${setId}/packaging.json`;
    const packagingResponse = await fetch(packagingUrl);
    const packagingData = packagingResponse.ok ? await packagingResponse.json() : { data: [] };
    
    // Get version history
    const historyUrl = `${baseUrl}/spls/${setId}/history.json`;
    const historyResponse = await fetch(historyUrl);
    const historyData = historyResponse.ok ? await historyResponse.json() : { data: [] };
    
    // Return all collected data
    res.json({
      success: true,
      spl: splData.data,
      ndcs: ndcData.data,
      packaging: packagingData.data,
      history: historyData.data,
      pdfLink: `https://dailymed.nlm.nih.gov/dailymed/downloadpdffile.cfm?setId=${setId}`,
      zipLink: `https://dailymed.nlm.nih.gov/dailymed/downloadzipfile.cfm?setId=${setId}`
    });
    
  } catch (error) {
    console.error('Error fetching detailed drug information:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching detailed drug information',
      error: error.message
    });
  }
});

// app.get('/api/fda/dailymed/:ingredient', async (req, res) => {
//   console.log("497")
//   const { ingredient } = req.params;
  
//   try {
//     // For better results, clean up the ingredient name 
//     // by removing any dosage information or parentheses
//     const cleanIngredient = ingredient
//       .replace(/\s*\(.*?\)\s*/g, '') // Remove parentheses and their content
//       .replace(/\d+\s*mg|\d+\s*mcg|\d+\s*mL/gi, '') // Remove dosages
//       .trim();
    
//     const response = await axios.get(`${DAILYMED_API_URL}/spls.json?ingredient=${encodeURIComponent(cleanIngredient)}`);
//     const data = response.data;
    
//     if (!data.data || data.data.length === 0) {
//       return res.json({ error: 'No DailyMed data found' });
//     }
    
//     const labelInfo = await Promise.all(
//       data.data.slice(0, 5).map(async (label) => {
//         try {
//           // Use proper Accept header to avoid 415 errors
//           const detailsResponse = await axios.get(`${DAILYMED_API_URL}/spls/${label.setid}.json`, {
//             headers: { 
//               'Accept': 'application/json',
//               'Content-Type': 'application/json'
//             }
//           });
//           const details = detailsResponse.data;
          
//           // Format the published date properly
//           let formattedDate = label.published;
//           try {
//             if (label.published) {
//               const pubDate = new Date(label.published);
//               if (!isNaN(pubDate.getTime())) {
//                 // Format as YYYY-MM-DD
//                 formattedDate = pubDate.toISOString().split('T')[0];
//               }
//             }
//           } catch (e) {
//             console.error("Error formatting DailyMed date:", e);
//           }
          
//           return {
//             setId: label.setid,
//             title: details.title || label.title,
//             published: formattedDate,
//             labelUrl: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${label.setid}`,
//             packageUrl: details.packaging_uris?.[0] 
//               ? `https://dailymed.nlm.nih.gov/dailymed/image.cfm?setid=${label.setid}&type=img`
//               : null,
//             activeIngredients: details.active_ingredients || [],
//             ndc: details.package_ndc?.join(', ') || 'N/A',
//             rxcui: details.rxcui || 'N/A',
//             // Add more useful information if available
//             manufacturer: details.labeler || 'N/A',
//             dosageForm: details.dosage_forms_and_strengths || 'N/A'
//           };
//         } catch (error) {
//           console.error(`Error fetching details for label ${label.setid}:`, error.message);
          
//           // Format the published date even when detail fetch fails
//           let formattedDate = label.published;
//           try {
//             if (label.published) {
//               const pubDate = new Date(label.published);
//               if (!isNaN(pubDate.getTime())) {
//                 formattedDate = pubDate.toISOString().split('T')[0];
//               }
//             }
//           } catch (e) {
//             console.error("Error formatting DailyMed date:", e);
//           }
          
//           // Return basic info when detailed fetch fails
//           return {
//             setId: label.setid,
//             title: label.title,
//             published: formattedDate,
//             labelUrl: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${label.setid}`
//           };
//         }
//       })
//     );
    
//     res.json({ label_info: labelInfo });
//   } catch (error) {
//     handleApiError(error, res, 'Error fetching DailyMed data');
//   }
// });



// app.get('/api/fda/orangebook/search', (req, res) => {
//   console.log("849")
//   const { q: query } = req.query;

//   if (!query) {
//     return res.status(400).json({ error: 'Query parameter is required' });
//   }

//   const searchTerm = query.toLowerCase();
//   const results = {
//     products: [],
//     patents: [],
//     exclusivity: []
//   };

//   // Search Products
//   results.products = orangeBookData.products.filter(product =>
//     Object.values(product).some(val =>
//       String(val).toLowerCase().includes(searchTerm)
//     )
//   );

//   // Search Patents
//   results.patents = orangeBookData.patents.filter(patent =>
//     Object.values(patent).some(val =>
//       String(val).toLowerCase().includes(searchTerm)
//     )
//   );

//   // Search Exclusivity
//   results.exclusivity = orangeBookData.exclusivity.filter(exclusivity =>
//     Object.values(exclusivity).some(val =>
//       String(val).toLowerCase().includes(searchTerm)
//     )
//   );

//   res.json({
//     results: {
//       products: results.products.slice(0, 50), // Limit results for performance
//       patents: results.patents.slice(0, 50),
//       exclusivity: results.exclusivity.slice(0, 50)
//     },
//     total: {
//       products: results.products.length,
//       patents: results.patents.length,
//       exclusivity: results.exclusivity.length
//     }
//   });
// });



// app.get('/api/fda/orangebook/search', (req, res) => {
//   console.log("Orange Book search endpoint called");
//   const { q: query } = req.query;
  
//   if (!query) {
//     return res.status(400).json({ error: 'Query parameter is required' });
//   }
  
//   const searchTerm = query.toLowerCase();
//   let results = {
//     products: [],
//     patents: [],
//     exclusivity: []
//   };
  
//   // Step 1: Search Products first
//   results.products = orangeBookData.products.filter(product =>
//     Object.values(product).some(val =>
//       String(val).toLowerCase().includes(searchTerm)
//     )
//   );
  
//   // Step 2: Create a map of Application Number and Product Number combinations
//   const appProductMap = new Set();
  
//   // Add all found products to the map
//   results.products.forEach(product => {
//     if (product.Appl_No && product.Product_No) {
//       appProductMap.add(`${product.Appl_Type}-${product.Appl_No}-${product.Product_No}`);
//     }
//   });
  
//   // Step 3: Find related patents
//   results.patents = orangeBookData.patents.filter(patent => {
//     // First check if the patent data directly matches the search term
//     const directMatch = Object.values(patent).some(val =>
//       String(val).toLowerCase().includes(searchTerm)
//     );
    
//     // Then check if this patent is related to any of our found products
//     const relatedMatch = appProductMap.has(`${patent.Appl_Type}-${patent.Appl_No}-${patent.Product_No}`);
    
//     return directMatch || relatedMatch;
//   });
  
//   // Step 4: Find related exclusivity data
//   results.exclusivity = orangeBookData.exclusivity.filter(exclusivity => {
//     // First check if the exclusivity data directly matches the search term
//     const directMatch = Object.values(exclusivity).some(val =>
//       String(val).toLowerCase().includes(searchTerm)
//     );
    
//     // Then check if this exclusivity is related to any of our found products
//     const relatedMatch = appProductMap.has(`${exclusivity.Appl_Type}-${exclusivity.Appl_No}-${exclusivity.Product_No}`);
    
//     return directMatch || relatedMatch;
//   });
  
//   // Step 5: Enrich products with their related patent and exclusivity information
//   const enrichedProducts = results.products.map(product => {
//     const productKey = `${product.Appl_Type}-${product.Appl_No}-${product.Product_No}`;
    
//     // Find related patents for this product
//     const relatedPatents = results.patents.filter(patent => 
//       `${patent.Appl_Type}-${patent.Appl_No}-${patent.Product_No}` === productKey
//     );
    
//     // Find related exclusivity data for this product
//     const relatedExclusivity = results.exclusivity.filter(exclusivity => 
//       `${exclusivity.Appl_Type}-${exclusivity.Appl_No}-${exclusivity.Product_No}` === productKey
//     );
    
//     return {
//       ...product,
//       related_patents: relatedPatents,
//       related_exclusivity: relatedExclusivity
//     };
//   });
//   console.log(results)
//   // Respond with the enrichsed data
//   res.json({
//     results: {
//       products: enrichedProducts.slice(0, 50), // Limit results for performance but include related data
//       patents: results.patents.slice(0, 50),
//       exclusivity: results.exclusivity.slice(0, 50)
//     },
//     total: {
//       products: results.products.length,
//       patents: results.patents.length,
//       exclusivity: results.exclusivity.length
//     }
//   });
// });

app.get('/api/fda/orangebook/search', (req, res) => {
  console.log("Orange Book search endpoint called");
  const { q: query } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }
  
  const searchTerm = query.toLowerCase();
  let results = {
    products: [],
    patents: [],
    exclusivity: [],
    companies: [] // Add companies to results
  };
  
  // Step 1: Search Products first
  results.products = orangeBookData.products.filter(product =>
    Object.values(product).some(val =>
      String(val).toLowerCase().includes(searchTerm)
    )
  );
  
  // Step 2: Collect unique company names
  const companySet = new Set();
  results.products.forEach(product => {
    if (product.Applicant) { // Adjust field name based on your data structure
      companySet.add(product.Applicant);
    }
  });
  results.companies = Array.from(companySet);
  
  // Step 3: Create a map of Application Number and Product Number combinations
  const appProductMap = new Set();
  results.products.forEach(product => {
    if (product.Appl_No && product.Product_No) {
      appProductMap.add(`${product.Appl_Type}-${product.Appl_No}-${product.Product_No}`);
    }
  });
  
  // Step 4: Find related patents
  results.patents = orangeBookData.patents.filter(patent => {
    const directMatch = Object.values(patent).some(val =>
      String(val).toLowerCase().includes(searchTerm)
    );
    const relatedMatch = appProductMap.has(`${patent.Appl_Type}-${patent.Appl_No}-${patent.Product_No}`);
    return directMatch || relatedMatch;
  });
  
  // Step 5: Find related exclusivity data
  results.exclusivity = orangeBookData.exclusivity.filter(exclusivity => {
    const directMatch = Object.values(exclusivity).some(val =>
      String(val).toLowerCase().includes(searchTerm)
    );
    const relatedMatch = appProductMap.has(`${exclusivity.Appl_Type}-${exclusivity.Appl_No}-${exclusivity.Product_No}`);
    return directMatch || relatedMatch;
  });
  
  // Step 6: Enrich products with their related patent and exclusivity information
  const enrichedProducts = results.products.map(product => {
    const productKey = `${product.Appl_Type}-${product.Appl_No}-${product.Product_No}`;
    
    const relatedPatents = results.patents.filter(patent => 
      `${patent.Appl_Type}-${patent.Appl_No}-${patent.Product_No}` === productKey
    );
    
    const relatedExclusivity = results.exclusivity.filter(exclusivity => 
      `${exclusivity.Appl_Type}-${exclusivity.Appl_No}-${exclusivity.Product_No}` === productKey
    );
    
    return {
      ...product,
      related_patents: relatedPatents,
      related_exclusivity: relatedExclusivity
    };
  });
  
  // Step 7: Respond with enriched data including companies
  res.json({
    results: {
      products: enrichedProducts.slice(0, 50),
      patents: results.patents.slice(0, 50),
      exclusivity: results.exclusivity.slice(0, 50),
      companies: results.companies.slice(0, 50) // Include company names
    },
    total: {
      products: results.products.length,
      patents: results.patents.length,
      exclusivity: results.exclusivity.length,
      companies: results.companies.length
    }
  });
});














//######################################################################################################################################
//#######################################################################################################################################
app.get('/api/drugs/similar/:drugName', async (req, res) => {
  try {
    const { drugName } = req.params;
    console.log(`🔍 Finding similar drugs for: ${drugName}`);
    
    const similarDrugs = await DrugClassification.findSimilarDrugsByName(drugName);
    
    res.json({
      success: true,
      data: similarDrugs
    });
  } catch (error) {
    handleApiError(error, res);
  }
});

/**
 * Endpoint to get FDA guidance related to a drug
 */
app.get('/api/fda/guidance/:drugName', async (req, res) => {
  try {
    const { drugName } = req.params;
    console.log(`🔍 Fetching FDA guidance for: ${drugName}`);
    
    const guidance = await FDAGuidance.searchGuidanceDocuments(drugName);
    res.json({
      success: true,
      data: guidance
    });
  } catch (error) {
    handleApiError(error, res);
  }
});

/**
 * Endpoint to get FDA approval information
 */
app.get('/api/fda/approval/:drugName', async (req, res) => {
  try {
    const { drugName } = req.params;
    console.log(`🔍 Fetching FDA approval info for: ${drugName}`);
    
    const approvalInfo = await FDAApproval.getApprovalInfo(drugName);
    
    res.json({
      success: true,
      data: approvalInfo
    });
  } catch (error) {
    handleApiError(error, res);
  }
});

/**
 * Endpoint to get DailyMed labeling information
 */
// app.get('/api/dailymed/:drugName', async (req, res) => {
//   try {
//     const { drugName } = req.params;
//     console.log(`🔍 Fetching DailyMed info for: ${drugName}`);
    
//     const labelInfo = await DailyMed.getLabelInfo(drugName);
    
//     res.json({
//       success: true,
//       data: labelInfo
//     });
//   } catch (error) {
//     handleApiError(error, res);
//   }
// });

/**
 * Endpoint to get Orange Book patent information
 */
app.get('/api/orangebook/:drugName', async (req, res) => {
  try {
    const { drugName } = req.params;
    console.log(`🔍 Fetching Orange Book info for: ${drugName}`);
    
    const patentInfo = await OrangeBook.getPatentInfo(drugName);
    
    res.json({
      success: true,
      data: patentInfo
    });
  } catch (error) {
    handleApiError(error, res);
  }
});

/**
 * Endpoint to get FDA warning letters
 */
app.get('/api/fda/warnings/:searchTerm', async (req, res) => {
  try {
    const { searchTerm } = req.params;
    console.log(`🔍 Searching FDA warning letters for: ${searchTerm}`);
    
    const warnings = await WarningLetters.searchWarningLetters(searchTerm);
    
    res.json({
      success: true,
      data: warnings
    });
  } catch (error) {
    handleApiError(error, res);
  }
});

// /**
//  * Endpoint to get PubMed publications
//  */
// app.get('/api/pubmed/:drugName', async (req, res) => {
//   try {
//     const { drugName } = req.params;
//     console.log(`🔍 Fetching PubMed publications for: ${drugName}`);
    
//     const publications = await PubMed.searchPublications(drugName);
    
//     res.json({
//       success: true,
//       data: publications
//     });
//   } catch (error) {
//     handleApiError(error, res);
//   }
// });
app.get('/api/pubmed', handlePubMedSearch);
/**
 * Endpoint to calculate treatment effect and variability
 */
app.get('/api/treatment-effect/:drugName', async (req, res) => {
  try {
    const { drugName } = req.params;
    console.log(`🔍 Calculating treatment effect for: ${drugName}`);
    
    const effectData = await TreatmentEffectCalculator.calculateTreatmentEffect(drugName);
    
    res.json({
      success: true,
      data: effectData
    });
  } catch (error) {
    handleApiError(error, res);
  }
});

/**
 * Comprehensive endpoint to get all drug information at once
 */
app.get('/api/drug-complete/:drugName', async (req, res) => {
  try {
    const { drugName } = req.params;
    console.log(`🔍 Fetching comprehensive information for: ${drugName}`);
    
    // Execute all requests in parallel for efficiency
    const [
      similarDrugs,
      guidance,
      approvalInfo,
      labelInfo,
      patentInfo,
      warnings,
      publications,
      treatmentEffect
    ] = await Promise.all([
      DrugClassification.findSimilarDrugsByName(drugName),
      FDAGuidance.searchGuidanceDocuments(drugName),
      FDAApproval.getApprovalInfo(drugName),
      DailyMed.getLabelInfo(drugName),
      OrangeBook.getPatentInfo(drugName),
      WarningLetters.searchWarningLetters(drugName),
      PubMed.searchPublications(drugName),
      TreatmentEffectCalculator.calculateTreatmentEffect(drugName)
    ]);
    
    // Search for clinical trials for this drug
    const trialsResponse = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
      params: {
        'query.intr': drugName,
        'countTotal': true,
        'pageSize': 20,
        'format': 'json'
      }
    });
    
    // Extract clinical trial summaries
    const trials = {
      count: trialsResponse.data.totalCount || 0,
      studies: trialsResponse.data.studies || []
    };
    
    // Combine all data into a comprehensive response
    const completeData = {
      drugName,
      similarDrugs,
      guidance,
      approvalInfo,
      labelInfo,
      patentInfo,
      warnings,
      publications,
      treatmentEffect,
      trials
    };
    
    res.json({
      success: true,
      data: completeData
    });
  } catch (error) {
    handleApiError(error, res);
  }
});


/**
 * Main endpoint to search studies with various parameters
 */
// app.get('/api/studies/search', validatePagination, async (req, res) => {
//   try {
//     const { 
//       query, condition, intervention, status, phase, sponsor, 
//       title, location, patientData, sort, countTotal, fields,
//       advanced
//     } = req.query;
    
//     const { page, pageSize } = req.pagination;
    
//     console.log(`🔍 Searching for studies with query: ${query || 'None specified'}`);
    
//     // Build parameters for API request
//     const params = new URLSearchParams();
    
//     // Add query parameters
//     if (condition) params.append('query.cond', condition);
//     if (intervention) params.append('query.intr', intervention);
//     if (title) params.append('query.titles', title);
//     if (location) params.append('query.locn', location);
//     if (sponsor) params.append('query.spons', sponsor);
//     if (query) params.append('query.term', query);
//     if (patientData) params.append('query.patient', patientData);
    
//     // Add filter parameters
//     if (status) {
//       if (Array.isArray(status)) {
//         params.append('filter.overallStatus', status.join(','));
//       } else {
//         params.append('filter.overallStatus', status);
//       }
//     }
    
//     // Add advanced filter
//     if (advanced) params.append('filter.advanced', advanced);
    
//     // Add pagination
//     params.append('pageSize', pageSize);
//     if (req.query.pageToken) {
//       params.append('pageToken', req.query.pageToken);
//     }
    
//     // Add sorting
//     if (sort) {
//       if (Array.isArray(sort)) {
//         params.append('sort', sort.join(','));
//       } else {
//         params.append('sort', sort);
//       }
//     }
    
//     // Add count total
//     if (countTotal) params.append('countTotal', true);
    
//     // Add fields
//     if (fields) {
//       if (Array.isArray(fields)) {
//         params.append('fields', fields.join(','));
//       } else {
//         params.append('fields', fields);
//       }
//     } else {
//       // Default fields if none specified - comprehensive data
//       params.append('fields', 'protocolSection,derivedSection,hasResults');
//     }
    
//     // Format parameter
//     params.append('format', 'json');
    
//     // Make the API request
//     const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
//       params: params
//     });
    
//     // Format pagination for frontend
//     const totalCount = response.data.totalCount || 0;
//     const totalPages = Math.ceil(totalCount / pageSize);
//     const hasNextPage = !!response.data.nextPageToken;
    
//     const paginationInfo = {
//       currentPage: page,
//       pageSize,
//       totalCount,
//       totalPages,
//       hasNextPage,
//       nextPageToken: response.data.nextPageToken
//     };
    
//     res.json({
//       success: true,
//       data: response.data,
//       pagination: paginationInfo
//     });
//   } catch (error) {
//     handleApiError(error, res);
//   }
// });


// Backend route with enhanced pagination support
app.get('/api/studies/search', validatePagination, async (req, res) => {
  try {
    const {
      query, condition, intervention, status, phase, sponsor,
      title, location, patientData, sort, countTotal, fields,
      advanced, fetchAll
    } = req.query;
    
    const { page, pageSize } = req.pagination;
    
    console.log(`🔍 Searching for studies with query: ${query || 'None specified'}`);
    
    // Build parameters for API request
    const params = new URLSearchParams();
    
    // Add query parameters
    if (condition) params.append('query.cond', condition);
    if (intervention) params.append('query.intr', intervention);
    if (title) params.append('query.titles', title);
    if (location) params.append('query.locn', location);
    if (sponsor) params.append('query.spons', sponsor);
    if (query) params.append('query.term', query);
    if (patientData) params.append('query.patient', patientData);
    
    // Add filter parameters
    if (status) {
      if (Array.isArray(status)) {
        params.append('filter.overallStatus', status.join(','));
      } else {
        params.append('filter.overallStatus', status);
      }
    }
    
    // Add advanced filter
    if (advanced) params.append('filter.advanced', advanced);
    
    // Add pagination
    params.append('pageSize', pageSize);
    if (req.query.pageToken) {
      params.append('pageToken', req.query.pageToken);
    }
    
    // Add sorting
    if (sort) {
      if (Array.isArray(sort)) {
        params.append('sort', sort.join(','));
      } else {
        params.append('sort', sort);
      }
    }
    
    // Add count total
    if (countTotal) params.append('countTotal', true);
    
    // Add fields
    if (fields) {
      if (Array.isArray(fields)) {
        params.append('fields', fields.join(','));
      } else {
        params.append('fields', fields);
      }
    } else {
      // Default fields if none specified - comprehensive data
      params.append('fields', 'protocolSection,derivedSection,hasResults');
    }
    
    // Format parameter
    params.append('format', 'json');
    
    // Check if we need to fetch all studies
    if (fetchAll === 'true') {
      const allStudies = [];
      let currentParams = new URLSearchParams(params.toString());
      let hasMorePages = true;
      let nextPageToken = null;
      
      while (hasMorePages) {
        if (nextPageToken) {
          currentParams.set('pageToken', nextPageToken);
        }
        
        console.log(`Fetching page with token: ${nextPageToken || 'initial'}`);
        
        const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
          params: currentParams
        });
        
        const studies = response.data.studies || [];
        allStudies.push(...studies);
        
        nextPageToken = response.data.nextPageToken;
        hasMorePages = !!nextPageToken;
        
        // Optional: Add delay between requests to prevent rate limiting
        if (hasMorePages) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      return res.json({
        success: true,
        data: {
          studies: allStudies,
          totalCount: allStudies.length
        },
        pagination: {
          currentPage: 1,
          pageSize: allStudies.length,
          totalCount: allStudies.length,
          totalPages: 1,
          hasNextPage: false
        }
      });
    }
    
    // Standard paginated response when fetchAll is not true
    const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
      params: params
    });
    
    // Format pagination for frontend
    const totalCount = response.data.totalCount || 0;
    const totalPages = Math.ceil(totalCount / pageSize);
    const hasNextPage = !!response.data.nextPageToken;
    
    const paginationInfo = {
      currentPage: page,
      pageSize,
      totalCount,
      totalPages,
      hasNextPage,
      nextPageToken: response.data.nextPageToken
    };
    
    res.json({
      success: true,
      data: response.data,
      pagination: paginationInfo
    });
  } catch (error) {
    handleApiError(error, res);
  }
});
/**
 * 
 * Endpoint to get details of a specific study by NCT ID
 */
app.get('/api/studies/:nctId', async (req, res) => {
  try {
    const { nctId } = req.params;
    const { fields } = req.query;
    
    console.log(`🔍 Fetching study details for: ${nctId}`);
    
    // Build parameters
    const params = new URLSearchParams();
    params.append('format', 'json');
    
    // Add specific fields if requested
    if (fields) {
      if (Array.isArray(fields)) {
        params.append('fields', fields.join(','));
      } else {
        params.append('fields', fields);
      }
    }
    
    const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies/${nctId}`, {
      params: params
    });
    // fs.writeFile(
    //   `xxclinical_trial_${nctId}.json`,
    //   JSON.stringify(response.data, null, 2),
    //   (err) => {  // Callback function is required here
    //     if (err) {
    //       console.error('Error saving file:', err);
    //     } else {
    //       console.log(`Data successfully saved to clinical_trial_${nctId}.json`);
    //     }
    //   }
    // );
    // console.log(`Data successfully saved to clinical_trial_${nctId}.json`);
    // console.log(response.data.protocolSection.designModule.enrollmentInfo.count)
    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    handleApiError(error, res);
  }
});

/**
 * Endpoint to get data model metadata
 */
app.get('/api/metadata', async (req, res) => {
  try {
    console.log('🔍 Fetching data model metadata');
    
    const params = new URLSearchParams();
    params.append('includeIndexedOnly', true);
    params.append('includeHistoricOnly', false);
    
    const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies/metadata`, {
      params: params
    });
    
    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    handleApiError(error, res);
  }
});

/**
 * Endpoint to get search areas
 */
app.get('/api/search-areas', async (req, res) => {
  try {
    console.log('🔍 Fetching search areas');
    
    const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies/search-areas`);
    
    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    handleApiError(error, res);
  }
});

/**
 * Endpoint to get enum values
 */
app.get('/api/enums', async (req, res) => {
  try {
    console.log('🔍 Fetching enum values');
    
    const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies/enums`);
    
    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    handleApiError(error, res);
  }
});

/**
 * Endpoint to get field values statistics
 */
app.get('/api/stats/field-values', async (req, res) => {
  try {
    const { types, fields } = req.query;
    console.log('🔍 Fetching field values statistics');
    
    const params = new URLSearchParams();
    
    if (types) {
      if (Array.isArray(types)) {
        params.append('types', types.join(','));
      } else {
        params.append('types', types);
      }
    }
    
    if (fields) {
      if (Array.isArray(fields)) {
        params.append('fields', fields.join(','));
      } else {
        params.append('fields', fields);
      }
    }
    
    const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/stats/field/values`, {
      params: params
    });
    
    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    handleApiError(error, res);
  }
});

/**
 * Endpoint to get field sizes statistics
 */
app.get('/api/stats/field-sizes', async (req, res) => {
  try {
    const { fields } = req.query;
    console.log('🔍 Fetching field sizes statistics');
    
    const params = new URLSearchParams();
    
    if (fields) {
      if (Array.isArray(fields)) {
        params.append('fields', fields.join(','));
      } else {
        params.append('fields', fields);
      }
    }
    
    const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/stats/field/sizes`, {
      params: params
    });
    
    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    handleApiError(error, res);
  }
});

/**
 * Endpoint to get study size statistics
 */
app.get('/api/stats/sizes', async (req, res) => {
  try {
    console.log('🔍 Fetching study size statistics');
    
    const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/stats/size`);
    
    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    handleApiError(error, res);
  }
});

/**
 * Endpoint to get success rates and comparison data
 * (This aggregates data from multiple endpoints to calculate success rates)
 */

// Add to server.js after your existing endpoints

/**
 * Endpoint to get drug comparison data
 */
app.get('/api/drugs/compare/:drugName', async (req, res) => {
  try {
    const { drugName } = req.params;
    
    // Get drug's trial data (using existing API)
    const trialsResponse = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
      params: {
        'query.intr': drugName,
        'countTotal': true,
        'pageSize': 100,
        'format': 'json'
      }
    });
    
    // Get treatment effect information
    const treatmentEffect = await TreatmentEffectCalculator.calculateTreatmentEffect(drugName);
    
    // Merge the data together
    const enhancedData = {
      trials: trialsResponse.data,
      treatmentEffect: treatmentEffect
    };
    
    res.json({
      success: true,
      data: enhancedData
    });
  } catch (error) {
    handleApiError(error, res);
  }
});
  /**
   * Endpoint to find similar drugs based on classifications
   */
  app.get('/api/drugs/similar/:drugName', async (req, res) => {
    try {
      const { drugName } = req.params;
      
      // In a real implementation, this would use a drug classification database
      // For now, return a simplified mock response
      
      // Simplified mapping for common drug classes
      const similarDrugsMap = {
        'olanzapine': ['risperidone', 'quetiapine', 'aripiprazole', 'ziprasidone'],
        'risperidone': ['olanzapine', 'quetiapine', 'aripiprazole', 'paliperidone'],
        'fluoxetine': ['sertraline', 'paroxetine', 'citalopram', 'escitalopram'],
        'metformin': ['sitagliptin', 'glipizide', 'glyburide', 'pioglitazone'],
        'atorvastatin': ['rosuvastatin', 'simvastatin', 'pravastatin', 'lovastatin']
      };
      
      // Find similar drugs
      let similarDrugs = [];
      
      // Try direct match
      if (similarDrugsMap[drugName.toLowerCase()]) {
        similarDrugs = similarDrugsMap[drugName.toLowerCase()].map(drug => ({ drugName: drug }));
      } else {
        // Try partial match
        for (const [key, drugs] of Object.entries(similarDrugsMap)) {
          if (key.includes(drugName.toLowerCase()) || drugName.toLowerCase().includes(key)) {
            similarDrugs = drugs.map(drug => ({ drugName: drug }));
            break;
          }
        }
      }
      
      // If no match, provide generic fallbacks
      if (similarDrugs.length === 0) {
        similarDrugs = [
          { drugName: 'aspirin' },
          { drugName: 'acetaminophen' },
          { drugName: 'ibuprofen' }
        ];
      }
      
      res.json({
        success: true,
        data: similarDrugs
      });
    } catch (error) {
      handleApiError(error, res);
    }
  });

  
  app.get('/api/analysis/success-rates', async (req, res) => {
    try {
      const { condition, intervention, phase } = req.query;
      
      console.log(`🔍 Analyzing success rates for ${condition || intervention || 'all studies'}`);
      
      // Build a query to get completed studies with results
      const completedParams = new URLSearchParams();
      completedParams.append('filter.overallStatus', 'COMPLETED');
      completedParams.append('countTotal', 'true');
      completedParams.append('pageSize', '1'); // Just need the count
      
      // Add condition or intervention filters if provided
      if (condition) completedParams.append('query.cond', condition);
      if (intervention) completedParams.append('query.intr', intervention);
      if (phase) completedParams.append('filter.advanced', `AREA[Phase]${phase}`);
      
      // Get total completed studies
      const completedResponse = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
        params: completedParams
      });
      
      // Build a query to get studies with results
      const withResultsParams = new URLSearchParams();
      withResultsParams.append('filter.overallStatus', 'COMPLETED');
      withResultsParams.append('filter.advanced', 'AREA[HasResults]true');
      withResultsParams.append('countTotal', 'true');
      withResultsParams.append('pageSize', '1'); // Just need the count
      
      // Add condition or intervention filters if provided
      if (condition) withResultsParams.append('query.cond', condition);
      if (intervention) withResultsParams.append('query.intr', intervention);
      if (phase) withResultsParams.append('filter.advanced', `AREA[Phase]${phase}`);
      
      // Get completed studies with results
      const withResultsResponse = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
        params: withResultsParams
      });
      
      // Calculate success rates and other metrics
      const totalCompletedStudies = completedResponse.data.totalCount || 0;
      const totalWithResults = withResultsResponse.data.totalCount || 0;
      const successRate = totalCompletedStudies > 0 ? (totalWithResults / totalCompletedStudies) * 100 : 0;
      
      // Get treatment effect data if an intervention is specified
      let treatmentEffect = null;
      if (intervention) {
        treatmentEffect = await TreatmentEffectCalculator.calculateTreatmentEffect(intervention);
      }
      
      // Get FDA guidance if condition or intervention is specified
      let guidance = null;
      if (condition || intervention) {
        guidance = await FDAGuidance.searchGuidanceDocuments(condition || intervention);
      }
      
      // Now get enrollment statistics for these studies
      const enrollmentParams = new URLSearchParams();
      enrollmentParams.append('fields', 'EnrollmentCount');
      enrollmentParams.append('types', 'INTEGER');
      
      const enrollmentResponse = await axios.get(`${CLINICAL_TRIALS_API_BASE}/stats/field/values`, {
        params: enrollmentParams
      });
      
      // Format the response
      res.json({
        success: true,
        data: {
          overview: {
            totalCompletedStudies,
            totalWithResults,
            successRate: successRate.toFixed(2),
            filter: {
              condition,
              intervention,
              phase
            }
          },
          enrollmentStats: enrollmentResponse.data,
          treatmentEffect: treatmentEffect,
          guidance: guidance
        }
      });
    } catch (error) {
      handleApiError(error, res);
    }
  });

// Catch-all route to serve the SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'final.html'));
});


// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Logs are being saved to ${logDirectory}`);
  console.log(`📄 API Documentation:`);
  console.log(`   - GET /api/studies/search - Search studies with various parameters`);
  console.log(`   - GET /api/studies/:nctId - Get specific study details`);
  console.log(`   - GET /api/metadata - Get data model metadata`);
  console.log(`   - GET /api/search-areas - Get search areas`);
  console.log(`   - GET /api/enums - Get enum values`);
  console.log(`   - GET /api/stats/field-values - Get field values statistics`);
  console.log(`   - GET /api/stats/field-sizes - Get field sizes statistics`);
  console.log(`   - GET /api/stats/sizes - Get study size statistics`);
  console.log(`   - GET /api/analysis/success-rates - Get success rates and comparison data`);
  loadOrangeBookData()
});

// Export for testing
module.exports = app;