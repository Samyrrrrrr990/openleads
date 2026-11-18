/**
 * The prompt and the parser, shared by every model-backed provider.
 *
 * `api/intent.ts` carries its own copy because it runs in a separate bundle on
 * the edge and cannot import from `src`. That duplication is deliberate and
 * narrow: both sides speak the same command vocabulary, which is defined by
 * the command types, not by this text. If the two drift the worst case is a
 * differently-worded instruction, not a differently-shaped command — every
 * result is validated against the real project before anything is shown.
 */

import type { ElementNode } from '@zory/core';
import { EASING_NAMES, ENTRANCE_EFFECTS, NEUTRAL_THEME, findNode } from '@zory/core';
import { blockCatalogue } from './blocks';
import type { IntentContext } from './types';

/*
 * How much of the page the model is shown.
 *
 * Was 90, chosen when the free models on OpenRouter had small context windows.
 * Every model in the current list carries at least 262k tokens, and a tree
 * entry is a few dozen — so the cap was costing breadth for no reason. A model
 * that cannot see the footer cannot be asked to change the footer, and it will
 * cheerfully invent a node id instead of saying so.
 *
 * Still capped rather than unbounded: a runaway project should degrade to
 * "the model saw the top of the page" rather than to a request that never
 * returns.
 */
const MAX_TREE_NODES = 400;

export const INTENT_SYSTEM_PROMPT = buildSystemPrompt();

function buildSystemPrompt(): string {
  return `You translate a website editing request into Zory commands.

Reply with ONLY a JSON array of commands. No prose, no markdown fences.

Command shapes:
{"type":"SET_TEXT","nodeId":"<id>","text":"<string>"}
{"type":"SET_STYLE","nodeId":"<id>","breakpoint":"base"|"tablet"|"mobile","patch":{<cssProp>:<value>}}
{"type":"SET_PROP","nodeId":"<id>","patch":{"href"|"alt"|"level"|"tag":<value>}}
{"type":"INSERT_BLOCK","block":"<name>","parentId":"<id>","index":<number>,"text":"<string>"}
{"type":"DELETE_NODE","nodeId":"<id>"}
{"type":"DUPLICATE_NODE","nodeId":"<id>"}
{"type":"MOVE_NODE","nodeId":"<id>","parentId":"<id>","index":<number>}
{"type":"RENAME_NODE","nodeId":"<id>","name":"<string>"}
{"type":"SET_THEME","patch":{<token>:"<value>"}}
{"type":"SET_MOTION","nodeId":"<id>","motion":{<motion>}|null}

Theme tokens, which restyle the WHOLE project at once:
  __THEME_TOKENS__
Colours are hex strings; fonts are CSS font-family strings.

Motion, all fields optional, any of the three channels may be omitted:
{"entrance":{"trigger":"scroll"|"load","effect":__EFFECTS__,
             "duration":<ms 100-2000>,"delay":<ms 0-1500>,"easing":__EASINGS__,
             "distance":<px>,"stagger":<ms 0-300>},
 "hover":{"lift":<px>,"scale":<number>,"backgroundColor":"<hex>","color":"<hex>","duration":<ms>,"easing":<easing>},
 "press":{"scale":<number 0.9-1>}}

Blocks you can insert:
__BLOCKS__

Structure:
- To add something, use INSERT_BLOCK and name a block from the list. Never
  invent node ids — you do not create them, and any id you make up is invalid.
- To build something with structure, insert the container first and then
  insert into it using the block name as the parentId, e.g. insert "grid",
  then insert three "card" blocks with parentId "grid".
- Only containers can hold children.

Scope:
- You may change MANY elements in one reply when the request is about the page
  or a section rather than a single element. "Make this hero calmer" should
  touch the container, the heading, the body text and the button together.
- The tree lists every element on the page with its id, kind, name and parent.
  Use it to find the elements a request implies but does not name.
- Prefer coherent sets of changes: type scale, spacing rhythm and colour that
  agree with each other, rather than one property in isolation.

Reach for the widest correct tool:
- A request about the whole site's colour or typeface — "warmer", "make it
  feel like a bank", "use a serif" — is ONE SET_THEME, not a SET_STYLE on
  every element. Nodes reference the tokens, so the theme lands everywhere the
  token is used, including pages you cannot see and elements added later.
- SET_THEME and SET_STYLE combine well: set the palette with the theme, then
  adjust only the elements that need to differ from it.
- A request about how something arrives, reacts or feels to press is
  SET_MOTION, not a style. "Fade the cards in as I scroll" is one SET_MOTION
  per card, or one on their container with a stagger.
- Renaming is for the layer tree only. It changes no visible text; SET_TEXT
  does that.

Rules:
- Only use nodeIds present in the context. Never invent one.
- Style keys are camelCase CSS: fontSize, fontWeight, color, backgroundColor,
  paddingTop, marginBottom, borderRadius, textAlign, display, gap, maxWidth,
  lineHeight, letterSpacing, flexDirection, alignItems, justifyContent.
- Values are CSS strings ("24px", "#ff0044"), except opacity which is a number.
- Use breakpoint "base" unless the request names mobile or tablet.
- Prefer the fewest commands that satisfy the request — which for a
  project-wide change means one SET_THEME rather than forty SET_STYLEs.
- If the request is impossible or unclear, reply with exactly [].`
    .replace('__BLOCKS__', blockCatalogue())
    /*
     * Interpolated from the source of truth, never typed out.
     *
     * The first version of this block spelled the vocabulary by hand and got
     * it wrong in two places at once: it named easings ("standard",
     * "decelerate", "accelerate") that do not exist, and it omitted two
     * entrance effects that do. Every SET_MOTION a model produced from it
     * would have been rejected by the validator — and a rejected command is
     * indistinguishable, from the outside, from a model that answered badly.
     *
     * Reading the real lists means the prompt cannot describe a vocabulary the
     * validator will refuse. `vocabulary.test.ts` holds the line.
     */
    .replace('__THEME_TOKENS__', Object.keys(NEUTRAL_THEME).join(', '))
    .replace('__EFFECTS__', ENTRANCE_EFFECTS.map((effect) => `"${effect}"`).join('|'))
    .replace('__EASINGS__', EASING_NAMES.map((easing) => `"${easing}"`).join('|'));
}

function summarise(node: ElementNode): Record<string, unknown> {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    ...(node.text ? { text: node.text.slice(0, 160) } : {}),
    styles: node.styles,
  };
}

export function buildIntentMessages(
  context: IntentContext,
  prompt: string,
): { system: string; user: string } {
  const page =
    context.project.pages.find((candidate) => candidate.id === context.pageId) ??
    context.project.pages[0];

  const focusId = context.selectedId ?? page?.rootId ?? null;
  const focus = focusId ? findNode(context.project, focusId) : undefined;

  // Breadth-first from the root, so a cap trims depth rather than whole
  // top-level sections.
  const tree: Record<string, unknown>[] = [];
  const queue: string[] = page ? [page.rootId] : [];
  while (queue.length > 0 && tree.length < MAX_TREE_NODES) {
    const id = queue.shift()!;
    const node = findNode(context.project, id);
    if (!node) continue;
    tree.push({
      id: node.id,
      kind: node.kind,
      name: node.name,
      parentId: node.parentId,
      ...(node.text ? { text: node.text.slice(0, 80) } : {}),
    });
    queue.push(...node.children);
  }

  const user = [
    `Breakpoint being edited: ${context.breakpoint}`,
    focus ? `Focused element: ${JSON.stringify(summarise(focus))}` : '',
    tree.length > 0 ? `Page tree: ${JSON.stringify(tree)}` : '',
    `Request: ${prompt}`,
  ]
    .filter(Boolean)
    .join('\n');

  return { system: INTENT_SYSTEM_PROMPT, user };
}

/**
 * Pulls the command array out of a reply.
 *
 * Models wrap JSON in prose and fences however firmly you ask them not to, so
 * this takes the first bracketed array it can parse rather than trusting the
 * whole string to be JSON.
 */
export function extractCommands(raw: string): unknown[] | null {
  const text = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();

  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;

  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
