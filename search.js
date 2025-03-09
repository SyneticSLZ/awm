const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database connection
let db;

async function initDatabase() {
    try {
      // Open the database
      db = await open({
        filename: path.join(__dirname, 'warning_letters.db'),
        driver: sqlite3.Database
      });
      console.log('Connected to the SQLite database.');
    } catch (error) {
      console.error('Database connection error:', error);
      process.exit(1); // Exit if we can't connect to the database
    }
  }

// Helper function to format dates consistently
function formatDate(dateString) {
  if (!dateString) return null;
  
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString; // If not a valid date, return as is
    
    return date.toISOString().split('T')[0]; // Format as YYYY-MM-DD
  } catch (error) {
    return dateString;
  }
}

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

// Routes

// GET /all - Returns all warning letters
app.get('/all', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM warning_letters ORDER BY postedDate DESC');
    res.json(rows);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// GET /search - Search and filter warning letters
app.get('/search', async (req, res) => {
  try {
    const { query, days, dateFrom, dateTo, office, subject, hasResponse, hasCloseout } = req.query;
    
    let sql = 'SELECT * FROM warning_letters WHERE 1=1';
    const params = [];
    
    // Text search across multiple columns
    if (query) {
      sql += ' AND (companyName LIKE ? OR subject LIKE ? OR issuingOffice LIKE ?)';
      const searchTerm = `%${query}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }
    
    // Date filter - days
    if (days) {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(days));
      sql += ' AND date(postedDate) >= date(?)';
      params.push(daysAgo.toISOString().split('T')[0]);
    }
    
    // Date filter - custom range
    if (dateFrom) {
      sql += ' AND date(postedDate) >= date(?)';
      params.push(dateFrom);
    }
    
    if (dateTo) {
      sql += ' AND date(postedDate) <= date(?)';
      params.push(dateTo);
    }
    
    // Office filter
    if (office) {
      sql += ' AND issuingOffice LIKE ?';
      params.push(`%${office}%`);
    }
    
    // Subject filter
    if (subject) {
      sql += ' AND subject LIKE ?';
      params.push(`%${subject}%`);
    }
    
    // Response/closeout filters
    if (hasResponse === 'true') {
      sql += " AND responseLetter IS NOT NULL AND responseLetter != ''";
    }
    
    if (hasCloseout === 'true') {
      sql += " AND closeoutLetter IS NOT NULL AND closeoutLetter != ''";
    }
    
    sql += ' ORDER BY postedDate DESC';
    
    const rows = await db.all(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search error', details: err.message });
  }
});

// GET /search-terms - Get unique terms for autocomplete
app.get('/search-terms', async (req, res) => {
  try {
    const terms = new Set();
    
    // Get company names
    const companyRows = await db.all(
      "SELECT DISTINCT companyName FROM warning_letters WHERE companyName IS NOT NULL AND companyName != ''"
    );
    companyRows.forEach(row => terms.add(row.companyName));
    
    // Get issuing offices
    const officeRows = await db.all(
      "SELECT DISTINCT issuingOffice FROM warning_letters WHERE issuingOffice IS NOT NULL AND issuingOffice != ''"
    );
    officeRows.forEach(row => terms.add(row.issuingOffice));
    
    // Get common words from subjects
    const subjectRows = await db.all(
      "SELECT subject FROM warning_letters WHERE subject IS NOT NULL AND subject != ''"
    );
    
    // Extract common terms from subjects
    const commonTerms = extractCommonTerms(subjectRows.map(row => row.subject));
    commonTerms.forEach(term => terms.add(term));
    
    res.json(Array.from(terms));
  } catch (err) {
    console.error('Error getting search terms:', err);
    res.status(500).json({ error: 'Error getting search terms', details: err.message });
  }
});

// GET /stats - Get statistics about the warning letters
app.get('/stats', async (req, res) => {
  try {
    const stats = {};
    
    // Total count
    const countResult = await db.get('SELECT COUNT(*) as total FROM warning_letters');
    stats.totalLetters = countResult.total;
    
    // Count by year
    const yearCounts = await db.all(`
      SELECT 
        strftime('%Y', postedDate) as year, 
        COUNT(*) as count 
      FROM warning_letters 
      WHERE postedDate IS NOT NULL 
      GROUP BY year 
      ORDER BY year DESC
    `);
    stats.lettersByYear = yearCounts;
    
    // Count by issuing office
    const officeCounts = await db.all(`
      SELECT 
        issuingOffice, 
        COUNT(*) as count 
      FROM warning_letters 
      WHERE issuingOffice IS NOT NULL 
      GROUP BY issuingOffice 
      ORDER BY count DESC
    `);
    stats.lettersByOffice = officeCounts;
    
    // Count letters with response or closeout
    const responseResult = await db.get(
      "SELECT COUNT(*) as count FROM warning_letters WHERE responseLetter IS NOT NULL AND responseLetter != ''"
    );
    stats.lettersWithResponse = responseResult.count;
    
    const closeoutResult = await db.get(
      "SELECT COUNT(*) as count FROM warning_letters WHERE closeoutLetter IS NOT NULL AND closeoutLetter != ''"
    );
    stats.lettersWithCloseout = closeoutResult.count;
    
    res.json(stats);
  } catch (err) {
    console.error('Error getting statistics:', err);
    res.status(500).json({ error: 'Error getting statistics', details: err.message });
  }
});

// GET /letter/:id - Get a specific letter by ID
app.get('/letter/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const letter = await db.get('SELECT * FROM warning_letters WHERE id = ?', [id]);
    
    if (!letter) {
      return res.status(404).json({ error: 'Letter not found' });
    }
    
    res.json(letter);
  } catch (err) {
    console.error('Error getting letter:', err);
    res.status(500).json({ error: 'Error getting letter', details: err.message });
  }
});

// Start the server
async function startServer() {
  try {
    await initDatabase();
    
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
  }
}

startServer();