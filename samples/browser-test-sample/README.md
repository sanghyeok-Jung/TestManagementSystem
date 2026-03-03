# Browser Test Sample (Extended)

This is a comprehensive sample browser-based test project designed to demonstrate the advanced capabilities of the **QA Lab Orchestrator**.

## 🛠 Features Demonstrated

- **Playwright Integration**: Automated browser testing.
- **Dynamic Parameters**:
  - `required`: Mandatory parameters (e.g., `API_TOKEN`).
  - `options`: Dropdown selection in UI (e.g., `BROWSER`, `TEST_ENV`).
  - `defaultValue`: Pre-filled values for convenience.
- **Auto-Installation**: Uses `postinstall` in `package.json` to automatically set up browser binaries.
- **Retry Logic**: Demonstrates how to handle failure retries using passed parameters.

## 📁 Project Structure

- `tms.json`: Defines the rich UI interaction for parameters.
- `package.json`: Manages dependencies and environment setup.
- `test.js`: Core test logic that reads environment variables passed by the Orchestrator.

## 🚀 How to use with QA Lab Orchestrator

1. **Zip the contents**:
   ```bash
   zip -r browser-test-sample.zip . -x "node_modules/*"
   ```
2. **Upload**: Use the **Project Management** page.
3. **Run**:
   - Select the **"Verify Web Page Title"** script.
   - You will see dropdowns for Browser/Env and a required field for API Token.
   - Provide the values and run on a target Agent.

## 💻 Local Testing

```bash
# Set required env vars
export API_TOKEN=your_token_here
export TARGET_URL=https://www.google.com

npm install
npm test
```
