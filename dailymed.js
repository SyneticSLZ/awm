
// // server.js
// const http = require('http');
// const https = require('https');
// const url = require('url');
// const { DOMParser } = require('xmldom');

// const PORT = process.env.PORT || 3000;

// // Create the server
// const server = http.createServer(async (req, res) => {
//   // Set CORS headers to allow requests from any origin
//   res.setHeader('Access-Control-Allow-Origin', '*');
//   res.setHeader('Access-Control-Allow-Methods', 'GET');
//   res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
//   // Parse the URL and query parameters
//   const parsedUrl = url.parse(req.url, true);
  
//   // Only handle requests to /api/drug
//   if (parsedUrl.pathname === '/api/drug' && req.method === 'GET') {
//     const drugName = parsedUrl.query.name;
    
//     if (!drugName) {
//       res.statusCode = 400;
//       res.setHeader('Content-Type', 'application/json');
//       res.end(JSON.stringify({ error: 'Drug name is required' }));
//       return;
//     }
    
//     try {
//       const drugsData = await getAllDrugDataByName(drugName);
      
//       if (drugsData && drugsData.length > 0) {
//         res.statusCode = 200;
//         res.setHeader('Content-Type', 'application/json');
//         res.end(JSON.stringify(drugsData));
//       } else {
//         res.statusCode = 404;
//         res.setHeader('Content-Type', 'application/json');
//         res.end(JSON.stringify({ error: `No data found for drug: ${drugName}` }));
//       }
//     } catch (error) {
//       console.error(`Error processing request for ${drugName}:`, error);
//       res.statusCode = 500;
//       res.setHeader('Content-Type', 'application/json');
//       res.end(JSON.stringify({ error: 'Internal server error' }));
//     }
//   } else {
//     // Return 404 for any other routes
//     res.statusCode = 404;
//     res.setHeader('Content-Type', 'application/json');
//     res.end(JSON.stringify({ error: 'Not found' }));
//   }
// });



// server.js
const express = require('express');
const https = require('https');
const { DOMParser } = require('xmldom');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Drug API route
app.get('/api/drug', async (req, res) => {
  const drugName = req.query.name;
  
  if (!drugName) {
    return res.status(400).json({ error: 'Drug name is required' });
  }
  
  try {
    const drugsData = await getAllDrugDataByName(drugName);
    
    if (drugsData && drugsData.length > 0) {
      return res.status(200).json(drugsData);
    } else {
      return res.status(404).json({ error: `No data found for drug: ${drugName}` });
    }
  } catch (error) {
    console.error(`Error processing request for ${drugName}:`, error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Main function to get all drug data by name
async function getAllDrugDataByName(drugName) {
  try {
    // Step 1: Search for the drug to get all SPL IDs
    const splIds = await searchAndGetAllSplIds(drugName);
    
    if (!splIds || splIds.length === 0) {
      console.error(`No results found for drug name: ${drugName}`);
      return [];
    }
    
    console.log(`Found ${splIds.length} SPL IDs for ${drugName}`);
    
    // Step 2: Get detailed data for each SPL ID
    const drugsDataPromises = splIds.map(splId => getDrugDataById(splId));
    const drugsData = await Promise.all(drugsDataPromises);
    
    // Filter out any null results
    return drugsData.filter(data => data !== null);
    
  } catch (error) {
    console.error(`Error getting data for ${drugName}:`, error);
    throw error;
  }
}

// Function to search DailyMed and return all matching SPL IDs
function searchAndGetAllSplIds(drugName) {
  return new Promise((resolve, reject) => {
    const encodedQuery = encodeURIComponent(drugName);
    const requestUrl = `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.xml?drug_name=${encodedQuery}`;
    
    https.get(requestUrl, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP error! Status: ${response.statusCode}`));
        return;
      }
      
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        try {
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(data, "text/xml");
          
          // Get all SPL IDs from the search results
          const splElements = xmlDoc.getElementsByTagName('setid');
          const splIds = [];
          
          for (let i = 0; i < splElements.length; i++) {
            const splId = splElements[i].textContent.trim();
            if (splId) {
              splIds.push(splId);
            }
          }
          
          resolve(splIds);
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

// Function to get detailed drug data using SPL ID
function getDrugDataById(splId) {
  return new Promise((resolve, reject) => {
    const requestUrl = `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${splId}.xml`;
    
    https.get(requestUrl, (response) => {
      if (response.statusCode !== 200) {
        console.warn(`HTTP error for SPL ID ${splId}! Status: ${response.statusCode}`);
        resolve(null); // Don't reject, just return null for this ID
        return;
      }
      
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        try {
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(data, "text/xml");
          
          // Extract the relevant information
          const drugInfo = extractDrugInfo(xmlDoc, splId);
          resolve(drugInfo);
        } catch (error) {
          console.warn(`Error parsing data for SPL ID ${splId}:`, error);
          resolve(null); // Don't reject, just return null for this ID
        }
      });
    }).on('error', (error) => {
      console.warn(`Network error for SPL ID ${splId}:`, error);
      resolve(null); // Don't reject, just return null for this ID
    });
  });
}

// Function to extract drug information from the XML document
function extractDrugInfo(xmlDoc, splId) {
  try {
    // Helper function to safely get text content
    const getTextContent = (element) => {
      if (!element) return null;
      return element.textContent.trim();
    };
    
    // Helper function to get all matching elements and extract their text content
    const getAllTextContent = (elements) => {
      const result = [];
      for (let i = 0; i < elements.length; i++) {
        const text = elements[i].textContent.trim();
        if (text) result.push(text);
      }
      return result;
    };
    
    // Extract basic information
    const titleElements = xmlDoc.getElementsByTagName('title');
    let title = "Unknown";
    
    // Look for the document title, which is typically one of the first title elements
    for (let i = 0; i < Math.min(5, titleElements.length); i++) {
      const text = getTextContent(titleElements[i]);
      if (text && text.length > 10) { // Assuming a meaningful title has at least 10 chars
        title = text;
        break;
      }
    }
    
    // Try to get more specific product name
    const productNameElements = xmlDoc.getElementsByTagName('name');
    let productName = null;
    
    for (let i = 0; i < productNameElements.length; i++) {
      const parent = productNameElements[i].parentNode;
      if (parent && (parent.nodeName === 'manufacturedProduct' || parent.nodeName === 'product')) {
        productName = getTextContent(productNameElements[i]);
        if (productName) break;
      }
    }
    
    if (!productName) {
      for (let i = 0; i < Math.min(3, productNameElements.length); i++) {
        productName = getTextContent(productNameElements[i]);
        if (productName) break;
      }
    }
    
    // Extract manufacturer (may be in different places in the XML)
    let manufacturer = null;
    const manufacturerOrgElements = xmlDoc.getElementsByTagName('manufacturerOrganization');
    for (let i = 0; i < manufacturerOrgElements.length; i++) {
      const nameElement = manufacturerOrgElements[i].getElementsByTagName('name')[0];
      if (nameElement) {
        manufacturer = getTextContent(nameElement);
        break;
      }
    }
    
    // If no manufacturer found, try alternative approach
    if (!manufacturer) {
      const orgElements = xmlDoc.getElementsByTagName('organization');
      for (let i = 0; i < orgElements.length; i++) {
        const nameElement = orgElements[i].getElementsByTagName('name')[0];
        if (nameElement) {
          manufacturer = getTextContent(nameElement);
          break;
        }
      }
    }
    
    // Extract active ingredients
    const ingredientElements = xmlDoc.getElementsByTagName('ingredient');
    const activeIngredients = [];
    
    for (let i = 0; i < ingredientElements.length; i++) {
      const ingredient = ingredientElements[i];
      const classCode = ingredient.getAttribute('classCode');
      
      if (classCode === 'ACTIB' || classCode === 'ACTIM') {
        const substanceElements = ingredient.getElementsByTagName('ingredientSubstance');
        if (substanceElements.length > 0) {
          const nameElement = substanceElements[0].getElementsByTagName('name')[0];
          if (nameElement) {
            activeIngredients.push(getTextContent(nameElement));
          }
        }
      }
    }
    
    // Extract dosage forms
    const formCodeElements = xmlDoc.getElementsByTagName('formCode');
    const dosageForms = [];
    
    for (let i = 0; i < formCodeElements.length; i++) {
      const displayName = formCodeElements[i].getAttribute('displayName');
      if (displayName && !dosageForms.includes(displayName)) {
        dosageForms.push(displayName);
      }
    }
    
    // Extract sections
    const sectionElements = xmlDoc.getElementsByTagName('section');
    let indications = "Not specified";
    let warnings = "Not specified";
    let dosage = "Not specified";
    let contraindications = "Not specified";
    let adverseReactions = "Not specified";
    let drugInteractions = "Not specified";
    
    for (let i = 0; i < sectionElements.length; i++) {
      const section = sectionElements[i];
      const titleElement = section.getElementsByTagName('title')[0];
      
      if (!titleElement) continue;
      
      const title = getTextContent(titleElement);
      const textElement = section.getElementsByTagName('text')[0];
      
      if (!textElement) continue;
      
      const text = getTextContent(textElement);
      
      if (title && text) {
        if (title.includes('INDICATIONS AND USAGE') || title.includes('USES')) {
          indications = text;
        } else if (title.includes('WARNINGS') || title.includes('BOXED WARNING')) {
          warnings = text;
        } else if (title.includes('DOSAGE AND ADMINISTRATION') || title.includes('DOSAGE')) {
          dosage = text;
        } else if (title.includes('CONTRAINDICATIONS')) {
          contraindications = text;
        } else if (title.includes('ADVERSE REACTIONS') || title.includes('SIDE EFFECTS')) {
          adverseReactions = text;
        } else if (title.includes('DRUG INTERACTIONS')) {
          drugInteractions = text;
        }
      }
    }
    
    // Extract document effective time (when the label was approved/updated)
    const effectiveTimeElements = xmlDoc.getElementsByTagName('effectiveTime');
    let effectiveTime = null;
    
    for (let i = 0; i < effectiveTimeElements.length; i++) {
      const valueElement = effectiveTimeElements[i].getAttribute('value');
      if (valueElement) {
        // Format YYYYMMDD to YYYY-MM-DD
        if (valueElement.length === 8) {
          effectiveTime = `${valueElement.substring(0, 4)}-${valueElement.substring(4, 6)}-${valueElement.substring(6, 8)}`;
          break;
        } else {
          effectiveTime = valueElement;
          break;
        }
      }
    }
    
    // Return structured data
    return {
      splId: splId,
      title: title,
      productName: productName || title,
      manufacturer: manufacturer || "Unknown",
      activeIngredients: activeIngredients.length > 0 ? activeIngredients : ["Unknown"],
      dosageForms: dosageForms.length > 0 ? dosageForms : ["Unknown"],
      indications: indications,
      warnings: warnings,
      dosage: dosage,
      contraindications: contraindications,
      adverseReactions: adverseReactions,
      drugInteractions: drugInteractions,
      effectiveTime: effectiveTime || "Unknown",
      labelUrl: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${splId}`
    };
  } catch (error) {
    console.error("Error extracting drug info:", error);
    return {
      splId: splId,
      error: "Failed to extract complete information"
    };
  }
}


// Add a basic health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Handle 404s
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});