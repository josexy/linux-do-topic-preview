export type BrowserTarget = 'chromium' | 'firefox';

export interface ExtensionManifest {
  manifest_version: 3;
  name: string;
  version: string;
  description: string;
  icons: Record<string, string>;
  action: {
    default_title: string;
    default_popup: string;
    default_icon: Record<string, string>;
  };
  permissions: string[];
  host_permissions: string[];
  optional_host_permissions: string[];
  background:
    | { service_worker: string; type: 'module' }
    | { scripts: string[]; type: 'module' };
  content_scripts: Array<{
    matches: string[];
    js: string[];
    run_at: 'document_start' | 'document_idle' | 'document_end';
    all_frames: boolean;
  }>;
  browser_specific_settings?: {
    gecko: {
      id: string;
      strict_min_version: string;
    };
  };
}

export const DEFAULT_DOMAIN = 'linux.do';
export const DEFAULT_ORIGIN_MATCH = `https://${DEFAULT_DOMAIN}/*`;

export function createManifest(
  target: BrowserTarget,
  version: string,
): ExtensionManifest {
  const icons = {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  };

  const base: Omit<ExtensionManifest, 'background' | 'browser_specific_settings'> = {
    manifest_version: 3,
    name: 'Linux.do Topic Preview',
    version,
    description:
      '鼠标悬停 Topic 标题显示预览按钮，在当前页以可调整宽高的浮动窗口加载帖子内容。',
    icons,
    action: {
      default_title: 'Linux.do Topic Preview',
      default_popup: 'popup.html',
      default_icon: icons,
    },
    permissions: ['storage', 'scripting', 'declarativeNetRequestWithHostAccess'],
    host_permissions: [DEFAULT_ORIGIN_MATCH],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    content_scripts: [
      {
        matches: [DEFAULT_ORIGIN_MATCH],
        js: ['content.js'],
        run_at: 'document_idle',
        all_frames: false,
      },
      {
        matches: [DEFAULT_ORIGIN_MATCH],
        js: ['iframe-enhancer.js'],
        run_at: 'document_start',
        all_frames: true,
      },
    ],
  };

  if (target === 'firefox') {
    return {
      ...base,
      background: {
        scripts: ['background.js'],
        type: 'module',
      },
      browser_specific_settings: {
        gecko: {
          id: 'linux-do-preview@local.extension',
          strict_min_version: '128.0',
        },
      },
    };
  }

  return {
    ...base,
    background: {
      service_worker: 'background.js',
      type: 'module',
    },
  };
}
