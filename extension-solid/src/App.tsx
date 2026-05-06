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

  const modeIndexMap: Record<DomainMatchMode, number> = {
    exact: 0,
    include_subdomains: 1,
    subdomains_only: 2,
  };

  const sliderStyle = createMemo(() => {
    const index = modeIndexMap[domainMatchMode()];
    return {
      left: `calc(4px + ${index} * ((100% - 8px) / 3))`,
      width: "calc((100% - 8px) / 3)",
    };
  });

  return (
    <div class="relative h-130 w-full bg-linear-to-b from-background via-background to-muted/20 flex flex-col select-none">
      {/* Toast 通知横幅 */}
      <Show when={statusMsg()}>
        <div class="absolute top-3 left-3 right-3 z-50 animate-toast-in">
          <div
            class="flex items-center gap-2.5 rounded-xl px-4 py-2.5 shadow-toast"
            classList={{
              "toast-success": statusType() === "success",
              "toast-error": statusType() === "error",
            }}
          >
            <Show when={statusType() === "success"}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="shrink-0"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </Show>
            <Show when={statusType() === "error"}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="shrink-0"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="15" x2="9" y1="9" y2="15" />
                <line x1="9" x2="15" y1="9" y2="15" />
              </svg>
            </Show>
            <span class="text-xs font-bold leading-tight">{statusMsg()}</span>
          </div>
        </div>
      </Show>

      <div class="flex flex-col gap-2 h-full px-3 pt-3 pb-2">
        {/* Header */}
        <header class="rounded-2xl border border-border/80 bg-linear-to-b from-card to-card/95 shadow-card px-4 py-3 shrink-0">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2.5">
              <div class="h-7 w-7 rounded-xl bg-primary flex items-center justify-center shadow-sm shadow-primary/20">
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
                  class="text-primary-foreground"
                >
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.29 7 12 12 20.71 7" />
                  <line x1="12" x2="12" y1="22" y2="12" />
                </svg>
              </div>
              <div>
                <h1 class="text-base font-extrabold tracking-tight text-foreground leading-tight">
                  Header Modifier
                </h1>
                <p class="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.15em] mt-0.5">
                  Request Rules
                </p>
              </div>
            </div>
            <span class="text-[9px] rounded-md px-1.5 py-0.5 bg-primary/[0.08] text-primary font-extrabold tracking-wider border border-primary/20">
              MV3
            </span>
          </div>

          {/* 状态开关 */}
          <div class="mt-2.5 flex items-center justify-between rounded-xl bg-muted/25 px-3 py-2 border border-border/50">
            <div class="flex items-center gap-2.5">
              <span class="relative flex h-2 w-2">
                <span
                  class="absolute inline-flex h-full w-full rounded-full opacity-75"
                  classList={{
                    "animate-ping bg-emerald-400": enabled(),
                    "bg-slate-400": !enabled(),
                  }}
                />
                <span
                  class="relative inline-flex rounded-full h-2 w-2"
                  classList={{
                    "bg-emerald-500": enabled(),
                    "bg-slate-400": !enabled(),
                  }}
                />
              </span>
              <span class="text-xs font-semibold text-foreground/80">
                {enabled() ? "Active" : "Disabled"}
              </span>
            </div>
            <label class="group relative inline-flex items-center cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enabled()}
                onChange={(event) => setEnabled(event.currentTarget.checked)}
                class="sr-only peer"
              />
              <div class="w-10 h-5.5 bg-muted-foreground/25 rounded-full peer peer-focus-visible:ring-2 peer-focus-visible:ring-ring/30 transition-all peer-checked:bg-primary after:content-[''] after:absolute after:top-[1.5px] after:left-[1.5px] after:bg-white after:rounded-full after:h-[18px] after:w-[18px] after:transition-all after:shadow-sm peer-checked:after:translate-x-[18px]"></div>
            </label>
          </div>
        </header>

        {/* 可滚动主内容区 */}
        <main class="flex-1 min-h-0 space-y-2 pr-0.5 overflow-y-auto overscroll-y-contain">
          {/* Headers 区域 */}
          <section class="rounded-2xl border border-border/80 bg-card shadow-card p-3 space-y-2.5">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
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
                  class="text-muted-foreground"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" x2="8" y1="13" y2="13" />
                  <line x1="16" x2="8" y1="17" y2="17" />
                </svg>
                <h2 class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Headers
                </h2>
              </div>
              <button
                onClick={addHeader}
                class="inline-flex items-center justify-center gap-1 rounded-lg border border-dashed border-muted-foreground/25 px-2 py-1 text-[10px] font-bold text-muted-foreground hover:text-primary hover:border-primary/50 hover:bg-primary/[0.04] transition-all"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="11"
                  height="11"
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
                <div class="grid grid-cols-[20px_1fr_28px] gap-1.5 items-center animate-slide-up">
                  <span class="text-[9px] font-bold text-muted-foreground/50 text-center select-none">
                    {String(index() + 1).padStart(2, "0")}
                  </span>
                  <div class="flex gap-1.5 p-1.5 rounded-xl border border-border/70 bg-muted/[0.04] input-glow transition-all min-w-0">
                    <div class="flex items-center gap-1.5 min-w-0 flex-1">
                      <input
                        type="text"
                        value={header.key}
                        onInput={(event) =>
                          updateHeader(
                            index(),
                            "key",
                            event.currentTarget.value,
                          )
                        }
                        placeholder="Key"
                        class="w-1/2 bg-transparent text-[12px] font-semibold focus:outline-none placeholder:text-muted-foreground/40 min-w-0 px-1"
                      />
                      <div class="w-px h-4 bg-border/60 shrink-0"></div>
                      <input
                        type="text"
                        value={header.value}
                        onInput={(event) =>
                          updateHeader(
                            index(),
                            "value",
                            event.currentTarget.value,
                          )
                        }
                        placeholder="Value"
                        class="w-1/2 bg-transparent text-[12px] focus:outline-none placeholder:text-muted-foreground/40 min-w-0 px-1"
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => removeHeader(index())}
                    class="inline-flex items-center justify-center rounded-lg text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 h-7 w-7 transition-all shrink-0 custom-focus"
                    title="Remove"
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
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </For>
          </section>

          {/* Scope 区域 */}
          <section class="rounded-2xl border border-border/80 bg-card shadow-card p-3 space-y-2.5">
            <div class="flex items-center gap-2">
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
                class="text-muted-foreground"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="2" x2="22" y1="12" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <h2 class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Scope
              </h2>
            </div>
            <textarea
              value={domainInput()}
              onInput={(event) => setDomainInput(event.currentTarget.value)}
              placeholder="example.com&#10;api.example.com&#10;localhost"
              rows={3}
              class="w-full rounded-xl border border-border/70 bg-muted/[0.04] focus:bg-muted/[0.06] transition-all px-3 py-2 text-[12px] focus:outline-none placeholder:text-muted-foreground/40 resize-none custom-focus"
            />
            {/* 域名标签 */}
            <div class="flex flex-wrap gap-1.5 min-h-[22px]">
              <Show
                when={parsedDomains().length > 0}
                fallback={
                  <div class="flex items-center gap-1.5 text-muted-foreground/50">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M8 12h8" />
                    </svg>
                    <span class="text-[10px]">Empty = global matching</span>
                  </div>
                }
              >
                <For each={parsedDomains().slice(0, 8)}>
                  {(domain) => (
                    <span class="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-semibold text-foreground/80 animate-chip-in">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="8"
                        height="8"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="text-primary/60"
                      >
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                      </svg>
                      {domain}
                    </span>
                  )}
                </For>
                <Show when={parsedDomains().length > 8}>
                  <span class="inline-flex items-center rounded-full bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground animate-chip-in">
                    +{parsedDomains().length - 8}
                  </span>
                </Show>
              </Show>
            </div>
            {/* 匹配模式 - 滑动分段控件 */}
            <div class="segmented-control rounded-xl bg-muted/30 p-1">
              <div
                class="slider"
                style={{
                  left: sliderStyle().left,
                  width: sliderStyle().width,
                }}
              />
              <div class="flex relative">
                <button
                  onClick={() => setDomainMatchMode("exact")}
                  class="flex-1 h-7 rounded-lg text-[10px] font-bold transition-colors"
                  classList={{
                    "text-foreground": domainMatchMode() === "exact",
                    "text-muted-foreground hover:text-foreground/70":
                      domainMatchMode() !== "exact",
                  }}
                >
                  Exact
                </button>
                <button
                  onClick={() => setDomainMatchMode("include_subdomains")}
                  class="flex-1 h-7 rounded-lg text-[10px] font-bold transition-colors"
                  classList={{
                    "text-foreground":
                      domainMatchMode() === "include_subdomains",
                    "text-muted-foreground hover:text-foreground/70":
                      domainMatchMode() !== "include_subdomains",
                  }}
                >
                  Host+Sub
                </button>
                <button
                  onClick={() => setDomainMatchMode("subdomains_only")}
                  class="flex-1 h-7 rounded-lg text-[10px] font-bold transition-colors"
                  classList={{
                    "text-foreground": domainMatchMode() === "subdomains_only",
                    "text-muted-foreground hover:text-foreground/70":
                      domainMatchMode() !== "subdomains_only",
                  }}
                >
                  Sub Only
                </button>
              </div>
            </div>
            <p class="text-[10px] text-muted-foreground/60 leading-relaxed">
              One per line or comma. &quot;Sub Only&quot; excludes root host.
            </p>
          </section>

          {/* Duration 区域 */}
          <section class="rounded-2xl border border-border/80 bg-card shadow-card p-3 space-y-2.5">
            <div class="flex items-center gap-2">
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
                class="text-muted-foreground"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <h2 class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Duration
              </h2>
            </div>
            <div class="flex gap-1.5">
              <For
                each={[
                  { label: "Off", value: 0 },
                  { label: "15m", value: 15 },
                  { label: "1h", value: 60 },
                  { label: "8h", value: 480 },
                ]}
              >
                {(preset) => {
                  const isActive = () =>
                    String(preset.value) === temporaryMinutesInput();
                  return (
                    <button
                      onClick={() => applyTemporaryPreset(preset.value)}
                      class="flex-1 h-7 rounded-lg text-[11px] font-bold transition-all"
                      classList={{
                        "bg-primary text-primary-foreground shadow-sm shadow-primary/20":
                          isActive(),
                        "bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground/80 border border-border/50":
                          !isActive(),
                      }}
                    >
                      {preset.label}
                    </button>
                  );
                }}
              </For>
            </div>
            <div class="flex items-center gap-2">
              <div class="flex-1 relative">
                <input
                  type="number"
                  min="0"
                  max="1440"
                  value={temporaryMinutesInput()}
                  onInput={(event) =>
                    setTemporaryMinutesInput(event.currentTarget.value)
                  }
                  class="w-full rounded-xl border border-border/70 bg-muted/[0.04] transition-all px-3 py-2 text-[12px] font-semibold focus:outline-none custom-focus [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <span class="text-[11px] font-bold text-muted-foreground/60 min-w-[28px]">
                min
              </span>
            </div>
            <p class="text-[10px] text-muted-foreground/60 leading-relaxed">
              0 = always on &middot; Max 1440 min (24h)
            </p>
          </section>
        </main>

        {/* Footer 操作区 */}
        <footer class="shrink-0">
          <div class="rounded-2xl border border-border/80 bg-card shadow-card px-3 py-2.5 space-y-2.5">
            <div class="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="text-muted-foreground"
              >
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              <h2 class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Actions
              </h2>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <button
                onClick={exportConfig}
                class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border/60 h-[32px] text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted/30 hover:border-border transition-all custom-focus"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" x2="12" y1="15" y2="3" />
                </svg>
                Export
              </button>
              <button
                onClick={() => importFileInput?.click()}
                class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border/60 h-[32px] text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted/30 hover:border-border transition-all custom-focus"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" x2="12" y1="3" y2="15" />
                </svg>
                Import
              </button>
            </div>
            <button
              onClick={saveConfig}
              class="btn-primary-gradient w-full inline-flex items-center justify-center gap-2 rounded-xl text-primary-foreground text-[12px] font-extrabold shadow-button-primary h-[38px] active:scale-[0.98] custom-focus"
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
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              Save &amp; Apply
            </button>
            <input
              ref={importFileInput}
              type="file"
              accept="application/json"
              class="hidden"
              onChange={importConfig}
            />
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;
