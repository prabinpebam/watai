import { useRef, type ReactNode } from 'react';
import type { Decorator } from '@storybook/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../../app/ThemeProvider';
import { useUi } from '../../state/store';
import { installStoryData } from './storyData';

type StoryFrame = 'app' | 'surface' | 'none';
type StoryTheme = 'light' | 'dark' | 'system';

interface StoryParameters {
  route?: string;
  frame?: StoryFrame;
  theme?: StoryTheme;
}

function prepareStoryEnvironment(theme: StoryTheme): void {
  installStoryData();
  useUi.setState({
    theme,
    textScale: 1.0,
    density: 'comfortable',
    reduceMotion: 'system',
    drawerOpen: false,
    sidebarCollapsed: false,
    activeModelByThread: {},
    composerDrafts: {},
    temporaryChat: false,
    stream: { status: 'idle' },
    capability: null,
    connectivity: 'online',
    toasts: [],
    threadsVersion: 0,
    threadRev: {},
    threadLocks: {},
    confirmRequest: null,
    sourcePane: null,
    filesPane: null,
  });
}

function AppStoryHarness({
  children,
  storyId,
  route = '/',
  frame = 'surface',
  theme = 'dark',
}: {
  children: ReactNode;
  storyId: string;
  route?: string;
  frame?: StoryFrame;
  theme?: StoryTheme;
}) {
  const key = `${storyId}:${route}:${theme}`;
  const prepared = useRef<string | null>(null);
  if (prepared.current !== key) {
    prepareStoryEnvironment(theme);
    prepared.current = key;
  }

  return (
    <MemoryRouter initialEntries={[route]} key={key}>
      <ThemeProvider>
        <div className={`storybook-shell storybook-shell--${frame}`}>{children}</div>
      </ThemeProvider>
    </MemoryRouter>
  );
}

export const withAppStory: Decorator = (Story, context) => {
  const params = context.parameters as StoryParameters;
  return (
    <AppStoryHarness
      storyId={context.id}
      route={params.route}
      frame={params.frame}
      theme={params.theme}
    >
      <Story />
    </AppStoryHarness>
  );
};