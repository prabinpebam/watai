import type { Message, Thread } from '../lib/types';
import { newId } from '../lib/ids';

function iso(daysAgo: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

interface SeedThread {
  thread: Thread;
  messages: Message[];
}

function thread(partial: Partial<Thread> & { id: string; title: string; updatedAt: string }): Thread {
  return {
    pinned: false,
    archived: false,
    temporary: false,
    createdAt: partial.updatedAt,
    messageCount: 0,
    ...partial,
  };
}

function userMsg(threadId: string, content: string, createdAt: string): Message {
  return { id: newId(), threadId, role: 'user', content, status: 'complete', createdAt };
}

function botMsg(threadId: string, content: string, createdAt: string): Message {
  return {
    id: newId(),
    threadId,
    role: 'assistant',
    content,
    model: 'gpt-5.4',
    status: 'complete',
    createdAt,
  };
}

const MD_CODE = `Here's a debounce hook in TypeScript:

\`\`\`ts
import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
\`\`\`

It returns the latest value only after \`delay\` ms of quiet. Use it for search inputs.`;

const MD_TABLE = `Quick comparison:

| Approach | Latency | Setup |
| --- | --- | --- |
| Direct (BYO key) | Lowest | None |
| Proxy | +1 hop | Server |
| Cached | Lowest | Some |

The **direct** path is the default in Watai.`;

const MD_MATH = `The Gaussian integral is:

$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$

Inline, Euler's identity $e^{i\\pi} + 1 = 0$ ties together five constants.`;

export function buildSeed(): SeedThread[] {
  const t1 = 'seed-design-tokens';
  const t2 = 'seed-debounce';
  const t3 = 'seed-math';
  const t4 = 'seed-trip';
  const t5 = 'seed-compare';
  const t6 = 'seed-archived';

  return [
    {
      thread: thread({
        id: t1,
        title: 'Design token naming',
        updatedAt: iso(0, 9),
        pinned: true,
        model: 'gpt-5.4',
        lastMessagePreview: 'Use semantic aliases over raw primitives…',
        messageCount: 2,
      }),
      messages: [
        userMsg(t1, 'How should I name design tokens for a theme-able app?', iso(0, 9)),
        botMsg(
          t1,
          'Use a **two-layer** system:\n\n1. **Primitives** — raw scales like `gray-500`, `blue-500`. Never used directly.\n2. **Semantic tokens** — role-based aliases like `--color-bg`, `--color-text-primary`.\n\nComponents reference only the semantic layer, so swapping themes never touches component code.',
          iso(0, 9),
        ),
      ],
    },
    {
      thread: thread({
        id: t2,
        title: 'Debounce hook',
        updatedAt: iso(0, 14),
        model: 'gpt-5.4',
        lastMessagePreview: "Here's a debounce hook in TypeScript…",
        messageCount: 2,
      }),
      messages: [
        userMsg(t2, 'Write a React useDebounced hook in TypeScript.', iso(0, 14)),
        botMsg(t2, MD_CODE, iso(0, 14)),
      ],
    },
    {
      thread: thread({
        id: t3,
        title: 'Gaussian integral',
        updatedAt: iso(1, 11),
        model: 'gpt-5.4',
        lastMessagePreview: 'The Gaussian integral is…',
        messageCount: 2,
      }),
      messages: [
        userMsg(t3, 'Show me the Gaussian integral and Euler identity.', iso(1, 11)),
        botMsg(t3, MD_MATH, iso(1, 11)),
      ],
    },
    {
      thread: thread({
        id: t5,
        title: 'Direct vs proxy',
        updatedAt: iso(3, 16),
        model: 'gpt-5.4',
        lastMessagePreview: 'Quick comparison…',
        messageCount: 2,
      }),
      messages: [
        userMsg(t5, 'Compare direct vs proxy for calling the AI endpoint.', iso(3, 16)),
        botMsg(t5, MD_TABLE, iso(3, 16)),
      ],
    },
    {
      thread: thread({
        id: t4,
        title: 'Trip to Kyoto',
        updatedAt: iso(9, 18),
        model: 'gpt-5.4',
        lastMessagePreview: 'Three days in Kyoto…',
        messageCount: 2,
      }),
      messages: [
        userMsg(t4, 'Plan 3 days in Kyoto for first-timers.', iso(9, 18)),
        botMsg(
          t4,
          '### Day 1 — East\n- Kiyomizu-dera at opening\n- Walk Sannenzaka & Ninenzaka\n- Gion in the evening\n\n### Day 2 — Arashiyama\n- Bamboo grove early\n- Tenryu-ji garden\n- Monkey park\n\n### Day 3 — North\n- Kinkaku-ji (Golden Pavilion)\n- Ryoan-ji rock garden\n- Nishiki Market for lunch',
          iso(9, 18),
        ),
      ],
    },
    {
      thread: thread({
        id: t6,
        title: 'Old notes (archived)',
        updatedAt: iso(40, 12),
        archived: true,
        model: 'gpt-5.4',
        lastMessagePreview: 'Archived conversation…',
        messageCount: 1,
      }),
      messages: [userMsg(t6, 'Remind me to revisit this later.', iso(40, 12))],
    },
  ];
}
