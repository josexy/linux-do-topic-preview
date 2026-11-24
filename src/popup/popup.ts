import { extApi } from '../shared/browser-api';
import { normalizeDomain, toOriginPattern } from '../shared/domains';
import {
  getSettings,
  getWindowGeometry,
  saveSettings,
  saveWindowGeometry,
} from '../shared/storage';
import { DEFAULT_DOMAIN, type ExtensionSettings, type RuntimeMessage } from '../shared/types';

const enabledToggle = document.getElementById('enabledToggle') as HTMLInputElement;
const hideHeaderToggle = document.getElementById('hideHeaderToggle') as HTMLInputElement;
const backdropCloseToggle = document.getElementById('backdropCloseToggle') as HTMLInputElement;
const linuxDoToggle = document.getElementById('linuxDoToggle') as HTMLInputElement;
const geometryInfo = document.getElementById('geometryInfo') as HTMLDivElement;
const resetGeometryBtn = document.getElementById('resetGeometryBtn') as HTMLButtonElement;
const customDomainsList = document.getElementById('customDomainsList') as HTMLUListElement;
const addDomainForm = document.getElementById('addDomainForm') as HTMLFormElement;
const domainInput = document.getElementById('domainInput') as HTMLInputElement;
const statusMsg = document.getElementById('statusMsg') as HTMLParagraphElement;

let currentSettings: ExtensionSettings;

function setStatus(text: string, type: 'normal' | 'error' | 'success' = 'normal'): void {
  statusMsg.textContent = text;
  statusMsg.className = 'status-msg';
  if (type === 'error') statusMsg.classList.add('is-error');
  if (type === 'success') statusMsg.classList.add('is-success');
}

async function notifySyncRules(): Promise<void> {
  const message: RuntimeMessage = { type: 'SYNC_RULES' };
  await extApi.sendMessage(message);
}

function renderCustomDomains(domains: string[]): void {
  customDomainsList.innerHTML = '';
  for (const domain of domains) {
    const li = document.createElement('li');
    li.className = 'domain-item';

    const span = document.createElement('span');
    span.className = 'site-host';
    span.textContent = domain;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = '移除';
    removeBtn.addEventListener('click', () => {
      void removeCustomDomain(domain);
    });

    li.append(span, removeBtn);
    customDomainsList.appendChild(li);
  }
}

async function renderGeometry(): Promise<void> {
  const geo = await getWindowGeometry();
  if (!geo) {
    geometryInfo.textContent = '默认居中自适应';
    return;
  }
  geometryInfo.textContent = `已记住：${geo.width} × ${geo.height} px`;
}

function renderSettings(settings: ExtensionSettings): void {
  currentSettings = settings;
  enabledToggle.checked = settings.enabled;
  hideHeaderToggle.checked = settings.hideIframeHeader;
  backdropCloseToggle.checked = settings.closeOnBackdropClick;
  linuxDoToggle.checked = settings.linuxDoEnabled;
  renderCustomDomains(settings.customDomains);
}

async function removeCustomDomain(domain: string): Promise<void> {
  const nextDomains = currentSettings.customDomains.filter((d) => d !== domain);
  const updated = await saveSettings({ customDomains: nextDomains });
  renderSettings(updated);
  try {
    await extApi.permissionsRemove([toOriginPattern(domain)]);
  } catch {
    // Permission may already be absent
  }
  await notifySyncRules();
  setStatus(`已移除 ${domain}`, 'success');
}

async function handleAddDomain(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const normalized = normalizeDomain(domainInput.value);
  if (!normalized) {
    setStatus('请输入有效的域名，例如 meta.discourse.org', 'error');
    return;
  }

  if (normalized === DEFAULT_DOMAIN) {
    if (!currentSettings.linuxDoEnabled) {
      const updated = await saveSettings({ linuxDoEnabled: true });
      renderSettings(updated);
      await notifySyncRules();
    }
    domainInput.value = '';
    setStatus('linux.do 已为默认内置站点', 'success');
    return;
  }

  if (currentSettings.customDomains.includes(normalized)) {
    setStatus(`${normalized} 已在生效列表中`, 'normal');
    return;
  }

  // Request optional host permission directly within the user gesture handler
  const originPattern = toOriginPattern(normalized);
  let granted = false;
  try {
    granted = await extApi.permissionsRequest([originPattern]);
  } catch {
    granted = false;
  }

  if (!granted) {
    setStatus(`未获得 ${normalized} 的站点访问授权`, 'error');
    return;
  }

  const updated = await saveSettings({
    customDomains: [...currentSettings.customDomains, normalized],
  });
  renderSettings(updated);
  domainInput.value = '';
  await notifySyncRules();
  setStatus(`已添加 ${normalized}（刷新对应页面生效）`, 'success');
}

async function init(): Promise<void> {
  const settings = await getSettings();
  renderSettings(settings);
  await renderGeometry();

  enabledToggle.addEventListener('change', async () => {
    const updated = await saveSettings({ enabled: enabledToggle.checked });
    renderSettings(updated);
    await notifySyncRules();
  });

  hideHeaderToggle.addEventListener('change', async () => {
    const updated = await saveSettings({
      hideIframeHeader: hideHeaderToggle.checked,
    });
    renderSettings(updated);
  });

  backdropCloseToggle.addEventListener('change', async () => {
    const updated = await saveSettings({
      closeOnBackdropClick: backdropCloseToggle.checked,
    });
    renderSettings(updated);
  });

  linuxDoToggle.addEventListener('change', async () => {
    const updated = await saveSettings({
      linuxDoEnabled: linuxDoToggle.checked,
    });
    renderSettings(updated);
    await notifySyncRules();
  });

  resetGeometryBtn.addEventListener('click', async () => {
    await saveWindowGeometry(null);
    await renderGeometry();
    setStatus('已重置弹窗尺寸与位置', 'success');
  });

  addDomainForm.addEventListener('submit', (event) => {
    void handleAddDomain(event);
  });
}

void init();
