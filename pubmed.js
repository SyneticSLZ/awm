// // pubmed.js - Backend API handler for PubMed search requests
// pubmed.js - Backend API handler for PubMed search requests
const fetch = require('node-fetch');
const xml2js = require('xml2js');

/**
 * Handles PubMed API search requests and returns formatted results
 * Uses getRelatedDrugs if initial search yields no results
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
      journalFilter = '',
      expandSearch = true // Parameter to control whether to try related drugs
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
    
    // Perform the initial search
    const result = await performPubMedSearch(baseUrl, searchQuery, retmax, retstart, sortParam, apiKey);
    
    // If we found results, return them
    if (result.totalResults > 0) {
      return res.json({
        ...result,
        searchExpanded: false,
        originalTerm: term
      });
    }
    
    // If no results found and expandSearch is enabled, try with related drug names
    if (expandSearch) {
      console.log(`No PubMed results found for "${term}". Trying related drug names...`);
      
      try {
        // Get related drug names
        const relatedDrugs = await getRelatedDrugs(term);
        console.log(`Found ${relatedDrugs.length} related drugs for "${term}"`);
        
        if (relatedDrugs.length === 0) {
          return res.json({ 
            articles: [], 
            totalResults: 0, 
            searchExpanded: false,
            originalTerm: term
          });
        }
        
        // Collect all unique articles from all related drugs
        const allArticles = new Map(); // Using Map to deduplicate by PMID
        const drugResultCounts = {}; // Track which drugs returned results
        const usedDrugs = []; // Track which drugs we've searched
        
        // First try a combined search with up to 10 related drugs
        // This is more efficient than individual searches
        const batchSize = 10;
        for (let i = 0; i < relatedDrugs.length; i += batchSize) {
          const drugBatch = relatedDrugs.slice(i, i + batchSize);
          const batchQuery = drugBatch.map(drug => `"${drug}"`).join(' OR ');
          usedDrugs.push(...drugBatch);
          
          console.log(`Batch searching PubMed with drugs: ${drugBatch.join(', ')}`);
          const batchResults = await performPubMedSearch(baseUrl, batchQuery, 100, 0, sortParam, apiKey);
          
          // Add unique articles to our collection
          if (batchResults.articles && batchResults.articles.length > 0) {
            drugResultCounts[`batch_${i/batchSize + 1}`] = batchResults.articles.length;
            
            batchResults.articles.forEach(article => {
              if (!allArticles.has(article.pmid)) {
                allArticles.set(article.pmid, article);
              }
            });
          }
          
          // Add delay to respect API rate limits
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Process individual drugs for more specific attribution
        for (const drug of relatedDrugs) {
          if (!usedDrugs.includes(drug)) {
            console.log(`Individually searching PubMed for drug: ${drug}`);
            const drugResult = await performPubMedSearch(baseUrl, `"${drug}"`, 100, 0, sortParam, apiKey);
            
            if (drugResult.articles && drugResult.articles.length > 0) {
              drugResultCounts[drug] = drugResult.articles.length;
              
              drugResult.articles.forEach(article => {
                if (!allArticles.has(article.pmid)) {
                  allArticles.set(article.pmid, article);
                }
              });
            }
            
            // Add delay to respect API rate limits
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        
        // Convert Map to Array for response
        const combinedArticles = Array.from(allArticles.values());
        
        // Apply pagination to the combined results
        const paginatedArticles = combinedArticles.slice(retstart, retstart + retmax);
        
        // Return the expanded results with metadata about the expansion
        return res.json({
          articles: paginatedArticles,
          totalResults: combinedArticles.length,
          searchExpanded: true,
          originalTerm: term,
          expandedWithDrugs: relatedDrugs,
          drugResultCounts: drugResultCounts,
          pagination: {
            page: parseInt(page),
            totalPages: Math.ceil(combinedArticles.length / retmax),
            perPage: retmax,
            totalItems: combinedArticles.length
          }
        });
      } catch (error) {
        console.error('Error getting related drugs:', error);
        // If the related drugs search fails, return the original empty results
        return res.json({ 
          articles: [], 
          totalResults: 0, 
          searchExpanded: false, 
          originalTerm: term,
          error: error.message 
        });
      }
    }
    
    // If expandSearch is disabled or there are no related drugs, return empty results
    return res.json({ 
      articles: [], 
      totalResults: 0, 
      searchExpanded: false,
      originalTerm: term
    });
    
  } catch (error) {
    console.error('PubMed API error:', error);
    res.status(500).json({ 
      error: 'Error fetching data from PubMed',
      message: error.message
    });
  }
}

/**
 * Helper function to perform a PubMed search and format the results
 * @param {string} baseUrl - Base URL for the PubMed E-utilities
 * @param {string} searchQuery - The query to search for
 * @param {number} retmax - Maximum number of results to return
 * @param {number} retstart - Starting index for results
 * @param {string} sortParam - How to sort the results
 * @param {string} apiKey - NCBI API key
 * @returns {Object} Formatted search results
 */
async function performPubMedSearch(baseUrl, searchQuery, retmax, retstart, sortParam, apiKey) {
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
    return { articles: [], totalResults: 0 };
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
    return { articles: [], totalResults };
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
    return { articles: [], totalResults };
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
  return {
    articles,
    totalResults
  };
}


/**
 * Function to get related drugs for a given drug name using multiple pharmaceutical databases
 * @param {string} drugName - The name of the drug to find related drugs for
 * @returns {Promise<string[]>} - Array of related drug names
 */
async function getRelatedDrugs(drugName) {
  try {
    console.log(`Getting related drugs for: ${drugName}`);
    
    // Object to store all results from various drug databases
    const results = {
      originalQuery: drugName,
      sources: {
        rxnorm: { names: [], links: [] },
        fda: { names: [], links: [] },
        pubchem: { names: [], links: [] }
      }
    };

    // Execute searches individually to prevent a failure in one from stopping the others
    try {
      await searchRxNorm(drugName, results);
      console.log(`RxNorm search completed with ${results.sources.rxnorm.names.length} names`);
    } catch (rxError) {
      console.error('RxNorm search failed:', rxError.message);
      results.sources.rxnorm.names.push({
        name: "Error searching RxNorm database",
        type: "Error"
      });
    }
    
    try {
      await searchFDA(drugName, results);
      console.log(`FDA search completed with ${results.sources.fda.names.length} names`);
    } catch (fdaError) {
      console.error('FDA search failed:', fdaError.message);
      results.sources.fda.names.push({
        name: "Error searching FDA database",
        type: "Error"
      });
    }
    
    try {
      await searchPubChem(drugName, results);
      console.log(`PubChem search completed with ${results.sources.pubchem.names.length} names`);
    } catch (pubchemError) {
      console.error('PubChem search failed:', pubchemError.message);
      results.sources.pubchem.names.push({
        name: "Error searching PubChem database",
        type: "Error"
      });
    }
    
    // Extract all the unique drug names from the search results
    const allNames = new Set();
    
    for (const [sourceName, sourceData] of Object.entries(results.sources)) {
      if (sourceData.names && sourceData.names.length > 0) {
        for (const nameObj of sourceData.names) {
          // Skip error and info messages
          if (nameObj.type === 'Error' || nameObj.type === 'Info' || 
              !nameObj.name || typeof nameObj.name !== 'string') {
            continue;
          }
          
          // Skip very short names (likely not useful for searches)
          if (nameObj.name.trim().length < 3) {
            continue;
          }
          
          // Add to the unique set
          allNames.add(nameObj.name);
        }
      }
    }
    
    // Convert the Set to Array and remove the original drug name
    let relatedDrugs = Array.from(allNames).filter(name => 
      name.toLowerCase() !== drugName.toLowerCase()
    );
    
    // // Filter out problematic drug names that are likely to cause errors
    // relatedDrugs = relatedDrugs.filter(name => {
    //   // Skip chemical structure identifiers, too complex for search
    //   if (name.includes('-') && /\d/.test(name) && name.length > 10) {
    //     return false;
    //   }
      
    //   // Skip CAS registry numbers and similar identifiers
    //   if (/^\d+-\d+-\d+$/.test(name)) {
    //     return false;
    //   }
      
    //   // Skip SMILES strings or other complex chemical notations
    //   if (name.includes('(') && name.includes(')') && name.length > 30) {
    //     return false;
    //   }
      
    //   // Skip chemical formula-like strings with numbers and brackets
    //   if (/^[A-Z0-9\(\)\[\]\{\}]+$/.test(name) && /\d/.test(name)) {
    //     return false;
    //   }
      
    //   // Skip database IDs
    //   if (/^[A-Z]+\d+$/.test(name) || /^[A-Z]+-\d+$/.test(name)) {
    //     return false;
    //   }
      
    //   // Skip long, complex names that are likely full IUPAC names
    //   if (name.length > 50) {
    //     return false;
    //   }
      
    //   // Skip names with unusual characters that might break URLs
    //   if (/[^\w\s\-\(\)]/i.test(name)) {
    //     return false;
    //   }
      
    //   return true;
    // });
    
    // Prioritize shorter, simpler names (more likely to be common names)
    relatedDrugs.sort((a, b) => a.length - b.length);
    
    // Limit to a reasonable number of drug names to prevent overwhelming the API
    const maxDrugs = 10;
    if (relatedDrugs.length > maxDrugs) {
      console.log(`Limiting from ${relatedDrugs.length} to ${maxDrugs} related drugs to prevent API overload`);
      relatedDrugs = relatedDrugs.slice(0, maxDrugs);
    }
    
    console.log(`Found ${relatedDrugs.length} related drugs for ${drugName}: ${relatedDrugs.join(', ')}`);
    
    return relatedDrugs;
  } catch (error) {
    console.error(`Error in main getRelatedDrugs function for ${drugName}:`, error);
    // Return empty array in case of error to continue with at least the original drug
    return [];
  }
}

// RxNorm API functions
async function searchRxNorm(drugName, results) {
  try {
    // Step 1: Get RxCUI for the drug
    const rxcuiResponse = await axios.get(`https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(drugName)}&search=1`);
    
    if (rxcuiResponse.data && rxcuiResponse.data.idGroup && rxcuiResponse.data.idGroup.rxnormId) {
      const rxcui = rxcuiResponse.data.idGroup.rxnormId[0];
      
      // Add the standard name to results
      if (rxcuiResponse.data.idGroup.name) {
        results.sources.rxnorm.names.push({
          name: rxcuiResponse.data.idGroup.name,
          type: 'Standard Name'
        });
      }
      
      // Step 2: Get related names
      const relatedResponse = await axios.get(`https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/allrelated.json`);
      
      if (relatedResponse.data && relatedResponse.data.allRelatedGroup && relatedResponse.data.allRelatedGroup.conceptGroup) {
        for (const group of relatedResponse.data.allRelatedGroup.conceptGroup) {
          if (group.conceptProperties) {
            for (const property of group.conceptProperties) {
              results.sources.rxnorm.names.push({
                name: property.name,
                type: group.tty || 'Related Term',
                id: property.rxcui
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error searching RxNorm:', error.message);
    results.sources.rxnorm.names.push({
      name: "Error searching RxNorm database",
      type: "Error"
    });
  }
}

// FDA API function
async function searchFDA(drugName, results) {
  try {
    // Search by generic name
    const fdaGenericResponse = await axios.get(`https://api.fda.gov/drug/label.json?search=openfda.generic_name:${encodeURIComponent(drugName)}&limit=5`);
    
    if (fdaGenericResponse.data && fdaGenericResponse.data.results) {
      processFDAResults(fdaGenericResponse.data.results, results);
    }
    
    // Search by brand name
    const fdaBrandResponse = await axios.get(`https://api.fda.gov/drug/label.json?search=openfda.brand_name:${encodeURIComponent(drugName)}&limit=5`);
    
    if (fdaBrandResponse.data && fdaBrandResponse.data.results) {
      processFDAResults(fdaBrandResponse.data.results, results);
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      // No results found is a normal condition
      results.sources.fda.names.push({
        name: "No FDA records found",
        type: "Info"
      });
    } else {
      console.error('Error searching FDA:', error.message);
      results.sources.fda.names.push({
        name: "Error searching FDA database",
        type: "Error"
      });
    }
  }
}

function processFDAResults(fdaResults, results) {
  for (const drug of fdaResults) {
    if (drug.openfda) {
      // Add generic names
      if (drug.openfda.generic_name) {
        for (const name of drug.openfda.generic_name) {
          results.sources.fda.names.push({
            name: name,
            type: 'Generic Name'
          });
        }
      }
      
      // Add brand names
      if (drug.openfda.brand_name) {
        for (const name of drug.openfda.brand_name) {
          results.sources.fda.names.push({
            name: name,
            type: 'Brand Name'
          });
        }
      }
      
      // Add substance names
      if (drug.openfda.substance_name) {
        for (const name of drug.openfda.substance_name) {
          results.sources.fda.names.push({
            name: name,
            type: 'Substance Name'
          });
        }
      }
    }
  }
}

// PubChem API function
async function searchPubChem(drugName, results) {
  try {
    // Step 1: Find the compound ID
    const pubchemResponse = await axios.get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(drugName)}/cids/JSON`);
    
    if (pubchemResponse.data && pubchemResponse.data.IdentifierList && pubchemResponse.data.IdentifierList.CID) {
      const cid = pubchemResponse.data.IdentifierList.CID[0];
      
      // Step 2: Get synonyms
      const synonymsResponse = await axios.get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/synonyms/JSON`);
      
      if (synonymsResponse.data && synonymsResponse.data.InformationList && synonymsResponse.data.InformationList.Information) {
        const info = synonymsResponse.data.InformationList.Information[0];
        
        if (info.Synonym) {
          // Filter out long and messy names
          const filteredSynonyms = info.Synonym.filter(syn => 
            syn.length < 100 && !syn.includes('UNII') && !syn.includes('CHEBI') && !syn.includes('DTXSID')
          );
          
          // Take just the first 30 synonyms to avoid overwhelming
          const trimmedSynonyms = filteredSynonyms.slice(0, 30);
          
          for (const synonym of trimmedSynonyms) {
            results.sources.pubchem.names.push({
              name: synonym,
              type: 'Synonym'
            });
          }
        }
      }
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      results.sources.pubchem.names.push({
        name: "No PubChem records found",
        type: "Info"
      });
    } else {
      console.error('Error searching PubChem:', error.message);
      results.sources.pubchem.names.push({
        name: "Error searching PubChem database",
        type: "Error"
      });
    }
  }
}



module.exports = {
  handlePubMedSearch
};


// const fetch = require('node-fetch');
// const xml2js = require('xml2js');

// /**
//  * Handles PubMed API search requests and returns formatted results
//  * @param {Object} req - Express request object
//  * @param {Object} res - Express response object
//  */
// async function handlePubMedSearch(req, res) {
//   try {
//     // Extract query parameters
//     const {
//       term = '',
//       page = 1,
//       sortBy = 'relevance',
//       fullTextOnly = false,
//       yearFilter = '',
//       journalFilter = ''
//     } = req.query;

//     // Base URL for PubMed E-utilities
//     const baseUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
    
//     // Your NCBI API key
//     const apiKey = process.env.NCBI_API_KEY || ''; // Set this in your environment variables
    
//     // Calculate pagination parameters
//     const retmax = 20; // Results per page
//     const retstart = (page - 1) * retmax;
    
//     // Build the search query with any additional filters
//     let searchQuery = term;
    
//     // Add year filter if provided
//     if (yearFilter) {
//       searchQuery += ` AND ${yearFilter}[pdat]`;
//     }
    
//     // Add journal filter if provided
//     if (journalFilter) {
//       searchQuery += ` AND "${journalFilter}"[journal]`;
//     }
    
//     // Add full text filter if requested
//     if (fullTextOnly === 'true' || fullTextOnly === true) {
//       searchQuery += ' AND free full text[filter]';
//     }
    
//     // Build sort parameter
//     let sortParam = '';
//     switch (sortBy) {
//       case 'date':
//         sortParam = 'pub date';
//         break;
//       case 'relevance':
//       default:
//         sortParam = 'relevance';
//         break;
//     }
    
//     // Step 1: Search PubMed to get IDs
//     const searchUrl = `${baseUrl}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(searchQuery)}&retmax=${retmax}&retstart=${retstart}&sort=${encodeURIComponent(sortParam)}&usehistory=y${apiKey ? `&api_key=${apiKey}` : ''}`;
    
//     console.log(`PubMed Search URL: ${searchUrl}`);
    
//     const searchResponse = await fetch(searchUrl);
    
//     if (!searchResponse.ok) {
//       throw new Error(`PubMed search API responded with status: ${searchResponse.status}`);
//     }
    
//     const searchData = await searchResponse.text();
//     const parser = new xml2js.Parser({ explicitArray: false });
//     const searchResult = await parser.parseStringPromise(searchData);
    
//     if (!searchResult.eSearchResult || !searchResult.eSearchResult.IdList) {
//       return res.json({ articles: [], totalResults: 0 });
//     }
    
//     // Extract article IDs and count
//     const totalResults = parseInt(searchResult.eSearchResult.Count, 10) || 0;
//     let ids = [];
    
//     // Handle different formats of IdList
//     if (searchResult.eSearchResult.IdList.Id) {
//       if (Array.isArray(searchResult.eSearchResult.IdList.Id)) {
//         ids = searchResult.eSearchResult.IdList.Id;
//       } else {
//         ids = [searchResult.eSearchResult.IdList.Id];
//       }
//     }
    
//     if (ids.length === 0) {
//       return res.json({ articles: [], totalResults });
//     }
    
//     // Step 2: Fetch full article data using the IDs
//     const fetchUrl = `${baseUrl}/efetch.fcgi?db=pubmed&id=${ids.join(',')}&retmode=xml${apiKey ? `&api_key=${apiKey}` : ''}`;
    
//     const fetchResponse = await fetch(fetchUrl);
    
//     if (!fetchResponse.ok) {
//       throw new Error(`PubMed fetch API responded with status: ${fetchResponse.status}`);
//     }
    
//     const fetchData = await fetchResponse.text();
//     const fetchResult = await parser.parseStringPromise(fetchData);
    
//     if (!fetchResult.PubmedArticleSet || !fetchResult.PubmedArticleSet.PubmedArticle) {
//       return res.json({ articles: [], totalResults });
//     }
    
//     // Ensure PubmedArticle is always an array
//     const pubmedArticles = Array.isArray(fetchResult.PubmedArticleSet.PubmedArticle) 
//       ? fetchResult.PubmedArticleSet.PubmedArticle 
//       : [fetchResult.PubmedArticleSet.PubmedArticle];
    
//     // Transform the PubMed articles to the format expected by the frontend
//     const articles = pubmedArticles.map(article => {
//       // Extract basic article information
//       const medlineCitation = article.MedlineCitation;
//       const pmid = medlineCitation.PMID ? medlineCitation.PMID._ || medlineCitation.PMID : '';
//       const articleData = medlineCitation.Article;
      
//       if (!articleData) {
//         return null;
//       }
      
//       // Extract title
//       const title = articleData.ArticleTitle ? 
//         (typeof articleData.ArticleTitle === 'string' ? articleData.ArticleTitle : articleData.ArticleTitle._) : 
//         'No title available';
      
//       // Extract journal information
//       const journal = articleData.Journal ? 
//         (articleData.Journal.Title || 'Journal not specified') : 
//         'Journal not specified';
      
//       // Extract publication date
//       let pubDate = '';
//       if (articleData.Journal && articleData.Journal.JournalIssue && articleData.Journal.JournalIssue.PubDate) {
//         const pubDateObj = articleData.Journal.JournalIssue.PubDate;
//         if (pubDateObj.Year) {
//           pubDate = pubDateObj.Year;
//           if (pubDateObj.Month) {
//             pubDate = `${pubDateObj.Month} ${pubDate}`;
//             if (pubDateObj.Day) {
//               pubDate = `${pubDateObj.Day} ${pubDate}`;
//             }
//           }
//         } else if (pubDateObj.MedlineDate) {
//           pubDate = pubDateObj.MedlineDate;
//         }
//       }
      
//       // Extract authors
//       let authors = [];
//       if (articleData.AuthorList && articleData.AuthorList.Author) {
//         const authorList = Array.isArray(articleData.AuthorList.Author) ? 
//           articleData.AuthorList.Author : 
//           [articleData.AuthorList.Author];
        
//         authors = authorList.map(author => {
//           if (author.LastName && author.ForeName) {
//             return `${author.LastName} ${author.ForeName.charAt(0)}`;
//           } else if (author.LastName) {
//             return author.LastName;
//           } else if (author.CollectiveName) {
//             return author.CollectiveName;
//           }
//           return '';
//         }).filter(Boolean);
//       }
      
//       // Extract abstract
//       let abstract = '';
//       if (articleData.Abstract && articleData.Abstract.AbstractText) {
//         if (Array.isArray(articleData.Abstract.AbstractText)) {
//           abstract = articleData.Abstract.AbstractText.map(text => {
//             if (typeof text === 'string') return text;
//             return text._ || '';
//           }).join(' ');
//         } else if (typeof articleData.Abstract.AbstractText === 'string') {
//           abstract = articleData.Abstract.AbstractText;
//         } else if (articleData.Abstract.AbstractText._) {
//           abstract = articleData.Abstract.AbstractText._;
//         }
//       }
      
//       // Extract keywords
//       let keywords = [];
//       if (medlineCitation.KeywordList && medlineCitation.KeywordList.Keyword) {
//         keywords = Array.isArray(medlineCitation.KeywordList.Keyword) ? 
//           medlineCitation.KeywordList.Keyword.map(k => typeof k === 'string' ? k : k._) : 
//           [typeof medlineCitation.KeywordList.Keyword === 'string' ? 
//             medlineCitation.KeywordList.Keyword : 
//             medlineCitation.KeywordList.Keyword._];
//       }
      
//       // Extract MeSH terms
//       let meshTerms = [];
//       if (medlineCitation.MeshHeadingList && medlineCitation.MeshHeadingList.MeshHeading) {
//         const meshHeadings = Array.isArray(medlineCitation.MeshHeadingList.MeshHeading) ? 
//           medlineCitation.MeshHeadingList.MeshHeading : 
//           [medlineCitation.MeshHeadingList.MeshHeading];
        
//         meshTerms = meshHeadings.map(heading => {
//           if (heading.DescriptorName) {
//             return typeof heading.DescriptorName === 'string' ? 
//               heading.DescriptorName : 
//               heading.DescriptorName._ || '';
//           }
//           return '';
//         }).filter(Boolean);
//       }
      
//       // Extract DOI
//       let doi = '';
//       if (articleData.ELocationID) {
//         const elocations = Array.isArray(articleData.ELocationID) ? 
//           articleData.ELocationID : 
//           [articleData.ELocationID];
        
//         const doiLocation = elocations.find(loc => 
//           loc.$ && loc.$.EIdType === 'doi'
//         );
        
//         if (doiLocation) {
//           doi = doiLocation._ || doiLocation;
//         }
//       }
      
//       // Check for full text availability
//       let fullTextUrl = '';
//       if (article.PubmedData && article.PubmedData.ArticleIdList && article.PubmedData.ArticleIdList.ArticleId) {
//         const articleIds = Array.isArray(article.PubmedData.ArticleIdList.ArticleId) ? 
//           article.PubmedData.ArticleIdList.ArticleId : 
//           [article.PubmedData.ArticleIdList.ArticleId];
        
//         const pmcId = articleIds.find(id => id.$ && id.$.IdType === 'pmc');
//         if (pmcId) {
//           fullTextUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcId._}/`;
//         }
//       }
      
//       // Format the article according to the frontend's expected structure
//       return {
//         pmid,
//         title,
//         authors,
//         journal,
//         pubDate,
//         abstract: abstract || 'No abstract available',
//         keywords,
//         meshTerms,
//         doi,
//         fullTextUrl
//       };
//     }).filter(Boolean); // Remove any null entries
    
//     // Return the formatted data
//     res.json({
//       articles,
//       totalResults
//     });
    
//   } catch (error) {
//     console.error('PubMed API error:', error);
//     res.status(500).json({ 
//       error: 'Error fetching data from PubMed',
//       message: error.message
//     });
//   }
// }

// module.exports = {
//   handlePubMedSearch
// };