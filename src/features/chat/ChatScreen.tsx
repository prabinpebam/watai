import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChatView } from './ChatView';
import { ToolsMenu } from './ToolsMenu';
import { DEFAULT_CHAT_MODEL } from './runStore';

import { IconButton, SelectMenu } from '../../design/ui';
import { useIsExpanded } from '../../lib/hooks';
import { useUi } from '../../state/store';
import { cloudApi, repo } from '../../data';
import { chatModelLabel, normalizeChatModelOptions } from '../../lib/modelOptions';

export function ChatScreen() {
  const params = useParams();
  const navigate = useNavigate();
  const expanded = useIsExpanded();
  const toggleDrawer = useUi((s) => s.toggleDrawer);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const version = useUi((s) => s.threadsVersion);
  const toggleFilesPane = useUi((s) => s.toggleFilesPane);
  const activeModel = useUi((s) => s.activeModelByThread[params.threadId!]);
  const setModelForThread = useUi((s) => s.setModelForThread);

  // The thread id is always in the URL (a fresh chat redirects /new -> /c/{newId} first), so the
  // thread is only persisted once the first prompt commits it. Until then getThread is null and we
  // show "New chat"; once it exists (and the server auto-names it) the version bump re-fetches.
  const threadId = params.threadId!;
  const [title, setTitle] = useState('New chat');
  const [scrolled, setScrolled] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>(() => normalizeChatModelOptions(DEFAULT_CHAT_MODEL));

  useEffect(() => {
    let live = true;
    repo.getThread(threadId).then((t) => {
      if (live) setTitle(t?.title?.trim() || 'New chat');
    });
    return () => {
      live = false;
    };
  }, [threadId, version]);

  useEffect(() => {
    let live = true;
    cloudApi
      .getCredentialStatus()
      .then((status) => {
        if (!live) return;
        setModelOptions(normalizeChatModelOptions(status.models?.chat, status.models?.chatOptions));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const selectedModel = activeModel ?? DEFAULT_CHAT_MODEL;
  const options = (modelOptions.includes(selectedModel) ? modelOptions : normalizeChatModelOptions(selectedModel, modelOptions))
    .map((model) => ({ value: model, label: chatModelLabel(model), description: model === DEFAULT_CHAT_MODEL ? 'Routes automatically' : model }));

  return (
    <>
      <div className={`appbar ${scrolled ? 'appbar--scrolled' : ''}`}>
        {expanded ? (
          <IconButton
            name="sidebar"
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => toggleSidebar()}
          />
        ) : (
          <IconButton name="menu" label="Open menu" onClick={() => toggleDrawer(true)} />
        )}
        <SelectMenu
          className="appbar-model"
          label="Chat model"
          value={selectedModel}
          options={options}
          onChange={(model) => setModelForThread(threadId, model)}
        />
        <div className="appbar__title">{title}</div>
        <IconButton name="file-text" label="Chat files" onClick={() => toggleFilesPane(threadId)} />
        <ToolsMenu />
        <IconButton name="pen-square" label="New chat" onClick={() => navigate('/new')} />
        <IconButton name="speaker" label="Voice mode" onClick={() => navigate(`/voice/${threadId}`)} />
      </div>
      <ChatView key={threadId} threadId={threadId} onScrolledChange={setScrolled} />
    </>
  );
}
