chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
  chrome.storage.local.get(['headers', 'enabled', 'domains'], (result) => {
    const initialState = {
      enabled: result.enabled ?? true,
      headers: Array.isArray(result.headers) ? result.headers : [],
      domains: Array.isArray(result.domains) ? result.domains : []
    };

    chrome.storage.local.set(initialState);
  });
});

// Optional: Log when rules are updated for debugging
// chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
//   console.log('Rule matched:', info);
// });
