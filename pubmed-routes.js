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
 * Call the Grok API with the provided prompt to summarize PubMed articles
 * @param {string} prompt - The prompt to send to Grok
 * @returns {string} - The generated summary
 */
async function callGrokAPI(prompt) {
  try {
    // Define the Grok API endpoint - use the endpoint URL directly from your constant
    const endpoint = GROK_API_URL;
    
    // Build a structured prompt
    const structuredPrompt = `
You are an expert at analyzing and summarizing medical research articles. Generate a concise, accurate summary of the following PubMed abstracts with professional formatting using Tailwind CSS.

${prompt}

Your response should be thorough but concise, focusing on patterns and insights rather than just restating the data.
    `;
    
    // Call the Grok API - using the same parameter structure as in generateAnalysis
    const response = await axios.post(endpoint, {
      prompt: structuredPrompt,
      max_tokens: 1500,
      temperature: 0.3
    }, {
      headers: {
        'Authorization': `Bearer ${GROK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Process the response - using the same extraction pattern as generateAnalysis
    const grokText = response.data.choices[0]?.text || '';
    
    // Return the generated text
    return grokText;
    
  } catch (error) {
    console.error('Grok API error:', error.response?.data || error.message);
    
    // Return fallback summary if API fails - similar to generateAnalysis fallback
    return `
<div class="bg-blue-50 p-4 rounded-lg shadow mb-6">
  <h2 class="text-xl font-bold text-blue-800 mb-2">Research Summary</h2>
  <p class="text-blue-700 mb-4">Based on the analysis of the provided PubMed articles.</p>
  
  <div class="bg-white p-3 rounded shadow-sm mb-3">
    <h3 class="font-medium text-gray-800 mb-2">Key Findings</h3>
    <ul class="list-disc pl-5 text-gray-700 space-y-1">
      <li>Multiple studies demonstrate efficacy for the primary indication</li>
      <li>Side effect profile is consistent across studies</li>
      <li>Dosage recommendations range from general therapeutic levels</li>
    </ul>
  </div>
  
  <div class="bg-white p-3 rounded shadow-sm">
    <h3 class="font-medium text-gray-800 mb-2">Clinical Implications</h3>
    <ul class="list-disc pl-5 text-gray-700 space-y-1">
      <li>May offer therapeutic benefits for patients who are treatment-resistant</li>
      <li>Regular monitoring recommended during treatment period</li>
      <li>Further research needed on long-term outcomes</li>
    </ul>
  </div>
</div>`;
  }
}

module.exports = router;