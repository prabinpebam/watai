import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useImageStudio } from '../imageStudioStore';
import { Gallery } from './Gallery';

vi.mock('./ImageCard', () => ({ ImageCard: () => null }));

afterEach(cleanup);

describe('Gallery failure state', () => {
  it('shows and retries an initial load failure instead of rendering an empty gallery', () => {
    const refresh = vi.fn();
    useImageStudio.setState({ images: [], loading: false, error: true, refresh });
    render(<Gallery />);
    expect(screen.getByText('Images couldn’t be loaded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry images' }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});