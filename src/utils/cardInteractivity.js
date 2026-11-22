/**
 * Dedicated JavaScript module powering interactive bordered cards across Bacc-AI Study Hub.
 * Computes pointer-relative spotlight coordinates and subtle tilt angles directly via CSS
 * custom properties so hover reactions run smoothly at 60fps without React re-renders.
 */

/**
 * Pure geometry helper computing pointer offsets and subtle tilt relative to a card's bounding box.
 * @param {{ left: number, top: number, width: number, height: number }} rect
 * @param {number} clientX
 * @param {number} clientY
 */
export function computePointerCardMetrics(rect, clientX, clientY) {
  const safeWidth = Math.max(1, rect.width || 1);
  const safeHeight = Math.max(1, rect.height || 1);

  const rawX = clientX - rect.left;
  const rawY = clientY - rect.top;

  const clampedX = Math.max(0, Math.min(safeWidth, rawX));
  const clampedY = Math.max(0, Math.min(safeHeight, rawY));

  const xPercent = Math.round((clampedX / safeWidth) * 100);
  const yPercent = Math.round((clampedY / safeHeight) * 100);

  // Subtle tilt capped at ±1.8deg so text stays razor-sharp
  const normX = clampedX / safeWidth - 0.5;
  const normY = clampedY / safeHeight - 0.5;
  const tiltY = Number((normX * 3.6).toFixed(2));
  const tiltX = Number((-normY * 3.6).toFixed(2));

  return {
    xPx: Math.round(clampedX),
    yPx: Math.round(clampedY),
    xPercent,
    yPercent,
    tiltX,
    tiltY,
  };
}

/**
 * Attaches delegated pointer tracking to all elements matching `selector` inside `rootElement`.
 * Respects `prefers-reduced-motion` and returns a clean teardown callback.
 * @param {HTMLElement | Document | null} rootElement
 * @param {string} selector
 * @returns {() => void}
 */
export function attachInteractiveCards(rootElement, selector = '.interactive-card') {
  if (!rootElement || typeof window === 'undefined') {
    return () => {};
  }

  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** @type {HTMLElement | null} */
  let activeCard = null;
  let rafId = 0;
  let pendingClientX = 0;
  let pendingClientY = 0;

  const resetCard = (card) => {
    if (!card) return;
    card.dataset.cardHovered = 'false';
    card.style.setProperty('--card-tilt-x', '0deg');
    card.style.setProperty('--card-tilt-y', '0deg');
  };

  const applyFrame = () => {
    rafId = 0;
    if (!activeCard) return;
    const rect = activeCard.getBoundingClientRect();
    const metrics = computePointerCardMetrics(rect, pendingClientX, pendingClientY);
    activeCard.style.setProperty('--card-mx', `${metrics.xPx}px`);
    activeCard.style.setProperty('--card-my', `${metrics.yPx}px`);
    activeCard.style.setProperty('--card-mx-pct', `${metrics.xPercent}%`);
    activeCard.style.setProperty('--card-my-pct', `${metrics.yPercent}%`);
    if (!prefersReducedMotion) {
      activeCard.style.setProperty('--card-tilt-x', `${metrics.tiltX}deg`);
      activeCard.style.setProperty('--card-tilt-y', `${metrics.tiltY}deg`);
    }
  };

  const handlePointerMove = (event) => {
    if (event.pointerType === 'touch') return;
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (!(target instanceof HTMLElement)) {
      if (activeCard) {
        resetCard(activeCard);
        activeCard = null;
      }
      return;
    }

    if (activeCard && activeCard !== target) {
      resetCard(activeCard);
    }

    activeCard = target;
    activeCard.dataset.cardHovered = 'true';
    pendingClientX = event.clientX;
    pendingClientY = event.clientY;

    if (!rafId) {
      rafId = window.requestAnimationFrame(applyFrame);
    }
  };

  const handlePointerLeaveWindow = () => {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (activeCard) {
      resetCard(activeCard);
      activeCard = null;
    }
  };

  rootElement.addEventListener('pointermove', handlePointerMove, { passive: true });
  rootElement.addEventListener('pointerleave', handlePointerLeaveWindow, { passive: true });
  window.addEventListener('blur', handlePointerLeaveWindow);

  return () => {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
    }
    if (activeCard) {
      resetCard(activeCard);
    }
    rootElement.removeEventListener('pointermove', handlePointerMove);
    rootElement.removeEventListener('pointerleave', handlePointerLeaveWindow);
    window.removeEventListener('blur', handlePointerLeaveWindow);
  };
}
