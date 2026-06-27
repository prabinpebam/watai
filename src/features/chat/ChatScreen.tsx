import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChatView } from './ChatView';

import { IconButton } from '../../design/ui';
import { useIsExpanded } from '../../lib/hooks';
import { useUi } from '../../state/store';
import { repo } from '../../data';
import { newId } from '../../lib/ids';

interface ChatScreenProps {
  isNew?: boolean;
}

export function ChatScreen({ isNew }: ChatScreenProps) {
  const params = useParams();
  const navigate = useNavigate();
  const expanded = useIsExpanded();
  const toggleDrawer = useUi((s) => s.toggleDrawer);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const version = useUi((s) => s.threadsVersion);
  const openFilesPane = useUi((s) => s.openFilesPane);

  // For /new, mint a stable id for the lifetime of this screen instance.
  const generatedId = useRef<string>(newId());
  const threadId = isNew ? generatedId.current : params.threadId!;
  const [title, setTitle] = useState(isNew ? 'New chat' : '');
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!isNew) {
      repo.getThread(threadId).then((t) => setTitle(t?.title ?? 'Chat'));
    } else {
      setTitle('New chat');
    }
  }, [threadId, isNew, version]);

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
        <div className="appbar__title">{title}</div>
        <IconButton name="file-text" label="Chat files" onClick={() => openFilesPane(threadId)} />
        <IconButton name="pen-square" label="New chat" onClick={() => navigate('/new')} />
        <IconButton name="speaker" label="Voice mode" onClick={() => navigate(`/voice/${threadId}`)} />
      </div>
      <ChatView key={threadId} threadId={threadId} onScrolledChange={setScrolled} />
    </>
  );
}
