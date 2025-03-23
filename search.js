// const express = require('express');
// const cors = require('cors');
// const fs = require('fs');
// PDF URL Scraper for FDA Drug Approval Package pages
// const cheerio = require('cheerio');
// const axios = require('axios');

// const path = require('path');

// // Initialize express app
// const app = express();
// const PORT = process.env.PORT || 3000;

// // In-memory data store
// let warningLetters = [];

// // Middleware
// app.use(cors({
//   origin: '*', // Allow all origins for development
//   methods: ['GET', 'POST', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization']
// }));
// app.use(express.json());

// // Load data from JSON file
// function loadData() {
//   try {
//     const dataPath = path.join(__dirname, 'warning_letters.json');
    
//     if (fs.existsSync(dataPath)) {
//       const jsonData = fs.readFileSync(dataPath, 'utf8');
//       warningLetters = JSON.parse(jsonData);
//       console.log(`Loaded ${warningLetters.length} warning letters from JSON file`);
//     } else {
//       console.log('Warning: warning_letters.json not found. Starting with empty dataset.');
//       warningLetters = [];
//     }
//   } catch (error) {
//     console.error('Error loading data:', error);
//     warningLetters = [];
//   }
// }

// // Format date consistently
// function formatDate(dateString) {
//   if (!dateString) return null;
  
//   try {
//     const date = new Date(dateString);
//     if (isNaN(date.getTime())) return dateString;
//     return date.toISOString().split('T')[0]; // YYYY-MM-DD
//   } catch (error) {
//     return dateString;
//   }
// }

// // Routes

// // GET /all - Returns all warning letters
// app.get('/all', (req, res) => {
//   // Default sort by postedDate descending
//   const sorted = [...warningLetters].sort((a, b) => {
//     const dateA = a.postedDate ? new Date(a.postedDate).getTime() : 0;
//     const dateB = b.postedDate ? new Date(b.postedDate).getTime() : 0;
//     return dateB - dateA;
//   });
  
//   res.json(sorted);
// });

// // GET /search - Search and filter warning letters
// app.get('/search', (req, res) => {
//   try {
//     const { query, days, dateFrom, dateTo, office, subject, hasResponse, hasCloseout, sort, direction } = req.query;
    
//     let results = [...warningLetters];
    
//     // Text search across multiple columns
//     if (query) {
//       const searchTerm = query.toLowerCase();
//       results = results.filter(letter => {
//         return (letter.companyName && letter.companyName.toLowerCase().includes(searchTerm)) ||
//                (letter.subject && letter.subject.toLowerCase().includes(searchTerm)) ||
//                (letter.issuingOffice && letter.issuingOffice.toLowerCase().includes(searchTerm));
//       });
//     }
    
//     // Date filter - days
//     if (days) {
//       const daysAgo = new Date();
//       daysAgo.setDate(daysAgo.getDate() - parseInt(days));
//       const daysAgoStr = daysAgo.toISOString().split('T')[0];
      
//       results = results.filter(letter => {
//         if (!letter.postedDate) return false;
//         // Handle different date formats
//         const letterDate = formatDate(letter.postedDate);
//         return letterDate && letterDate >= daysAgoStr;
//       });
//     }
    
//     // Date filter - custom range
//     if (dateFrom) {
//       results = results.filter(letter => {
//         if (!letter.postedDate) return false;
//         const letterDate = formatDate(letter.postedDate);
//         return letterDate && letterDate >= dateFrom;
//       });
//     }
    
//     if (dateTo) {
//       results = results.filter(letter => {
//         if (!letter.postedDate) return false;
//         const letterDate = formatDate(letter.postedDate);
//         return letterDate && letterDate <= dateTo;
//       });
//     }
    
//     // Office filter
//     if (office) {
//       results = results.filter(letter => {
//         return letter.issuingOffice && letter.issuingOffice.toLowerCase().includes(office.toLowerCase());
//       });
//     }
    
//     // Subject filter
//     if (subject) {
//       results = results.filter(letter => {
//         return letter.subject && letter.subject.toLowerCase().includes(subject.toLowerCase());
//       });
//     }
    
//     // Response/closeout filters
//     if (hasResponse === 'true') {
//       results = results.filter(letter => {
//         return letter.responseLetter && letter.responseLetter.trim() !== '';
//       });
//     }
    
//     if (hasCloseout === 'true') {
//       results = results.filter(letter => {
//         return letter.closeoutLetter && letter.closeoutLetter.trim() !== '';
//       });
//     }
    
//     // Sorting
//     if (sort) {
//       const sortDir = direction === 'asc' ? 1 : -1;
      
//       results.sort((a, b) => {
//         const valA = a[sort] || '';
//         const valB = b[sort] || '';
        
//         // Special handling for dates
//         if (sort === 'postedDate' || sort === 'letterIssueDate') {
//           const dateA = valA ? new Date(valA).getTime() : 0;
//           const dateB = valB ? new Date(valB).getTime() : 0;
//           return sortDir * (dateA - dateB);
//         }
        
//         // Default string comparison
//         return sortDir * valA.toString().localeCompare(valB.toString());
//       });
//     } else {
//       // Default sort by postedDate descending
//       results.sort((a, b) => {
//         const dateA = a.postedDate ? new Date(a.postedDate).getTime() : 0;
//         const dateB = b.postedDate ? new Date(b.postedDate).getTime() : 0;
//         return dateB - dateA;
//       });
//     }
    
//     res.json(results);
//   } catch (err) {
//     console.error('Search error:', err);
//     res.status(500).json({ error: 'Search error', details: err.message });
//   }
// });

// // GET /search-terms - Get unique terms for autocomplete
// app.get('/search-terms', (req, res) => {
//   try {
//     const terms = new Set();
    
//     // Get company names
//     warningLetters.forEach(letter => {
//       if (letter.companyName && letter.companyName.trim() !== '') {
//         terms.add(letter.companyName);
//       }
//     });
    
//     // Get issuing offices
//     warningLetters.forEach(letter => {
//       if (letter.issuingOffice && letter.issuingOffice.trim() !== '') {
//         terms.add(letter.issuingOffice);
//       }
//     });
    
//     // Extract common words from subjects
//     const subjectTexts = warningLetters
//       .map(letter => letter.subject)
//       .filter(subject => subject && subject.trim() !== '');
    
//     const commonTerms = extractCommonTerms(subjectTexts);
//     commonTerms.forEach(term => terms.add(term));
    
//     res.json(Array.from(terms));
//   } catch (err) {
//     console.error('Error getting search terms:', err);
//     res.status(500).json({ error: 'Error getting search terms', details: err.message });
//   }
// });

// // Helper function to extract common terms from text
// function extractCommonTerms(texts) {
//   const termCounts = {};
//   const stopWords = new Set(['and', 'or', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'of']);
  
//   texts.forEach(text => {
//     if (!text) return;
    
//     // Split by common separators and filter out short or common words
//     const words = text.split(/[\s,\/\(\)]+/)
//       .map(word => word.toLowerCase().trim())
//       .filter(word => word.length > 3 && !stopWords.has(word));
    
//     // Count occurrences
//     words.forEach(word => {
//       termCounts[word] = (termCounts[word] || 0) + 1;
//     });
//   });
  
//   // Return terms that appear multiple times
//   return Object.entries(termCounts)
//     .filter(([_, count]) => count > 2)
//     .map(([term, _]) => term);
// }

// // GET /stats - Get statistics about the warning letters
// app.get('/stats', (req, res) => {
//   try {
//     const stats = {};
    
//     // Total count
//     stats.totalLetters = warningLetters.length;
    
//     // Count by year
//     const yearCounts = {};
//     warningLetters.forEach(letter => {
//       if (letter.postedDate) {
//         // Handle different date formats
//         const dateStr = formatDate(letter.postedDate);
//         if (dateStr) {
//           const year = dateStr.substring(0, 4);
//           yearCounts[year] = (yearCounts[year] || 0) + 1;
//         }
//       }
//     });
    
//     stats.lettersByYear = Object.entries(yearCounts)
//       .map(([year, count]) => ({ year, count }))
//       .sort((a, b) => b.year - a.year);
    
//     // Count by issuing office
//     const officeCounts = {};
//     warningLetters.forEach(letter => {
//       if (letter.issuingOffice) {
//         officeCounts[letter.issuingOffice] = (officeCounts[letter.issuingOffice] || 0) + 1;
//       }
//     });
    
//     stats.lettersByOffice = Object.entries(officeCounts)
//       .map(([issuingOffice, count]) => ({ issuingOffice, count }))
//       .sort((a, b) => b.count - a.count);
    
//     // Count letters with response or closeout
//     stats.lettersWithResponse = warningLetters.filter(letter => 
//       letter.responseLetter && letter.responseLetter.trim() !== ''
//     ).length;
    
//     stats.lettersWithCloseout = warningLetters.filter(letter => 
//       letter.closeoutLetter && letter.closeoutLetter.trim() !== ''
//     ).length;
    
//     res.json(stats);
//   } catch (err) {
//     console.error('Error getting statistics:', err);
//     res.status(500).json({ error: 'Error getting statistics', details: err.message });
//   }
// });

// // GET /letter/:id - Get a specific letter by ID
// app.get('/letter/:id', (req, res) => {
//   try {
//     const { id } = req.params;
//     const letter = warningLetters.find(l => l.id === parseInt(id));
    
//     if (!letter) {
//       return res.status(404).json({ error: 'Letter not found' });
//     }
    
//     res.json(letter);
//   } catch (err) {
//     console.error('Error getting letter:', err);
//     res.status(500).json({ error: 'Error getting letter', details: err.message });
//   }
// });

// // Serve static files from the 'public' directory for the frontend
// app.use(express.static('public'));

// // Serve the frontend for any other route (SPA support)
// app.get('*', (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'index.html'));
// });

// // Start the server
// function startServer() {
//   try {
//     // Load data from JSON file
//     loadData();
    
//     app.listen(PORT, () => {
//       console.log(`Server running on http://localhost:${PORT}`);
//     });
//   } catch (err) {
//     console.error('Failed to start server:', err);
//   }
// }




// Enhanced PDF URL Scraper for FDA Drug Approval Package pages
const cheerio = require('cheerio');
const axios = require('axios');

/**
 * Scrapes PDF URLs from an FDA Drug Approval Package page
 * @param {string} url - The URL of the FDA page to scrape
 * @return {Promise<Array>} - Array of PDF URLs found in the page
 */
async function scrapePdfUrls(url) {
  try {
    // Fetch the HTML content
    const response = await axios.get(url);
    const html = response.data;
    
    // Load HTML into cheerio
    const $ = cheerio.load(html);
    
    // Find all <a> elements with href attributes ending in .pdf
    const pdfUrls = [];
    
    // Get the base URL to construct absolute URLs
    const baseUrl = new URL(url).origin;
    const currentPath = new URL(url).pathname.split('/').slice(0, -1).join('/');
    
    // Find all links to PDFs (handles both old and new FDA page formats)
    $('a[href$=".pdf"]').each((index, element) => {
      const relativeUrl = $(element).attr('href');
      const title = $(element).text().trim();
      
      // Skip if empty or doesn't end with PDF (redundant check but for safety)
      if (!relativeUrl || !relativeUrl.toLowerCase().endsWith('.pdf')) {
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
      
      // Add to our results
      pdfUrls.push({
        title: title,
        url: absoluteUrl,
        category: category
      });
    });
    
    return pdfUrls;
  } catch (error) {
    console.error('Error scraping PDF URLs:', error);
    throw error;
  }
}

/**
 * Formats the PDF links in a more readable structure
 * @param {Array} pdfLinks - Array of PDF link objects
 * @return {Object} - Object with categories as keys and arrays of links as values
 */
function formatPdfLinks(pdfLinks) {
  const categorized = {};
  
  pdfLinks.forEach(link => {
    // Use 'Uncategorized' if no category found
    const category = link.category || 'Uncategorized';
    
    if (!categorized[category]) {
      categorized[category] = [];
    }
    
    categorized[category].push({
      title: link.title,
      url: link.url
    });
  });
  
  return categorized;
}

/**
 * Main function to scrape and display PDF links
 * @param {string} url - URL of the FDA page to scrape
 */
async function scrapeFdaPdfs(url) {
  try {
    console.log(`Scraping PDF links from: ${url}`);
    const pdfLinks = await scrapePdfUrls(url);
    
    if (pdfLinks.length === 0) {
      console.log('No PDF links found on the page.');
      return;
    }
    
    console.log(`Found ${pdfLinks.length} PDF links:`);
    
    // Display by category if available
    const categorized = formatPdfLinks(pdfLinks);
    
    for (const [category, links] of Object.entries(categorized)) {
      console.log(`\n== ${category} ==`);
      links.forEach((link, index) => {
        console.log(`${index + 1}. ${link.title}`);
        console.log(`   URL: ${link.url}`);
      });
    }
    
    return pdfLinks;
  } catch (error) {
    console.error('Failed to scrape PDF URLs:', error);
    throw error;
  }
}

// Example usage
async function main() {
  // Replace with your FDA Drug Approval Package URL
  const targetUrl = 'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2020/211733Orig1s000TOC.cfm';
  
  await scrapeFdaPdfs(targetUrl);
}

// Run the scraper if executed directly
// if (require.main === module) {
  main();
// }

// Export for use in other modules
// module.exports = { scrapePdfUrls, formatPdfLinks, scrapeFdaPdfs };


// startServer();