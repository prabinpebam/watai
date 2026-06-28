import type { Preview } from '@storybook/react';
import '../src/design/tokens.css';
import '../src/design/global.css';
import '../src/design/components.css';
import '../src/test/storybook/storybook.css';
import { withAppStory } from '../src/test/storybook/AppStoryHarness';

const preview: Preview = {
  decorators: [withAppStory],
  parameters: {
    backgrounds: {
      default: 'App',
      values: [{ name: 'App', value: 'var(--color-bg)' }],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: 'fullscreen',
  },
};

export default preview;