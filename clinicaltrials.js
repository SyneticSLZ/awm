// server.js - Updated for ClinicalTrials.gov API v2
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Papa = require('papaparse');
const { DOMParser } = require('xmldom');
const morgan = require('morgan');
const path = require('path');
const Bottleneck = require('bottleneck');
const fs = require('fs');
const DataIntegration = require('./data-integration');
const emaRoutes = require('./ema-routes');
const cheerio = require('cheerio');
const https = require('https');
const fsextra = require('fs-extra');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const handlebars = require('handlebars');
const sharp = require('sharp');
const { fromPath } = require('pdf2pic');
const csv = require('csv-parser');
const { handlePubMedSearch } = require('./pubmed.js');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
// const { handleDailyMedRequest } = require('./dailymed.js'); // Path to where you saved the code
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const { OpenAI } = require('openai');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { connectDB } = require('./db');
const { User } = require('./db');
const { Lead } = require('./db');
const pubmedRoutes = require('./pubmed-routes.js');
const biomarkerRoutes = require('./bioserver.js');
const dotenv = require('dotenv')
const { UserSession } = require('./db');

const { router: drugWatchRouter, initializeDrugWatchService } = require('./watch.js');




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
const emailuser = process.env.smtppassword
const emailhost = process.env.smtphost

require('dotenv').config();
// Add this at the beginning of your server.js file, after the initial require statements 
// but before defining the Express app

// Security middleware to block malicious requests
const securityMiddleware = (req, res, next) => {
  // List of suspicious file extensions and patterns to block
  const suspiciousPatterns = [
    '.php', 'wp-', 'shell', 'admin', 'cgi-bin', 'filemanager', '.well-known',
    'wp-admin', 'wp-content', 'wp-includes', 'autoload', 'xmrlpc'
  ];
  
  const url = req.url.toLowerCase();
  
  // Check if the URL contains any suspicious patterns
  if (suspiciousPatterns.some(pattern => url.includes(pattern))) {
    // Log the blocked request for monitoring
    console.log(`Blocked suspicious request: ${req.method} ${req.url} from ${req.ip}`);
    
    // Instead of serving the same content for all, return 403 Forbidden
    return res.status(403).send('Access Denied');
  }
  
  // Allow the request to continue if not suspicious
  next();
};

// Then add this right after you create your Express app

// const customDomain = 'syneticx.com';

// const httpsAgent = new https.Agent({
//   rejectUnauthorized: true, // Keep validation on
//   checkServerIdentity: (host, cert) => {
//     // Only allow your specific domain to bypass strict validation if needed
//     if (host === customDomain) {
//       return undefined; // Allow connection
//     }
    
//     // For all other hosts, use default certificate validation
//     return https.checkServerIdentity(host, cert);
//   }
// });

// Create Express app
const app = express();
// (after const app = express(); line)
// app.use(securityMiddleware);
const PORT = process.env.PORT || 3000;
connectDB();

const allowedOrigins = [
  'https://www.syneticx.com', // Replace with your actual frontend domain
  'https://syneticx.com',
  'http://localhost:3000', // For local development
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true, // If your app uses cookies or authentication
  })
);


// app.use((req, res, next) => {
//   // Security headers
//   res.setHeader('X-Content-Type-Options', 'nosniff');
//   res.setHeader('X-Frame-Options', 'DENY');
//   res.setHeader('X-XSS-Protection', '1; mode=block');
//   res.setHeader('Content-Security-Policy', "default-src 'self'");
//   next();
// });


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


const usersFile = path.join(__dirname, 'users.json');

// Initialize users file if it doesn't exist
function initializeUsersFile(callback) {
  fs.access(usersFile, fs.constants.F_OK, (err) => {
      if (err) {
          // File doesn't exist, create it
          fs.writeFile(usersFile, JSON.stringify([]), (writeErr) => {
              if (writeErr) {
                  console.error('Error creating users file:', writeErr);
                  return callback(writeErr);
              }
              callback(null);
          });
      } else {
          callback(null);
      }
  });
}

// Get all users
function getUsers(callback) {
  fs.readFile(usersFile, 'utf8', (err, data) => {
      if (err) {
          console.error('Error reading users file:', err);
          return callback(err, []);
      }
      try {
          const users = JSON.parse(data);
          callback(null, users);
      } catch (parseErr) {
          console.error('Error parsing users file:', parseErr);
          callback(parseErr, []);
      }
  });
}

// Save users
function saveUsers(users, callback) {
  fs.writeFile(usersFile, JSON.stringify(users, null, 2), (err) => {
      if (err) {
          console.error('Error writing to users file:', err);
          return callback(err);
      }
      callback(null);
  });
}

// Helper function to hash passwords
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

// Helper function to verify passwords
function verifyPassword(password, hash, salt) {
  const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === verifyHash;
}



// // Login endpoint
// app.post('/api/login', async (req, res) => {
//   try {
//     const { username, password } = req.body;
    
//     // Find user by username
//     const user = await User.findOne({ username });
    
//     if (!user) {
//       return res.status(401).json({ message: 'Invalid username or password' });
//     }
    
//     // Verify password
//     const isPasswordValid = User.verifyPassword(password, user.passwordHash, user.salt);
    
//     if (!isPasswordValid) {
//       return res.status(401).json({ message: 'Invalid username or password' });
//     }
    
//     // Convert to plain object and remove sensitive data
//     const userObj = user.toObject();
//     const { passwordHash, salt, ...safeUser } = userObj;
    
//     res.json({ user: safeUser });
//   } catch (error) {
//     console.error('Login error:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// });

// // Signup endpoint
// app.post('/api/signup', async (req, res) => {
//   try {
//     const { username, email, password } = req.body;
    
//     // Check if username or email already exists
//     const existingUsername = await User.findOne({ username });
//     if (existingUsername) {
//       return res.status(400).json({ message: 'Username already exists' });
//     }
    
//     const existingEmail = await User.findOne({ email });
//     if (existingEmail) {
//       return res.status(400).json({ message: 'Email already exists' });
//     }
    
//     // Hash password
//     const { hash: passwordHash, salt } = User.hashPassword(password);
    
//     // Create new user
//     const newUser = new User({
//       username,
//       email,
//       passwordHash,
//       salt,
//       role: 'user',
//       usage: 0,
//       billingPeriod: `${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
//       subscriptionStatus: 'free-trial',
//       darkModeEnabled: false
//     });
    
//     // Save user to database
//     await newUser.save();
    
//     // Send welcome email
//     const emailSent = await sendWelcomeEmail(newUser);
    
//     // Convert to plain object and remove sensitive data
//     const userObj = newUser.toObject();
//     const { passwordHash: ph, salt: s, ...safeUser } = userObj;
    
//     res.json({ user: safeUser });
//   } catch (error) {
//     console.error('Signup error:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// });




// // Route for FDA 510(k) data
// app.get('/api/TEG/fda/510k', async (req, res) => {
//   try {
//     const searchTerm = req.query.search || 'TEG 6S';
//     const limit = req.query.limit || 100;
    
//     const response = await axios.get(`https://api.fda.gov/device/510k.json`, {
//       params: {
//         search: `device_name:${searchTerm}`,
//         limit: limit
//       }
//     });
    
//     res.json(response.data);
//   } catch (error) {
//     console.error('Error fetching FDA data:', error.message);
//     res.status(500).json({ 
//       error: 'Failed to fetch FDA data',
//       details: error.message
//     });
//   }
// });

// Initialize drug watch service
initializeDrugWatchService();

// Use the drug watch routes
app.use('/api', drugWatchRouter);
app.use('/api/biomarkers', biomarkerRoutes);

// Grok API Configuration
const GROK_API = 'https://api.grok.ai/v1';
const GROK_URL = process.env.grok
// Configure axios for Grok API calls
const grokAPI = axios.create({
  baseURL: GROK_URL,
  headers: {
    'Authorization': `Bearer ${GROK_API}`,
    'Content-Type': 'application/json'
  }
});

// Route for FDA 510(k) data
app.get('/api/TEG/fda/510k', async (req, res) => {
  try {
    const searchTerm = req.query.search || 'TEG 6S';
    const limit = req.query.limit || 100;
    
    const response = await axios.get(`https://api.fda.gov/device/510k.json`, {
      params: {
        search: `device_name:"${searchTerm}"`,
        limit: limit
      }
    });
    
    // Filter results to only include TEG 6S related devices
    const filteredResults = response.data.results.filter(item => 
      item.device_name && 
      item.device_name.toLowerCase().includes('teg 6s')
    );
    
    res.json({
      meta: response.data.meta,
      results: filteredResults
    });
  } catch (error) {
    console.error('Error fetching FDA data:', error.message);
    res.status(500).json({
      error: 'Failed to fetch FDA data',
      details: error.message
    });
  }
});

// Route for PubMed data
app.get('/api/TEG/pubmed', async (req, res) => {
  try {
    const searchTerm = req.query.search || 'TEG 6S';
    const limit = req.query.limit || 100;
    
    // First, search for article IDs
    const searchResponse = await axios.get(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi`, {
      params: {
        db: 'pubmed',
        term: searchTerm,
        retmax: limit,
        retmode: 'json',
        sort: 'relevance'
      }
    });
    
    if (!searchResponse.data.esearchresult.idlist || searchResponse.data.esearchresult.idlist.length === 0) {
      return res.json({
        esearchresult: searchResponse.data.esearchresult,
        results: []
      });
    }
    
    // Then, fetch details for those IDs
    const idList = searchResponse.data.esearchresult.idlist.join(',');
    const detailsResponse = await axios.get(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi`, {
      params: {
        db: 'pubmed',
        id: idList,
        retmode: 'json'
      }
    });
    
    // Process and extract relevant information
    const results = Object.values(detailsResponse.data.result).filter(item => item.uid).map(item => {
      // Determine if article is related to neonates or pediatrics based on title and content
      const isNeonatal = 
        item.title.toLowerCase().includes('neonate') || 
        item.title.toLowerCase().includes('neonatal') || 
        item.title.toLowerCase().includes('premature') || 
        item.title.toLowerCase().includes('infant');
        
      const isPediatric = !isNeonatal && (
        item.title.toLowerCase().includes('pediatric') || 
        item.title.toLowerCase().includes('children') || 
        item.title.toLowerCase().includes('adolescent')
      );
      
      return {
        pmid: item.uid,
        title: item.title,
        abstract: item.abstract || 'Abstract not available',
        authors: (item.authors || []).map(author => ({
          name: author.name,
          affiliation: author.affiliation || ''
        })),
        journal: item.fulljournalname || item.source,
        publication_date: item.pubdate,
        keywords: item.keywords || [],
        patient_type: isNeonatal ? 'neonatal' : (isPediatric ? 'pediatric' : 'adult')
      };
    });
    
    res.json({
      esearchresult: searchResponse.data.esearchresult,
      results
    });
  } catch (error) {
    console.error('Error fetching PubMed data:', error.message);
    res.status(500).json({
      error: 'Failed to fetch PubMed data',
      details: error.message
    });
  }
});

// Route for PubMed neonatal data
app.get('/api/TEG/pubmed/neonatal', async (req, res) => {
  try {
    const searchTerm = req.query.search || '(TEG 6S) AND (neonate OR neonatal OR neonates OR premature OR infant OR infants)';
    const limit = req.query.limit || 100;
    
    // Use the PubMed search with neonatal-specific terms
    const searchResponse = await axios.get(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi`, {
      params: {
        db: 'pubmed',
        term: searchTerm,
        retmax: limit,
        retmode: 'json',
        sort: 'relevance'
      }
    });
    
    if (!searchResponse.data.esearchresult.idlist || searchResponse.data.esearchresult.idlist.length === 0) {
      return res.json({
        esearchresult: searchResponse.data.esearchresult,
        results: []
      });
    }
    
    // Then, fetch details for those IDs
    const idList = searchResponse.data.esearchresult.idlist.join(',');
    const detailsResponse = await axios.get(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi`, {
      params: {
        db: 'pubmed',
        id: idList,
        retmode: 'json'
      }
    });
    
    // Process and extract relevant information
    const results = Object.values(detailsResponse.data.result).filter(item => item.uid).map(item => {
      return {
        pmid: item.uid,
        title: item.title,
        abstract: item.abstract || 'Abstract not available',
        authors: (item.authors || []).map(author => ({
          name: author.name,
          affiliation: author.affiliation || ''
        })),
        journal: item.fulljournalname || item.source,
        publication_date: item.pubdate,
        keywords: item.keywords || [],
        patient_type: 'neonatal'
      };
    });
    
    res.json({
      esearchresult: searchResponse.data.esearchresult,
      results
    });
  } catch (error) {
    console.error('Error fetching PubMed neonatal data:', error.message);
    res.status(500).json({
      error: 'Failed to fetch PubMed neonatal data',
      details: error.message
    });
  }
});

// Route for clinical trials data
app.get('/api/TEG/clinical-trials', async (req, res) => {
  try {
    const searchTerm = req.query.search || 'TEG 6S';
    const limit = req.query.limit || 100;
    
    // Use the ClinicalTrials.gov API
    const response = await axios.get(`https://clinicaltrials.gov/api/query/study_fields`, {
      params: {
        expr: searchTerm,
        fields: 'NCTId,BriefTitle,OfficialTitle,OverallStatus,StudyType,Condition,Intervention,StartDate,CompletionDate,EnrollmentCount,LocationCountry,EligibilityCriteria,MinimumAge,MaximumAge,Sponsor',
        fmt: 'json',
        max_rnk: limit
      }
    });
    
    if (!response.data.StudyFieldsResponse.StudyFields || response.data.StudyFieldsResponse.StudyFields.length === 0) {
      return res.json({
        results: []
      });
    }
    
    // Process and extract relevant information
    const results = response.data.StudyFieldsResponse.StudyFields.map(study => {
      // Determine age groups based on MinimumAge and MaximumAge
      const ageGroups = [];
      
      const minAge = study.MinimumAge[0] || '';
      const maxAge = study.MaximumAge[0] || '';
      
      if (minAge.includes('newborn') || minAge.includes('0 days') || minAge.includes('0 month')) {
        ageGroups.push('Newborn');
      }
      
      if (minAge.includes('month') || (parseInt(minAge) < 2 && minAge.includes('year'))) {
        ageGroups.push('Infant');
      }
      
      if ((parseInt(minAge) >= 2 && parseInt(minAge) <= 12 && minAge.includes('year')) || 
          (parseInt(maxAge) >= 2 && parseInt(maxAge) <= 12 && maxAge.includes('year'))) {
        ageGroups.push('Child');
      }
      
      if ((parseInt(minAge) >= 13 && parseInt(minAge) <= 17 && minAge.includes('year')) || 
          (parseInt(maxAge) >= 13 && parseInt(maxAge) <= 17 && maxAge.includes('year'))) {
        ageGroups.push('Adolescent');
      }
      
      if ((parseInt(minAge) >= 18 && parseInt(minAge) <= 64 && minAge.includes('year')) || 
          (parseInt(maxAge) >= 18 && parseInt(maxAge) <= 64 && maxAge.includes('year'))) {
        ageGroups.push('Adult');
      }
      
      if ((parseInt(minAge) >= 65 && minAge.includes('year')) || 
          (parseInt(maxAge) >= 65 && maxAge.includes('year'))) {
        ageGroups.push('Older Adult');
      }
      
      if (ageGroups.length === 0) {
        ageGroups.push('Not Specified');
      }
      
      // Determine patient type
      let patientType = 'Adult';
      if (ageGroups.includes('Newborn') || ageGroups.includes('Infant')) {
        patientType = 'Neonatal';
      } else if (ageGroups.includes('Child') || ageGroups.includes('Adolescent')) {
        patientType = 'Pediatric';
      }
      
      return {
        nct_id: study.NCTId[0],
        title: study.BriefTitle[0] || study.OfficialTitle[0] || 'Untitled',
        status: study.OverallStatus[0] || 'Unknown',
        study_type: study.StudyType[0] || 'Unknown',
        conditions: study.Condition || [],
        interventions: study.Intervention || [],
        sponsors: study.Sponsor || [],
        start_date: study.StartDate[0] || 'Unknown',
        completion_date: study.CompletionDate[0] || 'Unknown',
        enrollment: study.EnrollmentCount[0] || 0,
        url: `https://clinicaltrials.gov/study/${study.NCTId[0]}`,
        age_groups: ageGroups,
        patient_type: patientType
      };
    });
    
    // Filter results to only include TEG 6S related trials
    const filteredResults = results.filter(item => 
      item.title.toLowerCase().includes('teg 6s') || 
      item.interventions.some(intervention => 
        intervention.toLowerCase().includes('teg 6s') || 
        intervention.toLowerCase().includes('thromboelastography')
      )
    );
    
    res.json({
      results: filteredResults
    });
  } catch (error) {
    console.error('Error fetching clinical trials data:', error.message);
    res.status(500).json({
      error: 'Failed to fetch clinical trials data',
      details: error.message
    });
  }
});

// Route for clinical trials neonatal data
app.get('/api/TEG/clinical-trials/neonatal', async (req, res) => {
  try {
    const searchTerm = req.query.search || '(TEG 6S) AND (neonate OR neonatal OR neonates OR premature OR infant OR infants)';
    const limit = req.query.limit || 100;
    
    const response = await axios.get(`https://clinicaltrials.gov/api/query/study_fields`, {
      params: {
        expr: searchTerm,
        fields: 'NCTId,BriefTitle,OfficialTitle,OverallStatus,StudyType,Condition,Intervention,StartDate,CompletionDate,EnrollmentCount,LocationCountry,EligibilityCriteria,MinimumAge,MaximumAge,Sponsor',
        fmt: 'json',
        max_rnk: limit
      }
    });
    
    if (!response.data.StudyFieldsResponse.StudyFields || response.data.StudyFieldsResponse.StudyFields.length === 0) {
      return res.json({
        results: []
      });
    }
    
    // Process trials similar to the clinical trials endpoint, but only include neonatal studies
    const allResults = response.data.StudyFieldsResponse.StudyFields.map(study => {
      // Similar processing to the clinical trials endpoint...
      const ageGroups = [];
      
      const minAge = study.MinimumAge[0] || '';
      const maxAge = study.MaximumAge[0] || '';
      
      if (minAge.includes('newborn') || minAge.includes('0 days') || minAge.includes('0 month')) {
        ageGroups.push('Newborn');
      }
      
      if (minAge.includes('month') || (parseInt(minAge) < 2 && minAge.includes('year'))) {
        ageGroups.push('Infant');
      }
      
      // Other age groups...
      
      return {
        nct_id: study.NCTId[0],
        title: study.BriefTitle[0] || study.OfficialTitle[0] || 'Untitled',
        status: study.OverallStatus[0] || 'Unknown',
        study_type: study.StudyType[0] || 'Unknown',
        conditions: study.Condition || [],
        interventions: study.Intervention || [],
        sponsors: study.Sponsor || [],
        start_date: study.StartDate[0] || 'Unknown',
        completion_date: study.CompletionDate[0] || 'Unknown',
        enrollment: study.EnrollmentCount[0] || 0,
        url: `https://clinicaltrials.gov/study/${study.NCTId[0]}`,
        age_groups: ageGroups,
        patient_type: ageGroups.includes('Newborn') || ageGroups.includes('Infant') ? 'Neonatal' : 'Other'
      };
    });
    
    // Filter for neonatal studies and TEG 6S
    const filteredResults = allResults.filter(item => 
      (item.patient_type === 'Neonatal' || 
       item.title.toLowerCase().includes('neonate') || 
       item.title.toLowerCase().includes('neonatal') || 
       item.title.toLowerCase().includes('premature') || 
       item.title.toLowerCase().includes('infant')) && 
      (item.title.toLowerCase().includes('teg 6s') || 
       item.interventions.some(intervention => 
         intervention.toLowerCase().includes('teg 6s') || 
         intervention.toLowerCase().includes('thromboelastography')
       ))
    );
    
    res.json({
      results: filteredResults
    });
  } catch (error) {
    console.error('Error fetching clinical trials neonatal data:', error.message);
    res.status(500).json({
      error: 'Failed to fetch clinical trials neonatal data',
      details: error.message
    });
  }
});

// Route for AI insights
app.post('/api/TEG/ai/insights', async (req, res) => {
  try {
    const { question } = req.body;
    
    if (!question) {
      return res.status(400).json({
        error: 'No question provided'
      });
    }
    
    // Build prompt for Grok
    const prompt = `Based on the latest medical research, please provide insights on the following question about the TEG 6S hemostasis system: "${question}"\n\nFocus specifically on neonatal applications and citrated blood samples where relevant. Structure your response with:\n1. Key Insights (technical analysis)\n2. Summary (practical implications)\n3. Clinical Recommendations (actionable advice)`;
    
    // Call Grok API
    const response = await grokAPI.post('/chat/completions', {
      model: "grok-1", // Use Grok's model
      messages: [
        { role: "system", content: "You are a medical research assistant with expertise in hematology and diagnostic devices." },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1000
    });
    
    // Parse response - Grok uses a different structure compared to OpenAI's completion API
    // We're assuming Grok returns a structure similar to ChatGPT with message content
    const completionText = response.data.choices[0].message.content.trim();
    
    // Split into sections
    const insights = completionText.split("Summary")[0].replace("Key Insights", "").trim();
    const summary = completionText.split("Summary")[1].split("Clinical Recommendations")[0].trim();
    const recommendations = completionText
      .split("Clinical Recommendations")[1]
      .trim()
      .split("\n")
      .filter(line => line.trim())
      .map(line => line.replace(/^\d+\.\s*/, "").trim());
    
    res.json({
      insights,
      summary,
      recommendations
    });
  } catch (error) {
    console.error('Error generating AI insights:', error.message);
    res.status(500).json({
      error: 'Failed to generate AI insights',
      details: error.message
    });
  }
});

// Route for AI summary of selected items
app.post('/api/TEG/ai/summary', async (req, res) => {
  try {
    const { items } = req.body;
    
    if (!items || items.length === 0) {
      return res.status(400).json({
        error: 'No items provided for summarization'
      });
    }
    
    // Build prompt for Grok
    let prompt = `Please provide a comprehensive summary of the following research items related to the TEG 6S hemostasis system:\n\n`;
    
    // Add FDA items
    const fdaItems = items.filter(item => item.type === 'fda');
    if (fdaItems.length > 0) {
      prompt += `FDA Clearances:\n`;
      fdaItems.forEach(item => {
        prompt += `- ${item.data.device_name || 'TEG 6S Device'} (${item.data.k_number || 'No K Number'}): ${item.data.decision_description || 'No decision description'}\n`;
      });
      prompt += `\n`;
    }
    
    // Add PubMed items
    const pubmedItems = items.filter(item => item.type === 'pubmed');
    if (pubmedItems.length > 0) {
      prompt += `PubMed Articles:\n`;
      pubmedItems.forEach(item => {
        prompt += `- Title: ${item.data.title}\n`;
        prompt += `  Abstract: ${item.data.abstract}\n\n`;
      });
    }
    
    // Add Clinical Trials items
    const trialItems = items.filter(item => item.type === 'clinical-trial');
    if (trialItems.length > 0) {
      prompt += `Clinical Trials:\n`;
      trialItems.forEach(item => {
        prompt += `- Title: ${item.data.title}\n`;
        prompt += `  Status: ${item.data.status}\n`;
        prompt += `  Type: ${item.data.study_type}\n`;
        prompt += `  Conditions: ${item.data.conditions.join(', ')}\n\n`;
      });
    }
    
    prompt += `Focus specifically on neonatal applications and the use of citrated blood samples where relevant. Highlight key findings, gaps in the research, and implications for clinical practice.`;
    
    // Call Grok API
    const response = await grokAPI.post('/chat/completions', {
      model: "grok-1", // Use Grok's model
      messages: [
        { role: "system", content: "You are a medical research assistant with expertise in hematology and diagnostic devices." },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1000
    });
    
    // Parse response - assuming Grok returns a structure similar to ChatGPT
    const summary = response.data.choices[0].message.content.trim();
    
    res.json({
      summary
    });
  } catch (error) {
    console.error('Error generating AI summary:', error.message);
    res.status(500).json({
      error: 'Failed to generate AI summary',
      details: error.message
    });
  }
});


app.use(pubmedRoutes);

// Record new session or update existing session
app.post('/api/tracking/track', async (req, res) => {
  try {
    const data = req.body;
    
    // Try to find existing session
    let session = await UserSession.findOne({ sessionId: data.sessionId });
    
    if (session) {
      // Update existing session
      session.timeSpent = data.timeSpent;
      session.mousePositions = [...session.mousePositions, ...data.mousePositions];
      session.clicks = [...session.clicks, ...data.clicks];
      
      if (data.scrollPositions) {
        session.scrollPositions = [...session.scrollPositions, ...data.scrollPositions];
      }
      
      if (data.scrollDepth && data.scrollDepth > session.scrollDepth) {
        session.scrollDepth = data.scrollDepth;
      }
      
      if (data.isFinal) {
        session.isFinal = true;
        session.endTime = new Date();
      }
      
      await session.save();
    } else {
      // Create new session
      // Extract userId from authentication if available
      const userId = req.user ? req.user._id : null;
      
      session = new UserSession({
        sessionId: data.sessionId,
        userId,
        pageUrl: data.pageUrl,
        referrer: data.referrer,
        startTime: new Date(data.startTime),
        timeSpent: data.timeSpent,
        screenWidth: data.screenWidth,
        screenHeight: data.screenHeight,
        userAgent: data.userAgent,
        mousePositions: data.mousePositions || [],
        clicks: data.clicks || [],
        scrollPositions: data.scrollPositions || [],
        scrollDepth: data.scrollDepth || 0,
        isFinal: data.isFinal || false
      });
      
      await session.save();
    }
    
    res.status(200).send({ success: true });
  } catch (error) {
    console.error('Error recording session data:', error);
    res.status(500).send({ success: false, error: 'Error saving tracking data' });
  }
});

// Get heatmap data for a specific page
app.get('/api/tracking/heatmap', async (req, res) => {
  try {
    const { pageUrl, startDate, endDate } = req.query;
    
    if (!pageUrl) {
      return res.status(400).send({ success: false, error: 'Page URL is required' });
    }
    
    const query = { pageUrl };
    
    // Add date filtering if provided
    if (startDate && endDate) {
      query.startTime = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    // Find relevant sessions
    const sessions = await UserSession.find(query);
    
    // Extract click data for heatmap
    const clickData = sessions.flatMap(session => 
      session.clicks.map(click => ({
        x: click.x,
        y: click.y,
        elementClicked: click.target.tagName,
        elementId: click.target.id,
        elementClass: click.target.className
      }))
    );
    
    // Extract mouse movement data
    const movementData = sessions.flatMap(session => 
      session.mousePositions.map(pos => ({
        x: pos.x,
        y: pos.y
      }))
    );
    
    // Calculate average time spent on page
    const totalSessions = sessions.length;
    const totalTimeSpent = sessions.reduce((sum, session) => sum + session.timeSpent, 0);
    const averageTimeSpent = totalSessions > 0 ? totalTimeSpent / totalSessions : 0;
    
    res.status(200).send({
      success: true,
      clickData,
      movementData,
      averageTimeSpent,
      sessionCount: totalSessions
    });
    
  } catch (error) {
    console.error('Error fetching heatmap data:', error);
    res.status(500).send({ success: false, error: 'Error fetching heatmap data' });
  }
});

// Get session analytics summary
app.get('api/tracking/analytics', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const query = {};
    
    // Add date filtering if provided
    if (startDate && endDate) {
      query.startTime = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    // Get all sessions that match the criteria
    const sessions = await UserSession.find(query);
    
    // Calculate analytics
    const totalSessions = sessions.length;
    const pageViews = {};
    const deviceTypes = { desktop: 0, tablet: 0, mobile: 0 };
    let totalTimeSpent = 0;
    
    sessions.forEach(session => {
      // Count page views
      if (!pageViews[session.pageUrl]) {
        pageViews[session.pageUrl] = 0;
      }
      pageViews[session.pageUrl]++;
      
      // Count device types
      deviceTypes[session.deviceType]++;
      
      // Sum time spent
      totalTimeSpent += session.timeSpent;
    });
    
    // Sort pages by most visited
    const topPages = Object.entries(pageViews)
      .map(([url, count]) => ({ url, count }))
      .sort((a, b) => b.count - a.count);
    
    const averageTimeSpent = totalSessions > 0 ? totalTimeSpent / totalSessions : 0;
    
    res.status(200).send({
      success: true,
      totalSessions,
      topPages: topPages.slice(0, 10), // Top 10 pages
      deviceBreakdown: deviceTypes,
      averageTimePerSession: averageTimeSpent
    });
    
  } catch (error) {
    console.error('Error fetching analytics data:', error);
    res.status(500).send({ success: false, error: 'Error fetching analytics data' });
  }
});



// Set cutoff date for leads (May 9, 2025)
const LEAD_CUTOFF_DATE = new Date('2025-05-09T00:00:00.000Z');

// API Routes for Users
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await User.find().select('-passwordHash -salt');
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/api/admin/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-passwordHash -salt');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// API Routes for user statistics
app.get('/api/admin/stats/users', async (req, res) => {
  try {
    // Get total users
    const totalUsers = await User.countDocuments();
    
    // Get users by subscription status
    const subscriptionStats = await User.aggregate([
      { $group: { _id: '$subscriptionStatus', count: { $sum: 1 } } }
    ]);
    
    // Get average usage
    const usageStats = await User.aggregate([
      { $group: { _id: null, avgUsage: { $avg: '$usage' }, totalUsage: { $sum: '$usage' } } }
    ]);
    
    // Get new users in the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const newUsers = await User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });
    
    // Get active users (logged in within the last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const activeUsers = await User.countDocuments({ lastLogin: { $gte: sevenDaysAgo } });
    
    // Get drug search statistics
    const drugSearchStats = await User.aggregate([
      { $unwind: "$activityLog" },
      { $match: { 
        "activityLog.activity": "search",
        "activityLog.details.searchType": "drug_only" 
      }},
      { $group: { 
        _id: "$activityLog.details.terms.drug", 
        count: { $sum: 1 },
        users: { $addToSet: "$_id" }
      }},
      { $project: {
        drug: "$_id",
        count: 1,
        uniqueUsers: { $size: "$users" }
      }},
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    
    // Get daily active users for the last 30 days
    const dailyActiveUsers = await User.aggregate([
      { $unwind: "$loginDates" },
      { $match: { loginDates: { $gte: thirtyDaysAgo } } },
      { 
        $group: { 
          _id: { 
            $dateToString: { format: "%Y-%m-%d", date: "$loginDates" } 
          }, 
          count: { $sum: 1 } 
        } 
      },
      { $sort: { _id: 1 } }
    ]);
    
res.json({
  totalUsers,
  subscriptionStats,
  usageStats: usageStats[0] || { avgUsage: 0, totalUsage: 0 },
  newUsers,
  activeUsers,
  drugSearchStats,
  dailyActiveUsers,
  metrics: {
    totalUsers: "Total number of registered users in the database",
    newUsers: "Number of users who registered within the last 30 days",
    activeUsers: "Number of users who have logged in at least once in the past 7 days",
    avgUsage: "Average number of actions (API calls, searches, etc.) per user",
    totalUsage: "Sum of all usage counts across all users",
    subscriptionStats: "Distribution of users across different subscription types",
    drugSearchStats: "Most frequently searched drugs with counts and unique users"
  }
});
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// API Routes for Leads
app.get('/api/admin/leads', async (req, res) => {
  try {
    // Only return leads after the cutoff date
    const leads = await Lead.find({ createdAt: { $gte: LEAD_CUTOFF_DATE } });
    res.json(leads);
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/api/admin/stats/leads', async (req, res) => {
  try {
    // Only count leads after the cutoff date
    const totalLeads = await Lead.countDocuments({ createdAt: { $gte: LEAD_CUTOFF_DATE } });
    
    // Get leads by status (only after cutoff)
    const statusStats = await Lead.aggregate([
      { $match: { createdAt: { $gte: LEAD_CUTOFF_DATE } } },
      { $group: { _id: '$leadStatus', count: { $sum: 1 } } }
    ]);
    
    // Get leads by source (only after cutoff)
    const sourceStats = await Lead.aggregate([
      { $match: { createdAt: { $gte: LEAD_CUTOFF_DATE } } },
      { $group: { _id: '$source', count: { $sum: 1 } } }
    ]);
    
    // Get new leads in the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const newLeads = await Lead.countDocuments({ 
      createdAt: { $gte: thirtyDaysAgo, $gte: LEAD_CUTOFF_DATE } 
    });
    
    // Get leads by revenue range (only after cutoff)
    const revenueStats = await Lead.aggregate([
      { $match: { createdAt: { $gte: LEAD_CUTOFF_DATE } } },
      { $group: { _id: '$companyRevenueRange', count: { $sum: 1 } } }
    ]);
    
    // Get leads by day (last 30 days)
    const dailyLeads = await Lead.aggregate([
      { $match: { 
        createdAt: { $gte: thirtyDaysAgo, $gte: LEAD_CUTOFF_DATE } 
      }},
      { 
        $group: { 
          _id: { 
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } 
          }, 
          count: { $sum: 1 } 
        } 
      },
      { $sort: { _id: 1 } }
    ]);
    
    res.json({
  totalLeads,
  statusStats,
  sourceStats,
  newLeads,
  revenueStats,
  dailyLeads,
  metrics: {
    totalLeads: "Total number of leads captured after May 9, 2025",
    newLeads: "Number of leads captured within the last 30 days",
    statusStats: "Distribution of leads across different status categories",
    sourceStats: "Breakdown of leads by acquisition channel or source",
    revenueStats: "Distribution of leads by company revenue range"
  }
});
  } catch (error) {
    console.error('Error fetching lead stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});




// Login endpoint with tracking
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Find user by username
    const user = await User.findOne({ username });
    
    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    
    // Verify password
    const isPasswordValid = User.verifyPassword(password, user.passwordHash, user.salt);
    
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    
    // Get current date info for tracking
    const now = new Date();
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const thisMonth = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
    
    // Update login tracking info
    const updates = {
      lastLogin: now,
      $inc: {} // For incrementing counters
    };
    
    // Initialize tracking arrays if they don't exist
    if (!user.loginDates) {
      updates.loginDates = [];
    }
    if (!user.dailyLogins) {
      updates.dailyLogins = {};
    }
    if (!user.monthlyLogins) {
      updates.monthlyLogins = {};
    }
    
    // Increment login counters
    updates.$inc[`dailyLogins.${today}`] = 1;
    updates.$inc[`monthlyLogins.${thisMonth}`] = 1;
    
    // Add login timestamp to history (limit to 100 most recent)
    updates.$push = {
      loginDates: {
        $each: [now],
        $slice: -100 // Keep only last 100 logins
      }
    };
    
    // Update user with new tracking data
    await User.findByIdAndUpdate(user._id, updates, { new: true });
    
    // Convert to plain object and remove sensitive data
    const userObj = user.toObject();
    const { passwordHash, salt, ...safeUser } = userObj;
    
    res.json({ user: safeUser });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Signup endpoint with tracking initialization
app.post('/api/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Check if username or email already exists
    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({ message: 'Username already exists' });
    }
    
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ message: 'Email already exists' });
    }
    
    // Hash password
    const { hash: passwordHash, salt } = User.hashPassword(password);
    
    // Current date for tracking initialization
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const thisMonth = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
    
    // Create new user with tracking fields
    const newUser = new User({
      username,
      email,
      passwordHash,
      salt,
      role: 'user',
      usage: 0,
      billingPeriod: `${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      subscriptionStatus: 'free-trial',
      darkModeEnabled: false,
      // New tracking fields
      lastLogin: now,
      loginDates: [now],
      dailyLogins: { [today]: 1 },
      monthlyLogins: { [thisMonth]: 1 },
      activityLog: []
    });
    
    // Save user to database
    await newUser.save();
    
    // Send welcome email
    const emailSent = await sendWelcomeEmail(newUser);
    
    // Convert to plain object and remove sensitive data
    const userObj = newUser.toObject();
    const { passwordHash: ph, salt: s, ...safeUser } = userObj;
    
    res.json({ user: safeUser });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// New endpoint to log user activity
app.post('/api/log-activity', async (req, res) => {
  try {
    const { userId, activity, details } = req.body;
    
    if (!userId || !activity) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    
    // Find user
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Create activity entry
    const activityEntry = {
      timestamp: new Date(),
      activity,
      details: details || {}
    };
    
    // Initialize activityLog array if it doesn't exist
    if (!user.activityLog) {
      user.activityLog = [];
    }
    
    // Add new activity to log (limit to 1000 most recent)
    user.activityLog.push(activityEntry);
    if (user.activityLog.length > 1000) {
      user.activityLog.shift(); // Remove oldest entry if over limit
    }
    
    // Save updated user
    await user.save();
    
    res.json({ success: true, message: 'Activity logged' });
  } catch (error) {
    console.error('Activity logging error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});



// Load the email template (you should save the HTML template from earlier artifact in a file)
const emailTemplatePath = path.join(__dirname, 'templates', 'welcome-email.html');
let emailTemplate;
try {
  const emailTemplateSource = fs.readFileSync(emailTemplatePath, 'utf-8');
  emailTemplate = handlebars.compile(emailTemplateSource);
} catch (error) {
  console.error('Error loading email template:', error);
}

// Utility to calculate trial end date (30 days from now)
const calculateTrialEndDate = () => {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);
  return endDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};



// Function to send welcome email
const sendWelcomeEmail = async (user) => {
  // Set up email transporter with your credentials
const transporter = nodemailer.createTransport({
//   service: 'gmail',
//   auth: {
//     user: process.env.smtphost,
//     pass: process.env.smtppassword
//   }
// });
        host:  'smtp.gmail.com',
        port:  587,
        secure: false,
          auth: {
    user: process.env.smtphost,
    pass: process.env.smtppassword
  }
      });

        // this.emailTransporter = nodemailer.createTransport({


  if (!emailTemplate) {
    console.error('Email template not loaded');
    return false;
  }

  try {
    // Generate the HTML for the email using the template
    const trialEndDate = calculateTrialEndDate();
    const htmlToSend = emailTemplate({
      username: user.username,
      email: user.email,
      trialEndDate
    });

    // Set up the email options
    const mailOptions = {
      from: '"Regulatory AI Dashboard" <syneticslz@gmail.com>',
      to: user.email,
      subject: 'Welcome to Your Regulatory AI Dashboard',
      html: htmlToSend
    };

    // Send the email
    const info = await transporter.sendMail(mailOptions);
    console.log('Welcome email sent to:', user.email, 'MessageID:', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending welcome email:', error);
    return false;
  }
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

const GROK_API_KEY = process.env.grok;
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';







// // Contact form backend handler
// app.post('/api/contact', async (req, res) => {
//   try {
//     const { 
//       name, 
//       company, 
//       email, 
//       phone, 
//       message 
//     } = req.body;
    
//     console.log(`Received contact form submission from ${name} at ${email}`);
    
//     // Validate required fields
//     if (!name || !email || !message) {
//       return res.status(400).json({ 
//         success: false, 
//         error: 'Please provide name, email and message' 
//       });
//     }
    
//     // Basic email validation
//     const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
//     if (!emailRegex.test(email)) {
//       return res.status(400).json({ 
//         success: false, 
//         error: 'Please provide a valid email address' 
//       });
//     }
    
//     // Create email transporter (using the same one from your previous code)
//     const transporter = nodemailer.createTransport({
//       service: 'gmail',
//       auth: {
//         user: 'syneticslz@gmail.com',
//         pass: 'gble ksdb ntdq hqlx'
//       }
//     });
    
//     // Prepare HTML email
//     const htmlEmail = `
//       <!DOCTYPE html>
//       <html>
//       <head>
//         <meta charset="utf-8">
//         <title>New Contact Form Submission</title>
//         <style>
//           body {
//             font-family: Arial, sans-serif;
//             line-height: 1.6;
//             color: #333;
//             max-width: 800px;
//             margin: 0 auto;
//             padding: 20px;
//           }
//           .header {
//             border-bottom: 2px solid #3b82f6;
//             padding-bottom: 10px;
//             margin-bottom: 20px;
//           }
//           .header h1 {
//             color: #1e40af;
//             margin-bottom: 5px;
//           }
//           .content {
//             margin: 20px 0;
//           }
//           .data-item {
//             margin-bottom: 15px;
//           }
//           .label {
//             font-weight: bold;
//             color: #4b5563;
//           }
//           .footer {
//             margin-top: 30px;
//             font-size: 12px;
//             color: #666;
//             border-top: 1px solid #ddd;
//             padding-top: 15px;
//           }
//         </style>
//       </head>
//       <body>
//         <div class="header">
//           <h1>New Contact Form Submission</h1>
//           <p>From SyneticX website</p>
//         </div>
        
//         <div class="content">
//           <div class="data-item">
//             <p class="label">Name:</p>
//             <p>${name}</p>
//           </div>
          
//           <div class="data-item">
//             <p class="label">Company:</p>
//             <p>${company || 'Not provided'}</p>
//           </div>
          
//           <div class="data-item">
//             <p class="label">Email:</p>
//             <p>${email}</p>
//           </div>
          
//           <div class="data-item">
//             <p class="label">Phone:</p>
//             <p>${phone || 'Not provided'}</p>
//           </div>
          
//           <div class="data-item">
//             <p class="label">Message:</p>
//             <p>${message}</p>
//           </div>
//         </div>
        
//         <div class="footer">
//           <p>This message was sent from the contact form on the SyneticX website on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}.</p>
//         </div>
//       </body>
//       </html>
//     `;
    
//     // Send email to yourself
//     await transporter.sendMail({
//       from: `"SyneticX Website" <syneticslz@gmail.com>`,
//       to: 'syneticslz@gmail.com', // Your email where you want to receive messages
//       replyTo: email, // Set reply-to as the contact's email for easy replies
//       subject: `New Contact: ${name} from ${company || 'Unknown Company'}`,
//       html: htmlEmail
//     });
    
//     // Send confirmation email to the user
//     await transporter.sendMail({
//       from: `"SyneticX" <syneticslz@gmail.com>`,
//       to: email,
//       subject: `Thanks for contacting SyneticX`,
//       html: `
//         <!DOCTYPE html>
// <html lang="en">
// <head>
//     <meta charset="UTF-8">
//     <meta name="viewport" content="width=device-width, initial-scale=1.0">
//     <title>Thank You for Contacting SyneticX</title>
//     <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
//     <style>
//         /* Base styles */
//         * {
//             margin: 0;
//             padding: 0;
//             box-sizing: border-box;
//         }
        
//         body {
//             font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
//             line-height: 1.6;
//             color: #4b5563;
//             background-color: #f9fafb;
//             margin: 0;
//             padding: 0;
//         }
        
//         .email-container {
//             max-width: 600px;
//             margin: 30px auto;
//             background-color: #ffffff;
//             border-radius: 8px;
//             overflow: hidden;
//             box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
//         }
        
//         .email-header {
//             background: linear-gradient(to right, #3b82f6, #8b5cf6);
//             color: white;
//             padding: 28px 24px;
//             text-align: center;
//         }
        
//         .logo-text {
//             font-size: 24px;
//             font-weight: 700;
//             margin: 0;
//             color: white;
//         }
        
//         .email-body {
//             padding: 32px 24px;
//         }
        
//         .greeting {
//             font-size: 18px;
//             font-weight: 600;
//             color: #111827;
//             margin-bottom: 16px;
//         }
        
//         .message {
//             margin-bottom: 20px;
//         }
        
//         .signature {
//             margin-top: 28px;
//         }
        
//         .signature-name {
//             font-weight: 600;
//             color: #111827;
//         }
        
//         .email-footer {
//             background-color: #f9fafb;
//             padding: 20px 24px;
//             text-align: center;
//             font-size: 14px;
//             color: #6b7280;
//             border-top: 1px solid #e5e7eb;
//         }
        
//         .footer-text {
//             margin-bottom: 10px;
//         }
        
//         .automated-message {
//             font-size: 12px;
//             color: #9ca3af;
//             margin-top: 12px;
//         }
//     </style>
// </head>
// <body>
//     <div class="email-container">
//         <div class="email-header">
//             <h1 class="logo-text">SyneticX</h1>
//         </div>
        
//         <div class="email-body">
//             <p class="greeting">Hello ${name},</p>
            
//             <p class="message">
//                 Thank you for contacting SyneticX. We've received your message and one of our team members will get back to you shortly.
//             </p>
            
//             <p class="message">
//                 We appreciate your interest in our AI-powered market intelligence solutions and look forward to discussing how we can help optimize your business decisions.
//             </p>
            
//             <div class="signature">
//                 <p class="signature-name">Best regards,</p>
//                 <p>The SyneticX Team</p>
//             </div>
//         </div>
        
//         <div class="email-footer">
//             <p class="footer-text">© 2025 SyneticX. All rights reserved.</p>
//             <p class="automated-message">This is an automated message, please do not reply directly to this email.</p>
//         </div>
//     </div>
// </body>
// </html>
//       `
//     });
    
//     res.json({ success: true, message: 'Your message has been sent successfully. We\'ll be in touch soon!' });
//   } catch (error) {
//     console.error('Contact form submission error:', error);
//     res.status(500).json({ success: false, error: 'Failed to send your message. Please try again later.' });
//   }
// });

app.post('/api/contact', async (req, res) => {
  try {
    const { 
      name, 
      company, 
      email, 
      phone, 
      message 
    } = req.body;
    
    console.log(`Received contact form submission from ${name} at ${email}`);
    
    // Validate required fields
    if (!name || !email || !message) {
      return res.status(400).json({ 
        success: false, 
        error: 'Please provide name, email and message' 
      });
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Please provide a valid email address' 
      });
    }
    
    // Split name into first and last name (best effort)
    const nameParts = name.trim().split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
    
    // Create lead in database
    const { Lead } = require('./db'); // Adjust path as needed
    
    const newLead = new Lead({
      firstName,
      lastName,
      email,
      company,
      phone,
      message,
      source: 'contact_form'
    });
    
    await newLead.save();
    console.log(`Created lead in database with ID: ${newLead._id}`);
    const emailuser = process.env.smtppassword
const emailhost = process.env.smtphost
    // Create email transporter
    const transporter = nodemailer.createTransport({
    //   service: 'gmail',
    //   auth: {
    // user: process.env.smtphost,
    // pass: process.env.smtppassword
    //   }
    // });
            host:  'smtp.gmail.com',
        port:  587,
        secure: false,
          auth: {
    user: process.env.smtphost,
    pass: process.env.smtppassword
  }
      });
    
    // Prepare HTML email
    const htmlEmail = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>New Contact Form Submission</title>
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
          .content {
            margin: 20px 0;
          }
          .data-item {
            margin-bottom: 15px;
          }
          .label {
            font-weight: bold;
            color: #4b5563;
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
          <h1>New Contact Form Submission</h1>
          <p>From SyneticX website</p>
        </div>
        
        <div class="content">
          <div class="data-item">
            <p class="label">Name:</p>
            <p>${name}</p>
          </div>
          
          <div class="data-item">
            <p class="label">Company:</p>
            <p>${company || 'Not provided'}</p>
          </div>
          
          <div class="data-item">
            <p class="label">Email:</p>
            <p>${email}</p>
          </div>
          
          <div class="data-item">
            <p class="label">Phone:</p>
            <p>${phone || 'Not provided'}</p>
          </div>
          
          <div class="data-item">
            <p class="label">Message:</p>
            <p>${message}</p>
          </div>
        </div>
        
        <div class="footer">
          <p>This message was sent from the contact form on the SyneticX website on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}.</p>
          <p>A lead record has been created in the database with ID: ${newLead._id}</p>
        </div>
      </body>
      </html>
    `;
    
    // Send email to yourself
    await transporter.sendMail({
      from: `"SyneticX Website" <syneticslz@gmail.com>`,
      to: 'syneticslz@gmail.com', // Your email where you want to receive messages
      replyTo: email, // Set reply-to as the contact's email for easy replies
      subject: `New Contact: ${name} from ${company || 'Unknown Company'}`,
      html: htmlEmail
    });
    
    // Send confirmation email to the user
    await transporter.sendMail({
      from: `"SyneticX" <syneticslz@gmail.com>`,
      to: email,
      subject: `Thanks for contacting SyneticX`,
      html: `
        <!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Thank You for Contacting SyneticX</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        /* Base styles */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #4b5563;
            background-color: #f9fafb;
            margin: 0;
            padding: 0;
        }
        
        .email-container {
            max-width: 600px;
            margin: 30px auto;
            background-color: #ffffff;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
        }
        
        .email-header {
            background: linear-gradient(to right, #3b82f6, #8b5cf6);
            color: white;
            padding: 28px 24px;
            text-align: center;
        }
        
        .logo-text {
            font-size: 24px;
            font-weight: 700;
            margin: 0;
            color: white;
        }
        
        .email-body {
            padding: 32px 24px;
        }
        
        .greeting {
            font-size: 18px;
            font-weight: 600;
            color: #111827;
            margin-bottom: 16px;
        }
        
        .message {
            margin-bottom: 20px;
        }
        
        .signature {
            margin-top: 28px;
        }
        
        .signature-name {
            font-weight: 600;
            color: #111827;
        }
        
        .email-footer {
            background-color: #f9fafb;
            padding: 20px 24px;
            text-align: center;
            font-size: 14px;
            color: #6b7280;
            border-top: 1px solid #e5e7eb;
        }
        
        .footer-text {
            margin-bottom: 10px;
        }
        
        .automated-message {
            font-size: 12px;
            color: #9ca3af;
            margin-top: 12px;
        }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="email-header">
            <h1 class="logo-text">SyneticX</h1>
        </div>
        
        <div class="email-body">
            <p class="greeting">Hello ${name},</p>
            
            <p class="message">
                Thank you for contacting SyneticX. We've received your message and one of our team members will get back to you shortly.
            </p>
            
            <p class="message">
                We appreciate your interest in our AI-powered market intelligence solutions and look forward to discussing how we can help optimize your business decisions.
            </p>
            
            <div class="signature">
                <p class="signature-name">Best regards,</p>
                <p>The SyneticX Team</p>
            </div>
        </div>
        
        <div class="email-footer">
            <p class="footer-text">© 2025 SyneticX. All rights reserved.</p>
            <p class="automated-message">This is an automated message, please do not reply directly to this email.</p>
        </div>
    </div>
</body>
</html>
      `
    });
    
    res.json({ success: true, message: 'Your message has been sent successfully. We\'ll be in touch soon!' });
  } catch (error) {
    console.error('Contact form submission error:', error);
    res.status(500).json({ success: false, error: 'Failed to send your message. Please try again later.' });
  }
});


// Book a demo route
app.post('/api/demo', async (req, res) => {
  try {
    const { 
      firstName, 
      lastName, 
      email, 
      company, 
      companyRevenueRange,
      agreeToTerms
    } = req.body;
    
    console.log(`Received demo booking from ${firstName} ${lastName} at ${email}`);
    // Create email transporter
const transporter = nodemailer.createTransport({
//   service: 'gmail',
//   auth: {
//     user: process.env.smtphost,
//     pass: process.env.smtppassword
//   }
// });
        host:  'smtp.gmail.com',
        port:  587,
        secure: false,
          auth: {
    user: process.env.smtphost,
    pass: process.env.smtppassword
  }
      });

    // Validate required fields
    if (!firstName || !lastName || !email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Please provide first name, last name and email' 
      });
    }
    
    // Ensure terms agreement
    if (!agreeToTerms) {
      return res.status(400).json({ 
        success: false, 
        error: 'You must agree to the Privacy Policy and Terms of Service' 
      });
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Please provide a valid email address' 
      });
    }
    
    // Save lead to database
    const newLead = new Lead({
      firstName,
      lastName,
      email,
      company,
      companyRevenueRange,
      source: 'demo_form',
      agreeToTerms: true
    });
    
    await newLead.save();
    
    // Prepare notification email to admin
    const adminHtmlEmail = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>New Demo Request</title>
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
          .content {
            margin: 20px 0;
          }
          .data-item {
            margin-bottom: 15px;
          }
          .label {
            font-weight: bold;
            color: #4b5563;
          }
          .footer {
            margin-top: 30px;
            font-size: 12px;
            color: #666;
            border-top: 1px solid #ddd;
            padding-top: 15px;
          }
          .priority-high {
            background-color: #fee2e2;
            border-left: 4px solid #ef4444;
            padding: 10px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>New Demo Request</h1>
          <p>From SyneticX website</p>
        </div>
        
        <div class="content">
          <div class="data-item ${companyRevenueRange === 'Over $100M' ? 'priority-high' : ''}">
            <p class="label">Name:</p>
            <p>${firstName} ${lastName}</p>
          </div>
          
          <div class="data-item">
            <p class="label">Company:</p>
            <p>${company || 'Not provided'}</p>
          </div>
          
          <div class="data-item">
            <p class="label">Email:</p>
            <p>${email}</p>
          </div>
          
          <div class="data-item">
            <p class="label">Company Revenue Range:</p>
            <p>${companyRevenueRange || 'Not specified'}</p>
          </div>
        </div>
        
        <div class="footer">
          <p>This demo request was submitted on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}.</p>
        </div>
      </body>
      </html>
    `;
    
    // Send notification email to admin
    await transporter.sendMail({
      from: `"SyneticX Demo Requests" <syneticslz@gmail.com>`,
      to: 'syneticslz@gmail.com',
      replyTo: email,
      subject: `New Demo Request: ${firstName} ${lastName} from ${company || 'Unknown Company'}`,
      html: adminHtmlEmail
    });
    
    // Send confirmation email to the user
    await transporter.sendMail({
      from: `"SyneticX" <syneticslz@gmail.com>`,
      to: email,
      subject: `Your SyneticX Demo Request - Next Steps`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Thank You for Requesting a Demo with SyneticX</title>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
            <style>
                /* Base styles */
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                
                body {
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                    line-height: 1.6;
                    color: #4b5563;
                    background-color: #f9fafb;
                    margin: 0;
                    padding: 0;
                }
                
                .email-container {
                    max-width: 600px;
                    margin: 30px auto;
                    background-color: #ffffff;
                    border-radius: 8px;
                    overflow: hidden;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
                }
                
                .email-header {
                    background: linear-gradient(to right, #3b82f6, #8b5cf6);
                    color: white;
                    padding: 28px 24px;
                    text-align: center;
                }
                
                .logo-text {
                    font-size: 24px;
                    font-weight: 700;
                    margin: 0;
                    color: white;
                }
                
                .email-body {
                    padding: 32px 24px;
                }
                
                .greeting {
                    font-size: 18px;
                    font-weight: 600;
                    color: #111827;
                    margin-bottom: 16px;
                }
                
                .message {
                    margin-bottom: 20px;
                }
                
                .next-steps {
                    background-color: #f3f4f6;
                    border-radius: 6px;
                    padding: 20px;
                    margin: 24px 0;
                }
                
                .next-steps-title {
                    font-weight: 600;
                    color: #111827;
                    margin-bottom: 12px;
                }
                
                .step {
                    margin-bottom: 12px;
                }
                
                .step-number {
                    font-weight: 600;
                    color: #3b82f6;
                }
                
                .signature {
                    margin-top: 28px;
                }
                
                .signature-name {
                    font-weight: 600;
                    color: #111827;
                }
                
                .email-footer {
                    background-color: #f9fafb;
                    padding: 20px 24px;
                    text-align: center;
                    font-size: 14px;
                    color: #6b7280;
                    border-top: 1px solid #e5e7eb;
                }
                
                .footer-text {
                    margin-bottom: 10px;
                }
                
                .automated-message {
                    font-size: 12px;
                    color: #9ca3af;
                    margin-top: 12px;
                }
            </style>
        </head>
        <body>
            <div class="email-container">
                <div class="email-header">
                    <h1 class="logo-text">SyneticX</h1>
                </div>
                
                <div class="email-body">
                    <p class="greeting">Hello ${firstName},</p>
                    
                    <p class="message">
                        Thank you for requesting a personalized demo of SyneticX's AI-powered market intelligence solutions. We're excited to show you how our platform can help optimize your business decisions.
                    </p>
                    
                    <div class="next-steps">
                        <p class="next-steps-title">What happens next?</p>
                        
                        <p class="step">
                            <span class="step-number">1.</span> Our team is reviewing your request and will reach out within 1 business day to schedule your personalized demo.
                        </p>
                        
                        <p class="step">
                            <span class="step-number">2.</span> During the demo, we'll tailor the presentation to focus on the features most relevant to your business needs.
                        </p>
                        
                        <p class="step">
                            <span class="step-number">3.</span> After the demo, we'll provide you with additional resources and a special offer to get started with SyneticX.
                        </p>
                    </div>
                    
                    <p class="message">
                        If you have any questions before your demo, feel free to reply to this email or call us at (555) 123-4567.
                    </p>
                    
                    <div class="signature">
                        <p class="signature-name">Looking forward to connecting,</p>
                        <p>The SyneticX Team</p>
                    </div>
                </div>
                
                <div class="email-footer">
                    <p class="footer-text">© 2025 SyneticX. All rights reserved.</p>
                    <p class="automated-message">This is an automated confirmation of your demo request.</p>
                </div>
            </div>
        </body>
        </html>
      `
    });
    
    res.json({ success: true, message: 'Your demo request has been submitted. We\'ll be in touch soon to schedule your personalized demo!' });
  } catch (error) {
    console.error('Demo booking error:', error);
    res.status(500).json({ success: false, error: 'Failed to book your demo. Please try again later.' });
  }
});

// Handle LinkedIn ad campaign leads
app.post('/api/linkedin-lead', async (req, res) => {
  try {
    const { 
      firstName, 
      lastName, 
      email,
      company,
      campaign,
      // LinkedIn might send additional params that we can capture
      ...linkedinParams
    } = req.body;
    
    // Validate required fields
    if (!firstName || !lastName || !email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Incomplete lead data' 
      });
    }
    
    // Save lead to database
    const newLead = new Lead({
      firstName,
      lastName,
      email,
      company,
      source: 'linkedin_ad',
      campaign,
      linkedinData: linkedinParams
    });
    
    await newLead.save();
    
    // Send notification email to admin about the LinkedIn lead
    await transporter.sendMail({
      from: `"SyneticX Lead Generation" <syneticslz@gmail.com>`,
      to: 'syneticslz@gmail.com',
      subject: `New LinkedIn Lead: ${firstName} ${lastName} from ${company || 'Unknown Company'}`,
      html: `
        <h2>New LinkedIn Campaign Lead</h2>
        <p><strong>Name:</strong> ${firstName} ${lastName}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Company:</strong> ${company || 'Not provided'}</p>
        <p><strong>Campaign:</strong> ${campaign || 'Not specified'}</p>
        <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
        <hr>
        <p>This lead was automatically captured from your LinkedIn advertising campaign.</p>
      `
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('LinkedIn lead capture error:', error);
    res.status(500).json({ success: false });
  }
});



// Email summary for warning letters and inspections
app.post('/api/wl/email-summary', async (req, res) => {
  try {
    const { 
      email, 
      includeContent, 
      includeAI, 
      message, 
      companies 
    } = req.body;
    
    console.log(`Sending warning letters summary email to ${email} for companies: ${companies?.join(', ') || 'All'}`);
    
    // Get data for the email
    let warningLettersData = [];
    let inspectionsData = { recentInspections: [], historicalInspections: [] };
    let aiAnalysis = null;
    
    // Fetch warning letters data if companies are specified
    if (companies && companies.length > 0) {
      // Get warning letters for specified companies
      warningLettersData = await getWarningLettersForCompanies(companies);
      
      // Get inspection data for specified companies
      inspectionsData = await getInspectionsForCompanies(companies);
      
      // Generate AI analysis if requested
      if (includeAI) {
        aiAnalysis = await generateAnalysis(companies, warningLettersData, inspectionsData);
      }
    } else {
      // Get recent warning letters (limit to 50)
      warningLettersData = await getRecentWarningLetters(50);
      
      // Generate general AI analysis if requested
      if (includeAI) {
        aiAnalysis = await generateGeneralAnalysis(warningLettersData);
      }
    }
    
    // Create email content
    let emailContent = '';
    
    // Add user message if provided
    if (message) {
      emailContent += `
        <div style="margin-bottom: 20px; padding: 15px; background-color: #f0f9ff; border-left: 4px solid #3b82f6;">
          <p style="font-style: italic;">${message}</p>
        </div>
      `;
    }
    
    // Add AI analysis if available and requested
    if (includeAI && aiAnalysis) {
      emailContent += `
        <div style="margin-bottom: 25px; padding: 15px; background-color: #f0f7ff; border-radius: 8px; border: 1px solid #bfdbfe;">
          <h2 style="color: #1e40af; margin-top: 0;">AI Analysis</h2>
          ${aiAnalysis.summary ? `
            <div style="margin-bottom: 15px;">
              <h3 style="color: #1e3a8a; font-size: 16px;">Summary</h3>
              <p>${aiAnalysis.summary}</p>
            </div>
          ` : ''}
          
          ${aiAnalysis.correlation ? `
            <div style="margin-bottom: 15px;">
              <h3 style="color: #1e3a8a; font-size: 16px;">Form 483 to Warning Letter Correlation</h3>
              <p>${aiAnalysis.correlation}</p>
            </div>
          ` : ''}
          
          ${aiAnalysis.marketOpportunities ? `
            <div style="margin-bottom: 15px;">
              <h3 style="color: #1e3a8a; font-size: 16px;">Market Opportunities</h3>
              <p>${aiAnalysis.marketOpportunities}</p>
            </div>
          ` : ''}
          
          ${aiAnalysis.recommendations ? `
            <div style="margin-bottom: 15px;">
              <h3 style="color: #1e3a8a; font-size: 16px;">Recommendations</h3>
              <p>${aiAnalysis.recommendations}</p>
            </div>
          ` : ''}
        </div>
      `;
    }
    
    // Add warning letters data if requested
    if (includeContent && warningLettersData.length > 0) {
      emailContent += `
        <div style="margin-bottom: 25px;">
          <h2 style="color: #1e40af;">Warning Letters (${warningLettersData.length})</h2>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
            <thead>
              <tr style="background-color: #f3f4f6;">
                <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb;">Company</th>
                <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb;">Issue Date</th>
                <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb;">Issuing Office</th>
                <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb;">Subject</th>
              </tr>
            </thead>
            <tbody>
              ${warningLettersData.map(letter => `
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="padding: 8px;">${letter.companyName}</td>
                  <td style="padding: 8px;">${formatDate(letter.letterIssueDate)}</td>
                  <td style="padding: 8px;">${letter.issuingOffice || 'Unknown'}</td>
                  <td style="padding: 8px;">${letter.subject || 'N/A'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
    
    // Add inspection data if requested
    if (includeContent && (inspectionsData.recentInspections.length > 0 || inspectionsData.historicalInspections.length > 0)) {
      emailContent += `
        <div style="margin-bottom: 25px;">
          <h2 style="color: #1e40af;">Recent Form 483s (${inspectionsData.recentInspections.length})</h2>
          ${inspectionsData.recentInspections.length > 0 ? `
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
              <thead>
                <tr style="background-color: #f3f4f6;">
                  <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb;">Date</th>
                  <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb;">Legal Name</th>
                  <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb;">Record Type</th>
                  <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb;">FEI Number</th>
                </tr>
              </thead>
              <tbody>
                ${inspectionsData.recentInspections.map(inspection => `
                  <tr style="border-bottom: 1px solid #e5e7eb;">
                    <td style="padding: 8px;">${formatDate(inspection["Record Date"])}</td>
                    <td style="padding: 8px;">${inspection["Legal Name"]}</td>
                    <td style="padding: 8px;">${inspection["Record Type"]}</td>
                    <td style="padding: 8px;">${inspection["FEI Number"]}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p style="color: #6b7280;">No recent Form 483s found</p>'}
          
          <h2 style="color: #1e40af;">Historical Inspections (${inspectionsData.historicalInspections.length})</h2>
          ${inspectionsData.historicalInspections.length > 0 ? `
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
              <thead>
                <tr style="background-color: #f3f4f6;">
                  <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb;">Firm Name</th>
                  <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb;">Location</th>
                  <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb;">Inspection Date</th>
                  <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb;">Classification</th>
                </tr>
              </thead>
              <tbody>
                ${inspectionsData.historicalInspections.map(inspection => `
                  <tr style="border-bottom: 1px solid #e5e7eb;">
                    <td style="padding: 8px;">${inspection["Firm Name"]}</td>
                    <td style="padding: 8px;">${inspection["City"] || ''}, ${inspection["State"] || ''}</td>
                    <td style="padding: 8px;">${formatDate(inspection["Inspection End Date"])}</td>
                    <td style="padding: 8px;">${inspection["Inspection Classification"] || 'N/A'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p style="color: #6b7280;">No historical inspections found</p>'}
        </div>
      `;
    }
    
    // Prepare subject line
    const subject = companies && companies.length > 0
      ? `FDA Regulatory Summary for ${companies.join(', ')}`
      : 'FDA Regulatory Summary';
    

      const emailuser = process.env.smtppassword
const emailhost = process.env.smtphost

    // Create email transporter
    const transporter = nodemailer.createTransport({
              host:  'smtp.gmail.com',
        port:  587,
        secure: false,
          auth: {
    user: process.env.smtphost,
    pass: process.env.smtppassword
  }
      });
    //   service: 'gmail',
    //   auth: {

    // user: process.env.smtphost,
    // pass: process.env.smtppassword
    //   }
    // });
    
    // Prepare HTML email
    const htmlEmail = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>FDA Regulatory Summary</title>
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
          <h2>${companies && companies.length > 0 ? companies.join(', ') : 'Recent FDA Activity'}</h2>
        </div>
        
        <p>Hello,</p>
        
        <p>Here is the FDA regulatory summary you requested${companies && companies.length > 0 ? ` for ${companies.join(', ')}` : ''}:</p>
        
        <div class="content">
          ${emailContent}
        </div>
        
        <div class="footer">
          <p>This summary was generated automatically based on FDA data as of ${new Date().toLocaleDateString()}.</p>
          <p><strong>Disclaimer:</strong> This information is provided for informational purposes only and should not be used for regulatory decision making. Always consult official FDA documentation and regulatory professionals.</p>
        </div>
      </body>
      </html>
    `;
    
    // Send email
    await transporter.sendMail({
      from: `"FDA Data Portal" <syneticslz@gmail.com>`,
      to: email,
      subject: subject,
      html: htmlEmail
    });
    
    res.json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    console.error('Email sending error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Analyze companies endpoint
app.post('/api/wl/analyze-companies', async (req, res) => {
  try {
    const { companies, includeWL = true, include483 = true } = req.body;
    
    if (!companies || !Array.isArray(companies) || companies.length === 0) {
      return res.status(400).json({ error: 'Companies parameter must be a non-empty array' });
    }
    
    // Get warning letters and inspections data for the companies
    const warningLetters = await getWarningLettersForCompanies(companies);
    const inspections = await getInspectionsForCompanies(companies);
    
    // Generate analysis using Grok API
    const analysis = await generateAnalysis(companies, warningLetters, inspections);
    
    res.json(analysis);
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate summary endpoint
app.post('/api/wl/generate-summary', async (req, res) => {
  try {
    const { includeWL = true, include483 = true, includeMarketAnalysis = true } = req.body;
    
    // Get recent warning letters (limit to 100)
    const warningLetters = await getRecentWarningLetters(100);
    
    // Generate analysis using Grok API
    const analysis = await generateGeneralAnalysis(warningLetters, includeMarketAnalysis);
    
    res.json(analysis);
  } catch (error) {
    console.error('Summary generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to get warning letters for specific companies
async function getWarningLettersForCompanies(companies) {
  const results = [];
  
  // Fetch warning letters for each company
  for (const company of companies) {
    try {
      // Query your database or API for warning letters for this company
      const response = await axios.get(`/api/wl/search?term=${encodeURIComponent(company)}&field=company&limit=50`);
      
      if (response.data && response.data.results) {
        // Add source company to each letter
        const letterWithSource = response.data.results.map(letter => ({
          ...letter,
          sourceCompany: company
        }));
        
        // Add to results, avoiding duplicates
        for (const letter of letterWithSource) {
          const letterExists = results.some(existing => existing.id === letter.id);
          if (!letterExists) {
            results.push(letter);
          }
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not fetch warning letters for ${company}:`, error.message);
    }
  }
  
  return results;
}

// Helper function to get inspections for specific companies
async function getInspectionsForCompanies(companies) {
  try {
    // Fetch all inspections data
    const response = await axios.get('/api/inspection-data');
    const data = response.data;
    
    // Create regex patterns for each company for more precise matching
    const companyPatterns = companies.map(company => 
      new RegExp(company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    );
    
    // Filter for the requested companies
    const filteredData = {
      recentInspections: data.recentInspections.filter(inspection => 
        companyPatterns.some(pattern => 
          pattern.test(inspection["Legal Name"] || '')
        )
      ),
      historicalInspections: data.historicalInspections.filter(inspection => 
        companyPatterns.some(pattern => 
          pattern.test(inspection["Firm Name"] || '')
        )
      ),
      projectAreas: data.projectAreas
    };
    
    return filteredData;
  } catch (error) {
    console.warn('Warning: Could not fetch inspection data:', error.message);
    return { recentInspections: [], historicalInspections: [], projectAreas: [] };
  }
}

// Helper function to get recent warning letters
async function getRecentWarningLetters(limit = 50) {
  try {
    // Query your database or API for recent warning letters
    const response = await axios.get(`/api/wl/search?limit=${limit}`);
    
    if (response.data && response.data.results) {
      return response.data.results;
    }
    
    return [];
  } catch (error) {
    console.warn('Warning: Could not fetch recent warning letters:', error.message);
    return [];
  }
}

// Function to generate analysis using Grok API for specific companies
async function generateAnalysis(companies, warningLetters, inspections) {
  try {
    // Define the Grok API endpoint
    const endpoint = 'https://api.grok.ai/v1/generate';
    
    // Prepare data for the prompt
    const form483Data = inspections.recentInspections.filter(
      item => item["Record Type"] === "Form 483"
    );
    
    // Build prompt for the Grok API
    const prompt = `
You are an expert FDA regulatory analyst. Analyze the following data about warning letters and Form 483s issued to pharmaceutical companies.

Companies being analyzed: ${companies.join(', ')}

Warning Letters (${warningLetters.length}):
${warningLetters.map(letter => `
- Company: ${letter.companyName}
- Issue Date: ${formatDate(letter.letterIssueDate)}
- Issuing Office: ${letter.issuingOffice || 'Unknown'}
- Subject: ${letter.subject || 'N/A'}
${letter.excerpt ? `- Excerpt: ${letter.excerpt}` : ''}
`).join('\n')}

Form 483s (${form483Data.length}):
${form483Data.map(inspection => `
- Company: ${inspection["Legal Name"]}
- Date: ${formatDate(inspection["Record Date"])}
- FEI Number: ${inspection["FEI Number"]}
`).join('\n')}

Historical Inspections (${inspections.historicalInspections.length}):
${inspections.historicalInspections.slice(0, 10).map(inspection => `
- Company: ${inspection["Firm Name"]}
- Location: ${inspection["City"] || ''}, ${inspection["State"] || ''}
- Inspection Date: ${formatDate(inspection["Inspection End Date"])}
- Project Area: ${inspection["Project Area"] || 'Unknown'}
- Classification: ${inspection["Inspection Classification"] || 'N/A'}
`).join('\n')}
${inspections.historicalInspections.length > 10 ? `... and ${inspections.historicalInspections.length - 10} more inspections` : ''}

Please provide:
1. A concise summary of the regulatory issues facing these companies
2. An analysis of the correlation between Form 483s and warning letters for these companies
3. Recommendations for how companies can prevent similar issues

Your response should be thorough but concise, focusing on patterns and insights rather than just restating the data.
    `;
    
    // Call the Grok API
    const response = await axios.post(endpoint, {
      prompt: prompt,
      max_tokens: 1500,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${GROK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Process the response
    const grokText = response.data.choices[0]?.text || '';
    
    // Parse the analysis into sections
    const analysis = {
      summary: extractSection(grokText, 'summary', 'correlation'),
      correlation: extractSection(grokText, 'correlation', 'recommendations'),
      recommendations: extractSection(grokText, 'recommendations')
    };
    
    return analysis;
  } catch (error) {
    console.error('Error generating analysis with Grok API:', error);
    
    // Return fallback analysis if API fails
    return {
      summary: "Based on the available data, these companies have faced regulatory scrutiny primarily in areas of quality control, data integrity, and manufacturing processes. The pattern of observations suggests systematic issues that require comprehensive remediation approaches.",
      correlation: "There appears to be a correlation between Form 483 observations and subsequent warning letters, typically with a 3-6 month delay if issues are not adequately addressed. The most significant violations in Form 483s frequently become central themes in warning letters.",
      recommendations: "Companies should: 1) Implement robust CAPA systems, 2) Ensure thorough documentation of manufacturing processes, 3) Invest in data integrity systems, 4) Create cross-functional teams to address observations quickly, and 5) Perform regular self-audits to identify issues before FDA inspections."
    };
  }
}

// Function to generate general market analysis using Grok API
async function generateGeneralAnalysis(warningLetters, includeMarketAnalysis = true) {
  try {
    // Define the Grok API endpoint
    const endpoint = 'https://api.grok.ai/v1/generate';
    
    // Build prompt for the Grok API
    const prompt = `
You are an expert FDA regulatory analyst. Analyze the following data about recent warning letters issued to pharmaceutical companies.

Recent Warning Letters (${warningLetters.length}):
${warningLetters.slice(0, 20).map(letter => `
- Company: ${letter.companyName}
- Issue Date: ${formatDate(letter.letterIssueDate)}
- Issuing Office: ${letter.issuingOffice || 'Unknown'}
- Subject: ${letter.subject || 'N/A'}
${letter.excerpt ? `- Excerpt: ${letter.excerpt}` : ''}
`).join('\n')}
${warningLetters.length > 20 ? `... and ${warningLetters.length - 20} more warning letters` : ''}

Please provide:
1. A concise summary of current regulatory trends based on these warning letters
${includeMarketAnalysis ? '2. Analysis of potential market opportunities these regulatory actions might create\n3. Recommended actions for companies looking to capitalize on these market opportunities' : ''}

Your response should be thorough but concise, focusing on patterns and insights rather than just restating the data.
    `;
    
    // Call the Grok API
    const response = await axios.post(endpoint, {
      prompt: prompt,
      max_tokens: 1500,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${GROK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Process the response
    const grokText = response.data.choices[0]?.text || '';
    
    // Parse the analysis into sections
    const analysis = {
      summary: extractSection(grokText, 'summary', includeMarketAnalysis ? 'market opportunities' : null),
      marketOpportunities: includeMarketAnalysis ? extractSection(grokText, 'market opportunities', 'recommended actions') : null,
      recommendedActions: includeMarketAnalysis ? extractSection(grokText, 'recommended actions') : null
    };
    
    return analysis;
  } catch (error) {
    console.error('Error generating analysis with Grok API:', error);
    
    // Return fallback analysis if API fails
    return {
      summary: "Recent FDA warning letters indicate increased regulatory focus on data integrity, aseptic processing controls, and validation of manufacturing processes. There's a noticeable trend toward stricter enforcement of cGMP requirements, especially for facilities involved in producing critical medications and sterile products.",
      marketOpportunities: includeMarketAnalysis ? "Companies with strong compliance records may find opportunities to fill supply gaps created by competitors' regulatory challenges. The most significant opportunities appear in sterile injectables, complex generics, and testing/validation services sectors where regulatory hurdles have created market constraints." : null,
      recommendedActions: includeMarketAnalysis ? "Companies should consider: 1) Acquiring or expanding capacity in areas affected by competitor warning letters, 2) Developing consulting services focused on remediation of commonly cited deficiencies, 3) Implementing enhanced quality systems that exceed minimum regulatory requirements, 4) Pursuing expedited review pathways for products facing shortage conditions." : null
    };
  }
}

// Helper function to extract sections from Grok API response
function extractSection(text, sectionName, nextSectionName = null) {
  const sectionPattern = new RegExp(`(?:^|\\n)\\s*(?:\\d+\\.\\s*)?${sectionName}\\s*:?\\s*\\n`, 'i');
  const match = text.match(sectionPattern);
  
  if (!match) return null;
  
  const startIndex = match.index + match[0].length;
  let endIndex;
  
  if (nextSectionName) {
    const nextSectionPattern = new RegExp(`(?:^|\\n)\\s*(?:\\d+\\.\\s*)?${nextSectionName}\\s*:?\\s*\\n`, 'i');
    const nextMatch = text.match(nextSectionPattern);
    endIndex = nextMatch ? nextMatch.index : text.length;
  } else {
    endIndex = text.length;
  }
  
  return text.substring(startIndex, endIndex).trim();
}

// Helper function to format dates
function formatDate(dateString) {
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




// Helper function to parse Form 483 PDFs
async function parseForm483Pdf(url) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const data = await pdfParse(response.data);
    return data.text; // Extracted text from PDF
  } catch (error) {
    console.error(`Error parsing PDF from ${url}:`, error.message);
    return 'Unable to parse PDF content';
  }
}

// New endpoint for warning letter-specific summary
app.post('/api/generate-warning-letter-summary', async (req, res) => {
  try {
    const { companies, warningLetters, form483s, maxTokens = 3000, temperature = 0.7 } = req.body;
    const grokApiKey = GROK_API_KEY;
    const grokApiUrl = GROK_API_URL;

    // Validate inputs
    if (!companies || !Array.isArray(companies) || companies.length === 0) {
      return res.status(400).json({ success: false, error: 'companies are required' });
    }
    if (!warningLetters || !form483s) {
      return res.status(400).json({ success: false, error: 'warningLetters and form483s are required' });
    }

    console.log(`Generating Grok warning letter summary for companies: ${companies.join(', ')}`);

    // Parse Form 483 PDFs to extract observations
    const form483sWithObservations = await Promise.all(form483s.map(async (form) => {
      const observations = form["Download"] ? await parseForm483Pdf(form["Download"]) : 'No observations available';
      return {
        ...form,
        observations: observations.substring(0, 1000) + (observations.length > 1000 ? '...' : '') // Limit length
      };
    }));

    // Construct detailed prompt for Grok AI
    const prompt = `
      You are tasked with generating an in-depth, professional HTML summary of FDA warning letters and Form 483s for the following pharmaceutical companies: ${companies.join(', ')}. The analysis must be comprehensive, drug-agnostic, and focus on regulatory compliance issues and competitive opportunities. Address the following requirements in detail:

      1. **Link Form 483s to Warning Letters**: Identify specific instances where a Form 483 preceded a warning letter for the same company, including dates, time gaps (in days), and nature of issues. Discuss the severity and implications of these progressions.
      2. **Analyze Form 483-to-Warning Letter Ratio**: Calculate the percentage of Form 483s that escalated to warning letters for each company and overall. Assess regulatory risk (e.g., low, moderate, high) based on escalation rates and issue severity.
      3. **Highlight Manufacturing Issues**: Identify and categorize manufacturing deficiencies from warning letters and Form 483 observations. Provide detailed descriptions, including root causes (if available), impact on operations, and potential market effects. Note limitations if Form 483 observations are incomplete.
      4. **Provide Competitive Insights**: Offer detailed, actionable opportunities for competitors, such as:
         - Offering alternative manufacturing or supply solutions for non-compliant companies.
         - Forming partnerships or compliance consulting services.
         - Targeting customers of non-compliant companies with targeted campaigns.
         - Strategies for compliant companies (e.g., innovation, cost optimization, monitoring).
      5. **Regulatory Trends and Risk Assessment**: Analyze trends in regulatory actions (e.g., increasing scrutiny, common issue types) and assess long-term risks for each company based on their compliance history.

      **Data Provided**:
      - **Warning Letters**: ${JSON.stringify(warningLetters.map(wl => ({
        companyName: wl.companyName,
        letterId: wl.letterId,
        letterIssueDate: wl.letterIssueDate,
        subject: wl.subject,
        fullContent: wl.fullContent?.substring(0, 500) + '...' || 'N/A',
        companyUrl: wl.companyUrl
      })))}
      - **Form 483s**: ${JSON.stringify(form483sWithObservations.map(f => ({
        legalName: f["Legal Name"],
        recordDate: f["Record Date"],
        feiNumber: f["FEI Number"],
        download: f["Download"],
        observations: f.observations
      })))}

      **Output Requirements**:
      - Generate a fully structured HTML summary using Tailwind CSS (CDN: https://cdn.tailwindcss.com) for styling.
      - Include detailed per-company sections and an overall market analysis, with subheadings for regulatory profile, escalation risk, progression, manufacturing issues, competitive opportunities, and trends.
      - Use live, verified links to warning letters (e.g., https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/[letterId]) and Form 483s (use the Download URL).
      - Add a footer with source attribution (e.g., FDA.gov) and timestamp (current date: ${new Date().toISOString()}).
      - Ensure responsive design, clear typography, hover effects, and professional layout with vibrant colors and smooth animations.
      - Verify all data for accuracy and relevance to the companies’ regulatory profiles.

      **Example Structure**:
      <div class="container mx-auto p-4">
        <h1 class="text-3xl font-bold mb-4">Regulatory Compliance Summary</h1>
        <!-- Per-Company Sections -->
        <div class="mt-6">
          <h2 class="text-2xl font-semibold mb-2">Company: [Company Name]</h2>
          <p><strong>Regulatory Profile:</strong> X Form 483s, Y Warning Letters</p>
          <p><strong>Escalation Risk:</strong> Z% of Form 483s escalated ([Risk Level])</p>
          <p><strong>Progression:</strong> <a href="[link]" class="text-blue-600 hover:underline">Form 483 (date)</a> led to <a href="[link]" class="text-blue-600 hover:underline">Warning Letter (date)</a></p>
          <p><strong>Manufacturing Issues:</strong> [Detailed Issues]</p>
          <p><strong>Competitive Opportunities:</strong> [Detailed Strategies]</p>
          <p><strong>Regulatory Trends:</strong> [Trends and Risks]</p>
        </div>
        <!-- Overall Analysis -->
        <div class="mt-6">
          <h2 class="text-2xl font-semibold mb-2">Overall Market Analysis</h2>
          <p><strong>Market Regulatory Profile:</strong> X Form 483s, Y Warning Letters</p>
          <p><strong>Market-Wide Opportunities:</strong> [Detailed Strategies]</p>
          <p><strong>Industry Trends:</strong> [Trends and Risks]</p>
        </div>
        <!-- Footer -->
        <footer class="mt-6 text-sm text-gray-600">
          <p>Sources: <a href="https://www.fda.gov" class="text-blue-600 hover:underline">FDA.gov</a></p>
          <p>Generated on: [Timestamp]</p>
        </footer>
      </div>
    `;

    // Call Grok API
    const response = await axios.post(grokApiUrl, {
      model: "grok-2",
      messages: [
        {
          role: "system",
          content: `You are an advanced AI assistant specializing in FDA regulatory information analysis for pharmaceutical companies. Your task is to create in-depth, visually appealing, and responsive HTML summaries of FDA warning letters and Form 483s, prioritizing critical regulatory insights, manufacturing issues, and actionable competitive opportunities. Use Tailwind CSS for modern UI design with vibrant colors, smooth animations, and professional layout. Ensure all summaries include live, verified links to source documents (e.g., FDA warning letters, Form 483 PDFs) for professional verification. The design must be fully responsive, with hover effects, clear typography, and intuitive navigation. Verify all data for accuracy as of the current date (${new Date().toISOString().split('T')[0]}) and include a footer with source attribution and timestamp.`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: maxTokens,
      temperature: temperature
    }, {
      headers: {
        'Authorization': `Bearer ${grokApiKey}`,
        'Content-Type': 'application/json'
      }
    });

    // Extract the HTML summary
    const summary = response.data.choices[0].message.content.trim();

    res.json({ success: true, summary });
  } catch (error) {
    console.error('Grok API error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

async function searchDrugsForConditionfromdrug(condition) {
  try {
    // Step 1: Normalize condition name for search
    const normalizedCondition = encodeURIComponent(condition.trim().toLowerCase());

    // Step 2: Use RxNorm API to find drugs (we'll search for drugs by condition indirectly)
    // RxNorm doesn't directly map conditions, so we'll use a web search to find drug names first
    const searchUrl = `https://www.drugs.com/search.php?searchterm=${normalizedCondition}`;
    const searchResponse = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    // Parse HTML with Cheerio to extract drug names
    const $ = cheerio.load(searchResponse.data);
    const drugs = [];
    $('.ddc-search-results .ddc-media').each((i, element) => {
      const drugName = $(element).find('.ddc-media-content a').text().trim();
      const drugLink = 'https://www.drugs.com' + $(element).find('.ddc-media-content a').attr('href');
      if (drugName) {
        drugs.push({ name: drugName, source: drugLink });
      }
    });

    // Step 3: Enrich drug data with RxNorm API
    const enrichedDrugs = [];
    for (const drug of drugs) {
      try {
        const rxnormUrl = `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(drug.name)}`;
        const rxnormResponse = await axios.get(rxnormUrl);
        const rxcui = rxnormResponse.data.idGroup.rxnormId ? rxnormResponse.data.idGroup.rxnormId[0] : null;

        if (rxcui) {
          // Fetch additional details (e.g., drug class)
          const drugInfoUrl = `https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/allProperties.json`;
          const drugInfoResponse = await axios.get(drugInfoUrl);
          const properties = drugInfoResponse.data.propConceptGroup?.propConcept || [];
          const drugClass = properties.find(prop => prop.propName === 'RxClass')?.propValue || 'Unknown';

          enrichedDrugs.push({
            name: drug.name,
            rxcui: rxcui,
            drugClass: drugClass,
            condition: condition,
            source: drug.source,
            retrievedAt: new Date().toISOString()
          });
        } else {
          enrichedDrugs.push({
            name: drug.name,
            rxcui: null,
            drugClass: 'Unknown',
            condition: condition,
            source: drug.source,
            retrievedAt: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error(`Error fetching RxNorm data for ${drug.name}:`, error.message);
        enrichedDrugs.push({
          name: drug.name,
          rxcui: null,
          drugClass: 'Unknown',
          condition: condition,
          source: drug.source,
          retrievedAt: new Date().toISOString()
        });
      }
    }

    console.log("drugs : ", enrichedDrugs)
    return enrichedDrugs;
  } catch (error) {
    console.error('Error searching drugs:', error.message);
    throw new Error('Failed to fetch drug data');
  }
}


// Express route to handle condition-to-drugs query
app.post('/api/conditions/drugs', async (req, res) => {
  const { condition } = req.body;

  if (!condition || typeof condition !== 'string') {
    return res.status(400).json({ error: 'Condition name is required and must be a string' });
  }

  try {
    const drugs = await searchDrugsForConditionfromdrug(condition);
    res.json({
      condition,
      drugs,
      total: drugs.length,
      requestId: uuidv4(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch drugs', details: error.message });
  }
});

/**
 * Generate FDA summary using OpenAI
 * POST /api/generate-summary
 */
app.post('/api/generate-summary', async (req, res) => {
  try {
    const { prompt, maxTokens, temperature, drugName } = req.body;

    // const GROK_API_URL = ''; // Updated to correct base URL


    const grokApiKey = process.env.grok;
    const grokApiUrl = 'https://api.x.ai/v1/chat/completions'; // Your Grok chat completions URL
    

    
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
          content: "You are an advanced AI assistant specializing in FDA regulatory information analysis for pharmaceutical drugs. Your task is to create visually appealing, highly structured, and responsive HTML summaries of FDA data, prioritizing critical safety information, dosing details, and actionable insights. Enhance the user experience with modern UI design, including vibrant colors, smooth animations, and a professional layout using Tailwind CSS and custom styles. Incorporate a dedicated section for research insights, ensuring all information is 100% accurate with verified, working links to credible sources (e.g., FDA.gov, DailyMed, peer-reviewed journals). Ensure the design is fully responsive across devices, with hover effects, clear typography, and intuitive navigation. Verify all data for accuracy as of the current date and include a footer with source attribution and update timestamp. every metric or data you show in this must be backed up with a live link please that my clients can use to verify the data. Please make sure the links work Please start straight with the code and finish at the end of the code, dont say anthing before of after that souldnt be added to the final dashboard as i will port teh response directly into a website please." 

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
    const emailuser = process.env.smtppassword
    const emailhost = process.env.smtphost

    // Create email transporter
    const transporter = nodemailer.createTransport({
      // Your email service configuration
              host:  'smtp.gmail.com',
        port:  587,
        secure: false,
          auth: {
    user: process.env.smtphost,
    pass: process.env.smtppassword
  }
      });
    //   service: 'gmail',
    //   auth: {
    // user: process.env.smtphost,
    // pass: process.env.smtppassword
    //   }
    // });
    
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


// API endpoint for analyzing chemistry reviews
app.post('/api/analyze-chemistry-reviews', async (req, res) => {
  const { reviews } = req.body;
  
  if (!reviews || !Array.isArray(reviews) || reviews.length === 0) {
    return res.status(400).json({ error: 'Valid reviews array is required' });
  }
  
  try {
    // Create temp directory if it doesn't exist
    const tempDir = path.join(__dirname, 'temp-uploads');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Process each review document
    console.log(`Processing ${reviews.length} chemistry reviews`);
    
    // Limit to max 5 documents to prevent timeouts
    const limitedReviews = reviews.slice(0, 5);
    
    // Collect all text content
    let allTexts = [];
    let processedCount = 0;
    
    for (const review of limitedReviews) {
      try {
        // Generate a unique filename
        const pdfFilename = `chem-review-${Date.now()}-${processedCount}.pdf`;
        const pdfPath = path.join(tempDir, pdfFilename);
        
        // Download the PDF
        console.log(`Downloading PDF from: ${review.url}`);
        const response = await axios({
          method: 'get',
          url: review.url,
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
        
        // Extract text content from the PDF
        const text = await extractTextFromPDF(pdfPath);
        
        // Add metadata and text to our collection
        allTexts.push({
          productName: review.productName,
          applicationNumber: review.applicationNumber,
          documentName: review.name,
          text: text.substring(0, 4000) // Limit text size for each document
        });
        
        // Clean up the temp file
        try {
          fs.unlinkSync(pdfPath);
        } catch (error) {
          console.error('Error cleaning up file:', error);
        }
        
        processedCount++;
        
      } catch (error) {
        console.error(`Error processing review ${review.name}:`, error);
        // Continue with next document even if one fails
      }
    }
    
    if (allTexts.length === 0) {
      throw new Error('Failed to process any of the provided documents');
    }
    
    // Analyze all text content together with the Grok API
    const summary = await analyzeChemistryReviewsWithGrokAPI(allTexts);
    
    res.json({
      success: true,
      summary: summary,
      processedCount: processedCount,
      totalProvided: reviews.length
    });
    
  } catch (error) {
    console.error('Chemistry reviews analysis error:', error);
    res.status(500).json({ 
      error: 'Error analyzing chemistry reviews',
      details: error.message
    });
  }
});

// Function to analyze chemistry reviews with Grok API
async function analyzeChemistryReviewsWithGrokAPI(reviewTexts) {
  try {
    // Build a context string with information about each document
    let contextString = "I have analyzed the following chemistry review documents from FDA submissions:\n\n";
    
    reviewTexts.forEach((review, index) => {
      contextString += `Document ${index + 1}: ${review.productName} (${review.applicationNumber}) - ${review.documentName}\n`;
      
      // Add a brief excerpt from each document
      const excerpt = review.text.substring(0, 300).replace(/\n+/g, ' ').trim() + '...';
      contextString += `Excerpt: ${excerpt}\n\n`;
    });
    
    // Build a combined text with the most relevant parts of each document
    let combinedText = "";
    reviewTexts.forEach((review, index) => {
      combinedText += `\n\n--- DOCUMENT ${index + 1}: ${review.productName} (${review.applicationNumber}) ---\n\n`;
      combinedText += review.text.substring(0, 4000); // Limit each document's text
    });
    
    // Truncate if too long
    const maxLength = 12000;
    const truncatedText = combinedText.length > maxLength 
      ? combinedText.substring(0, maxLength) + '...[truncated]' 
      : combinedText;
    
    const payload = {
      messages: [
        {
          role: "system",
          content: "You are an AI assistant that specializes in analyzing FDA chemistry review documents. Create a comprehensive summary that synthesizes information from multiple chemistry reviews, focusing on: 1) Chemical composition and formulation details, 2) Manufacturing processes, 3) Analytical methods and specifications, 4) Stability data and shelf life, 5) Key quality control considerations, and 6) Any significant chemistry-related findings. Format your response with clear markdown headings and bullet points where appropriate."
        },
        {
          role: "user",
          content: [
            { 
              type: "text", 
              text: `${contextString}\n\nBased on these chemistry review documents, provide a comprehensive summary that synthesizes the key chemistry, manufacturing, and controls information. The full text content is below:\n\n${truncatedText}` 
            }
          ]
        }
      ],
      model: "grok-2-latest",
      stream: false,
      temperature: 0
    };
    
    console.log('Sending request to Grok API for chemistry review analysis...');
    
    const response = await axios.post(GROK_API_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROK_API_KEY}`
      },
      timeout: 90000 // 90 second timeout for processing multiple documents
    });
    
    console.log('Received response from Grok API for chemistry review analysis');
    
    if (response.data && response.data.choices && response.data.choices[0]) {
      return response.data.choices[0].message.content;
    } else {
      console.error('Invalid response structure from Grok API:', JSON.stringify(response.data));
      throw new Error('Invalid response from Grok API');
    }
    
  } catch (error) {
    console.error('Grok API Error for chemistry reviews:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
    
    // Fall back to a basic analysis if API fails
    return fallbackChemistryAnalysis(reviewTexts, error);
  }
}

// Fallback function for chemistry reviews when API calls fail
function fallbackChemistryAnalysis(reviewTexts, error) {
  const productNames = reviewTexts.map(r => r.productName).join(', ');
  const appNumbers = reviewTexts.map(r => r.applicationNumber).join(', ');
  
  return `
## Chemistry Reviews Analysis Summary

**Note: This is a fallback analysis due to an error in the AI processing system.**
Error details: ${error.message}

### Overview
This summary is based on chemistry review documents for the following products:
- ${productNames}

### Application Information
- Application Numbers: ${appNumbers}
- Total Documents Analyzed: ${reviewTexts.length}

### Limited Chemistry Analysis
The documents appear to contain information about drug chemistry, manufacturing processes, and controls that would typically include details about formulation, stability, and quality control measures.

For a complete analysis, please try again later or consult the original documents directly.
`;
}


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
    const grokApiKey = process.env.grok;
    const grokApiUrl = 'https://api.x.ai/v1/chat/completions';

    // const payload = {
    //   messages: [
    //     {
    //       role: "system",
    //       content: "You are an AI assistant that specializes in analyzing FDA documents. Provide a clear, concise summary of the key information in the document, focusing on: 1) Drug name and active ingredients, 2) Approved indications, 3) Important safety information, 4) Dosage recommendations, 5) Contraindications, and 6) Any special populations or warnings. Format your response with clear markdown headings."
    //     },
    //     {
    //       role: "user",
    //       content: [
    //         { 
    //           type: "text", 
    //           text: `Analyze and summarize this FDA document content:\n\n${truncatedText}` 
    //         }
    //       ]
    //     }
    //   ],
    //   model: "grok-2-latest",
    //   stream: false,
    //   temperature: 0
    // };
    
    console.log('Sending request to Grok API...');
    
    // const response = await axios.post('https://api.x.ai/v1/chat/completions', payload, {
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'Authorization': `Bearer ${grokApiKey}`
    //   },
    //   timeout: 60000 // 60 second timeout
    // });

      const response = await axios.post(grokApiUrl, {
      model: "grok-2", // Add the required model field - update to your specific Grok model name if different
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
      max_tokens:  1500,
      temperature:  0.7
    }, {
      headers: {
        'Authorization': `Bearer ${grokApiKey}`,
        'Content-Type': 'application/json'
      }
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
// const httpsAgent = new https.Agent({
//   rejectUnauthorized: false
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

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
const limiter = new Bottleneck({
  minTime: 2000, // 2 seconds between requests
  maxConcurrent: 30,
});

// Path to cache file
const CACHE_FILE = path.join(__dirname, 'cache.json');

// Initialize axios with a custom User-Agent
const axiosInstance = axios.create({
  headers: {
    'User-Agent': 'MyFDAScraper/1.0 (contact: your-email@example.com)',
    'Accept': 'text/html,application/xhtml+xml,application/xml',
    'Accept-Language': 'en-US,en;q=0.9',
  },
  timeout: 15000,
  maxRedirects: 5,
});

// Assume httpsAgent is defined elsewhere in your codebase
// If not, you may need to configure it, e.g.:


// Wrap axios requests with rate limiter
const rateLimitedFetch = limiter.wrap(axiosInstance.get);
const rateLimitedHead = limiter.wrap(axiosInstance.head);

async function readCache() {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, initialize empty cache
      return {};
    }
    console.error('Error reading cache:', error.message);
    return {};
  }
}

async function writeCache(cacheData) {
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify(cacheData, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing to cache:', error.message);
  }
}

async function getFromCache(key) {
  const cache = await readCache();
  return cache[key] || null;
}

async function setInCache(key, value) {
  const cache = await readCache();
  cache[key] = value;
  await writeCache(cache);
}

app.get('/api/fda-pdfs/:appNo', async (req, res) => {
  try {
    const appNoInput = req.params.appNo;
    const appNo = appNoInput.startsWith('NDA') ? appNoInput.substring(3) : appNoInput;
    const cacheKey = `fda-pdfs-${appNo}`;

    // Check cache first
    const cachedResult = await getFromCache(cacheKey);
    if (cachedResult) {
      console.log(`Serving from cache: ${cacheKey}`);
      return res.json(cachedResult);
    }

    // Try the DAF URL first
    const dafUrl = `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appNo}`;
    console.log(`Fetching primary URL: ${dafUrl}`);

    // Fetch HTML content
    let html = await fetchHtml(dafUrl);

    // If that fails or has no results, try the direct TOC URL
    if (!html || html.includes('No matching records found')) {
      const year = new Date().getFullYear();
      const tocUrl = `https://www.accessdata.fda.gov/drugsatfda_docs/nda/${year}/${appNo}s000TOC.cfm`;
      console.log(`No results from primary URL, trying TOC URL: ${tocUrl}`);
      html = await fetchHtml(tocUrl);
    }

    if (!html) {
      return res.status(500).json({
        error: 'Failed to fetch HTML content',
        message: 'Could not retrieve content from FDA databases for this application number.',
      });
    }

    // Extract PDF links
    let pdfLinks = await extractPdfLinks(html);

    // If still no PDFs, try some variations of the TOC URL
    if (pdfLinks.length === 0) {
      const yearsToTry = [new Date().getFullYear() - 1, new Date().getFullYear() - 2];
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

    // Group results by document type
    const groupedResults = {};
    pdfLinks.forEach((link) => {
      const type = link.type;
      if (!groupedResults[type]) {
        groupedResults[type] = [];
      }
      groupedResults[type].push({
        name: link.name,
        url: link.url,
      });
    });

    // If still no PDFs found
    if (pdfLinks.length === 0) {
      return res.status(404).json({
        message: `No PDF documents found for application number ${appNo}`,
        total: 0,
        results: [],
      });
    }

    // Prepare response
    const response = {
      message: 'PDF links retrieved successfully',
      total: pdfLinks.length,
      groupedResults: groupedResults,
      results: pdfLinks.map((link) => ({
        name: link.name,
        url: link.url,
        type: link.type,
      })),
    };

    // Cache the response
    await setInCache(cacheKey, response);
    res.json(response);
  } catch (error) {
    console.error('API Error:', error);
    if (error.response && error.response.status === 429) {
      console.log('Rate limit exceeded, retrying after delay...');
      await new Promise((resolve) => setTimeout(resolve, 10000));
      return res.redirect(req.originalUrl);
    }
    res.status(500).json({
      error: 'An error occurred while processing the request',
      details: error.message,
    });
  }
});

// Function to fetch the HTML content from the URL
async function fetchHtml(url) {
  try {
    const cacheKey = `html-${url}`;
    const cachedHtml = await getFromCache(cacheKey);
    if (cachedHtml) {
      console.log(`Serving HTML from cache: ${url}`);
      return cachedHtml;
    }

    const response = await rateLimitedFetch(url, {
      httpsAgent, // Assumed to be defined
    });

    // Check for error messages in the HTML
    if (
      response.data &&
      (response.data.includes('No matching records found') ||
        response.data.includes('Page Not Found') ||
        response.data.includes('Error 404'))
    ) {
      console.log(`Page found but contains error message: ${url}`);
      return null;
    }

    await setInCache(cacheKey, response.data);
    return response.data;
  } catch (error) {
    console.error(`Error fetching URL: ${url}`);
    console.error(`Error details: ${error.message}`);
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
    if (
      href.includes('#collapse') ||
      href.includes('warning-letters') ||
      href.includes('javascript:') ||
      href.includes('accessdata.fda.gov/#') ||
      href === '#' ||
      href === '' ||
      href === 'javascript:void(0)'
    ) {
      return;
    }

    // Check if it's a PDF link or a link to a review/label/letter
    if (
      href.includes('.pdf') ||
      href.includes('drugsatfda_docs') ||
      text.includes('PDF') ||
      text.includes('Review') ||
      text.includes('Label') ||
      text.includes('Letter')
    ) {
      let fullUrl = makeFullUrl(href);

      // Validate URL format to avoid malformed URLs
      if (!isValidUrl(fullUrl)) {
        console.log(`Skipping invalid URL: ${fullUrl}`);
        return;
      }

      links.push({
        name: text || 'No description',
        url: fullUrl,
        type: determineType(text, href),
      });
    }
  });

  // Look for TOC links and process them
  const tocLinks = links.filter((link) =>
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
    if (
      link.url.includes('#collapse') ||
      link.url.includes('accessdata.fda.gov/#') ||
      !isValidUrl(link.url)
    ) {
      continue;
    }

    if (!seenUrls.has(link.url)) {
      seenUrls.add(link.url);
      uniqueLinks.push(link);
    }
  }

  return uniqueLinks;
}

// Process TOC page and extract PDF links
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
    if (
      relativeUrl.includes('#collapse') ||
      relativeUrl.includes('accessdata.fda.gov/#') ||
      relativeUrl === '#' ||
      relativeUrl === '' ||
      relativeUrl === 'javascript:void(0)'
    ) {
      return;
    }

    // Construct absolute URL
    let absoluteUrl;
    if (relativeUrl.startsWith('http')) {
      absoluteUrl = relativeUrl;
    } else if (relativeUrl.startsWith('/')) {
      absoluteUrl = `${baseUrl}${relativeUrl}`;
    } else {
      absoluteUrl = `${baseUrl}${currentPath}/${relativeUrl}`;
    }

    // Validate the URL
    if (!isValidUrl(absoluteUrl)) {
      console.log(`Skipping invalid URL from TOC page: ${absoluteUrl}`);
      return;
    }

    // Get parent context for categorization
    let category = '';
    const parentPanel = $(element).closest('.panel');
    if (parentPanel.length) {
      const panelHeading = parentPanel.find('.panel-heading').text().trim();
      if (panelHeading) {
        category = panelHeading;
      }
    }

    if (!category) {
      let prevElement = $(element).prev('h1, h2, h3, h4, h5, p, li');
      if (prevElement.length) {
        category = prevElement.text().trim();
      } else {
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
      originalCategory: category,
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

// Function to standardize type based on category, title, and URL
function standardizeType(category, title, url) {
  const combinedText = (category + ' ' + title + ' ' + url).toLowerCase();

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
    { terms: ['letter'], type: 'Letter' },
  ];

  for (const mapping of typeMapping) {
    if (mapping.terms.some((term) => combinedText.includes(term))) {
      return mapping.type;
    }
  }

  if (combinedText.includes('review')) {
    return 'Review';
  } else if (combinedText.includes('label')) {
    return 'Label';
  }

  return 'Other';
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

// Function to validate URLs before adding them to the results
async function validateUrl(url) {
  try {
    const response = await rateLimitedHead(url, {
      httpsAgent,
      timeout: 5000,
    });
    return response.status >= 200 && response.status < 400;
  } catch (error) {
    console.error(`URL validation failed for ${url}: ${error.message}`);
    return false;
  }
}

// app.get('/api/fda-pdfs/:appNo', async (req, res) => {
//   try {
//     const appNoInput = req.params.appNo;
//     // Strip "NDA" prefix if present
//     const appNo = appNoInput.startsWith('NDA') ? appNoInput.substring(3) : appNoInput;
    
//     // Try the DAF URL first
//     const dafUrl = `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appNo}`;
//     console.log(`Fetching primary URL: ${dafUrl}`);
    
//     // Fetch HTML content
//     let html = await fetchHtml(dafUrl);
    
//     // If that fails or has no results, try the direct TOC URL
//     if (!html || html.includes('No matching records found')) {
//       const year = new Date().getFullYear(); // Current year as a fallback
//       const tocUrl = `https://www.accessdata.fda.gov/drugsatfda_docs/nda/${year}/${appNo}s000TOC.cfm`;
//       console.log(`No results from primary URL, trying TOC URL: ${tocUrl}`);
//       html = await fetchHtml(tocUrl);
//     }
    
//     if (!html) {
//       return res.status(500).json({
//         error: 'Failed to fetch HTML content',
//         message: 'Could not retrieve content from FDA databases for this application number.'
//       });
//     }
    
//     // Extract PDF links
//     let pdfLinks = await extractPdfLinks(html);
    
//     // If still no PDFs, try some variations of the TOC URL
//     if (pdfLinks.length === 0) {
//       const yearsToTry = [new Date().getFullYear() - 1, new Date().getFullYear() - 2]; // Try previous years
      
//       for (const year of yearsToTry) {
//         const alternateTocUrl = `https://www.accessdata.fda.gov/drugsatfda_docs/nda/${year}/${appNo}Orig1s000TOC.cfm`;
//         console.log(`Trying alternate TOC URL: ${alternateTocUrl}`);
//         const alternateHtml = await fetchHtml(alternateTocUrl);
        
//         if (alternateHtml) {
//           const alternateLinks = await processTocPage(alternateHtml, alternateTocUrl);
//           if (alternateLinks.length > 0) {
//             pdfLinks = alternateLinks;
//             break;
//           }
//         }
//       }
//     }
    
//     // Group results by document type for better organization
//     const groupedResults = {};
//     pdfLinks.forEach(link => {
//       const type = link.type;
//       if (!groupedResults[type]) {
//         groupedResults[type] = [];
//       }
//       groupedResults[type].push({
//         name: link.name,
//         url: link.url
//       });
//     });
    
//     // If still no PDFs found
//     if (pdfLinks.length === 0) {
//       return res.status(404).json({
//         message: `No PDF documents found for application number ${appNo}`,
//         total: 0,
//         results: []
//       });
//     }
    
//     // Return JSON response with PDF names and links
//     res.json({
//       message: 'PDF links retrieved successfully',
//       total: pdfLinks.length,
//       groupedResults: groupedResults,
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

// // Function to fetch the HTML content from the URL
// async function fetchHtml(url) {
//   try {
//     const response = await axios.get(url, {
//       httpsAgent,
//       headers: {
//         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
//         'Accept': 'text/html,application/xhtml+xml,application/xml',
//         'Accept-Language': 'en-US,en;q=0.9'
//       },
//       timeout: 15000, // 15 seconds timeout
//       maxRedirects: 5
//     });
    
//     // Check for error messages in the HTML
//     if (response.data && 
//         (response.data.includes('No matching records found') ||
//          response.data.includes('Page Not Found') ||
//          response.data.includes('Error 404'))) {
//       console.log(`Page found but contains error message: ${url}`);
//       return null;
//     }
    
//     return response.data;
//   } catch (error) {
//     console.error(`Error fetching URL: ${url}`);
//     console.error(`Error details: ${error.message}`);
    
//     // If the error has a response, log some details
//     if (error.response) {
//       console.error(`Status: ${error.response.status}`);
//       console.error(`Headers: ${JSON.stringify(error.response.headers)}`);
//     }
    
//     return null;
//   }
// }

// // Function to extract PDF links from the HTML content
// async function extractPdfLinks(html) {
//   const $ = cheerio.load(html);
//   let links = [];
  
//   // Process regular links
//   $('a').each((index, element) => {
//     const href = $(element).attr('href');
//     const text = $(element).text().trim();
    
//     // Skip if href is undefined or empty
//     if (!href) return;
    
//     // Skip known bad links and patterns
//     if (href.includes('#collapse') || 
//         href.includes('warning-letters') ||
//         href.includes('javascript:') ||
//         href.includes('accessdata.fda.gov/#') ||
//         href === '#' ||
//         href === '' ||
//         href === 'javascript:void(0)') {
//       return;
//     }
    
//     // Check if it's a PDF link or a link to a review/label/letter
//     if (href.includes('.pdf') || 
//         href.includes('drugsatfda_docs') ||
//         text.includes('PDF') ||
//         text.includes('Review') ||
//         text.includes('Label') ||
//         text.includes('Letter')) {
      
//       let fullUrl = makeFullUrl(href);
      
//       // Validate URL format to avoid malformed URLs
//       if (!isValidUrl(fullUrl)) {
//         console.log(`Skipping invalid URL: ${fullUrl}`);
//         return;
//       }
      
//       links.push({
//         name: text || 'No description',
//         url: fullUrl,
//         type: determineType(text, href)
//       });
//     }
//   });
  
//   // Look for TOC links and process them
//   const tocLinks = links.filter(link => 
//     link.url.includes('TOC.cfm') || 
//     link.url.includes('toc.cfm') ||
//     (link.url.includes('drugsatfda_docs') && link.type === 'Review')
//   );
  
//   if (tocLinks.length > 0) {
//     for (const tocLink of tocLinks) {
//       console.log(`Found TOC/review page link: ${tocLink.url}`);
//       const tocHtml = await fetchHtml(tocLink.url);
//       if (tocHtml) {
//         const tocPdfLinks = await processTocPage(tocHtml, tocLink.url);
//         links = links.concat(tocPdfLinks);
//       }
//     }
//   }
  
//   // Filter out duplicate URLs and invalid/broken links
//   const uniqueLinks = [];
//   const seenUrls = new Set();
  
//   for (const link of links) {
//     // Skip links with obviously broken URLs
//     if (link.url.includes('#collapse') || 
//         link.url.includes('accessdata.fda.gov/#') ||
//         !isValidUrl(link.url)) {
//       continue;
//     }
    
//     if (!seenUrls.has(link.url)) {
//       seenUrls.add(link.url);
//       uniqueLinks.push(link);
//     }
//   }
  
//   return uniqueLinks;
// }

// // Function to validate URL format
// function isValidUrl(string) {
//   try {
//     new URL(string);
//     return true;
//   } catch (_) {
//     return false;
//   }
// }

// // Process TOC page and extract PDF links using enhanced scraper logic
// async function processTocPage(html, url) {
//   const $ = cheerio.load(html);
//   const links = [];
  
//   // Get the base URL to construct absolute URLs
//   let baseUrl = '';
//   let currentPath = '';
  
//   if (url) {
//     try {
//       const urlObj = new URL(url);
//       baseUrl = urlObj.origin;
//       currentPath = urlObj.pathname.split('/').slice(0, -1).join('/');
//     } catch (error) {
//       console.error(`Error parsing URL ${url}: ${error.message}`);
//       // Fall back to default behavior
//       baseUrl = 'https://www.accessdata.fda.gov';
//       currentPath = '/drugsatfda_docs/nda';
//     }
//   } else {
//     baseUrl = 'https://www.accessdata.fda.gov';
//     currentPath = '/drugsatfda_docs/nda';
//   }
  
//   // Find all links to PDFs
//   $('a[href$=".pdf"]').each((index, element) => {
//     const relativeUrl = $(element).attr('href');
//     const title = $(element).text().trim();
    
//     // Skip if empty or doesn't end with PDF
//     if (!relativeUrl || !relativeUrl.toLowerCase().endsWith('.pdf')) {
//       return;
//     }
    
//     // Skip problematic URLs
//     if (relativeUrl.includes('#collapse') || 
//         relativeUrl.includes('accessdata.fda.gov/#') ||
//         relativeUrl === '#' ||
//         relativeUrl === '' ||
//         relativeUrl === 'javascript:void(0)') {
//       return;
//     }
    
//     // Construct absolute URL - handling different formats of relative URLs
//     let absoluteUrl;
//     if (relativeUrl.startsWith('http')) {
//       // Already absolute
//       absoluteUrl = relativeUrl;
//     } else if (relativeUrl.startsWith('/')) {
//       // Root-relative URL
//       absoluteUrl = `${baseUrl}${relativeUrl}`;
//     } else {
//       // Document-relative URL
//       absoluteUrl = `${baseUrl}${currentPath}/${relativeUrl}`;
//     }
    
//     // Validate the URL
//     if (!isValidUrl(absoluteUrl)) {
//       console.log(`Skipping invalid URL from TOC page: ${absoluteUrl}`);
//       return;
//     }
    
//     // Get parent context for categorization
//     let category = '';
    
//     // Try to determine the category from the panel heading or other context
//     const parentPanel = $(element).closest('.panel');
//     if (parentPanel.length) {
//       const panelHeading = parentPanel.find('.panel-heading').text().trim();
//       if (panelHeading) {
//         category = panelHeading;
//       }
//     }
    
//     // If no category from panel, try to get context from nearby elements
//     if (!category) {
//       // Check previous heading or paragraph
//       let prevElement = $(element).prev('h1, h2, h3, h4, h5, p, li');
//       if (prevElement.length) {
//         category = prevElement.text().trim();
//       } else {
//         // Try parent li or p
//         const parentContext = $(element).closest('li, p');
//         if (parentContext.length) {
//           category = parentContext.text().trim().replace(title, '').trim();
//         }
//       }
//     }
    
//     // Map the category to a standardized type
//     const type = standardizeType(category, title, relativeUrl);
    
//     links.push({
//       name: title || 'No description',
//       url: absoluteUrl,
//       type: type,
//       originalCategory: category // Keep original for debugging
//     });
//   });
  
//   return links;
// }

// // Function to make a full URL from a relative URL
// function makeFullUrl(href) {
//   if (href.startsWith('http')) {
//     return href;
//   } else if (href.startsWith('/')) {
//     return `https://www.accessdata.fda.gov${href}`;
//   } else {
//     return `https://www.accessdata.fda.gov/${href}`;
//   }
// }

// // Function to determine the type of link
// function determineType(text, href) {
//   text = text.toLowerCase();
//   href = href.toLowerCase();
  
//   if (text.includes('approval') || text.includes('approv')) {
//     return 'Approval Letter';
//   } else if (text.includes('review') || href.includes('review')) {
//     if (text.includes('chemistry') || href.includes('chemr')) {
//       return 'Chemistry Review';
//     } else if (text.includes('clinical') || href.includes('clinicalr')) {
//       return 'Clinical Review';
//     } else if (text.includes('pharm') || href.includes('pharmr')) {
//       return 'Pharmacology Review';
//     } else if (text.includes('biopharm') || href.includes('biopharmr')) {
//       return 'Biopharmaceutics Review';
//     } else if (text.includes('micro') || href.includes('micror')) {
//       return 'Microbiology Review';
//     } else if (text.includes('statistical') || href.includes('statr')) {
//       return 'Statistical Review';
//     } else if (text.includes('medical') || href.includes('medr')) {
//       return 'Medical Review';
//     } else {
//       return 'Review';
//     }
//   } else if (text.includes('label') || href.includes('label') || href.includes('lbl')) {
//     if (text.includes('printed')) {
//       return 'Printed Label';
//     } else {
//       return 'Label';
//     }
//   } else if (text.includes('letter') || href.includes('letter') || href.includes('ltr')) {
//     return 'Letter';
//   } else if (text.includes('correspondence') || href.includes('corres')) {
//     return 'Correspondence';
//   } else if (text.includes('admin') || href.includes('admin')) {
//     return 'Administrative Document';
//   } else {
//     return 'Other';
//   }
// }

// // Function to standardize type based on category, title and URL
// function standardizeType(category, title, url) {
//   const combinedText = (category + ' ' + title + ' ' + url).toLowerCase();
  
//   // Map of key terms to standardized document types
//   const typeMapping = [
//     { terms: ['approval letter', 'approv'], type: 'Approval Letter' },
//     { terms: ['chemistry review', 'chemr'], type: 'Chemistry Review' },
//     { terms: ['clinical pharm', 'biopharm'], type: 'Clinical Pharmacology Biopharmaceutics Review' },
//     { terms: ['micro review', 'microbiology'], type: 'Microbiology Review' },
//     { terms: ['printed label', 'print lbl'], type: 'Printed Labeling' },
//     { terms: ['label review', 'labeling review'], type: 'Labeling Reviews' },
//     { terms: ['administrative', 'admin', 'correspondence', 'corres'], type: 'Administrative Document & Correspondence' },
//     { terms: ['statistical review', 'stats'], type: 'Statistical Review' },
//     { terms: ['medical review', 'medr'], type: 'Medical Review' },
//     { terms: ['pharmacology', 'toxicology'], type: 'Pharmacology Review' },
//     { terms: ['letter'], type: 'Letter' }
//   ];
  
//   // Find the first matching type
//   for (const mapping of typeMapping) {
//     if (mapping.terms.some(term => combinedText.includes(term))) {
//       return mapping.type;
//     }
//   }
  
//   // Default types based on partial matches
//   if (combinedText.includes('review')) {
//     return 'Review';
//   } else if (combinedText.includes('label')) {
//     return 'Label';
//   }
  
//   return 'Other';
// }

// // Function to validate URLs before adding them to the results
// async function validateUrl(url) {
//   try {
//     const response = await axios.head(url, {
//       httpsAgent,
//       timeout: 5000
//     });
//     return response.status >= 200 && response.status < 400;
//   } catch (error) {
//     console.error(`URL validation failed for ${url}: ${error.message}`);
//     return false;
//   }
// }
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
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


// app.get('/api/fda/drug/:drugName', async (req, res) => {
//   console.log("Fetching comprehensive FDA drug data");
//   const { drugName } = req.params;
//   const searchType = req.query.type || 'brand';

//   try {
//     // Initialize result structure
//     const results = { 
//       endpoints: {}, 
//       combinedResults: []
//     };

//     // Define all FDA drug endpoints we'll query
//     const endpoints = {
//       drugsFda: "https://api.fda.gov/drug/drugsfda.json",
//       label: "https://api.fda.gov/drug/label.json",
//       ndc: "https://api.fda.gov/drug/ndc.json",
//       enforcement: "https://api.fda.gov/drug/enforcement.json",
//       event: "https://api.fda.gov/drug/event.json"
//     };

//     // Define search variations based on the drug name
//     const searchVariations = [
//       `*${drugName}*`,
//       // You can add variations here like manufacturer names if needed
//     ];

//     // Process each endpoint
//     for (const [endpointName, baseUrl] of Object.entries(endpoints)) {
//       let endpointSuccess = false;
      
//       // Try each search variation
//       for (const variation of searchVariations) {
//         if (endpointSuccess) continue; // Skip if we already have data
        
//         try {
//           // Build search query based on endpoint
//           let searchQuery;
          
//           switch (endpointName) {
//             case "drugsFda":
//               searchQuery = `search=openfda.brand_name:"${variation}"+OR+openfda.generic_name:"${variation}"+OR+sponsor_name:"${variation}"`;
//               break;
//             case "label":
//               searchQuery = `search=openfda.brand_name:"${variation}"+OR+openfda.generic_name:"${variation}"+OR+openfda.manufacturer_name:"${variation}"`;
//               break;
//             case "ndc":
//               searchQuery = `search=brand_name:"${variation}"+OR+generic_name:"${variation}"+OR+labeler_name:"${variation}"`;
//               break;
//             case "enforcement":
//               searchQuery = `search=product_description:"${variation}"`;
//               break;
//             case "event":
//               searchQuery = `search=patient.drug.medicinalproduct:"${variation}"+OR+patient.drug.openfda.brand_name:"${variation}"+OR+patient.drug.openfda.generic_name:"${variation}"`;
//               break;
//             default:
//               searchQuery = `search=${variation}`;
//           }
          
//           // Make the API request with increased limit
//           const url = `${baseUrl}?${searchQuery}&limit=100`;
//           console.log(`Trying FDA ${endpointName} with search term: ${variation}`);
          
//           const response = await axios.get(url, { timeout: 15000 });
          
//           if (response.data && response.data.results && Array.isArray(response.data.results) && response.data.results.length > 0) {
//             console.log(`Success! Found FDA data from ${endpointName} for ${variation}`);
//             results.endpoints[endpointName] = {
//               status: "success",
//               count: response.data.results.length,
//               data: response.data.results,
//               searchTerm: variation
//             };
            
//             // Process the results based on endpoint type
//             const processedResults = processEndpointResults(endpointName, response.data.results, variation);
//             results.combinedResults = [...results.combinedResults, ...processedResults];
            
//             endpointSuccess = true;
//             break; // Exit the variations loop for this endpoint
//           }
//         } catch (error) {
//           console.warn(`Failed FDA ${endpointName} request for ${variation}: ${error.message}`);
//         }
//       }
      
//       // If no success with any variation, record the failure
//       if (!endpointSuccess) {
//         results.endpoints[endpointName] = {
//           status: "error",
//           error: "No data found across all search variations",
//           statusCode: "404",
//           data: []
//         };
//       }
//     }
    
//     // If no results found across all endpoints, add placeholder data
//     if (results.combinedResults.length === 0) {
//       results.combinedResults = [{
//         source: "placeholder",
//         name: drugName,
//         description: `No FDA data found for ${drugName} across all endpoints`,
//         date: "Unknown",
//         status: "Unknown"
//       }];
//     }

//     // Process drugsFda data into categorized format (as in your original code)
//     const categorizedDrugs = {};
    
//     if (results.endpoints.drugsFda && results.endpoints.drugsFda.status === "success") {
//       for (const drug of results.endpoints.drugsFda.data) {
//         const appNumber = drug.application_number;
//         const products = drug.products || [];
//         const submissions = drug.submissions || [];
        
//         // Improved approval date extraction logic
//         let approvalDate = 'Unknown';
        
//         // First try to find ORIG-1 or submission number 1
//         const originalApproval = submissions.find(s =>
//           (s.submission_number === '1' || s.submission_number === 'ORIG-1') &&
//           (s.submission_status === 'AP' || s.submission_status === 'Approved')
//         );
        
//         // If not found, look for any approval
//         if (originalApproval) {
//           approvalDate = originalApproval.submission_status_date;
//         } else {
//           const anyApproval = submissions.find(s =>
//             s.submission_status === 'AP' || s.submission_status === 'Approved'
//           );
//           if (anyApproval) {
//             approvalDate = anyApproval.submission_status_date;
//           }
//         }
        
//         for (const product of products) {
//           if (!product.brand_name) continue;
          
//           const brandName = product.brand_name.toLowerCase();
//           const activeIngredients = product.active_ingredients || [];
//           const strength = activeIngredients.map(ing => `${ing.name} ${ing.strength}`).join(', ') || 'Unknown';
          
//           if (!categorizedDrugs[brandName]) categorizedDrugs[brandName] = {};
//           if (!categorizedDrugs[brandName][strength]) categorizedDrugs[brandName][strength] = [];
          
//           categorizedDrugs[brandName][strength].push({
//             brandName: product.brand_name,
//             applicationNumber: appNumber,
//             approvalDate,
//             submissions: submissions.map(s => ({
//               submissionNumber: s.submission_number,
//               status: s.submission_status,
//               date: s.submission_status_date,
//               type: s.submission_type
//             })),
//             hasDocuments: true,
//             fdaPage: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appNumber.replace(/[^0-9]/g, '')}`,
//             sponsorName: drug.sponsor_name,
//             activeIngredients,
//             manufacturerName: drug.openfda?.manufacturer_name?.[0] || drug.sponsor_name,
//             dosageForm: product.dosage_form,
//             route: product.route,
//             marketingStatus: product.marketing_status,
//           });
//         }
//       }
//     }

//     // Return both the raw endpoint results and the categorized drugs
//     res.json({
//       raw: results,
//       categorized: categorizedDrugs
//     });

//   } catch (error) {
//     console.error('Error fetching FDA drug data:', error);
//     res.status(500).json({ 
//       error: 'Error fetching drug data',
//       message: error.message 
//     });
//   }
// });




// Helper function to retry failed API requests
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt}/${maxRetries} for ${url}`);
      const response = await axios.get(url, { 
        timeout: 30000,
        ...options
      });
      return response;
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${attempt} failed: ${error.message}`);
      
      // If we have response details, log them
      if (error.response) {
        console.warn(`Status: ${error.response.status}, Data:`, error.response.data);
      }
      
      // Check if it's a rate limiting error or server error
      if (error.response && (error.response.status === 429 || error.response.status >= 500)) {
        const backoffTime = 2000 * attempt; // Increase backoff time with each attempt
        console.warn(`Rate limiting or server error detected. Waiting ${backoffTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      } else if (attempt < maxRetries) {
        // For other errors, wait a shorter time
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  
  // If we get here, all attempts failed
  throw lastError;
}

// Helper function to process results from different endpoints
// IMPORTANT: Define this before route handlers
function processEndpointResults(endpointName, results, searchTerm) {
  const processed = [];
  
  try {
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
            (drug.medicinalproduct || '').toLowerCase().includes((searchTerm || '').toLowerCase()) ||
            (drug.openfda?.brand_name?.[0] || '').toLowerCase().includes((searchTerm || '').toLowerCase()) ||
            (drug.openfda?.generic_name?.[0] || '').toLowerCase().includes((searchTerm || '').toLowerCase())
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
  } catch (error) {
    console.error(`Error in processEndpointResults for ${endpointName}:`, error);
    // Return an empty array if processing fails rather than throwing an error
  }
  
  return processed;
}

// Middleware to validate drug name parameter
const validateDrugNamenew = (req, res, next) => {
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

// FDA API status check endpoint
app.get('/api/fda/status', async (req, res) => {
  try {
    console.log("Checking FDA API endpoints status");
    
    const endpoints = {
      drugsFda: "https://api.fda.gov/drug/drugsfda.json",
      label: "https://api.fda.gov/drug/label.json",
      ndc: "https://api.fda.gov/drug/ndc.json",
      enforcement: "https://api.fda.gov/drug/enforcement.json",
      event: "https://api.fda.gov/drug/event.json"
    };
    
    const status = {};
    
    for (const [name, url] of Object.entries(endpoints)) {
      try {
        const checkUrl = `${url}?limit=1`;
        const startTime = Date.now();
        const response = await axios.get(checkUrl, { timeout: 10000 });
        const endTime = Date.now();
        
        status[name] = {
          status: "available",
          responseTime: `${endTime - startTime}ms`,
          statusCode: response.status
        };
      } catch (error) {
        status[name] = {
          status: "error",
          error: error.message,
          statusCode: error.response?.status || "unknown"
        };
      }
    }
    
    res.json({
      timestamp: new Date().toISOString(),
      endpoints: status
    });
  } catch (error) {
    console.error('Error checking FDA API status:', error);
    res.status(500).json({ 
      error: 'Error checking FDA API status',
      message: error.message 
    });
  }
});

// Main drug search endpoint
app.get('/api/fda/drug/:drugName', validateDrugNamenew, async (req, res) => {
  console.log("Fetching comprehensive FDA drug data");
  const { drugName } = req.params;
  const searchType = req.query.type || 'brand';

  try {
    // Check if FDA API is available first
    try {
      console.log("Checking FDA API availability...");
      const checkUrl = "https://api.fda.gov/drug/label.json?limit=1";
      await axios.get(checkUrl, { timeout: 10000 });
      console.log("FDA API is available.");
    } catch (apiCheckError) {
      console.error("FDA API appears to be unavailable:", apiCheckError.message);
      return res.status(503).json({
        error: 'FDA API unavailable',
        message: 'The FDA API is currently unavailable. Please try again later.'
      });
    }

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
      `${drugName}`,
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
          
          // Fetch all results using pagination
          let allResults = [];
          let skip = 0;
          const BATCH_SIZE = 100; // Reduced batch size to avoid overloading API
          let hasMoreResults = true;
          
          while (hasMoreResults) {
            // Make the API request with pagination
            const url = `${baseUrl}?${searchQuery}&limit=${BATCH_SIZE}&skip=${skip}`;
            console.log(`Fetching FDA ${endpointName} with search term: ${variation}, skip: ${skip}`);
            
            try {
              const response = await fetchWithRetry(url, { timeout: 30000 });
              
              const batchResults = response.data.results || [];
              if (batchResults.length > 0) {
                allResults = [...allResults, ...batchResults];
                console.log(`Retrieved batch of ${batchResults.length} results. Total so far: ${allResults.length}`);
                
                // Check if we've reached the end or if there might be more results
                if (batchResults.length < BATCH_SIZE) {
                  hasMoreResults = false; // End of results
                } else {
                  skip += BATCH_SIZE; // Move to next batch
                }
              } else {
                hasMoreResults = false; // No results in this batch
              }
              
              // Safety check to prevent excessive requests (FDA API has rate limits)
              if (allResults.length >= 500) {
                console.warn(`Reached 500 results for ${endpointName}, stopping pagination to prevent excessive requests`);
                break;
              }
            } catch (error) {
              console.error(`Failed FDA ${endpointName} request for ${variation} after multiple retries: ${error.message}`);
              hasMoreResults = false; // Stop trying after repeated failures
            }
          }
          
          if (allResults.length > 0) {
            console.log(`Success! Found ${allResults.length} FDA records from ${endpointName} for ${variation}`);
            results.endpoints[endpointName] = {
              status: "success",
              count: allResults.length,
              data: allResults,
              searchTerm: variation
            };
            
            try {
              // Process the results based on endpoint type
              const processedResults = processEndpointResults(endpointName, allResults, variation);
              console.log(`Successfully processed ${processedResults.length} results from ${endpointName}`);
              results.combinedResults = [...results.combinedResults, ...processedResults];
            } catch (processingError) {
              console.error(`Error processing ${endpointName} results:`, processingError);
              // Continue with unprocessed results
            }
            
            endpointSuccess = true;
            break; // Exit the variations loop for this endpoint
          }
        } catch (error) {
          console.warn(`Failed FDA ${endpointName} request for ${variation}: ${error.message}`);
          
          // Check if it's a rate limiting error
          if (error.response && (error.response.status === 429 || error.response.status === 503)) {
            console.warn('Rate limiting detected. Waiting before continuing...');
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
          }
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

    // Process drugsFda data into categorized format
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

    // Add metadata about the request
    const metadata = {
      query: drugName,
      timestamp: new Date().toISOString(),
      endpointsQueried: Object.keys(endpoints).length,
      totalResults: results.combinedResults.length,
      resultBreakdown: Object.entries(results.endpoints).map(([name, data]) => ({
        endpoint: name,
        status: data.status,
        count: data.status === "success" ? data.count : 0
      }))
    };

    // Return both the raw endpoint results and the categorized drugs
    res.json({
      metadata,
      raw: results,
      categorized: categorizedDrugs
    });

  } catch (error) {
    console.error('Error fetching FDA drug data:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Error fetching drug data',
      message: error.message 
    });
  }
});


// Main device search endpoint
app.get('/api/fda/device/:deviceName', validateDeviceName, async (req, res) => {
  console.log("Fetching comprehensive FDA device data");
  const { deviceName } = req.params;
  const searchType = req.query.type || 'brand';

  try {
    // Check if FDA API is available first
    try {
      console.log("Checking FDA API availability...");
      const checkUrl = "https://api.fda.gov/device/510k.json?limit=1";
      await axios.get(checkUrl, { timeout: 10000 });
      console.log("FDA API is available.");
    } catch (apiCheckError) {
      console.error("FDA API appears to be unavailable:", apiCheckError.message);
      return res.status(503).json({
        error: 'FDA API unavailable',
        message: 'The FDA API is currently unavailable. Please try again later.'
      });
    }

    // Initialize result structure
    const results = { 
      endpoints: {}, 
      combinedResults: []
    };

    // Define all FDA device endpoints we'll query
    const endpoints = {
      classification: "https://api.fda.gov/device/classification.json",
      registrationlisting: "https://api.fda.gov/device/registrationlisting.json",
      enforcement: "https://api.fda.gov/device/enforcement.json",
      event: "https://api.fda.gov/device/event.json",
      recall: "https://api.fda.gov/device/recall.json",
      pma: "https://api.fda.gov/device/pma.json",
      '510k': "https://api.fda.gov/device/510k.json",
      covid19serology: "https://api.fda.gov/device/covid19serology.json",
      udi: "https://api.fda.gov/device/udi.json"
    };

    // Define search variations based on the device name
    const searchVariations = [
      `${deviceName}`,
      `*${deviceName}*`,
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
            case "classification":
              searchQuery = `search=device_name:"${variation}"+OR+medical_specialty_description:"${variation}"`;
              break;
            case "registrationlisting":
              searchQuery = `search=products.name:"${variation}"+OR+products.device_name:"${variation}"+OR+registration.owner_operator.name:"${variation}"`;
              break;
            case "enforcement":
              searchQuery = `search=product_description:"${variation}"+OR+firm_legal_name:"${variation}"`;
              break;
            case "event":
              searchQuery = `search=device.brand_name:"${variation}"+OR+device.generic_name:"${variation}"+OR+device.manufacturer_d_name:"${variation}"`;
              break;
            case "recall":
              searchQuery = `search=product_description:"${variation}"+OR+product_code:"${variation}"+OR+firm_name:"${variation}"`;
              break;
            case "pma":
              searchQuery = `search=device_name:"${variation}"+OR+applicant:"${variation}"+OR+trade_name:"${variation}"`;
              break;
            case "510k":
              searchQuery = `search=device_name:"${variation}"+OR+applicant:"${variation}"+OR+k_number:"${variation}"`;
              break;
            case "covid19serology":
              searchQuery = `search=device_name:"${variation}"+OR+manufacturer_name:"${variation}"`;
              break;
            case "udi":
              searchQuery = `search=device_name:"${variation}"+OR+brand_name:"${variation}"+OR+company_name:"${variation}"`;
              break;
            default:
              searchQuery = `search=${variation}`;
          }
          
          // Fetch all results using pagination
          let allResults = [];
          let skip = 0;
          const BATCH_SIZE = 100; // Reduced batch size to avoid overloading API
          let hasMoreResults = true;
          
          while (hasMoreResults) {
            // Make the API request with pagination
            const url = `${baseUrl}?${searchQuery}&limit=${BATCH_SIZE}&skip=${skip}`;
            console.log(`Fetching FDA ${endpointName} with search term: ${variation}, skip: ${skip}`);
            
            try {
              const response = await fetchWithRetry(url, { timeout: 30000 });
              
              const batchResults = response.data.results || [];
              if (batchResults.length > 0) {
                allResults = [...allResults, ...batchResults];
                console.log(`Retrieved batch of ${batchResults.length} results. Total so far: ${allResults.length}`);
                
                // Check if we've reached the end or if there might be more results
                if (batchResults.length < BATCH_SIZE) {
                  hasMoreResults = false; // End of results
                } else {
                  skip += BATCH_SIZE; // Move to next batch
                }
              } else {
                hasMoreResults = false; // No results in this batch
              }
              
              // Safety check to prevent excessive requests (FDA API has rate limits)
              if (allResults.length >= 500) {
                console.warn(`Reached 500 results for ${endpointName}, stopping pagination to prevent excessive requests`);
                break;
              }
            } catch (error) {
              console.error(`Failed FDA ${endpointName} request for ${variation} after multiple retries: ${error.message}`);
              hasMoreResults = false; // Stop trying after repeated failures
            }
          }
          
          if (allResults.length > 0) {
            console.log(`Success! Found ${allResults.length} FDA records from ${endpointName} for ${variation}`);
            results.endpoints[endpointName] = {
              status: "success",
              count: allResults.length,
              data: allResults,
              searchTerm: variation
            };
            
            try {
              // Process the results based on endpoint type
              const processedResults = processDeviceEndpointResults(endpointName, allResults, variation);
              console.log(`Successfully processed ${processedResults.length} results from ${endpointName}`);
              results.combinedResults = [...results.combinedResults, ...processedResults];
            } catch (processingError) {
              console.error(`Error processing ${endpointName} results:`, processingError);
              // Continue with unprocessed results
            }
            
            endpointSuccess = true;
            break; // Exit the variations loop for this endpoint
          }
        } catch (error) {
          console.warn(`Failed FDA ${endpointName} request for ${variation}: ${error.message}`);
          
          // Check if it's a rate limiting error
          if (error.response && (error.response.status === 429 || error.response.status === 503)) {
            console.warn('Rate limiting detected. Waiting before continuing...');
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
          }
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
        name: deviceName,
        description: `No FDA device data found for ${deviceName} across all endpoints`,
        date: "Unknown",
        status: "Unknown"
      }];
    }

    // Process 510k data into categorized format
    const categorizedDevices = {};
    
    // Process 510k clearances
    if (results.endpoints['510k'] && results.endpoints['510k'].status === "success") {
      for (const device of results.endpoints['510k'].data) {
        const deviceName = device.device_name || 'Unknown Device';
        const applicant = device.applicant || 'Unknown Applicant';
        const clearanceDate = device.decision_date || device.date_received || 'Unknown';
        const kNumber = device.k_number || 'Unknown';
        
        if (!categorizedDevices[deviceName]) categorizedDevices[deviceName] = {};
        if (!categorizedDevices[deviceName][applicant]) categorizedDevices[deviceName][applicant] = [];
        
        categorizedDevices[deviceName][applicant].push({
          deviceName: device.device_name,
          applicant: device.applicant,
          kNumber: device.k_number,
          clearanceDate: device.decision_date,
          decisionCode: device.decision_code,
          decisionDescription: device.decision_description,
          productCode: device.product_code,
          dateReceived: device.date_received,
          hasDocuments: true,
          fdaPage: `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=${kNumber}`,
          advisoryCommittee: device.advisory_committee,
          reviewAdvisoryCommittee: device.review_advisory_committee,
          deviceClass: device.device_class,
          regulationNumber: device.regulation_number,
          substantialEquivalence: device.statement_or_summary,
          type: "510k"
        });
      }
    }
    
    // Process PMA data
    if (results.endpoints.pma && results.endpoints.pma.status === "success") {
      for (const device of results.endpoints.pma.data) {
        const deviceName = device.device_name || device.trade_name || 'Unknown Device';
        const applicant = device.applicant || 'Unknown Applicant';
        const approvalDate = device.decision_date || device.date_received || 'Unknown';
        const pmaNumber = device.pma_number || 'Unknown';
        
        if (!categorizedDevices[deviceName]) categorizedDevices[deviceName] = {};
        if (!categorizedDevices[deviceName][applicant]) categorizedDevices[deviceName][applicant] = [];
        
        categorizedDevices[deviceName][applicant].push({
          deviceName: device.device_name,
          tradeName: device.trade_name,
          applicant: device.applicant,
          pmaNumber: device.pma_number,
          approvalDate: device.decision_date,
          decisionCode: device.decision_code,
          productCode: device.product_code,
          dateReceived: device.date_received,
          expeditedReview: device.expedited_review_flag,
          hasDocuments: true,
          fdaPage: `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpma/pma.cfm?id=${pmaNumber}`,
          advisoryCommittee: device.advisory_committee,
          type: "PMA"
        });
      }
    }

    // Add metadata about the request
    const metadata = {
      query: deviceName,
      timestamp: new Date().toISOString(),
      endpointsQueried: Object.keys(endpoints).length,
      totalResults: results.combinedResults.length,
      resultBreakdown: Object.entries(results.endpoints).map(([name, data]) => ({
        endpoint: name,
        status: data.status,
        count: data.status === "success" ? data.count : 0
      }))
    };

    // Return both the raw endpoint results and the categorized devices
    res.json({
      metadata,
      raw: results,
      categorized: categorizedDevices
    });

  } catch (error) {
    console.error('Error fetching FDA device data:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Error fetching device data',
      message: error.message 
    });
  }
});

// Helper function for device validation
function validateDeviceName(req, res, next) {
  const { deviceName } = req.params;
  
  if (!deviceName || deviceName.trim().length < 2) {
    return res.status(400).json({
      error: 'Invalid device name',
      message: 'Please provide a valid device name (minimum 2 characters)'
    });
  }
  
  // Sanitize the device name to prevent potential injection
  req.params.deviceName = deviceName.trim().replace(/[^\w\s\-\.]/g, '');
  next();
}

// Process endpoint-specific results for devices
function processDeviceEndpointResults(endpointName, results, searchTerm) {
  const processedResults = [];
  
  try {
    switch (endpointName) {
      case "510k":
        for (const item of results) {
          processedResults.push({
            source: "510k",
            name: item.device_name || "Unknown Device",
            description: `510(k) submission ${item.k_number} - ${item.device_name || "Unknown Device"}`,
            applicant: item.applicant || "Unknown",
            date: item.decision_date || item.date_received || "Unknown",
            status: item.decision_description || "Unknown",
            id: item.k_number || "",
            additionalInfo: {
              productCode: item.product_code,
              deviceClass: item.device_class
            }
          });
        }
        break;
        
      case "pma":
        for (const item of results) {
          processedResults.push({
            source: "pma",
            name: item.device_name || item.trade_name || "Unknown Device",
            description: `PMA submission ${item.pma_number} - ${item.device_name || item.trade_name || "Unknown Device"}`,
            applicant: item.applicant || "Unknown",
            date: item.decision_date || item.date_received || "Unknown",
            status: item.decision_code || "Unknown",
            id: item.pma_number || "",
            additionalInfo: {
              productCode: item.product_code,
              expedited: item.expedited_review_flag === "Y" ? "Yes" : "No"
            }
          });
        }
        break;
        
      case "classification":
        for (const item of results) {
          processedResults.push({
            source: "classification",
            name: item.device_name || "Unknown Device",
            description: `Device Classification - ${item.device_name || "Unknown Device"}`,
            date: "N/A",
            status: `Class ${item.device_class || "Unknown"}`,
            id: item.product_code || "",
            additionalInfo: {
              regulationNumber: item.regulation_number,
              medicalSpecialty: item.medical_specialty_description,
              regulationText: item.regulation_text
            }
          });
        }
        break;
        
      case "registrationlisting":
        for (const item of results) {
          const products = item.products || [];
          for (const product of products) {
            processedResults.push({
              source: "registrationlisting",
              name: product.name || product.device_name || "Unknown Device",
              description: `Listed Device - ${product.name || product.device_name || "Unknown Device"}`,
              applicant: item.registration?.owner_operator?.name || "Unknown",
              date: item.registration?.initial_importer_flag === "Y" ? "Importer" : "Manufacturer",
              status: product.proprietary_name || "Unknown",
              id: product.registration_number || "",
              additionalInfo: {
                productCode: product.product_code,
                ownerOperatorNumber: item.registration?.owner_operator?.owner_operator_number
              }
            });
          }
        }
        break;
        
      case "enforcement":
        for (const item of results) {
          processedResults.push({
            source: "enforcement",
            name: item.product_description || "Unknown Device",
            description: `Enforcement - ${item.product_description || "Unknown Device"}`,
            applicant: item.firm_legal_name || item.recalling_firm || "Unknown",
            date: item.recall_initiation_date || item.event_date_initiated || "Unknown",
            status: item.status || "Unknown",
            id: item.recall_number || "",
            additionalInfo: {
              classification: item.classification,
              codeInfo: item.code_info,
              reasonForRecall: item.reason_for_recall
            }
          });
        }
        break;
        
      case "event":
        for (const item of results) {
          const deviceInfo = item.device || {};
          processedResults.push({
            source: "event",
            name: deviceInfo.brand_name || deviceInfo.generic_name || "Unknown Device",
            description: `Adverse Event - ${deviceInfo.brand_name || deviceInfo.generic_name || "Unknown Device"}`,
            applicant: deviceInfo.manufacturer_d_name || "Unknown",
            date: item.date_received || item.date_of_event || "Unknown",
            status: item.type_of_report || "Unknown",
            id: item.report_number || "",
            additionalInfo: {
              productProblem: item.product_problem_code,
              eventType: item.event_type,
              deviceCategory: deviceInfo.device_category
            }
          });
        }
        break;
        
      case "recall":
        for (const item of results) {
          processedResults.push({
            source: "recall",
            name: item.product_description || "Unknown Device",
            description: `Recall - ${item.product_description || "Unknown Device"}`,
            applicant: item.firm_name || "Unknown",
            date: item.recall_initiation_date || "Unknown",
            status: item.status || "Unknown",
            id: item.recall_number || "",
            additionalInfo: {
              classification: item.classification,
              productCode: item.product_code,
              terminationDate: item.termination_date || "Ongoing"
            }
          });
        }
        break;
        
      case "covid19serology":
        for (const item of results) {
          processedResults.push({
            source: "covid19serology",
            name: item.device_name || "Unknown Device",
            description: `COVID-19 Serology Device - ${item.device_name || "Unknown Device"}`,
            applicant: item.manufacturer_name || "Unknown",
            date: item.date_eua_authorized || "Unknown",
            status: item.status || "Unknown",
            id: item.eua_id || "",
            additionalInfo: {
              testPerformance: item.test_performance,
              targetedAntigen: item.targeted_antigen
            }
          });
        }
        break;
        
      case "udi":
        for (const item of results) {
          processedResults.push({
            source: "udi",
            name: item.device_name || item.brand_name || "Unknown Device",
            description: `UDI - ${item.device_name || item.brand_name || "Unknown Device"}`,
            applicant: item.company_name || "Unknown",
            date: "N/A",
            status: item.commercial_distribution_status || "Unknown",
            id: item.identifier || "",
            additionalInfo: {
              deviceClass: item.device_class,
              productCode: item.product_code,
              versionModelNumber: item.version_or_model_number
            }
          });
        }
        break;
        
      default:
        for (const item of results) {
          processedResults.push({
            source: endpointName,
            name: item.device_name || item.trade_name || item.product_description || "Unknown Device",
            description: `${endpointName} data for ${searchTerm}`,
            date: "Unknown",
            status: "Unknown",
            id: "",
            additionalInfo: {}
          });
        }
    }
  } catch (error) {
    console.error(`Error in processDeviceEndpointResults for ${endpointName}:`, error);
  }
  
  return processedResults;
}

// Helper function to fetch with retry
async function fetchWithRetry(url, options = {}, maxRetries = 3, initialDelay = 1000) {
  let lastError;
  let delay = initialDelay;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await axios.get(url, options);
    } catch (error) {
      console.warn(`Attempt ${attempt} failed for ${url}: ${error.message}`);
      lastError = error;
      
      // Don't retry on certain error codes
      if (error.response) {
        const status = error.response.status;
        if (status === 404 || status === 400) {
          throw error; // Don't retry on 404 (not found) or 400 (bad request)
        }
      }
      
      if (attempt < maxRetries) {
        // Exponential backoff with jitter
        const jitter = Math.random() * 0.3 + 0.85; // Random factor between 0.85 and 1.15
        delay = delay * 2 * jitter;
        console.log(`Retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// // Helper function to process results from different endpoints
// function processEndpointResults(endpointName, results, searchTerm) {
//   const processed = [];
  
//   switch (endpointName) {
//     case "drugsFda":
//       // Process drug application data
//       results.forEach(drug => {
//         const products = drug.products || [];
        
//         products.forEach(product => {
//           processed.push({
//             source: "drugsFda",
//             type: "application",
//             name: product.brand_name || drug.application_number,
//             applicationNumber: drug.application_number,
//             sponsorName: drug.sponsor_name,
//             approvalType: drug.application_type,
//             productType: product.dosage_form,
//             status: product.marketing_status,
//             description: `${product.brand_name || 'Unknown'} (${product.dosage_form || 'Unknown Dosage Form'})`
//           });
//         });
//       });
//       break;
      
//     case "label":
//       // Process drug labeling information
//       results.forEach(label => {
//         const brandName = label.openfda?.brand_name?.[0] || 'Unknown';
//         const genericName = label.openfda?.generic_name?.[0] || 'Unknown';
        
//         processed.push({
//           source: "label",
//           type: "label",
//           name: brandName,
//           genericName: genericName,
//           manufacturerName: label.openfda?.manufacturer_name?.[0] || 'Unknown',
//           description: label.indications_and_usage?.[0] || 'No indication information',
//           warnings: label.warnings?.[0] || 'No warnings information',
//           adverseReactions: label.adverse_reactions?.[0] || 'No adverse reactions information',
//           dosageAdministration: label.dosage_and_administration?.[0] || 'No dosage information'
//         });
//       });
//       break;
      
//     case "ndc":
//       // Process National Drug Code information
//       results.forEach(ndc => {
//         processed.push({
//           source: "ndc",
//           type: "product",
//           name: ndc.brand_name || ndc.generic_name || 'Unknown',
//           ndcCode: ndc.product_ndc,
//           genericName: ndc.generic_name || 'Unknown',
//           dosageForm: ndc.dosage_form,
//           routeOfAdmin: ndc.route?.[0] || 'Unknown',
//           packageDescription: ndc.packaging?.[0]?.description || 'No packaging information',
//           labelerName: ndc.labeler_name,
//           productType: ndc.product_type,
//           description: `${ndc.brand_name || ndc.generic_name || 'Unknown'} (${ndc.dosage_form || 'Unknown Form'})`
//         });
//       });
//       break;
      
//     case "enforcement":
//       // Process enforcement reports (recalls)
//       results.forEach(report => {
//         processed.push({
//           source: "enforcement",
//           type: "recall",
//           name: report.openfda?.brand_name?.[0] || report.product_description || 'Unknown',
//           recallNumber: report.recall_number,
//           recallInitiationDate: report.recall_initiation_date,
//           recallReason: report.reason_for_recall,
//           status: report.status,
//           classification: report.classification,
//           description: report.product_description || 'No product description'
//         });
//       });
//       break;
      
//     case "event":
//       // Process adverse event reports
//       results.forEach(event => {
//         // Find the drug matching our search term in the report
//         const drugReports = event.patient?.drug || [];
//         const relevantDrugs = drugReports.filter(drug => 
//           (drug.medicinalproduct || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
//           (drug.openfda?.brand_name?.[0] || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
//           (drug.openfda?.generic_name?.[0] || '').toLowerCase().includes(searchTerm.toLowerCase())
//         );
        
//         if (relevantDrugs.length > 0) {
//           const drug = relevantDrugs[0]; // Use the first matching drug
          
//           processed.push({
//             source: "event",
//             type: "adverseEvent",
//             name: drug.medicinalproduct || drug.openfda?.brand_name?.[0] || 'Unknown',
//             genericName: drug.openfda?.generic_name?.[0] || 'Unknown',
//             reportDate: event.receiptdate,
//             seriousOutcomes: event.serious ? 'Yes' : 'No',
//             reactions: event.patient?.reaction?.map(r => r.reactionmeddrapt || 'Unknown reaction').join(', ') || 'No reactions reported',
//             description: `Adverse event report for ${drug.medicinalproduct || drug.openfda?.brand_name?.[0] || 'Unknown drug'}`
//           });
//         }
//       });
//       break;
      
//     default:
//       // Generic processing for other endpoints
//       results.forEach(result => {
//         processed.push({
//           source: endpointName,
//           name: result.openfda?.brand_name?.[0] || result.brand_name || result.generic_name || 'Unknown',
//           description: `Data from ${endpointName} endpoint`,
//           raw: result
//         });
//       });
//   }
  
//   return processed;
// }


// app.get('/api/fda/drug/:drugName', async (req, res) => {
//   console.log("Fetching comprehensive FDA drug data");
//   const { drugName } = req.params;
//   const searchType = req.query.type || 'brand';

//   try {
//     // Initialize result structure
//     const results = { 
//       endpoints: {}, 
//       combinedResults: []
//     };

//     // Define all FDA drug endpoints we'll query
//     const endpoints = {
//       drugsFda: "https://api.fda.gov/drug/drugsfda.json",
//       label: "https://api.fda.gov/drug/label.json",
//       ndc: "https://api.fda.gov/drug/ndc.json",
//       enforcement: "https://api.fda.gov/drug/enforcement.json",
//       event: "https://api.fda.gov/drug/event.json"
//     };

//     // Define search variations based on the drug name
//     const searchVariations = [
//       `*${drugName}*`,
//       // You can add variations here like manufacturer names if needed
//     ];

//     // Process each endpoint
//     for (const [endpointName, baseUrl] of Object.entries(endpoints)) {
//       let endpointSuccess = false;
      
//       // Try each search variation
//       for (const variation of searchVariations) {
//         if (endpointSuccess) continue; // Skip if we already have data
        
//         try {
//           // Build search query based on endpoint
//           let searchQuery;
          
//           switch (endpointName) {
//             case "drugsFda":
//               searchQuery = `search=openfda.brand_name:"${variation}"+OR+openfda.generic_name:"${variation}"+OR+sponsor_name:"${variation}"`;
//               break;
//             case "label":
//               searchQuery = `search=openfda.brand_name:"${variation}"+OR+openfda.generic_name:"${variation}"+OR+openfda.manufacturer_name:"${variation}"`;
//               break;
//             case "ndc":
//               searchQuery = `search=brand_name:"${variation}"+OR+generic_name:"${variation}"+OR+labeler_name:"${variation}"`;
//               break;
//             case "enforcement":
//               searchQuery = `search=product_description:"${variation}"`;
//               break;
//             case "event":
//               searchQuery = `search=patient.drug.medicinalproduct:"${variation}"+OR+patient.drug.openfda.brand_name:"${variation}"+OR+patient.drug.openfda.generic_name:"${variation}"`;
//               break;
//             default:
//               searchQuery = `search=${variation}`;
//           }
          
//           // Fetch all results using pagination
//           let allResults = [];
//           let skip = 0;
//           const BATCH_SIZE = 500; // FDA API maximum batch size
//           let hasMoreResults = true;
          
//           while (hasMoreResults) {
//             // Make the API request with pagination
//             const url = `${baseUrl}?${searchQuery}&limit=${BATCH_SIZE}&skip=${skip}`;
//             console.log(`Fetching FDA ${endpointName} with search term: ${variation}, skip: ${skip}`);
            
//             const response = await axios.get(url, { timeout: 30000 }); // Increased timeout for larger batches
            
//             const batchResults = response.data.results || [];
//             if (batchResults.length > 0) {
//               allResults = [...allResults, ...batchResults];
//               console.log(`Retrieved batch of ${batchResults.length} results. Total so far: ${allResults.length}`);
              
//               // Check if we've reached the end or if there might be more results
//               if (batchResults.length < BATCH_SIZE) {
//                 hasMoreResults = false; // End of results
//               } else {
//                 skip += BATCH_SIZE; // Move to next batch
//               }
//             } else {
//               hasMoreResults = false; // No results in this batch
//             }
            
//             // Safety check to prevent excessive requests (FDA API has rate limits)
//             if (allResults.length >= 500) {
//               console.warn(`Reached 5000 results for ${endpointName}, stopping pagination to prevent excessive requests`);
//               break;
//             }
//           }
          
//           if (allResults.length > 0) {
//             console.log(`Success! Found ${allResults.length} FDA records from ${endpointName} for ${variation}`);
//             results.endpoints[endpointName] = {
//               status: "success",
//               count: allResults.length,
//               data: allResults,
//               searchTerm: variation
//             };
            
//             // Process the results based on endpoint type
//             const processedResults = processEndpointResults(endpointName, allResults, variation);
//             results.combinedResults = [...results.combinedResults, ...processedResults];
            
//             endpointSuccess = true;
//             break; // Exit the variations loop for this endpoint
//           }
//         } catch (error) {
//           console.warn(`Failed FDA ${endpointName} request for ${variation}: ${error.message}`);
          
//           // Check if it's a rate limiting error
//           if (error.response && (error.response.status === 429 || error.response.status === 503)) {
//             console.warn('Rate limiting detected. Waiting before continuing...');
//             await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
//           }
//         }
//       }
      
//       // If no success with any variation, record the failure
//       if (!endpointSuccess) {
//         results.endpoints[endpointName] = {
//           status: "error",
//           error: "No data found across all search variations",
//           statusCode: "404",
//           data: []
//         };
//       }
//     }
    
//     // If no results found across all endpoints, add placeholder data
//     if (results.combinedResults.length === 0) {
//       results.combinedResults = [{
//         source: "placeholder",
//         name: drugName,
//         description: `No FDA data found for ${drugName} across all endpoints`,
//         date: "Unknown",
//         status: "Unknown"
//       }];
//     }

//     // Process drugsFda data into categorized format
//     const categorizedDrugs = {};
    
//     if (results.endpoints.drugsFda && results.endpoints.drugsFda.status === "success") {
//       for (const drug of results.endpoints.drugsFda.data) {
//         const appNumber = drug.application_number;
//         const products = drug.products || [];
//         const submissions = drug.submissions || [];
        
//         // Improved approval date extraction logic
//         let approvalDate = 'Unknown';
        
//         // First try to find ORIG-1 or submission number 1
//         const originalApproval = submissions.find(s =>
//           (s.submission_number === '1' || s.submission_number === 'ORIG-1') &&
//           (s.submission_status === 'AP' || s.submission_status === 'Approved')
//         );
        
//         // If not found, look for any approval
//         if (originalApproval) {
//           approvalDate = originalApproval.submission_status_date;
//         } else {
//           const anyApproval = submissions.find(s =>
//             s.submission_status === 'AP' || s.submission_status === 'Approved'
//           );
//           if (anyApproval) {
//             approvalDate = anyApproval.submission_status_date;
//           }
//         }
        
//         for (const product of products) {
//           if (!product.brand_name) continue;
          
//           const brandName = product.brand_name.toLowerCase();
//           const activeIngredients = product.active_ingredients || [];
//           const strength = activeIngredients.map(ing => `${ing.name} ${ing.strength}`).join(', ') || 'Unknown';
          
//           if (!categorizedDrugs[brandName]) categorizedDrugs[brandName] = {};
//           if (!categorizedDrugs[brandName][strength]) categorizedDrugs[brandName][strength] = [];
          
//           categorizedDrugs[brandName][strength].push({
//             brandName: product.brand_name,
//             applicationNumber: appNumber,
//             approvalDate,
//             submissions: submissions.map(s => ({
//               submissionNumber: s.submission_number,
//               status: s.submission_status,
//               date: s.submission_status_date,
//               type: s.submission_type
//             })),
//             hasDocuments: true,
//             fdaPage: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appNumber.replace(/[^0-9]/g, '')}`,
//             sponsorName: drug.sponsor_name,
//             activeIngredients,
//             manufacturerName: drug.openfda?.manufacturer_name?.[0] || drug.sponsor_name,
//             dosageForm: product.dosage_form,
//             route: product.route,
//             marketingStatus: product.marketing_status,
//           });
//         }
//       }
//     }

//     // Add metadata about the request
//     const metadata = {
//       query: drugName,
//       timestamp: new Date().toISOString(),
//       endpointsQueried: Object.keys(endpoints).length,
//       totalResults: results.combinedResults.length,
//       resultBreakdown: Object.entries(results.endpoints).map(([name, data]) => ({
//         endpoint: name,
//         status: data.status,
//         count: data.status === "success" ? data.count : 0
//       }))
//     };

//     // Return both the raw endpoint results and the categorized drugs
//     res.json({
//       metadata,
//       raw: results,
//       categorized: categorizedDrugs
//     });

//   } catch (error) {
//     console.error('Error fetching FDA drug data:', error);
//     res.status(500).json({ 
//       error: 'Error fetching drug data',
//       message: error.message 
//     });
//   }
// });




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
  const maxResults = req.query.maxResults ? parseInt(req.query.maxResults) : 1000; // Default to 1000 max results
  
  if (!drugName) {
    return res.status(400).json({ error: 'Drug name is required' });
  }
  
  try {
    const drugsData = await getAllDrugDataByName(drugName, maxResults);
    
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
async function getAllDrugDataByName(drugName, maxResults = 1000) {
  try {
    // Step 1: Search for the drug to get all SPL IDs
    const splIds = await searchAndGetAllSplIds(drugName, maxResults);
    
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

// Function to search DailyMed and return all matching SPL IDs with pagination
async function searchAndGetAllSplIds(drugName, maxResults = 1000) {
  try {
    const encodedQuery = encodeURIComponent(drugName);
    let allSplIds = [];
    let pageNum = 1;
    const pageSize = 100; // DailyMed API default page size
    let hasMoreResults = true;
    
    while (hasMoreResults && allSplIds.length < maxResults) {
      const splIds = await fetchSplIdsPage(encodedQuery, pageNum, pageSize);
      
      if (splIds.length === 0) {
        hasMoreResults = false;
      } else {
        allSplIds = [...allSplIds, ...splIds];
        pageNum++;
      }
      
      console.log(`Fetched page ${pageNum-1}, retrieved ${splIds.length} SPL IDs, total: ${allSplIds.length}`);
    }
    
    return allSplIds.slice(0, maxResults);
  } catch (error) {
    console.error('Error in searchAndGetAllSplIds:', error);
    throw error;
  }
}

// Helper function to fetch a single page of SPL IDs
function fetchSplIdsPage(encodedQuery, pageNum, pageSize) {
  return new Promise((resolve, reject) => {
    // DailyMed API pagination parameters: page and pagesize
    const requestUrl = `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.xml?drug_name=${encodedQuery}&page=${pageNum}&pagesize=${pageSize}`;
    
    console.log(`Fetching page ${pageNum} with URL: ${requestUrl}`);
    
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
// app.get('/api/pubmed', handlePubMedSearch);
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

// Add an endpoint to collect all drug names from a search
app.get('/api/collect-names/:name', async (req, res) => {
  try {
    const drugName = req.params.name;
    console.log(`Collecting all names for drug: ${drugName}`);
    
    // Use the existing drug search function
    const results = {
      originalQuery: drugName,
      sources: {
        rxnorm: { names: [], links: [] },
        fda: { names: [], links: [] },
        pubchem: { names: [], links: [] },
        chembl: { names: [], links: [] },
        clinicaltrials: { names: [], links: [] }
      }
    };

    // Run all searches in parallel
    await Promise.all([
      searchRxNorm(drugName, results),
      searchFDA(drugName, results),
      searchPubChem(drugName, results),
      searchChEMBL(drugName, results),
      searchClinicalTrials(drugName, results)
    ]);
    
    // Extract all the unique drug names from the search results
    const allNames = new Set();
    const namesBySource = {};
    
    for (const [sourceName, sourceData] of Object.entries(results.sources)) {
      namesBySource[sourceName] = [];
      
      if (sourceData.names && sourceData.names.length > 0) {
        for (const nameObj of sourceData.names) {
          // Skip error and info messages
          if (nameObj.type === 'Error' || nameObj.type === 'Info' || 
              !nameObj.name || typeof nameObj.name !== 'string') {
            continue;
          }
          
          // Skip very short names (likely not useful for searches)
          if (nameObj.name.trim().length < 3) {
            continue;
          }
          
          // Add to the source-specific list
          namesBySource[sourceName].push({
            name: nameObj.name,
            type: nameObj.type
          });
          
          // Add to the unique set
          allNames.add(nameObj.name);
        }
      }
    }
    
    res.json({
      success: true,
      data: {
        originalQuery: drugName,
        uniqueNameCount: allNames.size,
        uniqueNames: Array.from(allNames),
        namesBySource: namesBySource
      }
    });
  } catch (error) {
    console.error('Error collecting drug names:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while collecting drug names',
      message: error.message
    });
  }
});

// Clinical Trials Aggregation endpoint
app.post('/api/aggregate-trials', async (req, res) => {
  try {
    const { drugNames } = req.body;
    
    if (!drugNames || !Array.isArray(drugNames) || drugNames.length === 0) {
      return res.status(400).json({ 
        error: 'Please provide an array of drug names' 
      });
    }
    
    // Remove duplicates and empty strings
    const uniqueDrugNames = [...new Set(drugNames.filter(name => 
      name && typeof name === 'string' && name.trim() !== ''
    ))];
    
    if (uniqueDrugNames.length === 0) {
      return res.status(400).json({ 
        error: 'No valid drug names provided' 
      });
    }
    
    // Limit the total number of names to prevent overloading
    const maxDrugNames = 50;
    const limitedDrugNames = uniqueDrugNames.slice(0, maxDrugNames);
    const wasTruncated = limitedDrugNames.length < uniqueDrugNames.length;
    
    // Perform the search
    const results = await searchAllTrialsForDrugNames(limitedDrugNames);
    
    // Return the results
    res.json({
      success: true,
      data: {
        trials: results.trials,
        errors: results.errors,
        stats: {
          totalDrugNamesProvided: uniqueDrugNames.length,
          totalDrugNamesSearched: limitedDrugNames.length,
          wasTruncated,
          totalUniqueTrials: results.totalUniqueTrials
        }
      }
    });
  } catch (error) {
    console.error('Error in aggregate trials endpoint:', error);
    res.status(500).json({ 
      error: 'An error occurred while processing your request',
      message: error.message
    });
  }
});

// RxNorm API functions
async function searchRxNorm(drugName, results) {
  try {
    // Step 1: Get RxCUI for the drug
    const rxcuiResponse = await axios.get(`https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(drugName)}&search=1`);
    
    if (rxcuiResponse.data && rxcuiResponse.data.idGroup && rxcuiResponse.data.idGroup.rxnormId) {
      const rxcui = rxcuiResponse.data.idGroup.rxnormId[0];
      
      // Add the standard name to results
      if (rxcuiResponse.data.idGroup.name) {
        results.sources.rxnorm.names.push({
          name: rxcuiResponse.data.idGroup.name,
          type: 'Standard Name'
        });
        
        results.sources.rxnorm.links.push({
          url: `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${rxcui}`,
          description: 'View in RxNav'
        });
      }
      
      // Step 2: Get related names
      const relatedResponse = await axios.get(`https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/allrelated.json`);
      
      if (relatedResponse.data && relatedResponse.data.allRelatedGroup && relatedResponse.data.allRelatedGroup.conceptGroup) {
        for (const group of relatedResponse.data.allRelatedGroup.conceptGroup) {
          if (group.conceptProperties) {
            for (const property of group.conceptProperties) {
              results.sources.rxnorm.names.push({
                name: property.name,
                type: group.tty || 'Related Term',
                id: property.rxcui
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error searching RxNorm:', error.message);
    results.sources.rxnorm.names.push({
      name: "Error searching RxNorm database",
      type: "Error"
    });
  }
}

// FDA API function
async function searchFDA(drugName, results) {
  try {
    // Search by generic name
    const fdaGenericResponse = await axios.get(`https://api.fda.gov/drug/label.json?search=openfda.generic_name:${encodeURIComponent(drugName)}&limit=5`);
    
    if (fdaGenericResponse.data && fdaGenericResponse.data.results) {
      processFDAResults(fdaGenericResponse.data.results, results);
    }
    
    // Search by brand name
    const fdaBrandResponse = await axios.get(`https://api.fda.gov/drug/label.json?search=openfda.brand_name:${encodeURIComponent(drugName)}&limit=5`);
    
    if (fdaBrandResponse.data && fdaBrandResponse.data.results) {
      processFDAResults(fdaBrandResponse.data.results, results);
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      // No results found is a normal condition
      results.sources.fda.names.push({
        name: "No FDA records found",
        type: "Info"
      });
    } else {
      console.error('Error searching FDA:', error.message);
      results.sources.fda.names.push({
        name: "Error searching FDA database",
        type: "Error"
      });
    }
  }
}

function processFDAResults(fdaResults, results) {
  for (const drug of fdaResults) {
    if (drug.openfda) {
      // Add generic names
      if (drug.openfda.generic_name) {
        for (const name of drug.openfda.generic_name) {
          results.sources.fda.names.push({
            name: name,
            type: 'Generic Name'
          });
        }
      }
      
      // Add brand names
      if (drug.openfda.brand_name) {
        for (const name of drug.openfda.brand_name) {
          results.sources.fda.names.push({
            name: name,
            type: 'Brand Name'
          });
        }
      }
      
      // Add substance names
      if (drug.openfda.substance_name) {
        for (const name of drug.openfda.substance_name) {
          results.sources.fda.names.push({
            name: name,
            type: 'Substance Name'
          });
        }
      }
      
      // Add application number for link
      if (drug.openfda.application_number && drug.openfda.application_number[0]) {
        const appNum = drug.openfda.application_number[0];
        results.sources.fda.links.push({
          url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appNum.replace(/[^0-9]/g, '')}`,
          description: `FDA Application: ${appNum}`
        });
      }
    }
  }
}

// PubChem API function
async function searchPubChem(drugName, results) {
  try {
    // Step 1: Find the compound ID
    const pubchemResponse = await axios.get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(drugName)}/cids/JSON`);
    
    if (pubchemResponse.data && pubchemResponse.data.IdentifierList && pubchemResponse.data.IdentifierList.CID) {
      const cid = pubchemResponse.data.IdentifierList.CID[0];
      
      // Step 2: Get synonyms
      const synonymsResponse = await axios.get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/synonyms/JSON`);
      
      if (synonymsResponse.data && synonymsResponse.data.InformationList && synonymsResponse.data.InformationList.Information) {
        const info = synonymsResponse.data.InformationList.Information[0];
        
        if (info.Synonym) {
          // Filter out long and messy names
          const filteredSynonyms = info.Synonym.filter(syn => 
            syn.length < 100 && !syn.includes('UNII') && !syn.includes('CHEBI') && !syn.includes('DTXSID')
          );
          
          // Take just the first 30 synonyms to avoid overwhelming
          const trimmedSynonyms = filteredSynonyms.slice(0, 30);
          
          for (const synonym of trimmedSynonyms) {
            results.sources.pubchem.names.push({
              name: synonym,
              type: 'Synonym'
            });
          }
          
          // Add a link to the PubChem compound page
          results.sources.pubchem.links.push({
            url: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
            description: 'View in PubChem'
          });
        }
      }
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      results.sources.pubchem.names.push({
        name: "No PubChem records found",
        type: "Info"
      });
    } else {
      console.error('Error searching PubChem:', error.message);
      results.sources.pubchem.names.push({
        name: "Error searching PubChem database",
        type: "Error"
      });
    }
  }
}

// ChEMBL API function
async function searchChEMBL(drugName, results) {
  try {
    // First attempt: Search by exact molecule name
    let foundMolecules = [];
    try {
      const exactNameResponse = await axios.get(`https://www.ebi.ac.uk/chembl/api/data/molecule.json?pref_name__iexact=${encodeURIComponent(drugName)}`);
      if (exactNameResponse.data && exactNameResponse.data.molecules && exactNameResponse.data.molecules.length > 0) {
        foundMolecules = exactNameResponse.data.molecules;
      }
    } catch (exactError) {
      console.log('No exact match in ChEMBL:', exactError.message);
    }
    
    // Second attempt: Try searching by synonym if no exact match found
    if (foundMolecules.length === 0) {
      try {
        const synonymResponse = await axios.get(`https://www.ebi.ac.uk/chembl/api/data/molecule.json?molecule_synonyms__synonym__icontains=${encodeURIComponent(drugName)}`);
        if (synonymResponse.data && synonymResponse.data.molecules && synonymResponse.data.molecules.length > 0) {
          foundMolecules = synonymResponse.data.molecules;
        }
      } catch (synonymError) {
        console.log('No synonym match in ChEMBL:', synonymError.message);
      }
    }
    
    // Third attempt: Try a more general search by name contains
    if (foundMolecules.length === 0) {
      try {
        const containsResponse = await axios.get(`https://www.ebi.ac.uk/chembl/api/data/molecule.json?pref_name__icontains=${encodeURIComponent(drugName)}`);
        if (containsResponse.data && containsResponse.data.molecules && containsResponse.data.molecules.length > 0) {
          foundMolecules = containsResponse.data.molecules;
        }
      } catch (containsError) {
        console.log('No contains match in ChEMBL:', containsError.message);
      }
    }
    
    // Final attempt: Try a free text search
    if (foundMolecules.length === 0) {
      try {
        const searchResponse = await axios.get(`https://www.ebi.ac.uk/chembl/api/data/molecule/search?q=${encodeURIComponent(drugName)}`);
        if (searchResponse.data && searchResponse.data.molecules && searchResponse.data.molecules.length > 0) {
          foundMolecules = searchResponse.data.molecules;
        }
      } catch (searchError) {
        console.log('No search match in ChEMBL:', searchError.message);
      }
    }
    
    // Process results if we found any molecules
    if (foundMolecules.length > 0) {
      processChEMBLResults(foundMolecules, results);
    } else {
      // No results found after all attempts
      results.sources.chembl.names.push({
        name: "No ChEMBL records found",
        type: "Info"
      });
    }
  } catch (error) {
    console.error('Error searching ChEMBL:', error.message);
    results.sources.chembl.names.push({
      name: "Error searching ChEMBL database",
      type: "Error"
    });
  }
}

function processChEMBLResults(molecules, results) {
  // Keep track of processed names to avoid duplicates
  const processedNames = new Set();
  
  for (const molecule of molecules) {
    // Add preferred name
    if (molecule.pref_name && !processedNames.has(molecule.pref_name.toLowerCase())) {
      processedNames.add(molecule.pref_name.toLowerCase());
      results.sources.chembl.names.push({
        name: molecule.pref_name,
        type: 'Preferred Name'
      });
    }
    
    // Add molecule synonyms
    if (molecule.molecule_synonyms && molecule.molecule_synonyms.length > 0) {
      for (const synonym of molecule.molecule_synonyms) {
        if (synonym.synonym && !processedNames.has(synonym.synonym.toLowerCase())) {
          processedNames.add(synonym.synonym.toLowerCase());
          results.sources.chembl.names.push({
            name: synonym.synonym,
            type: synonym.syn_type || 'Synonym'
          });
        }
      }
    }
    
    // Add research codes if available
    if (molecule.research_codes && molecule.research_codes.length > 0) {
      for (const code of molecule.research_codes) {
        if (code && !processedNames.has(code.toLowerCase())) {
          processedNames.add(code.toLowerCase());
          results.sources.chembl.names.push({
            name: code,
            type: 'Research Code'
          });
        }
      }
    }
    
    // Add trade names if available
    if (molecule.trade_names && molecule.trade_names.length > 0) {
      for (const tradeName of molecule.trade_names) {
        if (tradeName && !processedNames.has(tradeName.toLowerCase())) {
          processedNames.add(tradeName.toLowerCase());
          results.sources.chembl.names.push({
            name: tradeName,
            type: 'Trade Name'
          });
        }
      }
    }
    
    // Add cross references if available
    if (molecule.cross_references && molecule.cross_references.length > 0) {
      for (const xref of molecule.cross_references) {
        if (xref.xref_id && !processedNames.has(xref.xref_id.toLowerCase())) {
          processedNames.add(xref.xref_id.toLowerCase());
          results.sources.chembl.names.push({
            name: xref.xref_id,
            type: xref.xref_src || 'Cross Reference'
          });
        }
      }
    }
    
    // Add link to ChEMBL
    if (molecule.molecule_chembl_id) {
      results.sources.chembl.links.push({
        url: `https://www.ebi.ac.uk/chembl/compound_report_card/${molecule.molecule_chembl_id}/`,
        description: `View in ChEMBL: ${molecule.molecule_chembl_id}`
      });
    }
  }
}

// ClinicalTrials.gov function
async function searchClinicalTrials(drugName, results) {
  try {
    // Using the v2 API as specified in the docs
    const response = await axios.get(`https://clinicaltrials.gov/api/v2/studies`, {
      params: {
        'query.term': drugName,
        'fields': 'NCTId,BriefTitle,InterventionName,InterventionOtherName,InterventionDescription,InterventionType',
        'pageSize': 10,
        'format': 'json'
      },
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (response.data && response.data.studies && response.data.studies.length > 0) {
      const studies = response.data.studies;
      const processedNames = new Set(); // To avoid duplicates
      
      for (const study of studies) {
        // Add link to the clinical trial
        if (study.protocolSection && study.protocolSection.identificationModule && study.protocolSection.identificationModule.nctId) {
          const nctId = study.protocolSection.identificationModule.nctId;
          const title = study.protocolSection.identificationModule.briefTitle || nctId;
          
          results.sources.clinicaltrials.links.push({
            url: `https://clinicaltrials.gov/study/${nctId}`,
            description: title
          });
        }
        
        // Extract intervention information
        if (study.protocolSection && study.protocolSection.armsInterventionsModule && 
            study.protocolSection.armsInterventionsModule.interventions) {
            
          const interventions = study.protocolSection.armsInterventionsModule.interventions;
          
          for (const intervention of interventions) {
            // Check intervention name
            if (intervention.interventionName) {
              const name = intervention.interventionName;
              const normalizedDrugName = drugName.toLowerCase();
              const normalizedName = name.toLowerCase();
              
              // Only add if related to the drug
              if (normalizedName.includes(normalizedDrugName) || 
                  normalizedDrugName.includes(normalizedName)) {
                
                if (!processedNames.has(normalizedName)) {
                  processedNames.add(normalizedName);
                  results.sources.clinicaltrials.names.push({
                    name: name,
                    type: 'Intervention Name'
                  });
                }
              }
              
              // Check other names
              if (intervention.interventionOtherNames) {
                for (const otherName of intervention.interventionOtherNames) {
                  const normalizedOtherName = otherName.toLowerCase();
                  
                  if ((normalizedOtherName.includes(normalizedDrugName) || 
                      normalizedDrugName.includes(normalizedOtherName)) && 
                      !processedNames.has(normalizedOtherName)) {
                    
                    processedNames.add(normalizedOtherName);
                    results.sources.clinicaltrials.names.push({
                      name: otherName,
                      type: 'Other Intervention Name'
                    });
                  }
                }
              }
            }
          }
        }
      }
      
      // If no names were found
      if (results.sources.clinicaltrials.names.length === 0) {
        results.sources.clinicaltrials.names.push({
          name: "No relevant intervention names found in clinical trials",
          type: "Info"
        });
      }
    } else {
      results.sources.clinicaltrials.names.push({
        name: "No ClinicalTrials.gov records found",
        type: "Info"
      });
    }
  } catch (error) {
    console.error('Error searching ClinicalTrials.gov:', error.message);
    results.sources.clinicaltrials.names.push({
      name: "Error searching ClinicalTrials.gov. Try with a different drug name.",
      type: "Error"
    });
  }
}

// Function to search for clinical trials using all collected drug names
// Function to search for clinical trials using all collected drug names
async function searchAllTrialsForDrugNames(drugNames) {
  // Store all unique trials to avoid duplicates
  const uniqueTrials = new Map();
  const errors = [];
  let totalSearched = 0;
  
  console.log(`Searching trials for ${drugNames.length} drug names...`);
  
  // Search in batches to avoid overwhelming the API
  const batchSize = 5;
  for (let i = 0; i < drugNames.length; i += batchSize) {
    const batch = drugNames.slice(i, i + batchSize);
    const searchPromises = batch.map(drugName => searchTrialsForName(drugName));
    
    // Wait for all searches in current batch to complete
    const batchResults = await Promise.allSettled(searchPromises);
    
    // Process results from this batch
    batchResults.forEach((result, index) => {
      const drugName = batch[index];
      totalSearched++;
      
      if (result.status === 'fulfilled') {
        const { trials, error } = result.value;
        
        if (error) {
          errors.push({ drugName, error });
        } else if (trials && trials.length > 0) {
          // Add each trial to our map, using NCT ID as the key
          trials.forEach(trial => {
            if (!uniqueTrials.has(trial.nctId)) {
              // Add relevance info to know which drug names matched this trial
              if (!trial.matchedDrugNames) {
                trial.matchedDrugNames = [];
              }
              trial.matchedDrugNames.push(drugName);
              uniqueTrials.set(trial.nctId, trial);
            } else {
              // Update the existing trial to include this drug name match
              const existingTrial = uniqueTrials.get(trial.nctId);
              if (!existingTrial.matchedDrugNames.includes(drugName)) {
                existingTrial.matchedDrugNames.push(drugName);
              }
            }
          });
        }
      } else {
        errors.push({ drugName, error: result.reason.message });
      }
      
      // Log progress for long-running searches
      if (totalSearched % 10 === 0 || totalSearched === drugNames.length) {
        console.log(`Processed ${totalSearched} of ${drugNames.length} drug names...`);
      }
    });
  }

  console.log(`Search completed. Found ${uniqueTrials.size} unique trials.`);
  
  return {
    trials: Array.from(uniqueTrials.values()),
    errors: errors,
    totalDrugNames: drugNames.length,
    totalUniqueTrials: uniqueTrials.size
  };
}

// Helper function to search clinical trials for a single drug name
async function searchTrialsForName(drugName) {
  try {
    if (!drugName || typeof drugName !== 'string' || drugName.trim() === '') {
      return { trials: [], error: 'Invalid drug name' };
    }
    
    const sanitizedName = drugName.trim();
    
    // Use multiple search approaches to maximize results
    let allTrials = [];
    let errors = [];
    
    // Approach 1: Standard search by term
    try {
      // Use the ClinicalTrials.gov API v2
      const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
        params: {
          'query.term': sanitizedName,
          'fields': 'NCTId,BriefTitle,OfficialTitle,OverallStatus,BriefSummary,StartDate,CompletionDate,Phase,StudyType,LeadSponsorName,InterventionName,InterventionType,EnrollmentCount',
          'pageSize': 50, // Increased from 20 to 50 to find more results
          'format': 'json'
        },
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (response.data && response.data.studies && Array.isArray(response.data.studies)) {
        allTrials = allTrials.concat(response.data.studies);
      }
    } catch (error) {
      console.error(`Error in standard search for ${drugName}:`, error.message);
      errors.push(`Standard search error: ${error.message}`);
    }
    
    // Approach 2: Try a more specific intervention search
    try {
      const interventionResponse = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
        params: {
          'query.intr': sanitizedName,
          'fields': 'NCTId,BriefTitle,OfficialTitle,OverallStatus,BriefSummary,StartDate,CompletionDate,Phase,StudyType,LeadSponsorName,InterventionName,InterventionType,EnrollmentCount',
          'pageSize': 50,
          'format': 'json'
        },
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (interventionResponse.data && interventionResponse.data.studies && Array.isArray(interventionResponse.data.studies)) {
        // Add unique studies from this search
        for (const study of interventionResponse.data.studies) {
          if (study.protocolSection && study.protocolSection.identificationModule && study.protocolSection.identificationModule.nctId) {
            const nctId = study.protocolSection.identificationModule.nctId;
            if (!allTrials.some(t => t.protocolSection?.identificationModule?.nctId === nctId)) {
              allTrials.push(study);
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error in intervention search for ${drugName}:`, error.message);
      errors.push(`Intervention search error: ${error.message}`);
    }
    
    if (allTrials.length === 0 && errors.length > 0) {
      return { trials: [], error: errors.join('; ') };
    }
    
    // Process and format the trials
    const trials = allTrials.map(study => {
      const protocolSection = study.protocolSection || {};
      const identificationModule = protocolSection.identificationModule || {};
      const statusModule = protocolSection.statusModule || {};
      const designModule = protocolSection.designModule || {};
      const sponsorCollaboratorsModule = protocolSection.sponsorCollaboratorsModule || {};
      const armsInterventionsModule = protocolSection.armsInterventionsModule || {};
      const descriptionModule = protocolSection.descriptionModule || {};
      
      // Get interventions
      const interventions = [];
      if (armsInterventionsModule.interventions && Array.isArray(armsInterventionsModule.interventions)) {
        armsInterventionsModule.interventions.forEach(intervention => {
          interventions.push({
            name: intervention.interventionName,
            type: intervention.interventionType,
            description: intervention.interventionDescription
          });
        });
      }
      
      return {
        nctId: identificationModule.nctId,
        title: identificationModule.briefTitle || identificationModule.officialTitle || 'No title available',
        status: statusModule.overallStatus || 'UNKNOWN',
        phase: designModule.phases ? designModule.phases.join(', ') : 'Not specified',
        summary: descriptionModule.briefSummary ? 
                 descriptionModule.briefSummary.substring(0, 300) + (descriptionModule.briefSummary.length > 300 ? '...' : '') 
                 : 'No summary available',
        startDate: statusModule.startDate || 'Not specified',
        completionDate: statusModule.completionDate || 'Not specified',
        studyType: designModule.studyType || 'Not specified',
        sponsor: sponsorCollaboratorsModule.leadSponsor ? 
                sponsorCollaboratorsModule.leadSponsor.name || 'Not specified' 
                : 'Not specified',
        enrollment: designModule.enrollmentInfo ? 
                   designModule.enrollmentInfo.count || 'Not specified' 
                   : 'Not specified',
        interventions: interventions,
        url: `https://clinicaltrials.gov/study/${identificationModule.nctId}`
      };
    });
    
    return { trials, error: null };
  } catch (error) {
    console.error(`Error searching trials for ${drugName}:`, error.message);
    return { trials: [], error: error.message };
  }
}

// Helper function to search clinical trials for a single drug name
async function searchTrialsForName(drugName) {
  try {
    if (!drugName || typeof drugName !== 'string' || drugName.trim() === '') {
      return { trials: [], error: 'Invalid drug name' };
    }
    
    const sanitizedName = drugName.trim();
    
    // Use the ClinicalTrials.gov API v2
    const response = await axios.get(`https://clinicaltrials.gov/api/v2/studies`, {
      params: {
        'query.term': sanitizedName,
        'fields': 'NCTId,BriefTitle,OfficialTitle,OverallStatus,BriefSummary,StartDate,CompletionDate,Phase,StudyType,LeadSponsorName,InterventionName,InterventionType,EnrollmentCount',
        'pageSize': 20,
        'format': 'json'
      },
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (!response.data || !response.data.studies || !Array.isArray(response.data.studies)) {
      return { trials: [], error: 'Invalid response format from ClinicalTrials.gov' };
    }
    
    // Process and format the trials
    const trials = response.data.studies.map(study => {
      const protocolSection = study.protocolSection || {};
      const identificationModule = protocolSection.identificationModule || {};
      const statusModule = protocolSection.statusModule || {};
      const designModule = protocolSection.designModule || {};
      const sponsorCollaboratorsModule = protocolSection.sponsorCollaboratorsModule || {};
      const armsInterventionsModule = protocolSection.armsInterventionsModule || {};
      
      // Get interventions
      const interventions = [];
      if (armsInterventionsModule.interventions && Array.isArray(armsInterventionsModule.interventions)) {
        armsInterventionsModule.interventions.forEach(intervention => {
          interventions.push({
            name: intervention.interventionName,
            type: intervention.interventionType,
            description: intervention.interventionDescription
          });
        });
      }
      
      return {
        nctId: identificationModule.nctId,
        title: identificationModule.briefTitle || identificationModule.officialTitle || 'No title available',
        status: statusModule.overallStatus || 'UNKNOWN',
        phase: designModule.phases ? designModule.phases.join(', ') : 'Not specified',
        summary: identificationModule.briefSummary ? 
                 identificationModule.briefSummary.substring(0, 300) + (identificationModule.briefSummary.length > 300 ? '...' : '') 
                 : 'No summary available',
        startDate: statusModule.startDate || 'Not specified',
        completionDate: statusModule.completionDate || 'Not specified',
        studyType: designModule.studyType || 'Not specified',
        sponsor: sponsorCollaboratorsModule.leadSponsor ? 
                sponsorCollaboratorsModule.leadSponsor.name || 'Not specified' 
                : 'Not specified',
        enrollment: designModule.enrollmentInfo ? 
                   designModule.enrollmentInfo.count || 'Not specified' 
                   : 'Not specified',
        interventions: interventions,
        url: `https://clinicaltrials.gov/study/${identificationModule.nctId}`
      };
    });
    
    return { trials, error: null };
  } catch (error) {
    console.error(`Error searching trials for ${drugName}:`, error.message);
    return { trials: [], error: error.message };
  }
}

// app.get('/api/studies/search', validatePagination, async (req, res) => {
//   try {
//     const {
//       query, condition, intervention, status, phase, sponsor,
//       title, location, patientData, sort, countTotal, fields,
//       advanced, fetchAll
//     } = req.query;
    
//     const { page, pageSize } = req.pagination;
    
//     console.log(`🔍 Searching for studies with query: ${query || 'None specified'}`);
    
//     // If intervention is provided, default to searching by all drug names
//     // unless skipNameLookup is explicitly set to 'true'
//     let searchByDrugNames = intervention;
//     let drugNames = [];
    
//     // If we should search by drug names, get all alternate names first
//     if (searchByDrugNames) {
//       try {
//         console.log(`Finding alternate names for drug: ${intervention}`);
        
//         // Get all alternate names from various drug databases
//         const drugNamesResponse = await collectDrugNames(intervention);
        
//         if (drugNamesResponse.success && drugNamesResponse.uniqueNames.length > 0) {
//           drugNames = drugNamesResponse.uniqueNames;
//           console.log(`Found ${drugNames.length} alternate names for ${intervention}`);
//         } else {
//           // If we couldn't find alternate names, just use the original intervention
//           drugNames = [intervention];
//           console.log(`No alternate names found, using original name: ${intervention}`);
//         }
//       } catch (error) {
//         console.error('Error fetching drug names:', error);
//         // In case of error, fall back to the original intervention name
//         drugNames = [intervention];
//       }
//     }
    
//     // If we're searching across multiple drug names
//     if (searchByDrugNames && drugNames.length > 0) {
//       console.log(`Searching for studies across ${drugNames.length} drug names`);
      
//       // Store all unique studies to avoid duplicates
//       const studiesMap = new Map();
//       const studySourceNames = new Map(); // Track which drug name matched which study
      
//       // Search in small batches to avoid overwhelming the API
//       const batchSize = 5;
//       for (let i = 0; i < drugNames.length; i += batchSize) {
//         const batch = drugNames.slice(i, i + batchSize);
//         console.log(`Processing drug names batch ${i/batchSize + 1}/${Math.ceil(drugNames.length/batchSize)}`);
        
//         const batchPromises = batch.map(drugName => {
//           return searchForDrugStudies(drugName, {
//             condition, status, phase, sponsor, title, location, 
//             patientData, sort, fields, advanced
//           });
//         });
        
//         // Wait for all searches in current batch to complete
//         const batchResults = await Promise.allSettled(batchPromises);
        
//         // Process results from this batch
//         batchResults.forEach((result, index) => {
//           const drugName = batch[index];
          
//           if (result.status === 'fulfilled' && result.value.studies) {
//             const studies = result.value.studies;
            
//             // Add each study to our map, using NCT ID as the key
//             studies.forEach(study => {
//               const nctId = study.protocolSection?.identificationModule?.nctId;
              
//               if (nctId && !studiesMap.has(nctId)) {
//                 studiesMap.set(nctId, study);
//                 studySourceNames.set(nctId, [drugName]);
//               } else if (nctId) {
//                 // Add this drug name as another source for an existing study
//                 const currentSources = studySourceNames.get(nctId) || [];
//                 if (!currentSources.includes(drugName)) {
//                   currentSources.push(drugName);
//                   studySourceNames.set(nctId, currentSources);
//                 }
//               }
//             });
            
//             console.log(`Found ${studies.length} studies for drug name: ${drugName}`);
//           } else if (result.status === 'rejected') {
//             console.error(`Error searching for studies with drug name ${drugName}:`, 
//               result.reason?.message || 'Unknown error');
//           }
//         });
        
//         // Optional: Add delay between batches to prevent rate limiting
//         if (i + batchSize < drugNames.length) {
//           await new Promise(resolve => setTimeout(resolve, 500));
//         }
//       }
      
//       // Convert studies map to array
//       let allStudies = Array.from(studiesMap.values());
      
//       // Add matchInfo to each study - which drug names matched this study
//       allStudies = allStudies.map(study => {
//         const nctId = study.protocolSection?.identificationModule?.nctId;
//         const matchedDrugNames = studySourceNames.get(nctId) || [];
        
//         // Add a new section to the study with match information
//         return {
//           ...study,
//           drugNameMatches: {
//             originalDrugName: intervention,
//             matchedDrugNames: matchedDrugNames
//           }
//         };
//       });
      
//       console.log(`Total unique studies found across all drug names: ${allStudies.length}`);
      
//       // Apply pagination if needed
//       let paginatedStudies = allStudies;
//       let paginationInfo = {
//         currentPage: 1,
//         pageSize: allStudies.length,
//         totalCount: allStudies.length,
//         totalPages: 1,
//         hasNextPage: false
//       };
      
//       if (fetchAll !== 'true') {
//         const startIndex = (page - 1) * pageSize;
//         const endIndex = startIndex + pageSize;
//         paginatedStudies = allStudies.slice(startIndex, endIndex);
        
//         // Update pagination info
//         paginationInfo = {
//           currentPage: page,
//           pageSize,
//           totalCount: allStudies.length,
//           totalPages: Math.ceil(allStudies.length / pageSize),
//           hasNextPage: endIndex < allStudies.length
//         };
//       }
      
//       return res.json({
//         success: true,
//         data: {
//           studies: paginatedStudies,
//           totalCount: allStudies.length,
//           drugNames: drugNames,
//           originalDrugName: intervention
//         },
//         pagination: paginationInfo
//       });
//     }
    
//     // Standard search if not doing the drug name search (no intervention provided)
//     // Build parameters for API request
//     const params = new URLSearchParams();
    
//     // Add query parameters
//     if (condition) params.append('query.cond', condition);
//     if (intervention && !searchByDrugNames) params.append('query.intr', intervention);
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
    
//     // Check if we need to fetch all studies
//     if (fetchAll === 'true') {
//       const allStudies = [];
//       let currentParams = new URLSearchParams(params.toString());
//       let hasMorePages = true;
//       let nextPageToken = null;
      
//       while (hasMorePages) {
//         if (nextPageToken) {
//           currentParams.set('pageToken', nextPageToken);
//         }
        
//         console.log(`Fetching page with token: ${nextPageToken || 'initial'}`);
        
//         const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
//           params: currentParams
//         });
        
//         const studies = response.data.studies || [];
//         allStudies.push(...studies);
        
//         nextPageToken = response.data.nextPageToken;
//         hasMorePages = !!nextPageToken;
        
//         // Optional: Add delay between requests to prevent rate limiting
//         if (hasMorePages) {
//           await new Promise(resolve => setTimeout(resolve, 300));
//         }
//       }
      
//       return res.json({
//         success: true,
//         data: {
//           studies: allStudies,
//           totalCount: allStudies.length
//         },
//         pagination: {
//           currentPage: 1,
//           pageSize: allStudies.length,
//           totalCount: allStudies.length,
//           totalPages: 1,
//           hasNextPage: false
//         }
//       });
//     }
    
//     // Standard paginated response when fetchAll is not true
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

// REAL REAL // Backend route with enhanced pagination support
// app.get('/api/studies/search', validatePagination, async (req, res) => {
//   try {
//     const {
//       query, condition, intervention, status, phase, sponsor,
//       title, location, patientData, sort, countTotal, fields,
//       advanced, fetchAll
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
    
//     // Check if we need to fetch all studies
//     if (fetchAll === 'true') {
//       const allStudies = [];
//       let currentParams = new URLSearchParams(params.toString());
//       let hasMorePages = true;
//       let nextPageToken = null;
      
//       while (hasMorePages) {
//         if (nextPageToken) {
//           currentParams.set('pageToken', nextPageToken);
//         }
        
//         console.log(`Fetching page with token: ${nextPageToken || 'initial'}`);
        
//         const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
//           params: currentParams
//         });
        
//         const studies = response.data.studies || [];
//         allStudies.push(...studies);
        
//         nextPageToken = response.data.nextPageToken;
//         hasMorePages = !!nextPageToken;
        
//         // Optional: Add delay between requests to prevent rate limiting
//         if (hasMorePages) {
//           await new Promise(resolve => setTimeout(resolve, 300));
//         }
//       }
      
//       return res.json({
//         success: true,
//         data: {
//           studies: allStudies,
//           totalCount: allStudies.length
//         },
//         pagination: {
//           currentPage: 1,
//           pageSize: allStudies.length,
//           totalCount: allStudies.length,
//           totalPages: 1,
//           hasNextPage: false
//         }
//       });
//     }
    
//     // Standard paginated response when fetchAll is not true
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





// // Function to search for clinical trials using all collected drug names
// // Function to search for clinical trials using all collected drug names
// async function searchAllTrialsForDrugNames(drugNames) {
//   // Store all unique trials to avoid duplicates
//   const uniqueTrials = new Map();
//   const errors = [];
//   let totalSearched = 0;
  
//   console.log(`Searching trials for ${drugNames.length} drug names...`);
  
//   // Search in batches to avoid overwhelming the API
//   const batchSize = 5;
//   for (let i = 0; i < drugNames.length; i += batchSize) {
//     const batch = drugNames.slice(i, i + batchSize);
//     const searchPromises = batch.map(drugName => searchTrialsForName(drugName));
    
//     // Wait for all searches in current batch to complete
//     const batchResults = await Promise.allSettled(searchPromises);
    
//     // Process results from this batch
//     batchResults.forEach((result, index) => {
//       const drugName = batch[index];
//       totalSearched++;
      
//       if (result.status === 'fulfilled') {
//         const { trials, error } = result.value;
        
//         if (error) {
//           errors.push({ drugName, error });
//         } else if (trials && trials.length > 0) {
//           // Add each trial to our map, using NCT ID as the key
//           trials.forEach(trial => {
//             if (!uniqueTrials.has(trial.nctId)) {
//               // Add relevance info to know which drug names matched this trial
//               if (!trial.matchedDrugNames) {
//                 trial.matchedDrugNames = [];
//               }
//               trial.matchedDrugNames.push(drugName);
//               uniqueTrials.set(trial.nctId, trial);
//             } else {
//               // Update the existing trial to include this drug name match
//               const existingTrial = uniqueTrials.get(trial.nctId);
//               if (!existingTrial.matchedDrugNames.includes(drugName)) {
//                 existingTrial.matchedDrugNames.push(drugName);
//               }
//             }
//           });
//         }
//       } else {
//         errors.push({ drugName, error: result.reason.message });
//       }
      
//       // Log progress for long-running searches
//       if (totalSearched % 10 === 0 || totalSearched === drugNames.length) {
//         console.log(`Processed ${totalSearched} of ${drugNames.length} drug names...`);
//       }
//     });
//   }

//   console.log(`Search completed. Found ${uniqueTrials.size} unique trials.`);
  
//   return {
//     trials: Array.from(uniqueTrials.values()),
//     errors: errors,
//     totalDrugNames: drugNames.length,
//     totalUniqueTrials: uniqueTrials.size
//   };
// }

// // Helper function to search clinical trials for a single drug name

// // Helper function to search clinical trials for a single drug name
// async function searchTrialsForName(drugName) {
//   try {
//     if (!drugName || typeof drugName !== 'string' || drugName.trim() === '') {
//       return { trials: [], error: 'Invalid drug name' };
//     }
    
//     const sanitizedName = drugName.trim();
    
//     // Use multiple search approaches to maximize results
//     let allTrials = [];
//     let errors = [];
    
//     // Approach 1: Standard search by term
//     try {
//       // Use the ClinicalTrials.gov API v2
//       const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
//         params: {
//           'query.term': sanitizedName,
//           'fields': 'protocolSection,resultsSection,hasResults',
//           // 'fetchAll': 'false', // Match backend parameter
//           // 'fields': 'NCTId,BriefTitle,OfficialTitle,OverallStatus,BriefSummary,StartDate,CompletionDate,Phase,StudyType,LeadSponsorName,InterventionName,InterventionType,EnrollmentCount',
//           'pageSize': 100,
//           'format': 'json'
//         },
//         headers: {
//           'Accept': 'application/json'
//         }
//       });
      
//       if (response.data && response.data.studies && Array.isArray(response.data.studies)) {
//         allTrials = allTrials.concat(response.data.studies);
//       }
//     } catch (error) {
//       console.error(`Error in standard search for ${drugName}:`, error.message);
//       errors.push(`Standard search error: ${error.message}`);
//     }
    
//     // Approach 2: Try a more specific intervention search
//     try {
//       const interventionResponse = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
//         params: {
//           'query.intr': sanitizedName,
//           'fields': 'protocolSection,resultsSection,hasResults',
//           // 'fetchAll': 'false', // Match backend parameter
//           // 'fields': 'NCTId,BriefTitle,OfficialTitle,OverallStatus,BriefSummary,StartDate,CompletionDate,Phase,StudyType,LeadSponsorName,InterventionName,InterventionType,EnrollmentCount',
//           'pageSize': 100,
//           'format': 'json'
//         },
//         headers: {
//           'Accept': 'application/json'
//         }
//       });
      
//       if (interventionResponse.data && interventionResponse.data.studies && Array.isArray(interventionResponse.data.studies)) {
//         // Add unique studies from this search
//         for (const study of interventionResponse.data.studies) {
//           if (study.protocolSection && study.protocolSection.identificationModule && study.protocolSection.identificationModule.nctId) {
//             const nctId = study.protocolSection.identificationModule.nctId;
//             if (!allTrials.some(t => t.protocolSection?.identificationModule?.nctId === nctId)) {
//               allTrials.push(study);
//             }
//           }
//         }
//       }
//     } catch (error) {
//       console.error(`Error in intervention search for ${drugName}:`, error.message);
//       errors.push(`Intervention search error: ${error.message}`);
//     }
    
//     // Approach 3: Explicitly search for completed trials
//     try {
//       const completedTrialsResponse = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
//         params: {
//           'query.term': sanitizedName,
//           'filter.overallStatus': 'COMPLETED',
//           'fields': 'protocolSection,resultsSection,hasResults',
//           // 'fetchAll': 'false', // Match backend parameter
//           // 'fields': 'NCTId,BriefTitle,OfficialTitle,OverallStatus,BriefSummary,StartDate,CompletionDate,Phase,StudyType,LeadSponsorName,InterventionName,InterventionType,EnrollmentCount',
//           'pageSize': 100,
//           'format': 'json'
//         },
//         headers: {
//           'Accept': 'application/json'
//         }
//       });
      
//       if (completedTrialsResponse.data && completedTrialsResponse.data.studies && Array.isArray(completedTrialsResponse.data.studies)) {
//         // Add unique completed studies
//         for (const study of completedTrialsResponse.data.studies) {
//           if (study.protocolSection && study.protocolSection.identificationModule && study.protocolSection.identificationModule.nctId) {
//             const nctId = study.protocolSection.identificationModule.nctId;
//             if (!allTrials.some(t => t.protocolSection?.identificationModule?.nctId === nctId)) {
//               allTrials.push(study);
//             }
//           }
//         }
//       }
//     } catch (error) {
//       console.error(`Error in completed trials search for ${drugName}:`, error.message);
//       errors.push(`Completed trials search error: ${error.message}`);
//     }
    
//     // Approach 4: Search for completed trials with intervention filter
//     try {
//       const completedIntervResponse = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
//         params: {
//           'query.intr': sanitizedName,
//           'filter.overallStatus': 'COMPLETED',
//           'fields': 'protocolSection,resultsSection,hasResults',
//           // 'fetchAll': 'false', // Match backend parameter
//           // 'fields': 'NCTId,BriefTitle,OfficialTitle,OverallStatus,BriefSummary,StartDate,CompletionDate,Phase,StudyType,LeadSponsorName,InterventionName,InterventionType,EnrollmentCount',
//           'pageSize': 100,
//           'format': 'json'
//         },
//         headers: {
//           'Accept': 'application/json'
//         }
//       });
      
//       if (completedIntervResponse.data && completedIntervResponse.data.studies && Array.isArray(completedIntervResponse.data.studies)) {
//         // Add unique completed studies with intervention match
//         for (const study of completedIntervResponse.data.studies) {
//           if (study.protocolSection && study.protocolSection.identificationModule && study.protocolSection.identificationModule.nctId) {
//             const nctId = study.protocolSection.identificationModule.nctId;
//             if (!allTrials.some(t => t.protocolSection?.identificationModule?.nctId === nctId)) {
//               allTrials.push(study);
//             }
//           }
//         }
//       }
//     } catch (error) {
//       console.error(`Error in completed trials with intervention search for ${drugName}:`, error.message);
//       errors.push(`Completed intervention search error: ${error.message}`);
//     }
    
//     if (allTrials.length === 0 && errors.length > 0) {
//       return { trials: [], error: errors.join('; ') };
//     }
    
//     console.log(`Found ${allTrials.length} total trials for ${drugName} after all search approaches`);
    
//     // Process and format the trials
//     const trials = allTrials.map(study => {
//       const protocolSection = study.protocolSection || {};
//       const identificationModule = protocolSection.identificationModule || {};
//       const statusModule = protocolSection.statusModule || {};
//       const designModule = protocolSection.designModule || {};
//       const sponsorCollaboratorsModule = protocolSection.sponsorCollaboratorsModule || {};
//       const armsInterventionsModule = protocolSection.armsInterventionsModule || {};
//       const descriptionModule = protocolSection.descriptionModule || {};
//       const conditionsModule = protocolSection.conditionsModule || {};
      
//       // Get interventions
//       const interventions = [];
//       if (armsInterventionsModule.interventions && Array.isArray(armsInterventionsModule.interventions)) {
//         armsInterventionsModule.interventions.forEach(intervention => {
//           interventions.push({
//             name: intervention.name,
//             type: intervention.type,
//             description: intervention.description
//           });
//         });
//       }
      
//       // Extract conditions - IMPORTANT for timeline generation
//       const conditions = conditionsModule.conditions || [];
      
//       return {
//         nctId: identificationModule.nctId,
//         title: identificationModule.briefTitle || identificationModule.officialTitle || 'No title available',
//         status: statusModule.overallStatus || 'UNKNOWN',
//         phase: designModule.phases ? designModule.phases.join(', ') : 'Not specified',
//         summary: descriptionModule.briefSummary ? 
//                  descriptionModule.briefSummary.substring(0, 300) + (descriptionModule.briefSummary.length > 300 ? '...' : '') 
//                  : (identificationModule.briefSummary ?
//                     identificationModule.briefSummary.substring(0, 300) + (identificationModule.briefSummary.length > 300 ? '...' : '')
//                     : 'No summary available'),
//         startDate: statusModule.startDate || 'Not specified',
//         completionDate: statusModule.completionDate || 'Not specified',
//         studyType: designModule.studyType || 'Not specified',
//         sponsor: sponsorCollaboratorsModule.leadSponsor ? 
//                 sponsorCollaboratorsModule.leadSponsor.name || 'Not specified' 
//                 : 'Not specified',
//         enrollment: designModule.enrollmentInfo ? 
//                    designModule.enrollmentInfo.count || 'Not specified' 
//                    : 'Not specified',
//         interventions: interventions,
//         url: `https://clinicaltrials.gov/study/${identificationModule.nctId}`,
//         // Add conditions array
//         conditions: conditions,
//         // Preserve hasResults flag
//         hasResults: study.hasResults
//       };
//     });
    
//     return { trials, error: null };
//   } catch (error) {
//     console.error(`Error searching trials for ${drugName}:`, error.message);
//     return { trials: [], error: error.message };
//   }
// }


// // Update the API route to preserve the exact same structure for both paths

// app.get('/api/studies/search', validatePagination, async (req, res) => {
//   try {
//     const {
//       query, condition, intervention, status, phase, sponsor,
//       title, location, patientData, sort, countTotal, fields,
//       advanced, fetchAll
//     } = req.query;
    
//     drugName = intervention

//     const { page, pageSize } = req.pagination;
    
//     console.log(`🔍 Searching for studies with query: ${query || 'None specified'}`);

//     // If drugName is provided, get related drugs and fetch studies for each
//     if (drugName) {
//       console.log(`🔍 Drug name provided: ${drugName}. Fetching related drugs.`);
      
//       // Call function to get related drugs
//       const relatedDrugs = await getRelatedDrugs(drugName);
//       console.log(`Found ${relatedDrugs.length} related drugs for ${drugName}`);
      
//       // Combine the original drug with related drugs
//       const allDrugsToQuery = [drugName, ...relatedDrugs];
      
//       // Use the searchAllTrialsForDrugNames function to handle multiple drug searching
//       console.log(`Searching clinical trials for ${allDrugsToQuery.length} drug names...`);
      
//       // IMPORTANT: Instead of using the searchAllTrialsForDrugNames function that returns simplified data,
//       // we'll use the ClinicalTrials.gov API directly to get the full data structure

//       // Store all unique trials to avoid duplicates
//       const uniqueTrials = new Map();
//       const errors = [];
      
//       // Search in batches to avoid overwhelming the API
//       const batchSize = 5;
//       for (let i = 0; i < allDrugsToQuery.length; i += batchSize) {
//         const batch = allDrugsToQuery.slice(i, i + batchSize);
        
//         // For each drug name, do a full API search to get complete data
//         for (const drugToSearch of batch) {
//           try {
//             console.log(`Searching for ${drugToSearch}...`);
            
//             // Build parameters for API request - same as standard route
//             const params = new URLSearchParams();
            
//             // Add drug name as intervention search
//             params.append('query.intr', drugToSearch);
            
//             // Add fields - get complete data structure just like standard route
//             params.append('fields', 'protocolSection,derivedSection,hasResults');
            
//             // Get a large number of results per page
//             params.append('pageSize', '100');
            
//             // Format parameter
//             params.append('format', 'json');
            
//             // Make the API request
//             const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
//               params: params
//             });
            
//             const studies = response.data.studies || [];
//             console.log(`Found ${studies.length} studies for ${drugToSearch}`);
            
//             // Add each study to our map, using NCT ID as the key
//             studies.forEach(study => {
//               const nctId = study.protocolSection?.identificationModule?.nctId;
//               if (nctId && !uniqueTrials.has(nctId)) {
//                 // Add relevance info to know which drug names matched this trial
//                 if (!study.matchedDrugNames) {
//                   study.matchedDrugNames = [];
//                 }
//                 study.matchedDrugNames.push(drugToSearch);
//                 uniqueTrials.set(nctId, study);
//               } else if (nctId) {
//                 // Update the existing trial to include this drug name match
//                 const existingTrial = uniqueTrials.get(nctId);
//                 if (!existingTrial.matchedDrugNames.includes(drugToSearch)) {
//                   existingTrial.matchedDrugNames.push(drugToSearch);
//                 }
//               }
//             });
            
//             // Also try a term search to catch more results
//             params.delete('query.intr');
//             params.append('query.term', drugToSearch);
            
//             const termResponse = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
//               params: params
//             });
            
//             const termStudies = termResponse.data.studies || [];
//             console.log(`Found ${termStudies.length} additional studies for ${drugToSearch} via term search`);
            
//             // Add each study from term search
//             termStudies.forEach(study => {
//               const nctId = study.protocolSection?.identificationModule?.nctId;
//               if (nctId && !uniqueTrials.has(nctId)) {
//                 // Add relevance info
//                 if (!study.matchedDrugNames) {
//                   study.matchedDrugNames = [];
//                 }
//                 study.matchedDrugNames.push(drugToSearch);
//                 uniqueTrials.set(nctId, study);
//               } else if (nctId) {
//                 // Update the existing trial
//                 const existingTrial = uniqueTrials.get(nctId);
//                 if (!existingTrial.matchedDrugNames.includes(drugToSearch)) {
//                   existingTrial.matchedDrugNames.push(drugToSearch);
//                 }
//               }
//             });
            
//           } catch (error) {
//             console.error(`Error searching for ${drugToSearch}:`, error.message);
//             errors.push({ drugName: drugToSearch, error: error.message });
//           }
          
//           // Add a small delay between requests
//           await new Promise(resolve => setTimeout(resolve, 300));
//         }
//       }
      
//       // Get the trial results
//       const allStudies = Array.from(uniqueTrials.values());
//       console.log(`Found ${allStudies.length} unique studies for all drug names`);
      
//       // Add queriedDrugs to each study (this doesn't change the structure)
//       allStudies.forEach(study => {
//         study.queriedDrugs = study.matchedDrugNames || [];
//       });
      
//       // Calculate pagination
//       const effectivePageSize = fetchAll === 'true' ? allStudies.length : pageSize;
//       const totalPages = Math.ceil(allStudies.length / effectivePageSize);
      
//       // If not fetching all, apply manual pagination
//       let paginatedStudies = allStudies;
//       if (fetchAll !== 'true') {
//         const startIdx = (page - 1) * pageSize;
//         const endIdx = startIdx + pageSize;
//         paginatedStudies = allStudies.slice(startIdx, endIdx);
//       }
      
//       // Return in the same format as the standard route
//       return res.json({
//         success: true,
//         data: {
//           studies: paginatedStudies,
//           totalCount: allStudies.length,
//           queriedDrugs: allDrugsToQuery
//         },
//         pagination: {
//           currentPage: fetchAll === 'true' ? 1 : page,
//           pageSize: effectivePageSize,
//           totalCount: allStudies.length,
//           totalPages: fetchAll === 'true' ? 1 : totalPages,
//           hasNextPage: fetchAll === 'true' ? false : (page < totalPages)
//         }
//       });
//     } else {


//       // Original code path when no drugName is provided
//       // Build parameters for API request
//       const params = new URLSearchParams();
      
//       // Add query parameters
//       if (condition) params.append('query.cond', condition);
//       if (intervention) params.append('query.intr', intervention);
//       if (title) params.append('query.titles', title);
//       if (location) params.append('query.locn', location);
//       if (sponsor) params.append('query.spons', sponsor);
//       if (query) params.append('query.term', query);
//       if (patientData) params.append('query.patient', patientData);
      
//       // Add filter parameters
//       if (status) {
//         if (Array.isArray(status)) {
//           params.append('filter.overallStatus', status.join(','));
//         } else {
//           params.append('filter.overallStatus', status);
//         }
//       }
      
//       // Add advanced filter
//       if (advanced) params.append('filter.advanced', advanced);
      
//       // Add pagination
//       params.append('pageSize', pageSize);
//       if (req.query.pageToken) {
//         params.append('pageToken', req.query.pageToken);
//       }
      
//       // Add sorting
//       if (sort) {
//         if (Array.isArray(sort)) {
//           params.append('sort', sort.join(','));
//         } else {
//           params.append('sort', sort);
//         }
//       }
      
//       // Add count total
//       if (countTotal) params.append('countTotal', true);
      
//       // Add fields
//       if (fields) {
//         if (Array.isArray(fields)) {
//           params.append('fields', fields.join(','));
//         } else {
//           params.append('fields', fields);
//         }
//       } else {
//         // Default fields if none specified - comprehensive data
//         params.append('fields', 'protocolSection,derivedSection,hasResults');
//       }
      
//       // Format parameter
//       params.append('format', 'json');
      
//       // Check if we need to fetch all studies
//       if (fetchAll === 'true') {
//         const allStudies = [];
//         let currentParams = new URLSearchParams(params.toString());
//         let hasMorePages = true;
//         let nextPageToken = null;
        
//         while (hasMorePages) {
//           if (nextPageToken) {
//             currentParams.set('pageToken', nextPageToken);
//           }
          
//           console.log(`Fetching page with token: ${nextPageToken || 'initial'}`);
          
//           const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
//             params: currentParams
//           });
          
//           const studies = response.data.studies || [];
//           allStudies.push(...studies);
          
//           nextPageToken = response.data.nextPageToken;
//           hasMorePages = !!nextPageToken;
          
//           // Optional: Add delay between requests to prevent rate limiting
//           if (hasMorePages) {
//             await new Promise(resolve => setTimeout(resolve, 300));
//           }
//         }
//         if (allStudies.length < 5) {
//           console.log(`🔍 Drug name provided: ${drugName}. Fetching related drugs.`);
          
//           // Call function to get related drugs
//           const relatedDrugs = await getRelatedDrugs(drugName);
//           console.log(`Found ${relatedDrugs.length} related drugs for ${drugName}`);
          
//           // Combine the original drug with related drugs
//           const allDrugsToQuery = [drugName, ...relatedDrugs];
          
//           // Use the searchAllTrialsForDrugNames function to handle multiple drug searching
//           console.log(`Searching clinical trials for ${allDrugsToQuery.length} drug names...`);
          
//           // IMPORTANT: Instead of using the searchAllTrialsForDrugNames function that returns simplified data,
//           // we'll use the ClinicalTrials.gov API directly to get the full data structure
    
//           // Store all unique trials to avoid duplicates
//           const uniqueTrials = new Map();
//           const errors = [];
          
//           // Search in batches to avoid overwhelming the API
//           const batchSize = 5;
//           for (let i = 0; i < allDrugsToQuery.length; i += batchSize) {
//             const batch = allDrugsToQuery.slice(i, i + batchSize);
            
//             // For each drug name, do a full API search to get complete data
//             for (const drugToSearch of batch) {
//               try {
//                 console.log(`Searching for ${drugToSearch}...`);
                
//                 // Build parameters for API request - same as standard route
//                 const params = new URLSearchParams();
                
//                 // Add drug name as intervention search
//                 params.append('query.intr', drugToSearch);
                
//                 // Add fields - get complete data structure just like standard route
//                 params.append('fields', 'protocolSection,derivedSection,hasResults');
                
//                 // Get a large number of results per page
//                 params.append('pageSize', '100');
                
//                 // Format parameter
//                 params.append('format', 'json');
                
//                 // Make the API request
//                 const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
//                   params: params
//                 });
                
//                 const studies = response.data.studies || [];
//                 console.log(`Found ${studies.length} studies for ${drugToSearch}`);
                
//                 // Add each study to our map, using NCT ID as the key
//                 studies.forEach(study => {
//                   const nctId = study.protocolSection?.identificationModule?.nctId;
//                   if (nctId && !uniqueTrials.has(nctId)) {
//                     // Add relevance info to know which drug names matched this trial
//                     if (!study.matchedDrugNames) {
//                       study.matchedDrugNames = [];
//                     }
//                     study.matchedDrugNames.push(drugToSearch);
//                     uniqueTrials.set(nctId, study);
//                   } else if (nctId) {
//                     // Update the existing trial to include this drug name match
//                     const existingTrial = uniqueTrials.get(nctId);
//                     if (!existingTrial.matchedDrugNames.includes(drugToSearch)) {
//                       existingTrial.matchedDrugNames.push(drugToSearch);
//                     }
//                   }
//                 });
                
//                 // Also try a term search to catch more results
//                 params.delete('query.intr');
//                 params.append('query.term', drugToSearch);
                
//                 const termResponse = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
//                   params: params
//                 });
                
//                 const termStudies = termResponse.data.studies || [];
//                 console.log(`Found ${termStudies.length} additional studies for ${drugToSearch} via term search`);
                
//                 // Add each study from term search
//                 termStudies.forEach(study => {
//                   const nctId = study.protocolSection?.identificationModule?.nctId;
//                   if (nctId && !uniqueTrials.has(nctId)) {
//                     // Add relevance info
//                     if (!study.matchedDrugNames) {
//                       study.matchedDrugNames = [];
//                     }
//                     study.matchedDrugNames.push(drugToSearch);
//                     uniqueTrials.set(nctId, study);
//                   } else if (nctId) {
//                     // Update the existing trial
//                     const existingTrial = uniqueTrials.get(nctId);
//                     if (!existingTrial.matchedDrugNames.includes(drugToSearch)) {
//                       existingTrial.matchedDrugNames.push(drugToSearch);
//                     }
//                   }
//                 });
                
//               } catch (error) {
//                 console.error(`Error searching for ${drugToSearch}:`, error.message);
//                 errors.push({ drugName: drugToSearch, error: error.message });
//               }
              
//               // Add a small delay between requests
//               await new Promise(resolve => setTimeout(resolve, 300));
//             }
//           }
          
//           // Get the trial results
//           const allStudies = Array.from(uniqueTrials.values());
//           console.log(`Found ${allStudies.length} unique studies for all drug names`);
          
//           // Add queriedDrugs to each study (this doesn't change the structure)
//           allStudies.forEach(study => {
//             study.queriedDrugs = study.matchedDrugNames || [];
//           });
          
//           // Calculate pagination
//           const effectivePageSize = fetchAll === 'true' ? allStudies.length : pageSize;
//           const totalPages = Math.ceil(allStudies.length / effectivePageSize);
          
//           // If not fetching all, apply manual pagination
//           let paginatedStudies = allStudies;
//           if (fetchAll !== 'true') {
//             const startIdx = (page - 1) * pageSize;
//             const endIdx = startIdx + pageSize;
//             paginatedStudies = allStudies.slice(startIdx, endIdx);
//           }
          
//           // Return in the same format as the standard route
//           return res.json({
//             success: true,
//             data: {
//               studies: paginatedStudies,
//               totalCount: allStudies.length,
//               queriedDrugs: allDrugsToQuery
//             },
//             pagination: {
//               currentPage: fetchAll === 'true' ? 1 : page,
//               pageSize: effectivePageSize,
//               totalCount: allStudies.length,
//               totalPages: fetchAll === 'true' ? 1 : totalPages,
//               hasNextPage: fetchAll === 'true' ? false : (page < totalPages)
//             }
//           });
//         } else {
        
//         return res.json({
//           success: true,
//           data: {
//             studies: allStudies,
//             totalCount: allStudies.length
//           },
//           pagination: {
//             currentPage: 1,
//             pageSize: allStudies.length,
//             totalCount: allStudies.length,
//             totalPages: 1,
//             hasNextPage: false
//           }
//         });
//       }
//       }
      
//       // Standard paginated response when fetchAll is not true
//       const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
//         params: params
//       });
      
//       // Format pagination for frontend
//       const totalCount = response.data.totalCount || 0;
//       const totalPages = Math.ceil(totalCount / pageSize);
//       const hasNextPage = !!response.data.nextPageToken;
      
//       const paginationInfo = {
//         currentPage: page,
//         pageSize,
//         totalCount,
//         totalPages,
//         hasNextPage,
//         nextPageToken: response.data.nextPageToken
//       };
      
//       res.json({
//         success: true,
//         data: response.data,
//         pagination: paginationInfo
//       });
//     }
//   } catch (error) {
//     handleApiError(error, res);
//   }
// });











/**
 * Enhanced function to fetch clinical trials for specified search parameters
 * Automatically searches for equivalent drug names when fewer than 10 trials are found
 * 
 * @param {Object} params - Search parameters
 * @param {string} params.drug - Drug name (intervention)
 * @param {string} params.condition - Medical condition
 * @param {boolean} params.hasResults - Filter to only trials with results
 * @param {number} params.yearsBack - Limit search to trials started within this many years
 * @param {string} params.sinceDate - Only include trials updated since this date (YYYY-MM-DD)
 * @param {boolean} params.searchRelated - Whether to search for related drugs (default: auto when <10 trials)
 * @param {number} params.page - Page number for pagination
 * @param {number} params.pageSize - Number of results per page
 * @param {boolean} params.fetchAll - Whether to fetch all pages (overrides page/pageSize)
 * @param {string} params.status - Filter by trial status
 * @returns {Promise<Object>} - Search results and pagination info
 */
async function fetchClinicalTrials(params) {
  try {
    // Extract and normalize parameters
    const {
      drug = null,
      condition = null,
      hasResults = null,
      yearsBack = 5,
      sinceDate = null,
      searchRelated = undefined, // Default undefined to enable auto-detection
      page = 1,
      pageSize = 10,
      fetchAll = false,
      status = null
    } = params;

    console.log(`Starting clinical trials search with params:`, params);

    // Calculate date range for filtering
    const today = new Date();
    const startDate = new Date();
    startDate.setFullYear(today.getFullYear() - yearsBack);
    
    // Format date as YYYY-MM-DD for the API
    const formattedStartDate = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
    
    // Format sinceDate if provided
    let formattedSinceDate = null;
    if (sinceDate) {
      const since = new Date(sinceDate);
      formattedSinceDate = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;
    }

    // Store all unique trials to avoid duplicates
    const uniqueTrials = new Map();
    const errors = [];
    let totalTrialsFound = 0;
    
    // Initialize array for all drugs to search, including related ones
    let drugsToSearch = [];
    
    // Flag to track if we need to search for related drugs automatically
    let shouldSearchRelated = searchRelated === true;
    
    // If drug is provided, perform an initial search
    if (drug) {
      drugsToSearch = [drug]; // Start with just the original drug
      console.log(`Initial search for drug: ${drug}`);
      
      // Special handling for drug + condition combination
      if (condition) {
        console.log(`Searching for trials with both drug "${drug}" and condition "${condition}"`);
        
        // Base search params for drug + condition
        const searchParams = {
          intervention: drug,
          condition: condition,
          fields: "protocolSection,derivedSection,hasResults",
          pageSize: 100
        };
        
        // Add optional filters
        if (hasResults !== null) searchParams.hasResults = hasResults;
        if (status) searchParams.status = status;
        
        // Add date filters using advanced search
        searchParams.advanced = `AREA[StartDate]RANGE[${formattedStartDate},MAX]${
          formattedSinceDate ? ` AND AREA[LastUpdatePostDate]RANGE[${formattedSinceDate},MAX]` : ''
        }`;
        
        // Perform search
        const combinedResults = await fetchAllPagesOfStudies(searchParams, fetchAll);
        
        // Store trials with both drug and condition
        combinedResults.studies.forEach(study => {
          const nctId = study.protocolSection?.identificationModule?.nctId;
          if (nctId && !uniqueTrials.has(nctId)) {
            // Add metadata about which search found this
            study.searchMetadata = {
              matchedDrug: drug,
              matchedCondition: condition
            };
            uniqueTrials.set(nctId, study);
          }
        });
        
        totalTrialsFound = combinedResults.studies.length;
        console.log(`Found ${totalTrialsFound} trials matching both drug "${drug}" and condition "${condition}"`);
        
        // If fewer than 10 trials found and searchRelated isn't explicitly false, auto-search related drugs
        if (totalTrialsFound < 10 && searchRelated !== false) {
          console.log(`Fewer than 10 trials found. Will automatically search for related drugs.`);
          shouldSearchRelated = true;
        }
      } else {
        // Drug-only search
        console.log(`Performing drug-only search for: ${drug}`);
        
        // Base search params for drug-only search
        const searchParams = {
          intervention: drug,
          fields: "protocolSection,derivedSection,hasResults",
          pageSize: 100
        };
        
        // Add optional filters
        if (hasResults !== null) searchParams.hasResults = hasResults;
        if (status) searchParams.status = status;
        
        // Add date filters
        searchParams.advanced = `AREA[StartDate]RANGE[${formattedStartDate},MAX]${
          formattedSinceDate ? ` AND AREA[LastUpdatePostDate]RANGE[${formattedSinceDate},MAX]` : ''
        }`;
        
        // Perform search
        const drugResults = await fetchAllPagesOfStudies(searchParams, true);
        
        console.log(`Found ${drugResults.studies.length} trials for drug "${drug}"`);
        
        // Store unique trials
        drugResults.studies.forEach(study => {
          const nctId = study.protocolSection?.identificationModule?.nctId;
          if (nctId && !uniqueTrials.has(nctId)) {
            // Add metadata about which drug matched
            study.searchMetadata = {
              matchedDrug: drug,
              isOriginalDrug: true // Flag to indicate this is the original drug
            };
            uniqueTrials.set(nctId, study);
          }
        });
        
        totalTrialsFound = drugResults.studies.length;
        
        // If fewer than 10 trials found and searchRelated isn't explicitly false, auto-search related drugs
        if (totalTrialsFound < 10 && searchRelated !== false) {
          console.log(`Fewer than 10 trials found (${totalTrialsFound}). Will automatically search for related drugs.`);
          shouldSearchRelated = true;
        }
      }
      
      // If we should search for related drugs (either explicitly requested or auto-triggered)
      if (shouldSearchRelated) {
        try {
          console.log(`Getting related drugs for: ${drug}`);
          const relatedDrugs = await getRelatedDrugs(drug);
          
          if (relatedDrugs && relatedDrugs.length > 0) {
            // Add related drugs to the search list
            drugsToSearch = [...drugsToSearch, ...relatedDrugs];
            console.log(`Will search for ${drugsToSearch.length} drugs total (original + ${relatedDrugs.length} related).`);
            
            // Process related drugs in batches to avoid overwhelming the API
            const batchSize = 5;
            // Start from index 1 as we already searched the original drug
            for (let i = 1; i < drugsToSearch.length; i += batchSize) {
              const batch = drugsToSearch.slice(i, i + batchSize);
              console.log(`Processing batch ${Math.floor(i/batchSize) + 1} with ${batch.length} drugs`);
              
              // Sequential processing to be gentler on the API
              for (const drugName of batch) {
                try {
                  console.log(`Searching for trials with related drug: ${drugName}`);
                  
                  // Base search params for related drug search
                  const searchParams = {
                    intervention: drugName,
                    fields: "protocolSection,derivedSection,hasResults",
                    pageSize: 100
                  };
                  
                  // Add condition if it was provided in the original search
                  if (condition) searchParams.condition = condition;
                  
                  // Add optional filters
                  if (hasResults !== null) searchParams.hasResults = hasResults;
                  if (status) searchParams.status = status;
                  
                  // Add date filters
                  searchParams.advanced = `AREA[StartDate]RANGE[${formattedStartDate},MAX]${
                    formattedSinceDate ? ` AND AREA[LastUpdatePostDate]RANGE[${formattedSinceDate},MAX]` : ''
                  }`;
                  
                  // Perform search
                  const relatedDrugResults = await fetchAllPagesOfStudies(searchParams, true);
                  
                  console.log(`Found ${relatedDrugResults.studies.length} trials for related drug "${drugName}"`);
                  
                  // Store unique trials
                  relatedDrugResults.studies.forEach(study => {
                    const nctId = study.protocolSection?.identificationModule?.nctId;
                    if (nctId && !uniqueTrials.has(nctId)) {
                      // Add metadata about which related drug matched
                      study.searchMetadata = {
                        matchedDrug: drugName,
                        isRelatedDrug: true,
                        relatedTo: drug
                      };
                      if (condition) {
                        study.searchMetadata.matchedCondition = condition;
                      }
                      uniqueTrials.set(nctId, study);
                    } else if (nctId) {
                      // Update existing trial to note this related drug also matched
                      const existingTrial = uniqueTrials.get(nctId);
                      if (!existingTrial.searchMetadata) {
                        existingTrial.searchMetadata = {};
                      }
                      
                      // Convert single matchedDrug to array if needed
                      if (existingTrial.searchMetadata.matchedDrug && !existingTrial.searchMetadata.matchedDrugs) {
                        existingTrial.searchMetadata.matchedDrugs = [existingTrial.searchMetadata.matchedDrug];
                        delete existingTrial.searchMetadata.matchedDrug;
                      }
                      
                      // Initialize matchedDrugs array if it doesn't exist
                      if (!existingTrial.searchMetadata.matchedDrugs) {
                        existingTrial.searchMetadata.matchedDrugs = [];
                      }
                      
                      // Add the current drug if not already in the array
                      if (!existingTrial.searchMetadata.matchedDrugs.includes(drugName)) {
                        existingTrial.searchMetadata.matchedDrugs.push(drugName);
                      }
                    }
                  });
                  
                  // Add to total trials count for logging
                  totalTrialsFound += relatedDrugResults.studies.length;
                  
                  // Add a small delay between requests to prevent rate limiting
                  await new Promise(resolve => setTimeout(resolve, 300));
                  
                } catch (error) {
                  console.error(`Error searching for related drug "${drugName}":`, error.message);
                  errors.push({ drugName, error: error.message });
                }
              }
            }
          } else {
            console.log(`No related drugs found for "${drug}".`);
          }
        } catch (relatedError) {
          console.error(`Error getting related drugs for "${drug}":`, relatedError.message);
          errors.push({ drug, error: `Failed to get related drugs: ${relatedError.message}` });
        }
      }
      
    } else if (condition) {
      // Condition-only search (no changes needed here)
      console.log(`Performing condition-only search for: ${condition}`);
      
      // Base search params for condition-only search
      const searchParams = {
        condition: condition,
        fields: "protocolSection,derivedSection,hasResults",
        pageSize: 100
      };
      
      // Add optional filters
      if (hasResults !== null) searchParams.hasResults = hasResults;
      if (status) searchParams.status = status;
      
      // Add date filters
      searchParams.advanced = `AREA[StartDate]RANGE[${formattedStartDate},MAX]${
        formattedSinceDate ? ` AND AREA[LastUpdatePostDate]RANGE[${formattedSinceDate},MAX]` : ''
      }`;
      
      // Perform search
      const conditionResults = await fetchAllPagesOfStudies(searchParams, fetchAll);
      
      // Store unique trials
      conditionResults.studies.forEach(study => {
        const nctId = study.protocolSection?.identificationModule?.nctId;
        if (nctId && !uniqueTrials.has(nctId)) {
          // Add metadata about which condition matched
          study.searchMetadata = {
            matchedCondition: condition
          };
          uniqueTrials.set(nctId, study);
        }
      });
      
      totalTrialsFound = conditionResults.studies.length;
      console.log(`Found ${totalTrialsFound} trials for condition "${condition}"`);
    } else {
      throw new Error("At least one of 'drug' or 'condition' must be provided");
    }

    // Convert results map to array for pagination
    const allTrials = Array.from(uniqueTrials.values());
    
    console.log(`Final count: ${allTrials.length} unique trials found across all searches.`);
    
    // If we're fetching all results, return everything
    if (fetchAll) {
      return {
        success: true,
        data: {
          studies: allTrials,
          totalCount: allTrials.length,
          queriedDrugs: drugsToSearch,
          queriedCondition: condition
        },
        pagination: {
          currentPage: 1,
          pageSize: allTrials.length,
          totalCount: allTrials.length,
          totalPages: 1,
          hasNextPage: false
        },
        errors: errors.length > 0 ? errors : undefined
      };
    }
    
    // Otherwise, apply pagination manually
    const totalPages = Math.ceil(allTrials.length / pageSize);
    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const paginatedTrials = allTrials.slice(startIdx, endIdx);
    
    return {
      success: true,
      data: {
        studies: paginatedTrials,
        totalCount: allTrials.length,
        queriedDrugs: drugsToSearch,
        queriedCondition: condition
      },
      pagination: {
        currentPage: page,
        pageSize: pageSize,
        totalCount: allTrials.length,
        totalPages: totalPages,
        hasNextPage: page < totalPages
      },
      errors: errors.length > 0 ? errors : undefined
    };
    
  } catch (error) {
    console.error("Error in fetchClinicalTrials:", error);
    return {
      success: false,
      error: error.message,
      data: { studies: [], totalCount: 0 }
    };
  }
}

/**
 * Update the search trials for name function to use the enhanced clinical trials function
 * 
 * @param {string} drugName - Name of the drug to search for
 * @returns {Promise<Object>} - Trials and error info
 */
async function searchTrialsForName(drugName) {
  try {
    if (!drugName || typeof drugName !== 'string' || drugName.trim() === '') {
      return { trials: [], error: 'Invalid drug name' };
    }
    
    const sanitizedName = drugName.trim();
    
    // Use the enhanced fetchClinicalTrials function
    // Set searchRelated=undefined to enable automatic detection
    const searchResults = await fetchClinicalTrials({
      drug: sanitizedName,
      fetchAll: true,
      searchRelated: undefined // Automatically search related drugs if < 10 trials found
    });
    
    // Format results to match the expected output format
    if (!searchResults.success) {
      return { trials: [], error: searchResults.error };
    }
    
    // Transform studies to the expected format
    const formattedTrials = searchResults.data.studies.map(study => {
      const protocolSection = study.protocolSection || {};
      const identificationModule = protocolSection.identificationModule || {};
      const statusModule = protocolSection.statusModule || {};
      const designModule = protocolSection.designModule || {};
      const sponsorCollaboratorsModule = protocolSection.sponsorCollaboratorsModule || {};
      const armsInterventionsModule = protocolSection.armsInterventionsModule || {};
      const descriptionModule = protocolSection.descriptionModule || {};
      const conditionsModule = protocolSection.conditionsModule || {};
      
      // Get interventions
      const interventions = [];
      if (armsInterventionsModule.interventions && Array.isArray(armsInterventionsModule.interventions)) {
        armsInterventionsModule.interventions.forEach(intervention => {
          interventions.push({
            name: intervention.name,
            type: intervention.type,
            description: intervention.description
          });
        });
      }
      
      // Extract conditions
      const conditions = conditionsModule.conditions || [];
      
      // Extract matched drug info from searchMetadata
      let matchedDrugName = sanitizedName; // Default to the original search drug
      
      if (study.searchMetadata) {
        if (study.searchMetadata.matchedDrug) {
          matchedDrugName = study.searchMetadata.matchedDrug;
        } else if (study.searchMetadata.matchedDrugs && study.searchMetadata.matchedDrugs.length > 0) {
          matchedDrugName = study.searchMetadata.matchedDrugs.join(', ');
        }
      }
      
      return {
        nctId: identificationModule.nctId,
        title: identificationModule.briefTitle || identificationModule.officialTitle || 'No title available',
        status: statusModule.overallStatus || 'UNKNOWN',
        phase: designModule.phases ? designModule.phases.join(', ') : 'Not specified',
        summary: descriptionModule.briefSummary ? 
                 descriptionModule.briefSummary.substring(0, 300) + (descriptionModule.briefSummary.length > 300 ? '...' : '') 
                 : (identificationModule.briefSummary ?
                    identificationModule.briefSummary.substring(0, 300) + (identificationModule.briefSummary.length > 300 ? '...' : '')
                    : 'No summary available'),
        startDate: statusModule.startDate || 'Not specified',
        completionDate: statusModule.completionDate || 'Not specified',
        studyType: designModule.studyType || 'Not specified',
        sponsor: sponsorCollaboratorsModule.leadSponsor ? 
                sponsorCollaboratorsModule.leadSponsor.name || 'Not specified' 
                : 'Not specified',
        enrollment: designModule.enrollmentInfo ? 
                   designModule.enrollmentInfo.count || 'Not specified' 
                   : 'Not specified',
        interventions: interventions,
        url: `https://clinicaltrials.gov/study/${identificationModule.nctId}`,
        conditions: conditions,
        hasResults: study.hasResults,
        matchedDrug: matchedDrugName,
        isRelatedDrug: study.searchMetadata && study.searchMetadata.isRelatedDrug === true
      };
    });
    
    return { trials: formattedTrials, error: null };
  } catch (error) {
    console.error(`Error searching trials for ${drugName}:`, error.message);
    return { trials: [], error: error.message };
  }
}

/**
 * Update the searchAllTrialsForDrugNames function to use the enhanced functionality
 * 
 * @param {string[]} drugNames - Array of drug names to search for
 * @returns {Promise<Object>} - Combined search results
 */
async function searchAllTrialsForDrugNames(drugNames) {
  try {
    if (!Array.isArray(drugNames) || drugNames.length === 0) {
      return {
        trials: [],
        errors: [{ error: 'No valid drug names provided' }],
        totalDrugNames: 0,
        totalUniqueTrials: 0
      };
    }
    
    console.log(`Searching trials for ${drugNames.length} drug names...`);
    
    // Store all unique trials and errors
    const uniqueTrials = new Map();
    const errors = [];
    
    // Process each drug name, potentially with related names for low-result drugs
    for (let i = 0; i < drugNames.length; i++) {
      const drugName = drugNames[i];
      console.log(`Processing drug ${i+1}/${drugNames.length}: ${drugName}`);
      
      try {
        // Use the enhanced fetchClinicalTrials function for each drug
        const searchResults = await fetchClinicalTrials({
          drug: drugName,
          fetchAll: true,
          searchRelated: undefined // Auto-search related drugs if needed
        });
        
        if (searchResults.success && searchResults.data.studies.length > 0) {
          // Track which drug names matched each trial
          searchResults.data.studies.forEach(study => {
            const nctId = study.protocolSection?.identificationModule?.nctId;
            if (nctId) {
              if (!uniqueTrials.has(nctId)) {
                // Add metadata about the drug match if not already present
                if (!study.matchedDrugNames) {
                  study.matchedDrugNames = [];
                }
                if (study.searchMetadata && study.searchMetadata.matchedDrug) {
                  study.matchedDrugNames.push(study.searchMetadata.matchedDrug);
                } else {
                  study.matchedDrugNames.push(drugName);
                }
                uniqueTrials.set(nctId, study);
              } else {
                // Update existing trial to include this drug name match
                const existingTrial = uniqueTrials.get(nctId);
                if (!existingTrial.matchedDrugNames) {
                  existingTrial.matchedDrugNames = [];
                }
                
                // Add the matched drug from metadata or use the original drug name
                const drugToAdd = (study.searchMetadata && study.searchMetadata.matchedDrug) ? 
                                  study.searchMetadata.matchedDrug : drugName;
                                  
                if (!existingTrial.matchedDrugNames.includes(drugToAdd)) {
                  existingTrial.matchedDrugNames.push(drugToAdd);
                }
              }
            }
          });
          
          console.log(`Added ${searchResults.data.studies.length} trials for drug "${drugName}"`);
        } else if (searchResults.error) {
          errors.push({ drugName, error: searchResults.error });
        }
      } catch (error) {
        console.error(`Error searching for drug "${drugName}":`, error.message);
        errors.push({ drugName, error: error.message });
      }
      
      // Add a small delay between processing each drug to prevent rate limiting
      if (i < drugNames.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Get the array of unique trials
    const trialsArray = Array.from(uniqueTrials.values());
    
    console.log(`Search completed. Found ${trialsArray.length} unique trials.`);
    
    // Format the trials to match expected output
    const formattedTrials = trialsArray.map(study => {
      const protocolSection = study.protocolSection || {};
      const identificationModule = protocolSection.identificationModule || {};
      const statusModule = protocolSection.statusModule || {};
      const designModule = protocolSection.designModule || {};
      const sponsorCollaboratorsModule = protocolSection.sponsorCollaboratorsModule || {};
      const armsInterventionsModule = protocolSection.armsInterventionsModule || {};
      const descriptionModule = protocolSection.descriptionModule || {};
      const conditionsModule = protocolSection.conditionsModule || {};
      
      // Get interventions
      const interventions = [];
      if (armsInterventionsModule.interventions && Array.isArray(armsInterventionsModule.interventions)) {
        armsInterventionsModule.interventions.forEach(intervention => {
          interventions.push({
            name: intervention.name,
            type: intervention.type,
            description: intervention.description
          });
        });
      }
      
      // Extract conditions
      const conditions = conditionsModule.conditions || [];
      
      return {
        nctId: identificationModule.nctId,
        title: identificationModule.briefTitle || identificationModule.officialTitle || 'No title available',
        status: statusModule.overallStatus || 'UNKNOWN',
        phase: designModule.phases ? designModule.phases.join(', ') : 'Not specified',
        summary: descriptionModule.briefSummary ? 
                 descriptionModule.briefSummary.substring(0, 300) + (descriptionModule.briefSummary.length > 300 ? '...' : '') 
                 : (identificationModule.briefSummary ?
                    identificationModule.briefSummary.substring(0, 300) + (identificationModule.briefSummary.length > 300 ? '...' : '')
                    : 'No summary available'),
        startDate: statusModule.startDate || 'Not specified',
        completionDate: statusModule.completionDate || 'Not specified',
        studyType: designModule.studyType || 'Not specified',
        sponsor: sponsorCollaboratorsModule.leadSponsor ? 
                sponsorCollaboratorsModule.leadSponsor.name || 'Not specified' 
                : 'Not specified',
        enrollment: designModule.enrollmentInfo ? 
                   designModule.enrollmentInfo.count || 'Not specified' 
                   : 'Not specified',
        interventions: interventions,
        url: `https://clinicaltrials.gov/study/${identificationModule.nctId}`,
        conditions: conditions,
        hasResults: study.hasResults,
        matchedDrugNames: study.matchedDrugNames || []
      };
    });
    
    return {
      trials: formattedTrials,
      errors: errors,
      totalDrugNames: drugNames.length,
      totalUniqueTrials: formattedTrials.length
    };
  } catch (error) {
    console.error("Error in searchAllTrialsForDrugNames:", error);
    return {
      trials: [],
      errors: [{ error: error.message }],
      totalDrugNames: drugNames.length,
      totalUniqueTrials: 0
    };
  }
}



/**
 * General search route that supports searching for any terms including medical devices
 * and allows filtering by patient populations
 */
/**
 * Improved general search route that supports exact phrase matching for medical devices
 */
/**
 * General search route that uses proper ClinicalTrials.gov API v2 parameters
 */
app.get('/api/studies/general-search', validatePagination, async (req, res) => {
  try {
    // Parse query parameters using proper naming - critical for the v2 API
    const {
      'query.term': searchTerm,       // Using the correct parameter name for search term
      'query.patient': patientPopulation,  // Using the correct parameter name for patient population
      exactMatch = 'true',            // Default to exact match
      'filter.overallStatus': status,
      aggFilters: hasResults,
      'filter.advanced': advancedFilter,
      pageToken,
    } = req.query;
    
    const { page, pageSize } = req.pagination;
    
    console.log(`🔍 General search request using v2 API for term: "${searchTerm}", population: "${patientPopulation}"`);
    
    // Define the API base URL for v2
    const CLINICAL_TRIALS_API_BASE = 'https://clinicaltrials.gov/api/v2';
    
    // Create query parameters following the v2 API format
    // This is critical - we pass through the properly named parameters directly
    const queryParams = {
      format: 'json',
      pageSize: pageSize || 100,
      countTotal: true,
      fields: "protocolSection,derivedSection,hasResults"
    };
    
    // Pass through the search term as-is with proper parameter name
    if (searchTerm) {
      queryParams['query.term'] = searchTerm;
    }
    
    // Pass through the patient population as-is with proper parameter name
    if (patientPopulation) {
      queryParams['query.patient'] = patientPopulation;
    }
    
    // Pass through the status filter if provided
    if (status) {
      queryParams['filter.overallStatus'] = status;
    }
    
    // Pass through the advanced filter if provided
    if (advancedFilter) {
      queryParams['filter.advanced'] = advancedFilter;
    }
    
    // Pass through hasResults filter if provided
    if (hasResults) {
      queryParams.aggFilters = hasResults;
    }
    
    // Pass through pageToken if provided for pagination
    if (pageToken) {
      queryParams.pageToken = pageToken;
    }
    
    console.log(`Fetching from ClinicalTrials.gov API with params:`, queryParams);
    
    // Make the API request to ClinicalTrials.gov
    const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
      params: queryParams,
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
    
    // Send the response directly back to the client
    // This simplifies things by not adding extra filtering which can break the search
    res.json(response.data);
    
  } catch (error) {
    console.error("General search API error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Also update the API handler to use the enhanced functionality
/**
 * API handler for the /api/studies/search endpoint
 * Provides backward compatibility with existing code
 */
app.get('/api/studies/search', validatePagination, async (req, res) => {
  try {
    const {
      query, condition, intervention, status, phase, sponsor,
      title, location, patientData, sort, countTotal, fields,
      advanced, fetchAll, searchRelated, yearsBack, sinceDate
    } = req.query;
    
    const { page, pageSize } = req.pagination;
    
    console.log(`🔍 Search request received with params:`, req.query);
    
    // Use the enhanced fetchClinicalTrials function with translated parameters
    const searchResults = await fetchClinicalTrials({
      drug: intervention,
      condition: condition,
      hasResults: req.query.hasResults === 'true',
      yearsBack: yearsBack ? parseInt(yearsBack, 10) : 5,
      sinceDate: sinceDate || null,
      searchRelated: searchRelated === 'true' ? true : 
                    searchRelated === 'false' ? false : undefined, // Undefined enables auto-detection
      page: page,
      pageSize: pageSize,
      fetchAll: fetchAll === 'true',
      status: status
    });
    
    // Return response in the expected format
    res.json(searchResults);
    
  } catch (error) {
    console.error("API search error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Helper function to fetch all pages of studies for a given search
 * 
 * @param {Object} searchParams - Parameters for the API call
 * @param {boolean} fetchAll - Whether to fetch all pages
 * @returns {Promise<Object>} - All studies and pagination info
 */
/**
 * Helper function to fetch all pages of studies for a given search
 * 
 * @param {Object} searchParams - Parameters for the API call
 * @param {boolean} fetchAll - Whether to fetch all pages
 * @returns {Promise<Object>} - All studies and pagination info
 */
async function fetchAllPagesOfStudies(searchParams, fetchAll = false) {
  const allStudies = [];
  let nextPageToken = null;
  let hasMorePages = true;
  let pageNumber = 1;
  
  // Define the API base URL
  const CLINICAL_TRIALS_API_BASE = 'https://clinicaltrials.gov/api/v2';
  
  while (hasMorePages) {
    // Create a new params object for the updated API
    const queryParams = {
      format: 'json',
      pageSize: searchParams.pageSize || 100,
      countTotal: true,
      fields: searchParams.fields || 'protocolSection,derivedSection,hasResults'
    };
    
    // Add pagination token if not on the first page
    if (nextPageToken) {
      queryParams.pageToken = nextPageToken;
    }
    
    // Convert the advanced search parameter to the new format
    if (searchParams.advanced) {
      queryParams['filter.advanced'] = searchParams.advanced;
    }
    
    // Convert other search parameters to the new format
    if (searchParams.intervention) {
      queryParams['query.intr'] = searchParams.intervention;
    }
    
    if (searchParams.condition) {
      queryParams['query.cond'] = searchParams.condition;
    }
    
    // Handle has results filter
    if (searchParams.hasResults !== null && searchParams.hasResults !== undefined) {
      // Directly map this to a filter parameter in the new API
      queryParams['aggFilters'] = searchParams.hasResults ? 'results:with' : '';
    }
    
    // Handle status filter if provided
    if (searchParams.status) {
      if (Array.isArray(searchParams.status)) {
        queryParams['filter.overallStatus'] = searchParams.status.join(',');
      } else {
        queryParams['filter.overallStatus'] = searchParams.status;
      }
    }
    
    console.log(`Fetching page ${pageNumber} with params:`, queryParams);
    
    try {
      const response = await axios.get(`${CLINICAL_TRIALS_API_BASE}/studies`, {
        params: queryParams,
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        }
      });
      
      // Extract studies from the response
      const studies = response.data.studies || [];
      console.log(`Received ${studies.length} studies on page ${pageNumber}`);
      
      // Add studies to our collection
      allStudies.push(...studies);
      
      // Get next page token
      nextPageToken = response.data.nextPageToken;
      
      // Determine if we should continue
      hasMorePages = !!nextPageToken && (fetchAll || pageNumber < (searchParams.maxPages ? parseInt(searchParams.maxPages, 10) : 10));
      
      // Increment page counter
      pageNumber++;
      
      // Add a small delay between requests to prevent rate limiting
      if (hasMorePages) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
    } catch (error) {
      console.error(`Error fetching page ${pageNumber}:`, error.message);
      if (error.response) {
        console.error(`Response status: ${error.response.status}`);
        console.error(`Response data:`, error.response.data);
      }
      // Break the loop on error
      hasMorePages = false;
    }
  }
  
  return { 
    studies: allStudies, 
    totalPages: pageNumber - 1 
  };
}
/**
 * API handler for the /api/studies/search endpoint
 * Provides backward compatibility with existing code
 */
// app.get('/api/studies/search', validatePagination, async (req, res) => {
//   try {
//     const {
//       query, condition, intervention, status, phase, sponsor,
//       title, location, patientData, sort, countTotal, fields,
//       advanced, fetchAll, searchRelated, yearsBack, sinceDate
//     } = req.query;
    
//     const { page, pageSize } = req.pagination;
    
//     console.log(`🔍 Search request received with params:`, req.query);
    
//     // Use the new fetchClinicalTrials function with translated parameters
//     const searchResults = await fetchClinicalTrials({
//       drug: intervention,
//       condition: condition,
//       hasResults: req.query.hasResults === 'true',
//       yearsBack: yearsBack ? parseInt(yearsBack, 10) : 5,
//       sinceDate: sinceDate || null,
//       searchRelated: searchRelated === 'true',
//       page: page,
//       pageSize: pageSize,
//       fetchAll: fetchAll === 'true',
//       status: status
//     });
    
//     // Return response in the expected format
//     res.json(searchResults);
    
//   } catch (error) {
//     console.error("API search error:", error);
//     res.status(500).json({
//       success: false,
//       error: error.message
//     });
//   }
// });

// /**
//  * Function to search clinical trials for a specific drug
//  * Maintained for backward compatibility
//  * 
//  * @param {string} drugName - Name of the drug to search for
//  * @returns {Promise<Object>} - Trials and error info
//  */
// async function searchTrialsForName(drugName) {
//   try {
//     if (!drugName || typeof drugName !== 'string' || drugName.trim() === '') {
//       return { trials: [], error: 'Invalid drug name' };
//     }
    
//     const sanitizedName = drugName.trim();
    
//     // Use the new fetchClinicalTrials function
//     const searchResults = await fetchClinicalTrials({
//       drug: sanitizedName,
//       fetchAll: true
//     });
    
//     // Format results to match the expected output format
//     if (!searchResults.success) {
//       return { trials: [], error: searchResults.error };
//     }
    
//     // Transform studies to the expected format
//     const formattedTrials = searchResults.data.studies.map(study => {
//       const protocolSection = study.protocolSection || {};
//       const identificationModule = protocolSection.identificationModule || {};
//       const statusModule = protocolSection.statusModule || {};
//       const designModule = protocolSection.designModule || {};
//       const sponsorCollaboratorsModule = protocolSection.sponsorCollaboratorsModule || {};
//       const armsInterventionsModule = protocolSection.armsInterventionsModule || {};
//       const descriptionModule = protocolSection.descriptionModule || {};
//       const conditionsModule = protocolSection.conditionsModule || {};
      
//       // Get interventions
//       const interventions = [];
//       if (armsInterventionsModule.interventions && Array.isArray(armsInterventionsModule.interventions)) {
//         armsInterventionsModule.interventions.forEach(intervention => {
//           interventions.push({
//             name: intervention.name,
//             type: intervention.type,
//             description: intervention.description
//           });
//         });
//       }
      
//       // Extract conditions
//       const conditions = conditionsModule.conditions || [];
      
//       return {
//         nctId: identificationModule.nctId,
//         title: identificationModule.briefTitle || identificationModule.officialTitle || 'No title available',
//         status: statusModule.overallStatus || 'UNKNOWN',
//         phase: designModule.phases ? designModule.phases.join(', ') : 'Not specified',
//         summary: descriptionModule.briefSummary ? 
//                  descriptionModule.briefSummary.substring(0, 300) + (descriptionModule.briefSummary.length > 300 ? '...' : '') 
//                  : (identificationModule.briefSummary ?
//                     identificationModule.briefSummary.substring(0, 300) + (identificationModule.briefSummary.length > 300 ? '...' : '')
//                     : 'No summary available'),
//         startDate: statusModule.startDate || 'Not specified',
//         completionDate: statusModule.completionDate || 'Not specified',
//         studyType: designModule.studyType || 'Not specified',
//         sponsor: sponsorCollaboratorsModule.leadSponsor ? 
//                 sponsorCollaboratorsModule.leadSponsor.name || 'Not specified' 
//                 : 'Not specified',
//         enrollment: designModule.enrollmentInfo ? 
//                    designModule.enrollmentInfo.count || 'Not specified' 
//                    : 'Not specified',
//         interventions: interventions,
//         url: `https://clinicaltrials.gov/study/${identificationModule.nctId}`,
//         conditions: conditions,
//         hasResults: study.hasResults
//       };
//     });
    
//     return { trials: formattedTrials, error: null };
//   } catch (error) {
//     console.error(`Error searching trials for ${drugName}:`, error.message);
//     return { trials: [], error: error.message };
//   }
// }

// /**
//  * Function to search for trials for multiple drug names
//  * Maintained for backward compatibility
//  * 
//  * @param {string[]} drugNames - Array of drug names to search for
//  * @returns {Promise<Object>} - Combined search results
//  */
// async function searchAllTrialsForDrugNames(drugNames) {
//   try {
//     if (!Array.isArray(drugNames) || drugNames.length === 0) {
//       return {
//         trials: [],
//         errors: [{ error: 'No valid drug names provided' }],
//         totalDrugNames: 0,
//         totalUniqueTrials: 0
//       };
//     }
    
//     console.log(`Searching trials for ${drugNames.length} drug names...`);
    
//     // Use the new fetchClinicalTrials function
//     const searchResults = await fetchClinicalTrials({
//       drug: drugNames[0], // Use first drug as primary
//       searchRelated: false, // Don't auto-search related
//       fetchAll: true
//     });
    
//     // Store all unique trials and errors
//     const uniqueTrials = new Map();
//     const errors = [];
    
//     // Process initial search results
//     if (searchResults.success) {
//       searchResults.data.studies.forEach(study => {
//         const nctId = study.protocolSection?.identificationModule?.nctId;
//         if (nctId) {
//           // Add metadata about the drug match
//           if (!study.matchedDrugNames) {
//             study.matchedDrugNames = [drugNames[0]];
//           }
//           uniqueTrials.set(nctId, study);
//         }
//       });
//     } else if (searchResults.error) {
//       errors.push({ drugName: drugNames[0], error: searchResults.error });
//     }
    
//     // If more than one drug name, process the rest
//     if (drugNames.length > 1) {
//       // Process drugs in batches to avoid overwhelming the API
//       const batchSize = 5;
//       for (let i = 1; i < drugNames.length; i += batchSize) {
//         const batch = drugNames.slice(i, i + batchSize);
//         console.log(`Processing batch of ${batch.length} additional drugs`);
        
//         // Sequential processing to be gentler on the API
//         for (const drugName of batch) {
//           try {
//             const drugResults = await fetchClinicalTrials({
//               drug: drugName,
//               fetchAll: true
//             });
            
//             if (drugResults.success) {
//               drugResults.data.studies.forEach(study => {
//                 const nctId = study.protocolSection?.identificationModule?.nctId;
//                 if (nctId && !uniqueTrials.has(nctId)) {
//                   // Add metadata about which drug name matched this trial
//                   if (!study.matchedDrugNames) {
//                     study.matchedDrugNames = [];
//                   }
//                   study.matchedDrugNames.push(drugName);
//                   uniqueTrials.set(nctId, study);
//                 } else if (nctId) {
//                   // Update the existing trial to include this drug name match
//                   const existingTrial = uniqueTrials.get(nctId);
//                   if (!existingTrial.matchedDrugNames) {
//                     existingTrial.matchedDrugNames = [];
//                   }
//                   if (!existingTrial.matchedDrugNames.includes(drugName)) {
//                     existingTrial.matchedDrugNames.push(drugName);
//                   }
//                 }
//               });
//             } else if (drugResults.error) {
//               errors.push({ drugName, error: drugResults.error });
//             }
            
//             // Add a small delay between requests
//             await new Promise(resolve => setTimeout(resolve, 300));
            
//           } catch (error) {
//             console.error(`Error searching for drug "${drugName}":`, error.message);
//             errors.push({ drugName, error: error.message });
//           }
//         }
//       }
//     }
    
//     // Get the array of unique trials
//     const trialsArray = Array.from(uniqueTrials.values());
    
//     console.log(`Search completed. Found ${trialsArray.length} unique trials.`);
    
//     // Format the trials to match expected output
//     const formattedTrials = trialsArray.map(study => {
//       const protocolSection = study.protocolSection || {};
//       const identificationModule = protocolSection.identificationModule || {};
//       const statusModule = protocolSection.statusModule || {};
//       const designModule = protocolSection.designModule || {};
//       const sponsorCollaboratorsModule = protocolSection.sponsorCollaboratorsModule || {};
//       const armsInterventionsModule = protocolSection.armsInterventionsModule || {};
//       const descriptionModule = protocolSection.descriptionModule || {};
//       const conditionsModule = protocolSection.conditionsModule || {};
      
//       // Get interventions
//       const interventions = [];
//       if (armsInterventionsModule.interventions && Array.isArray(armsInterventionsModule.interventions)) {
//         armsInterventionsModule.interventions.forEach(intervention => {
//           interventions.push({
//             name: intervention.name,
//             type: intervention.type,
//             description: intervention.description
//           });
//         });
//       }
      
//       // Extract conditions
//       const conditions = conditionsModule.conditions || [];
      
//       return {
//         nctId: identificationModule.nctId,
//         title: identificationModule.briefTitle || identificationModule.officialTitle || 'No title available',
//         status: statusModule.overallStatus || 'UNKNOWN',
//         phase: designModule.phases ? designModule.phases.join(', ') : 'Not specified',
//         summary: descriptionModule.briefSummary ? 
//                  descriptionModule.briefSummary.substring(0, 300) + (descriptionModule.briefSummary.length > 300 ? '...' : '') 
//                  : (identificationModule.briefSummary ?
//                     identificationModule.briefSummary.substring(0, 300) + (identificationModule.briefSummary.length > 300 ? '...' : '')
//                     : 'No summary available'),
//         startDate: statusModule.startDate || 'Not specified',
//         completionDate: statusModule.completionDate || 'Not specified',
//         studyType: designModule.studyType || 'Not specified',
//         sponsor: sponsorCollaboratorsModule.leadSponsor ? 
//                 sponsorCollaboratorsModule.leadSponsor.name || 'Not specified' 
//                 : 'Not specified',
//         enrollment: designModule.enrollmentInfo ? 
//                    designModule.enrollmentInfo.count || 'Not specified' 
//                    : 'Not specified',
//         interventions: interventions,
//         url: `https://clinicaltrials.gov/study/${identificationModule.nctId}`,
//         conditions: conditions,
//         hasResults: study.hasResults,
//         matchedDrugNames: study.matchedDrugNames || []
//       };
//     });
    
//     return {
//       trials: formattedTrials,
//       errors: errors,
//       totalDrugNames: drugNames.length,
//       totalUniqueTrials: formattedTrials.length
//     };
//   } catch (error) {
//     console.error("Error in searchAllTrialsForDrugNames:", error);
//     return {
//       trials: [],
//       errors: [{ error: error.message }],
//       totalDrugNames: drugNames.length,
//       totalUniqueTrials: 0
//     };
//   }
// }
/**
 * Function to get related drugs for a given drug name using multiple pharmaceutical databases
 * @param {string} drugName - The name of the drug to find related drugs for
 * @returns {Promise<string[]>} - Array of related drug names
 */
async function getRelatedDrugs(drugName) {
  try {
    console.log(`Getting related drugs for: ${drugName}`);
    
    // Object to store all results from various drug databases
    const results = {
      originalQuery: drugName,
      sources: {
        rxnorm: { names: [], links: [] },
        fda: { names: [], links: [] },
        pubchem: { names: [], links: [] }
      }
    };

    // Execute searches individually to prevent a failure in one from stopping the others
    try {
      await searchRxNorm(drugName, results);
      console.log(`RxNorm search completed with ${results.sources.rxnorm.names.length} names`);
    } catch (rxError) {
      console.error('RxNorm search failed:', rxError.message);
      results.sources.rxnorm.names.push({
        name: "Error searching RxNorm database",
        type: "Error"
      });
    }
    
    try {
      await searchFDA(drugName, results);
      console.log(`FDA search completed with ${results.sources.fda.names.length} names`);
    } catch (fdaError) {
      console.error('FDA search failed:', fdaError.message);
      results.sources.fda.names.push({
        name: "Error searching FDA database",
        type: "Error"
      });
    }
    
    try {
      await searchPubChem(drugName, results);
      console.log(`PubChem search completed with ${results.sources.pubchem.names.length} names`);
    } catch (pubchemError) {
      console.error('PubChem search failed:', pubchemError.message);
      results.sources.pubchem.names.push({
        name: "Error searching PubChem database",
        type: "Error"
      });
    }
    
    // Extract all the unique drug names from the search results
    const allNames = new Set();
    
    for (const [sourceName, sourceData] of Object.entries(results.sources)) {
      if (sourceData.names && sourceData.names.length > 0) {
        for (const nameObj of sourceData.names) {
          // Skip error and info messages
          if (nameObj.type === 'Error' || nameObj.type === 'Info' || 
              !nameObj.name || typeof nameObj.name !== 'string') {
            continue;
          }
          
          // Skip very short names (likely not useful for searches)
          if (nameObj.name.trim().length < 3) {
            continue;
          }
          
          // Add to the unique set
          allNames.add(nameObj.name);
        }
      }
    }
    
    // Convert the Set to Array and remove the original drug name
    let relatedDrugs = Array.from(allNames).filter(name => 
      name.toLowerCase() !== drugName.toLowerCase()
    );
    
    // // Filter out problematic drug names that are likely to cause errors
    // relatedDrugs = relatedDrugs.filter(name => {
    //   // Skip chemical structure identifiers, too complex for search
    //   if (name.includes('-') && /\d/.test(name) && name.length > 10) {
    //     return false;
    //   }
      
    //   // Skip CAS registry numbers and similar identifiers
    //   if (/^\d+-\d+-\d+$/.test(name)) {
    //     return false;
    //   }
      
    //   // Skip SMILES strings or other complex chemical notations
    //   if (name.includes('(') && name.includes(')') && name.length > 30) {
    //     return false;
    //   }
      
    //   // Skip chemical formula-like strings with numbers and brackets
    //   if (/^[A-Z0-9\(\)\[\]\{\}]+$/.test(name) && /\d/.test(name)) {
    //     return false;
    //   }
      
    //   // Skip database IDs
    //   if (/^[A-Z]+\d+$/.test(name) || /^[A-Z]+-\d+$/.test(name)) {
    //     return false;
    //   }
      
    //   // Skip long, complex names that are likely full IUPAC names
    //   if (name.length > 50) {
    //     return false;
    //   }
      
    //   // Skip names with unusual characters that might break URLs
    //   if (/[^\w\s\-\(\)]/i.test(name)) {
    //     return false;
    //   }
      
    //   return true;
    // });
    
    // Prioritize shorter, simpler names (more likely to be common names)
    relatedDrugs.sort((a, b) => a.length - b.length);
    
    // Limit to a reasonable number of drug names to prevent overwhelming the API
    const maxDrugs = 10;
    if (relatedDrugs.length > maxDrugs) {
      console.log(`Limiting from ${relatedDrugs.length} to ${maxDrugs} related drugs to prevent API overload`);
      relatedDrugs = relatedDrugs.slice(0, maxDrugs);
    }
    
    console.log(`Found ${relatedDrugs.length} related drugs for ${drugName}: ${relatedDrugs.join(', ')}`);
    
    return relatedDrugs;
  } catch (error) {
    console.error(`Error in main getRelatedDrugs function for ${drugName}:`, error);
    // Return empty array in case of error to continue with at least the original drug
    return [];
  }
}

// RxNorm API functions
async function searchRxNorm(drugName, results) {
  try {
    // Step 1: Get RxCUI for the drug
    const rxcuiResponse = await axios.get(`https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(drugName)}&search=1`);
    
    if (rxcuiResponse.data && rxcuiResponse.data.idGroup && rxcuiResponse.data.idGroup.rxnormId) {
      const rxcui = rxcuiResponse.data.idGroup.rxnormId[0];
      
      // Add the standard name to results
      if (rxcuiResponse.data.idGroup.name) {
        results.sources.rxnorm.names.push({
          name: rxcuiResponse.data.idGroup.name,
          type: 'Standard Name'
        });
      }
      
      // Step 2: Get related names
      const relatedResponse = await axios.get(`https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/allrelated.json`);
      
      if (relatedResponse.data && relatedResponse.data.allRelatedGroup && relatedResponse.data.allRelatedGroup.conceptGroup) {
        for (const group of relatedResponse.data.allRelatedGroup.conceptGroup) {
          if (group.conceptProperties) {
            for (const property of group.conceptProperties) {
              results.sources.rxnorm.names.push({
                name: property.name,
                type: group.tty || 'Related Term',
                id: property.rxcui
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error searching RxNorm:', error.message);
    results.sources.rxnorm.names.push({
      name: "Error searching RxNorm database",
      type: "Error"
    });
  }
}

// FDA API function
async function searchFDA(drugName, results) {
  try {
    // Search by generic name
    const fdaGenericResponse = await axios.get(`https://api.fda.gov/drug/label.json?search=openfda.generic_name:${encodeURIComponent(drugName)}&limit=5`);
    
    if (fdaGenericResponse.data && fdaGenericResponse.data.results) {
      processFDAResults(fdaGenericResponse.data.results, results);
    }
    
    // Search by brand name
    const fdaBrandResponse = await axios.get(`https://api.fda.gov/drug/label.json?search=openfda.brand_name:${encodeURIComponent(drugName)}&limit=5`);
    
    if (fdaBrandResponse.data && fdaBrandResponse.data.results) {
      processFDAResults(fdaBrandResponse.data.results, results);
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      // No results found is a normal condition
      results.sources.fda.names.push({
        name: "No FDA records found",
        type: "Info"
      });
    } else {
      console.error('Error searching FDA:', error.message);
      results.sources.fda.names.push({
        name: "Error searching FDA database",
        type: "Error"
      });
    }
  }
}

function processFDAResults(fdaResults, results) {
  for (const drug of fdaResults) {
    if (drug.openfda) {
      // Add generic names
      if (drug.openfda.generic_name) {
        for (const name of drug.openfda.generic_name) {
          results.sources.fda.names.push({
            name: name,
            type: 'Generic Name'
          });
        }
      }
      
      // Add brand names
      if (drug.openfda.brand_name) {
        for (const name of drug.openfda.brand_name) {
          results.sources.fda.names.push({
            name: name,
            type: 'Brand Name'
          });
        }
      }
      
      // Add substance names
      if (drug.openfda.substance_name) {
        for (const name of drug.openfda.substance_name) {
          results.sources.fda.names.push({
            name: name,
            type: 'Substance Name'
          });
        }
      }
    }
  }
}

// PubChem API function
async function searchPubChem(drugName, results) {
  try {
    // Step 1: Find the compound ID
    const pubchemResponse = await axios.get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(drugName)}/cids/JSON`);
    
    if (pubchemResponse.data && pubchemResponse.data.IdentifierList && pubchemResponse.data.IdentifierList.CID) {
      const cid = pubchemResponse.data.IdentifierList.CID[0];
      
      // Step 2: Get synonyms
      const synonymsResponse = await axios.get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/synonyms/JSON`);
      
      if (synonymsResponse.data && synonymsResponse.data.InformationList && synonymsResponse.data.InformationList.Information) {
        const info = synonymsResponse.data.InformationList.Information[0];
        
        if (info.Synonym) {
          // Filter out long and messy names
          const filteredSynonyms = info.Synonym.filter(syn => 
            syn.length < 100 && !syn.includes('UNII') && !syn.includes('CHEBI') && !syn.includes('DTXSID')
          );
          
          // Take just the first 30 synonyms to avoid overwhelming
          const trimmedSynonyms = filteredSynonyms.slice(0, 30);
          
          for (const synonym of trimmedSynonyms) {
            results.sources.pubchem.names.push({
              name: synonym,
              type: 'Synonym'
            });
          }
        }
      }
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      results.sources.pubchem.names.push({
        name: "No PubChem records found",
        type: "Info"
      });
    } else {
      console.error('Error searching PubChem:', error.message);
      results.sources.pubchem.names.push({
        name: "Error searching PubChem database",
        type: "Error"
      });
    }
  }
}

// ChEMBL functions removed as requested
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
    // console.log(response)
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
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

  initializeUsersFile((err) => {
      if (err) {
          console.error('Failed to initialize users file:', err);
          return;
      }
  });
  // searchDrugsForConditionfromdrug("hypertension")
  // getRelatedDrugs('Liafensine')
});

// Export for testing
module.exports = app;