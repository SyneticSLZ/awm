// server.js - Updated for ClinicalTrials.gov API v2
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const DataIntegration = require('./data-integration');
const cheerio = require('cheerio');
const https = require('https');
const fsextra = require('fs-extra');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const sharp = require('sharp');
const { fromPath } = require('pdf2pic');

const { OpenAI } = require('openai');

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
const GROK_API_KEY = 'q2dqVZZgIN7RcBlnGlja2KS52sXSxeEKJxGM7K5Q29s0h3nX5JDXdIjr6rx4PpYshPti6iZAQYxs32J4';
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';

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


// Function to fetch the HTML content from the URL
async function fetchHtml(url) {
  try {
    const response = await axios.get(url, { 
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching URL: ${error.message}`);
    return null;
  }
}

// Function to extract PDF links from the HTML content
function extractPdfLinks(html) {
  const $ = cheerio.load(html);
  const links = [];
  
  $('a').each((index, element) => {
    const href = $(element).attr('href');
    const text = $(element).text().trim();
    
    if (href && (
      href.includes('.pdf') || 
      href.includes('drugsatfda_docs') ||
      text.includes('PDF') ||
      text.includes('Review') ||
      text.includes('Label') ||
      text.includes('Letter')
    )) {
      let fullUrl = href;
      if (href.startsWith('/')) {
        fullUrl = `https://www.accessdata.fda.gov${href}`;
      } else if (!href.startsWith('http')) {
        fullUrl = `https://www.accessdata.fda.gov/${href}`;
      }
      
      links.push({
        name: text || 'No description',
        url: fullUrl,
        type: determineType(text, href)
      });
    }
  });
  
  return links;
}

// Function to determine the type of link
function determineType(text, href) {
  text = text.toLowerCase();
  href = href.toLowerCase();
  
  if (text.includes('review') || href.includes('review')) {
    return 'Review';
  } else if (text.includes('label') || href.includes('label') || href.includes('lbl')) {
    return 'Label';
  } else if (text.includes('letter') || href.includes('letter') || href.includes('ltr')) {
    return 'Letter';
  } else {
    return 'Other';
  }
}

// API endpoint
app.get('/api/fda-pdfs/:appNo', async (req, res) => {
  try {
    const appNoInput = req.params.appNo;
    // Strip "NDA" prefix if present
    const appNo = appNoInput.startsWith('NDA') ? appNoInput.substring(3) : appNoInput;
    const url = `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appNo}`;
    console.log(url)
    // Fetch HTML content
    const html = await fetchHtml(url);
    if (!html) {
      return res.status(500).json({
        error: 'Failed to fetch HTML content'
      });
    }
    
    // Extract PDF links
    const pdfLinks = extractPdfLinks(html);
    
    if (pdfLinks.length === 0) {
      return res.status(404).json({
        message: 'No PDF links found',
        total: 0,
        results: []
      });
    }
    
    // Return JSON response with PDF names and links
    res.json({
      message: 'PDF links retrieved successfully',
      total: pdfLinks.length,
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


app.get('/api/fda/drug/:drugName', async (req, res) => {
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


app.get('/api/fda/dailymed/:ingredient', async (req, res) => {
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
    exclusivity: []
  };
  
  // Step 1: Search Products first
  results.products = orangeBookData.products.filter(product =>
    Object.values(product).some(val =>
      String(val).toLowerCase().includes(searchTerm)
    )
  );
  
  // Step 2: Create a map of Application Number and Product Number combinations
  const appProductMap = new Set();
  
  // Add all found products to the map
  results.products.forEach(product => {
    if (product.Appl_No && product.Product_No) {
      appProductMap.add(`${product.Appl_Type}-${product.Appl_No}-${product.Product_No}`);
    }
  });
  
  // Step 3: Find related patents
  results.patents = orangeBookData.patents.filter(patent => {
    // First check if the patent data directly matches the search term
    const directMatch = Object.values(patent).some(val =>
      String(val).toLowerCase().includes(searchTerm)
    );
    
    // Then check if this patent is related to any of our found products
    const relatedMatch = appProductMap.has(`${patent.Appl_Type}-${patent.Appl_No}-${patent.Product_No}`);
    
    return directMatch || relatedMatch;
  });
  
  // Step 4: Find related exclusivity data
  results.exclusivity = orangeBookData.exclusivity.filter(exclusivity => {
    // First check if the exclusivity data directly matches the search term
    const directMatch = Object.values(exclusivity).some(val =>
      String(val).toLowerCase().includes(searchTerm)
    );
    
    // Then check if this exclusivity is related to any of our found products
    const relatedMatch = appProductMap.has(`${exclusivity.Appl_Type}-${exclusivity.Appl_No}-${exclusivity.Product_No}`);
    
    return directMatch || relatedMatch;
  });
  
  // Step 5: Enrich products with their related patent and exclusivity information
  const enrichedProducts = results.products.map(product => {
    const productKey = `${product.Appl_Type}-${product.Appl_No}-${product.Product_No}`;
    
    // Find related patents for this product
    const relatedPatents = results.patents.filter(patent => 
      `${patent.Appl_Type}-${patent.Appl_No}-${patent.Product_No}` === productKey
    );
    
    // Find related exclusivity data for this product
    const relatedExclusivity = results.exclusivity.filter(exclusivity => 
      `${exclusivity.Appl_Type}-${exclusivity.Appl_No}-${exclusivity.Product_No}` === productKey
    );
    
    return {
      ...product,
      related_patents: relatedPatents,
      related_exclusivity: relatedExclusivity
    };
  });
  console.log(results)
  // Respond with the enrichsed data
  res.json({
    results: {
      products: enrichedProducts.slice(0, 50), // Limit results for performance but include related data
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
app.get('/api/dailymed/:drugName', async (req, res) => {
  try {
    const { drugName } = req.params;
    console.log(`🔍 Fetching DailyMed info for: ${drugName}`);
    
    const labelInfo = await DailyMed.getLabelInfo(drugName);
    
    res.json({
      success: true,
      data: labelInfo
    });
  } catch (error) {
    handleApiError(error, res);
  }
});

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

/**
 * Endpoint to get PubMed publications
 */
app.get('/api/pubmed/:drugName', async (req, res) => {
  try {
    const { drugName } = req.params;
    console.log(`🔍 Fetching PubMed publications for: ${drugName}`);
    
    const publications = await PubMed.searchPublications(drugName);
    
    res.json({
      success: true,
      data: publications
    });
  } catch (error) {
    handleApiError(error, res);
  }
});

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
app.get('/api/studies/search', validatePagination, async (req, res) => {
  try {
    const { 
      query, condition, intervention, status, phase, sponsor, 
      title, location, patientData, sort, countTotal, fields,
      advanced
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
    
    // Make the API request
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