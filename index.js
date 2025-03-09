const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;
const FDA_API_KEY = 'd3eilgqyIfLBNLFPCKC9fctn826xmw6B91HWKPkO'; // Replace with your actual FDA API key
const WARNING_LETTERS_URL = 'https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/compliance-actions-and-activities/warning-letters';
const FIVE_TEN_K_URL = 'https://www.fda.gov/medical-devices/device-approvals-denials-and-clearances/510k-clearances';
const PMA_URL = 'https://www.fda.gov/medical-devices/device-approvals-denials-and-clearances/pma-approvals';

// Test data
const testData = {
    warningLetters: [
        { title: 'Pfizer Warning', description: 'Manufacturing violation', link: `${WARNING_LETTERS_URL}/pfizer-2025`, date: '2025-03-05' }
    ],
    drugsAtFDA: [
        { drugName: 'Esketamine', description: 'Approved for TRD', link: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2019/211243s000lbl.pdf', date: '2019-03-05' }
    ],
    dailyMed: [
        { drugName: 'Aspirin', description: 'Label update', link: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=example', date: '2025-03-01' }
    ],
    orangeBook: [
        { drugName: 'Esketamine', description: 'Patent expires 2035', link: 'https://www.fda.gov/media/123456/download', date: '2019-03-05' }
    ],
    ichGuidance: [
        { title: 'ICH E8(R1)', description: 'Clinical study guidelines', link: 'https://www.ich.org/fileadmin/Public_Web_Site/ICH_Products/Guidelines/Efficacy/E8_R1/E8-R1_Guideline.pdf', date: '2021-10-06' }
    ],
    imdrfPublications: [
        { title: 'IMDRF Principles', description: 'Device regulation', link: 'http://www.imdrf.org/docs/imdrf/final/technical/imdrf-tech-principles.pdf', date: '2023-03-15' }
    ],
    fiveTenK: [
        { title: '510(k) K123456', description: 'Hearing aid clearance', link: 'https://www.fda.gov/media/510k-example.pdf', date: '2025-03-04' }
    ],
    pma: [
        { title: 'PMA P123456', description: 'Implant approval', link: 'https://www.fda.gov/media/pma-example.pdf', date: '2025-03-03' }
    ],
    submissions: [
        { title: 'New Drug Submission', description: 'Pending review', link: 'https://www.fda.gov/media/submission-example.pdf', date: '2025-03-02' }
    ]
};

app.get('/api/search', async (req, res) => {
    const query = req.query.q || '';
    let results = {};

    try {
        results.warningLetters = await fetchWarningLetters(query);
        results.drugsAtFDA = await fetchDrugsAtFDA(query);
        results.dailyMed = testData.dailyMed.filter(d => query === '' || d.drugName.toLowerCase().includes(query.toLowerCase()));
        results.orangeBook = testData.orangeBook.filter(d => query === '' || d.drugName.toLowerCase().includes(query.toLowerCase()));
        results.ichGuidance = testData.ichGuidance.filter(g => query === '' || g.title.toLowerCase().includes(query.toLowerCase()));
        results.imdrfPublications = testData.imdrfPublications.filter(p => query === '' || p.title.toLowerCase().includes(query.toLowerCase()));
        results.fiveTenK = await fetchFiveTenK(query);
        results.pma = await fetchPMA(query);
        results.submissions = testData.submissions.filter(s => query === '' || s.title.toLowerCase().includes(query.toLowerCase()));

        res.json(results);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

app.get('/api/latest', async (req, res) => {
    try {
        const latest = {
            latestWarningLetter: testData.warningLetters[0],
            latestDrugAtFDA: (await fetchDrugsAtFDA(''))[0] || testData.drugsAtFDA[0],
            latestDailyMed: testData.dailyMed[0],
            latestOrangeBook: testData.orangeBook[0],
            latestICHGuidance: testData.ichGuidance[0],
            latestIMDRF: testData.imdrfPublications[0],
            latestFiveTenK: (await fetchFiveTenK(''))[0] || testData.fiveTenK[0],
            latestPMA: (await fetchPMA(''))[0] || testData.pma[0],
            latestSubmission: testData.submissions[0]
        };
        res.json(latest);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch latest data' });
    }
});

app.get('/api/live-feed', async (req, res) => {
    try {
        const liveData = {};
        liveData.warningLetters = (await fetchWarningLetters('')).map(item => ({ ...item, source: 'Warning Letters' }));
        liveData.drugsAtFDA = (await fetchDrugsAtFDA('')).map(item => ({ ...item, source: 'Drugs@FDA' }));
        liveData.dailyMed = testData.dailyMed.map(item => ({ ...item, source: 'DailyMed' }));
        liveData.orangeBook = testData.orangeBook.map(item => ({ ...item, source: 'Orange Book' }));
        liveData.ichGuidance = testData.ichGuidance.map(item => ({ ...item, source: 'ICH Guidance' }));
        liveData.imdrfPublications = testData.imdrfPublications.map(item => ({ ...item, source: 'IMDRF Publications' }));
        liveData.fiveTenK = (await fetchFiveTenK('')).map(item => ({ ...item, source: '510(k)' }));
        liveData.pma = (await fetchPMA('')).map(item => ({ ...item, source: 'PMA' }));
        liveData.submissions = testData.submissions.map(item => ({ ...item, source: 'Submissions' }));

        res.json(liveData);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch live feed' });
    }
});

async function fetchWarningLetters(query) {
    try {
        const response = await axios.get(WARNING_LETTERS_URL);
        const $ = cheerio.load(response.data);
        const letters = [];
        $('tr').each((i, elem) => {
            const title = $(elem).find('td:nth-child(1) a').text().trim();
            const date = $(elem).find('td:nth-child(2)').text().trim();
            if (title && (query === '' || title.toLowerCase().includes(query.toLowerCase()))) {
                letters.push({
                    title,
                    description: 'Warning letter issued by FDA',
                    link: $(elem).find('a').attr('href')?.startsWith('http') ? $(elem).find('a').attr('href') : `https://www.fda.gov${$(elem).find('a').attr('href')}`,
                    date
                });
            }
        });
        return letters.length ? letters : testData.warningLetters;
    } catch (error) {
        console.error('Warning Letters fetch failed:', error.message);
        return testData.warningLetters;
    }
}

async function fetchDrugsAtFDA(query) {
    try {
        // Use a broader search if query is empty
        const searchTerm = query ? encodeURIComponent(query) : 'drug';
        const url = `https://api.fda.gov/drug/ndc.json?api_key=${FDA_API_KEY}&search=${searchTerm}&limit=10`;
        const response = await axios.get(url);
        if (!response.data.results) {
            throw new Error('No results in API response');
        }
        const results = response.data.results;
        return results.map(item => ({
            drugName: item.openfda?.brand_name?.[0] || 'Unknown Drug',
            description: item.openfda?.indications_and_usage?.[0]?.substring(0, 100) || 'No indication available',
            link: item.openfda?.application_number ? `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${item.openfda.application_number}` : 'https://www.fda.gov/drugs',
            date: item.package_ndc?.[0]?.start_marketing_date || 'N/A'
        }));
    } catch (error) {
        console.error('Drugs@FDA fetch failed:', error.message);
        return testData.drugsAtFDA;
    }
}

async function fetchFiveTenK(query) {
    try {
        const response = await axios.get(FIVE_TEN_K_URL);
        const $ = cheerio.load(response.data);
        const items = [];
        $('tr').each((i, elem) => {
            const title = $(elem).find('td:nth-child(1) a').text().trim();
            const date = $(elem).find('td:nth-child(3)').text().trim();
            if (title && (query === '' || title.toLowerCase().includes(query.toLowerCase()))) {
                items.push({
                    title,
                    description: '510(k) clearance',
                    link: $(elem).find('a').attr('href')?.startsWith('http') ? $(elem).find('a').attr('href') : `https://www.fda.gov${$(elem).find('a').attr('href')}`,
                    date
                });
            }
        });
        return items.length ? items : testData.fiveTenK;
    } catch (error) {
        console.error('510(k) fetch failed:', error.message);
        return testData.fiveTenK;
    }
}

async function fetchPMA(query) {
    try {
        const response = await axios.get(PMA_URL);
        const $ = cheerio.load(response.data);
        const items = [];
        $('tr').each((i, elem) => {
            const title = $(elem).find('td:nth-child(1) a').text().trim();
            const date = $(elem).find('td:nth-child(3)').text().trim();
            if (title && (query === '' || title.toLowerCase().includes(query.toLowerCase()))) {
                items.push({
                    title,
                    description: 'PMA approval',
                    link: $(elem).find('a').attr('href')?.startsWith('http') ? $(elem).find('a').attr('href') : `https://www.fda.gov${$(elem).find('a').attr('href')}`,
                    date
                });
            }
        });
        return items.length ? items : testData.pma;
    } catch (error) {
        console.error('PMA fetch failed:', error.message);
        return testData.pma;
    }
}

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});