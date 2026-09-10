import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillSummary } from '../../lib/types';

const mocks = vi.hoisted(() => ({
  setEnabled: vi.fn(),
  list: vi.fn(),
}));

vi.mock('../../data', () => ({
  skillsApi: {
    setEnabled: mocks.setEnabled,
    list: mocks.list,
  },
}));

import { useSkills } from './useSkills';

function skill(id: string): SkillSummary {
  return { id, name: id, description: id, source: 'default', version: 1, enabled: false, status: 'ready' };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  return { promise: new Promise<T>((done, fail) => { resolve = done; reject = fail; }), resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  useSkills.setState({ skills: [skill('a'), skill('b')], busy: {}, loading: false });
});

describe('useSkills optimistic updates', () => {
  it('rolls back only the failed item when concurrent toggles resolve differently', async () => {
    const first = deferred<SkillSummary>();
    const second = deferred<SkillSummary>();
    mocks.setEnabled.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const toggleA = useSkills.getState().setEnabled('a', true);
    const toggleB = useSkills.getState().setEnabled('b', true);

    second.resolve({ ...skill('b'), enabled: true });
    await toggleB;
    first.reject(new Error('offline'));
    await toggleA;

    expect(useSkills.getState().skills.map(({ id, enabled }) => ({ id, enabled }))).toEqual([
      { id: 'a', enabled: false },
      { id: 'b', enabled: true },
    ]);
  });
});