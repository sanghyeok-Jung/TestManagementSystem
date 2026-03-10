# API Test Sample (Device-less)

This sample demonstrates how to run **REST API** tests directly on a TMS Agent host without requiring a physical mobile device.

## 🛠 Features Demonstrated

- **Device-less Execution**: Targeted at the Agent Environment (Agent VM) rather than a mobile device.
- **Node.js Fetch API**: Uses the built-in `fetch` (Node.js 18+) for lightweight testing.
- **Dynamic URL Configuration**: Demonstrates how to pass a target API URL via the TMS parameters.
- **Exit Code Integration**: Shows how to exit with code `1` on test failure to notify the Orchestrator.

## 📁 Project Structure

- `tms.json`: Configured with `type: "api"` to enable Agent-only target selection in the UI.
- `package.json`: Simple dependency-free setup (using standard Node.js).
- `test.js`: Core test logic that performs GET and POST requests against a target URL.

## 🛠 Configuration (`tms.json`)

- `API_URL`: The base URL of the REST API to test. Defaults to [JSONPlaceholder](https://jsonplaceholder.typicode.com).

## 🚀 How to use with QA Lab Orchestrator

1. **Zip the contents**:
   ```bash
   zip -r api-test-sample.zip .
   ```
2. **Upload**: Go to the **Project Management** page and upload the zip file.
3. **Run**:
   - Open the **Script Runner**.
   - Select **"Verify API endpoint operation"**.
   - Notice that the **Targets** list only shows **Agent VM** nodes (Mobile devices are filtered out).
   - Select an online Agent and run!

## 💻 Local Testing

```bash
# Optional: Set a custom API URL
export API_URL=https://jsonplaceholder.typicode.com

npm test
```
