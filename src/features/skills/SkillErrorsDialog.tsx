import { Modal } from '../../design/overlays';
import { Button } from '../../design/ui';
import { Icon } from '../../design/icons';
import type { SkillValidationError } from '../../lib/types';

/** Shown after a 422 upload: the precise, fixable reasons a skill zip was rejected.
 *  Non-destructive — nothing was installed. */
export function SkillErrorsDialog({
  errors,
  onClose,
}: {
  errors: SkillValidationError[];
  onClose: () => void;
}) {
  return (
    <Modal
      title="This skill couldn't be added"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <p className="muted skill-errors__lead">Fix these and upload again — nothing was installed.</p>
      <ul className="skill-errors">
        {errors.map((e, i) => (
          <li key={i} className="skill-errors__item">
            <Icon name="error" size={18} className="skill-errors__icon" />
            <span>{e.message}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
