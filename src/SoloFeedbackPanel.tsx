import { useEffect, useState } from 'react';
import type { SoloFeedbackReport, MeasureObservation } from './soloFeedback.ts';
import './SoloFeedbackPanel.css';

interface SoloFeedbackProps {
  report: SoloFeedbackReport;
  onSelectNote: (id: string) => void;
  onSeekBeat: (beat: number) => void;
}

export default function SoloFeedback({ report, onSelectNote, onSeekBeat }: SoloFeedbackProps) {
  const [navigationMessage, setNavigationMessage] = useState('');
  useEffect(() => setNavigationMessage(''), [report]);
  const jump = (item: MeasureObservation) => {
    const noteId = item.focusNoteId ?? item.noteIds[0];
    if (noteId) {
      setNavigationMessage(`Opened note evidence for ${item.label}.`);
      onSelectNote(noteId);
    } else {
      onSeekBeat(item.beat);
      setNavigationMessage(`Playhead moved to bar ${item.bar} for ${item.label}.`);
    }
  };

  return (
    <section className="solo-feedback" aria-label="Solo feedback by measure">
      <div className="solo-feedback-heading">
        <p className="eyebrow">SOLO FEEDBACK</p>
        <h3>Seven measures of your solo</h3>
        <p>Each measure uses the notes or, for sax sound, reliable local microphone audio. Open a calculation or choose an observation to inspect its notes or bar.</p>
      </div>
      {navigationMessage && <p className="solo-feedback-navigation-status" role="status">{navigationMessage}</p>}
      <div className="solo-feedback-grid">
        {report.measures.map((measure) => (
          <article className={`solo-measure solo-measure--${measure.status}`} key={measure.id} aria-labelledby={`solo-${measure.id}`}>
            <div className="solo-measure-top">
              <h4 id={`solo-${measure.id}`}>{measure.title}</h4>
              <span className="solo-measure-status">{measure.status === 'available' ? 'Observed' : measure.status === 'limited' ? 'Limited evidence' : 'Unavailable'}</span>
            </div>
            <p className="solo-measure-value">{measure.value}</p>
            <p className="solo-measure-sample">{measure.sample}</p>
            <details className="solo-measure-method">
              <summary aria-label={`${measure.title}: calculation and confidence threshold`}>Calculation and confidence threshold</summary>
              <p><strong>Calculation:</strong> {measure.definition}</p>
              <p><strong>Confidence:</strong> {measure.threshold}</p>
            </details>
            {measure.observations.length > 0 && (
              <details className="solo-measure-evidence">
                <summary aria-label={`${measure.title}: ${measure.observations.length} notes and bars`}>Notes and bars <span>{measure.observations.length}</span></summary>
                <div className="solo-measure-evidence-list">
                  {measure.observations.map((item) => (
                    <button type="button" key={item.id} onClick={() => jump(item)} aria-label={`Inspect ${item.label} in ${measure.title}, bar ${item.bar}`}>
                      <span>{item.label}</span>
                      <small>{item.detail}</small>
                    </button>
                  ))}
                </div>
              </details>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
