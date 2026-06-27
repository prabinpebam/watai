import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Button, IconButton, InlineAlert, Spinner, Switch } from '../../design/ui';
import { Icon } from '../../design/icons';
import { Menu, ConfirmDialog, type MenuItemDef } from '../../design/overlays';
import { useSkills } from './useSkills';
import { SkillDetailDialog } from './SkillDetailDialog';
import { SkillErrorsDialog } from './SkillErrorsDialog';
import { skillsApi } from '../../data';
import { useUi } from '../../state/store';
import { formatBytes } from '../../lib/format';
import type { SkillSummary, SkillValidationError } from '../../lib/types';

const ACCEPT = '.zip,application/zip';
const MAX_BYTES = 50 * 1024 * 1024;

/** Settings → Skills. Default skills (toggle off) + the user's uploaded skills
 *  (full CRUD). Empty until the catalog API is live — no mock data. */
export function SkillsBody({ codeInterpreterOff }: { codeInterpreterOff?: boolean }) {
  const navigate = useNavigate();
  const { skills, loading, loadError, busy, uploading, load, setEnabled, upload, replace, remove } =
    useSkills();
  const pushToast = useUi((s) => s.pushToast);

  const uploadRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  const [menu, setMenu] = useState<{ x: number; y: number; skill: SkillSummary } | null>(null);
  const [detail, setDetail] = useState<SkillSummary | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SkillSummary | null>(null);
  const [errors, setErrors] = useState<SkillValidationError[] | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const defaults = skills.filter((s) => s.source === 'default');
  const userSkills = skills.filter((s) => s.source === 'user');

  const precheck = (file: File): boolean => {
    if (!/\.zip$/i.test(file.name)) {
      pushToast('Upload a .zip skill package.', 'error');
      return false;
    }
    if (file.size > MAX_BYTES) {
      pushToast(`That file is too large — the limit is ${MAX_BYTES / 1024 / 1024} MB.`, 'error');
      return false;
    }
    return true;
  };

  const doUpload = async (file: File) => {
    if (!precheck(file)) return;
    const res = await upload(file);
    if (!res.ok && res.errors) setErrors(res.errors);
  };

  const doReplace = async (id: string, file: File) => {
    if (!precheck(file)) return;
    const res = await replace(id, file);
    if (!res.ok && res.errors) setErrors(res.errors);
  };

  const onDownload = async (id: string) => {
    try {
      const { url } = await skillsApi.download(id);
      window.open(url, '_blank', 'noopener');
    } catch {
      pushToast("Couldn't download the skill.", 'error');
    }
  };

  const openMenu = (e: React.MouseEvent, skill: SkillSummary) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: r.right - 8, y: r.bottom + 4, skill });
  };

  const menuItems = (skill: SkillSummary): MenuItemDef[] => {
    const items: MenuItemDef[] = [
      { label: 'View details', icon: 'eye', onClick: () => setDetail(skill) },
    ];
    if (skill.source === 'user') {
      items.push(
        {
          label: 'Replace…',
          icon: 'refresh',
          onClick: () => {
            replaceTarget.current = skill.id;
            replaceRef.current?.click();
          },
        },
        { label: 'Download', icon: 'download', onClick: () => void onDownload(skill.id) },
        { label: 'Delete', icon: 'trash', danger: true, onClick: () => setConfirmDelete(skill) },
      );
    }
    return items;
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void doUpload(file);
  };

  return (
    <>
      <p className="muted skills-intro">
        Skills are folders of instructions and scripts the assistant loads automatically when a task
        matches — like creating or filling PDFs.
      </p>

      {codeInterpreterOff && (
        <InlineAlert tone="info" className="skills-gate">
          Skills run with Code Interpreter.{' '}
          <button type="button" className="skill-link" onClick={() => navigate('/settings/tools')}>
            Turn it on in Tools
          </button>{' '}
          to let the assistant use them.
        </InlineAlert>
      )}

      {loading && skills.length === 0 ? (
        <div className="skills-loading">
          <Spinner />
        </div>
      ) : loadError ? (
        <InlineAlert tone="danger" className="skills-gate">
          Couldn't load skills.{' '}
          <button type="button" className="skill-link" onClick={() => void load()}>
            Retry
          </button>
        </InlineAlert>
      ) : (
        <>
          {defaults.length > 0 && (
            <div className="settings-group">
              <div className="settings-group__label">Default skills</div>
              <div className="settings-card">
                {defaults.map((s) => (
                  <SkillRow
                    key={s.id}
                    skill={s}
                    busy={!!busy[s.id]}
                    onToggle={(v) => void setEnabled(s.id, v)}
                    onOpen={() => setDetail(s)}
                    onMenu={(e) => openMenu(e, s)}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="settings-group">
            <div className="skills-group-head">
              <div className="settings-group__label">Your skills</div>
              <Button
                variant="secondary"
                size="sm"
                icon="upload"
                loading={uploading}
                onClick={() => uploadRef.current?.click()}
              >
                Upload skill
              </Button>
            </div>

            <div
              className={`settings-card skill-drop${dragOver ? ' skill-drop--over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              {userSkills.length > 0 ? (
                userSkills.map((s) => (
                  <SkillRow
                    key={s.id}
                    skill={s}
                    busy={!!busy[s.id]}
                    onToggle={(v) => void setEnabled(s.id, v)}
                    onOpen={() => setDetail(s)}
                    onMenu={(e) => openMenu(e, s)}
                  />
                ))
              ) : (
                <div className="skills-empty">
                  <Avatar size="lg" variant="assistant">
                    <Icon name="puzzle" size={24} />
                  </Avatar>
                  <p className="skills-empty__text muted">
                    No custom skills yet. Upload a <code>.zip</code> in the Agent Skills format to add
                    your own.
                  </p>
                  <div className="skills-empty__actions">
                    <Button variant="secondary" icon="upload" onClick={() => uploadRef.current?.click()}>
                      Upload skill
                    </Button>
                    <a
                      className="skill-link"
                      href="https://agentskills.io/specification"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      What&apos;s a skill?
                    </a>
                  </div>
                </div>
              )}
            </div>
            {userSkills.length > 0 && (
              <p className="muted skills-foot">
                {userSkills.length} custom skill{userSkills.length === 1 ? '' : 's'} ·{' '}
                {formatBytes(userSkills.reduce((n, s) => n + (s.bytes ?? 0), 0))}
              </p>
            )}
          </div>
        </>
      )}

      <input
        ref={uploadRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void doUpload(f);
          e.target.value = '';
        }}
      />
      <input
        ref={replaceRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          const id = replaceTarget.current;
          if (f && id) void doReplace(id, f);
          e.target.value = '';
          replaceTarget.current = null;
        }}
      />

      {menu && (
        <Menu x={menu.x} y={menu.y} items={menuItems(menu.skill)} onClose={() => setMenu(null)} />
      )}
      {detail && (
        <SkillDetailDialog
          skill={detail}
          onClose={() => setDetail(null)}
          onToggle={(v) => void setEnabled(detail.id, v)}
          onReplace={() => {
            replaceTarget.current = detail.id;
            replaceRef.current?.click();
          }}
          onDownload={() => void onDownload(detail.id)}
          onDelete={() => {
            setConfirmDelete(detail);
            setDetail(null);
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${confirmDelete.name}?`}
          message="The assistant will stop using it and the uploaded files are removed."
          confirmLabel="Delete"
          danger
          onConfirm={() => void remove(confirmDelete.id)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
      {errors && <SkillErrorsDialog errors={errors} onClose={() => setErrors(null)} />}
    </>
  );
}

function SkillRow({
  skill,
  busy,
  onToggle,
  onOpen,
  onMenu,
}: {
  skill: SkillSummary;
  busy: boolean;
  onToggle: (v: boolean) => void;
  onOpen: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const invalid = skill.status === 'invalid';
  return (
    <div
      className={`setting-row skill-row${skill.enabled && !invalid ? '' : ' skill-row--off'}`}
      aria-busy={busy || undefined}
    >
      <button className="skill-row__main" onClick={onOpen}>
        <Avatar size="md" variant="assistant">
          <Icon name="puzzle" size={18} />
        </Avatar>
        <span className="setting-row__body">
          <span className="setting-row__title">{skill.name}</span>
          <span
            className={`setting-row__sub${invalid ? ' skill-row__sub--error' : ''}`}
            title={skill.description}
          >
            {invalid ? skill.error ?? 'Invalid skill' : skill.description}
          </span>
        </span>
      </button>
      {invalid ? (
        <span className="badge badge--danger">Invalid</span>
      ) : !skill.enabled ? (
        <span className="badge">Off</span>
      ) : null}
      {busy ? (
        <Spinner size="sm" />
      ) : (
        <Switch
          checked={skill.enabled}
          disabled={invalid}
          onChange={onToggle}
          label={`Enable ${skill.name}`}
        />
      )}
      <IconButton name="more" label={`More options for ${skill.name}`} onClick={onMenu} />
    </div>
  );
}
