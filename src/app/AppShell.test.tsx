import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SidebarContent } from './AppShell';

vi.mock('../data', () => ({ repo: { createThread: vi.fn() } }));
vi.mock('../features/history/HistoryList', () => ({ HistoryList: () => null }));

afterEach(cleanup);

describe('collapsed navigation', () => {
  it('keeps every icon-only destination accessibly named', () => {
    render(<MemoryRouter><SidebarContent collapsed /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Library' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });
});