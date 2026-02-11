import { createSignal, onMount, For, Show } from 'solid-js';

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
      
      setStatusMsg('Changes applied successfully');
      setTimeout(() => setStatusMsg(''), 2500);
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
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ruleIdsToRemove, addRules: [] });
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
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ruleIdsToRemove, addRules: [newRule] });
  };

  return (
    <div class="flex flex-col bg-background p-5 min-h-[420px]">
      {/* Header Section */}
      <header class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-xl font-bold tracking-tight text-foreground">Modifier</h1>
          <p class="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">HTTP Header Injector</p>
        </div>
        
        <label class="group relative inline-flex items-center cursor-pointer select-none">
          <input 
            type="checkbox" 
            checked={enabled()} 
            onChange={(e) => setEnabled(e.currentTarget.checked)}
            class="sr-only peer"
          />
          <div class="w-11 h-6 bg-muted rounded-full peer peer-focus:ring-2 peer-focus:ring-ring transition-all peer-checked:bg-primary after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5 shadow-sm"></div>
        </label>
      </header>

      {/* Main List */}
      <main class="flex-1 space-y-4 mb-6">
        <div class="flex items-center justify-between text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">
          <div class="flex gap-4 w-full mr-10">
            <span class="flex-1">Header Key</span>
            <span class="flex-1 ml-2">Value</span>
          </div>
        </div>
        
        <div class="max-h-[260px] overflow-y-auto space-y-3 pr-2 -mr-2">
          <For each={headers()}>
            {(header, i) => (
              <div class="flex items-center gap-2 group animate-in fade-in slide-in-from-top-1 duration-200">
                <div class="flex-1 flex gap-2 p-1.5 rounded-lg border border-transparent group-hover:border-border group-hover:bg-muted/30 transition-all">
                  <input 
                    type="text" 
                    value={header.key}
                    onInput={(e) => updateHeader(i(), 'key', e.currentTarget.value)}
                    placeholder="e.g. Authorization" 
                    class="flex-1 bg-transparent text-sm font-medium focus:outline-none placeholder:text-muted-foreground/50"
                  />
                  <div class="w-[1px] h-4 bg-border self-center"></div>
                  <input 
                    type="text" 
                    value={header.value}
                    onInput={(e) => updateHeader(i(), 'value', e.currentTarget.value)}
                    placeholder="Value..." 
                    class="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50"
                  />
                </div>
                
                <button 
                  onClick={() => removeHeader(i())} 
                  class="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 w-8 transition-all shrink-0"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
            )}
          </For>
        </div>

        <button 
          onClick={addHeader} 
          class="flex items-center justify-center gap-2 rounded-xl text-xs font-semibold border-2 border-dashed border-muted-foreground/20 text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 h-10 w-full transition-all active:scale-[0.98]"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
          Add Custom Header
        </button>
      </main>

      {/* Footer Section */}
      <footer class="pt-2">
        <button 
          onClick={saveConfig} 
          class="inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 h-11 w-full transition-all active:scale-[0.98]"
        >
          Save & Apply Changes
        </button>
        
        <div class="h-8 mt-2 flex items-center justify-center overflow-hidden">
          <Show when={statusMsg()}>
            <span class="text-[11px] text-primary font-bold flex items-center gap-1.5 animate-in slide-in-from-bottom-2 duration-300">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              {statusMsg()}
            </span>
          </Show>
        </div>
      </footer>
    </div>
  );
}

export default App;
