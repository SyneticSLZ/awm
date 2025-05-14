const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const port = 3001;

// Enable CORS
app.use(cors());
app.use(express.json());

// Semantic Scholar API
const SEMANTIC_SCHOLAR_API = 'https://api.semanticscholar.org/graph/v1/paper/search';
// Grok API (hypothetical)
const GROK_API_KEY = 'YOUR_GROK_API_KEY';
const GROK_API_URL = 'https://api.x.ai/grok/summarize';

// Search endpoint
app.get('/search', async (req, res) => {
  try {
    const query = req.query.q || 'TEG 6S neonatal premature baby';
    console.log('Querying Semantic Scholar with:', query);

    const response = await axios.get(SEMANTIC_SCHOLAR_API, {
      params: {
        query: query,
        fields: 'title,authors,year,abstract,url,venue,publicationDate',
        publicationDateOrYear: '2019:',
        limit: 20
      },
      timeout: 10000
    });

    console.log('Semantic Scholar response:', JSON.stringify(response.data, null, 2));

    if (!response.data.data || !Array.isArray(response.data.data)) {
      console.warn('No papers found or invalid response structure');
      return res.json({ papers: [], message: 'No papers found for the query' });
    }

    const papers = response.data.data.map(paper => ({
      title: paper.title || 'No title available',
      authors: paper.authors ? paper.authors.map(a => a.name).join(', ') : 'Unknown',
      year: paper.year || 'Unknown',
      abstract: paper.abstract || 'No abstract available',
      url: paper.url || '#',
      venue: paper.venue || 'Unknown',
      publicationDate: paper.publicationDate || 'Unknown'
    }));

    res.json({ papers, total: response.data.total || 0 });
  } catch (error) {
    console.error('Error fetching from Semantic Scholar:', error.message);
    if (error.response) {
      console.error('API response:', error.response.data);
    }
    res.status(500).json({ error: 'Failed to fetch papers', details: error.message });
  }
});

// Summarize endpoint
app.post('/summarize', async (req, res) => {
  try {
    const { abstracts } = req.body;
    if (!Array.isArray(abstracts)) {
      return res.status(400).json({ error: 'Abstracts must be an array' });
    }

    const summaries = [];
    for (const abstract of abstracts) {
      if (!abstract || abstract === 'No abstract available') {
        summaries.push('No summary available');
        continue;
      }
      try {
        const response = await axios.post(GROK_API_URL, {
          text: abstract,
          max_length: 100,
          min_length: 30
        }, {
          headers: { Authorization: `Bearer ${GROK_API_KEY}` }
        });
        summaries.push(response.data.summary || 'Failed to summarize');
      } catch (err) {
        summaries.push('Failed to summarize: ' + err.message);
      }
    }
    res.json({ summaries });
  } catch (error) {
    console.error('Error summarizing abstracts:', error.message);
    res.status(500).json({ error: 'Failed to summarize', details: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});