document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('headers-container');
  const addBtn = document.getElementById('add-header');
  const saveBtn = document.getElementById('save-config');
  const enableToggle = document.getElementById('enable-toggle');
  const statusMsg = document.getElementById('status-msg');

  // Load configuration
  chrome.storage.local.get(['headers', 'enabled'], (result) => {
    if (result.headers && result.headers.length > 0) {
      result.headers.forEach(h => addHeaderRow(h.key, h.value));
    } else {
      addHeaderRow('', ''); // Add one empty row by default
    }
    enableToggle.checked = result.enabled !== false; // Default to true
  });

  function addHeaderRow(key = '', value = '') {
    const row = document.createElement('div');
    row.className = 'header-item';
    row.innerHTML = `
      <input type="text" placeholder="Header Name" class="header-key" value="${key}">
      <input type="text" placeholder="Value" class="header-value" value="${value}">
      <button class="btn-remove">×</button>
    `;
    
    row.querySelector('.btn-remove').addEventListener('click', () => {
      row.remove();
      if (container.children.length === 0) {
        addHeaderRow();
      }
    });
    
    container.appendChild(row);
  }

  addBtn.addEventListener('click', () => addHeaderRow());

  saveBtn.addEventListener('click', async () => {
    const headerRows = container.querySelectorAll('.header-item');
    const headers = [];
    headerRows.forEach(row => {
      const key = row.querySelector('.header-key').value.trim();
      const value = row.querySelector('.header-value').value.trim();
      if (key) {
        headers.push({ key, value });
      }
    });

    const enabled = enableToggle.checked;

    // Save to storage
    await chrome.storage.local.set({ headers, enabled });

    // Update declarativeNetRequest rules
    await updateRules(headers, enabled);

    statusMsg.textContent = 'Configuration saved and applied!';
    setTimeout(() => {
      statusMsg.textContent = '';
    }, 2000);
  });

  async function updateRules(headers, enabled) {
    const ruleId = 1;
    
    // First, remove existing rules
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const ruleIdsToRemove = existingRules.map(r => r.id);

    if (!enabled || headers.length === 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIdsToRemove,
        addRules: []
      });
      return;
    }

    // Create new rule
    const newRule = {
      id: ruleId,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: headers.map(h => ({
          header: h.key,
          operation: 'set',
          value: h.value
        }))
      },
      condition: {
        urlFilter: '*',
        resourceTypes: [
          'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 
          'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 
          'media', 'websocket', 'other'
        ]
      }
    };

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ruleIdsToRemove,
      addRules: [newRule]
    });
  }
});
