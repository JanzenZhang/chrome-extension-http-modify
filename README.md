# HTTP Header Modifier (Chrome Extension)

A lightweight Chrome extension built with Manifest V3 that allows you to intercept and modify HTTP/HTTPS request headers globally.

## Features

- **Global Interception**: Intercepts all outgoing browser requests.
- **Custom Headers**: Add multiple custom HTTP header key-value pairs.
- **Toggle Switch**: Easily enable or disable header injection without uninstalling the extension.
- **Persistent Storage**: Your configurations are saved locally in the browser using `chrome.storage`.
- **Manifest V3**: Built using the latest Chrome extension standards for better performance and security (via `declarativeNetRequest` API).
- **Clean UI**: User-friendly popup interface for managing headers.

## Installation

1.  **Download/Clone** this repository to your local machine.
2.  Open Google Chrome and navigate to `chrome://extensions/`.
3.  Turn on the **"Developer mode"** toggle in the top right corner.
4.  Click the **"Load unpacked"** button in the top left.
5.  Select the folder where you saved this project.

## How to Use

1.  Click the **HTTP Header Modifier** icon in your browser's toolbar (you may need to pin it from the extensions puzzle icon).
2.  Use the toggle switch at the top to enable the extension.
3.  Add headers:
    - Enter the **Header Name** (e.g., `X-Custom-Auth`).
    - Enter the **Value** (e.g., `SecretToken123`).
4.  Click **"+ Add Header"** to add more rows if needed.
5.  Click **"Save & Apply"** to activate the configuration.
6.  The specified headers will now be added to every request made by the browser.

## Technical Details

- **Manifest Version**: 3
- **API Usage**: 
  - `chrome.declarativeNetRequest`: For efficient and secure header modification.
  - `chrome.storage.local`: For saving user configurations.
- **Permissions**: `declarativeNetRequest`, `storage`, `<all_urls>`.

## License

MIT
