import { createSignal, onMount, For, Show } from "solid-js";

interface HeaderConfig {
  key: string;
  value: string;
}

interface StoredConfig {
  headers?: HeaderConfig[];
  enabled?: boolean;
  domains?: string[];
}

const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HOST_RE =
  /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const IPV4_RE =
  /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

const DEFAULT_HEADERS: HeaderConfig[] = [{ key: "", value: "" }];

type StatusType = "success" | "error";

function App() {
  const [headers, setHeaders] = createSignal<HeaderConfig[]>(DEFAULT_HEADERS);
  const [enabled, setEnabled] = createSignal(true);
  const [domainInput, setDomainInput] = createSignal("");
  const [statusMsg, setStatusMsg] = createSignal("");
  const [statusType, setStatusType] = createSignal<StatusType>("success");

  const setStatus = (msg: string, type: StatusType, timeoutMs = 3000) => {
    setStatusMsg(msg);
    setStatusType(type);
    setTimeout(() => setStatusMsg(""), timeoutMs);
  };

  const readLastError = (context: string) => {
    const error = chrome.runtime.lastError;
    if (error) {
      throw new Error(`${context}: ${error.message}`);
    }
  };

  const storageGet = (keys: string[]) =>
    new Promise<StoredConfig>((resolve, reject) => {
      chrome.storage.local.get(keys, (result) => {
        try {
          readLastError("Failed to read extension storage");
          resolve(result as StoredConfig);
        } catch (error) {
          reject(error);
        }
      });
    });

  const storageSet = (payload: StoredConfig) =>
    new Promise<void>((resolve, reject) => {
      chrome.storage.local.set(payload, () => {
        try {
          readLastError("Failed to persist extension storage");
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });

  const getDynamicRules = () =>
    new Promise<chrome.declarativeNetRequest.Rule[]>((resolve, reject) => {
      chrome.declarativeNetRequest.getDynamicRules((rules) => {
        try {
          readLastError("Failed to read dynamic rules");
          resolve(rules);
        } catch (error) {
          reject(error);
        }
      });
    });

  const updateDynamicRules = (
    rulesToRemove: number[],
    rulesToAdd: chrome.declarativeNetRequest.Rule[],
  ) =>
    new Promise<void>((resolve, reject) => {
      chrome.declarativeNetRequest.updateDynamicRules(
        { removeRuleIds: rulesToRemove, addRules: rulesToAdd },
        () => {
          try {
            readLastError("Failed to update dynamic rules");
            resolve();
          } catch (error) {
            reject(error);
          }
        },
      );
    });

  const parseDomains = (value: string) => {
    const parts = value
      .split(/[\n,]/)
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);

    return Array.from(new Set(parts));
  };

  const isValidDomain = (domain: string) => {
    if (domain === "localhost") {
      return true;
    }
    if (IPV4_RE.test(domain)) {
      return true;
    }
    return HOST_RE.test(domain);
  };

  const normalizeHeaders = (rawHeaders: HeaderConfig[]) =>
    rawHeaders
      .filter(
        (header) => header.key.trim() !== "" || header.value.trim() !== "",
      )
      .map((header) => ({
        key: header.key.trim(),
        value: header.value.trim(),
      }));

  const validateConfig = (
    rawHeaders: HeaderConfig[],
    rawDomainInput: string,
  ) => {
    const normalizedHeaders = normalizeHeaders(rawHeaders);
    const keySet = new Set<string>();

    for (const header of normalizedHeaders) {
      if (header.key === "" || header.value === "") {
        return {
          error: "All non-empty headers must include both key and value.",
        };
      }

      if (!HEADER_NAME_RE.test(header.key)) {
        return { error: `Invalid header key: ${header.key}` };
      }

      if (/[\r\n]/.test(header.value)) {
        return {
          error: `Invalid header value for ${header.key}: newline characters are not allowed.`,
        };
      }

      const normalizedKey = header.key.toLowerCase();
      if (keySet.has(normalizedKey)) {
        return { error: `Duplicate header key: ${header.key}` };
      }
      keySet.add(normalizedKey);
    }

    const domains = parseDomains(rawDomainInput);
    for (const domain of domains) {
      if (!isValidDomain(domain)) {
        return { error: `Invalid domain pattern: ${domain}` };
      }
    }

    return { headers: normalizedHeaders, domains };
  };

  const buildRule = (
    id: number,
    urlFilter: string,
    validHeaders: HeaderConfig[],
  ) => ({
    id,
    priority: 1,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
      requestHeaders: validHeaders.map((header) => ({
        header: header.key,
        operation: chrome.declarativeNetRequest.HeaderOperation.SET,
        value: header.value,
      })),
    },
    condition: {
      urlFilter,
      resourceTypes: Object.values(
        chrome.declarativeNetRequest.ResourceType,
      ) as chrome.declarativeNetRequest.ResourceType[],
    },
  });

  const updateRules = async (
    validHeaders: HeaderConfig[],
    ruleDomains: string[],
    isEnabled: boolean,
  ) => {
    if (!chrome.declarativeNetRequest) {
      return;
    }

    const existingRules = await getDynamicRules();
    const desiredRules: chrome.declarativeNetRequest.Rule[] =
      !isEnabled || validHeaders.length === 0
        ? []
        : ruleDomains.length === 0
          ? [buildRule(1, "*", validHeaders)]
          : ruleDomains.map((domain, index) =>
              buildRule(
                index + 1,
                `||${domain.replace(/^\*\./, "")}/`,
                validHeaders,
              ),
            );

    const existingMap = new Map(existingRules.map((rule) => [rule.id, rule]));
    const desiredMap = new Map(desiredRules.map((rule) => [rule.id, rule]));

    const serializeRule = (rule: chrome.declarativeNetRequest.Rule) =>
      JSON.stringify({
        priority: rule.priority,
        action: rule.action,
        condition: rule.condition,
      });

    const removeRuleIds = existingRules
      .filter((rule) => {
        const desiredRule = desiredMap.get(rule.id);
        return (
          !desiredRule || serializeRule(desiredRule) !== serializeRule(rule)
        );
      })
      .map((rule) => rule.id);

    const addRules = desiredRules.filter((rule) => {
      const existingRule = existingMap.get(rule.id);
      return (
        !existingRule || serializeRule(existingRule) !== serializeRule(rule)
      );
    });

    if (removeRuleIds.length === 0 && addRules.length === 0) {
      return;
    }

    await updateDynamicRules(removeRuleIds, addRules);
  };

  onMount(() => {
    if (
      typeof chrome === "undefined" ||
      !chrome.storage ||
      !chrome.declarativeNetRequest
    ) {
      setStatus(
        "Chrome extension APIs are unavailable in this environment.",
        "error",
        4500,
      );
      return;
    }

    void (async () => {
      try {
        const result = await storageGet(["headers", "enabled", "domains"]);
        if (result.headers && result.headers.length > 0) {
          setHeaders(result.headers);
        }
        if (result.enabled !== undefined) {
          setEnabled(result.enabled);
        }
        if (result.domains && result.domains.length > 0) {
          setDomainInput(result.domains.join("\n"));
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown initialization error.";
        setStatus(message, "error", 4500);
      }
    })();
  });

  const addHeader = () => {
    setHeaders([...headers(), { key: "", value: "" }]);
  };

  const removeHeader = (index: number) => {
    const newHeaders = headers().filter((_, itemIndex) => itemIndex !== index);
    setHeaders(newHeaders.length > 0 ? newHeaders : DEFAULT_HEADERS);
  };

  const updateHeader = (index: number, field: "key" | "value", val: string) => {
    const newHeaders = [...headers()];
    newHeaders[index][field] = val;
    setHeaders(newHeaders);
  };

  const saveConfig = async () => {
    if (
      typeof chrome === "undefined" ||
      !chrome.storage ||
      !chrome.declarativeNetRequest
    ) {
      setStatus(
        "Chrome extension APIs are unavailable in this environment.",
        "error",
      );
      return;
    }

    const result = validateConfig(headers(), domainInput());
    if (result.error) {
      setStatus(result.error, "error");
      return;
    }

    const validHeaders = result.headers ?? [];
    const validDomains = result.domains ?? [];

    try {
      await storageSet({
        headers: validHeaders,
        enabled: enabled(),
        domains: validDomains,
      });
      await updateRules(validHeaders, validDomains, enabled());
      setStatus("Changes applied successfully.", "success", 2500);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected save error.";
      setStatus(message, "error", 4500);
    }
  };

  return (
    <div class="flex flex-col bg-background p-5 min-h-[100px]">
      <header class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-xl font-bold tracking-tight text-foreground">
            Modifier
          </h1>
          <p class="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">
            HTTP Header Injector
          </p>
        </div>

        <label class="group relative inline-flex items-center cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled()}
            onChange={(event) => setEnabled(event.currentTarget.checked)}
            class="sr-only peer"
          />
          <div class="w-11 h-6 bg-muted rounded-full peer peer-focus:ring-2 peer-focus:ring-ring transition-all peer-checked:bg-primary after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5 shadow-sm"></div>
        </label>
      </header>

      <main class="flex-1 space-y-4 mb-6">
        <div class="flex items-center justify-between text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">
          <div class="flex gap-4 w-full mr-11">
            <span class="flex-1">Header Key</span>
            <span class="flex-1 ml-2">Value</span>
          </div>
        </div>

        <div class="space-y-3">
          <For each={headers()}>
            {(header, index) => (
              <div class="flex items-center gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
                <div class="flex-1 flex gap-2 p-1.5 rounded-lg border border-border bg-muted/10 focus-within:bg-muted/30 focus-within:border-primary/30 transition-all min-w-0">
                  <input
                    type="text"
                    value={header.key}
                    onInput={(event) =>
                      updateHeader(index(), "key", event.currentTarget.value)
                    }
                    placeholder="e.g. Authorization"
                    class="w-1/2 bg-transparent text-sm font-medium focus:outline-none placeholder:text-muted-foreground/50 min-w-0"
                  />
                  <div class="w-[1px] h-4 bg-border self-center shrink-0"></div>
                  <input
                    type="text"
                    value={header.value}
                    onInput={(event) =>
                      updateHeader(index(), "value", event.currentTarget.value)
                    }
                    placeholder="Value..."
                    class="w-1/2 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50 min-w-0"
                  />
                </div>

                <button
                  onClick={() => removeHeader(index())}
                  class="inline-flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 h-8 w-8 transition-all shrink-0"
                  title="Remove"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            )}
          </For>
        </div>

        <div class="flex items-center gap-3">
          <button
            onClick={addHeader}
            class="flex-1 flex items-center justify-center gap-2 rounded-xl text-xs font-semibold border-2 border-dashed border-muted-foreground/20 text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 h-10 transition-all active:scale-[0.98]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            Add Custom Header
          </button>
          <div class="w-8 shrink-0"></div>
        </div>

        <div class="space-y-2">
          <div class="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">
            Domains (Optional)
          </div>
          <textarea
            value={domainInput()}
            onInput={(event) => setDomainInput(event.currentTarget.value)}
            placeholder="example.com\napi.example.com\nlocalhost"
            rows={4}
            class="w-full rounded-lg border border-border bg-muted/10 focus:bg-muted/20 focus:border-primary/30 transition-all px-3 py-2 text-sm focus:outline-none placeholder:text-muted-foreground/50"
          />
          <p class="text-[11px] text-muted-foreground px-1">
            Leave empty to apply globally. One domain per line or
            comma-separated.
          </p>
        </div>
      </main>

      <footer class="pt-2">
        <div class="flex items-center gap-3">
          <button
            onClick={saveConfig}
            class="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 h-11 transition-all active:scale-[0.98]"
          >
            Save & Apply Changes
          </button>
          <div class="w-8 shrink-0"></div>
        </div>

        <div class="h-8 mt-2 flex items-center justify-center overflow-hidden">
          <Show when={statusMsg()}>
            <span
              class="text-[11px] font-bold flex items-center gap-1.5 animate-in slide-in-from-bottom-2 duration-300"
              classList={{
                "text-destructive": statusType() === "error",
                "text-primary": statusType() === "success",
              }}
            >
              <Show when={statusType() === "success"}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </Show>
              {statusMsg()}
            </span>
          </Show>
        </div>
      </footer>
    </div>
  );
}

export default App;
