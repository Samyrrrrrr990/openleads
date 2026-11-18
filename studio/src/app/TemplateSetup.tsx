/**
 * The step between picking a template and being inside it.
 *
 * Opening a starter used to go straight to the editor, which is fast and puts
 * somebody in front of a finished site for a company that does not exist. The
 * first minute after that is always the same three jobs: change the name,
 * change the colours, change the type. They are decisions the person already
 * made before they arrived, and each one lives somewhere different in the
 * editor, so the fast path was fast into the wrong place.
 *
 * So: one dialog, three choices, and a preview of the actual page rather than
 * three swatches standing in for it. The preview is the real graph rendered by
 * the real renderer — the same `personalisedProject` the Create button calls —
 * so there is no chance of it promising something the project does not do.
 *
 * Everything is optional. "Open as it is" is a first-class button rather than a
 * cancel, because somebody who just wants to look at the template should not
 * have to fill in a form to do it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flattenInstances } from '@zory/core';
import type { Starter } from '../starters';
import {
  FACE_LABEL,
  FACE_ORDER,
  PALETTES,
  PALETTE_ORDER,
  isUntouched,
  paletteSwatches,
  personalisedProject,
  type FaceId,
  type PaletteId,
  type StarterChoices,
} from '../starters/personalise';
import { StaticPage } from '../renderer/StaticPage';
import { Modal } from '../ui/Modal';
import styles from './TemplateSetup.module.css';

export interface TemplateSetupProps {
  starter: Starter;
  busy: boolean;
  onCancel: () => void;
  onCreate: (choices: StarterChoices) => void;
  /** Pre-filled business name (a site built for a lead starts with theirs). */
  initialName?: string;
}

/**
 * The width the preview lays out at before it is scaled down.
 *
 * A real desktop viewport. Laying the preview out at the pane's own width would
 * render the mobile breakpoint and present it as the desktop page.
 */
const PREVIEW_WIDTH = 1280;

export function TemplateSetup({
  starter,
  busy,
  onCancel,
  onCreate,
  initialName,
}: TemplateSetupProps): React.ReactElement {
  const [name, setName] = useState(initialName ?? '');
  const [palette, setPalette] = useState<PaletteId>('designed');
  const [face, setFace] = useState<FaceId>('designed');

  /*
   * The scale is measured rather than fixed. A constant tuned to the dialog's
   * widest layout leaves a gap at every narrower one, and the gap reads as the
   * page being narrower than it is — which is the one thing a preview must not
   * get wrong.
   */
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.45);
  const [pageHeight, setPageHeight] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;

    const measure = () => setScale(viewport.clientWidth / PREVIEW_WIDTH);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);


  const choices = useMemo<StarterChoices>(() => ({ name, palette, face }), [name, palette, face]);

  /*
   * Rebuilt on every keystroke, which sounds expensive and is not: building a
   * starter is a pure walk over a blueprint, the same one the dashboard does
   * when you click a tile. Measured on the largest template in the catalogue it
   * is well under a frame, and the alternative — patching a preview project in
   * place — is a second way of building a project, which is the one thing the
   * architecture does not allow.
   */
  const preview = useMemo(
    () => flattenInstances(personalisedProject(starter, choices)),
    [starter, choices],
  );

  /*
   * `transform` does not change layout, so the scaled page still claims its
   * full unscaled height and the scroll container would offer twice the travel
   * the picture actually needs. Measuring the page and reserving `height ×
   * scale` on a spacer is what makes the scrollbar tell the truth.
   */
  useEffect(() => {
    const page = pageRef.current;
    if (!page || typeof ResizeObserver === 'undefined') return;

    const measure = () => setPageHeight(page.offsetHeight);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(page);
    return () => observer.disconnect();
  }, [preview]);

  const submit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      onCreate(choices);
    },
    [choices, onCreate],
  );

  return (
    <Modal
      label={`Set up ${starter.name}`}
      onClose={onCancel}
      scrimClassName={styles.scrim}
      className={styles.panel}
    >
      <form className={styles.layout} onSubmit={submit}>
        <div className={styles.previewPane}>
          {/*
            * Scrollable, and every page of it.
            *
            * For half these templates the thing being judged is not on the
            * home page at all — a restaurant's menu, a clinic's fees, a
            * studio's timetable each have their own page now, which is the
            * right structure and would have made this preview a liar. A
            * preview that showed only the first page would be showing the
            * part every template has in common and hiding the part that
            * differs, which is exactly backwards for a chooser.
            *
            * The page names are captions rather than tabs on purpose: at this
            * size somebody is scanning, and a tab bar asks them to click
            * three times to find out what they could have scrolled past.
            */}
          <div className={styles.previewViewport} ref={viewportRef} tabIndex={-1}>
            <div className={styles.previewSpacer} style={{ height: pageHeight * scale }}>
              <div
                ref={pageRef}
                className={styles.previewScale}
                aria-hidden="true"
                style={{ width: PREVIEW_WIDTH, transform: `scale(${scale})` }}
              >
                {preview.pages.map((page) => (
                  <div key={page.id} className={styles.previewPage}>
                    <p className={styles.previewPageName}>
                      {page.name}
                      <span className={styles.previewPagePath}>{page.path}</span>
                    </p>
                    <StaticPage project={preview} pageId={page.id} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className={styles.form}>
          <header className={styles.head}>
            <p className={styles.kind}>{starter.kind}</p>
            <h2 className={styles.title}>{starter.name}</h2>
            <p className={styles.description}>{starter.description}</p>
          </header>

          <div className={styles.group}>
            <label className={styles.label} htmlFor="template-setup-name">
              Business name
            </label>
            <input
              id="template-setup-name"
              className={styles.input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={starter.name}
              autoComplete="organization"
              spellCheck={false}
            />
            <p className={styles.note}>
              Goes on the wordmark. The rest of the copy stays the template’s until you edit it.
            </p>
          </div>

          <fieldset className={styles.group}>
            <legend className={styles.label}>Palette</legend>
            <div className={styles.swatchRow}>
              {PALETTE_ORDER.map((id) => {
                const [ground, ink, accent] = paletteSwatches(starter, id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`${styles.swatch} ${palette === id ? styles.swatchOn : ''}`}
                    onClick={() => setPalette(id)}
                    aria-pressed={palette === id}
                    title={PALETTES[id].note}
                  >
                    <span className={styles.swatchChip} style={{ background: ground }}>
                      <span className={styles.swatchInk} style={{ background: ink }} />
                      <span className={styles.swatchAccent} style={{ background: accent }} />
                    </span>
                    <span className={styles.swatchLabel}>{PALETTES[id].label}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className={styles.group}>
            <label className={styles.label} htmlFor="template-setup-face">
              Typeface
            </label>
            <select
              id="template-setup-face"
              className={styles.select}
              value={face}
              onChange={(event) => setFace(event.target.value as FaceId)}
            >
              {FACE_ORDER.map((id) => (
                <option key={id} value={id}>
                  {FACE_LABEL[id]}
                </option>
              ))}
            </select>
          </div>

          <footer className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={busy}>
              {busy ? 'Opening…' : isUntouched(choices) ? 'Open as it is' : 'Create project'}
            </button>
            <button type="button" className={styles.ghost} onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          </footer>
        </div>
      </form>
    </Modal>
  );
}
