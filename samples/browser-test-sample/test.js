const playwright = require('playwright');
const assert = require('assert');

// TMS passes parameters via environment variables
const TARGET_URL = process.env.TARGET_URL || 'https://www.google.com';
const BROWSER_TYPE = process.env.BROWSER || 'chromium';
const TEST_ENV = process.env.TEST_ENV || 'staging';
const RETRY_COUNT = parseInt(process.env.RETRY_COUNT || '0');

async function runTest() {
    console.log(`===============================================`);
    console.log(`🚀 Starting Browser Test`);
    console.log(`📍 URL: ${TARGET_URL}`);
    console.log(`🌐 Browser: ${BROWSER_TYPE}`);
    console.log(`🏗️  Env: ${TEST_ENV}`);
    console.log(`🔄 Retries: ${RETRY_COUNT}`);
    console.log(`===============================================`);

    const browser = await playwright[BROWSER_TYPE].launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    let attempts = 0;
    let success = false;

    while (attempts <= RETRY_COUNT && !success) {
        attempts++;
        try {
            if (attempts > 1) console.log(`\nRetrying... Attempt ${attempts}/${RETRY_COUNT + 1}`);

            console.log(`Navigating to ${TARGET_URL}...`);
            await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

            const title = await page.title();
            console.log(`✅ Page Title: ${title}`);

            assert(title.length > 0, 'Page title should not be empty');
            success = true;
        } catch (error) {
            console.error(`\n❌ Attempt ${attempts} Failed: ${error.message}`);
            if (attempts > RETRY_COUNT) {
                console.log(`\n===============================================`);
                console.log(`📊 Test Summary: 0 Passed, 1 Failed (All retries exhausted)`);
                console.log(`===============================================`);
                await browser.close();
                process.exit(1);
            }
        }
    }

    console.log(`\n✅ Test Passed: Successfully accessed the page and retrieved the title.`);
    console.log(`===============================================`);
    console.log(`📊 Test Summary: 1 Passed, 0 Failed`);
    console.log(`===============================================`);

    await browser.close();
    process.exit(0);
}

runTest();
