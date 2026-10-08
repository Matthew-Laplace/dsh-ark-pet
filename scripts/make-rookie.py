#!/usr/bin/env python3
"""Draw the built-in desktop pet "Rookie" as a Codex v1 spritesheet atlas.

Everything is painted with Pillow primitives. No third-party artwork, no game rips,
no downloads, no text is drawn into the image.

Atlas contract (Codex v1):
    1536 x 1872 px, RGBA, transparent background, 8 columns x 9 rows,
    cell 192 x 208 px, rows in the fixed order
    0 idle, 1 running-right, 2 running-left, 3 waving, 4 jumping,
    5 failed, 6 waiting, 7 running, 8 review.
    Frame counts per row match src/renderer.js so every drawn frame is played.
    Unused cells stay fully transparent, every used cell keeps a >= 6 px
    transparent border on all four sides.

Outputs (only these two files are written):
    assets/rookie/spritesheet.png
    assets/rookie/pet.json

Usage:
    python3 scripts/make-rookie.py            # draw, write, then verify
    python3 scripts/make-rookie.py --check    # verify existing files only
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

# ---------------------------------------------------------------- contract ---

COLS = 8
ROWS = 9
CELL_W = 192
CELL_H = 208
SHEET_W = COLS * CELL_W
SHEET_H = ROWS * CELL_H
EDGE = 6
BASE = 184.0  # y of the sole of the feet inside one cell

MAX_PNG_BYTES = 900 * 1024

# Row name and frame count. The counts follow src/renderer.js exactly; a mismatch
# would make the player show empty cells.
ROW_SPEC = (
    ("idle", 6),
    ("running-right", 8),
    ("running-left", 8),
    ("waving", 4),
    ("jumping", 5),
    ("failed", 8),
    ("waiting", 6),
    ("running", 6),
    ("review", 6),
)

ROOT = Path(__file__).resolve().parent.parent
ASSET_DIR = ROOT / "assets" / "rookie"
SPRITESHEET = ASSET_DIR / "spritesheet.png"
MANIFEST = ASSET_DIR / "pet.json"

# ---------------------------------------------------------------- palette ---

INK = (40, 46, 66, 255)
INK_DARK = (22, 26, 40, 255)
SHELL = (176, 194, 222, 255)
SHELL_DARK = (124, 142, 178, 255)
SHELL_LIGHT = (226, 238, 254, 255)
VISOR = (28, 34, 52, 255)
GLOW = (104, 246, 226, 255)
GLOW_DIM = (58, 142, 144, 255)
ACCENT = (255, 160, 76, 255)
ACCENT_LIGHT = (255, 218, 154, 255)


ARM_PIVOT = (60, 56)
ARM_REACH = 53  # pivot to the outer edge of the hand


def _arm_sprite() -> Image.Image:
    """One arm hanging straight down from a pivot at the canvas centre.

    The canvas is large enough that a full rotation is never clipped, because
    Image.rotate() keeps the original canvas size.
    """
    size = 2 * ARM_REACH + 14
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    px, py = ARM_PIVOT
    d.rounded_rectangle([px - 7, py, px + 7, py + 38], radius=7,
                        fill=SHELL_DARK, outline=INK, width=3)
    d.ellipse([px - 9, py + 36, px + 9, py + 54], fill=ACCENT,
               outline=INK, width=3)
    d.ellipse([px - 5, py + 40, px - 1, py + 44], fill=ACCENT_LIGHT)
    return img


ARM = _arm_sprite()


def paste_arm(layer: Image.Image, shoulder, angle: float) -> None:
    """Paste the arm rotated about its shoulder. Angle 0 hangs down, and a
    positive angle swings the hand to the screen right (Pillow rotates CCW)."""
    rotated = ARM.rotate(angle, resample=Image.Resampling.BICUBIC,
                         center=ARM_PIVOT, fillcolor=(0, 0, 0, 0))
    layer.alpha_composite(rotated, (round(shoulder[0] - ARM_PIVOT[0]),
                                  round(shoulder[1] - ARM_PIVOT[1])))


def draw_face(d: ImageDraw.ImageDraw, g: ImageDraw.ImageDraw,
              eye: str, mouth: str, head_dy: float) -> None:
    eye_boxes = ((80, 62, 92, 74), (100, 62, 112, 74))
    for x0, y0, x1, y1 in eye_boxes:
        y0 += head_dy
        y1 += head_dy
        if eye == "x":
            d.line([x0 + 1, y0 + 1, x1 - 1, y1 - 1], fill=GLOW_DIM, width=3)
            d.line([x0 + 1, y1 - 1, x1 - 1, y0 + 1], fill=GLOW_DIM, width=3)
            continue
        g.ellipse([x0 - 5, y0 - 5, x1 + 5, y1 + 5], fill=GLOW[:3] + (60,))
        if eye == "closed":
            mid = (y0 + y1) // 2
            d.rounded_rectangle([x0, mid - 2, x1, mid + 2], radius=2, fill=GLOW_DIM)
        elif eye == "half":
            d.rounded_rectangle([x0, y0 + 5, x1, y1], radius=4, fill=GLOW_DIM)
        elif eye == "wide":
            d.rounded_rectangle([x0 - 1, y0 - 2, x1 + 1, y1 + 1], radius=5, fill=GLOW)
        elif eye == "happy":
            d.arc([x0, y0 - 3, x1, y1 + 3], 180, 360, fill=GLOW, width=4)
        else:
            d.rounded_rectangle([x0, y0, x1, y1], radius=5, fill=GLOW)
            d.rounded_rectangle([x0 + 2, y0 + 2, x0 + 5, y0 + 5], radius=2,
                                fill=SHELL_LIGHT)

    y = 78 + head_dy
    if mouth == "open":
        d.ellipse([92, y - 2, 100, y + 4], fill=GLOW_DIM)
    elif mouth == "frown":
        d.arc([90, y - 3, 102, y + 5], 180, 360, fill=GLOW_DIM, width=3)
    elif mouth == "smile":
        d.arc([90, y - 5, 102, y + 3], 0, 180, fill=GLOW_DIM, width=3)
    else:
        d.rounded_rectangle([91, y, 101, y + 3], radius=1, fill=GLOW_DIM)


def render_frame(p: dict) -> Image.Image:
    """Paint one 192x208 cell from a pose dictionary."""
    base = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    glow = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(base)
    g = ImageDraw.Draw(glow)

    body = p.get("body_dy", 0.0)
    head = body + p.get("head_dy", 0.0)
    leg_l = p.get("leg_l", 0.0)
    leg_r = p.get("leg_r", 0.0)

    # legs and feet, drawn first so the torso overlaps the hip joints
    for (x0, x1), lift in (((80, 92), leg_l), ((100, 112), leg_r)):
        d.rounded_rectangle([x0, 146 - lift, x1, 172 - lift], radius=6,
                            fill=SHELL_DARK, outline=INK, width=3)
        d.rounded_rectangle([x0 - 6, 168 - lift, x1 + 6, BASE - lift], radius=7,
                            fill=SHELL, outline=INK, width=3)

    # arms sit behind the torso
    paste_arm(base, (70, 108 + body), p.get("arm_l", 0.0))
    paste_arm(base, (122, 108 + body), p.get("arm_r", 0.0))

    # torso
    d.rounded_rectangle([64, 96 + body, 128, 152 + body], radius=16,
                        fill=SHELL, outline=INK, width=3)
    d.rounded_rectangle([72, 102 + body, 94, 109 + body], radius=4, fill=SHELL_LIGHT)
    d.rounded_rectangle([78, 110 + body, 114, 138 + body], radius=9,
                        fill=VISOR, outline=INK_DARK, width=2)
    g.ellipse([84, 112 + body, 108, 136 + body], fill=ACCENT[:3] + (70,))
    d.ellipse([88, 116 + body, 104, 132 + body], fill=ACCENT,
              outline=ACCENT_LIGHT, width=2)
    for i in range(3):
        x = 82 + i * 6
        d.ellipse([x, 141 + body, x + 3, 144 + body], fill=ACCENT_LIGHT)

    # neck
    d.rounded_rectangle([88, 86 + body, 104, 100 + body], radius=4, fill=INK)

    # side bolts
    d.ellipse([54, 58 + head, 70, 76 + head], fill=ACCENT, outline=INK, width=3)
    d.ellipse([122, 58 + head, 138, 76 + head], fill=ACCENT, outline=INK, width=3)

    # head shell
    d.rounded_rectangle([64, 44 + head, 128, 96 + head], radius=16,
                        fill=SHELL, outline=INK, width=3)
    d.rounded_rectangle([72, 50 + head, 98, 57 + head], radius=4, fill=SHELL_LIGHT)

    # visor and face
    d.rounded_rectangle([72, 56 + head, 120, 84 + head], radius=10,
                        fill=VISOR, outline=INK_DARK, width=2)
    draw_face(d, g, p.get("eye", "open"), p.get("mouth", "line"), head)

    # antenna
    tip_x = 96 + p.get("antenna_dx", 0.0)
    tip_y = 34 + head + p.get("antenna_dy", 0.0)
    d.line([96, 48 + head, tip_x, tip_y + 5], fill=INK, width=3)
    g.ellipse([tip_x - 9, tip_y - 9, tip_x + 9, tip_y + 9],
               fill=ACCENT[:3] + (60,))
    d.ellipse([tip_x - 5, tip_y - 5, tip_x + 5, tip_y + 5], fill=ACCENT,
              outline=INK, width=2)

    base.alpha_composite(glow)
    return base


def clean_alpha(layer: Image.Image, floor: int = 16) -> Image.Image:
    """Drop the alpha fringes below 16 that BICUBIC resampling leaves behind."""
    r, g, b, a = layer.split()
    a = a.point(lambda v: 0 if v < floor else v)
    return Image.merge("RGBA", (r, g, b, a))


def dim_layer(layer: Image.Image, factor: float) -> Image.Image:
    if factor >= 0.999:
        return layer
    r, g, b, a = layer.split()
    scale = lambda v: min(255, int(round(v * factor)))
    return Image.merge("RGBA", (r.point(scale), g.point(scale), b.point(scale), a))


def pose(layer: Image.Image, lean: float, ox: float, oy: float) -> Image.Image:
    """Shear around the feet, then shift. Positive lean tips the top to the right."""
    if lean == 0.0 and ox == 0.0 and oy == 0.0:
        return layer
    c = -lean * BASE - lean * oy - ox
    return layer.transform((CELL_W, CELL_H), Image.Transform.AFFINE,
                           (1, lean, c, 0, 1, -oy),
                           resample=Image.Resampling.BICUBIC)


# ------------------------------------------------------------ animations ---


def anim_idle() -> list[dict]:
    breath = (0.0, -1.4, -2.4, -2.4, -1.4, 0.0)
    frames = []
    for i, b in enumerate(breath):
        frames.append(dict(
            body_dy=b,
            head_dy=-0.3 * b,
            arm_l=-7 - 2 * b,
            arm_r=7 + 2 * b,
            antenna_dx=0.8 * b,
            eye="closed" if i == 3 else "open",
            mouth="line",
        ))
    return frames


RUN8 = (
    # leg_l, leg_r, swing, body_dy, mouth
    (0.0, 13.0, 1.00, -0.5, "open"),
    (7.0, 14.0, 0.55, -2.6, "line"),
    (14.0, 7.0, 0.10, -3.0, "line"),
    (13.0, 0.0, -0.45, -1.4, "line"),
    (13.0, 0.0, -1.00, -0.5, "open"),
    (14.0, 7.0, -0.55, -2.6, "line"),
    (7.0, 14.0, -0.10, -3.0, "line"),
    (0.0, 13.0, 0.45, -1.4, "line"),
)


def _run(lean: float, ox: float, mirror: bool) -> list[dict]:
    frames = []
    for leg_l, leg_r, swing, body, mouth in RUN8:
        if mirror:
            leg_l, leg_r = leg_r, leg_l
            swing = -swing
        frames.append(dict(
            body_dy=body,
            head_dy=-0.4 * swing,
            arm_l=-8 - 44 * swing,
            arm_r=8 + 44 * swing,
            leg_l=leg_l,
            leg_r=leg_r,
            antenna_dx=1.4 * swing,
            lean=lean,
            ox=ox,
            eye="open",
            mouth=mouth,
        ))
    return frames


def anim_waving() -> list[dict]:
    frames = []
    for i, (arm, tilt) in enumerate(((118, 0.0), (156, 1.5), (118, 0.0), (156, 1.5))):
        frames.append(dict(
            body_dy=-0.6 * (i % 2),
            head_dy=-0.8,
            arm_l=-9,
            arm_r=arm,
            antenna_dx=tilt,
            lean=0.02,
            ox=0.0,
            eye="happy",
            mouth="smile",
        ))
    return frames


def anim_jumping() -> list[dict]:
    up = (0.0, -7.0, -13.0, -10.0, -3.0)
    tuck = (0.0, 5.0, 11.0, 7.0, 0.0)
    arm = (16.0, 40.0, 58.0, 48.0, 20.0)
    eye = ("wide", "wide", "wide", "wide", "open")
    frames = []
    for i, (oy, tk, ar, ey) in enumerate(zip(up, tuck, arm, eye)):
        frames.append(dict(
            body_dy=-0.4 * i,
            head_dy=-1.2,
            arm_l=-ar,
            arm_r=ar,
            leg_l=tk,
            leg_r=tk,
            antenna_dx=-1.6,
            antenna_dy=-2.0,
            lean=0.0,
            ox=0.0,
            oy=oy,
            eye=ey,
            mouth="open",
        ))
    return frames


def anim_failed() -> list[dict]:
    droop = (3.0, 3.4, 3.8, 4.0, 4.0, 3.8, 3.4, 3.0)
    head = (4.0, 4.6, 5.2, 5.4, 5.4, 5.2, 4.6, 4.0)
    frames = []
    for i, (b, h) in enumerate(zip(droop, head)):
        sway = math.sin(2 * math.pi * i / 8)
        frames.append(dict(
            body_dy=b,
            head_dy=h + 0.4 * sway,
            arm_l=-3 - 1.5 * sway,
            arm_r=3 + 1.5 * sway,
            antenna_dx=-2.4 + 1.6 * sway,
            antenna_dy=2.0,
            eye="x",
            mouth="frown",
            dim=0.84,
            ox=0.0,
        ))
    return frames


def anim_waiting() -> list[dict]:
    flicker = (1.0, 0.72, 0.80, 0.72, 0.88, 0.98)
    frames = []
    for f in flicker:
        frames.append(dict(
            body_dy=0.0,
            head_dy=0.0,
            arm_l=-6,
            arm_r=6,
            eye="half",
            mouth="line",
            dim=f,
        ))
    return frames


RUN6 = (
    # leg_l, leg_r, swing, body_dy
    (0.0, 13.0, 1.00, -0.5),
    (8.0, 14.0, 0.60, -2.5),
    (14.0, 7.0, 0.10, -3.0),
    (13.0, 0.0, -1.00, -0.5),
    (7.0, 0.0, -0.60, -2.5),
    (0.0, 8.0, -0.10, -3.0),
)


def anim_running() -> list[dict]:
    frames = []
    for leg_l, leg_r, swing, body in RUN6:
        frames.append(dict(
            body_dy=body,
            head_dy=-0.5 * swing,
            arm_l=-6 - 64 * swing,
            arm_r=6 + 64 * swing,
            leg_l=leg_l,
            leg_r=leg_r,
            antenna_dx=2.0 * swing,
            lean=0.05 * swing,
            ox=0.0,
            eye="open",
            mouth="open" if abs(swing) > 0.7 else "line",
        ))
    return frames


def anim_review() -> list[dict]:
    nod = (0.0, 3.0, 5.0, 0.0, 3.0, 5.0)
    frames = []
    for n in nod:
        frames.append(dict(
            body_dy=0.0,
            head_dy=n,
            arm_l=-8,
            arm_r=42,
            antenna_dx=0.6 * n,
            lean=0.05,
            ox=1.0,
            eye="open",
            mouth="line" if n < 4 else "smile",
        ))
    return frames


ROW_FRAMES = (
    anim_idle,
    lambda: _run(0.10, 7.0, False),
    lambda: _run(-0.10, -7.0, True),
    anim_waving,
    anim_jumping,
    anim_failed,
    anim_waiting,
    anim_running,
    anim_review,
)


# ---------------------------------------------------------------- assembly ---


def build_sheet() -> Image.Image:
    sheet = Image.new("RGBA", (SHEET_W, SHEET_H), (0, 0, 0, 0))
    for row, (name, count) in enumerate(ROW_SPEC):
        frames = ROW_FRAMES[row]()
        if len(frames) != count:
            raise SystemExit(f"row {row} ({name}) wants {count} frames, got {len(frames)}")
        for col in range(COLS):
            if col >= count:
                continue  # unused cells stay fully transparent
            p = frames[col]
            cell = clean_alpha(pose(dim_layer(render_frame(p), p.get("dim", 1.0)),
                                  p.get("lean", 0.0), p.get("ox", 0.0), p.get("oy", 0.0)))
            sheet.alpha_composite(cell, (col * CELL_W, row * CELL_H))
    return sheet


def quantize_alpha(img: Image.Image, levels: int) -> Image.Image:
    """Collapse the alpha channel to fewer steps so the PNG compresses harder."""
    step = max(1, 256 // levels)
    r, g, b, a = img.split()
    a = a.point(lambda v: 0 if v < step else min(255, ((v + step // 2) // step) * step))
    return Image.merge("RGBA", (r, g, b, a))


def encode_png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True, compress_level=9)
    return buf.getvalue()


def write_spritesheet(sheet: Image.Image) -> tuple[bytes, int | None]:
    """Encode under the size cap, tightening the alpha steps only if needed."""
    for levels in (None, 24, 12, 6):
        img = sheet if levels is None else quantize_alpha(sheet, levels)
        data = encode_png(img)
        if len(data) <= MAX_PNG_BYTES:
            return data, levels
    raise SystemExit(f"spritesheet.png stays above {MAX_PNG_BYTES} bytes")


# ------------------------------------------------------------- validation ---


def cell_stats(img: Image.Image) -> tuple[list[int], list[tuple[int, tuple[int, int, int, int] | None]]]:
    row_counts = []
    cells = []
    for row in range(ROWS):
        total = 0
        for col in range(COLS):
            cell = img.crop((col * CELL_W, row * CELL_H, (col + 1) * CELL_W, (row + 1) * CELL_H))
            alpha = cell.getchannel("A")
            bbox = alpha.getbbox()
            hist = alpha.point(lambda v: 255 if v > 0 else 0).histogram()
            count = hist[255]
            total += count
            cells.append((row, col, bbox, count))
        row_counts.append(total)
    return row_counts, cells


def validate(img: Image.Image) -> list[int]:
    problems = []
    if img.size != (SHEET_W, SHEET_H):
        problems.append(f"size is {img.size}, expected {(SHEET_W, SHEET_H)}")
    if img.mode != "RGBA":
        problems.append(f"mode is {img.mode}, expected RGBA")

    row_counts, cells = cell_stats(img)
    for row, (name, count) in enumerate(ROW_SPEC):
        if row_counts[row] <= 0:
            problems.append(f"row {row} ({name}) has no opaque pixel")
        used = 0
        for r, c, bbox, n in cells:
            if r != row:
                continue
            if n == 0:
                continue
            used += 1
            left, top, right, bottom = bbox
            if min(left, top, CELL_W - right, CELL_H - bottom) < EDGE:
                problems.append(
                    f"row {row} col {c} transparent border < {EDGE}px: {bbox}")
        if used != count:
            problems.append(f"row {row} ({name}) drew {used} frames, expected {count}")

    if problems:
        for line in problems:
            print(f"FAIL {line}", file=sys.stderr)
        raise SystemExit(1)
    return row_counts


def report(path: Path, data: bytes, img: Image.Image, row_counts: list[int],
           levels: int | None) -> None:
    print(f"file      {path}")
    print(f"bytes     {len(data)} (cap {MAX_PNG_BYTES})")
    print(f"sha256    {hashlib.sha256(data).hexdigest()}")
    print(f"size      {img.size[0]}x{img.size[1]} mode={img.mode}")
    print(f"alpha     {'full 8 bit' if levels is None else f'{levels} levels'}")
    print("rows      non-transparent pixels")
    for row, (name, count) in enumerate(ROW_SPEC):
        print(f"  {row} {name:<14} {row_counts[row]:>7}  frames={count}")


def write_manifest() -> bytes:
    manifest = {
        "id": "rookie",
        "displayName": "Rookie",
        "description": "原创小机器人 Rookie，全部由 Python 代码绘制，不含任何第三方素材。 / An original little robot drawn entirely in Python code, with no third-party assets.",
        "kind": "atlas",
        "spritesheetPath": "spritesheet.png",
        "spriteVersionNumber": 1,
    }
    data = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    MANIFEST.write_bytes(data)
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate the Rookie pet atlas.")
    parser.add_argument("--check", action="store_true",
                        help="verify the existing files without redrawing them")
    args = parser.parse_args()

    if args.check:
        if not SPRITESHEET.exists() or not MANIFEST.exists():
            raise SystemExit("assets/rookie is incomplete; run without --check first")
        data = SPRITESHEET.read_bytes()
        img = Image.open(io.BytesIO(data))
        img.load()
        img = img.convert("RGBA")
        if len(data) > MAX_PNG_BYTES:
            raise SystemExit(f"spritesheet.png is {len(data)} bytes, over the cap")
        report(SPRITESHEET, data, img, validate(img), None)
        print(f"manifest  {MANIFEST} ({MANIFEST.stat().st_size} bytes) ok")
        print("check     OK")
        return 0

    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    sheet = build_sheet()
    data, levels = write_spritesheet(sheet)
    SPRITESHEET.write_bytes(data)

    written = SPRITESHEET.read_bytes()
    reloaded = Image.open(io.BytesIO(written))
    reloaded.load()
    reloaded = reloaded.convert("RGBA")
    if len(written) > MAX_PNG_BYTES:
        raise SystemExit(f"spritesheet.png is {len(written)} bytes, over the cap")
    row_counts = validate(reloaded)

    manifest_data = write_manifest()
    manifest = json.loads(MANIFEST.read_text("utf-8"))
    assert manifest["spritesheetPath"] == SPRITESHEET.name
    assert manifest["spriteVersionNumber"] == 1
    assert manifest["kind"] == "atlas"

    report(SPRITESHEET, written, reloaded, row_counts, levels)
    print(f"manifest  {MANIFEST} ({len(manifest_data)} bytes) ok")
    print("verify    OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
