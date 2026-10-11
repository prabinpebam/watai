const finiteRect = rect => rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]));
const contains = (rect, point) => finiteRect(rect) && rect.width > 0 && rect.height > 0 &&
  point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;

export function evaluateAuthHeuristics(flow, events) {
  if (flow.id !== 'AUTH-01' || flow.mode !== 'public') throw new Error('AUTH_PUBLIC_FLOW_REQUIRED');
  const findings = [];
  const add = (checkId, code, event, kind = 'product') => findings.push({ checkId, code, eventId: event?.eventId ?? null, kind });
  const phases = [];
  const sequences = new Map();
  let phase;
  let expectedEvent = 1;
  let snapshots = 0;
  let frames = 0;
  let tabCount = 0;
  let focusObserved = false;
  let focusReturned = false;
  let headingId;
  let buttonId;
  let finalSnapshot;
  for (const event of events) {
    if (event.eventId !== expectedEvent++) add('AUTH-H06', 'RECEIVER_SEQUENCE_GAP', event, 'evidence');
    if (event.documentId) {
      if (event.sequence !== (sequences.get(event.documentId) ?? 0) + 1) add('AUTH-H06', 'DOCUMENT_SEQUENCE_GAP', event, 'evidence');
      sequences.set(event.documentId, event.sequence);
    }
    if (event.kind === 'phase') { phase = event.payload?.phase; phases.push(phase); }
    if (['capture-gap', 'runner-error', 'policy-stop'].includes(event.kind)) add('AUTH-H06', 'CAPTURE_INCOMPLETE', event, 'evidence');
    if (event.kind === 'page-error') add('AUTH-H05', 'PAGE_ERROR', event);
    if (event.kind === 'frame') {
      frames++;
      if (event.payload?.visibility === 'visible' && event.payload.gapMs > 250) add('AUTH-H06', 'FRAME_GAP', event, 'evidence');
    }
    if (event.kind === 'action') {
      if (event.payload?.name !== 'Tab' || phase !== 'inspect') add('AUTH-H03', 'UNDECLARED_ACTION', event);
      else if (++tabCount > 8) add('AUTH-H03', 'TAB_LIMIT_EXCEEDED', event);
    }
    if (event.kind !== 'snapshot' || !['ready', 'inspect'].includes(phase)) continue;
    snapshots++;
    finalSnapshot = event;
    const snapshot = event.payload;
    if (snapshot?.coverage?.welcome !== 'complete' || !Array.isArray(snapshot.nodes)) {
      add('AUTH-H06', 'WELCOME_OBSERVATION_INCOMPLETE', event, 'evidence'); continue;
    }
    const headings = snapshot.nodes.filter(node => node.regionId === 'welcome' && node.role === 'h1');
    const buttons = snapshot.nodes.filter(node => node.regionId === 'welcome' && node.role === 'button');
    if (headings.length !== 1) add('AUTH-H01', 'HEADING_COUNT', event);
    else {
      const heading = headings[0];
      if (typeof heading.text !== 'string' || typeof heading.visible !== 'boolean' || !finiteRect(heading.bounds) || !heading.id) add('AUTH-H01', 'HEADING_FIELDS_MISSING', event, 'evidence');
      else if (heading.text !== flow.expectedHeading || !heading.visible || heading.bounds.width <= 0 || heading.bounds.height <= 0) add('AUTH-H01', 'HEADING_WRONG_OR_HIDDEN', event);
      if (headingId && heading.id !== headingId) add('AUTH-H01', 'HEADING_IDENTITY_CHANGED', event);
      headingId ??= heading.id;
    }
    if (buttons.length !== 1) { add('AUTH-H02', 'SIGN_IN_COUNT', event); continue; }
    const button = buttons[0];
    if (buttonId && button.id !== buttonId) add('AUTH-H02', 'SIGN_IN_IDENTITY_CHANGED', event);
    buttonId ??= button.id;
    if (!button.id || typeof button.accessibleName !== 'string' || typeof button.visible !== 'boolean' ||
        typeof button.disabled !== 'boolean' || !finiteRect(button.bounds) || !finiteRect(button.clipBounds) ||
        typeof button.hitTargetId !== 'string' || typeof button.ancestorVisible !== 'boolean' ||
        !Number.isFinite(snapshot.viewport?.width) || !Number.isFinite(snapshot.viewport?.height)) {
      add('AUTH-H02', 'OPERABILITY_EVIDENCE_MISSING', event, 'evidence'); continue;
    }
    const center = { x: button.bounds.x + button.bounds.width / 2, y: button.bounds.y + button.bounds.height / 2 };
    const descendants = new Set([button.id]);
    let previousSize;
    do {
      previousSize = descendants.size;
      for (const node of snapshot.nodes) if (descendants.has(node.parentId)) descendants.add(node.id);
    } while (descendants.size !== previousSize);
    if (button.accessibleName !== flow.expectedAction || button.disabled || !button.visible || !button.ancestorVisible ||
        button.bounds.width <= 0 || button.bounds.height <= 0 || button.bounds.x < 0 || button.bounds.y < 0 ||
        button.bounds.x + button.bounds.width > snapshot.viewport.width || button.bounds.y + button.bounds.height > snapshot.viewport.height ||
        !contains(button.clipBounds, center) || (!descendants.has(button.hitTargetId) && button.hitWithinElement !== true)) add('AUTH-H02', 'SIGN_IN_NOT_OPERABLE', event);
    if (phase === 'inspect' && tabCount > 0 && snapshot.focusId === button.id) {
      focusObserved = true;
      if (!Number.isSafeInteger(snapshot.focusPaint?.visibleRingPixels) || !snapshot.focusPaint?.screenshotId) {
        add('AUTH-H03', 'FOCUS_PAINT_MISSING', event, 'evidence');
      } else if (snapshot.focusPaint.visibleRingPixels <= 0) add('AUTH-H03', 'FOCUS_RING_NOT_PAINTED', event);
    } else if (focusObserved) focusReturned = true;
  }
  if (JSON.stringify(phases) !== JSON.stringify(flow.requiredPhases)) add('AUTH-H06', 'PHASE_ORDER_OR_COVERAGE', null, 'evidence');
  if (!snapshots || !frames || !events.some(event => event.kind === 'capture-stopped')) add('AUTH-H06', 'TEMPORAL_EVIDENCE_MISSING', null, 'evidence');
  if (!focusObserved) add('AUTH-H03', tabCount >= 8 ? 'SIGN_IN_NOT_KEYBOARD_REACHABLE' : 'KEYBOARD_SEQUENCE_INCOMPLETE', null, tabCount >= 8 ? 'product' : 'evidence');
  if (focusReturned || (focusObserved && finalSnapshot?.payload.focusId !== buttonId)) add('AUTH-H03', 'FOCUS_LOST_AFTER_REACHING_SIGN_IN', finalSnapshot);
  const productFailed = findings.some(finding => finding.kind === 'product');
  const sufficient = !findings.some(finding => finding.kind === 'evidence');
  return { flowId: flow.id, variantId: 'AUTH-01.public-desktop', status: productFailed ? 'FAIL' : sufficient ? 'DIAGNOSTIC_PASS' : 'INSUFFICIENT_EVIDENCE',
    findings, evidenceSufficientForImplementedChecks: sufficient, fullEddStatus: 'NOT_QUALIFIED', releaseEligible: false,
    unimplementedChecks: ['AUTH-H04:approved-asset-and-design-system-reference', 'AUTH-H05:independent-account-and-request-scope', 'AUTH-H06:calibrated-capture-and-required-asset-coverage'] };
}