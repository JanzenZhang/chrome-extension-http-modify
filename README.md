# HTTP Header Modifier (SolidJS + Tailwind)

A high-performance Chrome extension built with **SolidJS** (No Virtual DOM) and Tailwind CSS. It allows you to intercept and modify HTTP/HTTPS request headers globally with near-native speed.

## Features

- **No Virtual DOM**: Built with SolidJS for fine-grained reactivity and maximum performance.
- **Ultra Lightweight**: Final bundle size is extremely small (~14KB JS), ensuring instant popup loading.
- **Global Interception**: Modifies outgoing headers for all requests.
- **Manifest V3 Compliant**: Fully adheres to strict CSP rules.
- **Modern UI**: Styled with Tailwind CSS (Shadcn UI aesthetic).

## Development Setup

### Installation

1.  Clone the repository.
2.  Install dependencies:
    ```bash
    cd extension-solid
    npm install
    ```

### Building the Extension

```bash
cd extension-solid
npm run build
```

The build output will be in `extension-solid/dist`.

## Loading into Chrome

1.  Navigate to `chrome://extensions/`.
2.  Enable **"Developer mode"**.
3.  Click **"Load unpacked"**.
4.  Select the **`extension-solid/dist`** folder.

## Technical Stack

- **Framework**: SolidJS (Fine-grained reactivity)
- **Bundler**: Vite
- **Styling**: Tailwind CSS v3
- **Chrome API**: `declarativeNetRequest`, `storage.local`

## License

MIT
