export const SHADOW_STYLES = `
:host {
  all: initial;
  --ldp-bg: #ffffff;
  --ldp-bg-elevated: #f8fafc;
  --ldp-text: #0f172a;
  --ldp-text-muted: #64748b;
  --ldp-border: rgba(15, 23, 42, 0.12);
  --ldp-shadow: 0 24px 64px -12px rgba(15, 23, 42, 0.28), 0 8px 24px -8px rgba(15, 23, 42, 0.16);
  --ldp-backdrop: rgba(15, 23, 42, 0.42);
  --ldp-accent: #2563eb;
  --ldp-accent-hover: #1d4ed8;
  --ldp-accent-soft: rgba(37, 99, 235, 0.12);
  --ldp-btn-hover: rgba(15, 23, 42, 0.08);
  --ldp-danger-hover: rgba(239, 68, 68, 0.14);
  --ldp-danger-text: #dc2626;
  --ldp-trigger-bg: #ffffff;
  --ldp-trigger-text: #1d4ed8;
  --ldp-trigger-border: rgba(37, 99, 235, 0.34);
  --ldp-trigger-shadow: 0 4px 14px rgba(15, 23, 42, 0.14);
  --ldp-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-family: var(--ldp-font);
}

:host([data-theme="dark"]) {
  --ldp-bg: #16181d;
  --ldp-bg-elevated: #1e2128;
  --ldp-text: #f1f5f9;
  --ldp-text-muted: #94a3b8;
  --ldp-border: rgba(255, 255, 255, 0.12);
  --ldp-shadow: 0 24px 64px -10px rgba(0, 0, 0, 0.65), 0 8px 24px -6px rgba(0, 0, 0, 0.45);
  --ldp-backdrop: rgba(0, 0, 0, 0.6);
  --ldp-accent: #38bdf8;
  --ldp-accent-hover: #0ea5e9;
  --ldp-accent-soft: rgba(56, 189, 248, 0.16);
  --ldp-btn-hover: rgba(255, 255, 255, 0.1);
  --ldp-danger-hover: rgba(248, 113, 113, 0.2);
  --ldp-danger-text: #f87171;
  --ldp-trigger-bg: #1e293b;
  --ldp-trigger-text: #7dd3fc;
  --ldp-trigger-border: rgba(56, 189, 248, 0.38);
  --ldp-trigger-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
}

*, *::before, *::after {
  box-sizing: border-box;
}

/* Hover Preview Trigger Button */
.ldp-trigger {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 2147483640;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px 0 8px;
  border-radius: 999px;
  border: 1px solid var(--ldp-trigger-border);
  background: var(--ldp-trigger-bg);
  color: var(--ldp-trigger-text);
  font-family: var(--ldp-font);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  box-shadow: var(--ldp-trigger-shadow);
  opacity: 0;
  pointer-events: none;
  transform: translate3d(0, 2px, 0) scale(0.96);
  transition: opacity 0.14s ease, transform 0.14s ease, background-color 0.14s ease, border-color 0.14s ease, color 0.14s ease;
  user-select: none;
  white-space: nowrap;
}

.ldp-trigger.is-visible {
  opacity: 1;
  pointer-events: auto;
  transform: translate3d(0, 0, 0) scale(1);
}

.ldp-trigger:hover {
  background: var(--ldp-accent);
  border-color: var(--ldp-accent);
  color: #ffffff;
}

.ldp-trigger:focus-visible {
  outline: 2px solid var(--ldp-accent);
  outline-offset: 2px;
}

.ldp-trigger svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}

/* Modal Overlay & Backdrop */
.ldp-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483645;
  visibility: hidden;
  pointer-events: none;
}

.ldp-overlay.is-open {
  visibility: visible;
}

.ldp-overlay:not(.is-open) .ldp-backdrop,
.ldp-overlay:not(.is-open) .ldp-modal {
  pointer-events: none !important;
}

.ldp-backdrop {
  position: fixed;
  inset: 0;
  background: var(--ldp-backdrop);
  pointer-events: auto;
  opacity: 0;
  transition: opacity 0.16s ease;
}

.ldp-overlay.is-open .ldp-backdrop {
  backdrop-filter: blur(2px);
}

.ldp-overlay.is-visible .ldp-backdrop {
  opacity: 1;
}

/* Floating Resizable Window */
.ldp-modal {
  position: fixed;
  display: flex;
  flex-direction: column;
  background: var(--ldp-bg);
  color: var(--ldp-text);
  border: 1px solid var(--ldp-border);
  border-radius: 12px;
  box-shadow: var(--ldp-shadow);
  overflow: hidden;
  pointer-events: auto;
  opacity: 0;
  transform: scale(0.975);
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.ldp-overlay.is-visible .ldp-modal {
  opacity: 1;
  transform: scale(1);
}

.ldp-modal.is-interacting {
  transition: none !important;
  user-select: none;
}

.ldp-modal.is-maximized {
  border-radius: 0;
}

/* Header Toolbar */
.ldp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  height: 44px;
  padding: 0 10px 0 14px;
  background: var(--ldp-bg-elevated);
  border-bottom: 1px solid var(--ldp-border);
  cursor: grab;
  user-select: none;
  flex-shrink: 0;
}

.ldp-header:active {
  cursor: grabbing;
}

.ldp-modal.is-maximized .ldp-header {
  cursor: default;
}

.ldp-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.ldp-brand-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--ldp-accent);
  flex-shrink: 0;
}

.ldp-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ldp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ldp-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.ldp-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--ldp-text-muted);
  cursor: pointer;
  padding: 0;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.ldp-icon-btn:hover {
  background: var(--ldp-btn-hover);
  color: var(--ldp-text);
}

.ldp-icon-btn.is-active {
  background: var(--ldp-accent-soft);
  color: var(--ldp-accent);
}

.ldp-icon-btn.is-danger:hover {
  background: var(--ldp-danger-hover);
  color: var(--ldp-danger-text);
}

.ldp-icon-btn svg {
  width: 15px;
  height: 15px;
  pointer-events: none;
}

/* Body & Iframe */
.ldp-body {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--ldp-bg);
}

.ldp-iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
  background: var(--ldp-bg);
}

/* Transparent overlay over iframe during drag/resize so pointer events never get swallowed */
.ldp-drag-shield {
  position: absolute;
  inset: 0;
  z-index: 15;
  display: none;
  background: transparent;
}

.ldp-modal.is-interacting .ldp-drag-shield {
  display: block;
}

/* Loading Bar & Spinner */
.ldp-loading-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2.5px;
  z-index: 10;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

.ldp-loading-bar.is-active {
  opacity: 1;
}

.ldp-loading-bar::after {
  content: "";
  display: block;
  width: 40%;
  height: 100%;
  background: var(--ldp-accent);
  animation: ldp-indeterminate 1.1s infinite ease-in-out;
}

@keyframes ldp-indeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}

.ldp-loading-mask {
  position: absolute;
  inset: 0;
  z-index: 9;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--ldp-bg);
  color: var(--ldp-text-muted);
  font-size: 13px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;
}

.ldp-loading-mask.is-active {
  opacity: 1;
  pointer-events: auto;
}

.ldp-spinner {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 2.5px solid var(--ldp-border);
  border-top-color: var(--ldp-accent);
  animation: ldp-spin 0.75s linear infinite;
}

@keyframes ldp-spin {
  to { transform: rotate(360deg); }
}

/* Fallback Banner */
.ldp-fallback {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 16px;
  z-index: 12;
  display: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--ldp-bg-elevated);
  border: 1px solid var(--ldp-border);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  font-size: 12.5px;
  color: var(--ldp-text);
}

.ldp-fallback.is-visible {
  display: flex;
}

.ldp-fallback-btn {
  padding: 6px 12px;
  border-radius: 7px;
  border: none;
  background: var(--ldp-accent);
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.ldp-fallback-btn:hover {
  background: var(--ldp-accent-hover);
}

/* Live Resize Dimension Badge */
.ldp-size-badge {
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 20;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.82);
  color: #f8fafc;
  font-size: 11.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.14s ease;
}

.ldp-size-badge.is-visible {
  opacity: 1;
}

/* 8-Way Resize Handles */
.ldp-resize {
  position: absolute;
  z-index: 25;
  touch-action: none;
}

.ldp-modal.is-maximized .ldp-resize {
  display: none;
}

.ldp-resize-n  { top: 0; left: 10px; right: 10px; height: 6px; cursor: ns-resize; }
.ldp-resize-s  { bottom: 0; left: 10px; right: 10px; height: 6px; cursor: ns-resize; }
.ldp-resize-e  { right: 0; top: 10px; bottom: 10px; width: 6px; cursor: ew-resize; }
.ldp-resize-w  { left: 0; top: 10px; bottom: 10px; width: 6px; cursor: ew-resize; }
.ldp-resize-ne { top: 0; right: 0; width: 14px; height: 14px; cursor: nesw-resize; }
.ldp-resize-nw { top: 0; left: 0; width: 14px; height: 14px; cursor: nwse-resize; }
.ldp-resize-sw { bottom: 0; left: 0; width: 14px; height: 14px; cursor: nesw-resize; }
.ldp-resize-se {
  bottom: 0;
  right: 0;
  width: 18px;
  height: 18px;
  cursor: nwse-resize;
}

/* Subtle bottom-right visual grip hint */
.ldp-resize-se::after {
  content: "";
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 9px;
  height: 9px;
  border-right: 2px solid var(--ldp-text-muted);
  border-bottom: 2px solid var(--ldp-text-muted);
  border-bottom-right-radius: 2px;
  opacity: 0.55;
  pointer-events: none;
}
`;
