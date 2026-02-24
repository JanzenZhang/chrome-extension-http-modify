import { createMemo, createSignal, onMount, For, Show } from "solid-js";

interface HeaderConfig {
  key: string;
  value: string;
}

type DomainMatchMode = "exact" | "include_subdomains" | "subdomains_only";
type StatusType = "success" | "error";

interface StoredConfig {
  headers?: HeaderConfig[];
  enabled?: boolean;
  domains?: string[];
  domainMatchMode?: DomainMatchMode;
  temporaryUntil?: number | null;
}

interface ValidatedPayload {
  headers: HeaderConfig[];
  domains: string[];
  temporaryMinutes: number;
}

const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HOST_RE =
  /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const IPV4_RE =
  /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const DEFAULT_HEADERS: HeaderConfig[] = [{ key: "", value: "" }];
const ALARM_NAME = "header-modifier-expiry";

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripWildcardPrefix(domain: string) {
  return domain.replace(/^\*\./, "");
}

function App() {
  const [headers, setHeaders] = createSignal<HeaderConfig[]>(DEFAULT_HEADERS);
  const [enabled, setEnabled] = createSignal(true);
  const [domainInput, setDomainInput] = createSignal("");
  const [domainMatchMode, setDomainMatchMode] =
    createSignal<DomainMatchMode>("include_subdomains");
  const [temporaryMinutesInput, setTemporaryMinutesInput] = createSignal("0");
  const [statusMsg, setStatusMsg] = createSignal("");
  const [statusType, setStatusType] = createSignal<StatusType>("success");

  let importFileInput: HTMLInputElement | undefined;

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

  const clearAlarm = (name: string) =>
    new Promise<void>((resolve, reject) => {
      if (!chrome.alarms) {
        resolve();
        return;
      }
      chrome.alarms.clear(name, () => {
        try {
          readLastError("Failed to clear extension alarm");
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });

  const createAlarm = (name: string, when: number) =>
    new Promise<void>((resolve, reject) => {
      if (!chrome.alarms) {
        resolve();
        return;
      }
      chrome.alarms.create(name, { when });
      const error = chrome.runtime.lastError;
      if (error) {
        reject(
          new Error(`Failed to schedule extension alarm: ${error.message}`),
        );
        return;
      }
      resolve();
    });

  const syncExpiryAlarm = async (temporaryUntil: number | null) => {
    await clearAlarm(ALARM_NAME);
    if (temporaryUntil && temporaryUntil > Date.now()) {
      await createAlarm(ALARM_NAME, temporaryUntil);
    }
  };

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
  const parsedDomains = createMemo(() => parseDomains(domainInput()));

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

  const parseTemporaryMinutes = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === "") {
      return 0;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (
      !Number.isFinite(parsed) ||
      Number.isNaN(parsed) ||
      parsed < 0 ||
      parsed > 1440
    ) {
      return null;
    }

    return parsed;
  };

  const validateConfig = (
    rawHeaders: HeaderConfig[],
    rawDomainInput: string,
  ): { ok: true; payload: ValidatedPayload } | { ok: false; error: string } => {
    const normalizedHeaders = normalizeHeaders(rawHeaders);
    const keySet = new Set<string>();

    for (const header of normalizedHeaders) {
      if (header.key === "" || header.value === "") {
        return {
          ok: false,
          error: "All non-empty headers must include both key and value.",
        };
      }

      if (!HEADER_NAME_RE.test(header.key)) {
        return { ok: false, error: `Invalid header key: ${header.key}` };
      }

      if (/[\r\n]/.test(header.value)) {
        return {
          ok: false,
          error: `Invalid header value for ${header.key}: newline characters are not allowed.`,
        };
      }

      const normalizedKey = header.key.toLowerCase();
      if (keySet.has(normalizedKey)) {
        return { ok: false, error: `Duplicate header key: ${header.key}` };
      }
      keySet.add(normalizedKey);
    }

    const domains = parseDomains(rawDomainInput);
    for (const domain of domains) {
      if (!isValidDomain(domain)) {
        return { ok: false, error: `Invalid domain pattern: ${domain}` };
      }

      if (
        domainMatchMode() === "subdomains_only" &&
        (domain === "localhost" || IPV4_RE.test(domain))
      ) {
        return {
          ok: false,
          error: `Subdomains-only mode does not support ${domain}.`,
        };
      }
    }

    const temporaryMinutes = parseTemporaryMinutes(temporaryMinutesInput());
    if (temporaryMinutes === null) {
      return {
        ok: false,
        error: "Temporary minutes must be an integer between 0 and 1440.",
      };
    }

    return {
      ok: true,
      payload: { headers: normalizedHeaders, domains, temporaryMinutes },
    };
  };

  const buildCondition = (
    domain: string,
    mode: DomainMatchMode,
  ): chrome.declarativeNetRequest.RuleCondition => {
    const normalizedDomain = stripWildcardPrefix(domain);
    const resourceTypes = Object.values(
      chrome.declarativeNetRequest.ResourceType,
    ) as chrome.declarativeNetRequest.ResourceType[];

    if (mode === "include_subdomains") {
      return {
        urlFilter: `||${normalizedDomain}/`,
        resourceTypes,
      };
    }

    const escapedDomain = escapeRegex(normalizedDomain);
    if (mode === "exact") {
      return {
        regexFilter: `^https?:\\/\\/${escapedDomain}(?::\\d+)?\\/`,
        resourceTypes,
      };
    }

    return {
      regexFilter: `^https?:\\/\\/(?:[^./]+\\.)+${escapedDomain}(?::\\d+)?\\/`,
      resourceTypes,
    };
  };

  const buildRule = (
    id: number,
    validHeaders: HeaderConfig[],
    condition: chrome.declarativeNetRequest.RuleCondition,
  ): chrome.declarativeNetRequest.Rule => ({
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
    condition,
  });

  const updateRules = async (
    validHeaders: HeaderConfig[],
    ruleDomains: string[],
    isEnabled: boolean,
    mode: DomainMatchMode,
  ) => {
    if (!chrome.declarativeNetRequest) {
      return;
    }

    const existingRules = await getDynamicRules();
    const desiredRules: chrome.declarativeNetRequest.Rule[] =
      !isEnabled || validHeaders.length === 0
        ? []
        : ruleDomains.length === 0
          ? [
              buildRule(1, validHeaders, {
                urlFilter: "*",
                resourceTypes: Object.values(
                  chrome.declarativeNetRequest.ResourceType,
                ) as chrome.declarativeNetRequest.ResourceType[],
              }),
            ]
          : ruleDomains.map((domain, index) =>
              buildRule(index + 1, validHeaders, buildCondition(domain, mode)),
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

  const exportConfig = () => {
    const result = validateConfig(headers(), domainInput());
    if (!result.ok) {
      setStatus(result.error, "error");
      return;
    }

    const payload = {
      version: 1,
      enabled: enabled(),
      headers: result.payload.headers,
      domains: result.payload.domains,
      domainMatchMode: domainMatchMode(),
      temporaryMinutes: result.payload.temporaryMinutes,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "http-header-modifier-config.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importConfig = async (event: Event) => {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const data = JSON.parse(text) as {
        enabled?: unknown;
        headers?: unknown;
        domains?: unknown;
        domainMatchMode?: unknown;
        temporaryMinutes?: unknown;
      };

      const importedHeaders = Array.isArray(data.headers)
        ? data.headers
            .filter(
              (item): item is HeaderConfig =>
                typeof item === "object" &&
                item !== null &&
                "key" in item &&
                "value" in item &&
                typeof (item as { key: unknown }).key === "string" &&
                typeof (item as { value: unknown }).value === "string",
            )
            .map((item) => ({ key: item.key, value: item.value }))
        : DEFAULT_HEADERS;

      const importedDomains = Array.isArray(data.domains)
        ? data.domains.filter(
            (item): item is string => typeof item === "string",
          )
        : [];

      const importedMode: DomainMatchMode =
        data.domainMatchMode === "exact" ||
        data.domainMatchMode === "include_subdomains" ||
        data.domainMatchMode === "subdomains_only"
          ? data.domainMatchMode
          : "include_subdomains";

      const importedTemporaryMinutes =
        typeof data.temporaryMinutes === "number" &&
        Number.isFinite(data.temporaryMinutes)
          ? Math.max(0, Math.min(1440, Math.round(data.temporaryMinutes)))
          : 0;

      setHeaders(
        importedHeaders.length > 0 ? importedHeaders : DEFAULT_HEADERS,
      );
      setEnabled(typeof data.enabled === "boolean" ? data.enabled : true);
      setDomainInput(importedDomains.join("\n"));
      setDomainMatchMode(importedMode);
      setTemporaryMinutesInput(String(importedTemporaryMinutes));

      setStatus(
        "Config imported. Click Save & Apply Changes to activate.",
        "success",
        4000,
      );
    } catch {
      setStatus("Failed to import config JSON.", "error", 4000);
    } finally {
      target.value = "";
    }
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
        const result = await storageGet([
          "headers",
          "enabled",
          "domains",
          "domainMatchMode",
          "temporaryUntil",
        ]);
        if (result.headers && result.headers.length > 0) {
          setHeaders(result.headers);
        }
        if (result.enabled !== undefined) {
          setEnabled(result.enabled);
        }
        if (result.domains && result.domains.length > 0) {
          setDomainInput(result.domains.join("\n"));
        }
        if (
          result.domainMatchMode === "exact" ||
          result.domainMatchMode === "include_subdomains" ||
          result.domainMatchMode === "subdomains_only"
        ) {
          setDomainMatchMode(result.domainMatchMode);
        }

        if (
          typeof result.temporaryUntil === "number" &&
          result.temporaryUntil > Date.now()
        ) {
          const remaining = Math.ceil(
            (result.temporaryUntil - Date.now()) / 60000,
          );
          setTemporaryMinutesInput(String(Math.max(1, remaining)));
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
    if (!result.ok) {
      setStatus(result.error, "error");
      return;
    }

    const {
      headers: validHeaders,
      domains: validDomains,
      temporaryMinutes,
    } = result.payload;
    const temporaryUntil =
      enabled() && temporaryMinutes > 0
        ? Date.now() + temporaryMinutes * 60_000
        : null;

    try {
      await storageSet({
        headers: validHeaders,
        enabled: enabled(),
        domains: validDomains,
        domainMatchMode: domainMatchMode(),
        temporaryUntil,
      });

      await updateRules(
        validHeaders,
        validDomains,
        enabled(),
        domainMatchMode(),
      );
      await syncExpiryAlarm(temporaryUntil);

      if (temporaryUntil) {
        setStatus(
          `Changes applied. Auto-disable in ${temporaryMinutes} minute(s).`,
          "success",
          3500,
        );
      } else {
        setStatus("Changes applied successfully.", "success", 2500);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected save error.";
      setStatus(message, "error", 4500);
    }
  };

  const applyTemporaryPreset = (minutes: number) => {
    setTemporaryMinutesInput(String(minutes));
  };

  return (
    <div class="h-[520px] w-full bg-gradient-to-b from-background to-slate-50/60 px-3 pt-3 pb-1.5 flex flex-col gap-1.5">
      <header class="rounded-2xl border border-border bg-card/80 backdrop-blur px-4 py-3">
        <div class="flex items-start justify-between">
          <div>
            <h1 class="text-lg font-black tracking-tight text-foreground leading-tight">
              HTTP Header Modifier
            </h1>
            <p class="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mt-1">
              Request Header Rules
            </p>
          </div>
          <span class="text-[10px] rounded-full px-2 py-1 bg-muted text-muted-foreground font-semibold">
            MV3
          </span>
        </div>
        <div class="mt-3 flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2">
          <div class="flex items-center gap-2">
            <span
              class="h-2 w-2 rounded-full"
              classList={{
                "bg-emerald-500": enabled(),
                "bg-slate-400": !enabled(),
              }}
            />
            <span class="text-xs font-semibold text-foreground">
              {enabled() ? "Modifier enabled" : "Modifier disabled"}
            </span>
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
        </div>
      </header>

      <main class="flex-1 min-h-0 space-y-2.5 pr-1 overflow-y-auto overscroll-y-contain">
        <section class="rounded-2xl border border-border bg-card p-3 space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Headers
            </h2>
            <button
              onClick={addHeader}
              class="inline-flex items-center justify-center gap-1 rounded-lg border border-dashed border-muted-foreground/30 px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-primary hover:border-primary/60 hover:bg-primary/5 transition-all"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
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
              Add
            </button>
          </div>
          <For each={headers()}>
            {(header, index) => (
              <div class="grid grid-cols-[24px_1fr_34px] gap-2 items-center animate-in fade-in slide-in-from-top-1 duration-200">
                <span class="text-[10px] font-bold text-muted-foreground text-center">
                  {index() + 1}
                </span>
                <div class="flex gap-2 p-2 rounded-xl border border-border bg-muted/10 focus-within:bg-muted/25 focus-within:border-primary/30 transition-all min-w-0">
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
                  class="inline-flex items-center justify-center rounded-lg text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 h-8 w-8 transition-all shrink-0"
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
        </section>

        <section class="rounded-2xl border border-border bg-card p-3 space-y-2">
          <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Scope
          </h2>
          <textarea
            value={domainInput()}
            onInput={(event) => setDomainInput(event.currentTarget.value)}
            placeholder="example.com\napi.example.com\nlocalhost"
            rows={4}
            class="w-full rounded-lg border border-border bg-muted/10 focus:bg-muted/20 focus:border-primary/30 transition-all px-3 py-2 text-sm focus:outline-none placeholder:text-muted-foreground/50 resize-none"
          />
          <div class="flex flex-wrap gap-1.5">
            <Show
              when={parsedDomains().length > 0}
              fallback={
                <span class="text-[11px] text-muted-foreground">
                  Empty means global matching.
                </span>
              }
            >
              <For each={parsedDomains().slice(0, 8)}>
                {(domain) => (
                  <span class="inline-flex items-center rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-foreground">
                    {domain}
                  </span>
                )}
              </For>
              <Show when={parsedDomains().length > 8}>
                <span class="inline-flex items-center rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                  +{parsedDomains().length - 8}
                </span>
              </Show>
            </Show>
          </div>
          <div class="grid grid-cols-3 gap-1 rounded-xl bg-muted/40 p-1">
            <button
              onClick={() => setDomainMatchMode("exact")}
              class="h-8 rounded-lg text-[11px] font-semibold transition-all"
              classList={{
                "bg-background shadow-sm text-foreground":
                  domainMatchMode() === "exact",
                "text-muted-foreground hover:text-foreground":
                  domainMatchMode() !== "exact",
              }}
            >
              Exact
            </button>
            <button
              onClick={() => setDomainMatchMode("include_subdomains")}
              class="h-8 rounded-lg text-[11px] font-semibold transition-all"
              classList={{
                "bg-background shadow-sm text-foreground":
                  domainMatchMode() === "include_subdomains",
                "text-muted-foreground hover:text-foreground":
                  domainMatchMode() !== "include_subdomains",
              }}
            >
              Host + Sub
            </button>
            <button
              onClick={() => setDomainMatchMode("subdomains_only")}
              class="h-8 rounded-lg text-[11px] font-semibold transition-all"
              classList={{
                "bg-background shadow-sm text-foreground":
                  domainMatchMode() === "subdomains_only",
                "text-muted-foreground hover:text-foreground":
                  domainMatchMode() !== "subdomains_only",
              }}
            >
              Sub Only
            </button>
          </div>
          <p class="text-[11px] text-muted-foreground">
            One per line or comma. `Sub Only` excludes root host.
          </p>
        </section>

        <section class="rounded-2xl border border-border bg-card p-3 space-y-2">
          <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Duration
          </h2>
          <div class="grid grid-cols-4 gap-1">
            <button
              onClick={() => applyTemporaryPreset(0)}
              class="h-8 rounded-lg border border-border text-[11px] font-semibold hover:bg-muted/40 transition-all"
            >
              Off
            </button>
            <button
              onClick={() => applyTemporaryPreset(15)}
              class="h-8 rounded-lg border border-border text-[11px] font-semibold hover:bg-muted/40 transition-all"
            >
              15m
            </button>
            <button
              onClick={() => applyTemporaryPreset(60)}
              class="h-8 rounded-lg border border-border text-[11px] font-semibold hover:bg-muted/40 transition-all"
            >
              1h
            </button>
            <button
              onClick={() => applyTemporaryPreset(480)}
              class="h-8 rounded-lg border border-border text-[11px] font-semibold hover:bg-muted/40 transition-all"
            >
              8h
            </button>
          </div>
          <div class="flex items-center gap-2">
            <input
              type="number"
              min="0"
              max="1440"
              value={temporaryMinutesInput()}
              onInput={(event) =>
                setTemporaryMinutesInput(event.currentTarget.value)
              }
              class="w-full rounded-lg border border-border bg-muted/10 focus:bg-muted/20 focus:border-primary/30 transition-all px-3 py-2 text-sm focus:outline-none"
            />
            <span class="text-xs font-semibold text-muted-foreground">min</span>
          </div>
          <p class="text-[11px] text-muted-foreground">
            0 means always on. Max 1440 minutes.
          </p>
        </section>
      </main>

      <footer class="space-y-0 shrink-0">
        <section class="rounded-xl border border-border bg-card px-2.5 py-2 space-y-2">
          <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Actions
          </h2>
          <div class="grid grid-cols-2 gap-2">
            <button
              onClick={exportConfig}
              class="inline-flex items-center justify-center rounded-lg border border-border h-[32px] text-[11px] font-semibold hover:bg-muted/30 transition-all"
            >
              Export JSON
            </button>
            <button
              onClick={() => importFileInput?.click()}
              class="inline-flex items-center justify-center rounded-lg border border-border h-[32px] text-[11px] font-semibold hover:bg-muted/30 transition-all"
            >
              Import JSON
            </button>
          </div>
          <button
            onClick={saveConfig}
            class="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 h-[40px] transition-all active:scale-[0.98]"
          >
            Save & Apply Changes
          </button>
          <Show when={statusMsg()}>
            <div class="pt-0.5 flex items-center justify-center overflow-hidden">
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
            </div>
          </Show>
          <input
            ref={importFileInput}
            type="file"
            accept="application/json"
            class="hidden"
            onChange={importConfig}
          />
        </section>
      </footer>
    </div>
  );
}

export default App;
