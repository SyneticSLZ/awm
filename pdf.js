require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Your OpenAI Assistant ID
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

// API route to generate visualization
app.post('/api/generate-visualization', async (req, res) => {
  try {
    const { trialData } = req.body;
    
    if (!trialData) {
      return res.status(400).json({ error: 'Trial data is required' });
    }
    
    // Create a thread
    const thread = await openai.beta.threads.create();
    
    // Add a message to the thread
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `Generate a visualization dashboard for this clinical trial data using vanilla HTML, JavaScript, and Tailwind CSS. The code should be suitable for direct insertion into a div via innerHTML. Here's the trial data:\n\n${JSON.stringify(trialData, null, 2)}`
    });
    
    // Run the assistant
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: ASSISTANT_ID,
    });
    
    // Poll for completion
    const completedRun = await pollRunStatus(thread.id, run.id);
    
    if (completedRun.status !== 'completed') {
      return res.status(500).json({ 
        error: 'Assistant run failed', 
        status: completedRun.status 
      });
    }
    
    // Get the assistant's response
    const messages = await openai.beta.threads.messages.list(thread.id);
    const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');
    
    if (assistantMessages.length === 0) {
      return res.status(500).json({ error: 'No response from assistant' });
    }
    
    const latestMessage = assistantMessages[0];
    
    // Parse the content to extract HTML and JavaScript
    let html = '';
    let javascript = '';
    
    for (const content of latestMessage.content) {
      if (content.type === 'text') {
        const text = content.text.value;
        
        // Extract HTML code blocks
        const htmlMatches = text.match(/```html\n([\s\S]*?)\n```/g);
        if (htmlMatches) {
          html = htmlMatches.map(match => match.replace(/```html\n/, '').replace(/\n```/, '')).join('\n');
        }
        
        // Extract JavaScript code blocks
        const jsMatches = text.match(/```javascript\n([\s\S]*?)\n```/g);
        if (jsMatches) {
          javascript = jsMatches.map(match => match.replace(/```javascript\n/, '').replace(/\n```/, '')).join('\n');
        }
      }
    }
    
    res.json({ html, javascript });
  } catch (error) {
    console.error('Error generating visualization:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to poll run status
async function pollRunStatus(threadId, runId, maxAttempts = 60) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const run = await openai.beta.threads.runs.retrieve(threadId, runId);
    
    if (['completed', 'failed', 'cancelled', 'expired'].includes(run.status)) {
      return run;
    }
    
    // Wait for 1 second before checking again
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  throw new Error('Timed out waiting for run to complete');
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
// const fs = require('fs');
// const path = require('path');
// const axios = require('axios');
// const cheerio = require('cheerio');
// const https = require('https');

// // Create an HTTPS agent with relaxed SSL options for potential SSL issues
// const httpsAgent = new https.Agent({
//   rejectUnauthorized: false
// });

// // Function to fetch the HTML content from the URL
// async function fetchHtml(url) {
//   try {
//     console.log(`Fetching content from: ${url}`);
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

// // Function to extract all PDF links from the HTML content
// function extractPdfLinks(html) {
//   const $ = cheerio.load(html);
//   const links = [];
  
//   // Extract links from all tables that might contain PDF references
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
//       // Ensure the link is absolute
//       let fullUrl = href;
//       if (href.startsWith('/')) {
//         fullUrl = `https://www.accessdata.fda.gov${href}`;
//       } else if (!href.startsWith('http')) {
//         fullUrl = `https://www.accessdata.fda.gov/${href}`;
//       }
      
//       links.push({
//         url: fullUrl,
//         text: text || 'No description',
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

// // Function to download PDFs
// async function downloadPdf(url, outputPath) {
//   try {
//     const response = await axios({
//       method: 'GET',
//       url: url,
//       responseType: 'stream',
//       httpsAgent
//     });
    
//     const writer = fs.createWriteStream(outputPath);
//     response.data.pipe(writer);
    
//     return new Promise((resolve, reject) => {
//       writer.on('finish', resolve);
//       writer.on('error', reject);
//     });
//   } catch (error) {
//     console.error(`Error downloading PDF: ${error.message}`);
//   }
// }

// // Main function
// async function main() {
//   const appNo = '040422'; // Application number from your URL
//   const url = `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appNo}`;
  
//   // Create output directory
//   const outputDir = path.join(__dirname, 'fda_pdfs');
//   if (!fs.existsSync(outputDir)) {
//     fs.mkdirSync(outputDir, { recursive: true });
//   }
  
//   // Fetch HTML content
//   const html = await fetchHtml(url);
//   if (!html) {
//     console.error('Failed to fetch HTML content');
//     return;
//   }
  
//   // Extract PDF links
//   const pdfLinks = extractPdfLinks(html);
  
//   if (pdfLinks.length === 0) {
//     console.log('No PDF links found');
//     return;
//   }
  
//   console.log(`Found ${pdfLinks.length} links:`);
  
//   // Create a CSV file to keep track of all links
//   const csvPath = path.join(outputDir, `${appNo}_links.csv`);
//   fs.writeFileSync(csvPath, 'Type,Description,URL\n');
  
//   // Log and save links
//   for (const [index, link] of pdfLinks.entries()) {
//     console.log(`${index + 1}. [${link.type}] ${link.text}: ${link.url}`);
    
//     // Append to CSV
//     fs.appendFileSync(csvPath, `${link.type},"${link.text.replace(/"/g, '""')}","${link.url}"\n`);
    
//     // Download the PDF if it has a PDF extension
//     if (link.url.toLowerCase().endsWith('.pdf')) {
//       const filename = link.url.split('/').pop();
//       const sanitizedName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
//       const outputPath = path.join(outputDir, sanitizedName);
      
//       console.log(`Downloading ${filename} to ${outputPath}...`);
//       try {
//         await downloadPdf(link.url, outputPath);
//         console.log(`Successfully downloaded ${filename}`);
//       } catch (error) {
//         console.error(`Failed to download ${filename}: ${error.message}`);
//       }
//     }
//   }
  
//   console.log('\nSummary:');
//   console.log(`Total links found: ${pdfLinks.length}`);
//   console.log(`CSV file with all links saved to: ${csvPath}`);
//   console.log(`PDFs downloaded to: ${outputDir}`);
// }

// // Run the main function
// main().catch(error => {
//   console.error('An error occurred:', error);
// });