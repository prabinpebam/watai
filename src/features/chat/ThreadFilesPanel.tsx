import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../design/overlays';
import { Button, IconButton, Spinner } from '../../design/ui';
import { Icon } from '../../design/icons';
import { cloudApi, syncNow } from '../../data';
import { useUi } from '../../state/store';
import { fileToBase64, formatBytes, DOC_ACCEPT } from '../../lib/files';
import type { ThreadFile } from '../../lib/types';

/**
 * A thread's knowledge base: the documents uploaded into its vector store, used by file search.
 * Uploads/deletes go through the server (the AOAI key lives in the vault); the list reflects the
 * thread's recorded files. Opened from the chat app bar.
 */
export function ThreadFilesPanel({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const [files, setFiles] = useState<ThreadFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pushToast = useUi((s) => s.pushToast);

  const load = async () => {
    try {
      setFiles(await cloudApi.listThreadFiles(threadId));
    } catch {
      /* not signed in / offline — leave the current list */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const upload = async (list: FileList | File[]) => {
    const all = Array.from(list);
    if (!all.length) return;
    setBusy(true);
    let ok = 0;
    for (const f of all) {
      try {
        await cloudApi.uploadThreadFile(threadId, {
          name: f.name,
          mime: f.type || 'application/octet-stream',
          dataBase64: await fileToBase64(f),
        });
        ok++;
      } catch {
        pushToast(`Could not add ${f.name}`, 'error');
      }
    }
    await load();
    await syncNow().catch(() => {});
    useUi.getState().bumpThread(threadId);
    if (ok) pushToast(`${ok} file${ok === 1 ? '' : 's'} added to this chat`, 'success');
    setBusy(false);
  };

  const remove = async (fileId: string) => {
    setBusy(true);
    try {
      await cloudApi.deleteThreadFile(threadId, fileId);
      await load();
      await syncNow().catch(() => {});
      useUi.getState().bumpThread(threadId);
    } catch {
      pushToast('Could not remove the file', 'error');
    }
    setBusy(false);
  };

  return (
    <Modal
      title="Chat files"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Working…' : 'Add files'}
        </Button>
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept={DOC_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = '';
        }}
      />
      <p className="text-muted" style={{ marginTop: 0 }}>
        Documents added here are searched only within this chat. The assistant can quote and answer
        from them automatically.
      </p>
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-5)' }}>
          <Spinner />
        </div>
      ) : files.length === 0 ? (
        <div className="text-muted" style={{ padding: 'var(--space-4) 0' }}>
          No files yet. Add a PDF, Word, text, or data file to ground this chat.
        </div>
      ) : (
        <ul className="thread-files">
          {files.map((f) => (
            <li key={f.fileId} className="thread-files__item">
              <Icon name="file-text" size={18} />
              <div className="thread-files__meta">
                <div className="thread-files__name" title={f.name}>
                  {f.name}
                </div>
                <div className="thread-files__sub text-muted">
                  {formatBytes(f.bytes)}
                  {f.status === 'indexing' ? ' · indexing…' : f.status === 'error' ? ' · failed' : ''}
                </div>
              </div>
              <IconButton
                name="trash"
                label={`Remove ${f.name}`}
                onClick={() => void remove(f.fileId)}
                disabled={busy}
              />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
