"""Prepare the navigator albedo for the game build.

Two fixes on Meshy's 2048 base-colour atlas, both pure numpy/Pillow so the result is reproducible
from the recorded task downloads:

  1. Coat back: Meshy lost the vent, coral lining and back belt tab. The back concept plate is
     projected orthographically onto the back-facing coat texels (the plate was the generation
     input, so the silhouettes line up) and colour-matched to the surrounding coat blue.
  2. Crew accent: the coral lapels, cuffs, collar, sash and lining are classified per texel and the
     mask is stored in the PNG alpha channel. The material stays OPAQUE; the runtime reads the alpha
     as the tint mask (see client/player-character.js) and Blender/other viewers just show coral.

Usage:
  python tools/meshy/albedo.py --glb <rigged.glb> --albedo <base_color.png> --back <back-plate.jpg>
      --out <albedo_rgba.png> [--debug <dir>] [--no-project] [--sidecar <albedo.json>]

The rigged GLB supplies the mesh (positions in metres, +Y up, character facing +Z, Meshy's frame),
its UVs and the skin weights used to keep the face and hands out of the accent mask.
"""
import argparse, json, os, struct, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# ------------------------------------------------------------------ glTF binary reader
COMPONENT = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    data = open(path, 'rb').read()
    assert data[:4] == b'glTF', 'not a GLB'
    json_len = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20 + json_len])
    bin_offset = 20 + json_len + 8
    bin_len = struct.unpack_from('<I', data, 20 + json_len)[0]
    blob = data[bin_offset:bin_offset + bin_len]

    def accessor(index):
        acc = gltf['accessors'][index]
        view = gltf['bufferViews'][acc['bufferView']]
        dtype = COMPONENT[acc['componentType']]
        width = WIDTH[acc['type']]
        start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
        stride = view.get('byteStride', width * np.dtype(dtype).itemsize)
        count = acc['count']
        if stride == width * np.dtype(dtype).itemsize:
            arr = np.frombuffer(blob, dtype=dtype, count=count * width, offset=start).reshape(count, width)
        else:
            raw = np.frombuffer(blob, dtype=np.uint8, count=stride * count, offset=start).reshape(count, stride)
            arr = raw[:, :width * np.dtype(dtype).itemsize].copy().view(dtype).reshape(count, width)
        return arr.astype(np.float64) if dtype == np.float32 else arr

    mesh = gltf['meshes'][0]['primitives'][0]
    attrs = mesh['attributes']
    out = {
        'position': accessor(attrs['POSITION']),
        'normal': accessor(attrs['NORMAL']),
        'uv': accessor(attrs['TEXCOORD_0']),
        'joints': accessor(attrs['JOINTS_0']).astype(np.int64),
        'weights': accessor(attrs['WEIGHTS_0']),
        'indices': accessor(mesh['indices']).reshape(-1).astype(np.int64).reshape(-1, 3),
    }
    skin = gltf['skins'][0]
    out['joint_names'] = [gltf['nodes'][j]['name'] for j in skin['joints']]
    return out


def joint_weight(mesh, names):
    lookup = {name: i for i, name in enumerate(mesh['joint_names'])}
    wanted = np.array([lookup[n] for n in names if n in lookup])
    hit = np.isin(mesh['joints'], wanted)
    return (mesh['weights'] * hit).sum(axis=1)


# ------------------------------------------------------------------ UV rasterizer
def rasterize(uv, tris, attributes, size, eps=0.75):
    """Rasterize per-vertex attributes into a size×size UV image.

    uv: (V,2) glTF UVs (origin top-left); tris: (T,3) indices; attributes: (V,K).
    Returns (image (size,size,K) float32, coverage (size,size) bool). Edge pixels are accepted
    within `eps` pixels of the triangle so chart borders are fully covered.
    """
    K = attributes.shape[1]
    image = np.zeros((size, size, K), dtype=np.float32)
    coverage = np.zeros((size, size), dtype=bool)
    px = uv[:, 0] * size
    py = uv[:, 1] * size
    for tri in tris:
        x = px[tri]; y = py[tri]
        x0 = max(int(np.floor(x.min() - eps)), 0); x1 = min(int(np.ceil(x.max() + eps)), size - 1)
        y0 = max(int(np.floor(y.min() - eps)), 0); y1 = min(int(np.ceil(y.max() + eps)), size - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        # Barycentric coordinates via the signed doubled area.
        det = (x[1] - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (y[1] - y[0])
        if abs(det) < 1e-9:
            continue
        l1 = ((gx - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (gy - y[0])) / det
        l2 = ((x[1] - x[0]) * (gy - y[0]) - (gx - x[0]) * (y[1] - y[0])) / det
        l0 = 1 - l1 - l2
        # Distance tolerance in pixels: eps / (edge length) keeps thin triangles honest.
        edge = np.array([np.hypot(x[2] - x[1], y[2] - y[1]), np.hypot(x[0] - x[2], y[0] - y[2]), np.hypot(x[1] - x[0], y[1] - y[0])])
        tol = eps * edge / max(abs(det), 1e-9)
        inside = (l0 >= -tol[0]) & (l1 >= -tol[1]) & (l2 >= -tol[2])
        if not inside.any():
            continue
        lam = np.stack([np.clip(l0, 0, 1), np.clip(l1, 0, 1), np.clip(l2, 0, 1)], axis=-1)
        lam /= np.maximum(lam.sum(axis=-1, keepdims=True), 1e-9)
        values = lam @ attributes[tri]
        region = image[y0:y1 + 1, x0:x1 + 1]
        cov = coverage[y0:y1 + 1, x0:x1 + 1]
        write = inside & ~cov  # first writer wins so shared edges do not flicker
        region[write] = values[write]
        cov |= inside
    return image, coverage


def dilate(image, coverage, steps, allowed=None):
    """Grow covered texels outward so bilinear/mip filtering never reads stale gutter colour.

    `allowed` limits growth (normally the chart gutters, i.e. ~chart coverage) so a painted chart
    never bleeds into a neighbouring chart's texels.
    """
    image = image.copy(); coverage = coverage.copy()
    for _ in range(steps):
        total = np.zeros_like(image); count = np.zeros(coverage.shape, dtype=np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                shifted = np.roll(np.roll(image, dy, axis=0), dx, axis=1)
                mask = np.roll(np.roll(coverage, dy, axis=0), dx, axis=1)
                total += shifted * mask[..., None]; count += mask
        grow = (~coverage) & (count > 0)
        if allowed is not None:
            grow &= allowed
        image[grow] = total[grow] / count[grow][:, None]
        coverage |= grow
    return image, coverage


def luminance(rgb):
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def classify(rgb):
    """Soft coat-blue / coral / gold scores for painted (plate) or Meshy (albedo) colours, 0-255 input."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    val = rgb.max(axis=-1) / 255
    coral = smoothstep(1.3, 1.5, r / np.maximum(g, 1)) * smoothstep(1.35, 1.6, r / np.maximum(b, 1)) * smoothstep(0.3, 0.42, val)
    gold = (smoothstep(1.25, 1.45, r / np.maximum(b, 1)) * smoothstep(1.05, 1.2, g / np.maximum(b, 1))
            * (1 - smoothstep(1.25, 1.45, r / np.maximum(g, 1))) * smoothstep(0.35, 0.5, val))
    blue = smoothstep(1.0, 1.12, b / np.maximum(r, 1)) * smoothstep(0.95, 1.05, b / np.maximum(g, 1))
    return blue, coral, gold


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ back-plate projection
def plate_silhouette(plate):
    """Mask of the painted character on the flat grey backdrop (border colour = background)."""
    border = np.concatenate([plate[:8].reshape(-1, 3), plate[-8:].reshape(-1, 3), plate[:, :8].reshape(-1, 3), plate[:, -8:].reshape(-1, 3)])
    background = np.median(border, axis=0)
    distance = np.abs(plate - background).max(axis=-1)
    return distance > 22, background


def project_back(albedo, geometry, coverage, plate_path, debug_dir=None):
    """Paint the back plate onto the back-facing coat texels. Returns the new albedo and the blend weight."""
    plate = np.asarray(Image.open(plate_path).convert('RGB')).astype(np.float32)
    ph, pw = plate.shape[:2]
    silhouette, background = plate_silhouette(plate)
    rows = np.where(silhouette.any(axis=1))[0]; cols = np.where(silhouette.any(axis=0))[0]
    py0, py1 = rows.min(), rows.max(); px0, px1 = cols.min(), cols.max()
    pos = geometry[..., 0:3]; nrm = geometry[..., 3:6]; exclusion = geometry[..., 6]
    mesh_top, mesh_bottom = pos[..., 1][coverage].max(), pos[..., 1][coverage].min()
    mesh_left, mesh_right = pos[..., 0][coverage].min(), pos[..., 0][coverage].max()
    scale_y = (py1 - py0) / (mesh_top - mesh_bottom)
    scale_x = (px1 - px0) / (mesh_right - mesh_left)
    print(f'plate silhouette rows {py0}-{py1} cols {px0}-{px1}; mesh y {mesh_bottom:.3f}-{mesh_top:.3f} x {mesh_left:.3f}-{mesh_right:.3f}; '
          f'scale y {scale_y:.1f} px/m, x {scale_x:.1f} px/m')
    # Seen from behind (camera on -Z looking +Z, up +Y) the character's +X side is on the viewer's left.
    centre_x = (px0 + px1) / 2
    plate_x = centre_x - pos[..., 0] * scale_y
    plate_y = py0 + (mesh_top - pos[..., 1]) * scale_y

    # Region: the coat back only. Below the collar, down past the hem (the plate's trousers there
    # classify as coat blue, so those texels keep their own colour), torso width, facing -Z.
    facing = smoothstep(0.25, 0.6, -nrm[..., 2])
    width = 1 - smoothstep(0.215, 0.255, np.abs(pos[..., 0]))
    height = smoothstep(0.58, 0.66, pos[..., 1]) * (1 - smoothstep(1.30, 1.36, pos[..., 1]))
    weight = facing * width * height * coverage

    # Bilinear sample of the plate; background pixels contribute nothing.
    fx = np.clip(plate_x, 0, pw - 1.001); fy = np.clip(plate_y, 0, ph - 1.001)
    ix = np.floor(fx).astype(int); iy = np.floor(fy).astype(int)
    tx = (fx - ix)[..., None]; ty = (fy - iy)[..., None]
    sample = ((plate[iy, ix] * (1 - tx) + plate[iy, ix + 1] * tx) * (1 - ty)
              + (plate[iy + 1, ix] * (1 - tx) + plate[iy + 1, ix + 1] * tx) * ty)
    inside = ((silhouette[iy, ix] & silhouette[iy, ix + 1] & silhouette[iy + 1, ix] & silhouette[iy + 1, ix + 1])).astype(np.float32)
    weight = weight * inside

    # Palette remap rather than a colour fit: the plate is a lit painting while Meshy's albedo is a
    # flat, desaturated de-lit version of it, so no per-channel affine fit survives both the coat
    # blue and the coral. Instead each plate pixel is softly classified as coat blue, coral or gold,
    # and painted with the atlas's own colour for that class (the texel's existing coat blue, the
    # front lapels' coral, the front piping's gold), modulated by the plate's relative shading.
    p_blue, p_coral, p_gold = classify(sample)
    total = np.maximum(p_blue + p_coral + p_gold, 1e-3)
    unknown = 1 - smoothstep(0.15, 0.5, total)
    w_blue = p_blue / total * (1 - unknown) + unknown; w_coral = p_coral / total * (1 - unknown); w_gold = p_gold / total * (1 - unknown)
    a_blue, a_coral, a_gold = classify(albedo)
    keep = (coverage) & (exclusion < 0.3)
    coral_target = np.median(albedo[keep & (a_coral > 0.6)], axis=0)
    gold_target = np.median(albedo[keep & (a_gold > 0.6)], axis=0)
    lum = luminance(sample)
    region = weight > 0.5
    def shade(class_weight, power):
        pick = region & (class_weight > 0.6)
        mean = float(np.median(lum[pick])) if pick.any() else float(np.median(lum[region]))
        return np.clip(lum / max(mean, 1), 0.55, 1.6)[..., None] ** power
    matched = (w_blue[..., None] * albedo * shade(w_blue, 0.45)
               + w_coral[..., None] * coral_target * shade(w_coral, 0.7)
               + w_gold[..., None] * gold_target * shade(w_gold, 0.7))
    matched = np.clip(matched, 0, 255)
    print(f'palette remap: coral target {coral_target.round(1)}, gold target {gold_target.round(1)}; '
          f'region texels {int(region.sum())}, of which coral {int((region & (w_coral > 0.5)).sum())}, gold {int((region & (w_gold > 0.5)).sum())}')

    # Grow the painted texels a few pixels into the chart gutters (never into other charts).
    gutter = ~coverage
    matched, grown = dilate(matched, weight > 0.02, 6, allowed=gutter)
    weight_img, _ = dilate(weight[..., None], weight > 0.02, 6, allowed=gutter)
    weight = np.where(weight > 0.02, weight, weight_img[..., 0] * (grown & ~(weight > 0.02)))
    result = albedo * (1 - weight[..., None]) + matched * weight[..., None]

    if debug_dir:
        overlay = Image.fromarray(plate.astype(np.uint8)); draw = ImageDraw.Draw(overlay)
        ys, xs = np.where(weight > 0.5)
        step = max(1, len(ys) // 4000)
        for y, x in zip(ys[::step], xs[::step]):
            draw.ellipse([plate_x[y, x] - 2, plate_y[y, x] - 2, plate_x[y, x] + 2, plate_y[y, x] + 2], fill=(0, 255, 90))
        draw.rectangle([px0, py0, px1, py1], outline=(255, 0, 0), width=3)
        overlay.save(os.path.join(debug_dir, 'back-overlay.png'))
        Image.fromarray((weight * 255).astype(np.uint8)).save(os.path.join(debug_dir, 'back-weight.png'))
        Image.fromarray(matched.astype(np.uint8)).save(os.path.join(debug_dir, 'back-matched.png'))
    return result, weight


# ------------------------------------------------------------------ crew accent mask
def accent_mask(albedo, exclusion, coverage, debug_dir=None):
    """Per-texel coral classification. Face and hand texels (skin) are excluded by skin weight."""
    rgb = albedo / 255.0
    hsv = np.asarray(Image.fromarray(albedo.astype(np.uint8)).convert('HSV')).astype(np.float32)
    hue = hsv[..., 0] * 360 / 255; sat = hsv[..., 1] / 255; val = hsv[..., 2] / 255
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # Coral in this atlas sits around (163, 94, 82): red clearly above green, green close to blue.
    # Skin is (145, 116, 96): red only mildly above green. Leather/hair is darker and browner.
    ratio_rg = r / np.maximum(g, 1e-3)
    ratio_gb = g / np.maximum(b, 1e-3)
    score = (smoothstep(1.42, 1.58, ratio_rg) * (1 - smoothstep(1.32, 1.5, ratio_gb))
             * smoothstep(0.30, 0.42, sat) * smoothstep(0.34, 0.46, val)
             * ((hue < 24) | (hue > 345)))
    score = score * (1 - smoothstep(0.25, 0.6, exclusion)) * coverage
    mask = (score > 0.5).astype(np.uint8) * 255
    # Clean speckle and feather by one texel. A 3x3 min then max removes isolated texels.
    cleaned = Image.fromarray(mask).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    cleaned = np.asarray(cleaned).astype(np.float32) / 255
    # Recover the thin gold-piped edges the min filter ate, but only where the raw score agrees.
    cleaned = np.maximum(cleaned, (score > 0.5) * (np.asarray(Image.fromarray(mask).filter(ImageFilter.MaxFilter(5))) > 0))
    feathered = np.asarray(Image.fromarray((cleaned * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32) / 255
    # Extend the mask into the chart gutters so filtered lookups at chart borders agree with the chart.
    grown, _ = dilate(feathered[..., None], coverage, 4, allowed=~coverage)
    feathered = np.where(coverage, feathered, grown[..., 0])
    reference = albedo[feathered > 0.9].mean(axis=0) if (feathered > 0.9).any() else np.array([163, 94, 82.0])
    fraction = float((feathered > 0.5).mean())
    print(f'accent mask covers {fraction * 100:.2f}% of the atlas; reference coral {reference.round(1)}')
    if debug_dir:
        preview = albedo.copy()
        tinted = preview * (1 - feathered[..., None]) + np.array([40, 200, 190]) * feathered[..., None]
        Image.fromarray(tinted.astype(np.uint8)).save(os.path.join(debug_dir, 'mask-preview.png'))
        Image.fromarray((feathered * 255).astype(np.uint8)).save(os.path.join(debug_dir, 'mask.png'))
    return feathered, reference


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--glb', required=True); ap.add_argument('--albedo', required=True)
    ap.add_argument('--back'); ap.add_argument('--out', required=True)
    ap.add_argument('--debug'); ap.add_argument('--sidecar'); ap.add_argument('--no-project', action='store_true')
    args = ap.parse_args()
    if args.debug:
        os.makedirs(args.debug, exist_ok=True)
    mesh = read_glb(args.glb)
    albedo = np.asarray(Image.open(args.albedo).convert('RGB')).astype(np.float32)
    size = albedo.shape[0]
    assert albedo.shape[0] == albedo.shape[1], 'square atlas expected'
    exclusion = joint_weight(mesh, ['Head', 'head_end', 'headfront', 'LeftHand', 'RightHand'])
    attributes = np.concatenate([mesh['position'], mesh['normal'], exclusion[:, None]], axis=1)
    print(f'mesh: {len(mesh["position"])} vertices, {len(mesh["indices"])} triangles, atlas {size}px')
    geometry, coverage = rasterize(mesh['uv'], mesh['indices'], attributes, size)
    print(f'rasterized: {coverage.mean() * 100:.1f}% of texels covered by charts')
    result = albedo
    if args.back and not args.no_project:
        result, _ = project_back(albedo, geometry, coverage, args.back, args.debug)
    mask, reference = accent_mask(result, geometry[..., 6], coverage, args.debug)
    rgba = np.concatenate([np.clip(result, 0, 255), mask[..., None] * 255], axis=-1).astype(np.uint8)
    Image.fromarray(rgba, 'RGBA').save(args.out, optimize=True)
    print('wrote', args.out, os.path.getsize(args.out), 'bytes')
    if args.sidecar:
        json.dump({'crewMask': 'baseColorAlpha', 'crewReference': [round(float(c) / 255, 4) for c in reference],
                   'projectedBack': bool(args.back and not args.no_project)}, open(args.sidecar, 'w'), indent=1)


if __name__ == '__main__':
    main()
