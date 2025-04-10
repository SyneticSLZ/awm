// pubmed.js - Backend API handler for PubMed search requests
const fetch = require('node-fetch');
const xml2js = require('xml2js');

/**
 * Handles PubMed API search requests and returns formatted results
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handlePubMedSearch(req, res) {
  try {
    // Extract query parameters
    const {
      term = '',
      page = 1,
      sortBy = 'relevance',
      fullTextOnly = false,
      yearFilter = '',
      journalFilter = ''
    } = req.query;

    // Base URL for PubMed E-utilities
    const baseUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
    
    // Your NCBI API key
    const apiKey = process.env.NCBI_API_KEY || ''; // Set this in your environment variables
    
    // Calculate pagination parameters
    const retmax = 20; // Results per page
    const retstart = (page - 1) * retmax;
    
    // Build the search query with any additional filters
    let searchQuery = term;
    
    // Add year filter if provided
    if (yearFilter) {
      searchQuery += ` AND ${yearFilter}[pdat]`;
    }
    
    // Add journal filter if provided
    if (journalFilter) {
      searchQuery += ` AND "${journalFilter}"[journal]`;
    }
    
    // Add full text filter if requested
    if (fullTextOnly === 'true' || fullTextOnly === true) {
      searchQuery += ' AND free full text[filter]';
    }
    
    // Build sort parameter
    let sortParam = '';
    switch (sortBy) {
      case 'date':
        sortParam = 'pub date';
        break;
      case 'relevance':
      default:
        sortParam = 'relevance';
        break;
    }
    
    // Step 1: Search PubMed to get IDs
    const searchUrl = `${baseUrl}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(searchQuery)}&retmax=${retmax}&retstart=${retstart}&sort=${encodeURIComponent(sortParam)}&usehistory=y${apiKey ? `&api_key=${apiKey}` : ''}`;
    
    console.log(`PubMed Search URL: ${searchUrl}`);
    
    const searchResponse = await fetch(searchUrl);
    
    if (!searchResponse.ok) {
      throw new Error(`PubMed search API responded with status: ${searchResponse.status}`);
    }
    
    const searchData = await searchResponse.text();
    const parser = new xml2js.Parser({ explicitArray: false });
    const searchResult = await parser.parseStringPromise(searchData);
    
    if (!searchResult.eSearchResult || !searchResult.eSearchResult.IdList) {
      return res.json({ articles: [], totalResults: 0 });
    }
    
    // Extract article IDs and count
    const totalResults = parseInt(searchResult.eSearchResult.Count, 10) || 0;
    let ids = [];
    
    // Handle different formats of IdList
    if (searchResult.eSearchResult.IdList.Id) {
      if (Array.isArray(searchResult.eSearchResult.IdList.Id)) {
        ids = searchResult.eSearchResult.IdList.Id;
      } else {
        ids = [searchResult.eSearchResult.IdList.Id];
      }
    }
    
    if (ids.length === 0) {
      return res.json({ articles: [], totalResults });
    }
    
    // Step 2: Fetch full article data using the IDs
    const fetchUrl = `${baseUrl}/efetch.fcgi?db=pubmed&id=${ids.join(',')}&retmode=xml${apiKey ? `&api_key=${apiKey}` : ''}`;
    
    const fetchResponse = await fetch(fetchUrl);
    
    if (!fetchResponse.ok) {
      throw new Error(`PubMed fetch API responded with status: ${fetchResponse.status}`);
    }
    
    const fetchData = await fetchResponse.text();
    const fetchResult = await parser.parseStringPromise(fetchData);
    
    if (!fetchResult.PubmedArticleSet || !fetchResult.PubmedArticleSet.PubmedArticle) {
      return res.json({ articles: [], totalResults });
    }
    
    // Ensure PubmedArticle is always an array
    const pubmedArticles = Array.isArray(fetchResult.PubmedArticleSet.PubmedArticle) 
      ? fetchResult.PubmedArticleSet.PubmedArticle 
      : [fetchResult.PubmedArticleSet.PubmedArticle];
    
    // Transform the PubMed articles to the format expected by the frontend
    const articles = pubmedArticles.map(article => {
      // Extract basic article information
      const medlineCitation = article.MedlineCitation;
      const pmid = medlineCitation.PMID ? medlineCitation.PMID._ || medlineCitation.PMID : '';
      const articleData = medlineCitation.Article;
      
      if (!articleData) {
        return null;
      }
      
      // Extract title
      const title = articleData.ArticleTitle ? 
        (typeof articleData.ArticleTitle === 'string' ? articleData.ArticleTitle : articleData.ArticleTitle._) : 
        'No title available';
      
      // Extract journal information
      const journal = articleData.Journal ? 
        (articleData.Journal.Title || 'Journal not specified') : 
        'Journal not specified';
      
      // Extract publication date
      let pubDate = '';
      if (articleData.Journal && articleData.Journal.JournalIssue && articleData.Journal.JournalIssue.PubDate) {
        const pubDateObj = articleData.Journal.JournalIssue.PubDate;
        if (pubDateObj.Year) {
          pubDate = pubDateObj.Year;
          if (pubDateObj.Month) {
            pubDate = `${pubDateObj.Month} ${pubDate}`;
            if (pubDateObj.Day) {
              pubDate = `${pubDateObj.Day} ${pubDate}`;
            }
          }
        } else if (pubDateObj.MedlineDate) {
          pubDate = pubDateObj.MedlineDate;
        }
      }
      
      // Extract authors
      let authors = [];
      if (articleData.AuthorList && articleData.AuthorList.Author) {
        const authorList = Array.isArray(articleData.AuthorList.Author) ? 
          articleData.AuthorList.Author : 
          [articleData.AuthorList.Author];
        
        authors = authorList.map(author => {
          if (author.LastName && author.ForeName) {
            return `${author.LastName} ${author.ForeName.charAt(0)}`;
          } else if (author.LastName) {
            return author.LastName;
          } else if (author.CollectiveName) {
            return author.CollectiveName;
          }
          return '';
        }).filter(Boolean);
      }
      
      // Extract abstract
      let abstract = '';
      if (articleData.Abstract && articleData.Abstract.AbstractText) {
        if (Array.isArray(articleData.Abstract.AbstractText)) {
          abstract = articleData.Abstract.AbstractText.map(text => {
            if (typeof text === 'string') return text;
            return text._ || '';
          }).join(' ');
        } else if (typeof articleData.Abstract.AbstractText === 'string') {
          abstract = articleData.Abstract.AbstractText;
        } else if (articleData.Abstract.AbstractText._) {
          abstract = articleData.Abstract.AbstractText._;
        }
      }
      
      // Extract keywords
      let keywords = [];
      if (medlineCitation.KeywordList && medlineCitation.KeywordList.Keyword) {
        keywords = Array.isArray(medlineCitation.KeywordList.Keyword) ? 
          medlineCitation.KeywordList.Keyword.map(k => typeof k === 'string' ? k : k._) : 
          [typeof medlineCitation.KeywordList.Keyword === 'string' ? 
            medlineCitation.KeywordList.Keyword : 
            medlineCitation.KeywordList.Keyword._];
      }
      
      // Extract MeSH terms
      let meshTerms = [];
      if (medlineCitation.MeshHeadingList && medlineCitation.MeshHeadingList.MeshHeading) {
        const meshHeadings = Array.isArray(medlineCitation.MeshHeadingList.MeshHeading) ? 
          medlineCitation.MeshHeadingList.MeshHeading : 
          [medlineCitation.MeshHeadingList.MeshHeading];
        
        meshTerms = meshHeadings.map(heading => {
          if (heading.DescriptorName) {
            return typeof heading.DescriptorName === 'string' ? 
              heading.DescriptorName : 
              heading.DescriptorName._ || '';
          }
          return '';
        }).filter(Boolean);
      }
      
      // Extract DOI
      let doi = '';
      if (articleData.ELocationID) {
        const elocations = Array.isArray(articleData.ELocationID) ? 
          articleData.ELocationID : 
          [articleData.ELocationID];
        
        const doiLocation = elocations.find(loc => 
          loc.$ && loc.$.EIdType === 'doi'
        );
        
        if (doiLocation) {
          doi = doiLocation._ || doiLocation;
        }
      }
      
      // Check for full text availability
      let fullTextUrl = '';
      if (article.PubmedData && article.PubmedData.ArticleIdList && article.PubmedData.ArticleIdList.ArticleId) {
        const articleIds = Array.isArray(article.PubmedData.ArticleIdList.ArticleId) ? 
          article.PubmedData.ArticleIdList.ArticleId : 
          [article.PubmedData.ArticleIdList.ArticleId];
        
        const pmcId = articleIds.find(id => id.$ && id.$.IdType === 'pmc');
        if (pmcId) {
          fullTextUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcId._}/`;
        }
      }
      
      // Format the article according to the frontend's expected structure
      return {
        pmid,
        title,
        authors,
        journal,
        pubDate,
        abstract: abstract || 'No abstract available',
        keywords,
        meshTerms,
        doi,
        fullTextUrl
      };
    }).filter(Boolean); // Remove any null entries
    
    // Return the formatted data
    res.json({
      articles,
      totalResults
    });
    
  } catch (error) {
    console.error('PubMed API error:', error);
    res.status(500).json({ 
      error: 'Error fetching data from PubMed',
      message: error.message
    });
  }
}

module.exports = {
  handlePubMedSearch
};