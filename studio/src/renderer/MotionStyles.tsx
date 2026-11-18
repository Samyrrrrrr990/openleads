/**
 * Motion, running on the canvas.
 *
 * The editor does not simulate an animation — it emits the same CSS the export
 * will, against `[data-zory-id]` instead of a class name. A preview that runs
 * different code from the thing it is previewing is a preview you cannot
 * trust, and the whole argument for motion-as-data is that there is one
 * implementation.
 *
 * Replays are handled by the selector rather than by touching the DOM. Every
 * rule is prefixed with the current play generation, so bumping that number
 * changes which rules match and the browser restarts the animations for free.
 *
 * The memo is keyed on a signature of the motion itself, not on the project.
 * `run()` hands out a new project object for every command, so keying on it
 * meant a page with forty animated nodes rebuilt its entire stylesheet — and
 * had React replace the `<style>` element's text — on every frame of a drag.
 * Walking the page to build the signature is cheap; generating the CSS is not,
 * and only the second one has to happen when the motion has not changed.
 */

import { useMemo } from 'react';
import type { ElementNode, NodeMotion, Project } from '@zory/core';
import { isEmptyMotion, motionRules, reducedMotionBlock } from '@zory/core';
import { useProjectStore } from '../editor/state/projectStore';

/** Attribute the canvas sets to gate scroll-triggered entrances. */
export const PLAY_ATTRIBUTE = 'data-zory-play';

export interface MotionStylesProps {
  /** Bump to replay every entrance on the page. */
  generation: number;
  /** Only nodes reachable from this page are emitted. */
  rootId: string;
  /** Hover and press states are noise while arranging; on in preview. */
  interactive?: boolean;
  /**
   * Nodes being edited right now — the selection and whatever is under the
   * cursor. Their pointer-driven transforms are dropped so the selection
   * overlay can measure them where they actually sit.
   */
  suspendedIds?: readonly string[];
}

/**
 * The same motion with the pointer-driven transforms taken out.
 *
 * The selection overlay measures with `getBoundingClientRect()`, which reports
 * where an element *currently is*, and `ResizeObserver` never fires on a
 * transform. A node lifted 8px under the cursor therefore gets an outline
 * drawn somewhere the element is not, and nothing ever corrects it.
 *
 * Two deliberate limits on how much is removed:
 *
 * Only hover and press go. An entrance plays once and settles, so any drift it
 * causes is transient and the next remeasure fixes it — and suppressing it
 * would mean the entrance you just configured on the selected node never
 * played, which is a dead control, not a precise one.
 *
 * Within hover, only the transform goes. Colour, opacity and shadow do not
 * move the box, so a hover treatment still previews on the node being edited.
 */
function withoutPointerTransforms(motion: NodeMotion): NodeMotion {
  const { press: _press, ...rest } = motion;
  if (!motion.hover) return rest;
  const { lift: _lift, scale: _scale, ...hover } = motion.hover;
  return { ...rest, hover };
}

interface Collected {
  /** Nodes on this page that carry motion, in walk order. */
  nodes: ElementNode[];
  /**
   * Everything the generated CSS depends on, flattened to a primitive so it
   * can be a `useMemo` dependency. Child count is in here because stagger
   * writes one `:nth-child` rule per child.
   */
  signature: string;
}

/**
 * Exported for testing: the signature is the whole perf contract, and it is
 * cheaper and far more direct to assert on it than to infer it from rendering.
 */
export function collect(project: Project | null, rootId: string): Collected {
  if (!project) return { nodes: [], signature: '' };
  const out: ElementNode[] = [];
  const parts: string[] = [];
  const stack: string[] = [rootId];
  const seen = new Set<string>();

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = project.nodes[id];
    if (!node) continue;
    if (!isEmptyMotion(node.motion)) {
      out.push(node);
      parts.push(`${node.id}:${node.children.length}:${JSON.stringify(node.motion)}`);
    }
    for (const childId of node.children) stack.push(childId);
  }
  return { nodes: out, signature: parts.join(';') };
}

export function MotionStyles({
  generation,
  rootId,
  interactive = true,
  suspendedIds,
}: MotionStylesProps): React.ReactElement | null {
  const project = useProjectStore((s) => s.project);

  // Cheap enough to run on every render; the expensive half is memoised below.
  const { nodes: moving, signature } = collect(project, rootId);
  // Selection and hover change on click, not per frame, so rebuilding for them
  // is bounded in a way that depending on the project never was.
  const suspendedKey = suspendedIds ? suspendedIds.filter(Boolean).sort().join(',') : '';

  const css = useMemo(() => {
    if (moving.length === 0) return '';

    const scope = `[${PLAY_ATTRIBUTE}="${generation}"]`;
    const keyframes: Record<string, string> = {};
    const rules: string[] = [];
    const selectors: string[] = [];

    for (const node of moving) {
      const selector = `${scope} [data-zory-id="${node.id}"]`;
      selectors.push(selector);

      const suspended = suspendedKey !== '' && suspendedKey.split(',').includes(node.id);
      const motion = suspended
        ? withoutPointerTransforms(node.motion ?? {})
        : {
            ...node.motion,
            ...(interactive ? {} : { hover: undefined, press: undefined }),
          };

      const built = motionRules(motion, {
        selector,
        childCount: node.children.length,
        // On the canvas an entrance plays as soon as its generation matches,
        // so the scroll gate is satisfied by the same attribute.
        revealAttribute: 'data-zory-id',
      });

      Object.assign(keyframes, built.keyframes);
      rules.push(...built.rules);
    }

    return [
      ...Object.values(keyframes),
      ...rules,
      reducedMotionBlock(selectors),
    ].join('\n\n');
    // `moving` is derived from `signature` in the same pass, so the signature
    // covers it. Depending on the array itself would defeat the memo, since a
    // fresh array is built on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, rootId, generation, interactive, suspendedKey]);

  if (css === '') return null;
  return <style data-zory-motion="canvas">{css}</style>;
}
