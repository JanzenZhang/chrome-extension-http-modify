chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
  // Initialize storage if empty
  chrome.storage.local.get(['headers', 'enabled'], (result) => {
    if (result.enabled === undefined) {
      chrome.storage.local.set({ enabled: true, headers: [] });
    }
  });
});

// Optional: Log when rules are updated for debugging
// chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
//   console.log('Rule matched:', info);
// });
