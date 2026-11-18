/**
 * Export: project graph → a standalone React + TypeScript + Vite source tree.
 *
 * The output has no dependency on Zory. It is an ordinary Vite app that a
 * developer can open, read, edit and deploy, and nothing in it hints that a
 * generator produced it beyond a single line in the README.
 *
 * Shape of the output:
 *
 *   src/pages/Home.tsx          composes the sections
 *   src/components/Hero.tsx     one file per top-level section
 *   src/components/Hero.module.css
 *   src/assets/…                images written as real binary files
 *
 * Splitting sections into their own files is what keeps the result editable —
 * a single 900-line component would technically build and be useless.
 */

import type { IntegrationValues } from '../integrations/store';
import { buildEnvFiles, envReadmeSection } from './envFiles';
import { authDependencies, authReadmeSection, buildAuthFiles, detectAuthProvider } from './authFiles';
import type { AssetNode, Breakpoint, ElementNode, PageNode, Project, StyleProps } from '@zory/core';
import { BREAKPOINTS, flattenInstances, isEmptyMotion } from '@zory/core';
import { buildStylesheet, globalCss } from './css';
import { REVEAL_ATTRIBUTE, REVEAL_TS, motionCssFor, nodeNeedsReveal } from './motion';
import { NameRegistry, toCamelCase, toKebabCase, toPascalCase } from './names';
import { ASSET_PREFIX } from '../../renderer/resolve';

export interface ExportedFile {
  path: string;
  /** Text content, or binary for decoded assets. */
  content: string | Uint8Array;
}

export interface ExportResult {
  files: ExportedFile[];
  /** Suggested archive name, without extension. */
  slug: string;
  warnings: string[];
}

// ------------------------------------------------------------------ JSX ----

/** Text safe to write directly into JSX without an expression container. */
function isPlainJsxText(text: string): boolean {
  return (
    !/[{}<>]/.test(text) &&
    text.trim() === text &&
    text !== '' &&
    !text.includes('\n')
  );
}

function jsxText(text: string): string {
  return isPlainJsxText(text) ? text : `{${JSON.stringify(text)}}`;
}

function attribute(name: string, value: string): string {
  return `${name}=${JSON.stringify(value)}`;
}

const VOID_TAGS = new Set(['img', 'hr', 'br', 'input']);

// ------------------------------------------------------------ generation ---

interface ComponentPlan {
  /** Component name, e.g. `Hero`. */
  name: string;
  /** File base name, e.g. `Hero`. */
  file: string;
  rootId: string;
}

interface AssetPlan {
  /** `assets/hero-photo.png` relative to `src`. */
  path: string;
  /** Identifier used for the ES import. */
  identifier: string;
  bytes: Uint8Array;
}

/**
 * Connected services are passed in rather than read from storage, so this stays
 * a pure function of its inputs — the export tests can exercise the wiring
 * without a browser, and nothing here can reach into localStorage.
 */
export interface GenerateOptions {
  /*
   * Write a node id above each CSS rule so edits can be read back in.
   *
   * Off by default, and deliberately so. A downloadable export must contain no
   * trace of Zory — "delete every mention of Zory and it still runs" is the
   * promise this product is sold on, and a marker comment in every rule would
   * quietly break it. Markers are only written into a linked workspace folder,
   * which is a folder the user pointed Zory at on purpose and where the round
   * trip is the entire point.
   */
  markers?: boolean;
}

export function generateExport(
  source: Project,
  integrations: IntegrationValues = {},
  options: GenerateOptions = {},
): ExportResult {
  /*
   * Instances are resolved into ordinary nodes before anything else runs.
   *
   * A reference to a definition is the right shape for editing and the wrong
   * shape for generating a standalone project: the exported code must not need
   * Zory's resolution rules to make sense of itself. Everything below can then
   * assume the graph it was always written for.
   *
   * The cost is that two instances of one definition export as two subtrees
   * rather than two uses of one component. Correct, readable, and not yet as
   * DRY as a human would write by hand.
   */
  const project = flattenInstances(source);
  const markers = options.markers === true;
  const warnings: string[] = [];
  const files: ExportedFile[] = [];
  const slug = toKebabCase(project.name, 'zory-site') || 'zory-site';

  const assets = planAssets(project, warnings);
  /** Set when any node anywhere waits for the viewport before it animates. */
  let usesReveal = false;

  /*
   * ---- Pages and their section components ----
   *
   * One registry for both, and pages minted first.
   *
   * They used to have a registry each, which meant a page called Contact and a
   * section called Contact both took the identifier `Contact` — and the page
   * imports its own sections, so `Contact.tsx` did
   * `import { Contact } from '../components/Contact'` next to
   * `export function Contact()` and would not compile. It went unnoticed while
   * every template was a single page called Home, and broke ten of them the
   * day the templates grew a Contact page. `npm run verify:export` is what
   * caught it, which is the whole reason that script builds rather than just
   * generating.
   *
   * Pages go first because a page's name is the one a person chose and the one
   * that shows up in a URL. A section that collides gets the suffix.
   */
  const names = new NameRegistry(['App', 'Main']);

  const pagePlans = project.pages.map((page) => ({
    page,
    componentName: names.take(toPascalCase(page.name, 'Page')),
  }));

  const plans = pagePlans.map(({ page, componentName }) => {
    const root = project.nodes[page.rootId];
    const sections: ComponentPlan[] = [];

    for (const childId of root?.children ?? []) {
      const child = project.nodes[childId];
      // Only containers with content earn their own file; a lone divider does not.
      if (!child || child.kind !== 'container' || child.children.length === 0) continue;
      const name = names.take(toPascalCase(child.name, 'Section'));
      sections.push({ name, file: name, rootId: childId });
    }

    return { page, componentName, sections };
  });

  for (const { page, componentName, sections } of plans) {
    const sectionIds = new Set(sections.map((section) => section.rootId));

    const pageFiles = renderPageFiles(
      project,
      page,
      componentName,
      sections,
      sectionIds,
      assets,
      markers,
    );
    files.push(...pageFiles.files);
    usesReveal ||= pageFiles.usesReveal;

    for (const section of sections) {
      const sectionFiles = renderComponentFiles(project, section, assets, markers);
      files.push(...sectionFiles.files);
      usesReveal ||= sectionFiles.usesReveal;
    }
  }

  // ---- Assets as real files ----
  for (const asset of assets.values()) {
    files.push({ path: `src/${asset.path}`, content: asset.bytes });
  }

  /*
   * ---- Scaffolding ----
   *
   * The names the registry actually minted, not a second guess at them.
   *
   * This recomputed each page's component name from scratch, so two pages with
   * the same name — a Visit page in two languages, a Work page added twice —
   * produced one identifier here and two distinct ones above, and `App.tsx`
   * imported the same name from two files.
   */
  const pageComponents = plans.map(({ page, componentName }) => ({
    page,
    component: componentName,
  }));

  /*
   * Authentication, when the user has connected a provider.
   *
   * Generated against their own Supabase or Firebase keys, so the exported app
   * owns its users outright and Zory is not in the request path.
   */
  const authProvider = detectAuthProvider(integrations);
  files.push(...buildAuthFiles(authProvider));
  files.push(...buildEnvFiles(integrations));

  files.push(
    { path: 'package.json', content: packageJson(slug, authDependencies(authProvider)) },
    { path: 'tsconfig.json', content: TSCONFIG },
    { path: 'vite.config.ts', content: VITE_CONFIG },
    { path: 'index.html', content: indexHtml(project) },
    // `.env` holds real credentials, so it must never be committed.
    { path: '.gitignore', content: 'node_modules\ndist\n.DS_Store\n*.local\n.env\n' },
    {
      path: 'README.md',
      content:
        readme(project, slug, pageComponents) +
        authReadmeSection(authProvider) +
        envReadmeSection(integrations),
    },
    { path: 'src/main.tsx', content: MAIN_TSX },
    { path: 'src/App.tsx', content: appTsx(pageComponents, usesReveal) },
    { path: 'src/styles/global.css', content: globalCss(project.settings.theme) },
    { path: 'src/vite-env.d.ts', content: '/// <reference types="vite/client" />\n' },
  );

  // Only written when something on the page actually waits for the viewport.
  if (usesReveal) files.push({ path: 'src/lib/reveal.ts', content: REVEAL_TS });

  return { files, slug, warnings };
}

// ------------------------------------------------------------- rendering ---

interface RenderScope {
  project: Project;
  /** Node id → CSS module class name. */
  classNames: Map<string, string>;
  /** Node ids that render as a child component rather than inline. */
  boundaries: Map<string, string>;
  assets: Map<string, AssetPlan>;
  usedAssets: Set<string>;
  /*
   * Write a node id above each element that carries text.
   *
   * Same rule as the stylesheet: only ever into a linked workspace folder,
   * never into a downloadable export, because "delete every mention of Zory
   * and it still runs" has to stay literally true.
   */
  markers: boolean;
}

function collectStyleRules(
  project: Project,
  rootId: string,
  boundaries: Set<string>,
): { ids: string[]; classNames: Map<string, string> } {
  const registry = new NameRegistry();
  const classNames = new Map<string, string>();
  const ids: string[] = [];

  const walk = (id: string, isRoot: boolean): void => {
    const node = project.nodes[id];
    if (!node) return;
    if (!isRoot && boundaries.has(id)) return;

    const hasStyles = BREAKPOINTS.some(
      (bp) => Object.keys(node.styles[bp] ?? {}).length > 0,
    );
    // Motion needs a selector to hang on even when the node declares no
    // styles of its own — a bare <ul> that staggers its children, say.
    if (hasStyles || !isEmptyMotion(node.motion)) {
      classNames.set(id, registry.take(toCamelCase(node.name, 'element')));
      ids.push(id);
    }

    for (const childId of node.children) walk(childId, false);
  };

  walk(rootId, true);
  return { ids, classNames };
}

function stylesFor(node: ElementNode): Partial<Record<Breakpoint, StyleProps>> {
  const out: Partial<Record<Breakpoint, StyleProps>> = {};
  for (const bp of BREAKPOINTS) {
    const styles = node.styles[bp];
    if (styles && Object.keys(styles).length > 0) out[bp] = styles;
  }
  return out;
}

function renderNode(scope: RenderScope, id: string, depth: number, isRoot: boolean): string {
  const pad = '  '.repeat(depth);
  const node = scope.project.nodes[id];
  if (!node) return '';

  // A boundary node renders as its own component.
  if (!isRoot) {
    const component = scope.boundaries.get(id);
    if (component) return `${pad}<${component} />`;
  }

  const className = scope.classNames.get(id);
  const attrs: string[] = [];
  if (className) attrs.push(`className={styles.${className}}`);
  // Marks the element for the reveal observer. A plain data attribute, so
  // deleting reveal.ts leaves valid markup rather than a broken import.
  if (nodeNeedsReveal(node)) attrs.push(REVEAL_ATTRIBUTE);
  // The author's own `id`, which is what an in-page `#anchor` link resolves
  // against. Validated to a legal id before it could ever get here.
  if (node.props.anchor) attrs.push(attribute('id', node.props.anchor));

  let tag: string;
  switch (node.kind) {
    case 'container':
      tag = node.props.tag ?? 'div';
      break;
    case 'heading':
      tag = `h${node.props.level ?? 2}`;
      break;
    case 'text':
      tag = 'p';
      break;
    case 'button':
      tag = 'button';
      attrs.push('type="button"');
      break;
    case 'link':
      tag = 'a';
      attrs.push(attribute('href', node.props.href ?? '#'));
      if (node.props.target === '_blank') {
        attrs.push('target="_blank"', 'rel="noopener noreferrer"');
      }
      break;
    case 'image': {
      tag = 'img';
      const src = node.props.src ?? '';
      if (src.startsWith(ASSET_PREFIX)) {
        const asset = scope.assets.get(src.slice(ASSET_PREFIX.length));
        if (asset) {
          scope.usedAssets.add(asset.identifier);
          attrs.push(`src={${asset.identifier}}`);
        }
        // An asset the project no longer has: fall through and emit no src,
        // for the reason below.
      } else if (src) {
        attrs.push(attribute('src', src));
      }
      /*
       * No `src` attribute at all when there is nothing to point at.
       *
       * `src=""` resolves against the current document, so a browser fetches
       * the whole page again for every placeholder — a template with nine
       * empty plates ships nine redundant requests to whoever exports it.
       * With no attribute the browser requests nothing and shows the alt
       * text, which is what a placeholder should look like, and the person
       * filling it in has one obvious thing to add.
       */
      attrs.push(attribute('alt', node.props.alt ?? ''));
      break;
    }
    case 'divider':
      tag = 'hr';
      break;
    case 'instance':
      /*
       * Reached only if instances become insertable before the generator
       * learns to emit a definition as a real React component. Throwing beats
       * falling through to a `div`, which would export markup that silently
       * lost the instance's content.
       */
      throw new Error('Zory export: instances are not supported by this build yet');
    default: {
      const exhaustive: never = node.kind;
      throw new Error(`Zory export: unknown node kind ${String(exhaustive)}`);
    }
  }

  const attrString = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';

  if (VOID_TAGS.has(tag)) return `${pad}<${tag}${attrString} />`;

  const children = node.children.map((childId) => renderNode(scope, childId, depth + 1, false)).filter(Boolean);
  const text = node.text?.trim() ? node.text : '';

  if (children.length === 0 && text === '') return `${pad}<${tag}${attrString} />`;

  /*
   * Only text-bearing elements are marked. A marker on a wrapper would be
   * noise: text is the only thing read back from this file, so anything else
   * would be a comment nobody can act on.
   */
  const marker = scope.markers && text !== '' ? `${pad}{/* zory:${id} */}\n` : '';

  if (children.length === 0) {
    const inline = jsxText(text);
    // Keep short text on one line; wrap longer copy so the source stays readable.
    if (inline.length + attrString.length + tag.length + pad.length < 96) {
      return `${marker}${pad}<${tag}${attrString}>${inline}</${tag}>`;
    }
    return `${marker}${pad}<${tag}${attrString}>\n${pad}  ${inline}\n${pad}</${tag}>`;
  }

  const inner = [text ? `${pad}  ${jsxText(text)}` : '', ...children].filter(Boolean).join('\n');
  return `${marker}${pad}<${tag}${attrString}>\n${inner}\n${pad}</${tag}>`;
}

function renderPageFiles(
  project: Project,
  page: PageNode,
  componentName: string,
  sections: ComponentPlan[],
  sectionIds: Set<string>,
  assets: Map<string, AssetPlan>,
  markers: boolean,
): { files: ExportedFile[]; usesReveal: boolean } {
  const { ids, classNames } = collectStyleRules(project, page.rootId, sectionIds);
  const boundaries = new Map(sections.map((section) => [section.rootId, section.name]));
  const usedAssets = new Set<string>();

  const body = renderNode(
    { project, classNames, boundaries, assets, usedAssets, markers },
    page.rootId,
    2,
    true,
  );

  const imports = [
    ...sections.map((section) => `import { ${section.name} } from '../components/${section.file}';`),
    ...assetImports(assets, usedAssets),
    `import styles from './${componentName}.module.css';`,
  ];

  const tsx = `${imports.join('\n')}

export function ${componentName}() {
  return (
${body}
  );
}
`;

  const motion = motionCssFor(project, ids, classNames);

  const css =
    buildStylesheet(
      ids.map((id) => ({
        className: classNames.get(id)!,
        ...(markers ? { nodeId: id } : {}),
        byBreakpoint: stylesFor(project.nodes[id]!),
      })),
      project.settings.breakpoints,
      `${page.name} page`,
    ) + motion.css;

  return {
    files: [
      { path: `src/pages/${componentName}.tsx`, content: tsx },
      { path: `src/pages/${componentName}.module.css`, content: css },
    ],
    usesReveal: motion.usesReveal,
  };
}

function renderComponentFiles(
  project: Project,
  plan: ComponentPlan,
  assets: Map<string, AssetPlan>,
  markers: boolean,
): { files: ExportedFile[]; usesReveal: boolean } {
  const { ids, classNames } = collectStyleRules(project, plan.rootId, new Set());
  const usedAssets = new Set<string>();

  const body = renderNode(
    { project, classNames, boundaries: new Map(), assets, usedAssets, markers },
    plan.rootId,
    2,
    true,
  );

  const imports = [
    ...assetImports(assets, usedAssets, '../'),
    `import styles from './${plan.file}.module.css';`,
  ];

  const tsx = `${imports.join('\n')}

export function ${plan.name}() {
  return (
${body}
  );
}
`;

  const motion = motionCssFor(project, ids, classNames);

  const css =
    buildStylesheet(
      ids.map((id) => ({
        className: classNames.get(id)!,
        ...(markers ? { nodeId: id } : {}),
        byBreakpoint: stylesFor(project.nodes[id]!),
      })),
      project.settings.breakpoints,
      `${plan.name} section`,
    ) + motion.css;

  return {
    files: [
      { path: `src/components/${plan.file}.tsx`, content: tsx },
      { path: `src/components/${plan.file}.module.css`, content: css },
    ],
    usesReveal: motion.usesReveal,
  };
}

function assetImports(
  assets: Map<string, AssetPlan>,
  used: Set<string>,
  prefix = '../',
): string[] {
  return [...assets.values()]
    .filter((asset) => used.has(asset.identifier))
    .map((asset) => `import ${asset.identifier} from '${prefix}${asset.path}';`);
}

// ---------------------------------------------------------------- assets ---

const MIME_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

function planAssets(project: Project, warnings: string[]): Map<string, AssetPlan> {
  const plans = new Map<string, AssetPlan>();
  const fileNames = new NameRegistry();
  const identifiers = new NameRegistry(['styles', 'React']);

  for (const asset of project.assets) {
    const decoded = decodeDataUri(asset);
    if (!decoded) {
      // Remote URLs stay remote; only embedded images become files.
      if (!asset.src.startsWith('data:')) continue;
      warnings.push(`Image "${asset.name}" could not be decoded and was skipped.`);
      continue;
    }

    const base = toKebabCase(asset.name, 'image');
    const fileName = fileNames.take(`${base}.${decoded.extension}`);
    plans.set(asset.id, {
      path: `assets/${fileName}`,
      identifier: identifiers.take(toCamelCase(`${asset.name} image`, 'image')),
      bytes: decoded.bytes,
    });
  }

  return plans;
}

function decodeDataUri(asset: AssetNode): { bytes: Uint8Array; extension: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(asset.src);
  if (!match) return null;

  const mime = match[1]!.toLowerCase();
  const extension = MIME_EXTENSION[mime];
  if (!extension) return null;

  try {
    const binary = atob(match[2]!);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { bytes, extension };
  } catch {
    return null;
  }
}

// ----------------------------------------------------------- scaffolding ---

function packageJson(slug: string, extraDeps: Record<string, string> = {}): string {
  return `${JSON.stringify(
    {
      name: slug,
      private: true,
      version: '0.1.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'tsc --noEmit && vite build',
        preview: 'vite preview',
        typecheck: 'tsc --noEmit',
      },
      dependencies: {
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        // Whatever the connected services need, e.g. an auth SDK.
        ...extraDeps,
      },
      devDependencies: {
        '@types/react': '^19.0.8',
        '@types/react-dom': '^19.0.3',
        '@vitejs/plugin-react': '^4.3.4',
        typescript: '^5.7.3',
        vite: '^6.1.0',
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * One config, no project references. Vite does the compiling; TypeScript only
 * ever checks here, which keeps the file short enough to actually read.
 */
const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src", "vite.config.ts"]
}
`;

const VITE_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`;

const MAIN_TSX = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

/**
 * The app shell.
 *
 * `usesReveal` adds the one effect an exported project needs for scroll
 * entrances. It is written inline rather than hidden in a helper so that a
 * developer reading App.tsx can see exactly what runs and delete it in one go.
 */
function appTsx(pages: { page: PageNode; component: string }[], usesReveal: boolean): string {
  const [first, ...rest] = pages;
  if (!first) return `export function App() {\n  return null;\n}\n`;

  const imports = [
    usesReveal ? "import { useEffect } from 'react';" : '',
    ...pages.map(({ component }) => `import { ${component} } from './pages/${component}';`),
    usesReveal ? "import { observeReveals } from './lib/reveal';" : '',
  ]
    .filter(Boolean)
    .join('\n');

  const revealEffect = usesReveal
    ? '  // Plays entrance animations as their elements scroll into view.\n  useEffect(() => observeReveals(), []);\n\n'
    : '';

  if (rest.length === 0) {
    return `${imports}

export function App() {
${revealEffect}  return <${first.component} />;
}
`;
  }

  // More than one page: a tiny path switch, no router dependency imposed.
  const cases = pages
    .map(({ page, component }) => `    case ${JSON.stringify(page.path)}:\n      return <${component} />;`)
    .join('\n');

  return `${imports}

/**
 * Minimal path switch. Swap this for your router of choice when you need
 * nested routes, data loading or transitions.
 */
export function App() {
  const path = window.location.pathname;

${revealEffect}  switch (path) {
${cases}
    default:
      return <${first.component} />;
  }
}
`;
}

function indexHtml(project: Project): string {
  const title = escapeHtml(project.name);
  const description = escapeHtml(project.settings.description || project.name);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readme(
  project: Project,
  slug: string,
  pages: { page: PageNode; component: string }[],
): string {
  const pageList = pages
    .map(({ page, component }) => `- \`src/pages/${component}.tsx\`, ${page.name} (\`${page.path}\`)`)
    .join('\n');

  return `# ${project.name}

${project.settings.description || 'A website.'}

## Running it

\`\`\`bash
npm install
npm run dev
\`\`\`

\`\`\`bash
npm run build     # production build into dist/
npm run preview   # serve the build locally
\`\`\`

## How it is put together

Plain React and TypeScript on Vite. No framework beyond that, no runtime
dependency on the tool that generated it, delete this file and nothing
changes.

${pageList}

Each top-level section of a page is its own component under \`src/components\`,
paired with a CSS module holding its styles. Responsive rules are ordinary
\`max-width\` media queries at ${project.settings.breakpoints.tablet}px and
${project.settings.breakpoints.mobile}px, written into the same module.

\`\`\`
src/
  main.tsx            entry point
  App.tsx             page selection
  pages/              one component per page
  components/         one component per section
  styles/global.css   baseline reset
\`\`\`

## Editing

Everything is normal source. Rename components, merge them, pull the CSS into
whatever system you prefer, add a router. Nothing here expects to be
regenerated.

---

Exported from Zory as \`${slug}\`.
`;
}
