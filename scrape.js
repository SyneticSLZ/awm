const puppeteer = require('puppeteer');
const sqlite3 = require('sqlite3').verbose();

// Helper function for delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    // Launch Puppeteer in non-headless mode for debugging
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    // Navigate to the FDA Warning Letters page
    console.log('Navigating to page...');
    await page.goto('https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/compliance-actions-and-activities/warning-letters', {
        waitUntil: 'networkidle2'
    });

    // Set dropdown to 100 entries
    console.log('Setting dropdown to 100 entries...');
    await page.waitForSelector('#datatable_length select', { visible: true, timeout: 10000 });
    await page.select('#datatable_length select', '100');
    await delay(5000); // Increased wait time for table update

    let allWarningLetters = [];
    let hasNextPage = true;
    let pageNum = 1;

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

        allWarningLetters = allWarningLetters.concat(warningLetters);
        console.log(`Scraped ${warningLetters.length} letters from page ${pageNum}. Total so far: ${allWarningLetters.length}`);

        // Check for next page button - using more robust approach
        try {
            console.log('Looking for next button...');
            
            // Take a screenshot for debugging
            await page.screenshot({ path: `debug-page-${pageNum}.png` });
            
            // Check if the next button exists and is not disabled using JavaScript evaluation
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
                console.log('Scrolling to next button...');
                await page.evaluate(() => {
                    const nextButton = document.querySelector('#datatable_next');
                    if (nextButton) {
                        // Scroll the button into view
                        nextButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                });
                
                // Give time for the scroll to complete
                await delay(1000);
                
                // Try using JavaScript click instead of Puppeteer click
                await page.evaluate(() => {
                    const nextButton = document.querySelector('#datatable_next');
                    if (nextButton) {
                        console.log('Clicking next button via JS');
                        nextButton.click();
                    }
                });
                
                // Don't wait for the page number to change, just wait for table data to update
                console.log('Waiting for table to refresh...');
                
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

    // Close the browser
    await browser.close();

    // Initialize SQLite Database
    const db = new sqlite3.Database('warning_letters.db');

    // Drop and recreate table
    db.serialize(() => {
        db.run(`DROP TABLE IF EXISTS warning_letters`);
        db.run(`
            CREATE TABLE warning_letters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                postedDate TEXT,
                letterIssueDate TEXT,
                companyName TEXT,
                companyUrl TEXT,
                issuingOffice TEXT,
                subject TEXT,
                responseLetter TEXT,
                closeoutLetter TEXT,
                excerpt TEXT
            )
        `);

        const stmt = db.prepare(`
            INSERT INTO warning_letters (
                postedDate, 
                letterIssueDate, 
                companyName, 
                companyUrl,
                issuingOffice, 
                subject, 
                responseLetter, 
                closeoutLetter, 
                excerpt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        allWarningLetters.forEach(letter => {
            stmt.run(
                letter.postedDate,
                letter.letterIssueDate,
                letter.companyName,
                letter.companyUrl,
                letter.issuingOffice,
                letter.subject,
                letter.responseLetter,
                letter.closeoutLetter,
                letter.excerpt
            );
        });

        stmt.finalize();
    });

    db.close();
    console.log(`Scraping completed. Stored ${allWarningLetters.length} warning letters.`);
})();