const { remote } = require('webdriverio');
const { exec } = require('child_process');
const net = require('net');

// Helper to get parameters from env or CLI arguments (--KEY=VALUE)
function getParam(key, defaultValue = undefined) {
    if (process.env[key]) return process.env[key];
    const arg = process.argv.find(a => a.startsWith(`--${key}=`));
    return arg ? arg.split('=')[1] : defaultValue;
}

const DEVICE_ID = getParam('DEVICE_ID');
const APP_PACKAGE = getParam('APP_PACKAGE');
const PLATFORM = (getParam('PLATFORM', 'Android')).toLowerCase();
const AUTOMATION_NAME = getParam('AUTOMATION_NAME', PLATFORM === 'android' ? 'UiAutomator2' : 'XCUITest');
const APP_ACTIVITY = getParam('APP_ACTIVITY', '');

const ANDROID_HOME = getParam('ANDROID_HOME') || process.env.ANDROID_HOME;
const JAVA_HOME = getParam('JAVA_HOME') || process.env.JAVA_HOME;

/**
 * Finding a free port to avoid conflicts when multiple jobs run on the same agent.
 */
function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function runTest() {
    console.log(`===============================================`);
    console.log(`📱 Starting Appium Test`);
    console.log(`📍 Device ID: ${DEVICE_ID}`);
    console.log(`📦 App: ${APP_PACKAGE}`);
    console.log(`🏗️  Platform: ${PLATFORM}`);
    console.log(`===============================================`);

    if (!DEVICE_ID) {
        console.error('❌ Error: DEVICE_ID is not provided. This script must run on a target device.');
        process.exit(1);
    }

    try {
        const appiumPort = await getFreePort();
        const systemPort = await getFreePort();

        console.log(`🚀 Starting local Appium server on port ${appiumPort}... (APPIUM_HOME=.)`);

        // Prepare environment for Appium
        const appiumEnv = { ...process.env, APPIUM_HOME: process.cwd() };

        // If ANDROID_HOME is not set, try common Mac path or warn
        if (PLATFORM === 'android' && !ANDROID_HOME) {
            const commonAndroidPath = `${process.env.HOME}/Library/Android/sdk`;
            if (require('fs').existsSync(commonAndroidPath)) {
                appiumEnv.ANDROID_HOME = commonAndroidPath;
                console.log(`💡 ANDROID_HOME not set, using default: ${commonAndroidPath}`);
            } else {
                console.warn(`⚠️  WARNING: ANDROID_HOME is not set. Android tests might fail.`);
            }
        } else if (ANDROID_HOME) {
            appiumEnv.ANDROID_HOME = ANDROID_HOME;
        }

        if (JAVA_HOME) {
            appiumEnv.JAVA_HOME = JAVA_HOME;
        }

        // Start Appium server as a background process
        const appiumProcess = exec(`npx appium -p ${appiumPort} --relaxed-security`, { env: appiumEnv });

        appiumProcess.stdout.on('data', (data) => console.log(`[Appium] ${data.trim()}`));
        appiumProcess.stderr.on('data', (data) => console.error(`[Appium Error] ${data.trim()}`));

        // Wait for Appium to be ready (simplistic approach for sample)
        await new Promise(resolve => setTimeout(resolve, 5000));

        const caps = {
            platformName: PLATFORM,
            'appium:deviceName': DEVICE_ID,
            'appium:udid': DEVICE_ID,
            'appium:automationName': AUTOMATION_NAME,
            'appium:noReset': true,
        };

        if (PLATFORM === 'android') {
            caps['appium:appPackage'] = APP_PACKAGE;
            caps['appium:appActivity'] = APP_ACTIVITY;
            caps['appium:systemPort'] = systemPort; // Avoid conflict with other Android sessions
        } else {
            caps['appium:bundleId'] = APP_PACKAGE;
            caps['appium:wdaLocalPort'] = systemPort; // Avoid conflict with other iOS sessions
        }

        console.log(`\n🔗 Connecting to Appium with capabilities...`);
        const driver = await remote({
            protocol: 'http',
            hostname: '127.0.0.1',
            port: appiumPort,
            path: '/',
            capabilities: caps
        });

        console.log(`✅ Session created. App should be launched.`);

        // Scenario: Wait for 5 seconds and close
        console.log(`⏳ Waiting for 5 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log(`🛑 Closing application...`);
        await driver.terminateApp(APP_PACKAGE);

        console.log(`\n✅ Test Passed: Successfully launched and closed the app.`);

        await driver.deleteSession();
        appiumProcess.kill();
        process.exit(0);

    } catch (error) {
        console.error(`\n❌ Test Failed: ${error.message}`);
        process.exit(1);
    }
}

runTest();
