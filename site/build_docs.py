#!/usr/bin/env python3
"""
Static docs generator for the OpenLeads site.

Pre-renders the Markdown guides in ``docs/`` into framework-free HTML pages under
``site/docs/`` (sidebar, content, on-this-page TOC, Cmd+K search) with **zero
dependencies**, so anyone can regenerate them with plain ``python3``:

    python3 site/build_docs.py

Re-run whenever the Markdown in ``docs/`` changes, then commit ``site/docs/``.
"""
from __future__ import annotations

import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS_SRC = ROOT / "docs"
OUT = ROOT / "site" / "docs"
REPO = "https://github.com/Samyrrrrrr990/openleads"

# Sidebar structure: (section, [(slug, label, phosphor icon, blurb), ...]).
# slug -> docs/<slug>.md
NAV = [
    ("Get started", [
        ("quickstart", "Quickstart", "rocket-launch", "Install, find leads, and send a first campaign in ten minutes."),
        ("web", "Web dashboard", "browser", "The local app: search, CRM, workflows, and analytics in your browser."),
    ]),
    ("Guides", [
        ("finding", "Finding leads", "magnifying-glass", "How one sentence is routed across ten free sources."),
        ("workflows", "Workflows", "flow-arrow", "Build recipes as a node canvas, then run them on a schedule."),
        ("deliverability", "Deliverability", "seal-check", "The seven-signal engine that decides what is safe to send."),
        ("sending", "Sending", "paper-plane-tilt", "Connect a mailbox, warm up, and send without burning your domain."),
        ("timed-runs", "Timed runs", "clock", "Cron and weekday schedules for searches and campaigns."),
        ("automation", "Automation and assistant", "robot", "Describe a campaign in one line and let your machine run it."),
        ("mcp", "Claude, Cursor, and MCP", "plugs-connected", "Use OpenLeads as a tool from any MCP client."),
        ("sources", "Add a source", "puzzle-piece", "Add a new vertical with a single Python file."),
    ]),
    ("Reference", [
        ("architecture", "Architecture", "tree-structure", "How the package fits together."),
        ("how-it-works", "Email engine", "envelope-open", "Inside email finding and verification."),
        ("responsible-use", "Responsible use", "scales", "Anti-spam law, ethics, and the guardrails."),
        ("licensing", "Licensing", "certificate", "AGPL-3.0 and the commercial license."),
    ]),
]
PAGES = {slug: (section, label, icon, blurb) for section, items in NAV for slug, label, icon, blurb in items}
SLUGS = set(PAGES)
ORDER = [(slug, label) for _, items in NAV for slug, label, _, _ in items]


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
                out.append(f'<figure class="diagram"><pre>{body}</pre>'
                           f'<figcaption>diagram</figcaption></figure>')
            else:
                label = html.escape(lang or "text")
                out.append(f'<div class="codeblock"><div class="codeblock__bar"><span>{label}</span>'
                           f'<button class="codeblock__copy" type="button" aria-label="Copy code">'
                           f'<i class="ph ph-copy"></i><span>Copy</span></button></div>'
                           f'<pre class="code"><code>{body}</code></pre></div>')
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
            kind = "warn" if re.match(r"^\*\*(warning|careful|important)", text, re.I) else "note"
            icon = "ph-warning" if kind == "warn" else "ph-info"
            out.append(f'<div class="callout callout--{kind}"><i class="ph {icon}"></i>'
                       f'<div>{inline(text)}</div></div>')
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
ASSET_V = "6"

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{title}</title>
<meta name="description" content="{desc}" />
<meta name="theme-color" content="#fbfbfd" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#0b0b0c" media="(prefers-color-scheme: dark)" />
<meta property="og:title" content="{title}" />
<meta property="og:description" content="{desc}" />
<meta property="og:image" content="https://samyrrrrrr990.github.io/openleads/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="../favicon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css" />
<link rel="stylesheet" href="../styles.css?v={v}" />
<link rel="stylesheet" href="docs.css?v={v}" />
</head>
<body class="docs{body_cls}">
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="gh" viewBox="0 0 16 16"><path d="{gh}"/></symbol></svg>
<header class="nav" id="nav">
  <button class="dsb-toggle" id="dsbToggle" aria-label="Open the docs menu" aria-expanded="false"><i class="ph ph-list"></i></button>
  <a class="brand" href="../index.html" aria-label="OpenLeads home"><span class="brand__mark" aria-hidden="true"></span><span class="brand__name">OpenLeads</span></a>
  <span class="nav__docs-tag">Docs</span>
  <nav class="nav__links" aria-label="Primary">
    <a href="../index.html#workflow">Workflows</a>
    <a href="../index.html#workspace">Product</a>
    <a href="../index.html#pricing">Pricing</a>
    <a href="index.html" class="is-active">Docs</a>
  </nav>
  <div class="nav__cta">
    <button class="search-btn" type="button" data-search-open aria-label="Search the docs"><i class="ph ph-magnifying-glass"></i><span>Search</span><kbd>⌘K</kbd></button>
    <a class="gh-btn" href="{repo}" target="_blank" rel="noopener" aria-label="Star OpenLeads on GitHub">
      <svg class="gh-mark" viewBox="0 0 16 16" aria-hidden="true"><use href="#gh"/></svg>
      <span class="gh-btn__label">Star</span><span class="gh-btn__count" data-stars hidden></span>
    </a>
  </div>
</header>
"""

FOOT = """
<footer class="footer docs-footer">
  <div class="container footer__legal">
    <span>© 2026 Samyar Shafiee. Open source under AGPL-3.0.</span>
    <span><a href="{repo}">GitHub</a> · <a href="https://pypi.org/project/openleads/">PyPI</a> · <a href="https://www.npmjs.com/package/openleads">npm</a> · <a href="{repo}/discussions">Discussions</a></span>
  </div>
</footer>

<div class="search" id="search" hidden>
  <div class="search__backdrop" data-search-close></div>
  <div class="search__panel" role="dialog" aria-modal="true" aria-label="Search the docs">
    <label class="search__field"><i class="ph ph-magnifying-glass"></i>
      <input id="searchInput" type="search" placeholder="Search the docs" autocomplete="off" spellcheck="false" />
      <kbd data-search-close>Esc</kbd></label>
    <ul class="search__results" id="searchResults" role="listbox"></ul>
    <p class="search__foot"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>↵</kbd> to open</span></p>
  </div>
</div>
<script src="docs.js?v={v}"></script>
</body>
</html>
"""


def _head(title: str, desc: str, body_cls: str = "") -> str:
    return HEAD.format(title=html.escape(title), desc=html.escape(desc), repo=REPO,
                       gh=GH_PATH, v=ASSET_V, body_cls=body_cls)


def _foot() -> str:
    return FOOT.format(repo=REPO, v=ASSET_V)


def sidebar_html(active: str) -> str:
    out = ['<nav class="dsb" id="dsb" aria-label="Docs">',
           '<button class="dsb__search" type="button" data-search-open><i class="ph ph-magnifying-glass"></i>'
           'Search<kbd>⌘K</kbd></button>',
           f'<a class="dsb__link dsb__home{" is-active" if active == "index" else ""}" href="index.html">'
           '<i class="ph ph-house"></i>Overview</a>']
    for section, items in NAV:
        out.append(f'<p class="dsb__sec">{section}</p>')
        for slug, label, icon, _ in items:
            cls = " is-active" if slug == active else ""
            cur = ' aria-current="page"' if slug == active else ""
            out.append(f'<a class="dsb__link{cls}" href="{slug}.html"{cur}><i class="ph ph-{icon}"></i>{label}</a>')
    out.append(f'<div class="dsb__foot"><a href="{REPO}/discussions" target="_blank" rel="noopener">'
               '<i class="ph ph-chats-circle"></i>Ask the community</a>'
               f'<a href="{REPO}/issues/new" target="_blank" rel="noopener"><i class="ph ph-bug"></i>Report an issue</a></div>')
    out.append("</nav>")
    return "\n".join(out)


def toc_html(toc, slug: str) -> str:
    items = "".join(
        f'<a class="toc__l{level}" href="#{s}">{html.escape(text)}</a>' for level, s, text in toc)
    links = (f'<div class="dtoc__links"><a href="{REPO}/edit/main/docs/{slug}.md" target="_blank" rel="noopener">'
             '<i class="ph ph-pencil-simple"></i>Edit this page</a>'
             f'<a href="{REPO}" target="_blank" rel="noopener"><svg class="gh-mark" viewBox="0 0 16 16" aria-hidden="true">'
             '<use href="#gh"/></svg>Star on GitHub</a></div>')
    head = '<p class="dtoc__h">On this page</p>' if toc else ""
    return f'<aside class="dtoc">{head}{items}{links}</aside>'


def prevnext_html(slug: str) -> str:
    idx = next((k for k, (s, _) in enumerate(ORDER) if s == slug), None)
    if idx is None:
        return ""
    parts = ['<nav class="prevnext" aria-label="Previous and next page">']
    if idx > 0:
        s, label = ORDER[idx - 1]
        parts.append(f'<a class="pn pn--prev" href="{s}.html"><span><i class="ph ph-arrow-left"></i>Previous</span><b>{label}</b></a>')
    else:
        parts.append('<a class="pn pn--prev" href="index.html"><span><i class="ph ph-arrow-left"></i>Back</span><b>Overview</b></a>')
    if idx < len(ORDER) - 1:
        s, label = ORDER[idx + 1]
        parts.append(f'<a class="pn pn--next" href="{s}.html"><span>Next<i class="ph ph-arrow-right"></i></span><b>{label}</b></a>')
    parts.append("</nav>")
    return "\n".join(parts)


def _lede(content: str) -> str:
    """Give the first paragraph after the H1 the larger 'lede' style."""
    return re.sub(r"(</h1>\s*)<p>", r'\1<p class="lede">', content, count=1)


def _reading_minutes(md: str) -> int:
    return max(1, round(len(re.findall(r"\w+", md)) / 230))


def build_page(slug: str, label: str):
    section, _, icon, blurb = PAGES[slug]
    md = (DOCS_SRC / f"{slug}.md").read_text(encoding="utf-8")
    title, content, toc = render(md)
    title = title or label
    meta = (f'<div class="dhead"><span class="dhead__sec"><i class="ph ph-{icon}"></i>{section}</span>'
            f'<span class="dhead__meta">{_reading_minutes(md)} min read</span></div>')
    content = _lede(content).replace("<h1 ", meta + "<h1 ", 1)
    page = (_head(f"{title} · OpenLeads docs", f"{blurb} OpenLeads documentation.")
            + '<div class="docs__shell">\n' + sidebar_html(slug)
            + '\n<main class="docs__main" id="main"><article class="prose">\n'
            + f'<div class="docs__crumb"><a href="index.html">Docs</a><i class="ph ph-caret-right"></i>'
              f'<span>{section}</span><i class="ph ph-caret-right"></i><span>{html.escape(label)}</span></div>\n'
            + content + "\n" + prevnext_html(slug)
            + "\n</article></main>\n" + toc_html(toc, slug) + "\n</div>" + _foot())
    return page, title, content


def _plain(fragment: str) -> str:
    text = re.sub(r"<[^>]+>", " ", fragment)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def search_records(slug: str, label: str, content: str) -> list:
    """One record per page section (split at h2/h3), for the client-side search."""
    section = PAGES[slug][0]
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


def build_index() -> str:
    groups = []
    for section, items in NAV:
        cards = "".join(
            f'<a class="dcard" href="{slug}.html"><i class="ph ph-{icon}"></i><b>{label}</b>'
            f'<span>{blurb}</span></a>' for slug, label, icon, blurb in items)
        groups.append(f'<section class="dgroup"><h2>{section}</h2><div class="dcards">{cards}</div></section>')
    body = f"""
<div class="docs__shell docs__shell--index">
{sidebar_html("index")}
<main class="docs__main docs__home" id="main">
  <section class="dhero">
    <p class="eyebrow">Documentation</p>
    <h1>Everything you need to find people and reach them.</h1>
    <p class="lede">Install OpenLeads, describe who you want, and send your first campaign from your own machine. Then go deep on how the engine finds and verifies every address.</p>
    <button class="dhero__search" type="button" data-search-open><i class="ph ph-magnifying-glass"></i><span>Search the docs</span><kbd>⌘K</kbd></button>
  </section>

  <section class="dstart">
    <div class="dstart__text">
      <span class="dstart__tag">Start here</span>
      <h2>Ten minutes to your first leads</h2>
      <p>One install, one sentence. OpenLeads searches the sources that fit and labels every email as found, pattern, or guessed.</p>
      <a class="solid-btn" href="quickstart.html">Open the quickstart <i class="ph ph-arrow-right"></i></a>
    </div>
    <div class="codeblock dstart__code"><div class="codeblock__bar"><span>terminal</span><button class="codeblock__copy" type="button" aria-label="Copy code"><i class="ph ph-copy"></i><span>Copy</span></button></div>
<pre class="code"><code>pip install "openleads[all]"
openleads find "dentists in Austin"
openleads web</code></pre></div>
  </section>

  {''.join(groups)}

  <section class="dhelp">
    <a href="{REPO}/discussions" target="_blank" rel="noopener"><i class="ph ph-chats-circle"></i><b>Ask a question</b><span>Discussions on GitHub</span></a>
    <a href="{REPO}/issues/new" target="_blank" rel="noopener"><i class="ph ph-bug"></i><b>Report a bug</b><span>Open an issue</span></a>
    <a href="{REPO}" target="_blank" rel="noopener"><svg class="gh-mark" viewBox="0 0 16 16" aria-hidden="true"><use href="#gh"/></svg><b>Star the repo</b><span>It helps other people find it</span></a>
  </section>
</main>
</div>"""
    return (_head("Documentation · OpenLeads",
                  "OpenLeads documentation: find people with free public sources, verify their emails, "
                  "and write, send, and automate cold email from your own machine.", " docs--index")
            + body + _foot())


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
