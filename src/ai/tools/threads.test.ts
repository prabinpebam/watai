import { describe, it, expect, vi } from 'vitest';
import type { Repository } from '../../data/repository';
import { createThreadTool, runCreateThread, deleteThreadTool, runDeleteThread } from './threads';

describe('create_thread tool', () => {
  it('is a function tool named create_thread', () => {
    expect(createThreadTool.type).toBe('function');
    expect(createThreadTool.name).toBe('create_thread');
  });

  it('creates a thread with the given title and returns its id', async () => {
    const createThread = vi.fn(async (init: { title: string }) => ({ id: 'new1', title: init.title }));
    const res = await runCreateThread({ title: 'Trip plans' }, { createThread } as unknown as Repository);
    expect(createThread).toHaveBeenCalledWith({ title: 'Trip plans' });
    expect(res.output).toMatch(/created/i);
    expect(res.output).toContain('new1');
  });

  it('defaults the title when none is provided', async () => {
    const createThread = vi.fn(async () => ({ id: 'n', title: 'New chat' }));
    await runCreateThread({}, { createThread } as unknown as Repository);
    expect(createThread).toHaveBeenCalledWith({ title: 'New chat' });
  });
});

describe('delete_thread tool', () => {
  it('is a function tool named delete_thread', () => {
    expect(deleteThreadTool.type).toBe('function');
    expect(deleteThreadTool.name).toBe('delete_thread');
  });

  it('requires a threadId', async () => {
    const deleteThread = vi.fn();
    const res = await runDeleteThread({}, { deleteThread } as unknown as Repository);
    expect(deleteThread).not.toHaveBeenCalled();
    expect(res.output).toMatch(/no thread/i);
  });

  it('deletes the thread and confirms', async () => {
    const deleteThread = vi.fn(async () => {});
    const res = await runDeleteThread({ threadId: 't9' }, { deleteThread } as unknown as Repository);
    expect(deleteThread).toHaveBeenCalledWith('t9');
    expect(res.output).toMatch(/deleted/i);
  });
});
