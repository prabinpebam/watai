import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Segmented, SelectMenu } from './ui';

afterEach(cleanup);

describe('shared composite keyboard controls', () => {
  it('uses one tab stop and arrow selection for segmented controls', () => {
    const onChange = vi.fn();
    render(<Segmented value="medium" onChange={onChange} options={[
      { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
    ]} />);
    expect(screen.getByRole('tab', { name: 'Medium' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Low' })).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Medium' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('high');
  });

  it('opens a selection popover with arrows and restores trigger focus on Escape', async () => {
    render(<SelectMenu value="newest" label="Sort" onChange={vi.fn()} options={[
      { value: 'newest', label: 'Newest' }, { value: 'oldest', label: 'Oldest' },
    ]} />);
    const trigger = screen.getByRole('button', { name: 'Sort' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Newest' })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Oldest' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});