/**
 * Motion, in the inspector.
 *
 * Three channels, each of which can be off: how the element arrives, what it
 * does under a pointer, and what it does when pressed. That is a deliberately
 * small vocabulary — a timeline editor is a different product, and the thing
 * most pages actually need is one considered entrance and one honest hover.
 *
 * Every control writes a whole `SET_MOTION` command rather than patching a
 * field, so a change is one undo step and never lands half-applied. Dragging a
 * slider coalesces into a single step, the same way style fields do.
 *
 * ## Where the paid line falls
 *
 * `advanced-motion` is on the Pro card and was enforced nowhere, so the thing
 * a $20 subscription is partly sold on worked identically without one. It is
 * enforced now, and the split is drawn where it is because of what each part
 * costs to be without rather than what is easiest to fence off:
 *
 *   free   a load entrance and a hover. Every page needs those, and a tool
 *          that cannot do them is not a tool anybody would evaluate.
 *   pro    scroll-triggered entrances, staggered children and press response
 *          — the three that make a page feel designed rather than animated.
 *
 * A gate never removes an option that is already in use. Somebody whose
 * subscription lapsed keeps the scroll entrance they built and can still turn
 * it off; what they cannot do is add another. Deleting people's work to
 * enforce a price is not a business model.
 */

import { useCallback } from 'react';
import type { EasingName, EntranceEffect, HoverMotion, NodeMotion } from '@zory/core';
import {
  DEFAULT_ENTRANCE,
  DEFAULT_HOVER,
  DEFAULT_PRESS,
  EASING_LABEL,
  EASING_NAMES,
  ENTRANCE_EFFECTS,
  ENTRANCE_LABEL,
  MOTION_LIMITS,
  setMotion,
  usesDistance,
} from '@zory/core';
import { useProjectStore } from '../state/projectStore';
import { useResolvedNode } from '../state/useResolvedNode';
import { useUiStore } from '../state/uiStore';
import { Button, CollapsibleSection, ColorInput, Field, Segmented, Select } from '../../ui/controls';
import { UpgradeNote, useBlocked } from '../../ui/UpgradeNote';
import { PlayIcon } from '../../ui/icons';
import styles from './Inspector.module.css';

export function MotionSection({ nodeId }: { nodeId: string }): React.ReactElement | null {
  // Path-aware so motion can be read and pinned inside an instance.
  const node = useResolvedNode(nodeId);
  const replayMotion = useUiStore((s) => s.replayMotion);
  const blocked = useBlocked('advanced-motion');

  const write = useCallback(
    (motion: NodeMotion | null, options: { coalesce?: boolean; label?: string } = {}) => {
      const empty = motion && !motion.entrance && !motion.hover && !motion.press;
      useProjectStore.getState().run([setMotion(nodeId, empty ? null : motion)], {
        ...(options.label ? { label: options.label } : {}),
        coalesceKey: options.coalesce ? `SET_MOTION:${nodeId}` : null,
      });
    },
    [nodeId],
  );

  if (!node) return null;

  const motion: NodeMotion = node.motion ?? {};
  const entrance = motion.entrance;
  const hover = motion.hover;
  const press = motion.press;
  const childCount = node.children.length;

  /*
   * Grandfathering, per channel.
   *
   * A control is offered when the plan allows it *or* when this node is
   * already using it. The second half is what stops a downgrade from turning
   * an existing scroll entrance into a segmented control with no matching
   * option — a state that reads as a bug and cannot be edited back out.
   */
  const canScroll = !blocked || entrance?.trigger === 'scroll';
  const canStagger = !blocked || (entrance?.stagger ?? 0) > 0;
  const canPress = !blocked || press !== undefined;

  const triggerOptions: { value: 'off' | 'scroll' | 'load'; label: string }[] = [
    { value: 'off', label: 'Never' },
    ...(canScroll ? ([{ value: 'scroll', label: 'In view' }] as const) : []),
    { value: 'load', label: 'On load' },
  ];

  return (
    <CollapsibleSection title="Motion">
      {/* ------------------------------------------------------- entrance -- */}
      <Field label="Arrives" wide>
        <Segmented
          label="Entrance trigger"
          full
          value={entrance ? entrance.trigger : 'off'}
          onChange={(value) => {
            if (value === 'off') {
              write({ ...motion, entrance: undefined }, { label: 'Remove entrance' });
              return;
            }
            write(
              { ...motion, entrance: { ...(entrance ?? DEFAULT_ENTRANCE), trigger: value } },
              { label: 'Set entrance' },
            );
            replayMotion();
          }}
          options={triggerOptions}
        />
      </Field>

      {canScroll ? null : (
        <UpgradeNote
          feature="advanced-motion"
          title="Scroll entrances"
          body="Reveal an element the moment it comes into view, rather than everything at once on load. Exports as plain CSS and a small reveal module you own."
          compact
        />
      )}

      {entrance ? (
        <>
          <Field label="Effect" htmlFor={`${nodeId}-effect`}>
            <Select
              id={`${nodeId}-effect`}
              value={entrance.effect}
              onChange={(event) => {
                write({
                  ...motion,
                  entrance: { ...entrance, effect: event.target.value as EntranceEffect },
                });
                replayMotion();
              }}
              options={ENTRANCE_EFFECTS.map((effect) => ({
                value: effect,
                label: ENTRANCE_LABEL[effect],
              }))}
            />
          </Field>

          {usesDistance(entrance.effect) ? (
            <Slider
              label="Distance"
              suffix="px"
              min={MOTION_LIMITS.distance.min}
              max={160}
              step={2}
              value={entrance.distance ?? 24}
              onChange={(distance, done) => {
                write({ ...motion, entrance: { ...entrance, distance } }, { coalesce: !done });
                if (done) replayMotion();
              }}
            />
          ) : null}

          <Slider
            label="Duration"
            suffix="ms"
            min={100}
            max={2000}
            step={50}
            value={entrance.duration}
            onChange={(duration, done) => {
              write({ ...motion, entrance: { ...entrance, duration } }, { coalesce: !done });
              if (done) replayMotion();
            }}
          />

          <Slider
            label="Delay"
            suffix="ms"
            min={0}
            max={1500}
            step={25}
            value={entrance.delay}
            onChange={(delay, done) => {
              write({ ...motion, entrance: { ...entrance, delay } }, { coalesce: !done });
              if (done) replayMotion();
            }}
          />

          <EasingField
            id={`${nodeId}-entrance-easing`}
            value={entrance.easing}
            onChange={(easing) => {
              write({ ...motion, entrance: { ...entrance, easing } });
              replayMotion();
            }}
          />

          {childCount > 1 && canStagger ? (
            <Slider
              label="Stagger children"
              suffix="ms"
              min={0}
              max={300}
              step={10}
              value={entrance.stagger ?? 0}
              onChange={(stagger, done) => {
                write({ ...motion, entrance: { ...entrance, stagger } }, { coalesce: !done });
                if (done) replayMotion();
              }}
            />
          ) : null}

          {childCount > 1 && !canStagger ? (
            <UpgradeNote
              feature="advanced-motion"
              title="Stagger children"
              body={`Bring these ${childCount} children in one after another instead of together. It is the difference between a list appearing and a list arriving.`}
              compact
            />
          ) : null}

          <Field label="Preview" wide>
            <Button variant="outline" onClick={replayMotion} style={{ width: '100%' }}>
              <PlayIcon size={11} />
              Play again
            </Button>
          </Field>
        </>
      ) : null}

      {/* ---------------------------------------------------------- hover -- */}
      <Field label="On hover" wide>
        <Segmented
          label="Hover motion"
          full
          value={hover ? 'on' : 'off'}
          onChange={(value) =>
            write(
              { ...motion, hover: value === 'on' ? (hover ?? DEFAULT_HOVER) : undefined },
              { label: value === 'on' ? 'Add hover motion' : 'Remove hover motion' },
            )
          }
          options={[
            { value: 'off' as const, label: 'Nothing' },
            { value: 'on' as const, label: 'React' },
          ]}
        />
      </Field>

      {hover ? (
        <>
          <Slider
            label="Lift"
            suffix="px"
            min={MOTION_LIMITS.lift.min}
            max={MOTION_LIMITS.lift.max}
            step={1}
            value={hover.lift ?? 0}
            onChange={(lift, done) =>
              write({ ...motion, hover: withHover(hover, { lift }) }, { coalesce: !done })
            }
          />
          <Slider
            label="Scale"
            suffix="×"
            min={0.9}
            max={1.1}
            step={0.005}
            decimals={3}
            value={hover.scale ?? 1}
            onChange={(scale, done) =>
              write({ ...motion, hover: withHover(hover, { scale }) }, { coalesce: !done })
            }
          />
          <Field label="Background">
            <ColorInput
              value={hover.backgroundColor ?? ''}
              placeholder="unchanged"
              onChange={(value) =>
                write(
                  { ...motion, hover: withHover(hover, { backgroundColor: value || undefined }) },
                  { coalesce: true },
                )
              }
            />
          </Field>
          <Field label="Text">
            <ColorInput
              value={hover.color ?? ''}
              placeholder="unchanged"
              onChange={(value) =>
                write(
                  { ...motion, hover: withHover(hover, { color: value || undefined }) },
                  { coalesce: true },
                )
              }
            />
          </Field>
          <Slider
            label="Speed"
            suffix="ms"
            min={60}
            max={600}
            step={10}
            value={hover.duration}
            onChange={(duration, done) =>
              write({ ...motion, hover: { ...hover, duration } }, { coalesce: !done })
            }
          />
          <EasingField
            id={`${nodeId}-hover-easing`}
            value={hover.easing}
            onChange={(easing) => write({ ...motion, hover: { ...hover, easing } })}
          />
        </>
      ) : null}

      {/* ---------------------------------------------------------- press -- */}
      {canPress ? null : (
        <UpgradeNote
          feature="advanced-motion"
          title="Press response"
          body="The small give under a finger that makes a button feel like a button. One property, and the thing people notice when it is missing."
          compact
        />
      )}

      {canPress ? (
        <>
      <Field label="On press" wide>
        <Segmented
          label="Press motion"
          full
          value={press ? 'on' : 'off'}
          onChange={(value) =>
            write(
              { ...motion, press: value === 'on' ? (press ?? DEFAULT_PRESS) : undefined },
              { label: value === 'on' ? 'Add press motion' : 'Remove press motion' },
            )
          }
          options={[
            { value: 'off' as const, label: 'Nothing' },
            { value: 'on' as const, label: 'Give' },
          ]}
        />
      </Field>

      {press ? (
        <Slider
          label="Press scale"
          suffix="×"
          min={0.9}
          max={1}
          step={0.005}
          decimals={3}
          value={press.scale}
          onChange={(scale, done) => write({ ...motion, press: { scale } }, { coalesce: !done })}
        />
      ) : null}
        </>
      ) : null}

      <p className={styles.emptyBody} style={{ maxWidth: 'none', marginTop: 4 }}>
        Motion exports as plain CSS. Scroll entrances also emit a small reveal
        module in the project — ordinary code you own and can delete.
      </p>
    </CollapsibleSection>
  );
}

/** Drops a key when its value is `undefined`, so an empty hover stays empty. */
function withHover(hover: HoverMotion, patch: Partial<HoverMotion>): HoverMotion {
  const next: HoverMotion = { ...hover, ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete (next as unknown as Record<string, unknown>)[key];
  }
  // A lift or scale set back to its neutral value is an absence, not a value.
  if (next.lift === 0) delete next.lift;
  if (next.scale === 1) delete next.scale;
  return next;
}

function EasingField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: EasingName;
  onChange: (easing: EasingName) => void;
}): React.ReactElement {
  return (
    <Field label="Easing" htmlFor={id}>
      <Select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as EasingName)}
        options={EASING_NAMES.map((name) => ({ value: name, label: EASING_LABEL[name] }))}
      />
    </Field>
  );
}

/**
 * A range plus its number.
 *
 * `onChange` fires continuously with `done: false` while dragging so the
 * canvas updates live, then once with `done: true` on release — which is what
 * closes the coalesced undo step and replays the entrance.
 */
function Slider({
  label,
  suffix,
  min,
  max,
  step,
  value,
  decimals = 0,
  onChange,
}: {
  label: string;
  suffix: string;
  min: number;
  max: number;
  step: number;
  value: number;
  decimals?: number;
  onChange: (value: number, done: boolean) => void;
}): React.ReactElement {
  return (
    <Field label={label}>
      <div className={styles.sliderRow}>
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          className={styles.slider}
          onChange={(event) => onChange(Number(event.target.value), false)}
          onPointerUp={(event) => onChange(Number(event.currentTarget.value), true)}
          onKeyUp={(event) => onChange(Number(event.currentTarget.value), true)}
        />
        <span className={styles.sliderValue}>
          {value.toFixed(decimals)}
          {suffix}
        </span>
      </div>
    </Field>
  );
}
