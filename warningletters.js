const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Load warning letters data
let warningLetters = [];
try {
  const wdata = fs.readFileSync(path.join(__dirname, 'output/wl.json'), 'utf8');
  warningLetters = JSON.parse(wdata);
  console.log(`Loaded ${warningLetters.length} warning letters from file.`);
} catch (error) {
  console.error('Error loading warning letters data:', error);
  process.exit(1);
}

// API Routes

// Get statistics about the warning letters
app.get('/api/stats', (req, res) => {
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
app.get('/api/search', (req, res) => {
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
app.get('/api/letter/:id', (req, res) => {
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
app.post('/api/advanced-search', (req, res) => {
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
app.get('/api/issuing-offices', (req, res) => {
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

// Start the server
app.listen(PORT, () => {
  console.log(`FDA Warning Letters API server running on port ${PORT}`);
});