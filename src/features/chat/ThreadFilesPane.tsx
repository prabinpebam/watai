import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton, Spinner } from '../../design/ui';
import { Icon } from '../../design/icons';
import { repo, cloudApi, syncNow } from '../../data';
import { useUi } from '../../state/store';
import { useIsExpanded } from '../../lib/hooks';
import { fileToBase64, formatBytes, DOC_ACCEPT } from '../../lib/files';
import { AttachmentList } from './Attachments';
import type { Attachment, ThreadFile } from '../../lib/types';

/**
 * Right-docked (desktop) / slide-over (compact) panel showing a chat's files: documents uploaded
 * into its knowledge base (searchable via file search) and images the assistant generated. Mirrors
 * SourcePane. Uploads/deletes go through the server (the AI key lives in the vault); the list is the
 * thread's synced file record, refreshed from the authoritative server list when online.
 */
export function ThreadFilesPane() {
  const threadId = useUi((s) => s.filesPane);
  const close = useUi((s) => s.closeFilesPane);
  const expanded = useIsExpanded();
  const pushToast = useUi((s) => s.pushToast);
  const [files, setFiles] = useState<ThreadFile[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const threadRev = useUi((s) => s.threadRev[threadId ?? ''] ?? 0);

  const load = async (tid: string) => {
    const local = (await repo.getThread(tid).catch(() => null))?.files;
    if (local) setFiles(local);
    try {
      setFiles(await cloudApi.listThreadFiles(tid));
    } catch {
      /* offline / not signed in — keep the synced local list */
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!threadId) return;
    setLoading(true);
    void load(threadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // User-uploaded attachments live on the messages (not thread.files); gather them so they are
  // visible here too. Re-reads when the thread revises (a new prompt with files lands).
  useEffect(() => {
    if (!threadId) return;
    let live = true;
    repo
      .listMessages(threadId)
      .then((msgs) => live && setAttachments(msgs.flatMap((m) => m.attachments ?? [])))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [threadId, threadRev]);

  useEffect(() => {
    if (!threadId) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [threadId, close]);

  if (!threadId) return null;

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
    await load(threadId);
    await syncNow().catch(() => {});
    useUi.getState().bumpThread(threadId);
    if (ok) pushToast(`${ok} file${ok === 1 ? '' : 's'} added to this chat`, 'success');
    setBusy(false);
  };

  const remove = async (fileId: string) => {
    setBusy(true);
    try {
      await cloudApi.deleteThreadFile(threadId, fileId);
      await load(threadId);
      await syncNow().catch(() => {});
      useUi.getState().bumpThread(threadId);
    } catch {
      pushToast('Could not remove the file', 'error');
    }
    setBusy(false);
  };

  const docs = files.filter((f) => (f.kind ?? 'document') === 'document');
  const imgs = files.filter((f) => f.kind === 'image');
  const artifacts = files.filter((f) => f.kind === 'artifact');
  const total = files.length + attachments.length;

  const aside = (
    <aside className={`source-pane ${expanded ? '' : 'source-pane--overlay'}`} aria-label="Chat files">
      <header className="source-pane__head">
        <Icon name="file-text" size={16} />
        <span className="source-pane__title">Chat files</span>
        <span className="source-pane__count">{total}</span>
        <IconButton name="close" label="Close files" onClick={close} />
      </header>
      <div className="source-pane__list">
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
        <Button
          variant="secondary"
          full
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <Icon name="plus" size={16} /> {busy ? 'Working…' : 'Add files'}
        </Button>
        <p className="muted files-pane__hint">
          Documents are searched only within this chat. Images and files the assistant creates are
          saved here automatically.
        </p>
        {loading && total === 0 ? (
          <div className="files-pane__loading">
            <Spinner />
          </div>
        ) : total === 0 ? (
          <p className="muted source-pane__empty">
            No files yet. Add a PDF, Word, text, or data file to ground this chat.
          </p>
        ) : (
          <>
            {docs.map((f) => (
              <div key={f.fileId} className="thread-files__item">
                <Icon name="file-text" size={18} />
                <div className="thread-files__meta">
                  <div className="thread-files__name" title={f.name}>
                    {f.name}
                  </div>
                  <div className="thread-files__sub muted">
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
              </div>
            ))}
            {imgs.length > 0 && (
              <div className="files-pane__images">
                {imgs.map((f) => (
                  <FileThumb key={f.fileId} file={f} />
                ))}
              </div>
            )}
            {artifacts.length > 0 && (
              <>
                <div className="files-pane__section muted">Generated files</div>
                {artifacts.map((f) => (
                  <ArtifactRow key={f.fileId} file={f} />
                ))}
              </>
            )}
            {attachments.length > 0 && (
              <>
                <div className="files-pane__section muted">Shared in chat</div>
                <AttachmentList attachments={attachments} />
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );

  if (expanded) return aside;
  return createPortal(
    <>
      <div className="drawer-scrim" onClick={close} />
      {aside}
    </>,
    document.body,
  );
}

/** A generated-image tile; resolves the blob to a URL (local cache, else cloud read SAS). */
function FileThumb({ file }: { file: ThreadFile }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    repo
      .resolveAssetUrl({ id: file.fileId, blobPath: file.blobPath })
      .then((u) => live && setUrl(u || null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [file.fileId, file.blobPath]);
  if (!url) {
    return (
      <div className="files-pane__thumb files-pane__thumb--loading">
        <Spinner size="sm" />
      </div>
    );
  }
  return (
    <a
      className="files-pane__thumb"
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={file.name}
    >
      <img src={url} alt={file.name} loading="lazy" />
    </a>
  );
}

function iconForArtifact(mime = '', name = ''): string {
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'file-pdf';
  if (/zip|tar|compressed/.test(mime) || /\.(zip|tar)$/.test(name)) return 'file-zip';
  if (mime.includes('spreadsheet') || /\.(xlsx|csv)$/.test(name) || mime === 'text/csv') return 'file-csv';
  if (mime.startsWith('image/')) return 'file-image';
  if (/json|xml|html|code/.test(mime) || /\.(json|js|ts|py|html|css)$/.test(name)) return 'file-code';
  if (mime.startsWith('text/') || mime.includes('word') || mime.includes('presentation')) return 'file-text';
  return 'file';
}

/** A generated, downloadable artifact row; resolves the blob to a URL (local cache, else read SAS). */
function ArtifactRow({ file }: { file: ThreadFile }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    repo
      .resolveAssetUrl({ id: file.fileId, blobPath: file.blobPath })
      .then((u) => live && setUrl(u || null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [file.fileId, file.blobPath]);

  const download = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="thread-files__item">
      <Icon name={iconForArtifact(file.mime, file.name)} size={18} />
      <div className="thread-files__meta">
        <div className="thread-files__name" title={file.name}>
          {file.name}
        </div>
        <div className="thread-files__sub muted">{formatBytes(file.bytes)}</div>
      </div>
      <IconButton name="download" label={`Download ${file.name}`} onClick={download} disabled={!url} />
    </div>
  );
}

