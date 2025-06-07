// biomarkerRoutes.js - Modular routes for biomarker enrichment analysis
const express = require('express');
const router = express.Router();
const axios = require('axios');
const xml2js = require('xml2js');
const NodeCache = require('node-cache');

// Initialize cache (30 min TTL)
const cache = new NodeCache({ stdTTL: 1800 });

// Enhanced Biomarker Detection Patterns
const BIOMARKER_PATTERNS = {
    genetic: {
        patterns: [
            /\b([A-Z0-9]{2,})[+-]?\s*(?:mutation|variant|polymorphism|deletion|insertion|amplification)/gi,
            /\b(rs\d{4,})\b/gi,
            /\b([A-Z0-9]{2,})[-\s]*(p\.[A-Z]\d+[A-Z])\b/gi,
            /\b([A-Z0-9]{2,})[-\s]*(c\.\d+[A-Z]>[A-Z])\b/gi
        ],
        keywords: ['mutation', 'variant', 'deletion', 'amplification', 'gene', 'genetic']
    },
    protein: {
        patterns: [
            /\b(PD-?L?1|HER2|EGFR|ALK|ROS1|BRAF|MEK|mTOR|VEGF[R]?|CD\d+)\b/gi,
            /\b([A-Z]{2,}[-\s]?\d*)\s*(?:positive|negative|expression|overexpression)/gi
        ],
        keywords: ['expression', 'positive', 'negative', 'receptor', 'protein']
    },
    metabolic: {
        patterns: [
            /\b(CYP[0-9][A-Z][0-9]+(?:\*\d+)?)\b/gi,
            /\b(UGT[0-9][A-Z][0-9]+)\b/gi,
            /\b(NAT[12])\b/gi,
            /\b(TPMT|DPYD|G6PD)\b/gi
        ],
        keywords: ['metabolizer', 'metabolism', 'enzyme', 'pharmacogenetic']
    },
    hla: {
        patterns: [
            /HLA-[A-Z]\*?\d{2}:?\d{0,2}/gi,
            /HLA-[A-Z][A-Z]?\d*/gi
        ],
        keywords: ['HLA', 'allele', 'haplotype']
    },
    chromosomal: {
        patterns: [
            /\b(?:trisomy|monosomy|chromosome)\s*\d+/gi,
            /\b(?:t|inv|del|dup)\(\d+[pq]?[;\d]*\)/gi,
            /\b\d+[pq]\d+(?:\.\d+)?/gi
        ],
        keywords: ['chromosomal', 'cytogenetic', 'karyotype', 'translocation']
    }
};

// Enhanced FDA Precedent Database
const precedentDatabase = [
    {
        id: 'ivacaftor-kalydeco',
        drug: 'Ivacaftor (Kalydeco)',
        biomarker: 'CFTR G551D mutation',
        biomarkerType: 'genetic',
        division: 'Pulmonary',
        nctId: 'NCT00909532',
        phase: 'Phase 3',
        title: 'STRIVE: Study of VX-770 in CF Patients with G551D-CFTR',
        enrollment: {
            total: 161,
            biomarkerPositive: 161,
            biomarkerNegative: 0,
            percentPositive: 100,
            percentNegative: 0
        },
        trialDesign: {
            type: 'Complete enrichment strategy',
            description: 'Only patients with G551D mutation enrolled',
            rationale: 'Drug mechanism requires specific CFTR gating mutation',
            controlArm: 'Placebo (also G551D positive)'
        },
        biomarkerStrategy: '100% biomarker-positive enrichment',
        results: {
            primaryEndpoint: 'FEV1 improvement',
            biomarkerPositive: {
                fev1Improvement: '10.6%',
                responseRate: '83%',
                sweatChloride: '-47.9 mmol/L',
                pValue: '<0.001'
            },
            biomarkerNegative: 'Not enrolled - drug ineffective without mutation'
        },
        fdaApproval: {
            date: 'January 31, 2012',
            nda: '203188',
            summary: 'FDA approved for G551D mutation only',
            expansions: 'Later expanded to 38 CFTR mutations',
            fdaReviewLink: 'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2012/203188_kalydeco_toc.cfm'
        },
        dataQuality: 'High',
        precedentStrength: 'Maximum'
    },
    {
        id: 'crizotinib-xalkori',
        drug: 'Crizotinib (Xalkori)',
        biomarker: 'ALK gene rearrangement',
        biomarkerType: 'genetic',
        division: 'Oncology',
        nctId: 'NCT00932451',
        phase: 'Phase 2',
        title: 'PROFILE 1001: Study of PF-02341066 in ALK-positive NSCLC',
        enrollment: {
            total: 149,
            biomarkerPositive: 149,
            biomarkerNegative: 0,
            percentPositive: 100,
            percentNegative: 0
        },
        trialDesign: {
            type: 'Complete enrichment strategy',
            description: 'Only ALK-positive patients enrolled',
            rationale: 'Targeted inhibitor specific to ALK fusion protein',
            controlArm: 'None - single arm study'
        },
        biomarkerStrategy: '100% biomarker-positive enrichment',
        results: {
            primaryEndpoint: 'Overall response rate',
            biomarkerPositive: {
                responseRate: '60.8%',
                medianPFS: '9.7 months',
                diseaseControl: '90.1%',
                pValue: '<0.001'
            },
            biomarkerNegative: 'Not enrolled - no activity in ALK-negative'
        },
        fdaApproval: {
            date: 'August 26, 2011',
            nda: '202570',
            summary: 'Accelerated approval for ALK-positive NSCLC',
            fdaReviewLink: 'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2011/202570_xalkori_toc.cfm'
        },
        dataQuality: 'High',
        precedentStrength: 'Maximum'
    },
    {
        id: 'eliglustat-cerdelga',
        drug: 'Eliglustat (Cerdelga)',
        biomarker: 'CYP2D6 genotype',
        biomarkerType: 'metabolic',
        division: 'Metabolic',
        nctId: 'NCT00358150',
        phase: 'Phase 3',
        title: 'ENGAGE: Eliglustat vs Imiglucerase in Gaucher Disease',
        enrollment: {
            total: 40,
            biomarkerPositive: 35,
            biomarkerNegative: 5,
            percentPositive: 87.5,
            percentNegative: 12.5
        },
        trialDesign: {
            type: 'Stratified enrichment',
            description: 'Enrollment stratified by CYP2D6 metabolizer status',
            rationale: 'Drug metabolism heavily dependent on CYP2D6',
            controlArm: 'Active comparator (imiglucerase)'
        },
        biomarkerStrategy: 'CYP2D6 stratified dosing strategy',
        results: {
            primaryEndpoint: 'Spleen volume reduction',
            biomarkerPositive: {
                spleenReduction: '-30.0%',
                liverReduction: '-6.6%',
                plateletIncrease: '32%',
                pValue: '<0.001'
            },
            biomarkerNegative: 'Ultra-rapid metabolizers excluded from approval'
        },
        fdaApproval: {
            date: 'August 19, 2014',
            nda: '205494',
            summary: 'Approved with CYP2D6 genotyping requirement',
            restrictions: 'Not for CYP2D6 ultra-rapid or indeterminate metabolizers',
            fdaReviewLink: 'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2014/205494Orig1s000TOC.cfm'
        },
        dataQuality: 'High',
        precedentStrength: 'High'
    },
    {
        id: 'valbenazine-ingrezza',
        drug: 'Valbenazine (Ingrezza)',
        biomarker: 'CYP2D6 genotype',
        biomarkerType: 'metabolic',
        division: 'Neurology',
        nctId: 'NCT02274558',
        phase: 'Phase 3',
        title: 'KINECT 3: Valbenazine for Tardive Dyskinesia',
        enrollment: {
            total: 234,
            biomarkerPositive: 210,
            biomarkerNegative: 24,
            percentPositive: 89.7,
            percentNegative: 10.3
        },
        trialDesign: {
            type: 'Dose adjustment by genotype',
            description: 'CYP2D6 poor metabolizers received adjusted dosing',
            rationale: 'Significant exposure differences by metabolizer status',
            controlArm: 'Placebo'
        },
        biomarkerStrategy: 'Genotype-guided dosing',
        results: {
            primaryEndpoint: 'AIMS score improvement',
            biomarkerPositive: {
                aimsImprovement: '-3.2 points',
                responseRate: '40%',
                cgicResponse: '67%',
                pValue: '<0.001'
            },
            biomarkerNegative: 'Poor metabolizers: -4.1 points with dose adjustment'
        },
        fdaApproval: {
            date: 'April 11, 2017',
            nda: '209241',
            summary: 'Approved with CYP2D6 dosing recommendations',
            fdaReviewLink: 'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2017/209241Orig1s000TOC.cfm'
        },
        dataQuality: 'High',
        precedentStrength: 'High'
    },
    {
        id: 'siponimod-mayzent',
        drug: 'Siponimod (Mayzent)',
        biomarker: 'CYP2C9 genotype',
        biomarkerType: 'metabolic',
        division: 'Neurology',
        nctId: 'NCT01665144',
        phase: 'Phase 3',
        title: 'EXPAND: Siponimod in Secondary Progressive MS',
        enrollment: {
            total: 1651,
            biomarkerPositive: 1568,
            biomarkerNegative: 83,
            percentPositive: 95,
            percentNegative: 5
        },
        trialDesign: {
            type: 'Genotype exclusion/dose adjustment',
            description: 'CYP2C9*3/*3 excluded, other variants dose-adjusted',
            rationale: 'Major impact on drug clearance',
            controlArm: 'Placebo'
        },
        biomarkerStrategy: 'Mandatory CYP2C9 genotyping before treatment',
        results: {
            primaryEndpoint: 'Disability progression',
            biomarkerPositive: {
                disabilityReduction: '21%',
                t2LesionReduction: '-81%',
                brainAtrophyReduction: '15%',
                pValue: '0.013'
            },
            biomarkerNegative: 'CYP2C9*3/*3 contraindicated'
        },
        fdaApproval: {
            date: 'March 26, 2019',
            nda: '209884',
            summary: 'First oral drug for SPMS with mandatory genotyping',
            fdaReviewLink: 'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2019/209884Orig1s000TOC.cfm'
        },
        dataQuality: 'High',
        precedentStrength: 'Maximum'
    }
];

// Enhanced biomarker detection function
function detectBiomarkers(text) {
    if (!text) return [];
    
    const detectedBiomarkers = new Map();
    
    for (const [type, config] of Object.entries(BIOMARKER_PATTERNS)) {
        for (const pattern of config.patterns) {
            const matches = text.matchAll(pattern);
            for (const match of matches) {
                const biomarker = match[0].toUpperCase();
                if (!detectedBiomarkers.has(biomarker)) {
                    detectedBiomarkers.set(biomarker, {
                        name: biomarker,
                        type: type,
                        confidence: 'high'
                    });
                }
            }
        }
        
        // Check for keywords to increase confidence
        const hasKeywords = config.keywords.some(keyword => 
            text.toLowerCase().includes(keyword.toLowerCase())
        );
        
        if (hasKeywords) {
            for (const [biomarker, info] of detectedBiomarkers) {
                if (info.type === type) {
                    info.confidence = 'very high';
                }
            }
        }
    }
    
    return Array.from(detectedBiomarkers.values());
}

// Analyze enrichment strategy
function analyzeEnrichmentStrategy(enrollment, trialDesign) {
    if (!enrollment) return 'Unknown';
    
    const percentPositive = enrollment.percentPositive || 0;
    
    if (percentPositive === 100) {
        return {
            level: 'Complete Enrichment',
            percentage: 100,
            strategy: 'Only biomarker-positive patients enrolled',
            fdaRelevance: 'Strong precedent for complete enrichment'
        };
    } else if (percentPositive >= 80) {
        return {
            level: 'High Enrichment',
            percentage: percentPositive,
            strategy: 'Predominantly biomarker-positive with small control',
            fdaRelevance: 'Precedent for high enrichment strategies'
        };
    } else if (percentPositive >= 50) {
        return {
            level: 'Moderate Enrichment',
            percentage: percentPositive,
            strategy: 'Balanced enrollment with enrichment',
            fdaRelevance: 'Standard enrichment approach'
        };
    } else if (percentPositive === 0) {
        return {
            level: 'Exclusion Strategy',
            percentage: 0,
            strategy: 'Biomarker used for exclusion only',
            fdaRelevance: 'Precedent for safety-based exclusion'
        };
    } else {
        return {
            level: 'Minimal Enrichment',
            percentage: percentPositive,
            strategy: 'Limited biomarker enrichment',
            fdaRelevance: 'May require larger sample size'
        };
    }
}

// Routes

// Health check
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        version: '3.0',
        timestamp: new Date().toISOString(),
        features: [
            'Enhanced biomarker detection',
            'Real FDA precedent database',
            'Clinical trial enrichment analysis',
            'Live API integration',
            'Advanced search algorithms'
        ]
    });
});

// Get FDA precedents with advanced filtering
router.get('/precedents', (req, res) => {
    const { 
        division, 
        biomarkerType, 
        enrichmentLevel,
        minEnrichment,
        precedentStrength 
    } = req.query;
    
    let filtered = [...precedentDatabase];
    
    if (division) {
        filtered = filtered.filter(p => 
            p.division.toLowerCase() === division.toLowerCase()
        );
    }
    
    if (biomarkerType) {
        filtered = filtered.filter(p => 
            p.biomarkerType === biomarkerType.toLowerCase()
        );
    }
    
    if (enrichmentLevel) {
        filtered = filtered.filter(p => {
            const strategy = analyzeEnrichmentStrategy(p.enrollment, p.trialDesign);
            return strategy.level.toLowerCase().includes(enrichmentLevel.toLowerCase());
        });
    }
    
    if (minEnrichment) {
        filtered = filtered.filter(p => 
            p.enrollment.percentPositive >= parseInt(minEnrichment)
        );
    }
    
    if (precedentStrength) {
        filtered = filtered.filter(p => 
            p.precedentStrength.toLowerCase() === precedentStrength.toLowerCase()
        );
    }
    
    res.json({
        success: true,
        count: filtered.length,
        precedents: filtered.map(p => ({
            ...p,
            enrichmentAnalysis: analyzeEnrichmentStrategy(p.enrollment, p.trialDesign)
        }))
    });
});

// Search ClinicalTrials.gov with enhanced analysis
router.post('/search/clinicaltrials', async (req, res) => {
    const { 
        query, 
        biomarker, 
        drug, 
        phase,
        status,
        pageSize = 20,
        pageToken 
    } = req.body;
    
    try {
        // Build search expression
        let searchExpr = [];
        if (query) searchExpr.push(query);
        if (biomarker) searchExpr.push(biomarker);
        if (drug) searchExpr.push(drug);
        
        const searchQuery = searchExpr.join(' AND ');
        const cacheKey = `ct_${searchQuery}_${pageSize}_${pageToken || 'first'}`;
        
        const cached = cache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }
        
        // ClinicalTrials.gov API v2
        const params = {
            'query.cond': searchQuery,
            'pageSize': pageSize,
            'fields': [
                'NCTId',
                'BriefTitle',
                'OverallStatus',
                'Phase',
                'Condition',
                'InterventionName',
                'BriefSummary',
                'DetailedDescription',
                'EligibilityCriteria',
                'EnrollmentCount',
                'StudyType',
                'StartDate',
                'CompletionDate'
            ].join('|')
        };
        
        if (pageToken) params.pageToken = pageToken;
        if (phase) params['query.phase'] = phase;
        if (status) params['query.status'] = status;
        
        const response = await axios.get('https://clinicaltrials.gov/api/v2/studies', { params });
        
        const studies = response.data.studies || [];
        const processedStudies = studies.map(study => {
            const protocol = study.protocolSection || {};
            const description = protocol.descriptionModule || {};
            const eligibility = protocol.eligibilityModule || {};
            const design = protocol.designModule || {};
            
            // Detect biomarkers
            const fullText = [
                description.briefSummary,
                description.detailedDescription,
                eligibility.eligibilityCriteria,
                protocol.armsInterventionsModule?.interventions?.map(i => i.description).join(' ')
            ].filter(Boolean).join(' ');
            
            const detectedBiomarkers = detectBiomarkers(fullText);
            
            // Analyze enrollment
            const enrollment = design.enrollmentInfo?.count || 0;
            const hasEnrichment = detectedBiomarkers.length > 0 && 
                /enrichment|biomarker.{0,20}(positive|negative|stratif)/i.test(fullText);
            
            // Estimate enrichment level
            let estimatedEnrichment = 'Unknown';
            if (/only.{0,20}(positive|mutation|variant)/i.test(fullText)) {
                estimatedEnrichment = 'Complete (100%)';
            } else if (/predominantly|primarily|mostly/i.test(fullText)) {
                estimatedEnrichment = 'High (>80%)';
            } else if (/stratified|balanced/i.test(fullText)) {
                estimatedEnrichment = 'Moderate (50-80%)';
            }
            
            return {
                nctId: protocol.identificationModule?.nctId,
                title: protocol.identificationModule?.briefTitle,
                status: protocol.statusModule?.overallStatus,
                phase: design.phases?.join(', '),
                enrollment: enrollment,
                biomarkers: detectedBiomarkers,
                hasEnrichment: hasEnrichment,
                estimatedEnrichment: estimatedEnrichment,
                conditions: protocol.conditionsModule?.conditions,
                interventions: protocol.armsInterventionsModule?.interventions?.map(i => i.name),
                startDate: protocol.statusModule?.startDateStruct?.date,
                url: `https://clinicaltrials.gov/study/${protocol.identificationModule?.nctId}`
            };
        });
        
        const result = {
            success: true,
            count: processedStudies.length,
            totalCount: response.data.totalCount,
            nextPageToken: response.data.nextPageToken,
            studies: processedStudies,
            summary: {
                withBiomarkers: processedStudies.filter(s => s.biomarkers.length > 0).length,
                withEnrichment: processedStudies.filter(s => s.hasEnrichment).length,
                byPhase: processedStudies.reduce((acc, s) => {
                    const phase = s.phase || 'Not specified';
                    acc[phase] = (acc[phase] || 0) + 1;
                    return acc;
                }, {})
            }
        };
        
        cache.set(cacheKey, result);
        res.json(result);
        
    } catch (error) {
        console.error('ClinicalTrials.gov API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to search ClinicalTrials.gov',
            message: error.message
        });
    }
});

// Search PubMed for biomarker enrichment literature
router.post('/search/pubmed', async (req, res) => {
    const { query, biomarker, maxResults = 20 } = req.body;
    
    try {
        // Build PubMed search query
        let searchTerms = [];
        if (query) searchTerms.push(query);
        if (biomarker) searchTerms.push(`"${biomarker}"[All Fields]`);
        searchTerms.push('("biomarker enrichment"[All Fields] OR "precision medicine"[All Fields] OR "targeted therapy"[All Fields])');
        
        const searchQuery = searchTerms.join(' AND ');
        const cacheKey = `pubmed_${searchQuery}_${maxResults}`;
        
        const cached = cache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }
        
        // Search PubMed
        const searchResponse = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', {
            params: {
                db: 'pubmed',
                term: searchQuery,
                retmax: maxResults,
                retmode: 'json',
                sort: 'relevance'
            }
        });
        
        const pmids = searchResponse.data.esearchresult?.idlist || [];
        
        if (pmids.length === 0) {
            return res.json({
                success: true,
                count: 0,
                articles: []
            });
        }
        
        // Fetch article details
        const detailsResponse = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi', {
            params: {
                db: 'pubmed',
                id: pmids.join(','),
                retmode: 'xml'
            }
        });
        
        // Parse XML response
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(detailsResponse.data);
        const articles = result.PubmedArticleSet?.PubmedArticle || [];
        
        const processedArticles = articles.map(article => {
            const medline = article.MedlineCitation?.[0];
            const articleData = medline?.Article?.[0];
            
            const pmid = medline?.PMID?.[0]._;
            const title = articleData?.ArticleTitle?.[0];
            const abstract = articleData?.Abstract?.[0]?.AbstractText?.[0]?._ || 
                           articleData?.Abstract?.[0]?.AbstractText?.[0] || '';
            const journal = articleData?.Journal?.[0]?.Title?.[0];
            const year = articleData?.Journal?.[0]?.JournalIssue?.[0]?.PubDate?.[0]?.Year?.[0];
            const authors = articleData?.AuthorList?.[0]?.Author?.slice(0, 3).map(a => 
                `${a.LastName?.[0]} ${a.ForeName?.[0]?.[0] || ''}`
            ).join(', ') + (articleData?.AuthorList?.[0]?.Author?.length > 3 ? ' et al.' : '');
            
            // Detect biomarkers in abstract
            const detectedBiomarkers = detectBiomarkers(title + ' ' + abstract);
            
            // Calculate relevance score
            const hasEnrichment = /enrichment|stratif|subset|population/i.test(abstract);
            const hasBiomarker = detectedBiomarkers.length > 0;
            const hasFDA = /FDA|regulatory|approval/i.test(abstract);
            const hasTrial = /trial|study|clinical/i.test(abstract);
            
            const relevanceScore = 
                (hasEnrichment ? 3 : 0) + 
                (hasBiomarker ? 3 : 0) + 
                (hasFDA ? 2 : 0) + 
                (hasTrial ? 2 : 0);
            
            return {
                pmid: pmid,
                title: title,
                abstract: abstract.substring(0, 500) + (abstract.length > 500 ? '...' : ''),
                authors: authors,
                journal: journal,
                year: year,
                biomarkers: detectedBiomarkers,
                relevanceScore: relevanceScore,
                url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
            };
        });
        
        // Sort by relevance
        processedArticles.sort((a, b) => b.relevanceScore - a.relevanceScore);
        
        const response = {
            success: true,
            count: processedArticles.length,
            totalFound: searchResponse.data.esearchresult?.count || processedArticles.length,
            articles: processedArticles
        };
        
        cache.set(cacheKey, response);
        res.json(response);
        
    } catch (error) {
        console.error('PubMed API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to search PubMed',
            message: error.message
        });
    }
});

// Comprehensive search across all sources
router.post('/search/comprehensive', async (req, res) => {
    const { query, biomarker, drug, sources = ['fda', 'clinicaltrials', 'pubmed'] } = req.body;
    
    try {
        const results = {
            precedents: { count: 0, data: [] },
            clinicalTrials: { count: 0, data: [] },
            pubmedArticles: { count: 0, data: [] }
        };
        
        // Search FDA precedents
        if (sources.includes('fda')) {
            const precedents = precedentDatabase.filter(p => {
                const searchText = JSON.stringify(p).toLowerCase();
                return (!query || searchText.includes(query.toLowerCase())) &&
                       (!biomarker || searchText.includes(biomarker.toLowerCase())) &&
                       (!drug || searchText.includes(drug.toLowerCase()));
            });
            
            results.precedents = {
                count: precedents.length,
                data: precedents.map(p => ({
                    ...p,
                    enrichmentAnalysis: analyzeEnrichmentStrategy(p.enrollment, p.trialDesign),
                    sourceType: 'fda_approval'
                }))
            };
        }
        
        // Search ClinicalTrials.gov
        if (sources.includes('clinicaltrials')) {
            try {
                const ctResponse = await axios.post(
                    `${req.protocol}://${req.get('host')}/api/biomarkers/search/clinicaltrials`,
                    { query, biomarker, drug, pageSize: 10 }
                );
                
                if (ctResponse.data.success) {
                    results.clinicalTrials = {
                        count: ctResponse.data.count,
                        data: ctResponse.data.studies.map(s => ({
                            ...s,
                            sourceType: 'clinical_trial'
                        }))
                    };
                }
            } catch (error) {
                console.error('Clinical trials search error:', error);
            }
        }
        
        // Search PubMed
        if (sources.includes('pubmed')) {
            try {
                const pubmedResponse = await axios.post(
                    `${req.protocol}://${req.get('host')}/api/biomarkers/search/pubmed`,
                    { query, biomarker, maxResults: 10 }
                );
                
                if (pubmedResponse.data.success) {
                    results.pubmedArticles = {
                        count: pubmedResponse.data.count,
                        data: pubmedResponse.data.articles.map(a => ({
                            ...a,
                            sourceType: 'literature'
                        }))
                    };
                }
            } catch (error) {
                console.error('PubMed search error:', error);
            }
        }
        
        // Combine all results
        const allResults = [
            ...results.precedents.data,
            ...results.clinicalTrials.data,
            ...results.pubmedArticles.data
        ];
        
        // Generate insights
        const insights = generateInsights(allResults, biomarker);
        
        res.json({
            success: true,
            totalResults: allResults.length,
            results: results,
            insights: insights,
            searchParams: { query, biomarker, drug, sources }
        });
        
    } catch (error) {
        console.error('Comprehensive search error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to perform comprehensive search',
            message: error.message
        });
    }
});

// Get FDA document links
router.post('/search/fda-documents', async (req, res) => {
    const { drugName, nda } = req.body;
    
    try {
        const fdaLinks = {
            reviews: [],
            labels: [],
            approvalLetters: []
        };
        
        // Generate FDA document URLs
        if (nda) {
            fdaLinks.reviews.push({
                title: 'FDA Review Documents',
                url: `https://www.accessdata.fda.gov/drugsatfda_docs/nda/${nda.substring(0, 4)}/${nda}_toc.cfm`
            });
            
            fdaLinks.labels.push({
                title: 'Product Label',
                url: `https://www.accessdata.fda.gov/drugsatfda_docs/label/${new Date().getFullYear()}/${nda}lbl.pdf`
            });
        }
        
        if (drugName) {
            // Search FDA Orange Book
            const orangeBookUrl = `https://www.accessdata.fda.gov/scripts/cder/ob/results_product.cfm?Appl_Type=N&Appl_No=${nda}`;
            fdaLinks.approvalLetters.push({
                title: 'Orange Book Entry',
                url: orangeBookUrl
            });
        }
        
        res.json({
            success: true,
            documents: fdaLinks,
            note: 'These are direct FDA database links. Some may require navigation to find specific documents.'
        });
        
    } catch (error) {
        console.error('FDA document search error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate FDA document links'
        });
    }
});

// Trial design recommendations based on precedents
router.post('/recommendations/trial-design', async (req, res) => {
    const { 
        biomarker, 
        indication, 
        targetPopulationSize,
        biomarkerPrevalence 
    } = req.body;
    
    try {
        // Find relevant precedents
        const relevantPrecedents = precedentDatabase.filter(p => {
            const biomarkerMatch = biomarker && 
                p.biomarker.toLowerCase().includes(biomarker.toLowerCase());
            const indicationMatch = indication && 
                (p.title.toLowerCase().includes(indication.toLowerCase()) ||
                 p.drug.toLowerCase().includes(indication.toLowerCase()));
            
            return biomarkerMatch || indicationMatch;
        });
        
        // Analyze precedent strategies
        const strategies = relevantPrecedents.map(p => ({
            drug: p.drug,
            strategy: analyzeEnrichmentStrategy(p.enrollment, p.trialDesign),
            outcome: p.fdaApproval.summary
        }));
        
        // Generate recommendations
        const recommendations = [];
        
        // Complete enrichment recommendation
        const completeEnrichmentPrecedents = strategies.filter(s => 
            s.strategy.level === 'Complete Enrichment'
        );
        
        if (completeEnrichmentPrecedents.length > 0) {
            recommendations.push({
                strategy: 'Complete Enrichment (100% biomarker-positive)',
                precedents: completeEnrichmentPrecedents.length,
                rationale: 'Strong FDA precedent for complete enrichment in precision medicine',
                examples: completeEnrichmentPrecedents.slice(0, 3).map(p => p.drug),
                sampleSize: Math.ceil(targetPopulationSize * (biomarkerPrevalence / 100)),
                pros: [
                    'Maximizes treatment effect size',
                    'Reduces sample size requirements',
                    'Clear regulatory precedent',
                    'Faster trial completion'
                ],
                cons: [
                    'Limited to biomarker-positive population',
                    'Requires upfront screening costs',
                    'May limit market size'
                ],
                recommendationScore: 95
            });
        }
        
        // High enrichment recommendation
        const highEnrichmentPrecedents = strategies.filter(s => 
            s.strategy.level === 'High Enrichment'
        );
        
        if (highEnrichmentPrecedents.length > 0 || biomarkerPrevalence > 20) {
            recommendations.push({
                strategy: 'High Enrichment (80-90% biomarker-positive)',
                precedents: highEnrichmentPrecedents.length,
                rationale: 'Allows small comparator arm while maintaining enrichment benefits',
                examples: highEnrichmentPrecedents.slice(0, 3).map(p => p.drug),
                sampleSize: Math.ceil(targetPopulationSize * 1.2),
                pros: [
                    'Strong treatment effect expected',
                    'Some data on biomarker-negative patients',
                    'Regulatory flexibility',
                    'Broader label potential'
                ],
                cons: [
                    'Larger sample size than complete enrichment',
                    'Diluted treatment effect',
                    'More complex analysis'
                ],
                recommendationScore: 85
            });
        }
        
        // Stratified enrollment recommendation
        recommendations.push({
            strategy: 'Stratified Enrollment (50/50 split)',
            precedents: strategies.filter(s => s.strategy.level === 'Moderate Enrichment').length,
            rationale: 'Balanced approach for biomarker validation',
            sampleSize: targetPopulationSize * 2,
            pros: [
                'Full biomarker validation',
                'Broader market opportunity',
                'Satisfies conservative regulatory approach'
            ],
            cons: [
                'Largest sample size requirement',
                'Risk of diluted overall effect',
                'Longer recruitment timeline'
            ],
            recommendationScore: 60
        });
        
        // Sort by recommendation score
        recommendations.sort((a, b) => b.recommendationScore - a.recommendationScore);
        
        res.json({
            success: true,
            recommendations: recommendations,
            precedentSummary: {
                totalRelevantPrecedents: relevantPrecedents.length,
                byStrategy: strategies.reduce((acc, s) => {
                    acc[s.strategy.level] = (acc[s.strategy.level] || 0) + 1;
                    return acc;
                }, {})
            },
            regulatoryConsiderations: [
                'FDA has accepted complete enrichment strategies across multiple therapeutic areas',
                'Enrichment strategies should align with mechanism of action',
                'Consider companion diagnostic development timeline',
                'Early FDA meeting recommended to discuss enrichment strategy'
            ]
        });
        
    } catch (error) {
        console.error('Trial design recommendation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate trial design recommendations'
        });
    }
});

// Statistical power calculation for enriched trials
router.post('/calculate/power', async (req, res) => {
    const {
        sampleSize,
        effectSizeBiomarkerPositive,
        effectSizeBiomarkerNegative,
        biomarkerPrevalence,
        enrichmentLevel,
        alpha = 0.05,
        allocation = 0.5
    } = req.body;
    
    try {
        // Simple power calculation (would use proper stats library in production)
        const calculatePower = (n, effectSize, alpha) => {
            // Simplified calculation for demonstration
            const z_alpha = 1.96; // for alpha = 0.05
            const power = 1 - (1 / (1 + Math.exp(Math.sqrt(n) * effectSize - z_alpha)));
            return Math.min(0.99, Math.max(0.01, power));
        };
        
        // Calculate for different scenarios
        const scenarios = [];
        
        // Complete enrichment
        const nComplete = Math.floor(sampleSize * (enrichmentLevel / 100));
        scenarios.push({
            strategy: 'Complete Enrichment',
            enrollmentBreakdown: {
                biomarkerPositive: nComplete,
                biomarkerNegative: 0,
                total: nComplete
            },
            power: calculatePower(nComplete, effectSizeBiomarkerPositive, alpha),
            expectedEffect: effectSizeBiomarkerPositive,
            interpretation: 'Maximum power with smallest sample size'
        });
        
        // High enrichment (90%)
        const nHigh90 = Math.floor(sampleSize * 0.9);
        const nHighNeg10 = sampleSize - nHigh90;
        const weightedEffectHigh = (nHigh90 * effectSizeBiomarkerPositive + 
                                    nHighNeg10 * effectSizeBiomarkerNegative) / sampleSize;
        scenarios.push({
            strategy: '90% Enrichment',
            enrollmentBreakdown: {
                biomarkerPositive: nHigh90,
                biomarkerNegative: nHighNeg10,
                total: sampleSize
            },
            power: calculatePower(sampleSize, weightedEffectHigh, alpha),
            expectedEffect: weightedEffectHigh,
            interpretation: 'High power with minimal dilution'
        });
        
        // No enrichment
        const nNoEnrichPos = Math.floor(sampleSize * (biomarkerPrevalence / 100));
        const nNoEnrichNeg = sampleSize - nNoEnrichPos;
        const weightedEffectNo = (nNoEnrichPos * effectSizeBiomarkerPositive + 
                                  nNoEnrichNeg * effectSizeBiomarkerNegative) / sampleSize;
        scenarios.push({
            strategy: 'No Enrichment',
            enrollmentBreakdown: {
                biomarkerPositive: nNoEnrichPos,
                biomarkerNegative: nNoEnrichNeg,
                total: sampleSize
            },
            power: calculatePower(sampleSize, weightedEffectNo, alpha),
            expectedEffect: weightedEffectNo,
            interpretation: 'Natural prevalence - highest risk of failure'
        });
        
        // Find required sample sizes for 80% power
        const requiredSampleSizes = scenarios.map(scenario => {
            let n = 100;
            while (calculatePower(n, scenario.expectedEffect, alpha) < 0.8 && n < 10000) {
                n += 50;
            }
            return {
                strategy: scenario.strategy,
                requiredN: n,
                costMultiple: n / scenarios[0].enrollmentBreakdown.total
            };
        });
        
        res.json({
            success: true,
            powerAnalysis: scenarios,
            requiredSampleSizes: requiredSampleSizes,
            recommendations: {
                preferred: scenarios[0],
                rationale: 'Complete enrichment provides maximum statistical power with minimum sample size',
                costBenefit: `${(requiredSampleSizes[2].costMultiple).toFixed(1)}x cost savings vs no enrichment`
            }
        });
        
    } catch (error) {
        console.error('Power calculation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to calculate statistical power'
        });
    }
});

// Export data in various formats
router.post('/export', async (req, res) => {
    const { data, format = 'json', filename = 'biomarker-analysis' } = req.body;
    
    try {
        let exportData;
        let contentType;
        
        switch (format) {
            case 'csv':
                // Convert to CSV (simplified)
                const headers = Object.keys(data[0] || {});
                const csv = [
                    headers.join(','),
                    ...data.map(row => 
                        headers.map(h => JSON.stringify(row[h] || '')).join(',')
                    )
                ].join('\n');
                exportData = csv;
                contentType = 'text/csv';
                break;
                
            case 'json':
            default:
                exportData = JSON.stringify(data, null, 2);
                contentType = 'application/json';
                break;
        }
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.${format}"`);
        res.send(exportData);
        
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to export data'
        });
    }
});

// Helper function to generate insights
function generateInsights(results, biomarker) {
    const insights = {
        precedentPatterns: [],
        enrichmentTrends: [],
        regulatoryConsiderations: [],
        recommendations: []
    };
    
    // Analyze FDA precedents
    const fdaPrecedents = results.filter(r => r.sourceType === 'fda_approval');
    if (fdaPrecedents.length > 0) {
        const completeEnrichment = fdaPrecedents.filter(p => 
            p.enrichmentAnalysis?.percentage === 100
        );
        
        insights.precedentPatterns.push({
            type: 'Complete Enrichment Precedents',
            finding: `${completeEnrichment.length} FDA-approved drugs used 100% biomarker-positive enrollment`,
            implication: 'Strong regulatory precedent for complete enrichment strategies',
            examples: completeEnrichment.slice(0, 3).map(p => p.drug)
        });
        
        // Analyze by division
        const divisionCounts = fdaPrecedents.reduce((acc, p) => {
            acc[p.division] = (acc[p.division] || 0) + 1;
            return acc;
        }, {});
        
        insights.regulatoryConsiderations.push({
            type: 'Division Consistency',
            finding: `Enrichment strategies approved across ${Object.keys(divisionCounts).length} FDA divisions`,
            divisions: divisionCounts,
            recommendation: 'Reference cross-division precedents in FDA meetings'
        });
    }
    
    // Analyze clinical trials
    const clinicalTrials = results.filter(r => r.sourceType === 'clinical_trial');
    if (clinicalTrials.length > 0) {
        const withBiomarkers = clinicalTrials.filter(t => 
            t.biomarkers && t.biomarkers.length > 0
        );
        
        insights.enrichmentTrends.push({
            type: 'Current Trial Landscape',
            finding: `${withBiomarkers.length}/${clinicalTrials.length} active trials use biomarker selection`,
            trend: 'Increasing adoption of precision medicine approaches',
            implication: 'Industry standard shifting toward biomarker-driven trials'
        });
    }
    
    // Generate recommendations
    if (biomarker) {
        insights.recommendations.push({
            priority: 'High',
            recommendation: `Consider complete enrichment strategy for ${biomarker}`,
            rationale: 'Based on successful FDA precedents with similar biomarker-driven approaches',
            actionItems: [
                'Schedule Type B meeting with FDA to discuss enrichment strategy',
                'Prepare precedent analysis highlighting cross-division approvals',
                'Develop companion diagnostic in parallel',
                'Consider adaptive trial design with interim biomarker analysis'
            ]
        });
    }
    
    return insights;
}

module.exports = router;

// const express = require('express');
// const cors = require('cors');
// const path = require('path');
// const axios = require('axios');
// const xml2js = require('xml2js');
// const NodeCache = require('node-cache');

// const app = express();
// const PORT = process.env.PORT || 3000;

// // Middleware
// app.use(cors());
// app.use(express.json());
// app.use(express.static(path.join(__dirname, 'public')));

// // Initialize cache (30 min TTL)
// const cache = new NodeCache({ stdTTL: 1800 });

// // Enhanced Precedent Database with Real FDA Approvals
// const precedentDatabase = [
//     {
//         id: 'ivacaftor-kalydeco',
//         drug: 'Ivacaftor (Kalydeco)',
//         biomarker: 'CFTR G551D mutation',
//         division: 'Pulmonary',
//         nctId: 'NCT00909532',
//         phase: 'Phase 3',
//         title: 'STRIVE: Study of VX-770 in CF Patients with G551D-CFTR',
//         enrollment: {
//             total: 161,
//             biomarkerPositive: 161,
//             biomarkerNegative: 0,
//             percentPositive: 100,
//             percentNegative: 0
//         },
//         trialDesign: {
//             type: 'Complete enrichment strategy',
//             description: 'Only patients with G551D mutation enrolled',
//             rationale: 'Drug mechanism requires specific CFTR gating mutation',
//             controlArm: 'Placebo (also G551D positive)'
//         },
//         biomarkerStrategy: '100% biomarker-positive enrichment',
//         results: {
//             biomarkerPositive: {
//                 fev1Improvement: '10.6%',
//                 responseRate: '83%',
//                 sweatChloride: '-47.9 mmol/L',
//                 pValue: '<0.001'
//             },
//             biomarkerNegative: 'Not enrolled - drug ineffective without mutation',
//             overallOutcome: 'First precision medicine for CF'
//         },
//         fdaApproval: {
//             date: 'January 31, 2012',
//             nda: '203188',
//             summary: 'FDA approved for G551D mutation only',
//             expansions: 'Later expanded to 38 CFTR mutations'
//         },
//         dataQuality: 'Excellent - Published in NEJM',
//         precedentStrength: 'Maximum',
//         sources: {
//             pubmed: '22047557',
//             clinicalTrials: 'https://clinicaltrials.gov/study/NCT00909532',
//             fdaLabel: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2023/203188s038lbl.pdf'
//         }
//     },
//     {
//         id: 'nusinersen-spinraza',
//         drug: 'Nusinersen (Spinraza)',
//         biomarker: 'SMN1 gene deletion/mutation',
//         division: 'Neurology',
//         nctId: 'NCT02193074',
//         phase: 'Phase 3',
//         title: 'ENDEAR: Nusinersen in Infantile-Onset SMA',
//         enrollment: {
//             total: 121,
//             biomarkerPositive: 121,
//             biomarkerNegative: 0,
//             percentPositive: 100,
//             percentNegative: 0
//         },
//         trialDesign: {
//             type: 'Complete genetic enrichment',
//             description: 'Only SMA patients with SMN1 mutations',
//             rationale: 'Disease caused by SMN1 deficiency',
//             controlArm: 'Sham procedure (also SMN1 positive)'
//         },
//         biomarkerStrategy: '100% genetic mutation carriers',
//         results: {
//             biomarkerPositive: {
//                 motorMilestones: '51% achieved vs 0% control',
//                 survivalBenefit: 'Significant improvement',
//                 hineScore: '+5.9 points vs -1.9 control',
//                 pValue: '<0.001'
//             },
//             biomarkerNegative: 'Not applicable - disease specific',
//             overallOutcome: 'First approved treatment for SMA'
//         },
//         fdaApproval: {
//             date: 'December 23, 2016',
//             nda: '209531',
//             summary: 'FDA approved for all SMA types with SMN1 mutation',
//             fastTrack: 'Priority review, breakthrough therapy'
//         },
//         dataQuality: 'Excellent - Published in NEJM',
//         precedentStrength: 'Maximum',
//         sources: {
//             pubmed: '29091570',
//             clinicalTrials: 'https://clinicaltrials.gov/study/NCT02193074',
//             fdaApproval: 'https://www.fda.gov/news-events/press-announcements/fda-approves-first-drug-spinal-muscular-atrophy'
//         }
//     },
//     {
//         id: 'maraviroc-selzentry',
//         drug: 'Maraviroc (Selzentry)',
//         biomarker: 'CCR5 tropism (R5-tropic HIV)',
//         division: 'Antiviral',
//         nctId: 'NCT00098306',
//         phase: 'Phase 3',
//         title: 'MOTIVATE 1: Maraviroc in Treatment-Experienced Patients',
//         enrollment: {
//             total: 601,
//             biomarkerPositive: 601,
//             biomarkerNegative: 0,
//             percentPositive: 100,
//             percentNegative: 0
//         },
//         trialDesign: {
//             type: 'Tropism-based enrichment',
//             description: 'Required Trofile assay to confirm CCR5 tropism',
//             rationale: 'Drug only effective against R5-tropic virus',
//             controlArm: 'Placebo + optimized background therapy'
//         },
//         biomarkerStrategy: 'Mandatory tropism testing pre-enrollment',
//         results: {
//             biomarkerPositive: {
//                 viralLoad: '<50 copies/mL in 46% vs 17% placebo',
//                 cd4Increase: '+110 cells/μL',
//                 viralReduction: '-1.84 log vs -0.78 log placebo',
//                 pValue: '<0.001'
//             },
//             biomarkerNegative: 'Excluded - X4/dual tropic ineffective',
//             overallOutcome: 'First CCR5 antagonist approved'
//         },
//         fdaApproval: {
//             date: 'August 6, 2007',
//             nda: '022128',
//             summary: 'Requires tropism testing before use',
//             blackBox: 'Hepatotoxicity warning'
//         },
//         dataQuality: 'High - Two Phase 3 trials',
//         precedentStrength: 'Maximum',
//         sources: {
//             pubmed: '18832244',
//             clinicalTrials: 'https://clinicaltrials.gov/study/NCT00098306',
//             fdaLabel: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2023/022128s026lbl.pdf'
//         }
//     },
//     {
//         id: 'abacavir-ziagen',
//         drug: 'Abacavir (Ziagen)',
//         biomarker: 'HLA-B*5701 negative',
//         division: 'Antiviral',
//         nctId: 'NCT00736671',
//         phase: 'Phase 3',
//         title: 'PREDICT-1: HLA-B*5701 Screening for Abacavir HSR',
//         enrollment: {
//             total: 1956,
//             biomarkerPositive: 0,
//             biomarkerNegative: 1956,
//             percentPositive: 0,
//             percentNegative: 100
//         },
//         trialDesign: {
//             type: 'Exclusion based on safety biomarker',
//             description: 'HLA-B*5701 positive patients excluded',
//             rationale: 'Prevent severe hypersensitivity reactions',
//             controlArm: 'No screening (standard care)'
//         },
//         biomarkerStrategy: 'Screen and exclude HLA-B*5701 carriers',
//         results: {
//             biomarkerPositive: 'Not treated - high HSR risk',
//             biomarkerNegative: {
//                 hsrRate: '0% vs 2.7% control',
//                 safetyProfile: 'Dramatically improved',
//                 clinicalBenefit: 'Eliminated immunologic HSR',
//                 pValue: '<0.001'
//             },
//             overallOutcome: 'Mandatory genetic testing implemented'
//         },
//         fdaApproval: {
//             date: 'July 2008',
//             update: 'FDA safety communication',
//             summary: 'Mandatory HLA-B*5701 testing before use',
//             guideline: 'DHHS guidelines require testing'
//         },
//         dataQuality: 'Excellent - Published in NEJM',
//         precedentStrength: 'Maximum',
//         sources: {
//             pubmed: '18256392',
//             clinicalTrials: 'https://clinicaltrials.gov/study/NCT00736671',
//             fdaSafety: 'https://www.fda.gov/drugs/drug-safety-and-availability/fda-drug-safety-communication-safety-review-update-abacavir'
//         }
//     },
//     {
//         id: 'carbamazepine-tegretol',
//         drug: 'Carbamazepine (Tegretol)',
//         biomarker: 'HLA-B*1502 negative (Asian ancestry)',
//         division: 'Neurology',
//         phase: 'Post-market surveillance',
//         title: 'FDA Safety Review: Carbamazepine and SJS/TEN Risk',
//         enrollment: {
//             description: 'Multiple studies in Asian populations',
//             biomarkerStrategy: 'Screen Asian patients for HLA-B*1502'
//         },
//         trialDesign: {
//             type: 'Safety-based exclusion',
//             description: 'Exclude HLA-B*1502 carriers in Asians',
//             rationale: 'Prevent Stevens-Johnson syndrome',
//             implementation: 'FDA safety alert and label change'
//         },
//         results: {
//             biomarkerPositive: 'High risk of SJS/TEN - contraindicated',
//             biomarkerNegative: 'Safe to use with monitoring',
//             overallOutcome: 'Genetic testing recommended for Asian patients'
//         },
//         fdaApproval: {
//             date: 'December 2007',
//             action: 'FDA Alert and label update',
//             summary: 'Genetic testing strongly recommended',
//             population: 'Asian ancestry patients'
//         },
//         precedentStrength: 'High',
//         sources: {
//             fdaSafety: 'https://www.fda.gov/drugs/drug-safety-and-availability/fda-drug-safety-communication-fda-recommends-genetic-testing-patients-asian-ancestry-prior'
//         }
//     }
// ];

// // Enhanced biomarker patterns
// const BIOMARKER_PATTERNS = {
//     genetic: [
//         'mutation', 'gene', 'variant', 'deletion', 'polymorphism', 'allele',
//         'genotype', 'SNP', 'insertion', 'duplication', 'translocation'
//     ],
//     protein: [
//         'receptor', 'expression', 'overexpression', 'amplification',
//         'protein level', 'immunohistochemistry', 'IHC', 'FISH'
//     ],
//     pharmacogenomic: [
//         'HLA-B', 'CYP2D6', 'CYP2C19', 'CYP2C9', 'TPMT', 'DPYD', 'UGT1A1'
//     ],
//     tropism: [
//         'CCR5', 'CXCR4', 'tropism', 'R5-tropic', 'X4-tropic', 'dual-mixed'
//     ]
// };

// // Helper Functions
// function extractBiomarkers(text) {
//     const biomarkers = new Set();
//     const lowerText = text.toLowerCase();
    
//     // Extract specific gene/mutation patterns
//     const genePattern = /\b([A-Z][A-Z0-9]{1,6})\b/g;
//     const mutationPattern = /\b([A-Z]\d{3,4}[A-Z]?)\b/g;
//     const hlaPattern = /HLA-[A-Z]\*?\d{2}:?\d{0,2}/gi;
//     const cypPattern = /CYP[0-9][A-Z][0-9]+/gi;
    
//     let match;
//     while ((match = genePattern.exec(text)) !== null) {
//         if (match[1].length > 2 && !['THE', 'FDA', 'USA', 'HIV'].includes(match[1])) {
//             biomarkers.add(match[1]);
//         }
//     }
    
//     while ((match = mutationPattern.exec(text)) !== null) {
//         biomarkers.add(match[1]);
//     }
    
//     while ((match = hlaPattern.exec(text)) !== null) {
//         biomarkers.add(match[0].toUpperCase());
//     }
    
//     while ((match = cypPattern.exec(text)) !== null) {
//         biomarkers.add(match[0].toUpperCase());
//     }
    
//     return Array.from(biomarkers);
// }

// function determineBiomarkerType(biomarkers, text) {
//     const lowerText = text.toLowerCase();
    
//     for (const [type, patterns] of Object.entries(BIOMARKER_PATTERNS)) {
//         if (patterns.some(pattern => lowerText.includes(pattern.toLowerCase()))) {
//             return type;
//         }
//     }
    
//     return 'genetic'; // default
// }

// function calculateEnrichmentLevel(trial) {
//     if (!trial.enrollment) return 'Unknown';
    
//     const percentPositive = trial.enrollment.percentPositive || 0;
    
//     if (percentPositive === 100) return 'Complete (100%)';
//     if (percentPositive >= 80) return 'High (≥80%)';
//     if (percentPositive >= 50) return 'Moderate (50-79%)';
//     if (percentPositive >= 20) return 'Low (20-49%)';
//     if (percentPositive === 0) return 'Exclusion strategy';
//     return 'Minimal (<20%)';
// }

// // API Routes

// // Health check
// app.get('/api/health', (req, res) => {
//     res.json({
//         status: 'healthy',
//         version: '2.0',
//         timestamp: new Date().toISOString(),
//         features: [
//             'Enhanced biomarker detection',
//             'Real FDA precedent database',
//             'Clinical trial enrichment analysis',
//             'Division comparison analytics',
//             'Live data integration'
//         ]
//     });
// });

// // Get all precedents with filtering
// app.get('/api/precedents', (req, res) => {
//     const { division, biomarkerType, enrichmentLevel } = req.query;
    
//     let filtered = [...precedentDatabase];
    
//     if (division) {
//         filtered = filtered.filter(p => 
//             p.division.toLowerCase() === division.toLowerCase()
//         );
//     }
    
//     if (biomarkerType) {
//         filtered = filtered.filter(p => {
//             const type = determineBiomarkerType([p.biomarker], p.biomarker);
//             return type === biomarkerType.toLowerCase();
//         });
//     }
    
//     if (enrichmentLevel) {
//         filtered = filtered.filter(p => {
//             const level = calculateEnrichmentLevel(p);
//             return level.toLowerCase().includes(enrichmentLevel.toLowerCase());
//         });
//     }
    
//     res.json({
//         success: true,
//         count: filtered.length,
//         precedents: filtered
//     });
// });

// // Get specific trial details
// app.get('/api/trial/:id', (req, res) => {
//     const trial = precedentDatabase.find(p => p.id === req.params.id);
    
//     if (!trial) {
//         return res.status(404).json({
//             success: false,
//             error: 'Trial not found'
//         });
//     }
    
//     res.json({
//         success: true,
//         trial
//     });
// });

// // Search ClinicalTrials.gov with enhanced biomarker detection
// app.post('/api/search/clinicaltrials', async (req, res) => {
//     const { query, biomarker, drug, page = 1, pageSize = 20 } = req.body;
    
//     try {
//         // Build search expression
//         let searchExpr = query || '';
//         if (biomarker) searchExpr += ` AND ${biomarker}`;
//         if (drug) searchExpr += ` AND ${drug}`;
        
//         const cacheKey = `ct_${searchExpr}_${page}_${pageSize}`;
//         const cached = cache.get(cacheKey);
//         if (cached) {
//             return res.json(cached);
//         }
        
//         // ClinicalTrials.gov API v2
//         const response = await axios.get('https://clinicaltrials.gov/api/v2/studies', {
//             params: {
//                 'query.cond': searchExpr,
//                 pageSize,
//                 pageToken: page > 1 ? `page${page}` : undefined,
//                 format: 'json'
//             }
//         });
        
//         const studies = response.data.studies || [];
        
//         // Process and enrich studies
//         const enrichedStudies = studies.map(study => {
//             const protocol = study.protocolSection || {};
//             const identification = protocol.identificationModule || {};
//             const description = protocol.descriptionModule || {};
//             const eligibility = protocol.eligibilityModule || {};
//             const design = protocol.designModule || {};
            
//             // Extract all text for biomarker analysis
//             const fullText = [
//                 identification.briefTitle,
//                 identification.officialTitle,
//                 description.briefSummary,
//                 description.detailedDescription,
//                 eligibility.eligibilityCriteria
//             ].filter(Boolean).join(' ');
            
//             // Enhanced biomarker detection
//             const biomarkers = extractBiomarkers(fullText);
//             const biomarkerType = determineBiomarkerType(biomarkers, fullText);
            
//             // Detect enrichment strategy
//             const enrichmentKeywords = {
//                 complete: ['100%', 'all patients', 'only patients with', 'exclusively'],
//                 high: ['enriched', 'predominantly', 'primarily', 'mostly'],
//                 exclusion: ['exclude', 'without', 'negative for', 'wild-type'],
//                 stratified: ['stratified', 'randomized by', 'balanced for']
//             };
            
//             let enrichmentStrategy = 'Standard';
//             for (const [strategy, keywords] of Object.entries(enrichmentKeywords)) {
//                 if (keywords.some(kw => fullText.toLowerCase().includes(kw))) {
//                     enrichmentStrategy = strategy.charAt(0).toUpperCase() + strategy.slice(1);
//                     break;
//                 }
//             }
            
//             return {
//                 nctId: identification.nctId,
//                 title: identification.briefTitle,
//                 status: protocol.statusModule?.overallStatus,
//                 phase: design.phases?.join(', ') || 'Not specified',
//                 enrollment: design.enrollmentInfo?.count,
//                 conditions: protocol.conditionsModule?.conditions || [],
//                 interventions: protocol.armsInterventionsModule?.interventions?.map(i => i.name) || [],
//                 sponsors: protocol.sponsorCollaboratorsModule?.leadSponsor?.name,
//                 startDate: protocol.statusModule?.startDateStruct?.date,
//                 completionDate: protocol.statusModule?.primaryCompletionDateStruct?.date,
//                 biomarkers: biomarkers.length > 0 ? biomarkers : ['Not specified'],
//                 biomarkerType,
//                 enrichmentStrategy,
//                 hasResults: protocol.hasResults || false,
//                 url: `https://clinicaltrials.gov/study/${identification.nctId}`
//             };
//         });
        
//         const result = {
//             success: true,
//             totalCount: response.data.totalCount || studies.length,
//             studies: enrichedStudies,
//             page,
//             pageSize,
//             biomarkerSummary: {
//                 totalWithBiomarkers: enrichedStudies.filter(s => s.biomarkers[0] !== 'Not specified').length,
//                 byType: enrichedStudies.reduce((acc, s) => {
//                     acc[s.biomarkerType] = (acc[s.biomarkerType] || 0) + 1;
//                     return acc;
//                 }, {}),
//                 enrichmentStrategies: enrichedStudies.reduce((acc, s) => {
//                     acc[s.enrichmentStrategy] = (acc[s.enrichmentStrategy] || 0) + 1;
//                     return acc;
//                 }, {})
//             }
//         };
        
//         cache.set(cacheKey, result);
//         res.json(result);
        
//     } catch (error) {
//         console.error('ClinicalTrials.gov API error:', error);
//         res.status(500).json({
//             success: false,
//             error: 'Failed to search clinical trials',
//             message: error.message
//         });
//     }
// });

// // Search PubMed with biomarker focus
// app.post('/api/search/pubmed', async (req, res) => {
//     const { query, biomarker, drug, retmax = 20 } = req.body;
    
//     try {
//         // Build search query
//         let searchTerm = query || '';
//         if (biomarker) searchTerm += ` AND "${biomarker}"[All Fields]`;
//         if (drug) searchTerm += ` AND "${drug}"[All Fields]`;
//         searchTerm += ' AND ("biomarker enrichment" OR "patient selection" OR "precision medicine")';
        
//         const cacheKey = `pubmed_${searchTerm}_${retmax}`;
//         const cached = cache.get(cacheKey);
//         if (cached) {
//             return res.json(cached);
//         }
        
//         // Search PubMed
//         const searchResponse = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', {
//             params: {
//                 db: 'pubmed',
//                 term: searchTerm,
//                 retmode: 'json',
//                 retmax,
//                 sort: 'relevance'
//             }
//         });
        
//         const pmids = searchResponse.data.esearchresult?.idlist || [];
        
//         if (pmids.length === 0) {
//             return res.json({
//                 success: true,
//                 articles: [],
//                 count: 0
//             });
//         }
        
//         // Fetch article details
//         const detailsResponse = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi', {
//             params: {
//                 db: 'pubmed',
//                 id: pmids.join(','),
//                 retmode: 'xml'
//             }
//         });
        
//         // Parse XML
//         const parser = new xml2js.Parser();
//         const result = await parser.parseStringPromise(detailsResponse.data);
        
//         const articles = (result.PubmedArticleSet?.PubmedArticle || []).map(article => {
//             const medline = article.MedlineCitation?.[0];
//             const pubmed = article.PubmedData?.[0];
            
//             const pmid = medline.PMID?.[0]._;
//             const articleData = medline.Article?.[0];
//             const title = articleData.ArticleTitle?.[0];
//             const abstract = articleData.Abstract?.AbstractText?.map(text => 
//                 typeof text === 'string' ? text : text._
//             ).join(' ') || '';
            
//             const journal = articleData.Journal?.[0];
//             const journalTitle = journal.Title?.[0];
//             const year = journal.JournalIssue?.[0].PubDate?.[0].Year?.[0];
            
//             const authors = articleData.AuthorList?.Author?.map(author => 
//                 `${author.LastName?.[0]} ${author.ForeName?.[0]}`
//             ).slice(0, 3).join(', ') + (articleData.AuthorList?.Author?.length > 3 ? ' et al.' : '');
            
//             // Extract biomarkers from title and abstract
//             const fullText = `${title} ${abstract}`;
//             const biomarkers = extractBiomarkers(fullText);
            
//             // Detect trial design elements
//             const hasEnrichment = /enrichment|enriched|selection|selected/i.test(fullText);
//             const hasBiomarker = biomarkers.length > 0 || /biomarker|mutation|gene|HLA|CCR5|CFTR/i.test(fullText);
//             const relevanceScore = (hasEnrichment ? 2 : 0) + (hasBiomarker ? 2 : 0) + 
//                                  (/FDA|approval|regulatory/i.test(fullText) ? 1 : 0);
            
//             return {
//                 pmid,
//                 title,
//                 abstract: abstract.substring(0, 300) + (abstract.length > 300 ? '...' : ''),
//                 authors,
//                 journal: journalTitle,
//                 year,
//                 biomarkers,
//                 relevanceScore,
//                 hasEnrichment,
//                 hasBiomarker,
//                 url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
//             };
//         });
        
//         // Sort by relevance
//         articles.sort((a, b) => b.relevanceScore - a.relevanceScore);
        
//         const response = {
//             success: true,
//             count: articles.length,
//             totalFound: searchResponse.data.esearchresult?.count || articles.length,
//             articles,
//             searchSummary: {
//                 withBiomarkers: articles.filter(a => a.hasBiomarker).length,
//                 withEnrichment: articles.filter(a => a.hasEnrichment).length,
//                 highRelevance: articles.filter(a => a.relevanceScore >= 4).length
//             }
//         };
        
//         cache.set(cacheKey, response);
//         res.json(response);
        
//     } catch (error) {
//         console.error('PubMed API error:', error);
//         res.status(500).json({
//             success: false,
//             error: 'Failed to search PubMed',
//             message: error.message
//         });
//     }
// });

// // Comprehensive search across all sources
// app.post('/api/search/comprehensive', async (req, res) => {
//     const { query, biomarker, drug } = req.body;
    
//     try {
//         // Search all sources in parallel
//         const [precedents, clinicalTrials, pubmed] = await Promise.all([
//             // Search precedents
//             Promise.resolve(precedentDatabase.filter(p => {
//                 const searchText = JSON.stringify(p).toLowerCase();
//                 return (!query || searchText.includes(query.toLowerCase())) &&
//                        (!biomarker || searchText.includes(biomarker.toLowerCase())) &&
//                        (!drug || searchText.includes(drug.toLowerCase()));
//             })),
            
//             // Search ClinicalTrials.gov
//             axios.post(`http://localhost:${PORT}/api/search/clinicaltrials`, {
//                 query, biomarker, drug, pageSize: 10
//             }).then(r => r.data).catch(() => ({ studies: [] })),
            
//             // Search PubMed
//             axios.post(`http://localhost:${PORT}/api/search/pubmed`, {
//                 query, biomarker, drug, retmax: 10
//             }).then(r => r.data).catch(() => ({ articles: [] }))
//         ]);
        
//         // Generate comprehensive summary
//         const summary = {
//             query: { query, biomarker, drug },
//             timestamp: new Date().toISOString(),
//             results: {
//                 precedents: {
//                     count: precedents.length,
//                     data: precedents.slice(0, 5)
//                 },
//                 clinicalTrials: {
//                     count: clinicalTrials.totalCount || clinicalTrials.studies?.length || 0,
//                     data: clinicalTrials.studies?.slice(0, 5) || []
//                 },
//                 pubmed: {
//                     count: pubmed.totalFound || pubmed.articles?.length || 0,
//                     data: pubmed.articles?.slice(0, 5) || []
//                 }
//             },
//             insights: generateInsights(precedents, clinicalTrials, pubmed)
//         };
        
//         res.json({
//             success: true,
//             ...summary
//         });
        
//     } catch (error) {
//         console.error('Comprehensive search error:', error);
//         res.status(500).json({
//             success: false,
//             error: 'Failed to perform comprehensive search',
//             message: error.message
//         });
//     }
// });

// // Generate insights from search results
// function generateInsights(precedents, clinicalTrials, pubmed) {
//     const insights = {
//         precedentPatterns: [],
//         enrichmentTrends: [],
//         regulatoryConsiderations: [],
//         recommendations: []
//     };
    
//     // Analyze precedent patterns
//     if (precedents.length > 0) {
//         const enrichmentLevels = precedents.map(p => calculateEnrichmentLevel(p));
//         const enrichmentCounts = enrichmentLevels.reduce((acc, level) => {
//             acc[level] = (acc[level] || 0) + 1;
//             return acc;
//         }, {});
        
//         insights.precedentPatterns.push({
//             type: 'Enrichment Distribution',
//             finding: `${enrichmentCounts['Complete (100%)'] || 0} precedents used complete enrichment`,
//             implication: 'FDA has approved drugs with 100% biomarker-positive populations'
//         });
//     }
    
//     // Analyze clinical trials trends
//     if (clinicalTrials.studies && clinicalTrials.studies.length > 0) {
//         const withBiomarkers = clinicalTrials.studies.filter(s => 
//             s.biomarkers && s.biomarkers[0] !== 'Not specified'
//         ).length;
        
//         insights.enrichmentTrends.push({
//             type: 'Biomarker Usage',
//             finding: `${withBiomarkers}/${clinicalTrials.studies.length} trials use biomarkers`,
//             trend: withBiomarkers / clinicalTrials.studies.length > 0.5 ? 'Increasing' : 'Moderate'
//         });
//     }
    
//     // Generate recommendations
//     if (precedents.some(p => p.enrollment?.percentPositive === 100)) {
//         insights.recommendations.push({
//             priority: 'High',
//             recommendation: 'Consider complete biomarker enrichment strategy',
//             rationale: 'Multiple FDA precedents exist for 100% enrichment',
//             examples: precedents.filter(p => p.enrollment?.percentPositive === 100)
//                                .map(p => p.drug)
//         });
//     }
    
//     return insights;
// }

// // Division comparison analysis
// app.get('/api/divisions/comparison', (req, res) => {
//     const divisionAnalysis = {};
    
//     // Group precedents by division
//     precedentDatabase.forEach(precedent => {
//         const division = precedent.division;
//         if (!divisionAnalysis[division]) {
//             divisionAnalysis[division] = {
//                 name: division,
//                 trials: [],
//                 avgEnrichment: 0,
//                 strategies: {},
//                 approachSummary: ''
//             };
//         }
//         divisionAnalysis[division].trials.push(precedent);
//     });
    
//     // Analyze each division
//     Object.keys(divisionAnalysis).forEach(division => {
//         const data = divisionAnalysis[division];
//         const trials = data.trials;
        
//         // Calculate average enrichment
//         const enrichmentValues = trials.map(t => t.enrollment?.percentPositive || 0);
//         data.avgEnrichment = enrichmentValues.reduce((a, b) => a + b, 0) / enrichmentValues.length;
        
//         // Count strategies
//         trials.forEach(trial => {
//             const strategy = trial.biomarkerStrategy || 'Unknown';
//             data.strategies[strategy] = (data.strategies[strategy] || 0) + 1;
//         });
        
//         // Generate approach summary
//         if (data.avgEnrichment >= 90) {
//             data.approachSummary = 'Highly liberal - accepts complete enrichment';
//         } else if (data.avgEnrichment >= 70) {
//             data.approachSummary = 'Liberal - favors high enrichment';
//         } else if (data.avgEnrichment >= 50) {
//             data.approachSummary = 'Moderate - balanced approach';
//         } else {
//             data.approachSummary = 'Conservative - requires broad populations';
//         }
        
//         // Add specific insights
//         data.keyInsights = [];
//         if (trials.some(t => t.enrollment?.percentPositive === 100)) {
//             data.keyInsights.push('Has approved 100% biomarker-enriched trials');
//         }
//         if (trials.some(t => t.fdaApproval?.fastTrack)) {
//             data.keyInsights.push('Uses expedited pathways for biomarker-driven drugs');
//         }
//     });
    
//     res.json({
//         success: true,
//         divisions: divisionAnalysis,
//         summary: {
//             mostLiberal: Object.entries(divisionAnalysis)
//                 .sort((a, b) => b[1].avgEnrichment - a[1].avgEnrichment)[0]?.[0],
//             completeEnrichmentDivisions: Object.entries(divisionAnalysis)
//                 .filter(([_, data]) => data.trials.some(t => t.enrollment?.percentPositive === 100))
//                 .map(([name]) => name)
//         }
//     });
// });

// // Statistical power calculation
// app.post('/api/calculate/power', (req, res) => {
//     const {
//         biomarkerPrevalence = 0.1,
//         effectSizePositive = 0.8,
//         effectSizeNegative = 0.2,
//         alpha = 0.05,
//         power = 0.8
//     } = req.body;
    
//     // Z-scores
//     const zAlpha = 1.96; // Two-tailed, alpha = 0.05
//     const zBeta = 0.84;  // Power = 0.8
    
//     // Traditional approach (mixed population)
//     const overallEffect = (biomarkerPrevalence * effectSizePositive) + 
//                          ((1 - biomarkerPrevalence) * effectSizeNegative);
//     const traditionalSample = Math.ceil((2 * Math.pow(zAlpha + zBeta, 2)) / Math.pow(overallEffect, 2));
    
//     // Enriched approach (biomarker-positive only)
//     const enrichedSample = Math.ceil((2 * Math.pow(zAlpha + zBeta, 2)) / Math.pow(effectSizePositive, 2));
    
//     // Calculate savings
//     const sampleReduction = ((traditionalSample - enrichedSample) / traditionalSample * 100).toFixed(1);
//     const costPerPatient = 75000; // Average trial cost per patient
//     const monthsPerPatient = 0.03; // Enrollment rate impact
    
//     const response = {
//         success: true,
//         inputs: {
//             biomarkerPrevalence,
//             effectSizePositive,
//             effectSizeNegative,
//             alpha,
//             power
//         },
//         traditional: {
//             sampleSize: traditionalSample,
//             effectSize: overallEffect.toFixed(3),
//             estimatedCost: `$${(traditionalSample * costPerPatient / 1000000).toFixed(1)}M`,
//             estimatedTimeline: `${Math.round(traditionalSample * monthsPerPatient + 24)} months`,
//             successProbability: 'Moderate - diluted effect'
//         },
//         enriched: {
//             sampleSize: enrichedSample,
//             effectSize: effectSizePositive.toFixed(3),
//             estimatedCost: `$${(enrichedSample * costPerPatient / 1000000).toFixed(1)}M`,
//             estimatedTimeline: `${Math.round(enrichedSample * monthsPerPatient + 18)} months`,
//             successProbability: 'High - concentrated effect'
//         },
//         savings: {
//             sampleSizeReduction: `${sampleReduction}%`,
//             costSavings: `$${((traditionalSample - enrichedSample) * costPerPatient / 1000000).toFixed(1)}M`,
//             timelineSavings: `${Math.round((traditionalSample - enrichedSample) * monthsPerPatient)} months`,
//             riskReduction: 'Significant - higher success probability'
//         },
//         recommendation: sampleReduction > 50 ? 
//             'Strong recommendation for biomarker enrichment' : 
//             'Consider biomarker enrichment based on feasibility'
//     };
    
//     res.json(response);
// });

// // Generate trial design recommendations
// app.post('/api/recommendations/trial-design', (req, res) => {
//     const { biomarker, indication, phase, currentApproach } = req.body;
    
//     // Find relevant precedents
//     const relevantPrecedents = precedentDatabase.filter(p => {
//         const biomarkerMatch = !biomarker || 
//             p.biomarker.toLowerCase().includes(biomarker.toLowerCase()) ||
//             determineBiomarkerType([p.biomarker], p.biomarker) === 
//             determineBiomarkerType([biomarker], biomarker);
        
//         const phaseMatch = !phase || p.phase?.includes(phase);
        
//         return biomarkerMatch || phaseMatch;
//     });
    
//     // Generate recommendations
//     const recommendations = {
//         primaryStrategy: '',
//         enrollmentCriteria: [],
//         regulatoryConsiderations: [],
//         precedentSupport: [],
//         potentialChallenges: [],
//         mitigationStrategies: []
//     };
    
//     // Determine primary strategy
//     if (relevantPrecedents.some(p => p.enrollment?.percentPositive === 100)) {
//         recommendations.primaryStrategy = 'Complete Biomarker Enrichment (100%)';
//         recommendations.enrollmentCriteria.push(
//             'Require confirmed biomarker-positive status for enrollment',
//             'Consider central laboratory confirmation',
//             'No biomarker-negative control arm needed based on precedents'
//         );
//     } else if (relevantPrecedents.some(p => p.enrollment?.percentPositive >= 80)) {
//         recommendations.primaryStrategy = 'High Enrichment Strategy (80-95%)';
//         recommendations.enrollmentCriteria.push(
//             'Prioritize biomarker-positive enrollment',
//             'Allow limited biomarker-negative patients for safety',
//             'Stratify randomization by biomarker status'
//         );
//     } else {
//         recommendations.primaryStrategy = 'Stratified Enrichment Strategy';
//         recommendations.enrollmentCriteria.push(
//             'Enroll both biomarker-positive and negative patients',
//             'Pre-specify primary analysis in biomarker-positive',
//             'Power for subgroup analysis'
//         );
//     }
    
//     // Add regulatory considerations
//     recommendations.regulatoryConsiderations = [
//         'FDA Biomarker Qualification Program consultation recommended',
//         'Consider Breakthrough Therapy Designation if biomarker defines high unmet need',
//         'Companion diagnostic co-development required',
//         'European parallel scientific advice recommended'
//     ];
    
//     // Add precedent support
//     recommendations.precedentSupport = relevantPrecedents.slice(0, 3).map(p => ({
//         drug: p.drug,
//         strategy: p.biomarkerStrategy,
//         outcome: p.fdaApproval?.summary || 'Approved',
//         relevance: 'Direct precedent for enrichment strategy'
//     }));
    
//     // Identify challenges and mitigations
//     if (recommendations.primaryStrategy.includes('100%')) {
//         recommendations.potentialChallenges.push(
//             'Enrollment may be slower due to biomarker screening',
//             'Diagnostic test must be available and validated'
//         );
//         recommendations.mitigationStrategies.push(
//             'Implement pre-screening programs',
//             'Partner with diagnostic company early',
//             'Consider expanded access for screen failures'
//         );
//     }
    
//     res.json({
//         success: true,
//         recommendations,
//         supportingEvidence: {
//             precedentCount: relevantPrecedents.length,
//             averageEnrichment: relevantPrecedents.reduce((sum, p) => 
//                 sum + (p.enrollment?.percentPositive || 0), 0) / relevantPrecedents.length,
//             successRate: relevantPrecedents.filter(p => 
//                 p.fdaApproval).length / relevantPrecedents.length
//         }
//     });
// });

// // Export functionality
// app.post('/api/export', async (req, res) => {
//     const { format = 'json', dataTypes = ['precedents', 'analysis'] } = req.body;
    
//     try {
//         const exportData = {
//             metadata: {
//                 exportDate: new Date().toISOString(),
//                 version: '2.0',
//                 dataTypes
//             }
//         };
        
//         if (dataTypes.includes('precedents')) {
//             exportData.precedents = precedentDatabase;
//         }
        
//         if (dataTypes.includes('analysis')) {
//             // Get division analysis
//             const divisionsResponse = await axios.get(`http://localhost:${PORT}/api/divisions/comparison`);
//             exportData.divisionAnalysis = divisionsResponse.data.divisions;
//         }
        
//         if (format === 'json') {
//             res.json({
//                 success: true,
//                 data: exportData
//             });
//         } else {
//             res.status(400).json({
//                 success: false,
//                 error: 'Unsupported export format'
//             });
//         }
        
//     } catch (error) {
//         console.error('Export error:', error);
//         res.status(500).json({
//             success: false,
//             error: 'Failed to export data'
//         });
//     }
// });

// // Summary endpoint for dashboard
// app.get('/api/summary', (req, res) => {
//     const summary = {
//         totalPrecedents: precedentDatabase.length,
//         divisions: [...new Set(precedentDatabase.map(p => p.division))],
//         enrichmentStrategies: {
//             complete: precedentDatabase.filter(p => p.enrollment?.percentPositive === 100).length,
//             high: precedentDatabase.filter(p => p.enrollment?.percentPositive >= 80).length,
//             exclusion: precedentDatabase.filter(p => p.enrollment?.percentPositive === 0).length
//         },
//         biomarkerTypes: precedentDatabase.reduce((acc, p) => {
//             const type = determineBiomarkerType([p.biomarker], p.biomarker);
//             acc[type] = (acc[type] || 0) + 1;
//             return acc;
//         }, {}),
//         recentApprovals: precedentDatabase
//             .filter(p => p.fdaApproval?.date)
//             .sort((a, b) => new Date(b.fdaApproval.date) - new Date(a.fdaApproval.date))
//             .slice(0, 5)
//             .map(p => ({
//                 drug: p.drug,
//                 date: p.fdaApproval.date,
//                 strategy: p.biomarkerStrategy
//             }))
//     };
    
//     res.json({
//         success: true,
//         summary
//     });
// });

// // Error handling middleware
// app.use((error, req, res, next) => {
//     console.error('Server error:', error);
//     res.status(500).json({
//         success: false,
//         error: 'Internal server error',
//         message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
//     });
// });

// // Start server
// app.listen(PORT, () => {
//     console.log('='.repeat(80));
//     console.log('FDA BIOMARKER ENRICHMENT ANALYSIS SERVER v2.0');
//     console.log('='.repeat(80));
//     console.log(`🚀 Server running on port ${PORT}`);
//     console.log(`📊 Frontend: http://localhost:${PORT}`);
//     console.log(`🔬 ${precedentDatabase.length} FDA precedents loaded`);
//     console.log('');
//     console.log('Key Features:');
//     console.log('  ✓ Enhanced biomarker detection algorithms');
//     console.log('  ✓ Real FDA approval precedents database');
//     console.log('  ✓ Clinical trial enrichment analysis');
//     console.log('  ✓ Division comparison analytics');
//     console.log('  ✓ Statistical power calculations');
//     console.log('  ✓ Trial design recommendations');
//     console.log('');
//     console.log('API Endpoints:');
//     console.log('  GET  /api/health                    - System health check');
//     console.log('  GET  /api/summary                   - Dashboard summary data');
//     console.log('  GET  /api/precedents                - FDA precedent cases');
//     console.log('  GET  /api/trial/:id                 - Specific trial details');
//     console.log('  GET  /api/divisions/comparison      - Division analysis');
//     console.log('  POST /api/search/clinicaltrials     - Search ClinicalTrials.gov');
//     console.log('  POST /api/search/pubmed             - Search PubMed');
//     console.log('  POST /api/search/comprehensive      - Multi-source search');
//     console.log('  POST /api/calculate/power           - Statistical power analysis');
//     console.log('  POST /api/recommendations/trial-design - Get trial recommendations');
//     console.log('  POST /api/export                    - Export data');
//     console.log('='.repeat(80));
// });

// module.exports = app;