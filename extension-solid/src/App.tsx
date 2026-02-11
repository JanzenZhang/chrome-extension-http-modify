import { createSignal, onMount, For } from 'solid-js';

interface HeaderConfig {
  key: string;
  value: string;
}

function App() {
  const [headers, setHeaders] = createSignal<HeaderConfig[]>([{ key: '', value: '' }]);
  const [enabled, setEnabled] = createSignal(true);
  const [statusMsg, setStatusMsg] = createSignal('');

  onMount(() => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['headers', 'enabled'], (result: { [key: string]: any }) => {
        if (result.headers && result.headers.length > 0) {
          setHeaders(result.headers);
        }
        if (result.enabled !== undefined) {
          setEnabled(result.enabled);
        }
      });
    }
  });

  const addHeader = () => {
    setHeaders([...headers(), { key: '', value: '' }]);
  };

  const removeHeader = (index: number) => {
    const newHeaders = headers().filter((_, i) => i !== index);
    setHeaders(newHeaders.length > 0 ? newHeaders : [{ key: '', value: '' }]);
  };

  const updateHeader = (index: number, field: 'key' | 'value', val: string) => {
    const newHeaders = [...headers()];
    newHeaders[index][field] = val;
    setHeaders(newHeaders);
  };

  const saveConfig = async () => {
    const validHeaders = headers().filter(h => h.key.trim() !== '');
    
    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.set({ headers: validHeaders, enabled: enabled() });
      await updateRules(validHeaders, enabled());
      
      setStatusMsg('Saved and Applied!');
      setTimeout(() => setStatusMsg(''), 2000);
    } else {
      console.log('Mock Save:', validHeaders, enabled());
    }
  };

  const updateRules = async (headers: HeaderConfig[], enabled: boolean) => {
    if (!chrome.declarativeNetRequest) return;

    const ruleId = 1;
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const ruleIdsToRemove = existingRules.map(r => r.id);

    if (!enabled || headers.length === 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIdsToRemove,
        addRules: []
      });
      return;
    }

    const newRule: chrome.declarativeNetRequest.Rule = {
      id: ruleId,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        requestHeaders: headers.map(h => ({
          header: h.key,
          operation: chrome.declarativeNetRequest.HeaderOperation.SET,
          value: h.value
        }))
      },
      condition: {
        urlFilter: '*',
        resourceTypes: Object.values(chrome.declarativeNetRequest.ResourceType)
      }
    };

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ruleIdsToRemove,
      addRules: [newRule]
    });
  };

  return (
    <div class="p-4 bg-background min-h-[400px]">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-lg font-semibold tracking-tight">Header Modifier (Solid)</h2>
        
        {/* Shadcn Switch implementation */}
        <label class="relative inline-flex items-center cursor-pointer">
          <input 
            type="checkbox" 
            checked={enabled()} 
            onChange={(e) => setEnabled(e.currentTarget.checked)}
            class="sr-only peer"
          />
          <div class="w-9 h-5 bg-input peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ring rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-background after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
        </label>
      </div>

      <div class="space-y-3 mb-4 max-h-[300px] overflow-y-auto pr-1">
        <For each={headers()}>
          {(header, i) => (
            <div class="flex items-center gap-2 group">
              <input 
                type="text" 
                value={header.key}
                onInput={(e) => updateHeader(i(), 'key', e.currentTarget.value)}
                placeholder="Key" 
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring"
              />
              <input 
                type="text" 
                value={header.value}
                onInput={(e) => updateHeader(i(), 'value', e.currentTarget.value)}
                placeholder="Value" 
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring"
              />
              <button 
                onClick={() => removeHeader(i())} 
                class="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-destructive/10 hover:text-destructive h-9 w-9 shrink-0"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
          )}
        </For>
      </div>

      <button 
        onClick={addHeader} 
        class="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2 w-full mb-3 border-dashed"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
        Add Header
      </button>

      <button 
        onClick={saveConfig} 
        class="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2 w-full"
      >
        Save & Apply
      </button>

      <div class="mt-2 text-center h-5">
        <span class="text-xs text-green-600 font-medium animate-pulse italic">
          {statusMsg()}
        </span>
      </div>
    </div>
  );
}

export default App;
