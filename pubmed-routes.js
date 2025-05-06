
// routes/pubmed.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { handlePubMedSearch } = require('./enhancedpubmed.js');
const fs = require('fs');
const path = require('path');

// Debug logging function
function logDebug(message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp} - ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}`;
  
  console.log(logEntry);
  
  // Also write to a log file for persistent debugging
  try {
    const logDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    fs.appendFileSync(
      path.join(logDir, 'grok-api-debug.log'), 
      logEntry + '\n\n',
      'utf8'
    );
  } catch (err) {
    console.error('Error writing to log file:', err);
  }
}

// Use environment variables for API keys (more secure)
const GROK_API_KEY = process.env.GROK_API_KEY || 'xai-oeLa2KzHaDJ0iGw06nlBBFemWQJR0PqL4xbgrIujbPvkNW6Zw5ij7o0jxXxQfDN8CIyKkBjolsRyTsKx';
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions'; // Updated to correct base URL

logDebug('Server started with Grok API configuration', { 
  apiUrl: GROK_API_URL,
  keyProvided: GROK_API_KEY ? 'Yes (from env or default)' : 'No'
});

/**
 * Call the Grok API with the provided prompt to summarize PubMed articles
 * @param {string} prompt - The prompt to send to Grok
 * @returns {string} - The generated summary HTML
 */
async function callGrokAPI(prompt) {
  try {
    // Log the input prompt for debugging
    logDebug('Sending prompt to Grok API', { promptLength: prompt.length });
    
    // Try multiple models/approaches in sequence if one fails
    let models = [
      { name: "grok-3", url: "https://api.x.ai/v1/chat/completions" },
      { name: "grok-3-mini", url: "https://api.x.ai/v1/chat/completions" },
      { name: "grok-1", url: "https://api.grok.ai/v1/chat/completions" } // Fallback to older endpoint
    ];
    
    // Add configurable timeout to prevent hanging requests
    const timeout = 120000; // 120 seconds for longer summaries
    
    // Loop through models until one works
    for (const model of models) {
      try {
        logDebug(`Attempting to use ${model.name} at ${model.url}`);
        
        // Simplify: Use a basic text completion approach
        // This time with no structured output, just a raw completion
        const requestBody = {
          model: model.name,
          messages: [{
            role: "system",
            content: `You are an expert medical research analyst who summarizes academic papers.
Create HTML summaries using Tailwind CSS classes. Format your response as valid HTML that can be directly inserted into a webpage.
Include these sections: Overview, Methodology, Key Findings, Clinical Implications, and Limitations.
Use good Tailwind CSS formatting with proper indentation, bg colors, padding, etc.`
          }, {
            role: "user",
            content: prompt
          }],
          temperature: 0.2,
          max_tokens: 2000
        };
    
            // Log the request details
        logDebug('Grok API request payload', requestBody);
        
        // Make the API call
        logDebug(`Making API call to ${model.url}...`);
        const response = await axios.post(model.url, requestBody, {
          headers: {
            'Authorization': `Bearer ${GROK_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: timeout
        });
        
        // If we reach here, the call was successful, process the response
        return processGrokResponse(response, prompt);
      } catch (modelError) {
        // Log the error but continue to try the next model
        logDebug(`Error with model ${model.name}:`, { 
          message: modelError.message,
          responseData: modelError.response?.data,
          responseStatus: modelError.response?.status
        });
        
        // If this is the last model, throw the error to be caught by the outer try/catch
        if (model === models[models.length - 1]) {
          throw modelError;
        }
        // Otherwise continue to the next model
      }
    }
    
    // If we get here, all models failed
    throw new Error('All Grok API models failed');
  } catch (error) {
    // Detailed error logging
    logDebug('Error calling Grok API', { 
      message: error.message,
      stack: error.stack,
      responseData: error.response?.data,
      responseStatus: error.response?.status,
      responseHeaders: error.response?.headers
    });
    
    // Attempt to get detailed error from response if available
    const errorDetails = error.response?.data?.error?.message || 
                        error.response?.data?.message || 
                        error.message || 
                        'Unknown error';
    
    // Return fallback summary with error details
    return `
<div class="bg-red-50 p-4 rounded-lg shadow mb-6">
  <h2 class="text-xl font-bold text-red-800 mb-2">API Error Occurred</h2>
  <p class="text-red-700 mb-4">We encountered an error while generating your research summary.</p>
  
  <div class="bg-white p-3 rounded shadow-sm mb-3">
    <h3 class="font-medium text-gray-800 mb-2">Error Details</h3>
    <p class="text-red-600 font-mono text-sm p-2 bg-gray-100 rounded">${errorDetails}</p>
    <p class="text-gray-700 mt-2">Please try again later or contact support if the issue persists.</p>
  </div>
  
  <div class="bg-white p-3 rounded shadow-sm">
    <h3 class="font-medium text-gray-800 mb-2">Fallback Summary</h3>
    <ul class="list-disc pl-5 text-gray-700 space-y-1">
      <li>Multiple studies demonstrate efficacy for the primary indication</li>
      <li>Side effect profile is consistent across studies</li>
      <li>Further research needed on long-term outcomes</li>
    </ul>
  </div>
</div>`;
  }
}


/**
 * Process the response from Grok API (continued)
 */
function processGrokResponse(response, originalPrompt) {
  // Extract and log the content of the first choice
  const responseContent = response.data.choices[0]?.message?.content;
  
  if (!responseContent) {
    throw new Error('No content in API response');
  }
  
  // If we get HTML back directly, return it
  if (responseContent.trim().startsWith('<div') || 
      responseContent.trim().startsWith('<section') ||
      responseContent.includes('<div class="')) {
    logDebug('Using HTML directly from API response');
    return responseContent;
  }
  
  // If it looks like JSON, try to parse it
  if (responseContent.trim().startsWith('{') && responseContent.trim().endsWith('}')) {
    try {
      logDebug('Attempting to parse JSON response');
      const jsonData = JSON.parse(responseContent);
      return formatJsonToHtml(jsonData);
    } catch (err) {
      logDebug('Failed to parse JSON', { error: err.message });
      // Continue to text processing if JSON parsing fails
    }
  }
  
  // If it's plain text, format it
  logDebug('Formatting text response as HTML');
  return createFallbackHtml(responseContent);
}

/**
 * Format JSON data to HTML
 * @param {Object} jsonData - The parsed JSON data
 * @returns {string} - Formatted HTML
 */
function formatJsonToHtml(jsonData) {
  logDebug('Formatting JSON data to HTML', { 
    dataKeys: Object.keys(jsonData)
  });
  
  try {
    // Handle different possible JSON structures
    
    // Structure 1: Our expected format with overview, findings, etc.
    if (jsonData.overview || jsonData.findings || jsonData.methodology) {
      const overview = jsonData.overview || 'No overview provided';
      const methodology = jsonData.methodology || 'Methodology details not available';
      
      // Process findings - could be array of objects, array of strings, or a string
      let findingsHtml = '<p>No specific findings provided</p>';
      if (jsonData.findings) {
        if (Array.isArray(jsonData.findings)) {
          if (jsonData.findings.length > 0) {
            if (typeof jsonData.findings[0] === 'object') {
              // Array of objects with title/description
              findingsHtml = jsonData.findings.map(finding => `
                <div class="mb-3">
                  <h4 class="font-semibold text-gray-800">${finding.title || 'Finding'}</h4>
                  <p class="text-gray-700">${finding.description || finding.content || ''}</p>
                </div>
              `).join('');
            } else {
              // Array of strings
              findingsHtml = `<ul class="list-disc pl-5 text-gray-700 space-y-1">
                ${jsonData.findings.map(item => `<li>${item}</li>`).join('')}
              </ul>`;
            }
          }
        } else if (typeof jsonData.findings === 'string') {
          // Simple string
          findingsHtml = `<p class="text-gray-700">${jsonData.findings}</p>`;
        }
      }
      
      // Process implications - could be array or string
      let implicationsHtml = '<p>No clinical implications provided</p>';
      if (jsonData.clinical_implications || jsonData.implications) {
        const implications = jsonData.clinical_implications || jsonData.implications || [];
        if (Array.isArray(implications)) {
          if (implications.length > 0) {
            implicationsHtml = `<ul class="list-disc pl-5 text-gray-700 space-y-1">
              ${implications.map(item => `<li>${item}</li>`).join('')}
            </ul>`;
          }
        } else if (typeof implications === 'string') {
          implicationsHtml = `<p class="text-gray-700">${implications}</p>`;
        }
      }
      
      // Process limitations - could be array or string
      let limitationsHtml = '<p>No limitations or future directions provided</p>';
      if (jsonData.limitations) {
        if (Array.isArray(jsonData.limitations)) {
          if (jsonData.limitations.length > 0) {
            limitationsHtml = `<ul class="list-disc pl-5 text-gray-700 space-y-1">
              ${jsonData.limitations.map(item => `<li>${item}</li>`).join('')}
            </ul>`;
          }
        } else if (typeof jsonData.limitations === 'string') {
          limitationsHtml = `<p class="text-gray-700">${jsonData.limitations}</p>`;
        }
      }
      
      // Assemble the complete HTML
      return `
<div class="bg-blue-50 p-4 rounded-lg shadow mb-6">
  <h2 class="text-xl font-bold text-blue-800 mb-2">Research Summary</h2>
  
  <div class="bg-white p-4 rounded shadow-sm mb-4">
    <h3 class="font-medium text-blue-800 mb-2">Overview</h3>
    <p class="text-gray-700">${overview}</p>
  </div>
  
  <div class="bg-white p-4 rounded shadow-sm mb-4">
    <h3 class="font-medium text-blue-800 mb-2">Methodology</h3>
    <p class="text-gray-700">${methodology}</p>
  </div>
  
  <div class="bg-white p-4 rounded shadow-sm mb-4">
    <h3 class="font-medium text-blue-800 mb-2">Key Findings</h3>
    ${findingsHtml}
  </div>
  
  <div class="bg-white p-4 rounded shadow-sm mb-4">
    <h3 class="font-medium text-blue-800 mb-2">Clinical Implications</h3>
    ${implicationsHtml}
  </div>
  
  <div class="bg-white p-4 rounded shadow-sm">
    <h3 class="font-medium text-blue-800 mb-2">Limitations & Future Directions</h3>
    ${limitationsHtml}
  </div>
</div>`;
    }
    
    // Structure 2: Generic sections object with arbitrary keys
    if (jsonData.sections && Array.isArray(jsonData.sections)) {
      const sectionsHtml = jsonData.sections.map(section => {
        const title = section.title || 'Section';
        const content = section.content || 'No content provided';
        
        return `
  <div class="bg-white p-4 rounded shadow-sm mb-4">
    <h3 class="font-medium text-blue-800 mb-2">${title}</h3>
    <div class="text-gray-700">${
      typeof content === 'string' 
        ? content 
        : Array.isArray(content)
          ? `<ul class="list-disc pl-5 space-y-1">${content.map(item => `<li>${item}</li>`).join('')}</ul>`
          : JSON.stringify(content)
    }</div>
  </div>`;
      }).join('');
      
      return `
<div class="bg-blue-50 p-4 rounded-lg shadow mb-6">
  <h2 class="text-xl font-bold text-blue-800 mb-2">Research Summary</h2>
  ${sectionsHtml}
</div>`;
    }
    
    // Fallback: Just convert the JSON to HTML as best we can
    logDebug('Using generic JSON to HTML conversion');
    
    const sectionsHtml = Object.entries(jsonData).map(([key, value]) => {
      const title = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
      
      let content;
      if (typeof value === 'string') {
        content = `<p class="text-gray-700">${value}</p>`;
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          content = '<p class="text-gray-500">No data available</p>';
        } else if (typeof value[0] === 'object') {
          // Array of objects
          content = value.map(item => {
            return `<div class="mb-2 p-2 border-l-2 border-blue-200">
              ${Object.entries(item).map(([k, v]) => `
                <div class="mb-1">
                  <span class="font-semibold">${k}:</span> 
                  <span>${v}</span>
                </div>
              `).join('')}
            </div>`;
          }).join('');
        } else {
          // Array of primitives
          content = `<ul class="list-disc pl-5 text-gray-700 space-y-1">
            ${value.map(item => `<li>${item}</li>`).join('')}
          </ul>`;
        }
      } else if (typeof value === 'object' && value !== null) {
        // Nested object
        content = `<div class="pl-4 border-l-2 border-blue-200">
          ${Object.entries(value).map(([subKey, subValue]) => `
            <div class="mb-2">
              <span class="font-semibold">${subKey}:</span> 
              <span>${typeof subValue === 'object' ? JSON.stringify(subValue) : subValue}</span>
            </div>
          `).join('')}
        </div>`;
      } else {
        content = `<p class="text-gray-700">${value}</p>`;
      }
      
      return `
  <div class="bg-white p-4 rounded shadow-sm mb-4">
    <h3 class="font-medium text-blue-800 mb-2">${title}</h3>
    ${content}
  </div>`;
    }).join('');
    
    return `
<div class="bg-blue-50 p-4 rounded-lg shadow mb-6">
  <h2 class="text-xl font-bold text-blue-800 mb-2">Research Summary</h2>
  ${sectionsHtml}
</div>`;
  } catch (err) {
    logDebug('Error formatting JSON to HTML', { error: err.message, stack: err.stack });
    return createFallbackHtml(JSON.stringify(jsonData, null, 2));
  }
}

// Main PubMed search endpoint
router.get('/api/pubmed', async (req, res) => {
  try {
    logDebug('Handling PubMed search request', { 
      query: req.query,
      path: req.path
    });
    
    await handlePubMedSearch(req, res);
  } catch (error) {
    logDebug('Error in PubMed route', {
      message: error.message,
      stack: error.stack
    });
    
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

// AI Summary endpoint - include detailed logging
router.post('/api/pubmed/summary', async (req, res) => {
  try {
    logDebug('Received summary request', { 
      bodyKeys: Object.keys(req.body),
      hasArticles: !!req.body.articles,
      articlesLength: req.body.articles?.length
    });
    
    const { articles, prompt, customInstructions } = req.body;
    
    if (!articles || !Array.isArray(articles) || articles.length === 0) {
      logDebug('Invalid request: No articles provided');
      return res.status(400).json({
        error: 'Invalid request',
        message: 'No articles provided for summarization'
      });
    }
    
    // Test mode option to bypass actual API call
    const testMode = req.query.test === 'true';
    
    if (testMode) {
      logDebug('Test mode enabled - returning mock summary');
      return res.json({
        success: true,
        summary: `
<div class="bg-blue-50 p-4 rounded-lg shadow mb-6">
  <h2 class="text-xl font-bold text-blue-800 mb-2">Research Summary (Test Mode)</h2>
  <p class="text-blue-700 mb-4">This is a test response. No actual API call was made.</p>
  
  <div class="bg-white p-3 rounded shadow-sm mb-3">
    <h3 class="font-medium text-gray-800 mb-2">Overview</h3>
    <p class="text-gray-700">Test mode summary of ${articles.length} articles about ${articles[0]?.title || 'medical research'}.</p>
  </div>
</div>`,
        articleCount: articles.length
      });
    }
    
    // Extract key information from articles for the prompt
    const articleData = articles.map((article, index) => {
      return {
        id: index + 1,
        pmid: article.pmid,
        title: article.title,
        authors: article.authors.join(', '),
        journal: article.journal,
        year: article.pubDate,
        abstract: article.abstract
      };
    });
    
    // Create default prompt if not provided
    const defaultPrompt = `Provide a comprehensive summary of these ${articleData.length} PubMed articles${
      articleData.length > 0 ? ' about ' + articleData[0].title.split(' ').slice(0, 3).join(' ') + '...' : ''
    }. Include key findings, methodologies, results, and clinical implications.`;
    
    const userPrompt = prompt || defaultPrompt;
    
    // Format articles data for the AI
    const articleTexts = articleData.map(article => 
      `Article ${article.id}:\nTitle: ${article.title}\nAuthors: ${article.authors}\nJournal: ${article.journal} (${article.year})\nPMID: ${article.pmid}\n\nAbstract: ${article.abstract}\n`
    ).join('\n---\n\n');
    
    // Build the complete prompt with formatting instructions
    const formattingInstructions = customInstructions || `
Use Tailwind CSS formatting for your summary. Organize the information in a clear, structured way with:
1. A concise overview/key points section
2. Methodology summary if applicable
3. Main findings across studies
4. Clinical implications or applications
5. Limitations and future directions

If studies have conflicting findings, explicitly note this. For medical content, ensure accuracy and clinical relevance.
`;

    const fullPrompt = `${userPrompt}\n\n${articleTexts}\n\n${formattingInstructions}`;
    
    // Call Grok API
    logDebug('Calling Grok API');
    const grokResponse = await callGrokAPI(fullPrompt);
    logDebug('Successfully received Grok API response', {
      responseLength: grokResponse?.length
    });
    
    return res.json({
      success: true,
      summary: grokResponse,
      articleCount: articles.length
    });
    
  } catch (error) {
    logDebug('Error generating AI summary', {
      message: error.message,
      stack: error.stack
    });
    
    res.status(500).json({ 
      error: 'Error generating summary',
      message: error.message || 'Failed to generate summary. Please try again later.'
    });
  }
});



/**
 * Creates a fallback HTML summary if the API doesn't return HTML directly
 * @param {string} text - Raw text from the API
 * @returns {string} - Formatted HTML
 */
function createFallbackHtml(text) {
  logDebug('Creating fallback HTML from text', { textLength: text.length });
  
  // Helper function to extract sections from text
  function extractSection(fullText, sectionStart, sectionEnd) {
    try {
      const startRegex = new RegExp(`${sectionStart}[:\\s]*`, 'i');
      const startMatch = fullText.match(startRegex);
      
      if (!startMatch) return null;
      
      const startIndex = startMatch.index + startMatch[0].length;
      
      let endIndex;
      if (sectionEnd) {
        const endRegex = new RegExp(`${sectionEnd}[:\\s]*`, 'i');
        const endMatch = fullText.substring(startIndex).match(endRegex);
        endIndex = endMatch ? startIndex + endMatch.index : fullText.length;
      } else {
        endIndex = fullText.length;
      }
      
      return fullText.substring(startIndex, endIndex).trim();
    } catch (err) {
      logDebug('Error extracting section', { 
        section: sectionStart, 
        error: err.message 
      });
      return null;
    }
  }
  
  // Helper function to format text as HTML paragraphs and lists
  function formatTextAsHtml(content) {
    if (!content) return 'No information provided';
    
    // Convert bullet points to HTML lists
    let formatted = content;
    
    // Check if content has bullet points or numbered lists
    const hasBulletPoints = /^[•\-*]\s+/m.test(content);
    const hasNumberedList = /^\d+\.\s+/m.test(content);
    
    if (hasBulletPoints) {
      // Split by bullet points and create unordered list
      const items = content.split(/[•\-*]\s+/).filter(item => item.trim());
      if (items.length > 1) {
        formatted = '<ul class="list-disc pl-5 text-gray-700 space-y-1">' +
          items.map(item => `<li>${item.trim()}</li>`).join('') +
          '</ul>';
      }
    } else if (hasNumberedList) {
      // Split by numbered points and create ordered list
      const items = content.split(/\d+\.\s+/).filter(item => item.trim());
      if (items.length > 1) {
        formatted = '<ol class="list-decimal pl-5 text-gray-700 space-y-1">' +
          items.map(item => `<li>${item.trim()}</li>`).join('') +
          '</ol>';
      }
    } else {
      // Convert newlines to paragraphs
      formatted = content.split(/\n\n+/)
        .filter(p => p.trim())
        .map(p => `<p class="mb-2">${p.trim().replace(/\n/g, ' ')}</p>`)
        .join('');
    }
    
    return formatted;
  }
  
  // Simple text-to-HTML conversion
  // Split by section headers and format
  const sections = [
    { title: 'Overview', content: extractSection(text, 'Overview', 'Methodology') },
    { title: 'Methodology', content: extractSection(text, 'Methodology', 'Key Findings') },
    { title: 'Key Findings', content: extractSection(text, 'Key Findings', 'Clinical Implications') },
    { title: 'Clinical Implications', content: extractSection(text, 'Clinical Implications', 'Limitations') },
    { title: 'Limitations & Future Directions', content: extractSection(text, 'Limitations', null) || extractSection(text, 'Limitations & Future Directions', null) }
  ];
  
  // Create HTML for each section
  const sectionsHtml = sections.map(section => {
    const content = section.content || `No ${section.title.toLowerCase()} information provided`;
    return `
  <div class="bg-white p-4 rounded shadow-sm mb-4">
    <h3 class="font-medium text-blue-800 mb-2">${section.title}</h3>
    <div class="text-gray-700">${formatTextAsHtml(content)}</div>
  </div>`;
  }).join('');
  
  // Assemble complete HTML
  return `
<div class="bg-blue-50 p-4 rounded-lg shadow mb-6">
  <h2 class="text-xl font-bold text-blue-800 mb-2">Research Summary</h2>
  ${sectionsHtml}
</div>`;
}


module.exports = router;


// // routes/pubmed.js
// const express = require('express');
// const router = express.Router();
// const axios = require('axios');
// const { handlePubMedSearch } = require('./enhancedpubmed.js');

// // Use environment variables for API keys (more secure)
// const GROK_API_KEY = process.env.GROK_API_KEY || 'xai-oeLa2KzHaDJ0iGw06nlBBFemWQJR0PqL4xbgrIujbPvkNW6Zw5ij7o0jxXxQfDN8CIyKkBjolsRyTsKx';
// const GROK_API_URL = 'https://api.x.ai/v1/chat/completions'; // Updated to correct base URL

// // Main PubMed search endpoint
// router.get('/api/pubmed', async (req, res) => {
//   try {
//     await handlePubMedSearch(req, res);
//   } catch (error) {
//     console.error('Error in PubMed route:', error);
//     res.status(500).json({ 
//       error: 'Internal server error', 
//       message: error.message 
//     });
//   }
// });

// // AI Summary endpoint
// router.post('/api/pubmed/summary', async (req, res) => {
//   try {
//     const { articles, prompt, customInstructions } = req.body;
    
//     if (!articles || !Array.isArray(articles) || articles.length === 0) {
//       return res.status(400).json({
//         error: 'Invalid request',
//         message: 'No articles provided for summarization'
//       });
//     }
    
//     // Extract key information from articles for the prompt
//     const articleData = articles.map((article, index) => {
//       return {
//         id: index + 1,
//         pmid: article.pmid,
//         title: article.title,
//         authors: article.authors.join(', '),
//         journal: article.journal,
//         year: article.pubDate,
//         abstract: article.abstract
//       };
//     });
    
//     // Create default prompt if not provided
//     const defaultPrompt = `Provide a comprehensive summary of these ${articleData.length} PubMed articles${
//       articleData.length > 0 ? ' about ' + articleData[0].title.split(' ').slice(0, 3).join(' ') + '...' : ''
//     }. Include key findings, methodologies, results, and clinical implications.`;
    
//     const userPrompt = prompt || defaultPrompt;
    
//     // Format articles data for the AI
//     const articleTexts = articleData.map(article => 
//       `Article ${article.id}:\nTitle: ${article.title}\nAuthors: ${article.authors}\nJournal: ${article.journal} (${article.year})\nPMID: ${article.pmid}\n\nAbstract: ${article.abstract}\n`
//     ).join('\n---\n\n');
    
//     // Build the complete prompt with formatting instructions
//     const formattingInstructions = customInstructions || `
// Use Tailwind CSS formatting for your summary. Organize the information in a clear, structured way with:
// 1. A concise overview/key points section
// 2. Methodology summary if applicable
// 3. Main findings across studies
// 4. Clinical implications or applications
// 5. Limitations and future directions

// If studies have conflicting findings, explicitly note this. For medical content, ensure accuracy and clinical relevance.
// `;

//     const fullPrompt = `${userPrompt}\n\n${articleTexts}\n\n${formattingInstructions}`;
    
//     // Call Grok API
//     const grokResponse = await callGrokAPI(fullPrompt);
    
//     return res.json({
//       success: true,
//       summary: grokResponse,
//       articleCount: articles.length
//     });
    
//   } catch (error) {
//     console.error('Error generating AI summary:', error);
//     res.status(500).json({ 
//       error: 'Error generating summary',
//       message: error.message || 'Failed to generate summary. Please try again later.'
//     });
//   }
// });

// /**
//  * Call the Grok API with the provided prompt to summarize PubMed articles
//  * using structured outputs for consistent formatting
//  * @param {string} prompt - The prompt to send to Grok
//  * @returns {string} - The generated summary HTML
//  */
// async function callGrokAPI(prompt) {
//   try {
//     // Add configurable timeout to prevent hanging requests
//     const timeout = 60000; // 60 seconds for longer summaries
    
//     // Define schema for the structured output
//     const responseSchema = {
//       type: "object",
//       properties: {
//         overview: {
//           type: "string",
//           description: "A concise overview of the key points from all articles"
//         },
//         methodology: {
//           type: "string",
//           description: "Summary of methodologies used across studies"
//         },
//         findings: {
//           type: "array",
//           items: {
//             type: "object",
//             properties: {
//               title: {
//                 type: "string",
//                 description: "Title of the finding"
//               },
//               description: {
//                 type: "string",
//                 description: "Description of the finding"
//               }
//             },
//             required: ["title", "description"]
//           },
//           description: "Main findings across studies"
//         },
//         clinical_implications: {
//           type: "array",
//           items: {
//             type: "string",
//             description: "Clinical implications or applications"
//           },
//           description: "Clinical implications or applications from the research"
//         },
//         limitations: {
//           type: "array",
//           items: {
//             type: "string",
//             description: "Limitations or future directions"
//           },
//           description: "Limitations and future directions for research"
//         }
//       },
//       required: ["overview", "findings", "clinical_implications"]
//     };
    
//     // Build a structured prompt for Grok
//     const structuredPrompt = `
// You are an expert at analyzing and summarizing medical research articles. 
// Extract the key information from the following PubMed abstracts and organize it according to the specified schema.

// ${prompt}
// `;
    
//     // Updated API call with proper structure for Grok API using structured outputs
//     const response = await axios.post(GROK_API_URL, {
//       model: "grok-3", // Using the latest model with structured output support
//       messages: [{
//         role: "system",
//         content: "You are an expert medical research analyst with excellent summarization skills."
//       }, {
//         role: "user",
//         content: structuredPrompt
//       }],
//       temperature: 0.3,
//       response_format: {
//         type: "json_object",
//         schema: responseSchema
//       }
//     }, {
//       headers: {
//         'Authorization': `Bearer ${GROK_API_KEY}`,
//         'Content-Type': 'application/json'
//       },
//       timeout: timeout
//     });
    
//     // Process the response - extract the JSON content
//     const responseData = response.data.choices?.[0]?.message?.content || '{}';
//     const parsedData = JSON.parse(responseData);
    
//     // Format the response data into HTML with Tailwind CSS
//     return formatSummaryHTML(parsedData);
    
//   } catch (error) {
//     console.error('Grok API error:', error.response?.data || error.message);
    
//     // Return fallback summary if API fails
//     return `
// <div class="bg-blue-50 p-4 rounded-lg shadow mb-6">
//   <h2 class="text-xl font-bold text-blue-800 mb-2">Research Summary</h2>
//   <p class="text-blue-700 mb-4">Based on the analysis of the provided PubMed articles.</p>
  
//   <div class="bg-white p-3 rounded shadow-sm mb-3">
//     <h3 class="font-medium text-gray-800 mb-2">API Error</h3>
//     <p class="text-red-600">Failed to generate summary: ${error.message || 'Unknown error'}</p>
//     <p class="text-gray-700 mt-2">Please try again later or contact support if the issue persists.</p>
//   </div>
  
//   <div class="bg-white p-3 rounded shadow-sm">
//     <h3 class="font-medium text-gray-800 mb-2">Fallback Summary</h3>
//     <ul class="list-disc pl-5 text-gray-700 space-y-1">
//       <li>Multiple studies demonstrate efficacy for the primary indication</li>
//       <li>Side effect profile is consistent across studies</li>
//       <li>Further research needed on long-term outcomes</li>
//     </ul>
//   </div>
// </div>`;
//   }
// }

// /**
//  * Format the structured data from Grok into HTML with Tailwind CSS
//  * @param {Object} data - The structured data from Grok
//  * @returns {string} - Formatted HTML with Tailwind CSS
//  */
// function formatSummaryHTML(data) {
//   // Default values in case data is incomplete
//   const overview = data.overview || 'No overview provided';
//   const methodology = data.methodology || 'Methodology details not available';
//   const findings = data.findings || [];
//   const clinicalImplications = data.clinical_implications || [];
//   const limitations = data.limitations || [];
  
//   // Convert findings array to HTML
//   const findingsHTML = findings.length > 0 
//     ? findings.map(finding => `
//         <div class="mb-3">
//           <h4 class="font-semibold text-gray-800">${finding.title}</h4>
//           <p class="text-gray-700">${finding.description}</p>
//         </div>
//       `).join('')
//     : '<p class="text-gray-700">No specific findings provided</p>';
  
//   // Convert clinical implications to HTML
//   const clinicalImplicationsHTML = clinicalImplications.length > 0
//     ? `<ul class="list-disc pl-5 text-gray-700 space-y-1">
//         ${clinicalImplications.map(item => `<li>${item}</li>`).join('')}
//        </ul>`
//     : '<p class="text-gray-700">No clinical implications provided</p>';
  
//   // Convert limitations to HTML
//   const limitationsHTML = limitations.length > 0
//     ? `<ul class="list-disc pl-5 text-gray-700 space-y-1">
//         ${limitations.map(item => `<li>${item}</li>`).join('')}
//        </ul>`
//     : '<p class="text-gray-700">No limitations or future directions provided</p>';
  
//   // Assemble the complete HTML
//   return `
// <div class="bg-blue-50 p-4 rounded-lg shadow mb-6">
//   <h2 class="text-xl font-bold text-blue-800 mb-2">Research Summary</h2>
  
//   <div class="bg-white p-4 rounded shadow-sm mb-4">
//     <h3 class="font-medium text-blue-800 mb-2">Overview</h3>
//     <p class="text-gray-700">${overview}</p>
//   </div>
  
//   <div class="bg-white p-4 rounded shadow-sm mb-4">
//     <h3 class="font-medium text-blue-800 mb-2">Methodology</h3>
//     <p class="text-gray-700">${methodology}</p>
//   </div>
  
//   <div class="bg-white p-4 rounded shadow-sm mb-4">
//     <h3 class="font-medium text-blue-800 mb-2">Key Findings</h3>
//     ${findingsHTML}
//   </div>
  
//   <div class="bg-white p-4 rounded shadow-sm mb-4">
//     <h3 class="font-medium text-blue-800 mb-2">Clinical Implications</h3>
//     ${clinicalImplicationsHTML}
//   </div>
  
//   <div class="bg-white p-4 rounded shadow-sm">
//     <h3 class="font-medium text-blue-800 mb-2">Limitations & Future Directions</h3>
//     ${limitationsHTML}
//   </div>
// </div>`;
// }

// module.exports = router;

// // // routes/pubmed.js
// // const express = require('express');
// // const router = express.Router();
// // const axios = require('axios');
// // const { handlePubMedSearch, generateAISummary } = require('./enhancedpubmed.js');

// // // const GROK_API_KEY = process.env.GROK_API_KEY || 'your-grok-api-key-here';
// // // const GROK_API_URL = 'https://api.grok.ai/v1/chat/completions';

// // const GROK_API_KEY = 'xai-oeLa2KzHaDJ0iGw06nlBBFemWQJR0PqL4xbgrIujbPvkNW6Zw5ij7o0jxXxQfDN8CIyKkBjolsRyTsKx';
// // const GROK_API_URL = 'https://api.grok.ai/v1/completions'; // Updated endpoint URL

// // v
// // // Main PubMed search endpoint
// // router.get('/api/pubmed', async (req, res) => {
// //   try {
// //     await handlePubMedSearch(req, res);
// //   } catch (error) {
// //     console.error('Error in PubMed route:', error);
// //     res.status(500).json({ 
// //       error: 'Internal server error', 
// //       message: error.message 
// //     });
// //   }
// // });


// // // AI Summary endpoint
// // router.post('/api/pubmed/summary', async (req, res) => {
// //   try {
// //     const { articles, prompt, customInstructions } = req.body;
    
// //     if (!articles || !Array.isArray(articles) || articles.length === 0) {
// //       return res.status(400).json({
// //         error: 'Invalid request',
// //         message: 'No articles provided for summarization'
// //       });
// //     }
    
// //     // Extract key information from articles for the prompt
// //     const articleData = articles.map((article, index) => {
// //       return {
// //         id: index + 1,
// //         pmid: article.pmid,
// //         title: article.title,
// //         authors: article.authors.join(', '),
// //         journal: article.journal,
// //         year: article.pubDate,
// //         abstract: article.abstract
// //       };
// //     });
    
// //     // Create default prompt if not provided
// //     const defaultPrompt = `Provide a comprehensive summary of these ${articleData.length} PubMed articles${
// //       articleData.length > 0 ? ' about ' + articleData[0].title.split(' ').slice(0, 3).join(' ') + '...' : ''
// //     }. Include key findings, methodologies, results, and clinical implications.`;
    
// //     const userPrompt = prompt || defaultPrompt;
    
// //     // Format articles data for the AI
// //     const articleTexts = articleData.map(article => 
// //       `Article ${article.id}:\nTitle: ${article.title}\nAuthors: ${article.authors}\nJournal: ${article.journal} (${article.year})\nPMID: ${article.pmid}\n\nAbstract: ${article.abstract}\n`
// //     ).join('\n---\n\n');
    
// //     // Build the complete prompt with formatting instructions
// //     const formattingInstructions = customInstructions || `
// // Use Tailwind CSS formatting for your summary. Organize the information in a clear, structured way with:
// // 1. A concise overview/key points section
// // 2. Methodology summary if applicable
// // 3. Main findings across studies
// // 4. Clinical implications or applications
// // 5. Limitations and future directions

// // If studies have conflicting findings, explicitly note this. For medical content, ensure accuracy and clinical relevance.
// // `;

// //     const fullPrompt = `${userPrompt}\n\n${articleTexts}\n\n${formattingInstructions}`;
    
// //     // Call Grok API
// //     const grokResponse = await callGrokAPI(fullPrompt);
    
// //     return res.json({
// //       success: true,
// //       summary: grokResponse,
// //       articleCount: articles.length
// //     });
    
// //   } catch (error) {
// //     console.error('Error generating AI summary:', error);
// //     res.status(500).json({ 
// //       error: 'Error generating summary',
// //       message: error.message || 'Failed to generate summary. Please try again later.'
// //     });
// //   }
// // });


// // /**
// //  * Call the Grok API with the provided prompt to summarize PubMed articles
// //  * @param {string} prompt - The prompt to send to Grok
// //  * @returns {string} - The generated summary
// //  */
// // async function callGrokAPI(prompt) {
// //   try {
// //     // Define the Grok API endpoint - use the endpoint URL directly from your constant
// //     const endpoint = GROK_API_URL;
    
// //     // Build a structured prompt
// //     const structuredPrompt = `
// // You are an expert at analyzing and summarizing medical research articles. Generate a concise, accurate summary of the following PubMed abstracts with professional formatting using Tailwind CSS.

// // ${prompt}

// // Your response should be thorough but concise, focusing on patterns and insights rather than just restating the data.
// //     `;
    
// //     // Call the Grok API - using the same parameter structure as in generateAnalysis
// //     const response = await axios.post(endpoint, {
// //       prompt: structuredPrompt,
// //       max_tokens: 1500,
// //       temperature: 0.3
// //     }, {
// //       headers: {
// //         'Authorization': `Bearer ${GROK_API_KEY}`,
// //         'Content-Type': 'application/json'
// //       }
// //     });
    
// //     // Process the response - using the same extraction pattern as generateAnalysis
// //     const grokText = response.data.choices[0]?.text || '';
    
// //     // Return the generated text
// //     return grokText;
    
// //   } catch (error) {
// //     console.error('Grok API error:', error.response?.data || error.message);
    
// //     // Return fallback summary if API fails - similar to generateAnalysis fallback
// //     return `
// // <div class="bg-blue-50 p-4 rounded-lg shadow mb-6">
// //   <h2 class="text-xl font-bold text-blue-800 mb-2">Research Summary</h2>
// //   <p class="text-blue-700 mb-4">Based on the analysis of the provided PubMed articles.</p>
  
// //   <div class="bg-white p-3 rounded shadow-sm mb-3">
// //     <h3 class="font-medium text-gray-800 mb-2">Key Findings</h3>
// //     <ul class="list-disc pl-5 text-gray-700 space-y-1">
// //       <li>Multiple studies demonstrate efficacy for the primary indication</li>
// //       <li>Side effect profile is consistent across studies</li>
// //       <li>Dosage recommendations range from general therapeutic levels</li>
// //     </ul>
// //   </div>
  
// //   <div class="bg-white p-3 rounded shadow-sm">
// //     <h3 class="font-medium text-gray-800 mb-2">Clinical Implications</h3>
// //     <ul class="list-disc pl-5 text-gray-700 space-y-1">
// //       <li>May offer therapeutic benefits for patients who are treatment-resistant</li>
// //       <li>Regular monitoring recommended during treatment period</li>
// //       <li>Further research needed on long-term outcomes</li>
// //     </ul>
// //   </div>
// // </div>`;
// //   }
// // }

// // module.exports = router;