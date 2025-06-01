
// enhanced-watch.js - Enhanced Drug Watch System with Real-time APIs
const express = require('express');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const crypto = require('crypto');

const router = express.Router();

// Import your existing models
const { DrugWatch, DrugWatchResult, User } = require('./db');

// Add new schema for shared results cache
const SharedDrugResultSchema = new mongoose.Schema({
  drugName: {
    type: String,
    required: true,
    index: true,
    lowercase: true
  },
  source: {
    type: String,
    enum: ['ema', 'fda', 'clinicalTrials', 'pubmed', 'dailyMed'],
    required: true,
    index: true
  },
  resultHash: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
    index: true
  },
  expiresAt: {
    type: Date,
    default: function() {
      // Cache for 24 hours by default
      return new Date(Date.now() + 24 * 60 * 60 * 1000);
    },
    index: true
  }
});

// Create TTL index to automatically remove expired documents
SharedDrugResultSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const SharedDrugResult = mongoose.model('SharedDrugResult', SharedDrugResultSchema);

// Enhanced Drug Watch Service Class
class EnhancedDrugWatchService {
  constructor() {
    this.emailTransporter = null;
    this.isRunning = false;
    this.initializeEmailTransporter();
    this.startScheduler();
  }

  // Initialize email transporter
  initializeEmailTransporter() {
    try {
        this.emailTransporter = nodemailer.createTransport({
        host:  'smtp.gmail.com',
        port:  587,
        secure: false,
        // auth: {
        //   user: 'rohanmehmi72@gmail.com',
        //   pass: 'wqlu aaba oprn dxsd'
        // }
          auth: {
    user: process.env.smtphost,
    pass: process.env.smtppassword
  }
      });

      this.emailTransporter.verify((error, success) => {
        if (error) {
          console.error('Email transporter error:', error);
        } else {
          console.log('Email server is ready to send messages');
        }
      });
    } catch (error) {
      console.error('Error initializing email transporter:', error);
    }
  }


  
  // Start the scheduler
  startScheduler() {
    if (this.isRunning) return;
    
    console.log('Starting Enhanced Drug Watch scheduler...');
    
    // Run every hour
    cron.schedule('0 * * * *', async () => {
      console.log('Running drug watch checks...');
      await this.processWatches();
    });

    // Clean up expired cache entries daily
    cron.schedule('0 0 * * *', async () => {
      console.log('Cleaning expired cache entries...');
      await this.cleanupExpiredCache();
    });

    this.isRunning = true;
  }

  // Generate hash for result comparison
  generateResultHash(data) {
    const sortedData = JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash('sha256').update(sortedData).digest('hex');
  }

  // Get cached results or fetch new ones
  async getCachedOrFetchResults(drugName, source, fetchFunction) {
    const normalizedDrugName = drugName.toLowerCase();
    const cacheKey = `${normalizedDrugName}_${source}`;
    
    try {
      // Check shared cache first
      const cached = await SharedDrugResult.findOne({
        drugName: normalizedDrugName,
        source: source,
        expiresAt: { $gt: new Date() }
      });

      if (cached) {
        console.log(`Using cached results for ${drugName} from ${source}`);
        return cached.data;
      }

      // Fetch new results
      console.log(`Fetching fresh results for ${drugName} from ${source}`);
      const results = await fetchFunction(drugName);
      
      if (results && results.length > 0) {
        // Store in shared cache
        const resultHash = this.generateResultHash(results);
        await SharedDrugResult.findOneAndUpdate(
          { 
            drugName: normalizedDrugName,
            source: source 
          },
          {
            drugName: normalizedDrugName,
            source: source,
            resultHash: resultHash,
            data: results,
            lastUpdated: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
          },
          { upsert: true, new: true }
        );
      }

      return results;
    } catch (error) {
      console.error(`Error in getCachedOrFetchResults for ${source}:`, error);
      return [];
    }
  }

  // Process all watches that need checking
  async processWatches() {
    try {
      const watchesNeedingCheck = await DrugWatch.find({
        isActive: true,
        nextCheck: { $lte: new Date() }
      }).populate('userId');
      
      console.log(`Found ${watchesNeedingCheck.length} watches to process`);

      for (const watch of watchesNeedingCheck) {
        try {
          await this.processIndividualWatch(watch);
        } catch (error) {
          console.error(`Error processing watch ${watch._id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error in processWatches:', error);
    }
  }

  // Process an individual drug watch
  async processIndividualWatch(watch) {
    console.log(`Processing watch: ${watch.drugName} for user ${watch.userEmail}`);
    
    const allNewResults = [];
    const sources = watch.notificationSources;

    // Check each enabled source
    if (sources.fda) {
      const fdaResults = await this.checkFDAUpdates(watch);
      allNewResults.push(...fdaResults);
    }

    if (sources.clinicalTrials) {
      const ctResults = await this.checkClinicalTrialsUpdates(watch);
      allNewResults.push(...ctResults);
    }

    if (sources.pubmed) {
      const pubmedResults = await this.checkPubMedUpdates(watch);
      allNewResults.push(...pubmedResults);
    }

    if (sources.dailyMed) {
      const dailyMedResults = await this.checkDailyMedUpdates(watch);
      allNewResults.push(...dailyMedResults);
    }

    // Filter for truly new results
    const newResults = await this.filterNewResults(watch._id, allNewResults);

    // Store new results and send notification if any found
    if (newResults.length > 0) {
      console.log(`Found ${newResults.length} new results for watch ${watch._id}`);
      await this.storeNewResults(watch._id, newResults);
      
      // Send email notification
      if (this.emailTransporter && this.shouldSendNotification(watch, newResults)) {
        await this.sendUpdateNotification(watch, newResults);
        await watch.incrementNotificationCount();
      }
    }

    // Update last checked time
    await watch.updateLastChecked();
  }

  // Check FDA for updates
  async checkFDAUpdates(watch) {
    return await this.getCachedOrFetchResults(
      watch.drugName,
      'fda',
      async (drugName) => {
        try {
          const results = [];
          const searchVariations = [drugName, `*${drugName}*`];
          
          // Check FDA drug label endpoint
          for (const variation of searchVariations) {
            try {
              const labelUrl = `https://api.fda.gov/drug/label.json?search=openfda.brand_name:"${variation}"+OR+openfda.generic_name:"${variation}"&limit=10`;
              const response = await axios.get(labelUrl, { timeout: 30000 });
              
              if (response.data.results) {
                for (const item of response.data.results) {
                  const resultId = `fda_label_${item.id || crypto.randomBytes(8).toString('hex')}`;
                  results.push({
                    source: 'fda',
                    resultId: resultId,
                    title: `FDA Label Update: ${item.openfda?.brand_name?.[0] || drugName}`,
                    description: this.extractFDALabelSummary(item),
                    url: `https://labels.fda.gov/?search=${encodeURIComponent(drugName)}`,
                    publishedDate: new Date(item.effective_time || Date.now()),
                    metadata: {
                      type: 'label',
                      brandName: item.openfda?.brand_name?.[0],
                      genericName: item.openfda?.generic_name?.[0],
                      manufacturer: item.openfda?.manufacturer_name?.[0],
                      lastUpdated: item.effective_time
                    }
                  });
                }
              }
            } catch (error) {
              console.error(`FDA label search error for ${variation}:`, error.message);
            }
          }

          // Check FDA enforcement (recalls)
          try {
            const enforcementUrl = `https://api.fda.gov/drug/enforcement.json?search=product_description:"${drugName}"&limit=5`;
            const enfResponse = await axios.get(enforcementUrl, { timeout: 30000 });
            
            if (enfResponse.data.results) {
              for (const item of enfResponse.data.results) {
                results.push({
                  source: 'fda',
                  resultId: `fda_recall_${item.recall_number}`,
                  title: `FDA Recall: ${item.product_description}`,
                  description: item.reason_for_recall || 'Recall issued',
                  url: `https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts`,
                  publishedDate: new Date(item.recall_initiation_date || Date.now()),
                  metadata: {
                    type: 'recall',
                    classification: item.classification,
                    recallNumber: item.recall_number,
                    status: item.status
                  }
                });
              }
            }
          } catch (error) {
            console.error(`FDA enforcement search error:`, error.message);
          }

          return results;
        } catch (error) {
          console.error('Error checking FDA updates:', error);
          return [];
        }
      }
    );
  }

  // Check ClinicalTrials.gov for updates
  async checkClinicalTrialsUpdates(watch) {
    return await this.getCachedOrFetchResults(
      watch.drugName,
      'clinicalTrials',
      async (drugName) => {
        try {
          const results = [];
          const filters = watch.searchFilters || {};
          
          // Build query parameters for new API format
          const queryParams = {
            'query.intr': drugName,
            format: 'json',
            pageSize: 20,
            countTotal: true,
            fields: 'NCTId,BriefTitle,OverallStatus,StartDate,CompletionDate,Phase,Condition,BriefSummary,LastUpdatePostDate,StudyType,PrimaryOutcomeMeasure'
          };

          // Add condition if specified
          if (watch.condition) {
            queryParams['query.cond'] = watch.condition;
          }

          // Add results filter if specified
          if (filters.hasResultsOnly) {
            queryParams['aggFilters'] = 'results:with';
          }

          // Add date filter based on yearsBack
          if (filters.yearsBack) {
            const cutoffDate = new Date();
            cutoffDate.setFullYear(cutoffDate.getFullYear() - filters.yearsBack);
            queryParams['filter.advanced'] = `AREA[LastUpdatePostDate]RANGE[${cutoffDate.toISOString().split('T')[0]}, MAX]`;
          }

          const url = 'https://clinicaltrials.gov/api/v2/studies';
          const response = await axios.get(url, { 
            params: queryParams,
            timeout: 30000 
          });

          if (response.data.studies) {
            for (const study of response.data.studies) {
              const protocolSection = study.protocolSection || {};
              const identificationModule = protocolSection.identificationModule || {};
              const statusModule = protocolSection.statusModule || {};
              const descriptionModule = protocolSection.descriptionModule || {};
              
              results.push({
                source: 'clinicalTrials',
                resultId: `ct_${identificationModule.nctId}`,
                title: identificationModule.briefTitle || `Study ${identificationModule.nctId}`,
                description: descriptionModule.briefSummary || 'No description available',
                url: `https://clinicaltrials.gov/study/${identificationModule.nctId}`,
                publishedDate: new Date(statusModule.lastUpdatePostDateStruct?.date || Date.now()),
                metadata: {
                  nctId: identificationModule.nctId,
                  status: statusModule.overallStatus,
                  phase: statusModule.phases?.join(', ') || 'N/A',
                  conditions: protocolSection.conditionsModule?.conditions || [],
                  startDate: statusModule.startDateStruct?.date,
                  completionDate: statusModule.completionDateStruct?.date,
                  hasResults: study.hasResults || false
                }
              });
            }
          }

          return results;
        } catch (error) {
          console.error('Error checking Clinical Trials updates:', error);
          return [];
        }
      }
    );
  }

  // Check PubMed for updates
  async checkPubMedUpdates(watch) {
    return await this.getCachedOrFetchResults(
      watch.drugName,
      'pubmed',
      async (drugName) => {
        try {
          const results = [];
          const filters = watch.searchFilters || {};
          
          // Build PubMed search query
          let searchTerm = filters.exactMatch ? `"${drugName}"[Title/Abstract]` : `${drugName}[Title/Abstract]`;
          
          if (watch.condition) {
            searchTerm += ` AND ${watch.condition}[Title/Abstract]`;
          }

          // Add date filter
          const yearsBack = filters.yearsBack || 1;
          const dateFilter = `${new Date().getFullYear() - yearsBack}:${new Date().getFullYear()}[dp]`;
          searchTerm += ` AND ${dateFilter}`;

          // First, search for article IDs
          const searchUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
          const searchParams = {
            db: 'pubmed',
            term: searchTerm,
            retmode: 'json',
            retmax: 20,
            sort: 'relevance'
          };

          const searchResponse = await axios.get(searchUrl, { 
            params: searchParams,
            timeout: 30000 
          });

          if (searchResponse.data.esearchresult?.idlist) {
            const ids = searchResponse.data.esearchresult.idlist;
            
            if (ids.length > 0) {
              // Fetch article details
              const summaryUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi';
              const summaryParams = {
                db: 'pubmed',
                id: ids.join(','),
                retmode: 'json'
              };

              const summaryResponse = await axios.get(summaryUrl, { 
                params: summaryParams,
                timeout: 30000 
              });

              if (summaryResponse.data.result) {
                for (const pmid of ids) {
                  const article = summaryResponse.data.result[pmid];
                  if (article && article.uid) {
                    results.push({
                      source: 'pubmed',
                      resultId: `pubmed_${article.uid}`,
                      title: article.title || 'Untitled',
                      description: this.extractPubMedSummary(article),
                      url: `https://pubmed.ncbi.nlm.nih.gov/${article.uid}/`,
                      publishedDate: new Date(article.pubdate || article.epubdate || Date.now()),
                      metadata: {
                        pmid: article.uid,
                        authors: article.authors?.map(a => a.name).slice(0, 3),
                        journal: article.source,
                        pubType: article.pubtype,
                        doi: article.elocationid
                      }
                    });
                  }
                }
              }
            }
          }

          return results;
        } catch (error) {
          console.error('Error checking PubMed updates:', error);
          return [];
        }
      }
    );
  }

  // Check DailyMed for updates
  async checkDailyMedUpdates(watch) {
    return await this.getCachedOrFetchResults(
      watch.drugName,
      'dailyMed',
      async (drugName) => {
        try {
          const results = [];
          
          // DailyMed REST API endpoint
          const searchUrl = 'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json';
          const searchParams = {
            drug_name: drugName,
            pagesize: 10,
            page: 1
          };

          const response = await axios.get(searchUrl, { 
            params: searchParams,
            timeout: 30000 
          });

          if (response.data.data) {
            for (const item of response.data.data) {
              // Get detailed SPL document info
              try {
                const splUrl = `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${item.setid}.json`;
                const splResponse = await axios.get(splUrl, { timeout: 30000 });
                const splData = splResponse.data.data?.[0] || {};

                results.push({
                  source: 'dailyMed',
                  resultId: `dailymed_${item.setid}`,
                  title: `${splData.title || item.title || drugName} - Package Insert`,
                  description: this.extractDailyMedSummary(splData),
                  url: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${item.setid}`,
                  publishedDate: new Date(splData.published_date || item.published_date || Date.now()),
                  metadata: {
                    setId: item.setid,
                    splVersion: splData.spl_version,
                    labeler: splData.labeler,
                    marketingStatus: splData.marketing_status,
                    packageNdc: splData.package_ndc,
                    lastModified: splData.effective_time
                  }
                });
              } catch (splError) {
                console.error(`Error fetching SPL details for ${item.setid}:`, splError.message);
              }
            }
          }

          return results;
        } catch (error) {
          console.error('Error checking DailyMed updates:', error);
          return [];
        }
      }
    );
  }

  // Extract FDA label summary
  extractFDALabelSummary(labelData) {
    const sections = [];
    
    if (labelData.indications_and_usage) {
      sections.push(`Indications: ${labelData.indications_and_usage[0].substring(0, 200)}...`);
    }
    
    if (labelData.warnings) {
      sections.push(`Warnings: ${labelData.warnings[0].substring(0, 200)}...`);
    }
    
    if (labelData.recent_major_changes) {
      sections.push(`Recent changes: ${labelData.recent_major_changes[0]}`);
    }
    
    return sections.join(' | ') || 'FDA drug label information';
  }

  // Extract PubMed summary
  extractPubMedSummary(article) {
    const parts = [];
    
    if (article.authors?.length > 0) {
      parts.push(`Authors: ${article.authors.slice(0, 3).map(a => a.name).join(', ')}${article.authors.length > 3 ? ' et al.' : ''}`);
    }
    
    if (article.source) {
      parts.push(`Journal: ${article.source}`);
    }
    
    if (article.pubdate) {
      parts.push(`Published: ${article.pubdate}`);
    }
    
    return parts.join(' | ') || 'PubMed article';
  }

  // Extract DailyMed summary
  extractDailyMedSummary(splData) {
    const parts = [];
    
    if (splData.labeler) {
      parts.push(`Labeler: ${splData.labeler}`);
    }
    
    if (splData.marketing_status) {
      parts.push(`Status: ${splData.marketing_status}`);
    }
    
    if (splData.dosage_form) {
      parts.push(`Form: ${splData.dosage_form}`);
    }
    
    return parts.join(' | ') || 'DailyMed package insert';
  }

  // Filter for truly new results
  async filterNewResults(watchId, results) {
    const newResults = [];
    
    for (const result of results) {
      // Check if we already have this result
      const existing = await DrugWatchResult.findOne({
        watchId: watchId,
        source: result.source,
        resultId: result.resultId
      });
      
      if (!existing) {
        newResults.push(result);
      } else {
        // Check if content has changed significantly
        const existingHash = this.generateResultHash(existing.metadata || {});
        const newHash = this.generateResultHash(result.metadata || {});
        
        if (existingHash !== newHash) {
          // Mark as updated result
          result.isUpdate = true;
          result.previousData = existing;
          newResults.push(result);
        }
      }
    }
    
    return newResults;
  }

  // Check if notification should be sent based on frequency
  shouldSendNotification(watch, newResults) {
    if (watch.notificationFrequency === 'immediate') {
      return true;
    }
    
    // For other frequencies, check if enough results accumulated
    if (watch.notificationFrequency === 'daily' && newResults.length >= 5) {
      return true;
    }
    
    if (watch.notificationFrequency === 'weekly' && newResults.length >= 10) {
      return true;
    }
    
    // Always send if it's been the full period since last notification
    const now = new Date();
    return now >= watch.nextCheck;
  }

  // Store new results in database
  async storeNewResults(watchId, results) {
    try {
      const resultsToStore = results.map(result => ({
        watchId: watchId,
        ...result,
        isNew: !result.isUpdate,
        createdAt: new Date()
      }));

      await DrugWatchResult.insertMany(resultsToStore);
      console.log(`Stored ${resultsToStore.length} results for watch ${watchId}`);
      
      return resultsToStore.length;
    } catch (error) {
      console.error('Error storing new results:', error);
      return 0;
    }
  }

  // Send email notification with changes highlighted
  async sendUpdateNotification(watch, newResults) {
    try {
      if (!this.emailTransporter) {
        console.log('Email transporter not available');
        return;
      }

      const emailSubject = `🔔 Drug Watch Update: ${watch.drugName}${watch.condition ? ` (${watch.condition})` : ''}`;
      const emailBody = this.generateEnhancedEmailBody(watch, newResults);

      const mailOptions = {
        from: process.env.SMTP_FROM || 'noreply@drugwatch.com',
        to: watch.notificationEmail,
        subject: emailSubject,
        html: emailBody
      };

      await this.emailTransporter.sendMail(mailOptions);
      console.log(`Email sent to ${watch.notificationEmail} for watch ${watch._id}`);

      // Mark results as notified
      await DrugWatchResult.updateMany(
        { 
          watchId: watch._id,
          _id: { $in: newResults.map(r => r._id) }
        },
        {
          notificationSent: true,
          notificationSentAt: new Date()
        }
      );

    } catch (error) {
      console.error('Error sending email notification:', error);
    }
  }

  // Generate enhanced HTML email body
  generateEnhancedEmailBody(watch, newResults) {
    // Group results by source
    const resultsBySource = {};
    for (const result of newResults) {
      if (!resultsBySource[result.source]) {
        resultsBySource[result.source] = [];
      }
      resultsBySource[result.source].push(result);
    }

    // Source display names
    const sourceNames = {
      fda: 'FDA',
      clinicalTrials: 'Clinical Trials',
      pubmed: 'PubMed',
      dailyMed: 'DailyMed',
      ema: 'EMA'
    };

    // Source colors
    const sourceColors = {
      fda: '#0066CC',
      clinicalTrials: '#006400',
      pubmed: '#8B0000',
      dailyMed: '#FF6600',
      ema: '#003399'
    };

    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                background-color: #f5f5f5;
                margin: 0;
                padding: 0;
            }
            .container { 
                max-width: 600px;
                margin: 20px auto;
                background: white;
                border-radius: 12px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                overflow: hidden;
            }
            .header { 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 30px;
                text-align: center;
            }
            .header h1 {
                margin: 0 0 10px 0;
                font-size: 28px;
                font-weight: 600;
            }
            .header p {
                margin: 0;
                opacity: 0.9;
                font-size: 16px;
            }
            .content {
                padding: 30px;
            }
            .summary-box {
                background: #f8f9fa;
                border-radius: 8px;
                padding: 20px;
                margin-bottom: 30px;
                border-left: 4px solid #667eea;
            }
            .summary-box h3 {
                margin: 0 0 15px 0;
                color: #2d3748;
            }
            .summary-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 15px;
                margin-top: 15px;
            }
            .summary-item {
                font-size: 14px;
            }
            .summary-item strong {
                color: #4a5568;
            }
            .source-section {
                margin-bottom: 30px;
            }
            .source-header {
                display: flex;
                align-items: center;
                margin-bottom: 20px;
                padding-bottom: 10px;
                border-bottom: 2px solid #e2e8f0;
            }
            .source-icon {
                width: 40px;
                height: 40px;
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                margin-right: 15px;
                font-size: 14px;
            }
            .source-title {
                flex-grow: 1;
            }
            .source-title h3 {
                margin: 0;
                color: #2d3748;
                font-size: 20px;
            }
            .source-count {
                background: #e2e8f0;
                color: #4a5568;
                padding: 4px 12px;
                border-radius: 20px;
                font-size: 14px;
                font-weight: 500;
            }
            .result-item {
                background: #ffffff;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 20px;
                margin-bottom: 15px;
                transition: all 0.2s ease;
            }
            .result-item:hover {
                box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                transform: translateY(-1px);
            }
            .result-item.new {
                border-left: 4px solid #48bb78;
            }
            .result-item.updated {
                border-left: 4px solid #ed8936;
            }
            .result-badge {
                display: inline-block;
                padding: 3px 8px;
                border-radius: 4px;
                font-size: 11px;
                font-weight: 600;
                text-transform: uppercase;
                margin-bottom: 10px;
            }
            .badge-new {
                background: #48bb78;
                color: white;
            }
            .badge-updated {
                background: #ed8936;
                color: white;
            }
            .result-title {
                font-weight: 600;
                font-size: 16px;
                margin-bottom: 10px;
                color: #2d3748;
            }
            .result-description {
                color: #4a5568;
                font-size: 14px;
                margin-bottom: 12px;
                line-height: 1.5;
            }
            .result-meta {
                display: flex;
                flex-wrap: wrap;
                gap: 15px;
                margin-bottom: 12px;
                font-size: 13px;
                color: #718096;
            }
            .result-meta-item {
                display: flex;
                align-items: center;
            }
            .result-meta-item svg {
                width: 16px;
                height: 16px;
                margin-right: 5px;
                opacity: 0.6;
            }
            .result-link {
                display: inline-block;
                color: #667eea;
                text-decoration: none;
                font-size: 14px;
                font-weight: 500;
                padding: 8px 16px;
                border: 1px solid #667eea;
                border-radius: 6px;
                transition: all 0.2s ease;
            }
            .result-link:hover {
                background: #667eea;
                color: white;
            }
            .change-highlight {
                background: #fef3c7;
                padding: 10px;
                border-radius: 6px;
                margin-top: 10px;
                font-size: 13px;
                border-left: 3px solid #f59e0b;
            }
            .change-highlight strong {
                color: #92400e;
            }
            .footer {
                background: #f7fafc;
                padding: 30px;
                text-align: center;
                font-size: 14px;
                color: #718096;
                border-top: 1px solid #e2e8f0;
            }
            .footer a {
                color: #667eea;
                text-decoration: none;
            }
            .button {
                display: inline-block;
                padding: 12px 24px;
                background: #667eea;
                color: white;
                text-decoration: none;
                border-radius: 6px;
                font-weight: 500;
                margin: 10px 5px;
            }
            .button.secondary {
                background: #e2e8f0;
                color: #4a5568;
            }
            @media (max-width: 600px) {
                .summary-grid {
                    grid-template-columns: 1fr;
                }
                .result-meta {
                    flex-direction: column;
                    gap: 8px;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🔬 Drug Watch Update</h1>
                <p>New information available for your monitored drug</p>
            </div>
            
            <div class="content">
                <div class="summary-box">
                    <h3>Watch Summary</h3>
                    <div class="summary-grid">
                        <div class="summary-item">
                            <strong>Drug Name:</strong><br>${watch.drugName}
                        </div>
                        <div class="summary-item">
                            <strong>Watch Name:</strong><br>${watch.watchName}
                        </div>
                        ${watch.condition ? `
                        <div class="summary-item">
                            <strong>Condition:</strong><br>${watch.condition}
                        </div>
                        ` : ''}
                        <div class="summary-item">
                            <strong>Total Updates:</strong><br>${newResults.length} new item${newResults.length !== 1 ? 's' : ''}
                        </div>
                    </div>
                </div>
    `;

    // Add results grouped by source
    for (const [source, results] of Object.entries(resultsBySource)) {
        const sourceName = sourceNames[source] || source;
        const sourceColor = sourceColors[source] || '#666';
        
        html += `
                <div class="source-section">
                    <div class="source-header">
                        <div class="source-icon" style="background: ${sourceColor};">
                            ${sourceName.substring(0, 2).toUpperCase()}
                        </div>
                        <div class="source-title">
                            <h3>${sourceName} Updates</h3>
                        </div>
                        <div class="source-count">${results.length}</div>
                    </div>
        `;

        // Add individual results
        for (const result of results) {
            const isUpdate = result.isUpdate || false;
            const badgeClass = isUpdate ? 'badge-updated' : 'badge-new';
            const badgeText = isUpdate ? 'Updated' : 'New';
            const resultClass = isUpdate ? 'updated' : 'new';
            
            html += `
                    <div class="result-item ${resultClass}">
                        <span class="result-badge ${badgeClass}">${badgeText}</span>
                        <div class="result-title">${this.escapeHtml(result.title)}</div>
                        <div class="result-description">${this.escapeHtml(result.description)}</div>
                        
                        <div class="result-meta">
            `;

            // Add metadata based on source
            if (result.publishedDate) {
                html += `
                            <div class="result-meta-item">
                                <svg fill="currentColor" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zM4 8h12v8H4V8z" clip-rule="evenodd"/>
                                </svg>
                                ${new Date(result.publishedDate).toLocaleDateString()}
                            </div>
                `;
            }

            // Source-specific metadata
            if (source === 'clinicalTrials' && result.metadata) {
                if (result.metadata.status) {
                    html += `
                            <div class="result-meta-item">
                                <svg fill="currentColor" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                                </svg>
                                ${result.metadata.status}
                            </div>
                    `;
                }
                if (result.metadata.phase) {
                    html += `
                            <div class="result-meta-item">
                                <svg fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/>
                                    <path fill-rule="evenodd" d="M4 5a2 2 0 012-2 1 1 0 000 2H6a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 00-2-2v-6z" clip-rule="evenodd"/>
                                </svg>
                                ${result.metadata.phase}
                            </div>
                    `;
                }
            }

            if (source === 'fda' && result.metadata) {
                if (result.metadata.type) {
                    html += `
                            <div class="result-meta-item">
                                <svg fill="currentColor" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm3 1h6v4H7V5zm6 6H7v2h6v-2z" clip-rule="evenodd"/>
                                </svg>
                                ${result.metadata.type.charAt(0).toUpperCase() + result.metadata.type.slice(1)}
                            </div>
                    `;
                }
            }

            html += `
                        </div>
            `;

            // Add change highlights for updated results
            if (isUpdate && result.previousData) {
                html += `
                        <div class="change-highlight">
                            <strong>What changed:</strong> This item was previously tracked and has been updated.
                        </div>
                `;
            }

            // Add view details link
            if (result.url) {
                html += `
                        <div style="margin-top: 15px;">
                            <a href="${result.url}" class="result-link" target="_blank">View Details →</a>
                        </div>
                `;
            }

            html += `
                    </div>
            `;
        }

        html += `
                </div>
        `;
    }

    // Add footer
    html += `
            </div>
            
            <div class="footer">
                <p style="margin-bottom: 20px;">
                    <strong>What's next?</strong><br>
                    We'll continue monitoring and notify you of any new updates based on your preferences.
                </p>
                
                <div>
                    <a href="#" class="button">Manage Watches</a>
                    <a href="#" class="button secondary">Update Preferences</a>
                </div>
                
                <p style="margin-top: 30px; font-size: 12px; color: #a0aec0;">
                    This is an automated notification from your Drug Watch system.<br>
                    Email sent to ${watch.notificationEmail} • ${new Date().toLocaleDateString()}<br>
                    <a href="#">Unsubscribe</a> • <a href="#">Privacy Policy</a>
                </p>
            </div>
        </div>
    </body>
    </html>
    `;

    return html;
  }

  // Helper function to escape HTML
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  // Clean up expired cache entries
  async cleanupExpiredCache() {
    try {
      const result = await SharedDrugResult.deleteMany({
        expiresAt: { $lt: new Date() }
      });
      console.log(`Cleaned up ${result.deletedCount} expired cache entries`);
    } catch (error) {
      console.error('Error cleaning up cache:', error);
    }
  }
}

// Initialize the service
let drugWatchService;

// =================================================================
// ENHANCED API ROUTES
// =================================================================

// Get all drug watches for a user with pagination
router.get('/drug-watches/:userEmail', async (req, res) => {
  try {
    const { userEmail } = req.params;
    const { page = 1, limit = 10, status = 'all' } = req.query;
    
    console.log(`Fetching drug watches for user email: ${userEmail}`);
    
    const query = { userEmail: userEmail };
    if (status !== 'all') {
      query.isActive = status === 'active';
    }
    
    const totalCount = await DrugWatch.countDocuments(query);
    
    const watches = await DrugWatch.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    // Add recent results count for each watch
    for (const watch of watches) {
      const recentResultsCount = await DrugWatchResult.countDocuments({
        watchId: watch._id,
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      });
      watch.recentResultsCount = recentResultsCount;
    }

    res.json({
      success: true,
      watches: watches,
      pagination: {
        total: totalCount,
        page: parseInt(page),
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching drug watches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch drug watches',
      error: error.message
    });
  }
});

// Get watch details with recent results
router.get('/drug-watches/:watchId/details', async (req, res) => {
  try {
    const { watchId } = req.params;
    
    const watch = await DrugWatch.findById(watchId).lean();
    if (!watch) {
      return res.status(404).json({
        success: false,
        message: 'Drug watch not found'
      });
    }

    // Get recent results
    const recentResults = await DrugWatchResult.find({
      watchId: watchId
    })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

    res.json({
      success: true,
      watch: watch,
      recentResults: recentResults
    });
  } catch (error) {
    console.error('Error fetching watch details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch watch details',
      error: error.message
    });
  }
});

// Create a new drug watch
router.post('/drug-watches', async (req, res) => {
  try {
    const {
      userEmail,
      watchName,
      drugName,
      condition,
      notificationSources,
      notificationEmail,
      notificationFrequency,
      searchFilters
    } = req.body;

    console.log('Creating drug watch with data:', {
      userEmail,
      watchName,
      drugName,
      condition
    });

    // Validate required fields
    if (!userEmail || !drugName || !notificationEmail) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: userEmail, drugName, notificationEmail'
      });
    }

    // Find or create user by email
    let user = await User.findOne({ email: userEmail });
    if (!user) {
      // Create a basic user record if it doesn't exist
      const { hash, salt } = User.hashPassword('temporary_password');
      user = new User({
        username: userEmail.split('@')[0],
        email: userEmail,
        passwordHash: hash,
        salt: salt
      });
      await user.save();
    }

    // Create the drug watch
    const drugWatch = new DrugWatch({
      userId: user._id,
      userEmail: userEmail,
      watchName: watchName || `${drugName} Watch`,
      drugName,
      condition,
      notificationSources: notificationSources || {
        ema: false,
        fda: true,
        clinicalTrials: true,
        pubmed: true,
        dailyMed: true
      },
      notificationEmail,
      notificationFrequency: notificationFrequency || 'weekly',
      searchFilters: searchFilters || {
        hasResultsOnly: false,
        exactMatch: false,
        yearsBack: 1
      }
    });

    await drugWatch.save();
    console.log(`Drug watch created with ID: ${drugWatch._id}`);

    // Trigger initial check
    if (drugWatchService) {
      setTimeout(() => {
        drugWatchService.processIndividualWatch(drugWatch).catch(err => {
          console.error('Error in initial watch check:', err);
        });
      }, 1000);
    }

    res.status(201).json({
      success: true,
      message: 'Drug watch created successfully',
      watch: drugWatch
    });

  } catch (error) {
    console.error('Error creating drug watch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create drug watch',
      error: error.message
    });
  }
});

// Update drug watch
router.put('/drug-watches/:watchId', async (req, res) => {
  try {
    const { watchId } = req.params;
    const updates = req.body;
    
    const watch = await DrugWatch.findByIdAndUpdate(
      watchId,
      { 
        ...updates,
        updatedAt: new Date()
      },
      { new: true, runValidators: true }
    );
    
    if (!watch) {
      return res.status(404).json({
        success: false,
        message: 'Drug watch not found'
      });
    }

    res.json({
      success: true,
      message: 'Drug watch updated successfully',
      watch: watch
    });

  } catch (error) {
    console.error('Error updating drug watch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update drug watch',
      error: error.message
    });
  }
});

// Toggle drug watch active status
router.patch('/drug-watches/:watchId/toggle', async (req, res) => {
  try {
    const { watchId } = req.params;
    console.log(`Toggling watch status for ID: ${watchId}`);
    
    if (!mongoose.Types.ObjectId.isValid(watchId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid watch ID format'
      });
    }
    
    const watch = await DrugWatch.findById(watchId);
    if (!watch) {
      return res.status(404).json({
        success: false,
        message: 'Drug watch not found'
      });
    }

    watch.isActive = !watch.isActive;
    watch.updatedAt = new Date();
    await watch.save();

    res.json({
      success: true,
      message: `Drug watch ${watch.isActive ? 'activated' : 'paused'}`,
      watch: watch
    });

  } catch (error) {
    console.error('Error toggling drug watch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle drug watch',
      error: error.message
    });
  }
});

// Delete drug watch
router.delete('/drug-watches/:watchId', async (req, res) => {
  try {
    const { watchId } = req.params;
    console.log(`Deleting drug watch with ID: ${watchId}`);
    
    if (!mongoose.Types.ObjectId.isValid(watchId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid watch ID format'
      });
    }
    
    const watch = await DrugWatch.findById(watchId);
    if (!watch) {
      return res.status(404).json({
        success: false,
        message: 'Drug watch not found'
      });
    }

    // Delete associated results
    await DrugWatchResult.deleteMany({ watchId: watchId });
    
    // Delete the watch
    await DrugWatch.findByIdAndDelete(watchId);

    res.json({
      success: true,
      message: 'Drug watch deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting drug watch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete drug watch',
      error: error.message
    });
  }
});

// Manual trigger for watch check
router.post('/drug-watches/:watchId/trigger', async (req, res) => {
  try {
    const { watchId } = req.params;
    console.log(`Manual trigger for watch ID: ${watchId}`);
    
    if (!mongoose.Types.ObjectId.isValid(watchId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid watch ID format'
      });
    }
    
    const watch = await DrugWatch.findById(watchId);
    if (!watch) {
      return res.status(404).json({
        success: false,
        message: 'Drug watch not found'
      });
    }

    if (drugWatchService) {
      // Process in background
      drugWatchService.processIndividualWatch(watch)
        .then(() => {
          console.log(`Manual trigger completed for watch ${watchId}`);
        })
        .catch(err => {
          console.error(`Error in manual trigger for watch ${watchId}:`, err);
        });

      res.json({
        success: true,
        message: 'Watch check initiated. You will receive an email if there are any updates.'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Drug watch service not initialized'
      });
    }
  } catch (error) {
    console.error('Error in manual trigger:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to trigger watch check',
      error: error.message
    });
  }
});

// Get system status
router.get('/drug-watches/system/status', async (req, res) => {
  try {
    const activeWatches = await DrugWatch.countDocuments({ isActive: true });
    const totalWatches = await DrugWatch.countDocuments();
    const totalResults = await DrugWatchResult.countDocuments();
    const cacheSize = await SharedDrugResult.countDocuments();
    const cacheExpired = await SharedDrugResult.countDocuments({ 
      expiresAt: { $lt: new Date() } 
    });

    res.json({
      success: true,
      status: {
        activeWatches,
        totalWatches,
        totalResults,
        cache: {
          size: cacheSize,
          expired: cacheExpired
        },
        serviceRunning: drugWatchService ? drugWatchService.isRunning : false,
        lastUpdate: new Date()
      }
    });

  } catch (error) {
    console.error('Error getting system status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get system status',
      error: error.message
    });
  }
});

// Health check endpoint
router.get('/drug-watches/health', async (req, res) => {
  try {
    // Test database connection
    const dbTest = await DrugWatch.countDocuments();
    
    res.json({
      success: true,
      health: {
        database: 'connected',
        scheduler: drugWatchService ? (drugWatchService.isRunning ? 'running' : 'stopped') : 'not initialized',
        totalWatches: dbTest,
        timestamp: new Date()
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      health: {
        database: 'disconnected',
        scheduler: 'unknown',
        error: error.message,
        timestamp: new Date()
      }
    });
  }
});

// Initialize the drug watch service
const initializeDrugWatchService = () => {
  try {
    console.log('Initializing Enhanced Drug Watch Service...');
    drugWatchService = new EnhancedDrugWatchService();
    console.log('Enhanced Drug Watch Service initialized successfully');
    return drugWatchService;
  } catch (error) {
    console.error('Error initializing Drug Watch Service:', error);
    return null;
  }
};

// Export everything needed
module.exports = {
  router,
  drugWatchService,
  EnhancedDrugWatchService,
  initializeDrugWatchService,
  SharedDrugResult
};