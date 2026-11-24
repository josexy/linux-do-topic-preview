import { findTopicLinkFromTarget, type MatchedTopicLink } from './topic-matcher';

const HIDE_DELAY_MS = 180;

const EYE_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7S2 12 2 12Z"/>
  <circle cx="12" cy="12" r="3"/>
</svg>`;

export class HoverTrigger {
  private readonly button: HTMLButtonElement;
  private readonly onPreview: (url: string, title: string) => void;
  private activeMatch: MatchedTopicLink | null = null;
  private hideTimer: number | null = null;
  private enabled = true;
  private isHoveringButton = false;

  constructor(
    shadowRoot: ShadowRoot,
    onPreview: (url: string, title: string) => void,
  ) {
    this.onPreview = onPreview;

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'ldp-trigger';
    this.button.setAttribute('aria-label', '预览 Topic 内容');
    this.button.innerHTML = `${EYE_ICON_SVG}<span>预览</span>`;
    shadowRoot.appendChild(this.button);

    this.button.addEventListener('pointerenter', this.handleButtonEnter);
    this.button.addEventListener('pointerleave', this.handleButtonLeave);
    this.button.addEventListener('click', this.handleButtonClick);

    document.addEventListener('pointerover', this.handleDocumentPointerOver, true);
    document.addEventListener('pointerout', this.handleDocumentPointerOut, true);
    window.addEventListener('scroll', this.handleViewportChange, true);
    window.addEventListener('resize', this.handleViewportChange);
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.hideImmediately();
    }
  }

  public hideImmediately(): void {
    this.clearHideTimer();
    this.activeMatch = null;
    this.isHoveringButton = false;
    this.button.classList.remove('is-visible');
  }

  public destroy(): void {
    this.hideImmediately();
    this.button.removeEventListener('pointerenter', this.handleButtonEnter);
    this.button.removeEventListener('pointerleave', this.handleButtonLeave);
    this.button.removeEventListener('click', this.handleButtonClick);
    document.removeEventListener('pointerover', this.handleDocumentPointerOver, true);
    document.removeEventListener('pointerout', this.handleDocumentPointerOut, true);
    window.removeEventListener('scroll', this.handleViewportChange, true);
    window.removeEventListener('resize', this.handleViewportChange);
    this.button.remove();
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private scheduleHide(): void {
    this.clearHideTimer();
    this.hideTimer = window.setTimeout(() => {
      if (!this.isHoveringButton) {
        this.activeMatch = null;
        this.button.classList.remove('is-visible');
      }
    }, HIDE_DELAY_MS);
  }

  private positionNearAnchor(anchor: HTMLAnchorElement): void {
    const rects = anchor.getClientRects();
    const targetRect =
      rects.length > 0 ? rects[rects.length - 1] : anchor.getBoundingClientRect();

    if (targetRect.width === 0 && targetRect.height === 0) {
      this.hideImmediately();
      return;
    }

    const btnWidth = this.button.offsetWidth || 64;
    const btnHeight = this.button.offsetHeight || 26;
    const gap = 8;

    let left = targetRect.right + gap;
    if (left + btnWidth > window.innerWidth - 10) {
      left = Math.max(10, Math.min(targetRect.right - btnWidth, window.innerWidth - btnWidth - 10));
    }

    let top = targetRect.top + (targetRect.height - btnHeight) / 2;
    top = Math.max(8, Math.min(top, window.innerHeight - btnHeight - 8));

    this.button.style.left = `${Math.round(left)}px`;
    this.button.style.top = `${Math.round(top)}px`;
  }

  private readonly handleDocumentPointerOver = (event: PointerEvent): void => {
    if (!this.enabled) return;

    const matched = findTopicLinkFromTarget(event.target, window.location.origin);
    if (!matched) {
      return;
    }

    this.clearHideTimer();
    this.activeMatch = matched;
    this.positionNearAnchor(matched.element);
    this.button.classList.add('is-visible');
  };

  private readonly handleDocumentPointerOut = (event: PointerEvent): void => {
    if (!this.activeMatch) return;
    const target = event.target;
    if (!(target instanceof Node)) return;

    if (this.activeMatch.element.contains(target)) {
      const related = event.relatedTarget;
      if (related instanceof Node && this.activeMatch.element.contains(related)) {
        return;
      }
      this.scheduleHide();
    }
  };

  private readonly handleButtonEnter = (): void => {
    this.isHoveringButton = true;
    this.clearHideTimer();
  };

  private readonly handleButtonLeave = (): void => {
    this.isHoveringButton = false;
    this.scheduleHide();
  };

  private readonly handleButtonClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!this.activeMatch) return;

    const { url, title } = this.activeMatch;
    this.hideImmediately();
    this.onPreview(url, title);
  };

  private readonly handleViewportChange = (): void => {
    if (!this.activeMatch) return;
    if (!this.activeMatch.element.isConnected) {
      this.hideImmediately();
      return;
    }
    this.positionNearAnchor(this.activeMatch.element);
  };
}
