import { extApi } from '../shared/browser-api';
import { getActiveDomains, normalizeDomain, toOriginPattern } from '../shared/domains';
import { getSettings } from '../shared/storage';
import { DEFAULT_DOMAIN, STORAGE_KEYS, type RuntimeMessage } from '../shared/types';

const DNR_RULE_ID = 1001;
const CUSTOM_CONTENT_SCRIPT_ID = 'ldp-custom-content-script';
const CUSTOM_IFRAME_SCRIPT_ID = 'ldp-custom-iframe-script';

let syncQueue: Promise<void> = Promise.resolve();

async function filterPermittedDomains(domains: string[]): Promise<string[]> {
  const permitted: string[] = [];
  for (const domain of domains) {
    if (domain === DEFAULT_DOMAIN) {
      permitted.push(domain);
      continue;
    }
    try {
      const hasPermission = await extApi.permissionsContains([
        toOriginPattern(domain),
      ]);
      if (hasPermission) {
        permitted.push(domain);
      }
    } catch {
      // Ignore domains whose permission cannot be queried
    }
  }
  return permitted;
}

async function syncDnrRules(activeDomains: string[]): Promise<void> {
  const api = extApi.raw;
  if (!api.declarativeNetRequest?.updateDynamicRules) {
    return;
  }

  const removeRuleIds = [DNR_RULE_ID];
  if (activeDomains.length === 0) {
    await api.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
    });
    return;
  }

  const rule: chrome.declarativeNetRequest.Rule = {
    id: DNR_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
      responseHeaders: [
        {
          header: 'x-frame-options',
          operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation,
        },
        {
          header: 'content-security-policy',
          operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation,
        },
      ],
    },
    condition: {
      resourceTypes: ['sub_frame' as chrome.declarativeNetRequest.ResourceType],
      initiatorDomains: activeDomains,
      requestDomains: activeDomains,
    },
  };

  await api.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: [rule],
  });
}

async function syncCustomContentScripts(customDomains: string[]): Promise<void> {
  const api = extApi.raw;
  if (!api.scripting?.registerContentScripts) {
    return;
  }

  const existing = await api.scripting.getRegisteredContentScripts({
    ids: [CUSTOM_CONTENT_SCRIPT_ID, CUSTOM_IFRAME_SCRIPT_ID],
  });
  if (existing.length > 0) {
    await api.scripting.unregisterContentScripts({
      ids: existing.map((item) => item.id),
    });
  }

  const normalizedCustom = customDomains
    .map((d) => normalizeDomain(d))
    .filter((d): d is string => Boolean(d) && d !== DEFAULT_DOMAIN);

  const permittedCustom = await filterPermittedDomains(normalizedCustom);
  if (permittedCustom.length === 0) {
    return;
  }

  const matches = permittedCustom.map(toOriginPattern);
  await api.scripting.registerContentScripts([
    {
      id: CUSTOM_CONTENT_SCRIPT_ID,
      matches,
      js: ['content.js'],
      runAt: 'document_idle',
      allFrames: false,
      persistAcrossSessions: true,
    },
    {
      id: CUSTOM_IFRAME_SCRIPT_ID,
      matches,
      js: ['iframe-enhancer.js'],
      runAt: 'document_start',
      allFrames: true,
      persistAcrossSessions: true,
    },
  ]);
}

function enqueueSync(): Promise<void> {
  syncQueue = syncQueue
    .then(async () => {
      const settings = await getSettings();
      const activeDomains = await filterPermittedDomains(
        getActiveDomains(settings),
      );
      await syncDnrRules(activeDomains);
      await syncCustomContentScripts(
        settings.enabled ? settings.customDomains : [],
      );
    })
    .catch((err) => {
      console.error('[linux-do-preview] Failed to sync dynamic rules:', err);
    });
  return syncQueue;
}

const api = extApi.raw;

api.runtime.onInstalled.addListener(() => {
  void enqueueSync();
});

api.runtime.onStartup.addListener(() => {
  void enqueueSync();
});

api.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && STORAGE_KEYS.SETTINGS in changes) {
    void enqueueSync();
  }
});

api.permissions?.onRemoved?.addListener(() => {
  void enqueueSync();
});

api.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as Partial<RuntimeMessage> | null;
  if (msg?.type === 'SYNC_RULES') {
    void enqueueSync().then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
  return false;
});
