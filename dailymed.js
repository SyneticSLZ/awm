const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const app = express();
const port = 3000;

// Logger setup
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.Console()
    ]
});

app.use(express.json());

// CORS setup
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Rate limiting to prevent abuse
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Fetch all SPLs with pagination for condition search
async function fetchAllSPLs(query) {
    const results = [];
    let page = 1;
    const pageSize = 100; // Max allowed by DailyMed
    let hasMore = true;

    while (hasMore) {
        try {
            const response = await axios.get(
                `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?pagesize=${pageSize}&page=${page}`,
                { timeout: 10000 } // 10-second timeout
            );

            const spls = response.data.data || [];
            const filtered = spls
                .filter(spl => spl.indications_and_usage && 
                    spl.indications_and_usage.toLowerCase().includes(query.toLowerCase()))
                .map(spl => ({
                    drugName: spl.drug_name || 'Unknown',
                    indications: spl.indications_and_usage,
                    setId: spl.setid
                }));

            results.push(...filtered);

            // Check if there are more pages
            hasMore = spls.length === pageSize;
            page++;
        } catch (error) {
            logger.error(`Failed to fetch SPLs page ${page}: ${error.message}`);
            throw new Error('Error fetching data from DailyMed');
        }
    }

    return results;
}

app.post('/search', async (req, res) => {
    const { query, searchType } = req.body;

    if (!query || typeof query !== 'string' || !['drug', 'condition'].includes(searchType)) {
        logger.warn(`Invalid request: ${JSON.stringify(req.body)}`);
        return res.status(400).json({ error: 'Invalid search query or type. Please provide a valid drug or condition.' });
    }

    logger.info(`Processing ${searchType} search for: ${query}`);

    try {
        if (searchType === 'drug') {
            const response = await axios.get(
                `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name=${encodeURIComponent(query)}`,
                { timeout: 10000 }
            );

            const spls = response.data.data || [];
            const results = spls.map(spl => ({
                drugName: spl.drug_name || query,
                indications: spl.indications_and_usage || 'Not available',
                setId: spl.setid
            }));

            logger.info(`Drug search for "${query}" returned ${results.length} results`);
            res,json({ results });
        } else if (searchType === 'condition') {
            const results = await fetchAllSPLs(query);

            if (results.length === 0) {
                logger.info(`No results found for condition "${query}"`);
                return res.json({ results: [], message: `No drugs found for "${query}". Try refining your search.` });
            }

            logger.info(`Condition search for "${query}" returned ${results.length} results`);
            res.json({ results });
        }
    } catch (error) {
        logger.error(`Search error: ${error.message}`, { stack: error.stack });
        const status = error.response?.status || 500;
        const message = status === 429 
            ? 'Rate limit exceeded. Please try again later.'
            : 'An error occurred while fetching data. Please try again later.';
        res.status(status).json({ error: message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
    res.status(500).json({ error: 'Something went wrong on the server. Please try again later.' });
});

app.listen(port, () => {
    logger.info(`Server running at http://localhost:${port}`);
});