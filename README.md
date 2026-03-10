<h1 align="center">QA Lab Orchestrator</h1>

<div align="center">
  <h3>Scalable Distributed Test Management & Device Farm Solution</h3>
  <p><i>🤖 This project was entirely designed and implemented by an AI Coding Assistant.</i></p>
</div>

<p align="center">
  A powerful enterprise-grade platform to build your own internal Device Farm. Connect multiple host PCs as agents, dynamically manage iOS & Android devices, and orchestrate automated test jobs globally from a single, modern web interface.
</p>

## ✨ Key Features

- **🌐 Centralized Web Dashboard:** A responsive React 18 + Vite frontend built with Tailwind CSS and Radix UI to control your entire lab.
- **📱 Real-time Device Remote Control:** Stream device screens in real-time. Full remote interaction (Tap, Swipe, Home, Back, App Switch, Screen Rotation).
- **📦 Effortless App Installation:** Automatically process and install `.aab` (Android App Bundle) directly to remote devices using local `bundletool`.
- **🖥️ Native Node Shell & ADB Shell:** Access high-performance interactive shells. Supports both ADB Shell for devices and **Native Node Shell (with PTY simulation)** for the host agent.
- **🚀 Job Type Segregation:** Clearly separate **Mobile Testing** (Android/iOS) from **Node Farm Testing** (API/Browser). Run automated tasks directly on the Agent host without needing physical devices.
- **⏰ Automated Task Scheduling:** Orchestrate periodic test executions using flexible Cron expressions. Create, manage, and monitor recurring test jobs across specific agents and devices.
- **🔌 Agent-based Architecture:** Run lightweight Node.js agents on any macOS/Windows machine to connect physical devices instantly to the central hub.

---

## 🏗️ Architecture Stack

This repository is structured as a **Turborepo** monorepo containing the following workspaces:

- `apps/web`: The React Frontend (Vite, TailwindCSS, Socket.io-client)
- `apps/server`: The Central Hub (Node.js, Fastify, Socket.io) handling orchestration and storage.
- `packages/agent`: The Device Node Agent (Node.js) running on local host machines to bridge physical devices (via `adb` / `idevice_id`).
- `packages/types`: Shared TypeScript definitions across all workspaces.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `npm` or `yarn` or `pnpm`
- **For Android Devices:** Android SDK Platform-Tools (`adb` must be in your system PATH)
- **For iOS Devices:** `libimobiledevice` (specifically `idevice_id` and `ideviceinfo`)
- **For `.aab` Installation:** `java` must be installed and `bundletool.jar` / `debug.keystore` must be placed in a `tools/` directory.

### 1. Installation

Clone the repository and install all dependencies from the root directory:

```bash
git clone https://github.com/sanghyeok-Jung/TestManagementSystem.git
cd TestManagementSystem
npm install
```

### 2. Running the System

You can run the entire system (Frontend, Server, and Local Agent) concurrently using Turbo:

```bash
# Starts the Web UI, Central Server, and Agent
npm run dev
```

Alternatively, you can run them individually:

**Terminal 1: Start the Central Server**
```bash
cd apps/server
npm run dev
# Server runs on http://localhost:3000
```

**Terminal 2: Start the Web UI**
```bash
cd apps/web
npm run dev
# Web UI runs on http://localhost:5173
```

**Terminal 3: Start an Agent (Connect devices to this machine)**
```bash
# Set SERVER_URL if the central server is on a different machine
# export SERVER_URL=http://<SERVER_IP>:3000
cd packages/agent
npm run dev
```

---

## ⚙️ Project Configuration (`tms.json`)

To utilize the Orchestrator's automated job running features, your uploaded test script projects (`.zip`) **MUST** contain a `tms.json` file at their root directory.

This file defines the project's metadata, available test scripts, and required parameters.

### `tms.json` Schema Example

```json
{
  "name": "E-Commerce E2E Tests",
  "description": "Appium E2E and Cypress API test suite.",
  "scripts": [
    {
      "name": "Android Regression",
      "type": "mobile",
      "command": "npm run test:android",
      "description": "Runs Appium tests on a mobile device.",
      "parameters": [
        { "key": "ENV", "defaultValue": "staging", "options": ["staging", "prod"], "required": true }
      ]
    },
    {
      "name": "API Functional Test",
      "type": "api",
      "command": "npm run test:api",
      "description": "Runs API tests directly on the Agent host (Node Farm).",
      "parameters": []
    }
  ]
}
```

### Property: `type` (Optional)
Supported values for each script:
- `mobile` (Default): Requires a target physical device (Android/iOS).
- `api`: Runs directly on the Agent host VM. No device required.
- `browser`: Similar to API, intended for Selenium/Playwright/Cypress tests.

### Uploading and Running a Project
1. Zip your entire test project repository (ensure `node_modules` is excluded to save space).
2. The root of the `.zip` archive must contain the `tms.json` file.
3. Upload the `.zip` via the Web UI in the **Project Management** section.
4. Select the specific script and target devices/agents to run!

---

## 🤝 Contributing
Feedback, bug reports, and pull requests are highly appreciated. 
Please ensure you run `npm run lint` and `npm run build` before submitting PRs.

## 📄 License
This project is licensed under the MIT License - see the LICENSE file for details.
