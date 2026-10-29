#!/usr/bin/env python3
"""
Static docs generator for the OpenLeads site.

Pre-renders the Markdown guides in ``docs/`` into framework-free HTML pages under
``site/docs/`` (sidebar, content, on-this-page TOC, Cmd+K search) with **zero
dependencies**, so anyone can regenerate them with plain ``python3``:

    python3 site/build_docs.py

Re-run whenever the Markdown in ``docs/`` changes, then commit ``site/docs/``.

The pages load the landing page's stylesheet (``site/styles.css``) and then
``docs.css``. No external fonts, icons or scripts: icons are inline SVG symbols
defined once per page.
"""
from __future__ import annotations

import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS_SRC = ROOT / "docs"
OUT = ROOT / "site" / "docs"
REPO = "https://github.com/Samyrrrrrr990/openleads"

# Sidebar structure: (section, [(slug, label, blurb), ...]).
# slug -> docs/<slug>.md
NAV = [
    ("Get started", [
        ("quickstart", "Quickstart", "Install, find leads, and send a first campaign in ten minutes."),
        ("web", "Web dashboard", "The local app: search, CRM, workflows, and analytics in your browser."),
    ]),
    ("Guides", [
        ("finding", "Finding leads", "How one sentence is routed across ten free sources."),
        ("workspace", "Workspace", "People, companies, lists, tasks, deals and data health."),
        ("sequences", "Sequences", "Multi-step email, call and LinkedIn cadences that run themselves."),
        ("from-apollo", "Moving from Apollo", "Bring your contacts, lists and stages over from Apollo."),
        ("workflows", "Workflows", "Build recipes as a node canvas, then run them on a schedule."),
        ("deliverability", "Deliverability", "The seven-signal engine that decides what is safe to send."),
        ("sending", "Sending", "Connect a mailbox, warm up, and send without burning your domain."),
        ("timed-runs", "Timed runs", "Cron and weekday schedules for searches and campaigns."),
        ("automation", "Automation and assistant", "Describe a campaign in one line and let your machine run it."),
        ("mcp", "Claude, Cursor, and MCP", "Use OpenLeads as a tool from any MCP client."),
        ("sources", "Add a source", "Add a new vertical with a single Python file."),
    ]),
    ("Reference", [
        ("architecture", "Architecture", "How the package fits together."),
        ("how-it-works", "Email engine", "Inside email finding and verification."),
        ("responsible-use", "Responsible use", "Anti-spam law, ethics, and the guardrails."),
        ("licensing", "Licensing", "AGPL-3.0 and the commercial license."),
    ]),
]
PAGES = {slug: (section, label, blurb) for section, items in NAV for slug, label, blurb in items}
SLUGS = set(PAGES)
ORDER = [(slug, label) for _, items in NAV for slug, label, _ in items]


# --------------------------------------------------------------------------- #
# Inline markdown                                                             #
# --------------------------------------------------------------------------- #
def _map_url(url: str) -> str:
    url = url.strip()
    if re.match(r"^(https?:|mailto:|#)", url):
        return url
    path, _, frag = url.partition("#")
    frag = f"#{frag}" if frag else ""
    base = path.rsplit("/", 1)[-1]
    if path.endswith(".md"):
        stem = base[:-3]
        if stem in SLUGS:
            return f"{stem}.html{frag}"
        return f"{REPO}/blob/main/docs/{base}{frag}"
    clean = path.lstrip("./").lstrip("../").replace("../", "")
    return f"{REPO}/blob/main/{clean}{frag}" if clean else url


def inline(text: str) -> str:
    """Render inline markdown to HTML (code spans, links, bold, italic)."""
    codes: list[str] = []

    def stash(m):
        codes.append(html.escape(m.group(1)))
        return f"\x00{len(codes) - 1}\x00"

    text = re.sub(r"`([^`]+)`", stash, text)
    text = html.escape(text, quote=False)
    # links [text](url)
    text = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)",
                  lambda m: f'<a href="{html.escape(_map_url(m.group(2)), quote=True)}">{m.group(1)}</a>',
                  text)
    # bold then italic
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])", r"<em>\1</em>", text)
    text = re.sub(r"(?<![\w_])_([^_\n]+)_(?![\w_])", r"<em>\1</em>", text)
    # restore code spans
    text = re.sub(r"\x00(\d+)\x00", lambda m: f"<code>{codes[int(m.group(1))]}</code>", text)
    return text


def _slugify(text: str) -> str:
    text = re.sub(r"`|\*|_|\[|\]|\(.*?\)", "", text)
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


# --------------------------------------------------------------------------- #
# Block markdown → HTML (+ TOC)                                               #
# --------------------------------------------------------------------------- #
def render(md: str):
    lines = md.split("\n")
    out: list[str] = []
    toc: list[tuple[int, str, str]] = []   # (level, slug, text)
    title = ""
    i, n = 0, len(lines)

    def flush_para(buf):
        if buf:
            out.append(f"<p>{inline(' '.join(buf).strip())}</p>")
            buf.clear()

    para: list[str] = []
    while i < n:
        line = lines[i]

        # fenced code
        m = re.match(r"^```(\w*)\s*$", line)
        if m:
            flush_para(para)
            lang = m.group(1)
            i += 1
            code = []
            while i < n and not lines[i].startswith("```"):
                code.append(lines[i]); i += 1
            i += 1
            body = html.escape("\n".join(code))
            if lang == "mermaid":
                out.append(f'<figure class="diagram"><pre class="code"><code>{body}</code></pre>'
                           f'<figcaption>Diagram source, in Mermaid</figcaption></figure>')
            else:
                out.append(f'<div class="codeblock"><pre class="code"><code>{body}</code></pre>'
                           f'<button class="codeblock__copy" type="button" aria-label="Copy code">Copy</button></div>')
            continue

        # heading
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            flush_para(para)
            level = len(m.group(1))
            text = m.group(2).strip().rstrip("#").strip()
            slug = _slugify(text)
            if level == 1 and not title:
                title = re.sub(r"`|\*", "", text)
                out.append(f'<h1 id="{slug}">{inline(text)}</h1>')
            else:
                out.append(f'<h{level} id="{slug}" class="anchored">'
                           f'<a class="hlink" href="#{slug}">#</a>{inline(text)}</h{level}>')
                if level in (2, 3):
                    toc.append((level, slug, re.sub(r"`|\*", "", text)))
            i += 1
            continue

        # horizontal rule
        if re.match(r"^\s*([-*_])\1\1+\s*$", line):
            flush_para(para)
            out.append("<hr/>")
            i += 1
            continue

        # table
        if line.lstrip().startswith("|") and i + 1 < n and re.match(r"^\s*\|?[\s:|-]+\|?\s*$", lines[i + 1]) and "-" in lines[i + 1]:
            flush_para(para)
            def cells(row):
                row = row.strip().strip("|")
                return [c.strip() for c in row.split("|")]
            header = cells(line)
            i += 2
            rows = []
            while i < n and lines[i].lstrip().startswith("|"):
                rows.append(cells(lines[i])); i += 1
            thead = "".join(f"<th>{inline(c)}</th>" for c in header)
            tbody = "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in rows)
            out.append(f'<div class="tablewrap"><table><thead><tr>{thead}</tr></thead>'
                       f'<tbody>{tbody}</tbody></table></div>')
            continue

        # blockquote
        if line.lstrip().startswith(">"):
            flush_para(para)
            buf = []
            while i < n and lines[i].lstrip().startswith(">"):
                buf.append(re.sub(r"^\s*>\s?", "", lines[i])); i += 1
            text = ' '.join(buf).strip()
            warn = re.match(r"^\*\*(warning|careful|important)", text, re.I)
            cls = "callout callout--warn" if warn else "callout"
            out.append(f'<blockquote class="{cls}"><p>{inline(text)}</p></blockquote>')
            continue

        # list (ordered / unordered, one nesting level by indent)
        if re.match(r"^\s*([-*]|\d+\.)\s+", line):
            flush_para(para)
            block, i = _render_list(lines, i, n)
            out.append(block)
            continue

        # blank → paragraph break
        if line.strip() == "":
            flush_para(para)
            i += 1
            continue

        para.append(line)
        i += 1

    flush_para(para)
    return title, "\n".join(out), toc


def _render_list(lines, start, n):
    """Render a contiguous list block starting at ``start`` (one nesting level)."""
    items = []
    i = start
    ordered = bool(re.match(r"^\s*\d+\.\s+", lines[start]))
    cur = None
    while i < n:
        line = lines[i]
        m = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", line)
        if m:
            indent = len(m.group(1))
            content = m.group(3)
            if indent >= 2 and cur is not None:
                cur.setdefault("sub", []).append(content)
            else:
                cur = {"text": content, "sub": []}
                items.append(cur)
            i += 1
        elif cur is not None and re.match(r"^\s+\S", line) and not line.lstrip().startswith("```"):
            # a wrapped continuation of the previous item (or of its last sub-item)
            if cur["sub"]:
                cur["sub"][-1] += " " + line.strip()
            else:
                cur["text"] += " " + line.strip()
            i += 1
        elif line.strip() == "":
            # peek: continue only if next line is still part of the list
            if i + 1 < n and re.match(r"^\s+\S", lines[i + 1] or ""):
                i += 1
            else:
                break
        else:
            break
    tag = "ol" if ordered else "ul"
    html_items = []
    for it in items:
        inner = inline(it["text"])
        if it["sub"]:
            sub = "".join(f"<li>{inline(s)}</li>" for s in it["sub"])
            inner += f"<ul>{sub}</ul>"
        html_items.append(f"<li>{inner}</li>")
    return f"<{tag}>{''.join(html_items)}</{tag}>", i


# --------------------------------------------------------------------------- #
# Page assembly                                                               #
# --------------------------------------------------------------------------- #
GH_PATH = ("M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49"
           "-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82"
           ".72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15"
           "-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82"
           " 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48"
           " 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z")
# Cache-busting for ../styles.css and docs.css. ?v=7 and ?v=8 were served with
# older copies of styles.css and ?v=9 is the landing page's, so start past them.
ASSET_V = "10"

# Stroke icons on a 20px grid, drawn in currentColor. Defined once per page as
# <symbol>s and placed with icon(); nothing else on the page is an icon.
ICONS = {
    "search": '<circle cx="8.75" cy="8.75" r="5.25"/><path d="m12.75 12.75 4 4"/>',
    "menu": '<path d="M3.5 6h13M3.5 10h13M3.5 14h13"/>',
    "close": '<path d="m5 5 10 10M15 5 5 15"/>',
    "arrow-left": '<path d="M16 10H4m5-5-5 5 5 5"/>',
    "arrow-right": '<path d="M4 10h12m-5-5 5 5-5 5"/>',
    "external": '<path d="M7 13 13 7M8 7h5v5"/>',
}
SPRITE = ('<svg width="0" height="0" style="position:absolute" aria-hidden="true">'
          f'<symbol id="gh" viewBox="0 0 16 16"><path d="{GH_PATH}"/></symbol>'
          + "".join(f'<symbol id="i-{name}" viewBox="0 0 20 20" fill="none" stroke="currentColor" '
                    f'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{paths}</symbol>'
                    for name, paths in ICONS.items())
          + "</svg>")


def icon(name: str, cls: str = "") -> str:
    extra = f" {cls}" if cls else ""
    return f'<svg class="ico{extra}" aria-hidden="true" focusable="false"><use href="#i-{name}"/></svg>'


def _head(title: str, desc: str, body_cls: str = "") -> str:
    t, d = html.escape(title), html.escape(desc)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{t}</title>
<meta name="description" content="{d}" />
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#131418" media="(prefers-color-scheme: dark)" />
<meta property="og:title" content="{t}" />
<meta property="og:description" content="{d}" />
<meta property="og:image" content="https://samyrrrrrr990.github.io/openleads/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="../favicon.svg" type="image/svg+xml" />
<link rel="preload" href="../fonts/atkinson-next-latin.woff2" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet" href="../styles.css?v={ASSET_V}" />
<link rel="stylesheet" href="docs.css?v={ASSET_V}" />
</head>
<body class="docs{body_cls}">
{SPRITE}
<a class="skip" href="#main">Skip to content</a>
<header class="nav" id="nav">
  <a class="brand" href="../index.html" aria-label="OpenLeads home"><span class="brand__mark" aria-hidden="true"></span><span class="brand__name">OpenLeads</span></a>
  <nav class="nav__links" aria-label="Primary">
    <a href="../index.html#labels">How it labels</a>
    <a href="../index.html#benchmark">Benchmark</a>
    <a href="../index.html#workspace">Workspace</a>
    <a href="index.html" class="is-active">Docs</a>
  </nav>
  <div class="nav__cta">
    <button class="dsearch" type="button" data-search-open aria-label="Search the docs" aria-keyshortcuts="Meta+K Control+K /">{icon("search")}<span class="dsearch__label">Search</span><kbd data-mod-k>⌘K</kbd></button>
    <a class="gh-btn" href="{REPO}" rel="noopener" aria-label="OpenLeads on GitHub">
      <svg class="gh-mark" viewBox="0 0 16 16" aria-hidden="true"><use href="#gh"/></svg><span class="gh-btn__label">GitHub</span><span class="gh-btn__count" data-stars hidden></span>
    </a>
    <button class="dmenu" id="dsbToggle" type="button" aria-label="Open the docs menu" aria-controls="dsb" aria-expanded="false">{icon("menu", "ico--open")}{icon("close", "ico--close")}</button>
  </div>
</header>
"""


def _footer() -> str:
    return f"""<footer class="footer dfoot">
  <div class="footer__inner">
    <div class="footer__brand">
      <a class="brand" href="../index.html"><span class="brand__mark" aria-hidden="true"></span><span class="brand__name">OpenLeads</span></a>
      <p>Lead finding and a sales workspace that run on your own machine.</p>
    </div>
    <div class="footer__cols">
      <div><h4>Product</h4><a href="../index.html#labels">How it labels</a><a href="../index.html#benchmark">Benchmark</a><a href="../index.html#workspace">Workspace</a><a href="{REPO}/blob/main/CHANGELOG.md">Changelog</a></div>
      <div><h4>Project</h4><a href="{REPO}">GitHub</a><a href="https://pypi.org/project/openleads/">PyPI</a><a href="https://www.npmjs.com/package/openleads">npm</a><a href="{REPO}/discussions">Discussions</a></div>
    </div>
  </div>
  <div class="footer__legal">
    <span>© 2026 Samyar Shafiee. Open source under AGPL-3.0.</span>
    <span><a href="{REPO}/blob/main/COMMERCIAL-LICENSE.md">Commercial license</a></span>
  </div>
</footer>"""


def _tail() -> str:
    """The search dialog, the script and the closing tags."""
    return f"""
<div class="search" id="search" hidden>
  <div class="search__backdrop" data-search-close></div>
  <div class="search__panel" role="dialog" aria-modal="true" aria-label="Search the docs">
    <div class="search__field">{icon("search")}
      <input id="searchInput" type="search" placeholder="Search the docs" aria-label="Search the docs" autocomplete="off" spellcheck="false"
             role="combobox" aria-expanded="false" aria-controls="searchResults" aria-autocomplete="list" />
      <button class="search__esc" type="button" data-search-close aria-label="Close search"><span>Esc</span>{icon("close")}</button>
    </div>
    <ul class="search__results" id="searchResults" role="listbox" aria-label="Results"></ul>
    <p class="search__empty" id="searchEmpty" role="status" hidden></p>
    <p class="search__foot"><span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span></p>
  </div>
</div>
<script src="docs.js?v={ASSET_V}" defer></script>
</body>
</html>
"""


def rail_html(active: str) -> str:
    """The left rail: every page, grouped, with the current one marked."""
    def link(href: str, label: str, on: bool) -> str:
        cur = ' aria-current="page"' if on else ""
        return f'<li><a class="dsb__link" href="{href}"{cur}>{html.escape(label)}</a></li>'

    out = ['<div class="docs__rail"><nav class="dsb" id="dsb" aria-label="Docs">',
           f'<ul class="dsb__list">{link("index.html", "Overview", active == "index")}</ul>']
    for section, items in NAV:
        sid = f"dsb-{_slugify(section)}"
        links = "".join(link(f"{slug}.html", label, slug == active) for slug, label, _ in items)
        out.append(f'<p class="dsb__sec" id="{sid}">{section}</p><ul class="dsb__list" aria-labelledby="{sid}">{links}</ul>')
    out.append(f'<p class="dsb__foot"><a href="{REPO}/discussions" rel="noopener">Ask the community{icon("external")}</a>'
               f'<a href="{REPO}/issues/new" rel="noopener">Report an issue{icon("external")}</a></p>')
    out.append("</nav></div>")
    return "\n".join(out)


def toc_html(toc, slug: str) -> str:
    items = "".join(
        f'<li><a class="dtoc__l{level}" href="#{s}">{html.escape(text)}</a></li>' for level, s, text in toc)
    listing = f'<p class="dtoc__h">On this page</p><ul class="dtoc__list">{items}</ul>' if toc else ""
    edit = (f'<p class="dtoc__edit"><a href="{REPO}/edit/main/docs/{slug}.md" rel="noopener">'
            f'Edit this page{icon("external")}</a></p>')
    return f'<nav class="dtoc" aria-label="On this page">{listing}{edit}</nav>'


def prevnext_html(slug: str) -> str:
    idx = next((k for k, (s, _) in enumerate(ORDER) if s == slug), None)
    if idx is None:
        return ""
    if idx > 0:
        s, label = ORDER[idx - 1]
        prev = (f'<a class="pn pn--prev" href="{s}.html" rel="prev"><span class="pn__dir">{icon("arrow-left")}Previous</span>'
                f'<span class="pn__title">{html.escape(label)}</span></a>')
    else:
        prev = (f'<a class="pn pn--prev" href="index.html"><span class="pn__dir">{icon("arrow-left")}Back</span>'
                '<span class="pn__title">Overview</span></a>')
    nxt = ""
    if idx < len(ORDER) - 1:
        s, label = ORDER[idx + 1]
        nxt = (f'<a class="pn pn--next" href="{s}.html" rel="next"><span class="pn__dir">Next{icon("arrow-right")}</span>'
               f'<span class="pn__title">{html.escape(label)}</span></a>')
    return f'<nav class="prevnext" aria-label="Previous and next page">{prev}{nxt}</nav>'


def _lede(content: str) -> str:
    """Give the first paragraph after the H1 the larger 'lede' style."""
    return re.sub(r"(</h1>\s*)<p>", r'\1<p class="lede">', content, count=1)


def _reading_minutes(md: str) -> int:
    return max(1, round(len(re.findall(r"\w+", md)) / 230))


def build_page(slug: str, label: str):
    section, _, blurb = PAGES[slug]
    md = (DOCS_SRC / f"{slug}.md").read_text(encoding="utf-8")
    title, content, toc = render(md)
    title = title or label
    content = _lede(content)
    meta = (f'<div class="dmeta"><nav class="dmeta__crumb" aria-label="Breadcrumb"><a href="index.html">Docs</a>'
            f'<span aria-hidden="true">/</span><span>{section}</span></nav>'
            f'<span class="dmeta__time">{_reading_minutes(md)} min read</span></div>')
    article = content.replace("<h1 ", meta + "<h1 ", 1) if "<h1 " in content else meta + content
    page = (_head(f"{title} · OpenLeads docs", f"{blurb} OpenLeads documentation.")
            + '<div class="docs__shell">\n' + rail_html(slug)
            + '\n<div class="docs__body">\n<main class="docs__main" id="main" tabindex="-1"><article class="prose">\n'
            + article + "\n" + prevnext_html(slug)
            + "\n</article></main>\n" + toc_html(toc, slug) + "\n" + _footer()
            + "\n</div>\n</div>" + _tail())
    return page, title, content


def _plain(fragment: str) -> str:
    text = re.sub(r"<[^>]+>", " ", fragment)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def search_records(slug: str, label: str, content: str) -> list:
    """One record per page section (split at h2/h3), for the client-side search."""
    section = PAGES[slug][0]
    content = re.sub(r"<button\b[^>]*>.*?</button>", " ", content)   # the "Copy" buttons
    recs = []
    parts = re.split(r'(<h[23] id="[^"]+" class="anchored"><a class="hlink" href="#[^"]+">#</a>.*?</h[23]>)', content)
    head, anchor = label, ""
    for part in parts:
        m = re.match(r'<h[23] id="([^"]+)"', part)
        if m:
            anchor, head = m.group(1), _plain(re.sub(r'<a class="hlink"[^>]*>#</a>', "", part))
            continue
        body = _plain(part)[:600]
        if body or anchor:
            recs.append({"u": f"{slug}.html" + (f"#{anchor}" if anchor else ""), "p": label,
                         "s": section, "h": head if anchor else label, "t": body})
    return recs


HELP = [
    (f"{REPO}/discussions", "Ask a question", "Discussions on GitHub."),
    (f"{REPO}/issues/new", "Report a bug", "Open an issue with what you ran and what happened."),
    (REPO, "Star the repo", "It helps other people find it."),
]


def build_index() -> str:
    def group(gid: str, title: str, rows: str) -> str:
        return (f'<section class="dgroup" aria-labelledby="{gid}"><h2 id="{gid}">{title}</h2>'
                f'<ul class="dlist">{rows}</ul></section>')

    groups = [group(f"g-{_slugify(section)}", section, "".join(
        f'<li><a href="{slug}.html"><b>{html.escape(label)}</b><span>{html.escape(blurb)}</span></a></li>'
        for slug, label, blurb in items)) for section, items in NAV]
    groups.append(group("g-help", "Help", "".join(
        f'<li><a href="{href}" rel="noopener"><b>{label}{icon("external")}</b><span>{blurb}</span></a></li>'
        for href, label, blurb in HELP)))
    groups_html = "\n  ".join(groups)
    body = f"""<div class="docs__shell">
{rail_html("index")}
<div class="docs__body docs__body--index">
<main class="docs__main dhome" id="main" tabindex="-1">
  <h1>OpenLeads documentation</h1>
  <p class="lede">Install OpenLeads, describe who you want, and send your first campaign from your own machine. Then go deep on how the engine finds and verifies every address.</p>
  <button class="dhome__search" type="button" data-search-open>{icon("search")}<span>Search the docs</span><kbd data-mod-k>⌘K</kbd></button>

  <section class="dstart" aria-labelledby="g-start">
    <div class="dstart__text">
      <h2 id="g-start">Ten minutes to your first leads</h2>
      <p>One install, one sentence. OpenLeads searches the sources that fit and labels every email as found, pattern or guessed.</p>
      <a class="solid-btn" href="quickstart.html">Open the quickstart</a>
    </div>
    <div class="codeblock"><pre class="code"><code>pip install "openleads[all]"
openleads find "dentists in Austin"
openleads web</code></pre><button class="codeblock__copy" type="button" aria-label="Copy code">Copy</button></div>
  </section>

  {groups_html}
</main>
{_footer()}
</div>
</div>"""
    return (_head("Documentation · OpenLeads",
                  "OpenLeads documentation: find people with free public sources, verify their emails, "
                  "and write, send, and automate cold email from your own machine.", " docs--index")
            + body + _tail())


def main() -> None:
    import json
    OUT.mkdir(parents=True, exist_ok=True)
    records = []
    for slug, label in ORDER:
        page, _, content = build_page(slug, label)
        (OUT / f"{slug}.html").write_text(page, encoding="utf-8")
        records += search_records(slug, label, content)
        print(f"  ok docs/{slug}.html")
    (OUT / "index.html").write_text(build_index(), encoding="utf-8")
    (OUT / "search.json").write_text(json.dumps(records, ensure_ascii=False, separators=(",", ":")),
                                     encoding="utf-8")
    print(f"Done: {len(ORDER) + 1} pages and {len(records)} search records in {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
