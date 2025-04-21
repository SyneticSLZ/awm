// Drug Name Finder - Express Server
// This server looks up drug names across multiple pharmaceutical databases
// and aggregates clinical trials for all alternative names

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Simple home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Main API endpoint
app.get('/api/drug/:name', async (req, res) => {
  try {
    const drugName = req.params.name;
    console.log(`Searching for drug: ${drugName}`);
    
    // Object to store all results
    const results = {
      originalQuery: drugName,
      sources: {
        rxnorm: { names: [], links: [] },
        fda: { names: [], links: [] },
        pubchem: { names: [], links: [] },
        chembl: { names: [], links: [] },
        clinicaltrials: { names: [], links: [] }
      }
    };

    // Run all searches in parallel
    await Promise.all([
      searchRxNorm(drugName, results),
      searchFDA(drugName, results),
      searchPubChem(drugName, results),
      searchChEMBL(drugName, results),
      searchClinicalTrials(drugName, results)
    ]);

    res.json(results);
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ error: 'An error occurred while processing your request' });
  }
});

// Add an endpoint to collect all drug names from a search
app.get('/api/collect-names/:name', async (req, res) => {
  try {
    const drugName = req.params.name;
    console.log(`Collecting all names for drug: ${drugName}`);
    
    // Use the existing drug search function
    const results = {
      originalQuery: drugName,
      sources: {
        rxnorm: { names: [], links: [] },
        fda: { names: [], links: [] },
        pubchem: { names: [], links: [] },
        chembl: { names: [], links: [] },
        clinicaltrials: { names: [], links: [] }
      }
    };

    // Run all searches in parallel
    await Promise.all([
      searchRxNorm(drugName, results),
      searchFDA(drugName, results),
      searchPubChem(drugName, results),
      searchChEMBL(drugName, results),
      searchClinicalTrials(drugName, results)
    ]);
    
    // Extract all the unique drug names from the search results
    const allNames = new Set();
    const namesBySource = {};
    
    for (const [sourceName, sourceData] of Object.entries(results.sources)) {
      namesBySource[sourceName] = [];
      
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
          
          // Add to the source-specific list
          namesBySource[sourceName].push({
            name: nameObj.name,
            type: nameObj.type
          });
          
          // Add to the unique set
          allNames.add(nameObj.name);
        }
      }
    }
    
    res.json({
      success: true,
      data: {
        originalQuery: drugName,
        uniqueNameCount: allNames.size,
        uniqueNames: Array.from(allNames),
        namesBySource: namesBySource
      }
    });
  } catch (error) {
    console.error('Error collecting drug names:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while collecting drug names',
      message: error.message
    });
  }
});

// Clinical Trials Aggregation endpoint
app.post('/api/aggregate-trials', async (req, res) => {
  try {
    const { drugNames } = req.body;
    
    if (!drugNames || !Array.isArray(drugNames) || drugNames.length === 0) {
      return res.status(400).json({ 
        error: 'Please provide an array of drug names' 
      });
    }
    
    // Remove duplicates and empty strings
    const uniqueDrugNames = [...new Set(drugNames.filter(name => 
      name && typeof name === 'string' && name.trim() !== ''
    ))];
    
    if (uniqueDrugNames.length === 0) {
      return res.status(400).json({ 
        error: 'No valid drug names provided' 
      });
    }
    
    // Limit the total number of names to prevent overloading
    const maxDrugNames = 50;
    const limitedDrugNames = uniqueDrugNames.slice(0, maxDrugNames);
    const wasTruncated = limitedDrugNames.length < uniqueDrugNames.length;
    
    // Perform the search
    const results = await searchAllTrialsForDrugNames(limitedDrugNames);
    
    // Return the results
    res.json({
      success: true,
      data: {
        trials: results.trials,
        errors: results.errors,
        stats: {
          totalDrugNamesProvided: uniqueDrugNames.length,
          totalDrugNamesSearched: limitedDrugNames.length,
          wasTruncated,
          totalUniqueTrials: results.totalUniqueTrials
        }
      }
    });
  } catch (error) {
    console.error('Error in aggregate trials endpoint:', error);
    res.status(500).json({ 
      error: 'An error occurred while processing your request',
      message: error.message
    });
  }
});

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
        
        results.sources.rxnorm.links.push({
          url: `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${rxcui}`,
          description: 'View in RxNav'
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
      
      // Add application number for link
      if (drug.openfda.application_number && drug.openfda.application_number[0]) {
        const appNum = drug.openfda.application_number[0];
        results.sources.fda.links.push({
          url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appNum.replace(/[^0-9]/g, '')}`,
          description: `FDA Application: ${appNum}`
        });
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
          
          // Add a link to the PubChem compound page
          results.sources.pubchem.links.push({
            url: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
            description: 'View in PubChem'
          });
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

// ChEMBL API function
async function searchChEMBL(drugName, results) {
  try {
    // First attempt: Search by exact molecule name
    let foundMolecules = [];
    try {
      const exactNameResponse = await axios.get(`https://www.ebi.ac.uk/chembl/api/data/molecule.json?pref_name__iexact=${encodeURIComponent(drugName)}`);
      if (exactNameResponse.data && exactNameResponse.data.molecules && exactNameResponse.data.molecules.length > 0) {
        foundMolecules = exactNameResponse.data.molecules;
      }
    } catch (exactError) {
      console.log('No exact match in ChEMBL:', exactError.message);
    }
    
    // Second attempt: Try searching by synonym if no exact match found
    if (foundMolecules.length === 0) {
      try {
        const synonymResponse = await axios.get(`https://www.ebi.ac.uk/chembl/api/data/molecule.json?molecule_synonyms__synonym__icontains=${encodeURIComponent(drugName)}`);
        if (synonymResponse.data && synonymResponse.data.molecules && synonymResponse.data.molecules.length > 0) {
          foundMolecules = synonymResponse.data.molecules;
        }
      } catch (synonymError) {
        console.log('No synonym match in ChEMBL:', synonymError.message);
      }
    }
    
    // Third attempt: Try a more general search by name contains
    if (foundMolecules.length === 0) {
      try {
        const containsResponse = await axios.get(`https://www.ebi.ac.uk/chembl/api/data/molecule.json?pref_name__icontains=${encodeURIComponent(drugName)}`);
        if (containsResponse.data && containsResponse.data.molecules && containsResponse.data.molecules.length > 0) {
          foundMolecules = containsResponse.data.molecules;
        }
      } catch (containsError) {
        console.log('No contains match in ChEMBL:', containsError.message);
      }
    }
    
    // Final attempt: Try a free text search
    if (foundMolecules.length === 0) {
      try {
        const searchResponse = await axios.get(`https://www.ebi.ac.uk/chembl/api/data/molecule/search?q=${encodeURIComponent(drugName)}`);
        if (searchResponse.data && searchResponse.data.molecules && searchResponse.data.molecules.length > 0) {
          foundMolecules = searchResponse.data.molecules;
        }
      } catch (searchError) {
        console.log('No search match in ChEMBL:', searchError.message);
      }
    }
    
    // Process results if we found any molecules
    if (foundMolecules.length > 0) {
      processChEMBLResults(foundMolecules, results);
    } else {
      // No results found after all attempts
      results.sources.chembl.names.push({
        name: "No ChEMBL records found",
        type: "Info"
      });
    }
  } catch (error) {
    console.error('Error searching ChEMBL:', error.message);
    results.sources.chembl.names.push({
      name: "Error searching ChEMBL database",
      type: "Error"
    });
  }
}

function processChEMBLResults(molecules, results) {
  // Keep track of processed names to avoid duplicates
  const processedNames = new Set();
  
  for (const molecule of molecules) {
    // Add preferred name
    if (molecule.pref_name && !processedNames.has(molecule.pref_name.toLowerCase())) {
      processedNames.add(molecule.pref_name.toLowerCase());
      results.sources.chembl.names.push({
        name: molecule.pref_name,
        type: 'Preferred Name'
      });
    }
    
    // Add molecule synonyms
    if (molecule.molecule_synonyms && molecule.molecule_synonyms.length > 0) {
      for (const synonym of molecule.molecule_synonyms) {
        if (synonym.synonym && !processedNames.has(synonym.synonym.toLowerCase())) {
          processedNames.add(synonym.synonym.toLowerCase());
          results.sources.chembl.names.push({
            name: synonym.synonym,
            type: synonym.syn_type || 'Synonym'
          });
        }
      }
    }
    
    // Add research codes if available
    if (molecule.research_codes && molecule.research_codes.length > 0) {
      for (const code of molecule.research_codes) {
        if (code && !processedNames.has(code.toLowerCase())) {
          processedNames.add(code.toLowerCase());
          results.sources.chembl.names.push({
            name: code,
            type: 'Research Code'
          });
        }
      }
    }
    
    // Add trade names if available
    if (molecule.trade_names && molecule.trade_names.length > 0) {
      for (const tradeName of molecule.trade_names) {
        if (tradeName && !processedNames.has(tradeName.toLowerCase())) {
          processedNames.add(tradeName.toLowerCase());
          results.sources.chembl.names.push({
            name: tradeName,
            type: 'Trade Name'
          });
        }
      }
    }
    
    // Add cross references if available
    if (molecule.cross_references && molecule.cross_references.length > 0) {
      for (const xref of molecule.cross_references) {
        if (xref.xref_id && !processedNames.has(xref.xref_id.toLowerCase())) {
          processedNames.add(xref.xref_id.toLowerCase());
          results.sources.chembl.names.push({
            name: xref.xref_id,
            type: xref.xref_src || 'Cross Reference'
          });
        }
      }
    }
    
    // Add link to ChEMBL
    if (molecule.molecule_chembl_id) {
      results.sources.chembl.links.push({
        url: `https://www.ebi.ac.uk/chembl/compound_report_card/${molecule.molecule_chembl_id}/`,
        description: `View in ChEMBL: ${molecule.molecule_chembl_id}`
      });
    }
  }
}

// ClinicalTrials.gov function
async function searchClinicalTrials(drugName, results) {
  try {
    // Using the v2 API as specified in the docs
    const response = await axios.get(`https://clinicaltrials.gov/api/v2/studies`, {
      params: {
        'query.term': drugName,
        'fields': 'NCTId,BriefTitle,InterventionName,InterventionOtherName,InterventionDescription,InterventionType',
        'pageSize': 10,
        'format': 'json'
      },
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (response.data && response.data.studies && response.data.studies.length > 0) {
      const studies = response.data.studies;
      const processedNames = new Set(); // To avoid duplicates
      
      for (const study of studies) {
        // Add link to the clinical trial
        if (study.protocolSection && study.protocolSection.identificationModule && study.protocolSection.identificationModule.nctId) {
          const nctId = study.protocolSection.identificationModule.nctId;
          const title = study.protocolSection.identificationModule.briefTitle || nctId;
          
          results.sources.clinicaltrials.links.push({
            url: `https://clinicaltrials.gov/study/${nctId}`,
            description: title
          });
        }
        
        // Extract intervention information
        if (study.protocolSection && study.protocolSection.armsInterventionsModule && 
            study.protocolSection.armsInterventionsModule.interventions) {
            
          const interventions = study.protocolSection.armsInterventionsModule.interventions;
          
          for (const intervention of interventions) {
            // Check intervention name
            if (intervention.interventionName) {
              const name = intervention.interventionName;
              const normalizedDrugName = drugName.toLowerCase();
              const normalizedName = name.toLowerCase();
              
              // Only add if related to the drug
              if (normalizedName.includes(normalizedDrugName) || 
                  normalizedDrugName.includes(normalizedName)) {
                
                if (!processedNames.has(normalizedName)) {
                  processedNames.add(normalizedName);
                  results.sources.clinicaltrials.names.push({
                    name: name,
                    type: 'Intervention Name'
                  });
                }
              }
              
              // Check other names
              if (intervention.interventionOtherNames) {
                for (const otherName of intervention.interventionOtherNames) {
                  const normalizedOtherName = otherName.toLowerCase();
                  
                  if ((normalizedOtherName.includes(normalizedDrugName) || 
                      normalizedDrugName.includes(normalizedOtherName)) && 
                      !processedNames.has(normalizedOtherName)) {
                    
                    processedNames.add(normalizedOtherName);
                    results.sources.clinicaltrials.names.push({
                      name: otherName,
                      type: 'Other Intervention Name'
                    });
                  }
                }
              }
            }
          }
        }
      }
      
      // If no names were found
      if (results.sources.clinicaltrials.names.length === 0) {
        results.sources.clinicaltrials.names.push({
          name: "No relevant intervention names found in clinical trials",
          type: "Info"
        });
      }
    } else {
      results.sources.clinicaltrials.names.push({
        name: "No ClinicalTrials.gov records found",
        type: "Info"
      });
    }
  } catch (error) {
    console.error('Error searching ClinicalTrials.gov:', error.message);
    results.sources.clinicaltrials.names.push({
      name: "Error searching ClinicalTrials.gov. Try with a different drug name.",
      type: "Error"
    });
  }
}

// Function to search for clinical trials using all collected drug names
async function searchAllTrialsForDrugNames(drugNames) {
  // Store all unique trials to avoid duplicates
  const uniqueTrials = new Map();
  const errors = [];
  let totalSearched = 0;
  
  console.log(`Searching trials for ${drugNames.length} drug names...`);
  
  // Search in batches to avoid overwhelming the API
  const batchSize = 5;
  for (let i = 0; i < drugNames.length; i += batchSize) {
    const batch = drugNames.slice(i, i + batchSize);
    const searchPromises = batch.map(drugName => searchTrialsForName(drugName));
    
    // Wait for all searches in current batch to complete
    const batchResults = await Promise.allSettled(searchPromises);
    
    // Process results from this batch
    batchResults.forEach((result, index) => {
      const drugName = batch[index];
      totalSearched++;
      
      if (result.status === 'fulfilled') {
        const { trials, error } = result.value;
        
        if (error) {
          errors.push({ drugName, error });
        } else if (trials && trials.length > 0) {
          // Add each trial to our map, using NCT ID as the key
          trials.forEach(trial => {
            if (!uniqueTrials.has(trial.nctId)) {
              // Add relevance info to know which drug names matched this trial
              if (!trial.matchedDrugNames) {
                trial.matchedDrugNames = [];
              }
              trial.matchedDrugNames.push(drugName);
              uniqueTrials.set(trial.nctId, trial);
            } else {
              // Update the existing trial to include this drug name match
              const existingTrial = uniqueTrials.get(trial.nctId);
              if (!existingTrial.matchedDrugNames.includes(drugName)) {
                existingTrial.matchedDrugNames.push(drugName);
              }
            }
          });
        }
      } else {
        errors.push({ drugName, error: result.reason.message });
      }
      
      // Log progress for long-running searches
      if (totalSearched % 10 === 0 || totalSearched === drugNames.length) {
        console.log(`Processed ${totalSearched} of ${drugNames.length} drug names...`);
      }
    });
  }

  console.log(`Search completed. Found ${uniqueTrials.size} unique trials.`);
  
  return {
    trials: Array.from(uniqueTrials.values()),
    errors: errors,
    totalDrugNames: drugNames.length,
    totalUniqueTrials: uniqueTrials.size
  };
}

// Helper function to search clinical trials for a single drug name
async function searchTrialsForName(drugName) {
  try {
    if (!drugName || typeof drugName !== 'string' || drugName.trim() === '') {
      return { trials: [], error: 'Invalid drug name' };
    }
    
    const sanitizedName = drugName.trim();
    
    // Use the ClinicalTrials.gov API v2
    const response = await axios.get(`https://clinicaltrials.gov/api/v2/studies`, {
      params: {
        'query.term': sanitizedName,
        'fields': 'NCTId,BriefTitle,OfficialTitle,OverallStatus,BriefSummary,StartDate,CompletionDate,Phase,StudyType,LeadSponsorName,InterventionName,InterventionType,EnrollmentCount',
        'pageSize': 20,
        'format': 'json'
      },
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (!response.data || !response.data.studies || !Array.isArray(response.data.studies)) {
      return { trials: [], error: 'Invalid response format from ClinicalTrials.gov' };
    }
    
    // Process and format the trials
    const trials = response.data.studies.map(study => {
      const protocolSection = study.protocolSection || {};
      const identificationModule = protocolSection.identificationModule || {};
      const statusModule = protocolSection.statusModule || {};
      const designModule = protocolSection.designModule || {};
      const sponsorCollaboratorsModule = protocolSection.sponsorCollaboratorsModule || {};
      const armsInterventionsModule = protocolSection.armsInterventionsModule || {};
      
      // Get interventions
      const interventions = [];
      if (armsInterventionsModule.interventions && Array.isArray(armsInterventionsModule.interventions)) {
        armsInterventionsModule.interventions.forEach(intervention => {
          interventions.push({
            name: intervention.interventionName,
            type: intervention.interventionType,
            description: intervention.interventionDescription
          });
        });
      }
      
      return {
        nctId: identificationModule.nctId,
        title: identificationModule.briefTitle || identificationModule.officialTitle || 'No title available',
        status: statusModule.overallStatus || 'UNKNOWN',
        phase: designModule.phases ? designModule.phases.join(', ') : 'Not specified',
        summary: identificationModule.briefSummary ? 
                 identificationModule.briefSummary.substring(0, 300) + (identificationModule.briefSummary.length > 300 ? '...' : '') 
                 : 'No summary available',
        startDate: statusModule.startDate || 'Not specified',
        completionDate: statusModule.completionDate || 'Not specified',
        studyType: designModule.studyType || 'Not specified',
        sponsor: sponsorCollaboratorsModule.leadSponsor ? 
                sponsorCollaboratorsModule.leadSponsor.name || 'Not specified' 
                : 'Not specified',
        enrollment: designModule.enrollmentInfo ? 
                   designModule.enrollmentInfo.count || 'Not specified' 
                   : 'Not specified',
        interventions: interventions,
        url: `https://clinicaltrials.gov/study/${identificationModule.nctId}`
      };
    });
    
    return { trials, error: null };
  } catch (error) {
    console.error(`Error searching trials for ${drugName}:`, error.message);
    return { trials: [], error: error.message };
  }
}

// Add the clinical trials UI page
app.get('/trials', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'trials.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Drug Name Finder server running on port ${PORT}`);
  console.log(`Access the web interface at http://localhost:${PORT}`);
  console.log(`Access the trials aggregator at http://localhost:${PORT}/trials`);
});