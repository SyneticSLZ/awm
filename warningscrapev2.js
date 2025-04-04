const puppeteer = require('puppeteer');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Helper function for delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Main scraper function
(async () => {
    // Launch Puppeteer in non-headless mode for debugging
    const browser = await puppeteer.launch({ 
        headless: false,
        defaultViewport: null
    });
    
    const page = await browser.newPage();
    
    // Set longer timeouts
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    // Navigate to the FDA Warning Letters page
    console.log('Navigating to FDA Warning Letters page...');
    await page.goto('https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/compliance-actions-and-activities/warning-letters', {
        waitUntil: 'networkidle2'
    });

    // Set dropdown to 100 entries
    console.log('Setting dropdown to 100 entries...');
    await page.waitForSelector('#datatable_length select', { visible: true, timeout: 10000 });
    await page.select('#datatable_length select', '100');
    await delay(5000); // Increased wait time for table update

    // Initialize variables for pagination
    let allWarningLetters = [];
    let hasNextPage = true;
    let pageNum = 1;

    // Main scraping loop - this approach works well from your original code
    while (hasNextPage) {
        console.log(`Scraping page ${pageNum}...`);

        // Wait for table to be visible
        await page.waitForSelector('#datatable tbody tr', { visible: true, timeout: 10000 });

        // Scrape the table data including links
        const warningLetters = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('#datatable tbody tr'));
            return rows.map(row => {
                const columns = row.querySelectorAll('td');
                const companyLink = columns[2].querySelector('a');
                return {
                    postedDate: columns[0]?.innerText.trim() || '',
                    letterIssueDate: columns[1]?.innerText.trim() || '',
                    companyName: columns[2]?.innerText.trim() || '',
                    companyUrl: companyLink ? companyLink.href : '',
                    issuingOffice: columns[3]?.innerText.trim() || '',
                    subject: columns[4]?.innerText.trim() || '',
                    responseLetter: columns[5]?.innerText.trim() || '',
                    closeoutLetter: columns[6]?.innerText.trim() || '',
                    excerpt: columns[7]?.innerText.trim() || ''
                };
            });
        });

        // Process each warning letter - fetch content from detail page
        for (let i = 0; i < warningLetters.length; i++) {
            const letter = warningLetters[i];
            
            if (letter.companyUrl) {
                try {
                    console.log(`[${i+1}/${warningLetters.length}] Fetching content for: ${letter.companyName}`);
                    
                    // Open a new page for each letter to avoid navigation issues
                    const letterPage = await browser.newPage();
                    await letterPage.goto(letter.companyUrl, { 
                        waitUntil: 'networkidle2',
                        timeout: 60000
                    });
                    
                    // Extract detailed information from the letter page
                    const letterDetails = await letterPage.evaluate(() => {
                        // Get the main content area
                        const mainContent = document.querySelector('div[role="main"]');
                        if (!mainContent) return { fullContent: '' };
                        
                        // Extract the full content
                        const fullContent = mainContent.innerText || '';
                        
                        // Extract recipient information
                        const recipientInfo = {};
                        const recipientSection = document.querySelector('.col-xs-12.col-md-6 dl');
                        if (recipientSection) {
                            const addressElement = recipientSection.querySelector('p.address');
                            if (addressElement) {
                                recipientInfo.address = addressElement.innerText.trim();
                            }
                            
                            // Get email addresses
                            const emailElements = Array.from(recipientSection.querySelectorAll('a[href^="mailto:"]'));
                            if (emailElements.length > 0) {
                                recipientInfo.emails = emailElements.map(el => el.textContent.trim());
                            }
                        }
                        
                        // Extract reference/product info from the description list
                        const infoList = {};
                        const infoSection = document.querySelector('.inset-column .lcds-description-list--grid');
                        if (infoSection) {
                            const dtElements = Array.from(infoSection.querySelectorAll('dt'));
                            dtElements.forEach(dt => {
                                const key = dt.textContent.trim().replace(':', '');
                                const value = dt.nextElementSibling ? dt.nextElementSibling.textContent.trim() : '';
                                if (key && value) {
                                    infoList[key] = value;
                                }
                            });
                        }
                        
                        // Get letter ID/reference from the heading or content
                        let letterId = '';
                        const headingElement = document.querySelector('.content-title');
                        if (headingElement) {
                            const headingText = headingElement.textContent.trim();
                            const matches = headingText.match(/\d{6}/);
                            if (matches && matches.length > 0) {
                                letterId = matches[0];
                            }
                        }
                        
                        // Return all collected data
                        return {
                            fullContent,
                            recipientInfo,
                            infoList,
                            letterId
                        };
                    });
                    
                    // Add the details to the letter object
                    letter.fullContent = letterDetails.fullContent || '';
                    letter.recipientInfo = letterDetails.recipientInfo || {};
                    letter.additionalInfo = letterDetails.infoList || {};
                    letter.letterId = letterDetails.letterId || '';
                    
                    // Add timestamp of when this was scraped
                    letter.scrapedAt = new Date().toISOString();
                    
                    // Close the letter page to free up resources
                    await letterPage.close();
                    
                    // Add a small delay to avoid overloading the server
                    await delay(1000);
                    
                } catch (error) {
                    console.error(`Error fetching content for ${letter.companyName}:`, error.message);
                    letter.fullContent = ''; // Set empty content on error
                    letter.error = error.message;
                }
            }
        }

        // Add to our full collection
        allWarningLetters = allWarningLetters.concat(warningLetters);
        console.log(`Total letters scraped so far: ${allWarningLetters.length}`);

        // Check for next page button - using your approach with some added robustness
        try {
            console.log('Looking for next button...');
            
            // Take a screenshot for debugging
            await page.screenshot({ path: `debug-page-${pageNum}.png` });
            
            // Check if the next button exists and is not disabled
            const nextButtonInfo = await page.evaluate(() => {
                const nextButton = document.querySelector('#datatable_next');
                if (!nextButton) {
                    return { exists: false };
                }
                
                const isDisabled = nextButton.classList.contains('disabled');
                const rect = nextButton.getBoundingClientRect();
                
                return { 
                    exists: true, 
                    isDisabled,
                    selector: '#datatable_next',
                    text: nextButton.innerText,
                    boundingBox: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height
                    }
                };
            });
            
            console.log('Next button info:', nextButtonInfo);
            
            if (!nextButtonInfo.exists || nextButtonInfo.isDisabled) {
                console.log('Next button is disabled or not found, stopping pagination.');
                hasNextPage = false;
            } else {
                console.log('Attempting to click next button...');
                
                // Scroll to make the button visible
                await page.evaluate(() => {
                    const nextButton = document.querySelector('#datatable_next');
                    if (nextButton) {
                        nextButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                });
                
                // Give time for the scroll to complete
                await delay(1000);
                
                // Try using JavaScript click
                await page.evaluate(() => {
                    const nextButton = document.querySelector('#datatable_next');
                    if (nextButton) {
                        console.log('Clicking next button via JS');
                        nextButton.click();
                    }
                });
                
                // Store the first company name before clicking
                const previousFirstCompany = await page.$eval('#datatable tbody tr:first-child td:nth-child(3)', el => el.innerText);
                console.log('Current first company:', previousFirstCompany);
                
                // Wait a bit for the click to take effect
                await delay(5000);
                
                // Check if the table data has changed
                let tableChanged = false;
                let retries = 0;
                const maxRetries = 3;
                
                while (!tableChanged && retries < maxRetries) {
                    try {
                        const currentFirstCompany = await page.$eval('#datatable tbody tr:first-child td:nth-child(3)', el => el.innerText);
                        console.log('New first company:', currentFirstCompany);
                        tableChanged = previousFirstCompany !== currentFirstCompany;
                        
                        if (tableChanged) {
                            console.log('Table content changed successfully');
                        } else {
                            console.log(`Table hasn't changed yet, retry ${retries + 1}/${maxRetries}`);
                            retries++;
                            await delay(2000);
                        }
                    } catch (e) {
                        console.log('Error checking table change:', e.message);
                        retries++;
                        await delay(2000);
                    }
                }
                
                // Wait for table data to be fully loaded
                await delay(3000);
                pageNum++;
            }
        } catch (error) {
            console.log('Pagination error:', error.message);
            console.log('Taking error screenshot...');
            await page.screenshot({ path: `error-page-${pageNum}.png` });
            
            // Try one more approach - click by coordinates if we have them
            try {
                const nextButtonBoundingBox = await page.evaluate(() => {
                    const nextButton = document.querySelector('#datatable_next');
                    if (!nextButton) return null;
                    const rect = nextButton.getBoundingClientRect();
                    return {
                        x: rect.x + rect.width/2,
                        y: rect.y + rect.height/2
                    };
                });
                
                if (nextButtonBoundingBox) {
                    console.log('Trying to click by coordinates:', nextButtonBoundingBox);
                    await page.mouse.click(nextButtonBoundingBox.x, nextButtonBoundingBox.y);
                    await delay(5000);
                    pageNum++;
                } else {
                    hasNextPage = false;
                }
            } catch (innerError) {
                console.log('Final click attempt failed:', innerError.message);
                hasNextPage = false;
            }
        }
    }

    // Save to both SQLite database and JSON
    // await saveToDatabase(allWarningLetters);
    saveToJson(allWarningLetters);

    // Close the browser
    await browser.close();
    console.log(`Scraping completed. Stored ${allWarningLetters.length} warning letters.`);
})();

// Function to save to SQLite database
async function saveToDatabase(warningLetters) {
    console.log('Saving data to SQLite database...');
    
    // Initialize SQLite Database
    const db = new sqlite3.Database('warning_letters.db');

    // Create a promise-based run function
    const run = (query, params) => {
        return new Promise((resolve, reject) => {
            db.run(query, params, function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
    };

    try {
        // Drop and recreate table with enhanced schema
        await run(`DROP TABLE IF EXISTS warning_letters`);
        await run(`
            CREATE TABLE warning_letters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                letter_id TEXT,
                posted_date TEXT,
                letter_issue_date TEXT,
                company_name TEXT,
                company_url TEXT,
                issuing_office TEXT,
                subject TEXT,
                response_letter TEXT,
                closeout_letter TEXT,
                excerpt TEXT,
                full_content TEXT,
                recipient_info TEXT,
                additional_info TEXT,
                scraped_at TEXT,
                error TEXT
            )
        `);

        // Create indices for faster searching
        await run('CREATE INDEX idx_letter_id ON warning_letters(letter_id)');
        await run('CREATE INDEX idx_company ON warning_letters(company_name)');
        await run('CREATE INDEX idx_date ON warning_letters(letter_issue_date)');
        await run('CREATE INDEX idx_subject ON warning_letters(subject)');
        
        // Create virtual FTS table for full-text search
        await run(`
            CREATE VIRTUAL TABLE IF NOT EXISTS warning_letters_fts 
            USING fts5(
                letter_id,
                company_name,
                subject,
                issuing_office,
                full_content
            )
        `);

        // Prepare statement for insertion
        const stmt = db.prepare(`
            INSERT INTO warning_letters (
                letter_id,
                posted_date,
                letter_issue_date,
                company_name,
                company_url,
                issuing_office,
                subject,
                response_letter,
                closeout_letter,
                excerpt,
                full_content,
                recipient_info,
                additional_info,
                scraped_at,
                error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        // Insert all records
        for (const letter of warningLetters) {
            stmt.run(
                letter.letterId || '',
                letter.postedDate || '',
                letter.letterIssueDate || '',
                letter.companyName || '',
                letter.companyUrl || '',
                letter.issuingOffice || '',
                letter.subject || '',
                letter.responseLetter || '',
                letter.closeoutLetter || '',
                letter.excerpt || '',
                letter.fullContent || '',
                JSON.stringify(letter.recipientInfo || {}),
                JSON.stringify(letter.additionalInfo || {}),
                letter.scrapedAt || new Date().toISOString(),
                letter.error || ''
            );
        }

        stmt.finalize();
        
        // Also insert into FTS table for full-text search
        const ftsStmt = db.prepare(`
            INSERT INTO warning_letters_fts (
                letter_id,
                company_name,
                subject,
                issuing_office,
                full_content
            ) VALUES (?, ?, ?, ?, ?)
        `);
        
        for (const letter of warningLetters) {
            ftsStmt.run(
                letter.letterId || '',
                letter.companyName || '',
                letter.subject || '',
                letter.issuingOffice || '',
                letter.fullContent || ''
            );
        }
        
        ftsStmt.finalize();
        
    } catch (error) {
        console.error('Database error:', error);
    } finally {
        // Close database
        db.close();
    }
}

// Function to save to JSON file
function saveToJson(warningLetters) {
    console.log('Saving data to JSON file...');
    
    // Create directory if it doesn't exist
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }
    
    // Save the full dataset
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fullOutputPath = path.join(outputDir, `fda_warning_letters_${timestamp}.json`);
    
    fs.writeFileSync(
        fullOutputPath, 
        JSON.stringify(warningLetters, null, 2)
    );
    
    console.log(`Full dataset saved to: ${fullOutputPath}`);
    
    // Also save individual JSON files for each letter
    const lettersDir = path.join(outputDir, 'letters');
    if (!fs.existsSync(lettersDir)) {
        fs.mkdirSync(lettersDir);
    }
    
    warningLetters.forEach((letter, index) => {
        const letterFilename = letter.letterId ? 
            `${letter.letterId}.json` : 
            `letter_${index}_${letter.companyName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
            
        const letterPath = path.join(lettersDir, letterFilename);
        
        fs.writeFileSync(
            letterPath,
            JSON.stringify(letter, null, 2)
        );
    });
    
    console.log(`Individual letter files saved to: ${lettersDir}`);
}
// const puppeteer = require('puppeteer');
// const sqlite3 = require('sqlite3').verbose();
// const fs = require('fs');
// const path = require('path');

// // Helper function for delay
// const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// // Main scraper function
// (async () => {
//     // Launch Puppeteer in non-headless mode for debugging
//     const browser = await puppeteer.launch({ 
//         headless: false,
//         defaultViewport: null
//     });
    
//     const page = await browser.newPage();
    
//     // Set longer timeouts
//     page.setDefaultTimeout(60000);
//     page.setDefaultNavigationTimeout(60000);

//     // Navigate to the FDA Warning Letters page
//     console.log('Navigating to FDA Warning Letters page...');
//     await page.goto('https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/compliance-actions-and-activities/warning-letters', {
//         waitUntil: 'networkidle2'
//     });

//     // Set dropdown to 100 entries
//     console.log('Setting dropdown to 100 entries...');
//     await page.waitForSelector('#datatable_length select', { visible: true, timeout: 10000 });
//     await page.select('#datatable_length select', '100');
//     await delay(5000); // Increased wait time for table update

//     // Initialize variables
//     let allWarningLetters = [];
//     const MAX_LETTERS = 10; // Limit to scraping only 10 letters

//     console.log(`Scraping up to ${MAX_LETTERS} warning letters...`);

//     // Wait for table to be visible
//     await page.waitForSelector('#datatable tbody tr', { visible: true, timeout: 10000 });

//     // Scrape the table data including links
//     const warningLetters = await page.evaluate(() => {
//         const rows = Array.from(document.querySelectorAll('#datatable tbody tr'));
//         return rows.map(row => {
//             const columns = row.querySelectorAll('td');
//             const companyLink = columns[2].querySelector('a');
//             return {
//                 postedDate: columns[0]?.innerText.trim() || '',
//                 letterIssueDate: columns[1]?.innerText.trim() || '',
//                 companyName: columns[2]?.innerText.trim() || '',
//                 companyUrl: companyLink ? companyLink.href : '',
//                 issuingOffice: columns[3]?.innerText.trim() || '',
//                 subject: columns[4]?.innerText.trim() || '',
//                 responseLetter: columns[5]?.innerText.trim() || '',
//                 closeoutLetter: columns[6]?.innerText.trim() || '',
//                 excerpt: columns[7]?.innerText.trim() || ''
//             };
//         });
//     });

//     // Process only the first MAX_LETTERS warning letters
//     const limitedWarningLetters = warningLetters.slice(0, MAX_LETTERS);
    
//     // Process each warning letter - fetch content from detail page
//     for (let i = 0; i < limitedWarningLetters.length; i++) {
//         const letter = limitedWarningLetters[i];
        
//         if (letter.companyUrl) {
//             try {
//                 console.log(`[${i+1}/${limitedWarningLetters.length}] Fetching content for: ${letter.companyName}`);
                
//                 // Open a new page for each letter to avoid navigation issues
//                 const letterPage = await browser.newPage();
//                 await letterPage.goto(letter.companyUrl, { 
//                     waitUntil: 'networkidle2',
//                     timeout: 60000
//                 });
                
//                 // Extract detailed information from the letter page
//                 const letterDetails = await letterPage.evaluate(() => {
//                     // Get the main content area
//                     const mainContent = document.querySelector('div[role="main"]');
//                     if (!mainContent) return { fullContent: '' };
                    
//                     // Extract the full content
//                     const fullContent = mainContent.innerText || '';
                    
//                     // Extract recipient information
//                     const recipientInfo = {};
//                     const recipientSection = document.querySelector('.col-xs-12.col-md-6 dl');
//                     if (recipientSection) {
//                         const addressElement = recipientSection.querySelector('p.address');
//                         if (addressElement) {
//                             recipientInfo.address = addressElement.innerText.trim();
//                         }
                        
//                         // Get email addresses
//                         const emailElements = Array.from(recipientSection.querySelectorAll('a[href^="mailto:"]'));
//                         if (emailElements.length > 0) {
//                             recipientInfo.emails = emailElements.map(el => el.textContent.trim());
//                         }
//                     }
                    
//                     // Extract reference/product info from the description list
//                     const infoList = {};
//                     const infoSection = document.querySelector('.inset-column .lcds-description-list--grid');
//                     if (infoSection) {
//                         const dtElements = Array.from(infoSection.querySelectorAll('dt'));
//                         dtElements.forEach(dt => {
//                             const key = dt.textContent.trim().replace(':', '');
//                             const value = dt.nextElementSibling ? dt.nextElementSibling.textContent.trim() : '';
//                             if (key && value) {
//                                 infoList[key] = value;
//                             }
//                         });
//                     }
                    
//                     // Get letter ID/reference from the heading or content
//                     let letterId = '';
//                     const headingElement = document.querySelector('.content-title');
//                     if (headingElement) {
//                         const headingText = headingElement.textContent.trim();
//                         const matches = headingText.match(/\d{6}/);
//                         if (matches && matches.length > 0) {
//                             letterId = matches[0];
//                         }
//                     }
                    
//                     // Return all collected data
//                     return {
//                         fullContent,
//                         recipientInfo,
//                         infoList,
//                         letterId
//                     };
//                 });
                
//                 // Add the details to the letter object
//                 letter.fullContent = letterDetails.fullContent || '';
//                 letter.recipientInfo = letterDetails.recipientInfo || {};
//                 letter.additionalInfo = letterDetails.infoList || {};
//                 letter.letterId = letterDetails.letterId || '';
                
//                 // Add timestamp of when this was scraped
//                 letter.scrapedAt = new Date().toISOString();
                
//                 // Close the letter page to free up resources
//                 await letterPage.close();
                
//                 // Add a small delay to avoid overloading the server
//                 await delay(1000);
                
//             } catch (error) {
//                 console.error(`Error fetching content for ${letter.companyName}:`, error.message);
//                 letter.fullContent = ''; // Set empty content on error
//                 letter.error = error.message;
//             }
//         }
//     }

//     // Add to our full collection
//     allWarningLetters = limitedWarningLetters;
//     console.log(`Total letters scraped: ${allWarningLetters.length}`);

//     // Save to both SQLite database and JSON
//     // await saveToDatabase(allWarningLetters);
//     saveToJson(allWarningLetters);

//     // Close the browser
//     await browser.close();
//     console.log(`Scraping completed. Stored ${allWarningLetters.length} warning letters.`);
// })();

// // Function to save to SQLite database
// async function saveToDatabase(warningLetters) {
//     console.log('Saving data to SQLite database...');
    
//     // Initialize SQLite Database
//     const db = new sqlite3.Database('warning_letters_test.db'); // Changed filename to indicate test run

//     // Create a promise-based run function
//     const run = (query, params) => {
//         return new Promise((resolve, reject) => {
//             db.run(query, params, function(err) {
//                 if (err) reject(err);
//                 else resolve(this);
//             });
//         });
//     };

//     try {
//         // Drop and recreate table with enhanced schema
//         await run(`DROP TABLE IF EXISTS warning_letters`);
//         await run(`
//             CREATE TABLE warning_letters (
//                 id INTEGER PRIMARY KEY AUTOINCREMENT,
//                 letter_id TEXT,
//                 posted_date TEXT,
//                 letter_issue_date TEXT,
//                 company_name TEXT,
//                 company_url TEXT,
//                 issuing_office TEXT,
//                 subject TEXT,
//                 response_letter TEXT,
//                 closeout_letter TEXT,
//                 excerpt TEXT,
//                 full_content TEXT,
//                 recipient_info TEXT,
//                 additional_info TEXT,
//                 scraped_at TEXT,
//                 error TEXT
//             )
//         `);

//         // Create indices for faster searching
//         await run('CREATE INDEX idx_letter_id ON warning_letters(letter_id)');
//         await run('CREATE INDEX idx_company ON warning_letters(company_name)');
//         await run('CREATE INDEX idx_date ON warning_letters(letter_issue_date)');
//         await run('CREATE INDEX idx_subject ON warning_letters(subject)');
        
//         // Create virtual FTS table for full-text search
//         await run(`
//             CREATE VIRTUAL TABLE IF NOT EXISTS warning_letters_fts 
//             USING fts5(
//                 letter_id,
//                 company_name,
//                 subject,
//                 issuing_office,
//                 full_content
//             )
//         `);

//         // Prepare statement for insertion
//         const stmt = db.prepare(`
//             INSERT INTO warning_letters (
//                 letter_id,
//                 posted_date,
//                 letter_issue_date,
//                 company_name,
//                 company_url,
//                 issuing_office,
//                 subject,
//                 response_letter,
//                 closeout_letter,
//                 excerpt,
//                 full_content,
//                 recipient_info,
//                 additional_info,
//                 scraped_at,
//                 error
//             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
//         `);

//         // Insert all records
//         for (const letter of warningLetters) {
//             stmt.run(
//                 letter.letterId || '',
//                 letter.postedDate || '',
//                 letter.letterIssueDate || '',
//                 letter.companyName || '',
//                 letter.companyUrl || '',
//                 letter.issuingOffice || '',
//                 letter.subject || '',
//                 letter.responseLetter || '',
//                 letter.closeoutLetter || '',
//                 letter.excerpt || '',
//                 letter.fullContent || '',
//                 JSON.stringify(letter.recipientInfo || {}),
//                 JSON.stringify(letter.additionalInfo || {}),
//                 letter.scrapedAt || new Date().toISOString(),
//                 letter.error || ''
//             );
//         }

//         stmt.finalize();
        
//         // Also insert into FTS table for full-text search
//         const ftsStmt = db.prepare(`
//             INSERT INTO warning_letters_fts (
//                 letter_id,
//                 company_name,
//                 subject,
//                 issuing_office,
//                 full_content
//             ) VALUES (?, ?, ?, ?, ?)
//         `);
        
//         for (const letter of warningLetters) {
//             ftsStmt.run(
//                 letter.letterId || '',
//                 letter.companyName || '',
//                 letter.subject || '',
//                 letter.issuingOffice || '',
//                 letter.fullContent || ''
//             );
//         }
        
//         ftsStmt.finalize();
        
//     } catch (error) {
//         console.error('Database error:', error);
//     } finally {
//         // Close database
//         db.close();
//     }
// }

// // Function to save to JSON file
// function saveToJson(warningLetters) {
//     console.log('Saving data to JSON file...');
    
//     // Create directory if it doesn't exist
//     const outputDir = path.join(__dirname, 'output');
//     if (!fs.existsSync(outputDir)) {
//         fs.mkdirSync(outputDir);
//     }
    
//     // Save the full dataset
//     const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
//     const fullOutputPath = path.join(outputDir, `fda_warning_letters_test_${timestamp}.json`);
    
//     fs.writeFileSync(
//         fullOutputPath, 
//         JSON.stringify(warningLetters, null, 2)
//     );
    
//     console.log(`Full dataset saved to: ${fullOutputPath}`);
    
//     // Also save individual JSON files for each letter
//     const lettersDir = path.join(outputDir, 'letters_test');
//     if (!fs.existsSync(lettersDir)) {
//         fs.mkdirSync(lettersDir);
//     }
    
//     warningLetters.forEach((letter, index) => {
//         const letterFilename = letter.letterId ? 
//             `${letter.letterId}.json` : 
//             `letter_${index}_${letter.companyName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
            
//         const letterPath = path.join(lettersDir, letterFilename);
        
//         fs.writeFileSync(
//             letterPath,
//             JSON.stringify(letter, null, 2)
//         );
//     });
    
//     console.log(`Individual letter files saved to: ${lettersDir}`);
// }