import { useEffect, useState } from 'react';
import { Modal } from '../../design/overlays';
import { Button, Spinner, Switch } from '../../design/ui';
import { Icon } from '../../design/icons';
import { skillsApi } from '../../data';
import { formatBytes } from '../../lib/format';
import type { SkillDetail, SkillSummary } from '../../lib/types';

/** Read-only preview of a skill: frontmatter, the bundled file tree, and the
 *  SKILL.md body. User skills also expose Replace / Download / Delete. There is no
 *  in-app editing — authoring lives in the zip, so "edit" means replace. */
export function SkillDetailDialog({
  skill,
  onClose,
  onToggle,
  onReplace,
  onDownload,
  onDelete,
}: {
  skill: SkillSummary;
  onClose: () => void;
  onToggle: (enabled: boolean) => void;
  onReplace: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [error, setError] = useState(false);
  const isUser = skill.source === 'user';

  useEffect(() => {
    let live = true;
    setDetail(null);
    setError(false);
    skillsApi
      .get(skill.id)
      .then((d) => live && setDetail(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [skill.id]);

  return (
    <Modal
      title={skill.name}
      onClose={onClose}
      footer={
        isUser ? (
          <>
            <Button variant="ghost" icon="download" onClick={onDownload}>
              Download
            </Button>
            <Button variant="ghost" icon="refresh" onClick={onReplace}>
              Replace
            </Button>
            <Button variant="danger" icon="trash" onClick={onDelete}>
              Delete
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="skill-detail">
        <div className="skill-detail__head">
          <span className={`badge ${isUser ? '' : 'badge--accent'}`}>{isUser ? 'Uploaded' : 'Default'}</span>
          {detail?.version != null && <span className="muted">v{detail.version}</span>}
          <span className="skill-detail__spacer" />
          <Switch
            checked={skill.enabled}
            disabled={skill.status === 'invalid'}
            onChange={onToggle}
            label={`Enable ${skill.name}`}
          />
        </div>

        <p className="skill-detail__desc">{skill.description}</p>
        {detail?.license && <p className="muted skill-detail__license">License: {detail.license}</p>}

        {error ? (
          <p className="muted">Couldn't load the skill's contents.</p>
        ) : !detail ? (
          <div className="skill-detail__loading">
            <Spinner />
          </div>
        ) : (
          <>
            <div className="skill-detail__section-label">Files</div>
            <ul className="skill-files">
              {detail.files.map((f) => (
                <li key={f.path} className="skill-files__item">
                  <Icon name="file" size={16} className="muted" />
                  <span className="skill-files__path">{f.path}</span>
                  <span className="skill-files__size muted">{formatBytes(f.bytes)}</span>
                </li>
              ))}
            </ul>

            <div className="skill-detail__section-label">SKILL.md</div>
            <pre className="skill-detail__body">{detail.body}</pre>
          </>
        )}
      </div>
    </Modal>
  );
}
