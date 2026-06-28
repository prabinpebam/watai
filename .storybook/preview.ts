import type { Preview } from '@storybook/react';
import '../src/design/tokens.css';
import '../src/design/global.css';
import '../src/design/components.css';

const preview: Preview = {
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
    layout: 'centered',
  },
};

export default preview;