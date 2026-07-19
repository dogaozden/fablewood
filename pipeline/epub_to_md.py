#!/usr/bin/env python3
"""epub_to_md.py — convert an EPUB into clean, per-chapter Markdown.

Stdlib only (Python 3.9): an EPUB is a zip of XHTML documents. We read the
OPF spine for true reading order, convert each content document to Markdown,
and write raw/vc-law/book-md/NN-<slug>.md (NN = reading order).

Fidelity is the contract: extracted fact quotes are later validated verbatim
against these Markdown files, so body text is preserved exactly (entities
unescaped by the parser; curly quotes/dashes kept as-is; only whitespace runs
collapsed, which the validator also normalizes). Headings, paragraphs, lists,
bold/italic, blockquotes, and tables are kept; nav/css/scripts/images/math
are stripped.

Usage:
    python3 pipeline/epub_to_md.py \
        "raw/vc-law/book/Venture Deals - Brad Feld.epub" \
        raw/vc-law/book-md
"""

import os
import re
import sys
import zipfile
from html.parser import HTMLParser
from xml.etree import ElementTree as ET

# Elements whose entire subtree is dropped from the Markdown.
DROP_SUBTREE = {"head", "style", "script", "svg", "img", "math", "nav"}
# Inline emphasis -> Markdown marker.
EMPHASIS = {"i": "*", "em": "*", "b": "**", "strong": "**"}


def slugify(text: str, fallback: str) -> str:
    text = (text or "").strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    if not slug:
        return fallback
    return slug[:70].strip("-")


def norm_ws(text: str) -> str:
    """Collapse every run of whitespace to a single space."""
    return re.sub(r"\s+", " ", text)


class MarkdownConverter(HTMLParser):
    """Streaming XHTML -> Markdown. convert_charrefs=True (default) means
    handle_data receives already-unescaped text."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks = []          # finished Markdown blocks
        self.cur = []             # inline fragments for the active block
        self.kind = "para"        # para | heading | li
        self.heading_level = 1
        self.drop_depth = 0       # >0 while inside a dropped subtree
        self.blockquote = 0       # blockquote nesting depth
        self.list_stack = []      # ['ul'|'ol', ...] for nesting/indent
        self.ol_counts = []       # running item number per <ol>
        self.first_heading = None
        # table state
        self.in_table = False
        self.table_rows = []
        self.cur_row = None
        self.in_cell = False
        self.cell = []

    # --- block flushing -------------------------------------------------
    def _flush(self):
        text = norm_ws("".join(self.cur))
        # Drop emphasis markers that wrap only whitespace (empty <b>/<i>, common
        # in fill-in-the-blank legal templates). Real emphasis always has a
        # non-space char between markers, so these patterns never touch it.
        prev = None
        while prev != text:
            prev = text
            text = re.sub(r"\*\*\s*\*\*", " ", text)
            text = re.sub(r"(?<!\*)\*\s*\*(?!\*)", " ", text)
        text = norm_ws(text).strip()
        self.cur = []
        if not text:
            self.kind = "para"
            return
        if self.kind == "heading":
            block = "#" * self.heading_level + " " + text
            if self.first_heading is None:
                self.first_heading = text
        elif self.kind == "li":
            depth = max(0, len(self.list_stack) - 1)
            indent = "  " * depth
            if self.list_stack and self.list_stack[-1] == "ol":
                self.ol_counts[-1] += 1
                marker = f"{self.ol_counts[-1]}. "
            else:
                marker = "- "
            block = indent + marker + text
        else:
            block = text
        if self.blockquote:
            block = "\n".join("> " + ln for ln in block.split("\n"))
        self.blocks.append(block)
        self.kind = "para"

    # --- tag handlers ---------------------------------------------------
    def handle_starttag(self, tag, attrs):
        if tag in DROP_SUBTREE:
            self.drop_depth += 1
            return
        if self.drop_depth:
            return
        if tag in EMPHASIS:
            self.cur.append(EMPHASIS[tag])
        elif tag == "br":
            self.cur.append(" ")
        elif tag == "p":
            self._flush()
            self.kind = "li" if self.list_stack else "para"
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._flush()
            self.kind = "heading"
            self.heading_level = int(tag[1])
        elif tag == "blockquote":
            self._flush()
            self.blockquote += 1
        elif tag in ("ul", "ol"):
            self._flush()
            self.list_stack.append(tag)
            self.ol_counts.append(0)
        elif tag == "li":
            self._flush()
            self.kind = "li"
        elif tag == "table":
            self._flush()
            self.in_table = True
            self.table_rows = []
        elif tag == "tr" and self.in_table:
            self.cur_row = []
        elif tag in ("td", "th") and self.in_table:
            self.in_cell = True
            self.cell = []

    def handle_startendtag(self, tag, attrs):
        # self-closing tags (pagebreak spans, anchors, br). Only <br/> matters.
        if self.drop_depth or tag in DROP_SUBTREE:
            return
        if tag == "br":
            self.cur.append(" ")

    def handle_endtag(self, tag):
        if tag in DROP_SUBTREE:
            if self.drop_depth:
                self.drop_depth -= 1
            return
        if self.drop_depth:
            return
        if tag in EMPHASIS:
            self.cur.append(EMPHASIS[tag])
        elif tag == "p":
            self._flush()
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._flush()
        elif tag == "blockquote":
            self._flush()
            if self.blockquote:
                self.blockquote -= 1
        elif tag in ("ul", "ol"):
            self._flush()
            if self.list_stack:
                self.list_stack.pop()
                self.ol_counts.pop()
        elif tag == "li":
            self._flush()
        elif tag in ("td", "th") and self.in_table:
            self.in_cell = False
            cell = norm_ws("".join(self.cell)).strip().replace("|", r"\|")
            if self.cur_row is not None:
                self.cur_row.append(cell)
        elif tag == "tr" and self.in_table:
            if self.cur_row is not None:
                self.table_rows.append(self.cur_row)
            self.cur_row = None
        elif tag == "table":
            self._emit_table()
            self.in_table = False
            self.table_rows = []

    def handle_data(self, data):
        if self.drop_depth:
            return
        if self.in_cell:
            self.cell.append(data)
        else:
            self.cur.append(data)

    # --- tables ---------------------------------------------------------
    def _emit_table(self):
        rows = [r for r in self.table_rows if r]
        if not rows:
            return
        ncol = max(len(r) for r in rows)
        rows = [r + [""] * (ncol - len(r)) for r in rows]
        header, body = rows[0], rows[1:]
        lines = ["| " + " | ".join(header) + " |",
                 "| " + " | ".join(["---"] * ncol) + " |"]
        lines += ["| " + " | ".join(r) + " |" for r in body]
        self.blocks.append("\n".join(lines))

    def result(self) -> str:
        self._flush()
        return "\n\n".join(self.blocks).strip() + "\n"


def parse_spine(zf: zipfile.ZipFile):
    """Return (opf_dir, [(idref, href), ...]) in spine order."""
    container = zf.read("META-INF/container.xml").decode("utf-8")
    opf_path = re.search(r'full-path="([^"]+)"', container).group(1)
    opf_dir = os.path.dirname(opf_path)
    root = ET.fromstring(zf.read(opf_path))
    ns = {"opf": "http://www.idpf.org/2007/opf"}
    manifest = {}
    for item in root.findall(".//opf:manifest/opf:item", ns):
        manifest[item.get("id")] = item.get("href")
    spine = []
    for ref in root.findall(".//opf:spine/opf:itemref", ns):
        idref = ref.get("idref")
        if idref in manifest:
            spine.append((idref, manifest[idref]))
    return opf_dir, spine


def build_title_map(zf: zipfile.ZipFile, opf_dir: str):
    """href (basename) -> chapter title, parsed from the nav TOC if present."""
    titles = {}
    nav_name = None
    for name in zf.namelist():
        if name.endswith("ftoc.xhtml") or name.endswith("nav.xhtml"):
            nav_name = name
            break
    if not nav_name:
        return titles
    html = zf.read(nav_name).decode("utf-8")
    for m in re.finditer(r'contentsH1"><a href="([^"#]+)"[^>]*>([^<]+)</a>', html):
        href = os.path.basename(m.group(1))
        titles[href] = re.sub(r"\s+", " ", m.group(2)).strip()
    return titles


def convert_epub(epub_path: str, out_dir: str):
    os.makedirs(out_dir, exist_ok=True)
    zf = zipfile.ZipFile(epub_path)
    opf_dir, spine = parse_spine(zf)
    titles = build_title_map(zf, opf_dir)

    results = []  # (nn, idref, href, title, md_path, n_chars, n_headings)
    counter = 0
    for idref, href in spine:
        full = os.path.join(opf_dir, href) if opf_dir else href
        try:
            raw = zf.read(full).decode("utf-8")
        except KeyError:
            continue
        conv = MarkdownConverter()
        conv.feed(raw)
        md = conv.result()
        # Skip documents with no real text (e.g. image-only cover).
        if len(re.sub(r"[^A-Za-z]", "", md)) < 20:
            continue
        counter += 1
        base = os.path.basename(href)
        title = titles.get(base) or conv.first_heading or idref
        slug = slugify(title, fallback=idref)
        nn = f"{counter:02d}"
        fname = f"{nn}-{slug}.md"
        with open(os.path.join(out_dir, fname), "w", encoding="utf-8") as f:
            f.write(md)
        n_headings = md.count("\n#") + (1 if md.startswith("#") else 0)
        results.append((nn, idref, base, title, fname, len(md), n_headings))
    return results


def main(argv):
    if len(argv) >= 2:
        epub_path = argv[1]
    else:
        book_dir = "raw/vc-law/book"
        epubs = [f for f in os.listdir(book_dir) if f.endswith(".epub")]
        if not epubs:
            print("No .epub found in", book_dir, file=sys.stderr)
            return 1
        epub_path = os.path.join(book_dir, epubs[0])
    out_dir = argv[2] if len(argv) >= 3 else "raw/vc-law/book-md"

    results = convert_epub(epub_path, out_dir)
    print(f"Converted {len(results)} documents from {epub_path}")
    print(f"Output: {out_dir}/\n")
    print(f"{'NN':>2}  {'ID':<6} {'SRC':<14} {'CHARS':>7}  TITLE")
    print("-" * 78)
    for nn, idref, base, title, fname, nchars, nh in results:
        print(f"{nn:>2}  {idref:<6} {base:<14} {nchars:>7}  {title}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
