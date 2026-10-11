import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GeneratedImages } from './Attachments';

vi.mock('../../design/noise/NoiseStipple', () => ({ NoiseStipple: () => <canvas className="noise-stipple" aria-hidden="true" /> }));

describe('image generation placeholder', () => {
  it('covers the whole card with noise and overlays the status above the reserved card geometry', () => {
    const { container } = render(<GeneratedImages pending={[{ id: 'p1', size: '1024x1536' }]} />);
    const card = screen.getByRole('img', { name: 'Generating image' });
    expect(card).toHaveClass('image-card', 'image-card--generating');
    expect(card.firstElementChild).toHaveClass('noise-stipple');
    expect(card.querySelector('.image-card__media')).toHaveStyle({ aspectRatio: '1024 / 1536' });
    expect(card.querySelector('.image-card__bar')).toBeInTheDocument();
    const status = card.querySelector('.image-card__status');
    expect(status).toHaveTextContent('Generating image');
    expect(status).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(1);
  });
});
