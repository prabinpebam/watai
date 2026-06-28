import type { Meta, StoryObj } from '@storybook/react';
import { Composer } from './components/Composer';
import { Gallery } from './components/Gallery';
import { ImageCard } from './components/ImageCard';
import { Toolbar } from './components/Toolbar';
import { useImageStudio } from './imageStudioStore';
import type { StudioImage } from '../../data/cloud/types';
import './studio.css';

const meta = {
  title: 'Features/Image Studio',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const readyImage: StudioImage = {
  id: 'img1',
  userId: 'u1',
  batchId: 'b1',
  status: 'ready',
  prompt: 'A colorful worksheet cover for a 9 year old',
  size: '1024x1024',
  outputFormat: 'png',
  model: 'gpt-image-2',
  blobPath: 'u/images/img1.png',
  url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><rect width="320" height="320" fill="%232f6feb"/><circle cx="160" cy="150" r="72" fill="white"/><text x="160" y="260" text-anchor="middle" font-size="28" fill="white">Worksheet</text></svg>',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function seedStudio() {
  useImageStudio.setState({
    imageCapable: true,
    prompt: 'A colorful worksheet cover for a 9 year old',
    images: [readyImage, { ...readyImage, id: 'img2', status: 'generating', prompt: 'Generating sample', url: undefined }],
  });
}

export const Workspace: Story = {
  render: function WorkspaceStory() {
    seedStudio();
    return (
      <div className="studio" style={{ height: 720 }}>
        <div className="studio__top"><Composer /><Toolbar /></div>
        <div className="studio__gallery"><Gallery /></div>
      </div>
    );
  },
};

export const Cards: Story = {
  render: () => (
    <div className="studio-grid" style={{ width: 520 }}>
      <ImageCard img={readyImage} />
      <ImageCard img={{ ...readyImage, id: 'err', status: 'error', error: { code: 'content_filtered', message: 'Blocked' }, url: undefined }} />
      <ImageCard img={{ ...readyImage, id: 'pending', status: 'queued', url: undefined }} />
    </div>
  ),
};