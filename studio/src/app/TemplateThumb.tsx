/**
 * The tile.
 *
 * Draws the bands `core/library/preview.ts` derived, in the template's own
 * colours. Everything here is proportional and inert: no text is rendered at
 * thumbnail size because at 40px tall it is noise, and no styles from the
 * project are read because a thumbnail that tries to be a renderer becomes a
 * second renderer that disagrees with the first.
 */

import { memo } from 'react';
import type { Band } from '../core/library/preview';
import styles from './TemplateThumb.module.css';

export interface TemplateThumbProps {
  bands: Band[];
  /** background, text, accent — in the order `TemplateSummary.swatches` holds. */
  swatches: string[];
  surface: string;
  border: string;
  /** The template name, drawn once in the hero band where a title would go. */
  name: string;
}

function times(count: number): number[] {
  return Array.from({ length: Math.max(1, Math.min(4, count)) }, (_, index) => index);
}

function Band({
  band,
  ink,
  accent,
  surface,
  border,
  name,
  showName,
}: {
  band: Band;
  ink: string;
  accent: string;
  surface: string;
  border: string;
  name: string;
  showName: boolean;
}): React.ReactElement {
  switch (band.kind) {
    case 'nav':
      return (
        <div className={styles.nav} style={{ borderColor: border }}>
          <span className={styles.mark} style={{ background: accent }} />
          <span className={styles.navLinks}>
            {times(band.count).map((index) => (
              <span key={index} className={styles.navLink} style={{ background: ink }} />
            ))}
          </span>
        </div>
      );

    case 'hero':
      return (
        <div className={styles.hero}>
          {showName ? (
            <span className={styles.heroTitle} style={{ color: ink }}>
              {name}
            </span>
          ) : (
            <span className={styles.heroBar} style={{ background: ink }} />
          )}
          <span className={styles.heroLine} style={{ background: ink }} />
          <span className={styles.heroButton} style={{ background: accent }} />
        </div>
      );

    case 'grid':
      return (
        <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${band.count}, 1fr)` }}>
          {times(band.count).map((index) => (
            <span
              key={index}
              className={styles.cell}
              style={{ background: surface, borderColor: border }}
            />
          ))}
        </div>
      );

    case 'rows':
      return (
        <div className={styles.rows}>
          {times(band.count).map((index) => (
            <span key={index} className={styles.row} style={{ borderColor: border }}>
              <span className={styles.rowLine} style={{ background: ink }} />
            </span>
          ))}
        </div>
      );

    case 'media':
      return (
        <div className={styles.media}>
          {times(band.count).map((index) => (
            <span
              key={index}
              className={styles.frame}
              style={{ background: surface, borderColor: border }}
            />
          ))}
        </div>
      );

    case 'footer':
      return (
        <div className={styles.footer} style={{ borderColor: border }}>
          {times(band.count).map((index) => (
            <span key={index} className={styles.footLink} style={{ background: ink }} />
          ))}
        </div>
      );

    default:
      return (
        <div className={styles.band}>
          <span className={styles.bandLine} style={{ background: ink, width: '62%' }} />
          <span className={styles.bandLine} style={{ background: ink, width: '38%' }} />
        </div>
      );
  }
}

export const TemplateThumb = memo(function TemplateThumb({
  bands,
  swatches,
  surface,
  border,
  name,
}: TemplateThumbProps): React.ReactElement {
  const background = swatches[0] ?? '#111';
  const ink = swatches[1] ?? '#fff';
  const accent = swatches[2] ?? ink;

  /*
   * The name goes in the first hero, not in the first band.
   *
   * A template whose page opens with a nav would otherwise put its title into
   * the nav bar, where no title has ever been.
   */
  const heroAt = bands.findIndex((band) => band.kind === 'hero');

  return (
    <div className={styles.thumb} style={{ background }} aria-hidden="true">
      {bands.length === 0 ? (
        <div className={styles.hero}>
          <span className={styles.heroTitle} style={{ color: ink }}>
            {name}
          </span>
        </div>
      ) : (
        bands.map((band, index) => (
          <Band
            key={`${band.kind}-${index}`}
            band={band}
            ink={ink}
            accent={accent}
            surface={surface}
            border={border}
            name={name}
            showName={index === heroAt}
          />
        ))
      )}
    </div>
  );
});
