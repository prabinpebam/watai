import { useState } from 'react';
import { Composer } from '../chat/Composer';
import type { StagedLibraryItem } from '../../state/store';
import { LibraryRuntimeProvider } from './LibraryApi';
import { libraryFixtureApi } from './LibraryExperienceFixture';
import './library.css';
import { useParams } from 'react-router-dom';

const THREAD_ID = 'picker-eval-thread';

export function LibraryPickerExperienceFixture() {
  const params = useParams();
  const threadId = params.threadId ?? THREAD_ID;
  const [value, setValue] = useState('');
  const [submitted, setSubmitted] = useState<StagedLibraryItem[]>([]);
  return (
    <LibraryRuntimeProvider api={libraryFixtureApi} basePath="/dev/library-eval" createImagePath="/dev/library-eval?kind=image">
      <main className="library-picker-eval">
        <h1>Composer attachment evaluation</h1>
        <div className="composer-slot library-picker-eval__composer">
          <Composer threadId={threadId} value={value} onChange={setValue} onSend={(_text, _files, _skills, selections) => setSubmitted(selections ?? [])} streaming={false} onStop={() => {}} />
        </div>
        <output data-testid="submitted-items">{submitted.map((selection) => `${selection.item.id}:${selection.mode}`).join(',')}</output>
      </main>
    </LibraryRuntimeProvider>
  );
}
