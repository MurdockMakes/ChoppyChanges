import './CircleOfFifths.css';

export type CircleForm = 'ii-v-i' | 'blues';

export interface CircleKey {
  id: string;
  label: string;
  root: number;
}

export interface CircleOfFifthsProps {
  keys: readonly CircleKey[];
  selectedKeyId: string;
  selectedForm: CircleForm | null;
  onSelectKey: (id: string) => void;
  onSelectForm: (form: CircleForm) => void;
  disabled: boolean;
}

/** Keys are supplied in clockwise circle-of-fifths order, starting at C. */
export default function CircleOfFifths({
  keys, selectedKeyId, selectedForm, onSelectKey, onSelectForm, disabled,
}: CircleOfFifthsProps) {
  const selectedKey = keys.find((key) => key.id === selectedKeyId);

  return (
    <div className="fifths-selector" aria-label="Circle of fifths chord selector">
      <div className="fifths-dial" role="group" aria-label="Choose a key on the circle of fifths">
        <div className="fifths-dial-ring" aria-hidden="true" />
        {keys.map((key, index) => {
          const angle = -Math.PI / 2 + (index * 2 * Math.PI) / keys.length;
          const left = 50 + 40 * Math.cos(angle);
          const top = 50 + 40 * Math.sin(angle);
          const selected = key.id === selectedKeyId;
          return (
            <button
              key={key.id}
              type="button"
              className={`fifths-key${selected ? ' is-selected' : ''}`}
              style={{ left: `${left}%`, top: `${top}%` }}
              aria-label={`Choose ${key.label} major`}
              aria-pressed={selected}
              title={`${key.label} major`}
              disabled={disabled}
              onClick={() => onSelectKey(key.id)}
            >
              {key.label}
            </button>
          );
        })}
        <div className="fifths-center" aria-live="polite">
          <span>KEY</span>
          <strong>{selectedKey?.label ?? '—'}</strong>
        </div>
      </div>

      <div className="fifths-options">
        <p className="fifths-kicker">CIRCLE OF FIFTHS</p>
        <h3>Choose a key</h3>
        <p className="fifths-help">Tap a key on the ring, then choose the changes to play.</p>
        <div className="fifths-forms" role="group" aria-label="Chord change form">
          <button
            type="button"
            className={selectedForm === 'ii-v-i' ? 'is-selected' : ''}
            aria-pressed={selectedForm === 'ii-v-i'}
            disabled={disabled}
            onClick={() => onSelectForm('ii-v-i')}
          >
            <strong>ii–V–I</strong><span>4 bars</span>
          </button>
          <button
            type="button"
            className={selectedForm === 'blues' ? 'is-selected' : ''}
            aria-pressed={selectedForm === 'blues'}
            disabled={disabled}
            onClick={() => onSelectForm('blues')}
          >
            <strong>12-bar blues</strong><span>12 bars</span>
          </button>
        </div>
        {disabled && <p className="fifths-disabled-hint">Stop playback to change the chart.</p>}
      </div>
    </div>
  );
}
