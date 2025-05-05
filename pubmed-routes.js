// routes/pubmed.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { handlePubMedSearch, generateAISummary } = require('./enhancedpubmed.js');

// const GROK_API_KEY = process.env.GROK_API_KEY || 'your-grok-api-key-here';
// const GROK_API_URL = 'https://api.grok.ai/v1/chat/completions';

const GROK_API_KEY = 'xai-oeLa2KzHaDJ0iGw06nlBBFemWQJR0PqL4xbgrIujbPvkNW6Zw5ij7o0jxXxQfDN8CIyKkBjolsRyTsKx';
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';

// Main PubMed search endpoint
router.get('/api/pubmed', async (req, res) => {
  try {
    await handlePubMedSearch(req, res);
  } catch (error) {
    console.error('Error in PubMed route:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

// // AI Summary generation endpoint
// router.post('/api/pubmed/summary', async (req, res) => {
//   try {
//     const { articles, prompt } = req.body;
    
//     if (!articles || !Array.isArray(articles) || articles.length === 0) {
//       return res.status(400).json({
//         error: 'Invalid request',
//         message: 'No articles provided for summarization'
//       });
//     }
    
//     // Prepare the data for the AI
//     const articleData = articles.map(article => {
//       return {
//         title: article.title,
//         authors: article.authors,
//         journal: article.journal,
//         year: article.pubDate,
//         abstract: article.abstract,
//         pmid: article.pmid
//       };
//     });
    
//     // Create default prompt if not provided
//     const defaultPrompt = `Provide a comprehensive summary of these ${articleData.length} PubMed articles${
//       articleData.length > 0 ? ' about ' + articleData[0].title.split(' ').slice(0, 3).join(' ') + '...' : ''
//     } and provide key insights.`;
    
//     const actualPrompt = prompt || defaultPrompt;
    
//     // Format articles data for the AI
//     const articleTexts = articleData.map((article, index) => 
//       `Article ${index + 1}:\nTitle: ${article.title}\nAuthors: ${article.authors.join(', ')}\nJournal: ${article.journal} (${article.year})\nPMID: ${article.pmid}\nAbstract: ${article.abstract}\n`
//     ).join('\n---\n\n');
    
//     // Combine prompt and article data
//     const fullPrompt = `${actualPrompt}\n\n${articleTexts}\n\nUse Tailwind CSS formatting for your summary, organizing information in a clear, structured way. Include main findings, methodology, results, and clinical implications when available. Present conflicting findings if they exist.`;
    
//     // Call Grok or another AI API here
//     try {
//       // Replace with your actual AI API call
//       // This is a simulation for demonstration
//       const aiResponse = await simulateGrokAPICall(fullPrompt);
      
//       return res.json({
//         success: true,
//         summary: aiResponse
//       });
//     } catch (aiError) {
//       console.error('AI API error:', aiError);
//       return res.status(500).json({
//         error: 'Error generating summary',
//         message: 'The AI service encountered an error. Please try again later.'
//       });
//     }
    
//   } catch (error) {
//     console.error('Error in AI Summary route:', error);
//     res.status(500).json({ 
//       error: 'Internal server error', 
//       message: error.message 
//     });
//   }
// });

// // Simulate Grok API call (replace with actual implementation)
// async function simulateGrokAPICall(prompt) {
//   // In a real implementation, this would be an API call to Grok or another AI service
//   console.log('Calling AI API with prompt length:', prompt.length);
  
//   // Simulate API delay
//   await new Promise(resolve => setTimeout(resolve, 2000));
  
//   // Return a simulated tailwind-formatted summary
//   return `
// <div class="bg-blue-50 p-4 rounded-lg shadow mb-6">
//   <h2 class="text-xl font-bold text-blue-800 mb-2">Research Summary</h2>
//   <p class="text-blue-700 mb-4">Analysis of ${prompt.split('Article').length - 1} PubMed articles.</p>
  
//   <div class="bg-white p-3 rounded shadow-sm mb-3">
//     <h3 class="font-medium text-gray-800 mb-2">Key Findings</h3>
//     <ul class="list-disc pl-5 text-gray-700 space-y-1">
//       <li>Multiple studies demonstrate efficacy for the primary indication</li>
//       <li>Side effect profile is consistent across studies</li>
//       <li>Dosage recommendations range from X to Y mg daily</li>
//     </ul>
//   </div>
  
//   <div class="bg-white p-3 rounded shadow-sm">
//     <h3 class="font-medium text-gray-800 mb-2">Clinical Implications</h3>
//     <ul class="list-disc pl-5 text-gray-700 space-y-1">
//       <li>May offer therapeutic benefits for patients who are treatment-resistant</li>
//       <li>Regular monitoring recommended during treatment period</li>
//       <li>Further research needed on long-term outcomes</li>
//     </ul>
//   </div>
// </div>

// <div class="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-4">
//   <h3 class="text-lg font-medium text-gray-800 mb-3">Methodology Overview</h3>
//   <p class="text-gray-700 mb-3">
//     The studies primarily used randomized controlled trials with double-blind methodology.
//     Sample sizes ranged from 28 to 246 participants, with treatment durations from 6 to 24 weeks.
//   </p>
//   <div class="border-t border-gray-100 pt-3">
//     <div class="flex items-center text-sm text-gray-600">
//       <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//         <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
//       </svg>
//       Note: Methodological quality varied across studies, with some limitations in blinding procedures.
//     </div>
//   </div>
// </div>

// <div class="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
//   <h3 class="text-lg font-medium text-gray-800 mb-3">Conclusion</h3>
//   <p class="text-gray-700">
//     The evidence suggests potential efficacy with an acceptable safety profile, though larger studies with longer follow-up periods are needed to establish long-term safety and effectiveness.
//   </p>
// </div>
//   `;
// }

// AI Summary endpoint
router.post('/api/pubmed/summary', async (req, res) => {
  try {
    const { articles, prompt, customInstructions } = req.body;
    
    if (!articles || !Array.isArray(articles) || articles.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'No articles provided for summarization'
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
    const grokResponse = await callGrokAPI(fullPrompt);
    
    return res.json({
      success: true,
      summary: grokResponse,
      articleCount: articles.length
    });
    
  } catch (error) {
    console.error('Error generating AI summary:', error);
    res.status(500).json({ 
      error: 'Error generating summary',
      message: error.message || 'Failed to generate summary. Please try again later.'
    });
  }
});

/**
 * Call the Grok API with the provided prompt
 * @param {string} prompt - The prompt to send to Grok
 * @returns {string} - The generated summary
 */
async function callGrokAPI(prompt) {
  try {
    // Configure the request to Grok API
    const response = await axios.post(GROK_API_URL, {
      model: "grok-1", // Adjust based on available Grok models
      messages: [
        {
          role: "system",
          content: "You are an expert at analyzing and summarizing medical research articles. Generate concise, accurate summaries of PubMed abstracts with professional formatting using Tailwind CSS."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3, // Lower temperature for more focused responses
      max_tokens: 1500 // Adjust based on desired summary length
    }, {
      headers: {
        'Authorization': `Bearer ${GROK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Extract the summary from the Grok response
    if (response.data && 
        response.data.choices && 
        response.data.choices.length > 0 && 
        response.data.choices[0].message && 
        response.data.choices[0].message.content) {
      
      return response.data.choices[0].message.content;
    } else {
      throw new Error('Invalid response from Grok API');
    }
  } catch (error) {
    console.error('Grok API error:', error.response?.data || error.message);
    throw new Error(`Failed to call Grok API: ${error.message}`);
  }
}


module.exports = router;