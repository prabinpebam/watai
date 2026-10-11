import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ChatView } from '../../../src/features/chat/ChatView';
import '../../../src/design/tokens.css';
import '../../../src/design/global.css';
import '../../../src/design/components.css';

createRoot(document.getElementById('root')!).render(<MemoryRouter><ChatView threadId="chronology" /></MemoryRouter>);