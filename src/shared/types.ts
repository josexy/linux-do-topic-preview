export const DEFAULT_DOMAIN = 'linux.do';
export const PREVIEW_IFRAME_NAME = 'ldp-preview-iframe';

export const STORAGE_KEYS = {
  SETTINGS: 'ldp_settings_v1',
  GEOMETRY: 'ldp_geometry_v1',
} as const;

export interface ExtensionSettings {
  enabled: boolean;
  linuxDoEnabled: boolean;
  hideIframeHeader: boolean;
  closeOnBackdropClick: boolean;
  customDomains: string[];
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  linuxDoEnabled: true,
  hideIframeHeader: true,
  closeOnBackdropClick: true,
  customDomains: [],
};

export interface WindowGeometry {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
}

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export type IframeToParentMessage =
  | { type: 'LDP_BOOTING'; url: string }
  | {
      type: 'LDP_READY';
      title: string;
      url: string;
      requestId?: number;
      spaCapable?: boolean;
    }
  | { type: 'LDP_META_UPDATE'; title: string; url: string }
  | {
      type: 'LDP_NAV_ACK';
      requestId: number;
      mode: 'spa' | 'same' | 'fallback';
    }
  | { type: 'LDP_CLOSE' }
  | { type: 'LDP_REQUEST_UNLOAD' };

export type ParentToIframeMessage =
  | {
      type: 'LDP_SET_CLEAN_MODE';
      enabled: boolean;
    }
  | {
      type: 'LDP_NAVIGATE';
      url: string;
      requestId: number;
    }
  | {
      type: 'LDP_DEACTIVATE';
    };

export type RuntimeMessage = {
  type: 'SYNC_RULES';
};
