import type { MemoryKind, MemoryRecord } from './memory';

export interface ProfileItem {
  text: string;
  sourceMemoryIds: string[];
  confidence: number;
}

export interface ProfilePet {
  name: string;
  species?: string;
  inspiredBy: string[];
  sourceMemoryIds: string[];
  confidence: number;
}

export interface ProfileChild extends ProfileItem {
  name: string;
  relationship: 'daughter' | 'son' | 'child';
  age?: number;
}

export interface ProfileInterest {
  name: string;
  sourceMemoryIds: string[];
}

export interface TemporalBucket {
  items: Array<{ memoryId: string; text: string; kind: MemoryKind; updatedAt: string }>;
}

export interface MemoryProfileView {
  schemaVersion: 1;
  userId: string;
  updatedAt: string;
  evidenceCount: number;
  profile: {
    user: {
      details: Record<string, ProfileItem>;
      family: {
        spouse: ProfileItem[];
        children: ProfileChild[];
        pets: ProfilePet[];
      };
      preferences: {
        communication: ProfileItem[];
        engineering: ProfileItem[];
        design: ProfileItem[];
        tools: ProfileItem[];
        other: ProfileItem[];
      };
      interests: {
        media: ProfileInterest[];
        hobbies: ProfileInterest[];
        other: ProfileInterest[];
      };
    };
    work: {
      projects: ProfileItem[];
      repositories: ProfileItem[];
      deployments: ProfileItem[];
      currentFocus: ProfileItem[];
    };
    avoidances: ProfileItem[];
  };
  temporal: {
    today: TemporalBucket;
    week: TemporalBucket;
    month: TemporalBucket;
  };
}

function item(memory: MemoryRecord): ProfileItem {
  return { text: memory.text, sourceMemoryIds: [memory.id], confidence: memory.confidence };
}

function addUnique<T extends { sourceMemoryIds?: string[]; name?: string; text?: string }>(items: T[], next: T): void {
  const key = next.name?.toLowerCase() ?? next.text?.toLowerCase() ?? next.sourceMemoryIds?.join('|') ?? JSON.stringify(next);
  if (!items.some((item) => (item.name?.toLowerCase() ?? item.text?.toLowerCase() ?? item.sourceMemoryIds?.join('|')) === key)) items.push(next);
}

function extractPet(memory: MemoryRecord): ProfilePet | null {
  const text = memory.text;
  const match = /(?:have|has|having|called|named|dog|cat|pet|puppy|kitten).*?\b(dog|cat|pet|puppy|kitten)\b.*?\b(?:named|called)\s+([A-Z][A-Za-z0-9_-]+)/i.exec(text)
    ?? /\b(?:dog|cat|pet|puppy|kitten)\s+(?:named|called)\s+([A-Z][A-Za-z0-9_-]+)/i.exec(text)
    ?? /\b([A-Z][A-Za-z0-9_-]+)\b.*?\b(?:is|as)\s+(?:my|the user's|user's)?\s*(dog|cat|pet|puppy|kitten)\b/i.exec(text);
  if (!match) return null;
  let species: string | undefined;
  let name: string;
  if (match.length >= 3 && /dog|cat|pet|puppy|kitten/i.test(match[1]) && /^[A-Z]/.test(match[2])) {
    species = normalizeSpecies(match[1]);
    name = match[2];
  } else if (match.length >= 3 && /^[A-Z]/.test(match[1])) {
    name = match[1];
    species = normalizeSpecies(match[2]);
  } else {
    name = match[1];
  }
  const inspiredBy = extractInspirations(text);
  return { name, species, inspiredBy, sourceMemoryIds: [memory.id], confidence: memory.confidence };
}

function normalizeSpecies(value: string): string {
  const lower = value.toLowerCase();
  if (lower === 'puppy') return 'dog';
  if (lower === 'kitten') return 'cat';
  return lower;
}

function extractInspirations(text: string): string[] {
  const out: string[] = [];
  const inspired = /inspired by\s+([^.;]+)/i.exec(text)?.[1]?.trim();
  if (inspired) out.push(cleanName(inspired));
  if (/\bOne Piece\b/i.test(text) && !out.some((x) => x.toLowerCase() === 'one piece')) out.push('One Piece');
  return out;
}

function cleanName(value: string): string {
  return value.replace(/^the\s+/i, '').replace(/\s+and\s+.*$/i, '').trim();
}

function addInterest(profile: MemoryProfileView, name: string, memory: MemoryRecord): void {
  if (!name) return;
  addUnique(profile.profile.user.interests.media, { name, sourceMemoryIds: [memory.id] });
}

function evidenceText(memory: MemoryRecord): string {
  return [memory.text, memory.summary, ...memory.sourceRefs.map((ref) => ref.quote)].filter(Boolean).join(' ');
}

function extractAge(text: string): number | undefined {
  const raw = /\b(?:age\s*(?:is\s*)?|(?:is|she(?:'|’)?s|he(?:'|’)?s|they(?:'|’)?re)\s+)?(\d{1,2})\s*(?:years?\s*old|yrs?\s*old|yo|y\/o)\b/i.exec(text)?.[1]
    ?? /\bage\s*(?:is\s*)?(\d{1,2})\b/i.exec(text)?.[1];
  if (!raw) return undefined;
  const age = Number(raw);
  return age >= 0 && age <= 120 ? age : undefined;
}

function childText(child: { name: string; relationship: string; age?: number }): string {
  return `${child.name} · ${child.relationship}${child.age !== undefined ? ` · age ${child.age}` : ''}`;
}

function extractChild(memory: MemoryRecord): ProfileChild | null {
  const text = evidenceText(memory);
  const match = /\b(?:user(?:'s)?|the user's|my)\s+(daughter|son|child)\s+(?:is\s+)?(?:named|called)\s+([A-Z][A-Za-z0-9_-]+)/i.exec(text)
    ?? /\b(?:user(?:'s)?|the user's|my)\s+(daughter|son|child)(?:'|’)?s\s+name\s+is\s+([A-Z][A-Za-z0-9_-]+)/i.exec(text)
    ?? /\b(?:user\s+)?(?:has|have)\s+(?:a|an)\s+(daughter|son|child)\s+(?:named|called)\s+([A-Z][A-Za-z0-9_-]+)/i.exec(text)
    ?? /\b([A-Z][A-Za-z0-9_-]+)\b.*?\b(?:is|as)\s+(?:user(?:'s)?|the user's|my)\s+(daughter|son|child)\b/i.exec(text);
  if (!match) return null;
  let relationship: ProfileChild['relationship'];
  let name: string;
  if (/daughter|son|child/i.test(match[1]) && /^[A-Z]/.test(match[2])) {
    relationship = match[1].toLowerCase() as ProfileChild['relationship'];
    name = match[2];
  } else {
    name = match[1];
    relationship = match[2].toLowerCase() as ProfileChild['relationship'];
  }
  const age = extractAge(text);
  return { name, relationship, ...(age !== undefined ? { age } : {}), text: childText({ name, relationship, age }), sourceMemoryIds: [memory.id], confidence: memory.confidence };
}

function mergeChild(children: ProfileChild[], next: ProfileChild, options?: { replaceAge?: boolean }): void {
  const existing = children.find((child) => child.name.toLowerCase() === next.name.toLowerCase());
  if (!existing) {
    children.push(next);
    return;
  }
  if (existing.relationship === 'child' && next.relationship !== 'child') existing.relationship = next.relationship;
  if (next.age !== undefined && (options?.replaceAge || existing.age === undefined)) existing.age = next.age;
  existing.confidence = Math.max(existing.confidence, next.confidence);
  existing.sourceMemoryIds = [...new Set([...existing.sourceMemoryIds, ...next.sourceMemoryIds])];
  existing.text = childText(existing);
}

function mergeChildAgeFromMemory(children: ProfileChild[], memory: MemoryRecord, ageUpdatedFor: Set<string>): void {
  const text = evidenceText(memory);
  const age = extractAge(text);
  if (age === undefined) return;
  for (const child of children) {
    if (!new RegExp(`\\b${escapeRegExp(child.name)}\\b`, 'i').test(text)) continue;
    const key = child.name.toLowerCase();
    if (ageUpdatedFor.has(key)) return;
    mergeChild(children, { ...child, age, sourceMemoryIds: [memory.id], confidence: memory.confidence, text: childText({ ...child, age }) }, { replaceAge: true });
    ageUpdatedFor.add(key);
    return;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asAttributeAge(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 120 ? n : undefined;
}

/** Structured child derived from an explicit memory route, when the planner provided one. */
function routedChild(memory: MemoryRecord): ProfileChild | null {
  const route = memory.route;
  if (!route || route.profilePath !== 'user.family.children') return null;
  const name = asLabel(route.entity?.name) ?? asLabel(route.relationship?.object?.name);
  if (!name) return null;
  const attrs = route.relationship?.attributes ?? {};
  const rel = asLabel(attrs.relationship)?.toLowerCase();
  const relationship: ProfileChild['relationship'] = rel === 'daughter' || rel === 'son' ? rel : 'child';
  const age = asAttributeAge(attrs.age);
  return { name, relationship, ...(age !== undefined ? { age } : {}), text: childText({ name, relationship, age }), sourceMemoryIds: [memory.id], confidence: memory.confidence };
}

const PROFILE_ITEM_BRANCHES: Record<string, (profile: MemoryProfileView) => ProfileItem[]> = {
  'user.preferences.communication': (p) => p.profile.user.preferences.communication,
  'user.preferences.engineering': (p) => p.profile.user.preferences.engineering,
  'user.preferences.design': (p) => p.profile.user.preferences.design,
  'user.preferences.tools': (p) => p.profile.user.preferences.tools,
  'user.preferences.other': (p) => p.profile.user.preferences.other,
  'work.projects': (p) => p.profile.work.projects,
  'work.repositories': (p) => p.profile.work.repositories,
  'work.deployments': (p) => p.profile.work.deployments,
  'work.currentFocus': (p) => p.profile.work.currentFocus,
  avoidances: (p) => p.profile.avoidances,
};

/** Place a memory using its explicit route. Returns true when the route owned placement. */
function placeRoutedItem(profile: MemoryProfileView, memory: MemoryRecord): boolean {
  const path = memory.route?.profilePath;
  if (!path) return false;
  const branch = PROFILE_ITEM_BRANCHES[path];
  if (branch) {
    addUnique(branch(profile), item(memory));
    return true;
  }
  if (path === 'user.interests.media' || path === 'user.interests.hobbies' || path === 'user.interests.other') {
    const name = asLabel(memory.route?.entity?.name) ?? memory.text;
    const bucket = path === 'user.interests.hobbies' ? profile.profile.user.interests.hobbies : path === 'user.interests.other' ? profile.profile.user.interests.other : profile.profile.user.interests.media;
    addUnique(bucket, { name, sourceMemoryIds: [memory.id] });
    return true;
  }
  return false;
}

function bucketFor(memory: MemoryRecord): Array<'today' | 'week' | 'month'> {
  const ageMs = Date.now() - Date.parse(memory.updatedAt || memory.createdAt);
  const day = 24 * 60 * 60 * 1000;
  const buckets: Array<'today' | 'week' | 'month'> = [];
  if (ageMs <= day) buckets.push('today');
  if (ageMs <= 7 * day) buckets.push('week');
  if (ageMs <= 31 * day) buckets.push('month');
  return buckets;
}

function classifyPreference(memory: MemoryRecord): keyof MemoryProfileView['profile']['user']['preferences'] {
  const text = memory.text.toLowerCase();
  if (/respond|answer|concise|verbose|tone|format|explain|communication/.test(text)) return 'communication';
  if (/code|typescript|test|build|deploy|architecture|implementation/.test(text)) return 'engineering';
  if (/ui|design|visual|storybook|screenshot|layout/.test(text)) return 'design';
  if (/tool|electron|terminal|browser|vscode|github|azure/.test(text)) return 'tools';
  return 'other';
}

export function buildMemoryProfile(userId: string, now: string, memories: MemoryRecord[]): MemoryProfileView {
  const profile: MemoryProfileView = {
    schemaVersion: 1,
    userId,
    updatedAt: now,
    evidenceCount: memories.length,
    profile: {
      user: {
        details: {},
        family: { spouse: [], children: [], pets: [] },
        preferences: { communication: [], engineering: [], design: [], tools: [], other: [] },
        interests: { media: [], hobbies: [], other: [] },
      },
      work: { projects: [], repositories: [], deployments: [], currentFocus: [] },
      avoidances: [],
    },
    temporal: { today: { items: [] }, week: { items: [] }, month: { items: [] } },
  };

  const activeMemories = memories.filter((memory) => memory.status === 'active');

  for (const memory of activeMemories) {
    for (const bucket of bucketFor(memory)) profile.temporal[bucket].items.push({ memoryId: memory.id, text: memory.text, kind: memory.kind, updatedAt: memory.updatedAt });
    const child = routedChild(memory) ?? extractChild(memory);
    if (child) mergeChild(profile.profile.user.family.children, child);
    const pet = extractPet(memory);
    if (pet) {
      addUnique(profile.profile.user.family.pets, pet);
      for (const inspiration of pet.inspiredBy) addInterest(profile, inspiration, memory);
      continue;
    }
    if (/\bOne Piece\b/i.test(memory.text)) addInterest(profile, 'One Piece', memory);

    if (placeRoutedItem(profile, memory)) continue;

    if (memory.kind === 'preference' || memory.kind === 'work_style' || memory.kind === 'procedure') {
      addUnique(profile.profile.user.preferences[classifyPreference(memory)], item(memory));
    } else if (memory.kind === 'avoidance') {
      addUnique(profile.profile.avoidances, item(memory));
    } else if (memory.kind === 'project_context') {
      const text = memory.text.toLowerCase();
      if (/deploy|resource group|rg-/.test(text)) addUnique(profile.profile.work.deployments, item(memory));
      else if (/repo|repository|github/.test(text)) addUnique(profile.profile.work.repositories, item(memory));
      else addUnique(profile.profile.work.projects, item(memory));
    } else if (/current|today|this week|working on|focus/i.test(memory.text)) {
      addUnique(profile.profile.work.currentFocus, item(memory));
    }
  }

  const childAgesUpdated = new Set<string>();
  for (const memory of activeMemories) mergeChildAgeFromMemory(profile.profile.user.family.children, memory, childAgesUpdated);

  return profile;
}