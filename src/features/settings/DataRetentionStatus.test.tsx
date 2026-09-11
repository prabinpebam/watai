import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DataRetentionStatus } from './Settings';

afterEach(cleanup);

describe('DataRetentionStatus', () => {
  it('states effective privacy limits without offering unsupported controls', () => {
    render(<DataRetentionStatus />);
    expect(screen.getByText('Temporary chats unavailable')).toBeInTheDocument();
    expect(screen.getByText(/New chats are saved normally/)).toBeInTheDocument();
    expect(screen.getByText(/Time-based automatic deletion is not currently enforced/)).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /Temporary/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '30 days' })).not.toBeInTheDocument();
  });
});