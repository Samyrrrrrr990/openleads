#!/usr/bin/env python3
"""
Static docs generator for the OpenLeads marketing site.

Pre-renders the Markdown guides in ``docs/`` into styled, framework-free HTML
pages under ``site/docs/`` — a real docs experience (left nav · content ·
on-this-page TOC), like a professional dev site, with **zero dependencies**
(pure standard library, so anyone can regenerate with just ``python3``).

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

# Sidebar structure: (section title, [(slug, label), ...]). slug → docs/<slug>.md
NAV = [
    ("Getting started", [("quickstart", "Quickstart")]),
    ("Guides", [
        ("deliverability", "Deliverability"),
        ("sending", "Sending"),
        ("automation", "Automation & assistant"),
        ("web", "Web dashboard"),
        ("sources", "Add a source"),
    ]),
    ("Reference", [
        ("architecture", "Architecture"),
        ("how-it-works", "Email engine"),
        ("responsible-use", "Responsible use"),
    ]),
]
SLUGS = {slug for _, items in NAV for slug, _ in items}
ORDER = [(slug, label) for _, items in NAV for slug, label in items]


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
                cls = f' data-lang="{lang}"' if lang else ""
                out.append(f'<pre class="code"{cls}><code>{body}</code></pre>')
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
            out.append(f"<blockquote>{inline(' '.join(buf).strip())}</blockquote>")
            continue

        # list (ordered / unordered, one nesting level by indent)
        if re.match(r"^\s*([-*]|\d+\.)\s+", line):
            flush_para(para)
            out.append(_render_list(lines, i, n))
            # advance past consumed list lines
            while i < n and (re.match(r"^\s*([-*]|\d+\.)\s+", lines[i]) or
                             (lines[i].strip() == "" and i + 1 < n and re.match(r"^\s+", lines[i + 1] or ""))):
                i += 1
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
    return f"<{tag}>{''.join(html_items)}</{tag}>"


# --------------------------------------------------------------------------- #
# Page assembly                                                               #
# --------------------------------------------------------------------------- #
def sidebar_html(active: str) -> str:
    out = ['<nav class="dsb" aria-label="Docs">']
    for section, items in NAV:
        out.append(f'<p class="dsb__sec">{section}</p>')
        for slug, label in items:
            cls = " is-active" if slug == active else ""
            out.append(f'<a class="dsb__link{cls}" href="{slug}.html">{label}</a>')
    out.append("</nav>")
    return "\n".join(out)


def toc_html(toc) -> str:
    if not toc:
        return ""
    items = "".join(
        f'<a class="toc__l{level}" href="#{slug}">{html.escape(text)}</a>'
        for level, slug, text in toc)
    return f'<aside class="dtoc"><p class="dtoc__h">On this page</p>{items}</aside>'


def prevnext_html(slug: str) -> str:
    idx = next((k for k, (s, _) in enumerate(ORDER) if s == slug), None)
    if idx is None:
        return ""
    parts = ['<nav class="prevnext">']
    if idx > 0:
        s, label = ORDER[idx - 1]
        parts.append(f'<a class="pn pn--prev" href="{s}.html"><span>← Previous</span><b>{label}</b></a>')
    else:
        parts.append("<span></span>")
    if idx < len(ORDER) - 1:
        s, label = ORDER[idx + 1]
        parts.append(f'<a class="pn pn--next" href="{s}.html"><span>Next →</span><b>{label}</b></a>')
    parts.append("</nav>")
    return "\n".join(parts)


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{title} · OpenLeads docs</title>
<meta name="description" content="{desc}" />
<meta name="theme-color" content="#08080a" />
<link rel="icon" href="../favicon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="../styles.css" />
<link rel="stylesheet" href="docs.css" />
</head>
<body class="docs">
<header class="nav" id="nav">
  <a class="brand" href="../index.html"><span class="brand__mark"></span><span class="brand__name">open<b>leads</b></span></a>
  <nav class="nav__links">
    <a href="../index.html#flow">How it works</a>
    <a href="../index.html#deliver">Deliverability</a>
    <a href="index.html" class="is-active">Docs</a>
    <a href="../index.html#compare">Compare</a>
  </nav>
  <div class="nav__cta">
    <a class="ghost-btn" href="{repo}" target="_blank" rel="noopener">GitHub</a>
    <a class="solid-btn" href="../index.html#install">Install</a>
  </div>
  <button class="dsb-toggle" id="dsbToggle" aria-label="Toggle docs menu">Menu</button>
</header>

<div class="docs__shell">
  {sidebar}
  <main class="docs__main">
    <article class="prose">
      <div class="docs__crumb"><a href="index.html">Docs</a> <span>/</span> {title}</div>
      {content}
      {prevnext}
    </article>
  </main>
  {toc}
</div>

<footer class="footer">
  <div class="container footer__legal">
    <span>© 2026 OpenLeads · PolyForm Noncommercial.</span>
    <span><a href="{repo}">GitHub</a> · <a href="https://pypi.org/project/openleads/">PyPI</a></span>
  </div>
</footer>
<script src="docs.js"></script>
</body>
</html>
"""


def build_page(slug: str, label: str) -> str:
    src = DOCS_SRC / f"{slug}.md"
    title, content, toc = render(src.read_text(encoding="utf-8"))
    title = title or label
    desc = f"OpenLeads documentation — {title}."
    return PAGE.format(title=html.escape(title), desc=html.escape(desc), repo=REPO,
                       sidebar=sidebar_html(slug), content=content,
                       toc=toc_html(toc), prevnext=prevnext_html(slug))


INDEX = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Documentation · OpenLeads</title>
<meta name="description" content="OpenLeads documentation — find anyone, verify deliverably, write and send cold email. Local-first, keyless, $0." />
<meta name="theme-color" content="#08080a" />
<link rel="icon" href="../favicon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="../styles.css" />
<link rel="stylesheet" href="docs.css" />
</head>
<body class="docs">
<header class="nav" id="nav">
  <a class="brand" href="../index.html"><span class="brand__mark"></span><span class="brand__name">open<b>leads</b></span></a>
  <nav class="nav__links">
    <a href="../index.html#flow">How it works</a>
    <a href="../index.html#deliver">Deliverability</a>
    <a href="index.html" class="is-active">Docs</a>
    <a href="../index.html#compare">Compare</a>
  </nav>
  <div class="nav__cta">
    <a class="ghost-btn" href="{repo}" target="_blank" rel="noopener">GitHub</a>
    <a class="solid-btn" href="../index.html#install">Install</a>
  </div>
</header>

<main class="docs__index">
  <div class="container">
    <p class="eyebrow">documentation</p>
    <h1 class="dindex__title">Everything you need to ship cold email.</h1>
    <p class="lead">Find anyone, verify deliverably, write the email, and send it — locally, for $0.
       Start with the quickstart, then go deep on the engine.</p>
    <div class="dcards">{cards}</div>
  </div>
</main>

<footer class="footer">
  <div class="container footer__legal">
    <span>© 2026 OpenLeads · PolyForm Noncommercial.</span>
    <span><a href="{repo}">GitHub</a> · <a href="https://pypi.org/project/openleads/">PyPI</a></span>
  </div>
</footer>
</body>
</html>
"""

CARD_BLURB = {
    "quickstart": "Zero to a sent campaign in ten minutes.",
    "deliverability": "The 7-signal engine, and why your emails land.",
    "sending": "Connect a mailbox, warm up, send safely.",
    "web": "The local dashboard — find, write, send in your browser.",
    "sources": "Add any vertical with a single Python file.",
    "architecture": "How the package fits together.",
    "how-it-works": "Inside the email-resolution engine.",
    "responsible-use": "Anti-spam law, ethics, and the guardrails.",
}


def build_index() -> str:
    cards = []
    for section, items in NAV:
        for slug, label in items:
            blurb = CARD_BLURB.get(slug, "")
            cards.append(
                f'<a class="dcard" href="{slug}.html"><span class="dcard__sec">{section}</span>'
                f'<b>{label}</b><span class="dcard__b">{blurb}</span>'
                f'<span class="dcard__go">Read →</span></a>')
    return INDEX.format(repo=REPO, cards="\n".join(cards))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for slug, label in ORDER:
        (OUT / f"{slug}.html").write_text(build_page(slug, label), encoding="utf-8")
        print(f"  ✓ docs/{slug}.html")
    (OUT / "index.html").write_text(build_index(), encoding="utf-8")
    print("  ✓ docs/index.html")
    print(f"Done — {len(ORDER) + 1} pages → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
