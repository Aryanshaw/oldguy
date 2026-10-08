#!/usr/bin/env python3
"""PNG -> flat SVG for the art library (repo-only tool, never imported by shipped code).

Pipeline: cut the background (the image's alpha, or near-white flooded in from the border),
trace with vtracer, snap every fill to the nearest PALETTE.json colour (CIE76), then bake and
merge the paths so the file is small and every fill is a palette token.
--presnap snaps the pixels before tracing instead (fewer fills, but lumpier edges; see
spikes/09-flat-art/FINDINGS.md).

Usage:
  tools/art/.venv/bin/python tools/art/vectorize.py IN.png OUT.svg [--mode spline|polygon]
      [--allow tok,tok] [--presnap [--clean 2] [--min-area 60] [--merge-de 0]] [--speckle 8]
      [--max-side 1400] [--work-side 0] [--seam 0] [--opaque] [--json]
"""
import argparse
import json
import re
import sys
from io import BytesIO
from pathlib import Path

import numpy as np
import vtracer
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
PALETTE_FILE = ROOT / 'art' / 'flat' / 'PALETTE.json'


# Hex '#RRGGBB' -> (r, g, b) ints.
def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


# sRGB (N,3) uint8 array -> CIE Lab (N,3) float array, D65 white; CIE76 distance is plain Euclidean in Lab.
def rgb_to_lab(rgb):
    c = rgb.astype(np.float64) / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], axis=1)


# Load PALETTE.json as (names, rgb array, lab array).
def load_palette(path=PALETTE_FILE):
    pal = json.loads(Path(path).read_text())
    names = list(pal.keys())
    rgb = np.array([hex_rgb(pal[n]) for n in names], dtype=np.uint8)
    return names, rgb, rgb_to_lab(rgb)


# Index of the nearest palette colour (CIE76 delta E) for each row of an (N,3) rgb array.
def nearest(rgb, pal_lab):
    lab = rgb_to_lab(rgb)
    d = ((lab[:, None, :] - pal_lab[None, :, :]) ** 2).sum(axis=2)
    return d.argmin(axis=1)


# Alpha mask for the subject: the image's own alpha if it has one, else near-white flooded in from the border.
def subject_mask(img):
    if img.mode == 'RGBA' and img.getchannel('A').getextrema()[0] < 250:
        return np.array(img.getchannel('A')) >= 128
    rgb = np.array(img.convert('RGB')).astype(int)
    white = (rgb.min(axis=2) >= 235)
    # Flood fill from every border pixel through near-white pixels; what is reached is background.
    h, w = white.shape
    bg = np.zeros_like(white)
    stack = [(y, x) for y in range(h) for x in (0, w - 1)] + [(y, x) for x in range(w) for y in (0, h - 1)]
    while stack:
        y, x = stack.pop()
        if bg[y, x] or not white[y, x]:
            continue
        bg[y, x] = True
        if y > 0: stack.append((y - 1, x))
        if y < h - 1: stack.append((y + 1, x))
        if x > 0: stack.append((y, x - 1))
        if x < w - 1: stack.append((y, x + 1))
    return ~bg


# Recolour every blob smaller than min_area px, or thin enough to be a fringe, with the colour around it.
# Anti-alias fringes between two fills snap to a third palette colour; this folds them back in.
def absorb_specks(idx, min_area):
    if min_area <= 0:
        return idx
    for _ in range(3):
        changed = False
        for c in np.unique(idx):
            lab, n = ndimage.label(idx == c)
            if n == 0:
                continue
            sizes = np.bincount(lab.reshape(-1), minlength=n + 1)
            boxes = ndimage.find_objects(lab)
            # Candidates: small blobs, plus mid-size ones that might be thin fringe lines.
            for k in np.nonzero(sizes[1:] < min_area * 8)[0] + 1:
                # Work inside the blob's bounding box grown by one pixel, so this stays fast.
                sy, sx = boxes[k - 1]
                y0, x0 = max(sy.start - 1, 0), max(sx.start - 1, 0)
                win = (slice(y0, sy.stop + 1), slice(x0, sx.stop + 1))
                blob = lab[win] == k
                ring = ndimage.binary_dilation(blob) & ~blob
                around = idx[win][ring]
                if sizes[k] >= min_area:
                    # A fringe is thin (eroding it twice leaves almost nothing) and sits between two
                    # colours. A nose line is thin too but sits inside one colour, so it stays.
                    core = ndimage.binary_erosion(blob, iterations=2).sum()
                    shares = np.bincount(around) / max(around.size, 1)
                    if core >= min_area / 8 or (shares >= 0.15).sum() < 2:
                        continue
                if around.size:
                    idx[win][blob] = np.bincount(around).argmax()
                    changed = True
        if not changed:
            break
    return idx


# Snap every opaque pixel to its palette colour, then clean 1-2px fringes with a mode filter.
def presnap(rgb, mask, pal_rgb, pal_lab, clean, min_area=60, merge_de=0.0, allow=None):
    h, w, _ = rgb.shape
    flat = rgb.reshape(-1, 3)
    idx = np.zeros(len(flat), dtype=np.int64)
    m = mask.reshape(-1)
    # Snap unique colours only (fast): most generated images have far fewer unique colours than pixels.
    uniq, inv = np.unique(flat[m], axis=0, return_inverse=True)
    # An allow-list limits the snap to some tokens (indexes into the palette); default is all of them.
    choices = np.array(sorted(allow)) if allow else np.arange(len(pal_rgb))
    idx[m] = choices[nearest(uniq, pal_lab[choices])[inv.reshape(-1)]]
    # Two palette colours closer than merge_de both showing up usually means one region split by
    # shading noise: fold the rarer one into the commoner.
    if merge_de > 0:
        counts = np.bincount(idx[m], minlength=len(pal_rgb))
        used = [c for c in np.argsort(counts) if counts[c] > 0]
        for c in used:
            others = [o for o in used if o != c and counts[o] > counts[c]]
            if not others:
                continue
            dist = np.sqrt(((pal_lab[others] - pal_lab[c]) ** 2).sum(axis=1))
            if dist.min() < merge_de:
                to = others[int(dist.argmin())]
                idx[m & (idx == c)] = to
                counts[to] += counts[c]
                counts[c] = 0
    # Encode transparency as an extra index so the mode filter treats the edge like any other colour.
    idx[~m] = len(pal_rgb)
    lab_img = Image.fromarray(idx.reshape(h, w).astype(np.uint8), mode='L')
    for _ in range(clean):
        lab_img = lab_img.filter(ImageFilter.ModeFilter(3))
    idx = absorb_specks(np.array(lab_img).astype(np.int64), min_area)
    out = np.zeros((h, w, 4), dtype=np.uint8)
    solid = idx < len(pal_rgb)
    out[solid, :3] = pal_rgb[idx[solid]]
    out[solid, 3] = 255
    return out


# Add (tx, ty) to every coordinate pair of a vtracer path (vtracer writes absolute M/L/C/Z only).
def bake(d, tx, ty, prec):
    res, pair = [], []
    for tok in re.findall(r'[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?', d):
        if tok in ('M', 'L', 'C', 'Z'):
            res.append(tok)
            continue
        # Numbers come as x,y pairs; shift each pair by the translate.
        pair.append(float(tok))
        if len(pair) == 2:
            res.append(f'{fmt(pair[0] + tx, prec)} {fmt(pair[1] + ty, prec)}')
            pair = []
    # Drop spaces around command letters; a leading '-' also separates numbers, so ' -' becomes '-'.
    return re.sub(r' ?([MLCZ]) ?', r'\1', ' '.join(res)).replace(' -', '-')


# Short number text: fixed decimals with trailing zeros removed.
def fmt(v, prec):
    s = f'{v:.{prec}f}'.rstrip('0').rstrip('.') if prec else str(int(round(v)))
    return '0' if s in ('-0', '') else s


# Parse vtracer's SVG into (fill, d) pairs in paint order, with translates baked in.
def parse_paths(svg, prec):
    paths = []
    for m in re.finditer(r'<path d="([^"]+)" fill="(#[0-9A-Fa-f]{6})"(?: transform="translate\(([-\d.]+),([-\d.]+)\)")?', svg):
        d, fill, tx, ty = m.group(1), m.group(2).upper(), float(m.group(3) or 0), float(m.group(4) or 0)
        paths.append((fill, bake(d, tx, ty, prec)))
    return paths


# Map each traced fill to its nearest palette hex (limited to the allow-list when one is given).
def snap_fills(paths, names, pal_rgb, pal_lab, allow=None):
    fills = sorted({f for f, _ in paths})
    rgb = np.array([hex_rgb(f) for f in fills], dtype=np.uint8)
    choices = np.array(sorted(allow)) if allow else np.arange(len(pal_rgb))
    idx = choices[nearest(rgb, pal_lab[choices])]
    hexes = ['#%02X%02X%02X' % tuple(int(v) for v in c) for c in pal_rgb]
    to = {f: hexes[i] for f, i in zip(fills, idx)}
    return [(to[f], d) for f, d in paths], {hexes[i]: names[i] for i in set(idx.tolist())}


# Merge runs of consecutive same-fill paths into one <path>, which keeps paint order intact.
def merge_runs(paths):
    out = []
    for fill, d in paths:
        if out and out[-1][0] == fill:
            out[-1] = (fill, out[-1][1] + d)
        else:
            out.append((fill, d))
    return out


# Full pipeline for one image; returns (svg text, stats dict).
def vectorize(src, mode='spline', presnap_on=False, clean=2, speckle=8, max_side=1400, seam=0.0, prec=1, min_area=60,
              merge_de=0.0, allow=None, work_side=0, opaque=False, color_precision=5, layer_difference=24, hierarchical='stacked'):
    names, pal_rgb, pal_lab = load_palette()
    img = Image.open(src)
    img = img.convert('RGBA') if img.mode in ('RGBA', 'LA', 'P') else img.convert('RGB')
    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side), Image.LANCZOS)
    # Tracing a bigger raster gives smoother curves (the viewBox is then in the bigger raster's px).
    scale = work_side / max(img.size) if work_side and work_side > max(img.size) else 1.0
    if scale > 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    # A full frame (scene with its ground) keeps every pixel; an item keeps only its subject.
    mask = np.ones(img.size[::-1], dtype=bool) if opaque else subject_mask(img)
    rgb = np.array(img.convert('RGB'))
    allow_idx = [names.index(t) for t in allow] if allow else None
    if presnap_on:
        rgba = presnap(rgb, mask, pal_rgb, pal_lab, clean, min_area * scale * scale, merge_de, allow_idx)
    else:
        rgba = np.dstack([rgb, (mask * 255).astype(np.uint8)])
    # Crop to the subject plus a small margin so the viewBox hugs the drawing.
    ys, xs = np.nonzero(rgba[:, :, 3])
    pad = 6
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, rgba.shape[0])
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, rgba.shape[1])
    rgba = rgba[y0:y1, x0:x1]
    h, w = rgba.shape[:2]
    buf = BytesIO()
    Image.fromarray(rgba, 'RGBA').save(buf, 'PNG')
    raw = vtracer.convert_raw_image_to_svg(
        buf.getvalue(), img_format='png', colormode='color', hierarchical=hierarchical, mode=mode,
        filter_speckle=speckle, color_precision=color_precision, layer_difference=layer_difference,
        corner_threshold=60, length_threshold=4.0, splice_threshold=45, path_precision=prec)
    paths = parse_paths(raw, prec)
    paths, used = snap_fills(paths, names, pal_rgb, pal_lab, allow_idx)
    raw_count = len(paths)
    paths = merge_runs(paths)
    # Optional same-colour hairline under each path to hide anti-alias seams (pipeline-only fallback).
    stroke = f' stroke-width="{seam}" stroke-linejoin="round"' if seam else ''
    body = ''.join(
        f'<path fill="{f}"{(" stroke=" + chr(34) + f + chr(34) + stroke) if seam else ""} d="{d}"/>' for f, d in paths)
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">{body}</svg>\n'
    stats = {
        'bytes': len(svg.encode()), 'paths_traced': raw_count, 'paths': len(paths),
        'fills': len({f for f, _ in paths}), 'tokens': sorted(used[f] for f in {f for f, _ in paths}),
        'viewBox': [0, 0, w, h], 'mode': mode, 'presnap': presnap_on, 'clean': clean, 'speckle': speckle,
        'min_area': min_area,
    }
    return svg, stats


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('src')
    ap.add_argument('out')
    ap.add_argument('--mode', default='spline', choices=['spline', 'polygon', 'none'])
    ap.add_argument('--presnap', action='store_true', help='snap pixels to the palette before tracing')
    ap.add_argument('--clean', type=int, default=2, help='mode-filter passes after presnap')
    ap.add_argument('--speckle', type=int, default=8)
    ap.add_argument('--max-side', type=int, default=1400)
    ap.add_argument('--seam', type=float, default=0.0, help='same-colour stroke width, 0 = none')
    ap.add_argument('--min-area', type=int, default=60, help='absorb blobs smaller than this many px')
    ap.add_argument('--merge-de', type=float, default=0.0, help='fold a used colour into a commoner one closer than this (CIE76)')
    ap.add_argument('--allow', default='', help='comma list of tokens the snap may use (default: all)')
    ap.add_argument('--work-side', type=int, default=0, help='upscale so the long side is this many px before tracing')
    ap.add_argument('--opaque', action='store_true', help='full frame: keep the background (scene frames)')
    ap.add_argument('--json', action='store_true', help='print stats as JSON')
    a = ap.parse_args()
    svg, stats = vectorize(a.src, a.mode, a.presnap, a.clean, a.speckle, a.max_side, a.seam, min_area=a.min_area,
                           merge_de=a.merge_de, allow=[t for t in a.allow.split(',') if t], work_side=a.work_side, opaque=a.opaque)
    Path(a.out).write_text(svg)
    if a.json:
        print(json.dumps(stats))
    else:
        print(f"{a.out}: {stats['bytes'] / 1024:.1f} KB, {stats['paths']} paths ({stats['paths_traced']} traced), "
              f"{stats['fills']} fills: {', '.join(stats['tokens'])}")


if __name__ == '__main__':
    sys.exit(main())
