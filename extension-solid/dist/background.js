const ALARM_NAME = 'header-modifier-expiry';

function getStorage(keys, callback) {
  chrome.storage.local.get(keys, (result) => {
    if (chrome.runtime.lastError) {
      console.error('Failed to read storage:', chrome.runtime.lastError.message);
      return;
    }
    callback(result);
  });
}

function setStorage(payload, callback) {
  chrome.storage.local.set(payload, () => {
    if (chrome.runtime.lastError) {
      console.error('Failed to write storage:', chrome.runtime.lastError.message);
      return;
    }
    if (callback) {
      callback();
    }
  });
}

function clearAllDynamicRules(callback) {
  chrome.declarativeNetRequest.getDynamicRules((rules) => {
    if (chrome.runtime.lastError) {
      console.error('Failed to read dynamic rules:', chrome.runtime.lastError.message);
      return;
    }

    const ruleIds = rules.map((rule) => rule.id);
    chrome.declarativeNetRequest.updateDynamicRules(
      { removeRuleIds: ruleIds, addRules: [] },
      () => {
        if (chrome.runtime.lastError) {
          console.error('Failed to clear dynamic rules:', chrome.runtime.lastError.message);
          return;
        }
        if (callback) {
          callback();
        }
      }
    );
  });
}

function disableExtensionByExpiry() {
  setStorage({ enabled: false, temporaryUntil: null }, () => {
    clearAllDynamicRules(() => {
      chrome.alarms.clear(ALARM_NAME);
    });
  });
}

function clearExpiryAlarm() {
  chrome.alarms.clear(ALARM_NAME);
}

function scheduleExpiryAlarm(temporaryUntil) {
  if (typeof temporaryUntil !== 'number' || temporaryUntil <= 0) {
    clearExpiryAlarm();
    return;
  }

  if (temporaryUntil <= Date.now()) {
    disableExtensionByExpiry();
    return;
  }

  chrome.alarms.create(ALARM_NAME, { when: temporaryUntil });
}

function syncAlarmFromStorage() {
  getStorage(['enabled', 'temporaryUntil'], (result) => {
    if (!result.enabled) {
      clearExpiryAlarm();
      return;
    }

    scheduleExpiryAlarm(result.temporaryUntil ?? null);
  });
}

function initializeStorage() {
  getStorage(['headers', 'enabled', 'domains', 'domainMatchMode', 'temporaryUntil'], (result) => {
    const initialState = {
      enabled: result.enabled ?? true,
      headers: Array.isArray(result.headers) ? result.headers : [],
      domains: Array.isArray(result.domains) ? result.domains : [],
      domainMatchMode: ['exact', 'include_subdomains', 'subdomains_only'].includes(result.domainMatchMode)
        ? result.domainMatchMode
        : 'include_subdomains',
      temporaryUntil: typeof result.temporaryUntil === 'number' ? result.temporaryUntil : null
    };

    setStorage(initialState, syncAlarmFromStorage);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
  initializeStorage();
});

chrome.runtime.onStartup.addListener(() => {
  syncAlarmFromStorage();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    disableExtensionByExpiry();
  }
});

// Optional: Log when rules are updated for debugging
// chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
//   console.log('Rule matched:', info);
// });
