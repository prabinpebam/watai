import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export function encodeReviewEvidence(value, { maxBytes = 786432, maxRecords = 200000 } = {}) {
  const records = [];
  const indices = new Map();
  const previousText = new Map();
  const ancestors = new Set();
  const store = record => {
    const key = JSON.stringify(record);
    if (indices.has(key)) return { ref: indices.get(key) };
    if (records.length >= maxRecords) throw new Error('REVIEW_CODEC_RECORD_LIMIT');
    const index = records.length;
    records.push(record); indices.set(key, index);
    return { ref: index };
  };
  const encode = (item, path, depth = 0) => {
    if (depth > 80) throw new Error('REVIEW_CODEC_DEPTH_LIMIT');
    if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return item;
    if (typeof item === 'string') {
      if (item.length < 64) return item;
      const old = previousText.get(path);
      let keep = 0;
      if (old) while (keep < item.length && keep < old.text.length && item[keep] === old.text[keep]) keep++;
      const literal = { type: 'text', text: item };
      const prefix = old ? { type: 'prefix', source: old.ref.ref, keep, suffix: item.slice(keep) } : null;
      const reference = store(prefix && JSON.stringify(prefix).length < JSON.stringify(literal).length ? prefix : literal);
      previousText.set(path, { text: item, ref: reference });
      return reference;
    }
    if (!item || typeof item !== 'object' || ancestors.has(item)) throw new Error('REVIEW_CODEC_REQUIRES_JSON_VALUES');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new Error('REVIEW_CODEC_REQUIRES_JSON_VALUES');
    ancestors.add(item);
    const record = Array.isArray(item) ? { type: 'array', values: item.map(child => encode(child, `${path}[]`, depth + 1)) }
      : { type: 'object', fields: Object.entries(item).map(([key, child]) => [key, encode(child, `${path}.${key}`, depth + 1)]) };
    ancestors.delete(item);
    return store(record);
  };
  const root = encode(value, '$');
  const packet = { format: 'lossless-json-records-v1', records, root };
  if (Buffer.byteLength(JSON.stringify(packet)) > maxBytes) throw new Error('REVIEW_ENCODED_CAPACITY_INSUFFICIENT');
  return packet;
}

export function decodeReviewEvidence(packet, { maxBytes = 16777216, maxRecords = 200000 } = {}) {
  if (packet?.format !== 'lossless-json-records-v1' || !Array.isArray(packet.records) || packet.records.length > maxRecords) throw new Error('INVALID_REVIEW_CODEC_PACKET');
  const decoded = [];
  const sizes = [];
  const atom = value => {
    if (value === null || typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
      return { value, bytes: Buffer.byteLength(JSON.stringify(value)) };
    }
    if (!value || Object.keys(value).length !== 1 || !Number.isSafeInteger(value.ref) || value.ref < 0 || value.ref >= decoded.length) throw new Error('INVALID_REVIEW_CODEC_REFERENCE');
    return { value: decoded[value.ref], bytes: sizes[value.ref] };
  };
  for (const record of packet.records) {
    let value;
    let bytes;
    if (record?.type === 'text' && typeof record.text === 'string') {
      value = record.text; bytes = Buffer.byteLength(JSON.stringify(value));
    } else if (record?.type === 'prefix' && Number.isSafeInteger(record.source) && record.source >= 0 && record.source < decoded.length &&
        typeof decoded[record.source] === 'string' && Number.isSafeInteger(record.keep) && record.keep >= 0 && record.keep <= decoded[record.source].length && typeof record.suffix === 'string') {
      value = decoded[record.source].slice(0, record.keep) + record.suffix; bytes = Buffer.byteLength(JSON.stringify(value));
    } else if (record?.type === 'array' && Array.isArray(record.values)) {
      const values = record.values.map(atom);
      bytes = 2 + Math.max(0, values.length - 1) + values.reduce((sum, item) => sum + item.bytes, 0);
      if (bytes > maxBytes) throw new Error('REVIEW_DECODED_CAPACITY_INSUFFICIENT');
      value = values.map(item => item.value);
    } else if (record?.type === 'object' && Array.isArray(record.fields)) {
      value = {}; bytes = 2; const keys = new Set();
      for (const field of record.fields) {
        if (!Array.isArray(field) || field.length !== 2 || typeof field[0] !== 'string' || keys.has(field[0])) throw new Error('INVALID_REVIEW_CODEC_FIELD');
        const item = atom(field[1]);
        bytes += Buffer.byteLength(JSON.stringify(field[0])) + 1 + item.bytes + (keys.size ? 1 : 0);
        if (bytes > maxBytes) throw new Error('REVIEW_DECODED_CAPACITY_INSUFFICIENT');
        keys.add(field[0]);
        Object.defineProperty(value, field[0], { value: item.value, enumerable: true, writable: false, configurable: false });
      }
    } else throw new Error('INVALID_REVIEW_CODEC_RECORD');
    if (bytes > maxBytes) throw new Error('REVIEW_DECODED_CAPACITY_INSUFFICIENT');
    decoded.push(value); sizes.push(bytes);
  }
  const root = atom(packet.root);
  if (root.bytes > maxBytes) throw new Error('REVIEW_DECODED_CAPACITY_INSUFFICIENT');
  return structuredClone(root.value);
}

function validateTimelineJson(value, depth = 0, ancestors = new Set()) {
  if (depth > 80) throw new Error('TIMELINE_DEPTH_LIMIT');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (!value || typeof value !== 'object' || ancestors.has(value) ||
      (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) throw new Error('TIMELINE_REQUIRES_JSON');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value).filter(key => !(Array.isArray(value) && key === 'length'));
  if (Array.isArray(value) && (keys.length !== value.length || keys.some((key, index) => key !== String(index)))) throw new Error('TIMELINE_REQUIRES_JSON');
  ancestors.add(value);
  for (const key of keys) {
    if (typeof key !== 'string' || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value')) throw new Error('TIMELINE_REQUIRES_JSON');
    validateTimelineJson(descriptors[key].value, depth + 1, ancestors);
  }
  ancestors.delete(value);
}

export function encodeTimelineWindow(events, { maxBytes = 786432 } = {}) {
  if (!Array.isArray(events) || events.length > 24000 || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('INVALID_TIMELINE_BOUND');
  validateTimelineJson(events);
  const previous = new Map();
  const records = [];
  const changes = (before, after, path = []) => {
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    if (typeof before === 'string' && typeof after === 'string') {
      let keep = 0;
      while (keep < before.length && keep < after.length && before[keep] === after[keep]) keep++;
      const text = ['text', path, keep, after.slice(keep)];
      const set = ['set', path, after];
      return [JSON.stringify(text).length < JSON.stringify(set).length ? text : set];
    }
    if (before && after && typeof before === 'object' && typeof after === 'object' &&
        Array.isArray(before) === Array.isArray(after) && JSON.stringify(Object.keys(before)) === JSON.stringify(Object.keys(after))) {
      return Object.keys(after).flatMap(key => changes(before[key], after[key], [...path, key]));
    }
    return [['set', path, after]];
  };
  for (const event of events) {
    if (!Number.isSafeInteger(event.eventId) || typeof event.kind !== 'string') throw new Error('INVALID_TIMELINE_EVENT');
    const key = JSON.stringify([event.documentId ?? null, event.kind]);
    const prior = previous.get(key);
    const full = { event: structuredClone(event) };
    const delta = prior ? { base: prior.index, changes: changes(prior.event, event) } : null;
    records.push(delta && JSON.stringify(delta).length < JSON.stringify(full).length ? delta : full);
    previous.set(key, { event, index: records.length - 1 });
  }
  const packet = { format: 'lossless-timeline-delta-v1', records };
  if (Buffer.byteLength(JSON.stringify(packet)) > maxBytes) throw new Error('TIMELINE_ENCODED_CAPACITY_INSUFFICIENT');
  return packet;
}

export function decodeTimelineWindow(packet, { maxBytes = 16777216 } = {}) {
  if (packet?.format !== 'lossless-timeline-delta-v1' || !Array.isArray(packet.records) || packet.records.length > 24000 ||
      !Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('INVALID_TIMELINE_PACKET');
  validateTimelineJson(packet);
  const events = [];
  let bytes = 2;
  for (const record of packet.records) {
    let event;
    if (Object.hasOwn(record, 'event')) {
      if (Object.keys(record).length !== 1) throw new Error('INVALID_TIMELINE_RECORD');
      event = structuredClone(record.event);
    }
    else {
      if (Object.keys(record).length !== 2 || !Number.isSafeInteger(record.base) || record.base < 0 || record.base >= events.length || !Array.isArray(record.changes)) throw new Error('INVALID_TIMELINE_BASE');
      event = structuredClone(events[record.base]);
      for (const change of record.changes) {
        if (!Array.isArray(change) || !Array.isArray(change[1]) || !['set', 'text'].includes(change[0])) throw new Error('INVALID_TIMELINE_CHANGE');
        const path = change[1];
        let parent = null;
        let target = event;
        for (const key of path) {
          if (!target || typeof target !== 'object' || typeof key !== 'string' || !Object.hasOwn(target, key)) throw new Error('INVALID_TIMELINE_PATH');
          parent = target; target = target[key];
        }
        let value;
        if (change[0] === 'text') {
          if (change.length !== 4 || typeof target !== 'string' || !Number.isSafeInteger(change[2]) || change[2] < 0 ||
              change[2] > target.length || typeof change[3] !== 'string') throw new Error('INVALID_TIMELINE_TEXT');
          value = target.slice(0, change[2]) + change[3];
        } else {
          if (change.length !== 3) throw new Error('INVALID_TIMELINE_CHANGE');
          value = structuredClone(change[2]);
        }
        if (parent) Object.defineProperty(parent, path.at(-1), { value, enumerable: true, configurable: true, writable: true });
        else event = value;
      }
    }
    if (!Number.isSafeInteger(event?.eventId) || typeof event.kind !== 'string') throw new Error('INVALID_TIMELINE_EVENT');
    bytes += Buffer.byteLength(JSON.stringify(event)) + (events.length ? 1 : 0);
    if (bytes > maxBytes) throw new Error('TIMELINE_DECODED_CAPACITY_INSUFFICIENT');
    events.push(event);
  }
  return events;
}

export function planTimelineWindows(events, { windowEvents = 80, overlapEvents = 4, maxWindowBytes = 24576, maxWindows = 24, maxInputBytes = 786432 } = {}) {
  if (![windowEvents, maxWindowBytes, maxWindows, maxInputBytes].every(value => Number.isSafeInteger(value) && value > 0) ||
      !Number.isSafeInteger(overlapEvents) || overlapEvents < 0 || overlapEvents >= windowEvents || !events.length) throw new Error('INVALID_TIMELINE_PLAN');
  const windows = [];
  let totalBytes = 0;
  let start = 0;
  while (start < events.length) {
    let end = Math.min(start + windowEvents, events.length);
    let packet;
    while (end > start) {
      try { packet = encodeTimelineWindow(events.slice(start, end), { maxBytes: maxWindowBytes }); break; }
      catch (error) { if (error.message !== 'TIMELINE_ENCODED_CAPACITY_INSUFFICIENT') throw error; end--; }
    }
    if (!packet || (end < events.length && end - start <= overlapEvents) || windows.length >= maxWindows) throw new Error('TIMELINE_WINDOW_CAPACITY_INSUFFICIENT');
    totalBytes += Buffer.byteLength(JSON.stringify(packet));
    if (totalBytes > maxInputBytes) throw new Error('TIMELINE_TOTAL_CAPACITY_INSUFFICIENT');
    windows.push({ firstEvent: events[start].eventId, lastEvent: events[end - 1].eventId, packet });
    if (end === events.length) break;
    start = end - overlapEvents;
  }
  return { windows, totalBytes, originalEvents: events.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = new URL('../../../test-results/deployed-eval/pilot-driver-calibration/2026-09-12T10-18-07.625Z-55b08b25-a83e-412d-8012-d02d151b38ae/report.json', import.meta.url);
  const report = JSON.parse(await readFile(source, 'utf8'));
  const results = report.results.map(result => {
    const packet = encodeReviewEvidence(result.events, { maxBytes: 16777216 });
    const reconstructed = decodeReviewEvidence(packet);
    if (!isDeepStrictEqual(reconstructed, result.events)) throw new Error('REVIEW_CODEC_ROUND_TRIP_FAILED');
    const windows = [];
    for (let start = 0; start < result.events.length; start += 76) {
      const original = result.events.slice(start, start + 80);
      const encoded = encodeTimelineWindow(original);
      if (JSON.stringify(decodeTimelineWindow(encoded)) !== JSON.stringify(original)) throw new Error('TIMELINE_ROUND_TRIP_FAILED');
      windows.push(Buffer.byteLength(JSON.stringify(encoded)));
      if (start + 80 >= result.events.length) break;
    }
    let boundedPlan;
    try {
      const plan = planTimelineWindows(result.events);
      for (const window of plan.windows) {
        const original = result.events.filter(event => event.eventId >= window.firstEvent && event.eventId <= window.lastEvent);
        if (JSON.stringify(decodeTimelineWindow(window.packet)) !== JSON.stringify(original)) throw new Error('BOUNDED_TIMELINE_ROUND_TRIP_FAILED');
      }
      boundedPlan = { status: 'ENCODED_WINDOWS_FIT_ONLY', windows: plan.windows.length, encodedBytes: plan.totalBytes,
        largestWindowBytes: Math.max(...plan.windows.map(window => Buffer.byteLength(JSON.stringify(window.packet)))) };
    } catch (error) { boundedPlan = { status: 'BLOCKED', code: error.message }; }
    return { flowId: result.flowId, originalEvents: result.events.length, rawBytes: Buffer.byteLength(JSON.stringify(result.events)),
      encodedBytes: Buffer.byteLength(JSON.stringify(packet)), records: packet.records.length, exactRoundTrip: true,
      timelineWindowBytes: windows, totalTimelineBytes: windows.reduce((sum, size) => sum + size, 0), independentlyDecoded: true, boundedPlan };
  });
  const measured = { source: 'retained-local-driver-calibration', sourceSha256: createHash('sha256').update(JSON.stringify(report)).digest('hex'),
    results, readinessClaim: false,
    limitation: 'Measured compression is not a worst-case guarantee. Encoded windows exclude skill/prompts/tool schemas, notes, assets, synthesis and transport tokens; the unchanged admission gate still blocks.' };
  const output = new URL(`../../../.harness-state/deployed-eval/timeline-capacity-${randomUUID()}.json`, import.meta.url);
  await writeFile(output, JSON.stringify(measured, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ ...measured, reportPath: fileURLToPath(output) }, null, 2));
}