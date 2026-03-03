const assert = require('assert');

// Assume TMS passes parameters via environment variables
// If there's no environment variable, use JSONPlaceholder as default
const API_URL = process.env.API_URL || 'https://jsonplaceholder.typicode.com';

async function runTests() {
    console.log(`===============================================`);
    console.log(`🚀 Starting API Tests against: ${API_URL}`);
    console.log(`===============================================`);

    let passed = 0;
    let failed = 0;

    try {
        // [Test 1] Verify GET request
        console.log('\n[Test 1] Fetching a post (GET /posts/1)...');
        const res1 = await fetch(`${API_URL}/posts/1`);

        assert.strictEqual(res1.status, 200, `Expected status 200, got ${res1.status}`);
        const data1 = await res1.json();
        assert.strictEqual(data1.id, 1, `Expected post ID to be 1, got ${data1.id}`);

        console.log('✅ Test 1 Passed: Successfully retrieved the post.');
        passed++;
    } catch (error) {
        console.error('❌ Test 1 Failed:', error.message);
        failed++;
    }

    try {
        // [Test 2] Verify POST request
        console.log('\n[Test 2] Creating a new post (POST /posts)...');
        const newPost = { title: 'TMS Test', body: 'Automated test post', userId: 999 };
        const res2 = await fetch(`${API_URL}/posts`, {
            method: 'POST',
            body: JSON.stringify(newPost),
            headers: { 'Content-type': 'application/json; charset=UTF-8' },
        });

        assert.strictEqual(res2.status, 201, `Expected status 201, got ${res2.status}`);
        const data2 = await res2.json();
        assert.strictEqual(data2.title, 'TMS Test', `Expected title 'TMS Test', got ${data2.title}`);

        console.log('✅ Test 2 Passed: Successfully created a new post.');
        passed++;
    } catch (error) {
        console.error('❌ Test 2 Failed:', error.message);
        failed++;
    }

    // Summary of results
    console.log(`\n===============================================`);
    console.log(`📊 Test Summary: ${passed} Passed, ${failed} Failed`);
    console.log(`===============================================`);

    // If at least one test fails, exit with Error Code 1 so the agent recognizes it as failed
    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runTests();
