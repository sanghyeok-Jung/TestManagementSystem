# Appium Test Sample (Distributed Logic)

This sample demonstrates how to run **Appium** tests in a distributed environment where multiple devices might be connected to the same agent.

## 🚀 Key Feature: Port Conflict Resolution

One of the biggest challenges in distributed Appium testing is that each device session requires unique ports. This sample solves this by:
1. **Dynamic Port Discovery**: The script finds available ports at runtime for both the **Appium Server** and the **Internal Driver Ports** (`systemPort` for Android, `wdaLocalPort` for iOS).
2. **Local Server Lifecycle**: It starts a dedicated Appium server instance for the duration of the job and shuts it down upon completion.

## 🛠 Configuration (`tms.json`)

- `APP_PACKAGE`: The package name (Android) or Bundle ID (iOS) to test.
- `PLATFORM`: Choose between Android or iOS.
- `AUTOMATION_NAME`: Usually `UiAutomator2` for Android and `XCUITest` for iOS.

## 📁 Project Structure

- `test.js`: Contains the logic to:
  - Find free ports.
  - Spawn an `appium` process.
  - Connect via `webdriverio`.
  - Launch/Terminate the app.
- `package.json`: Handles `npm install` and pre-installs necessary Appium drivers via `postinstall`.

## 📋 Requirements

- The Agent machine must have the **Appium CLI** available (installed via npm).
- For Android: Android SDK and local `adb` access.
- For iOS: macOS with Xcode and `idb`/`xcrun` access.

## 💻 How to use

1. Zip this folder.
2. Upload to TMS.
3. run on a specific device!
