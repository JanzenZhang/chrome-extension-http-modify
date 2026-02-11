# HTTP Header Modifier (Angular 19 + Shadcn UI)

A modern, high-performance Chrome extension built with Angular 19 (Zoneless) and Tailwind CSS (Shadcn UI style). It allows you to intercept and modify HTTP/HTTPS request headers globally.

## Features

- **Global Interception**: Intercepts all outgoing browser requests.
- **Custom Headers**: Add multiple custom HTTP header key-value pairs.
- **Modern UI**: Clean, responsive interface styled with Tailwind CSS, mimicking Shadcn UI.
- **Zoneless Architecture**: Built with Angular 19's zoneless mode for smaller bundle size and better performance.
- **Manifest V3 Compliant**: Fully adheres to the strict Content Security Policy (CSP) of MV3.
- **Persistent Storage**: Configurations saved locally using `chrome.storage`.

## Development Setup

### Prerequisites

- Node.js (v20+)
- npm (v10+)
- Angular CLI (v19+)

### Installation

1.  Clone the repository.
2.  Install dependencies:
    ```bash
    cd extension-ui
    npm install
    ```

### Building the Extension

To build the project for production:

```bash
cd extension-ui
ng build
```

> **Note**: Optimization is disabled in `angular.json` to prevent inline script/style injection, ensuring compliance with Chrome's Content Security Policy (CSP).

The output files will be generated in `extension-ui/dist/extension-ui/browser`.

## Loading into Chrome

1.  Open Google Chrome and navigate to `chrome://extensions/`.
2.  Turn on **"Developer mode"** (top right).
3.  Click **"Load unpacked"**.
4.  Select the **`extension-ui/dist/extension-ui/browser`** folder inside this project.
5.  The extension is now installed!

## Technical Implementation Details

- **Framework**: Angular 19 (Zoneless mode)
- **Styling**: Tailwind CSS v3 (Custom Shadcn UI implementation)
- **CSP Fixes**: 
    - Disabled CSS/JS inlining in `angular.json`.
    - Explicitly defined `extension_pages` CSP in `manifest.json`.
    - Set `baseHref` to `./` for correct asset loading within the extension context.
- **Chrome APIs**: `declarativeNetRequest` for rule-based header modification, `storage.local` for settings.

## License

MIT
