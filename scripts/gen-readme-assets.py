#!/usr/bin/env python3
"""README visuals for dsh-docx-redline — v5.

Outputs (overwritten in place, never deleted):
  docs/assets/dsh-docx-redline-hero-{zh,en}-{light,dark}.webp   1440 x 576
  docs/assets/dsh-docx-redline-flow-v5-{light,dark}.svg         1100 x 660

Both figures are derived from the real pipeline in src/plugin/tools.ts and
src/adapters/docx-zip.ts:

  local .docx -> realpath allowlist -> safeUnzip limits -> inspectDocx()
  (per-part SHA-256 + 13 structure counts) -> docx domain (documents table)
  -> doc_roundtrip copies the package, unpacks both sides and compares every
  part hash; redline_diff does paragraph LCS; doc_replace_text rewrites one
  exact w:t run; change_summary / relationship_check stay read-only.

Hero (per language): a document page (paragraph/table/header/footer tags), the
part ledger with SHA-256 prefixes, and the paragraph-level redline strip —
the three things the plugin actually returns.

Flow (language-neutral, one pair serves all five READMEs): a two-sided
boundary — the source package on the left, the roundtrip copy on the right,
and a part-by-part SHA-256 seam in the middle that ends in the zero_diff
verdict. Deliberately not a five-node chevron row, and no invented feature.

Fonts: msyh.ttc / msyhbd.ttc (CJK), consola.ttf (mono), segoeui(b).ttf (EN).
Every SVG label is measured with the same TTFs before it is written, so a
label that would overflow its box fails the build instead of clipping in
Chrome.
"""
from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET
from functools import lru_cache
from html import escape

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

FONT_CJK = r"C:\Windows\Fonts\msyh.ttc"
FONT_CJK_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_MONO = r"C:\Windows\Fonts\consola.ttf"
FONT_EN = r"C:\Windows\Fonts\segoeui.ttf"
FONT_EN_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"
for _path in (FONT_CJK, FONT_CJK_BOLD, FONT_MONO, FONT_EN, FONT_EN_BOLD):
    if not os.path.exists(_path):
        sys.exit(f"FATAL: font missing: {_path}")

# Family palette (accent #4B67B4 / #8496f5) on the GitHub light/dark page.
SKIN = {
    "light": dict(bg_from="#f9f6fd", bg_to="#e4eaf8", card="#ffffff",
                  card_edge="#e4e1ee", text="#141419", sub="#4d5261",
                  faint="#8f94a4", accent="#4B67B4", accent2="#16a34a",
                  warn="#bc4c00", pill="#ece7f9", grid="#e7e4f0",
                  body="#dcd7ea", zone="#f7f5fc", shadow=(32, 26, 64),
                  dots="#dcd6ea", dot_opacity="0.45", shadow_opacity="0.10"),
    "dark": dict(bg_from="#131a2a", bg_to="#0c1016", card="#1b2231",
                 card_edge="#2e374b", text="#f0f3f9", sub="#a8b1c4",
                 faint="#7f8798", accent="#8496f5", accent2="#3fb950",
                 warn="#d29922", pill="#242d42", grid="#252c3d",
                 body="#2e374b", zone="#161d2b", shadow=(0, 0, 0),
                 dots="#1e2636", dot_opacity="0.55", shadow_opacity="0.55"),
}

HERO = {
    "zh": dict(
        kicker="DeepSeek Harness · DOCX 核对",
        title_a="dsh-docx-", title_b="redline",
        value=["结构查得清，往返证得明", "两版正文逐段比出来"],
        sub="逐部件 SHA-256 · 13 项结构计数 · 不联网",
        meta="6 个工具 · R0 只读 / R1 本地写 · 原件不改写",
        foot="Apache-2.0 · PerryLink DSH plugin family",
        page_tags=["p 11", "tbl 1", "hdr 1"],
        diff=["− 120,000 元", "+ 150,000 元"],
        diff_note="段落级 · 只读",
        diff_chip="+2 −1 · 3 hunks",
        rail="per-part SHA-256 · 13 counts · zero_diff evidence",
        rail_right="no network",
    ),
    "en": dict(
        kicker="DeepSeek Harness · DOCX checks",
        title_a="dsh-docx-", title_b="redline",
        value=["Structure verified, roundtrip proven",
               "two versions diffed by paragraph"],
        sub="per-part SHA-256 · 13 structure counts · local only",
        meta="6 tools · R0 read-only / R1 local write · originals untouched",
        foot="Apache-2.0 · PerryLink DSH plugin family",
        page_tags=["p 11", "tbl 1", "hdr 1"],
        diff=["− 120,000 CNY", "+ 150,000 CNY"],
        diff_note="paragraph · read-only",
        diff_chip="+2 −1 · 3 hunks",
        rail="per-part SHA-256 · 13 counts · zero_diff evidence",
        rail_right="no network",
    ),
}

# Real parts of samples/quickstart/input/contract-v1.docx (9 parts, 3760 B).
# Sizes and SHA-256 prefixes below are read verbatim from that fixture.
PARTS = [
    ("[Content_Types].xml", "1076 B", "ed56980c9c"),
    ("_rels/.rels", "297 B", "d8b0bad955"),
    ("word/document.xml", "1877 B", "7f83997898"),
    ("word/_rels/document.xml.rels", "982 B", "8b9583374c"),
    ("word/styles.xml", "469 B", "48b386de85"),
]


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------
def hx(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def blend(c1: str, c2: str, t: float) -> tuple[int, int, int]:
    return tuple(int(a + (b - a) * t) for a, b in zip(hx(c1), hx(c2)))


@lru_cache(maxsize=None)
def font(size: int, kind: str = "cjk_bold") -> ImageFont.FreeTypeFont:
    return ImageFont.truetype({
        "cjk": FONT_CJK,
        "cjk_bold": FONT_CJK_BOLD,
        "mono": FONT_MONO,
        "en": FONT_EN,
        "en_bold": FONT_EN_BOLD,
    }[kind], size)


def gradient(w: int, h: int, c1: str, c2: str) -> Image.Image:
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    a, b = hx(c1), hx(c2)
    for y in range(h):
        t = 0.2 * (y / h) + 0.8 * (y / h) ** 1.5
        d.line([(0, y), (w, y)],
               fill=tuple(int(p + (q - p) * t) for p, q in zip(a, b)))
    return img


def glow(img: Image.Image, cx: int, cy: int, radius: int, color,
         alpha: int) -> Image.Image:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(9, 0, -1):
        r = radius * i / 9
        d.ellipse([cx - r, cy - r, cx + r, cy + r],
                  fill=color + (int(alpha * (1 - i / 10)),))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def card(img: Image.Image, box, s, radius=20, shadow=22) -> Image.Image:
    x0, y0, x1, y1 = box
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(shadow, 0, -3):
        d.rounded_rectangle(
            [x0 - i // 4, y0 + i // 2, x1 + i // 4, y1 + i],
            radius=radius + i // 4,
            fill=s["shadow"] + (int(9 * (1 - i / shadow)),))
    base = Image.alpha_composite(img.convert("RGBA"),
                                 layer.filter(ImageFilter.GaussianBlur(11)))
    ImageDraw.Draw(base).rounded_rectangle(
        box, radius=radius, fill=hx(s["card"]),
        outline=hx(s["card_edge"]), width=2)
    return base.convert("RGB")


def fit(d: ImageDraw.ImageDraw, text: str, maxw: float, kind: str,
        start: int, floor: int, step: int = 2) -> int:
    size = start
    while size > floor and d.textlength(text, font=font(size, kind)) > maxw:
        size -= step
    if d.textlength(text, font=font(size, kind)) > maxw:
        raise SystemExit(f"FATAL: text does not fit {maxw}px: {text!r}")
    return size


def tag(img: Image.Image, x: int, y: int, text: str, s, size=14,
        fg=None, bg=None) -> int:
    d = ImageDraw.Draw(img)
    f = font(size, "mono")
    width = d.textlength(text, font=f)
    h = size + 8
    d.rounded_rectangle([x, y, x + width + 20, y + h], radius=h // 2,
                        fill=hx(bg or s["pill"]))
    d.text((x + 10, y + 4), text, font=f, fill=hx(fg or s["accent"]))
    return int(x + width + 20)


def mini_doc(d: ImageDraw.ImageDraw, x: int, y: int, color) -> None:
    d.rounded_rectangle([x, y, x + 13, y + 18], radius=2,
                        outline=color, width=2)
    d.line([x + 4, y + 6, x + 9, y + 6], fill=color, width=2)
    d.line([x + 4, y + 10, x + 9, y + 10], fill=color, width=2)


# ---------------------------------------------------------------------------
# hero (1440 x 576)
# ---------------------------------------------------------------------------
def hero_sheet(img: Image.Image, s, lang: str) -> Image.Image:
    img = card(img, (792, 56, 1058, 456), s, radius=20)
    d = ImageDraw.Draw(img)
    # family bookmark strip on the page edge
    d.rounded_rectangle([800, 72, 808, 440], radius=4, fill=hx(s["accent"]))
    # running header
    d.rounded_rectangle([824, 86, 858, 90], radius=2, fill=hx(s["faint"]))
    d.rounded_rectangle([866, 86, 888, 90], radius=2, fill=hx(s["faint"]))
    d.line([824, 104, 1036, 104], fill=hx(s["grid"]), width=2)
    # heading + body lines
    d.rounded_rectangle([824, 120, 940, 132], radius=6, fill=hx(s["text"]))
    for y, width in ((156, 190), (178, 168), (200, 196), (222, 148),
                     (244, 174)):
        d.rounded_rectangle([824, y, 824 + width, y + 7], radius=3,
                            fill=hx(s["body"]))
    # table: the sample contract has 1 table, 2 rows and 4 cells
    d.rounded_rectangle([824, 266, 1036, 358], radius=8, fill=hx(s["zone"]),
                        outline=hx(s["card_edge"]), width=2)
    d.rounded_rectangle([826, 268, 1034, 312], radius=6, fill=hx(s["pill"]))
    d.line([826, 312, 1034, 312], fill=hx(s["body"]), width=2)
    d.line([936, 268, 936, 356], fill=hx(s["body"]), width=2)
    for x, width in ((842, 50), (952, 40)):
        d.rounded_rectangle([x, 282, x + width, 287], radius=2,
                            fill=hx(s["faint"]))
    for x, width in ((842, 62), (952, 46)):
        d.rounded_rectangle([x, 330, x + width, 335], radius=2,
                            fill=hx(s["body"]))
    # measured tags: the three counts a reader checks first
    x = 824
    for text in HERO[lang]["page_tags"]:
        x = tag(img, x, 370, text, s, size=14) + 8
    # running footer + page number
    d = ImageDraw.Draw(img)
    d.line([824, 410, 1036, 410], fill=hx(s["grid"]), width=2)
    d.rounded_rectangle([824, 422, 884, 427], radius=2, fill=hx(s["faint"]))
    d.rounded_rectangle([892, 422, 932, 427], radius=2, fill=hx(s["faint"]))
    d.text((1036, 415), "ftr 1", font=font(13, "mono"),
           fill=hx(s["faint"]), anchor="ra")
    return img


def hero_ledger(img: Image.Image, s, lang: str) -> Image.Image:
    img = card(img, (1078, 56, 1392, 312), s, radius=20)
    d = ImageDraw.Draw(img)
    d.text((1100, 70), "OOXML parts", font=font(17, "mono"),
           fill=hx(s["accent"]))
    d.text((1370, 70), "9", font=font(17, "mono"),
           fill=hx(s["faint"]), anchor="ra")
    d.line([1100, 108, 1370, 108], fill=hx(s["grid"]), width=2)
    rows = [("[Content_Types].xml", "ed56980c9c"),
            ("word/document.xml", "7f83997898"),
            ("word/header1.xml", "1f70cdd0c7"),
            ("word/comments.xml", "1a59019b1d")]
    for i, (name, digest) in enumerate(rows):
        y = 120 + i * 38
        d.text((1100, y + 10), name, font=font(15, "mono"),
               fill=hx(s["text"]))
        d.text((1340, y + 12), digest, font=font(13, "mono"),
               fill=hx(s["faint"]), anchor="ra")
        cx, cy = 1360, y + 19
        d.ellipse([cx - 7, cy - 7, cx + 7, cy + 7],
                  fill=blend(s["accent2"], s["card"], 0.18),
                  outline=hx(s["accent2"]), width=2)
        d.line([cx - 3, cy, cx - 0.5, cy + 3],
               fill=hx(s["accent2"]), width=2)
        d.line([cx - 0.5, cy + 3, cx + 4, cy - 4],
               fill=hx(s["accent2"]), width=2)
    d.text((1100, 282), "+5 more parts", font=font(14, "mono"),
           fill=hx(s["faint"]))
    d.text((1370, 282), "13 counts", font=font(14, "mono"),
           fill=hx(s["faint"]), anchor="ra")
    return img


def hero_diff(img: Image.Image, s, lang: str) -> Image.Image:
    img = card(img, (1078, 332, 1392, 456), s, radius=20)
    d = ImageDraw.Draw(img)
    h = HERO[lang]
    d.text((1100, 346), "redline_diff", font=font(17, "mono"),
           fill=hx(s["accent"]))
    d.text((1370, 348), h["diff_note"],
           font=font(14, "cjk" if lang == "zh" else "en"),
           fill=hx(s["faint"]), anchor="ra")
    kind = "cjk" if lang == "zh" else "en"
    d.text((1100, 376), h["diff"][0], font=font(15, kind),
           fill=hx(s["warn"]))
    d.text((1100, 400), h["diff"][1], font=font(15, kind),
           fill=hx(s["accent2"]))
    fchip = font(14, "mono")
    cw = d.textlength(h["diff_chip"], font=fchip)
    d.rounded_rectangle([1100, 424, 1100 + cw + 24, 448], radius=12,
                        fill=hx(s["pill"]))
    d.text((1112, 428), h["diff_chip"], font=fchip, fill=hx(s["accent"]))
    return img


def hero_rail(img: Image.Image, s, lang: str) -> Image.Image:
    img = card(img, (792, 480, 1392, 524), s, radius=22, shadow=14)
    d = ImageDraw.Draw(img)
    h = HERO[lang]
    d.ellipse([812, 495, 822, 505], fill=hx(s["accent2"]))
    d.text((832, 492), h["rail"], font=font(15, "mono"),
           fill=hx(s["sub"]))
    d.text((1370, 493), h["rail_right"], font=font(14, "mono"),
           fill=hx(s["faint"]), anchor="ra")
    return img


def hero_left(img: Image.Image, s, lang: str) -> Image.Image:
    d = ImageDraw.Draw(img)
    h = HERO[lang]
    # kicker with a tiny page glyph
    f = font(18, "cjk_bold")
    w = d.textlength(h["kicker"], font=f)
    x, y, ph = 64, 66, 40
    d.rounded_rectangle([x, y, x + w + 58, y + ph], radius=ph // 2,
                        fill=hx(s["pill"]))
    mini_doc(d, x + 18, y + 11, hx(s["accent"]))
    d.text((x + 40, y + 8), h["kicker"], font=f, fill=hx(s["accent"]))
    # title (mono, display >= 48px at 880 width)
    size = 84
    while size > 79 and d.textlength(
            h["title_a"] + h["title_b"], font=font(size, "mono")) > 700:
        size -= 1
    if d.textlength(h["title_a"] + h["title_b"],
                    font=font(size, "mono")) > 700:
        raise SystemExit("FATAL: hero title does not fit the left column")
    title_font = font(size, "mono")
    d.text((64, 124), h["title_a"], font=title_font, fill=hx(s["text"]))
    d.text((64 + d.textlength(h["title_a"], font=title_font), 124),
           h["title_b"], font=title_font, fill=hx(s["accent"]))
    # two-line value statement
    kind = "cjk_bold" if lang == "zh" else "en_bold"
    y = 248
    for line in h["value"]:
        vf = font(fit(d, line, 690, kind, 40, 34), kind)
        d.text((64, y), line, font=vf, fill=hx(s["text"]))
        y += 58
    # subline / meta / footer
    sub_kind = "cjk" if lang == "zh" else "en"
    d.text((66, 384), h["sub"],
           font=font(fit(d, h["sub"], 690, sub_kind, 25, 22), sub_kind),
           fill=hx(s["sub"]))
    d.text((66, 432), h["meta"],
           font=font(fit(d, h["meta"], 690, sub_kind, 20, 18), sub_kind),
           fill=hx(s["faint"]))
    d.line([64, 476, 640, 476], fill=hx(s["grid"]), width=2)
    d.text((66, 490), h["foot"], font=font(17, "en"), fill=hx(s["faint"]))
    return img


def hero(lang: str, skin: str) -> None:
    s = SKIN[skin]
    img = gradient(1440, 576, s["bg_from"], s["bg_to"])
    img = glow(img, 1150, 70, 430, hx(s["accent"]),
               30 if skin == "light" else 46)
    img = glow(img, 140, 570, 300, hx(s["accent2"]),
               10 if skin == "light" else 16)
    img = hero_sheet(img, s, lang)
    img = hero_ledger(img, s, lang)
    img = hero_diff(img, s, lang)
    img = hero_rail(img, s, lang)
    img = hero_left(img, s, lang)
    path = os.path.join(OUT, f"dsh-docx-redline-hero-{lang}-{skin}.webp")
    img.save(path, "WEBP", quality=92)
    print(os.path.basename(path))


# ---------------------------------------------------------------------------
# flow (1100 x 660) — two-sided part-wise boundary
# ---------------------------------------------------------------------------
MONO = "ui-monospace, SFMono-Regular, Consolas, Menlo, monospace"
SANS = "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
_SCRATCH = ImageDraw.Draw(Image.new("RGB", (8, 8)))


def text_width(text: str, size: int, mono: bool) -> float:
    return _SCRATCH.textlength(text, font=font(size, "mono" if mono else "en"))


def t(x: float, y: float, text: str, size: int, color: str, mono: bool = True,
      weight: str | None = None, anchor: str | None = None,
      maxw: float | None = None, opacity: str | None = None) -> str:
    width = text_width(text, size, mono)
    if maxw is not None and width > maxw:
        raise SystemExit(
            f"FATAL: flow text overflows its box ({width:.1f}px > {maxw}px): "
            f"{text!r}")
    attrs = (f'x="{x}" y="{y}" fill="{color}" '
             f'font-family="{MONO if mono else SANS}" font-size="{size}"')
    if weight:
        attrs += f' font-weight="{weight}"'
    if anchor:
        attrs += f' text-anchor="{anchor}"'
    if opacity:
        attrs += f' opacity="{opacity}"'
    return f"<text {attrs}>{escape(text)}</text>"


def rect(x: float, y: float, w: float, h: float, s, fill: str,
         stroke: str | None = None, sw: float = 1.4, rx: int = 18,
         shadow: bool = False, extra: str = "") -> str:
    attrs = (f'x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" '
             f'fill="{fill}"')
    if stroke:
        attrs += f' stroke="{stroke}" stroke-width="{sw}"'
    if shadow:
        attrs += ' filter="url(#soft)"'
    if extra:
        attrs += f" {extra}"
    return f"<rect {attrs}/>"


def flow_svg(skin: str) -> str:
    s = SKIN[skin]
    W, H = 1100, 660
    out: list[str] = []
    out.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" role="img" '
        f'aria-label="dsh-docx-redline part-wise roundtrip: a local DOCX '
        f'passes the path allowlist and ZIP limits, doc_inspect hashes the '
        f'nine parts and counts the structure, doc_roundtrip copies the '
        f'package and compares the same parts, and the middle seam ends in '
        f'zero_diff; paragraph diff, exact replace, revision summary and '
        f'relationship check stay on the read-only side">')
    out.append('<title>dsh-docx-redline part-wise roundtrip</title>')
    out.append('<defs>')
    out.append(
        f'<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
        f'<stop stop-color="{s["bg_from"]}"/>'
        f'<stop offset="1" stop-color="{s["bg_to"]}"/></linearGradient>')
    out.append(
        '<filter id="soft" x="-40%" y="-40%" width="180%" height="200%">'
        f'<feDropShadow dx="0" dy="9" stdDeviation="12" '
        f'flood-color="#1b1735" flood-opacity="{s["shadow_opacity"]}"/>'
        '</filter>')
    out.append(
        f'<pattern id="dots" width="26" height="26" '
        f'patternUnits="userSpaceOnUse">'
        f'<circle cx="1.2" cy="1.2" r="1.2" fill="{s["dots"]}"/></pattern>')
    out.append('</defs>')
    out.append(f'<rect width="{W}" height="{H}" fill="url(#bg)"/>')
    out.append(f'<rect width="{W}" height="{H}" fill="url(#dots)" '
               f'opacity="{s["dot_opacity"]}"/>')

    # header
    out.append(t(50, 60, "dsh-docx-redline", 32, s["text"], weight="700"))
    out.append(t(50, 88,
                 "local .docx → per-part SHA-256 + 13 counts → part-wise "
                 "roundtrip · paragraph diff · exact replace",
                 15, s["sub"], mono=False, maxw=880))
    out.append(t(1050, 60, "9 parts · 13 counts", 15, s["faint"],
                 anchor="end", maxw=220))
    out.append(t(1050, 84, "no network · originals untouched", 14,
                 s["faint"], mono=False, anchor="end", maxw=260))

    # gate: every read passes the path allowlist and the safeUnzip limits
    out.append(rect(50, 108, 1000, 52, s, s["zone"], s["card_edge"],
                    rx=18, shadow=True))
    out.append(f'<circle cx="70" cy="134" r="4" fill="{s["accent"]}"/>')
    out.append(t(84, 140, "GATE", 15, s["accent"], weight="700", maxw=60))
    gate = ("realpath in DSH_DOCX_INPUT_ROOTS · ZIP entries ≤1000 · "
            "entry ≤4 MB · total ≤32 MB · ratio ≤100")
    out.append(t(140, 140, gate, 15, s["sub"], maxw=860))
    for gx in (245, 955):
        out.append(
            f'<line x1="{gx}" y1="160" x2="{gx}" y2="176" '
            f'stroke="{s["accent"]}" stroke-width="1.6" opacity="0.45"/>')

    # source package
    out.append(rect(50, 176, 390, 254, s, s["card"], s["card_edge"],
                    rx=18, shadow=True))
    out.append(f'<circle cx="66" cy="204" r="4" fill="{s["accent"]}"/>')
    out.append(t(78, 210, "doc_inspect", 17, s["accent"], weight="700",
                 maxw=150))
    out.append(t(418, 210, "13 counts", 14, s["faint"], anchor="end",
                 maxw=90))
    out.append(t(72, 232, "local .docx → originals/<sha>.docx", 14,
                 s["faint"], maxw=330))
    counts = "p 11 · tbl 1 · hdr 1 · ftr 1 · cmt 1 · +8"
    out.append(t(72, 252, counts, 14, s["sub"], maxw=340))
    for i, (name, size, _digest) in enumerate(PARTS):
        top = 264 + i * 28
        center = top + 14
        if i:
            out.append(f'<line x1="72" y1="{top}" x2="418" y2="{top}" '
                       f'stroke="{s["grid"]}" stroke-width="1"/>')
        out.append(t(72, center + 5, name, 15, s["text"], maxw=290))
        out.append(t(418, center + 5, size, 14, s["faint"], anchor="end",
                     maxw=70))
    out.append(t(72, 422, "+4 more parts", 14, s["faint"], maxw=160))

    # roundtrip copy
    out.append(rect(660, 176, 390, 254, s, s["card"], s["card_edge"],
                    rx=18, shadow=True))
    out.append(f'<circle cx="676" cy="204" r="4" fill="{s["accent2"]}"/>')
    out.append(t(688, 210, "doc_roundtrip", 17, s["accent"], weight="700",
                 maxw=170))
    out.append(t(1028, 210, "9 parts", 14, s["faint"], anchor="end",
                 maxw=80))
    out.append(t(682, 232, "copy → roundtrip/<doc_id>.docx", 14,
                 s["faint"], maxw=330))
    out.append(t(682, 252, "part", 14, s["faint"], maxw=60))
    out.append(t(1028, 252, "sha256", 14, s["faint"], anchor="end",
                 maxw=80))
    for i, (name, _size, digest) in enumerate(PARTS):
        top = 264 + i * 28
        center = top + 14
        if i:
            out.append(f'<line x1="682" y1="{top}" x2="1028" y2="{top}" '
                       f'stroke="{s["grid"]}" stroke-width="1"/>')
        out.append(t(682, center + 5, name, 15, s["text"], maxw=250))
        out.append(t(1028, center + 5, digest, 14, s["faint"],
                     anchor="end", maxw=90))
    out.append(t(682, 422, "parts_compared 9", 15, s["accent2"],
                 maxw=200))

    # the SHA-256 seam
    out.append(t(550, 210, "part-by-part", 17, s["accent"], weight="700",
                 anchor="middle", maxw=190))
    out.append(t(550, 232, "same part → same hash", 14, s["faint"],
                 anchor="middle", maxw=190))
    out.append(f'<line x1="550" y1="264" x2="550" y2="404" '
               f'stroke="{s["card_edge"]}" stroke-width="2" '
               f'stroke-dasharray="4 7"/>')
    for i in range(len(PARTS)):
        center = 264 + i * 28 + 14
        out.append(f'<line x1="440" y1="{center}" x2="539" y2="{center}" '
                   f'stroke="{s["accent"]}" stroke-width="1.4" '
                   f'opacity="0.40"/>')
        out.append(f'<line x1="561" y1="{center}" x2="660" y2="{center}" '
                   f'stroke="{s["accent"]}" stroke-width="1.4" '
                   f'opacity="0.40"/>')
        out.append(f'<circle cx="550" cy="{center}" r="11" '
                   f'fill="{s["card"]}" stroke="{s["accent2"]}" '
                   f'stroke-width="1.8"/>')
        out.append(t(550, center + 5, "=", 16, s["accent2"], weight="700",
                     anchor="middle", maxw=20))

    # verdict
    out.append(rect(50, 444, 1000, 58, s, s["card"], s["accent2"],
                    sw=1.6, rx=18, shadow=True))
    out.append(f'<circle cx="74" cy="473" r="5" fill="{s["accent2"]}"/>')
    out.append(t(90, 480, "zero_diff = true", 19, s["accent2"],
                 weight="700", maxw=200))
    out.append(t(340, 479, "parts_compared 9", 15, s["sub"], maxw=160))
    out.append(t(520, 479, "missing 0 · extra 0 · mismatch 0", 15,
                 s["sub"], maxw=300))
    out.append(t(1026, 479, "roundtrip/DOC-1.docx", 14, s["faint"],
                 anchor="end", maxw=180))

    # the four remaining tools, one read-only rail
    out.append(rect(50, 516, 1000, 94, s, s["card"], s["card_edge"],
                    rx=18, shadow=True))
    for x in (300, 550, 800):
        out.append(f'<line x1="{x}" y1="534" x2="{x}" y2="592" '
                   f'stroke="{s["grid"]}" stroke-width="1"/>')
    tools = [
        (74, "redline_diff", "paragraph LCS · +2 −1",
         "3 hunks · R0 read-only"),
        (324, "doc_replace_text", "one exact w:t run",
         "→ outputs/ · fail closed"),
        (574, "doc_change_summary", "w:ins 2 · w:del 1",
         "count only · R0"),
        (824, "doc_relationship_check", "r:id 6 · referenced 3",
         "issues 0 · R0"),
    ]
    for x, name, detail, note in tools:
        out.append(t(x, 546, name, 17, s["accent"], weight="700",
                     maxw=215))
        out.append(t(x, 570, detail, 14, s["sub"], maxw=220))
        out.append(t(x, 590, note, 14, s["faint"], maxw=220))

    # footer
    out.append(t(50, 636, "no network · no model call · originals never "
                          "modified", 14, s["faint"], maxw=500))
    out.append(t(1050, 636, "PerryLink DSH plugin family · Apache-2.0",
                 14, s["faint"], anchor="end", maxw=360))

    out.append("</svg>")
    svg = "\n".join(out) + "\n"
    ET.fromstring(svg)  # malformed SVG must fail here, not in Chrome
    return svg


# ---------------------------------------------------------------------------
def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for skin in ("light", "dark"):
        for lang in ("zh", "en"):
            hero(lang, skin)
    for skin in ("light", "dark"):
        path = os.path.join(OUT, f"dsh-docx-redline-flow-v5-{skin}.svg")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
        print(os.path.basename(path))


if __name__ == "__main__":
    main()
