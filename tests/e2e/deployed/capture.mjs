export function installCapture(flow) {
  if (window.top !== window || window.__wataiEvalCapture) return;
  if (!flow.captureOrigins.includes(location.origin)) return;
  const documentId = [...crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16)).join('-');
  const identities = new WeakMap();
  const previouslyVisible = new WeakSet();
  const attached = new WeakSet();
  const observers = [];
  let nextId = 0;
  let sequence = 0;
  let bytes = 0;
  let pending = [];
  let stopped = false;
  const captureStarted = performance.now();
  let lastFrame = null;
  let lastSnapshot = '';
  let lastSnapshotSequence = null;
  let anchorMessageId = null;
  const observedRunStates = {};
  let batchId = 0;
  let timer;
  let frameHandle;
  let delivery = Promise.resolve();
  const identity = node => {
    if (!identities.has(node)) identities.set(node, `node-${++nextId}`);
    return identities.get(node);
  };
  const text = value => {
    const safe = String(value ?? '').replace(/(?:Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:token|password|secret|api[-_ ]?key)\s*[:=]\s*\S+)/gi, '[REDACTED]');
    if (safe.length > 4096) {
      emit('capture-gap', { code: 'TEXT_LIMIT_EXCEEDED' });
      return safe.slice(0, 4096);
    }
    return safe;
  };
  function emit(kind, payload) {
    if (stopped) return;
    const event = { documentId, sequence: ++sequence, observedAtMs: performance.now(), timeOrigin: performance.timeOrigin, kind, payload };
    bytes += new TextEncoder().encode(JSON.stringify(event)).byteLength;
    if (sequence > flow.maxEvents || bytes > flow.maxEvidenceBytes) {
      pending.push({ ...event, kind: 'capture-gap', payload: { code: 'CAPTURE_LIMIT_EXCEEDED' } });
      stopped = true;
      void flush();
      return;
    }
    pending.push(event);
  }
  function flush() {
    const batch = pending;
    pending = [];
    if (batch.length) delivery = delivery.then(() => window.__wataiEvidence(batch));
    return delivery;
  }
  const shape = element => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const visible = element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const region = flow.regions.find(region => region.level === 'detailed' && (element.matches(region.selector) || element.closest(region.selector)));
    let ancestorVisible = true;
    let clipBounds = { x: 0, y: 0, width: innerWidth, height: innerHeight };
    const ancestors = [];
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const ancestorStyle = getComputedStyle(ancestor);
      const ancestorBounds = ancestor.getBoundingClientRect();
      const clipsX = ['auto', 'scroll', 'hidden', 'clip'].includes(ancestorStyle.overflowX || ancestorStyle.overflow);
      const clipsY = ['auto', 'scroll', 'hidden', 'clip'].includes(ancestorStyle.overflowY || ancestorStyle.overflow);
      const hidden = ancestorStyle.display === 'none' || ['hidden', 'collapse'].includes(ancestorStyle.visibility) || Number(ancestorStyle.opacity || 1) === 0;
      ancestorVisible &&= !hidden;
      const left = clipsX ? Math.max(clipBounds.x, ancestorBounds.x + ancestor.clientLeft) : clipBounds.x;
      const top = clipsY ? Math.max(clipBounds.y, ancestorBounds.y + ancestor.clientTop) : clipBounds.y;
      const right = clipsX ? Math.min(clipBounds.x + clipBounds.width, ancestorBounds.x + ancestor.clientLeft + ancestor.clientWidth) : clipBounds.x + clipBounds.width;
      const bottom = clipsY ? Math.min(clipBounds.y + clipBounds.height, ancestorBounds.y + ancestor.clientTop + ancestor.clientHeight) : clipBounds.y + clipBounds.height;
      clipBounds = { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
      ancestors.push({ id: identity(ancestor), display: ancestorStyle.display, visibility: ancestorStyle.visibility,
        opacity: ancestorStyle.opacity, overflowX: ancestorStyle.overflowX, overflowY: ancestorStyle.overflowY,
        transform: ancestorStyle.transform, clipPath: ancestorStyle.clipPath,
        bounds: { x: ancestorBounds.x, y: ancestorBounds.y, width: ancestorBounds.width, height: ancestorBounds.height } });
      if ((ancestorStyle.transform && ancestorStyle.transform !== 'none') || (ancestorStyle.clipPath && ancestorStyle.clipPath !== 'none')) clipBounds = null;
      if (!clipBounds) break;
    }
    const hit = document.elementFromPoint?.(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    let accessibleName = null;
    try { accessibleName = window.__wataiCaptureAccessibleName?.(element) ?? null; } catch { emit('capture-gap', { code: 'ACCESSIBLE_NAME_UNAVAILABLE' }); }
    const contentRoot = element.matches('.msg-group--user') ? element.querySelector('.bubble-user')
      : element.matches('.msg-group--assistant') ? element.querySelector('.md') : null;
    const initialEntrance = !visible && !previouslyVisible.has(element) && element.checkVisibility({ checkVisibilityCSS: true }) &&
      element.getAnimations().some(animation => animation.animationName === 'msg-in' && animation.playState === 'running' && animation.effect?.getComputedTiming().progress === 0);
    if (visible) previouslyVisible.add(element);
    return {
      id: identity(element), parentId: element.parentElement ? identity(element.parentElement) : null, regionId: region?.id ?? null,
      domainId: element.getAttribute('data-message-id'),
      role: element.matches('.msg-group--user') ? 'user-message' : element.matches('.msg-group--assistant') ? 'assistant-message' : element.getAttribute('role') ?? element.tagName.toLowerCase(),
      text: text(element.textContent), name: text(element.getAttribute('aria-label')),
      content: contentRoot ? text(contentRoot.textContent) : null,
      contentHasFormatting: contentRoot ? Boolean(contentRoot.querySelector('pre, code, strong, em, table, blockquote, ul, ol, a, img, math, .katex')) : null,
      accessibleName: accessibleName === null ? null : text(accessibleName),
      visible, initialEntrance, disabled: element.matches(':disabled, [aria-disabled=true]') || Boolean(element.closest('[inert]')),
      ancestorVisible, ancestors, clipBounds, hitTargetId: hit ? identity(hit) : null,
      hitWithinElement: Boolean(hit && (hit === element || element.contains(hit))),
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      style: { display: style.display, visibility: style.visibility, opacity: style.opacity, overflow: style.overflow,
        color: style.color, backgroundColor: style.backgroundColor, fontFamily: style.fontFamily, fontSize: style.fontSize,
        boxShadow: style.boxShadow, outline: style.outline, borderRadius: style.borderRadius },
    };
  };
  const inside = node => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return element && flow.regions.some(region => element.matches(region.selector) || element.closest(region.selector));
  };
  function observeRoot(root) {
    if (attached.has(root)) return;
    attached.add(root);
    const observer = new MutationObserver(records => {
      const batch = ++batchId;
      const nextValues = new WeakMap();
      const historicalValues = new Map();
      for (let index = records.length - 1; index >= 0; index--) {
        const record = records[index];
        if (record.type === 'childList') continue;
        const key = record.type === 'characterData' ? '#text' : record.attributeName;
        const values = nextValues.get(record.target) ?? new Map();
        const current = record.type === 'characterData' ? record.target.textContent : record.target.getAttribute(record.attributeName);
        historicalValues.set(record, values.has(key) ? values.get(key) : current);
        values.set(key, record.oldValue);
        nextValues.set(record.target, values);
      }
      records.forEach((record, index) => {
        if (!inside(record.target)) return;
        const payload = { batchId: batch, batchIndex: index, type: record.type, targetId: identity(record.target) };
        if (record.type === 'childList') {
          payload.added = [...record.addedNodes].map(node => ({ id: identity(node), kind: node.nodeType,
            text: node.nodeType === Node.TEXT_NODE ? text(node.textContent) : undefined }));
          payload.removed = [...record.removedNodes].map(node => ({ id: identity(node), kind: node.nodeType }));
          payload.previousSibling = record.previousSibling ? identity(record.previousSibling) : null;
          payload.nextSibling = record.nextSibling ? identity(record.nextSibling) : null;
        } else {
          payload.attribute = record.attributeName;
          payload.oldValue = record.oldValue === null ? null : text(record.oldValue);
          const next = historicalValues.get(record);
          payload.newValue = next === null ? null : text(next);
          const current = record.type === 'characterData' ? record.target.textContent : record.target.getAttribute(record.attributeName);
          payload.observedCurrentValue = current === null ? null : text(current);
          payload.currentValueIsDeliveryState = true;
          payload.newValueBasis = 'next-mutation-old-value-or-delivery-state';
        }
        emit('mutation', payload);
      });
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true, characterDataOldValue: true,
      attributes: true, attributeOldValue: true,
      attributeFilter: ['class', 'style', 'role', 'aria-label', 'aria-hidden', 'aria-busy', 'aria-disabled', 'disabled', 'hidden', 'data-message-id'] });
    observers.push(observer);
  }
  function sample() {
    if (stopped) return;
    const started = performance.now();
    const gapMs = lastFrame === null ? null : started - lastFrame;
    emit('frame', { gapMs, startupWaitMs: lastFrame === null ? started - captureStarted : null,
      firstFrame: lastFrame === null, visibility: document.visibilityState, readyState: document.readyState });
    if (gapMs !== null && gapMs > 250 && document.visibilityState === 'visible') {
      emit('capture-gap', { code: 'FRAME_COVERAGE_GAP', gapMs });
    }
    lastFrame = started;
    const selected = new Set();
    const regions = [];
    const coverage = {};
    for (const region of flow.regions) {
      coverage[region.id] = region.level === 'detailed' ? 'complete' : 'boundary-only';
      for (const root of document.querySelectorAll(region.selector)) {
        if (region.level === 'detailed') {
          observeRoot(root);
          selected.add(root);
          for (const element of root.querySelectorAll('h1, h2, p, button, a, textarea, [role=status], img')) selected.add(element);
        } else regions.push({ id: region.id, nodeId: identity(root), level: region.level,
          bounds: { x: root.getBoundingClientRect().x, y: root.getBoundingClientRect().y,
            width: root.getBoundingClientRect().width, height: root.getBoundingClientRect().height }, children: 'omitted-by-profile' });
      }
    }
    if (selected.size > 400) { emit('capture-gap', { code: 'NODE_LIMIT_EXCEEDED' }); return; }
    const nodes = [...selected].sort((left, right) => left === right ? 0 : left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1).map(shape);
    const active = document.activeElement;
    const scrollElement = document.querySelector('.chat__scroll');
    const anchorElement = anchorMessageId ? document.querySelector(`[data-message-id="${CSS.escape(anchorMessageId)}"]`) : null;
    const anchorBounds = anchorElement?.getBoundingClientRect();
    const scrollBounds = scrollElement?.getBoundingClientRect();
    const payload = { nodes, regions, coverage, observedRunStates: { ...observedRunStates }, coverageContract: 'declared-semantic-selection-v1', focusId: active ? identity(active) : null,
      scroll: scrollElement ? { scrollTop: scrollElement.scrollTop, scrollHeight: scrollElement.scrollHeight, clientHeight: scrollElement.clientHeight } : null,
      anchor: anchorMessageId ? { messageId: anchorMessageId, offset: anchorBounds && scrollBounds ? anchorBounds.top - scrollBounds.top : null,
        visible: Boolean(anchorBounds && scrollBounds && anchorElement.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && anchorBounds.top >= scrollBounds.top && anchorBounds.top < scrollBounds.bottom) } : null,
      focusPaint: null,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      scrollTop: document.querySelector('.chat__scroll')?.scrollTop ?? scrollY,
      fonts: document.fonts?.status ?? 'unavailable',
      composer: flow.mode === 'authenticated' ? text(document.querySelector('textarea[aria-label=Message]')?.value) : undefined };
    const serialized = JSON.stringify(payload);
    if (serialized !== lastSnapshot) { emit('snapshot', payload); lastSnapshot = serialized; lastSnapshotSequence = sequence; }
    if (performance.now() - started > 50) emit('capture-gap', { code: 'OBSERVER_LONG_TASK' });
    frameHandle = requestAnimationFrame(sample);
  }
  const sentinel = new MutationObserver(records => {
    emit('structure-activity', { count: records.length });
    for (const region of flow.regions.filter(region => region.level === 'detailed')) {
      for (const root of document.querySelectorAll(region.selector)) observeRoot(root);
    }
  });
  sentinel.observe(document, { childList: true, subtree: true });
  observers.push(sentinel);
  const onFocus = event => emit('focus', { nodeId: identity(event.target) });
  document.addEventListener('focusin', onFocus);
  emit('capture-started', { profileId: flow.id, profileVersion: flow.version,
    limitations: ['Delivery-time mutation values; semantic checkpoint replay only', 'No browser-compositor frame guarantee', 'No independent DS verdict'] });
  frameHandle = requestAnimationFrame(sample);
  timer = setInterval(() => { void flush().catch(() => { stopped = true; }); }, 100);
  window.__wataiEvalCapture = {
    async observeRunState({ runId, status }) {
      if (stopped || typeof runId !== 'string' || runId.length > 200 || !['queued', 'running', 'cancel_requested', 'complete', 'error', 'canceled'].includes(status)) throw new Error('INVALID_OBSERVED_RUN_STATE');
      observedRunStates[runId] = status;
      emit('run-observation-boundary', { runId, status, basis: 'host-receipt-delivered-to-recorder' });
      cancelAnimationFrame(frameHandle); sample(); await flush();
    },
    async pinAnchor(messageId) {
      if (flow.id !== 'CHAT-03' || anchorMessageId || typeof messageId !== 'string' || messageId.length > 200) throw new Error('UNDECLARED_ANCHOR_CAPTURE');
      anchorMessageId = messageId;
      cancelAnimationFrame(frameHandle); sample(); await flush();
      return JSON.parse(lastSnapshot).anchor;
    },
    async checkpoint() {
      cancelAnimationFrame(frameHandle); sample(); await flush();
      return { documentId, sequence, snapshotSequence: lastSnapshotSequence, observedAtMs: performance.now(), timeOrigin: performance.timeOrigin };
    },
    async stop() {
      const undelivered = observers.reduce((count, observer) => count + observer.takeRecords().length, 0);
      if (undelivered) emit('capture-gap', { code: 'UNDELIVERED_MUTATIONS_AT_STOP', count: undelivered });
      if (!stopped) emit('capture-stopped', { lastSequence: sequence, bytes });
      stopped = true;
      cancelAnimationFrame(frameHandle);
      clearInterval(timer);
      observers.forEach(observer => observer.disconnect());
      document.removeEventListener('focusin', onFocus);
      await flush();
      return { documentId, lastSequence: sequence, bytes };
    },
  };
}