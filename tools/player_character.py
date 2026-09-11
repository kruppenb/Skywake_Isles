"""Deterministic geometry, texture-bake and glTF-inspection helpers for the player character.

Only tools/build-player-character.py uses this module. Nothing here imports bpy, so the
pieces that do the art maths stay testable and the Blender-specific work stays in the
generator. Everything is pure Python + NumPy with fixed integer hashing, so two runs of
the same generator produce byte-identical buffers.

Coordinate convention used throughout: GAME space, metres, +Y up, -Z character front,
ground plane at y = 0, character's own left hand at -X.
"""

import hashlib
import math
import struct
import zlib
from collections import defaultdict

import numpy as np

TAU = math.tau


# --------------------------------------------------------------------------- maths


def smoothstep(edge0, edge1, x):
    t = np.clip((np.asarray(x, dtype=float) - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def unit(v):
    v = np.asarray(v, dtype=float)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def dir_from_angle(theta):
    """Horizontal direction, theta = 0 at the character front (-Z), growing toward -X (left)."""
    return np.stack([-np.sin(theta), np.zeros_like(theta), -np.cos(theta)], axis=-1)


def _wang(x):
    x = x.astype(np.uint32, copy=False)
    x = (x ^ np.uint32(61)) ^ (x >> np.uint32(16))
    x = x * np.uint32(9)
    x = x ^ (x >> np.uint32(4))
    x = x * np.uint32(0x27D4EB2D)
    x = x ^ (x >> np.uint32(15))
    return x


def _hash_cell(i, j, k, seed):
    h = _wang(i.astype(np.uint32) * np.uint32(0x8DA6B343)
              ^ j.astype(np.uint32) * np.uint32(0xD8163841)
              ^ k.astype(np.uint32) * np.uint32(0xCB1AB31F)
              ^ np.uint32(seed))
    return (h & np.uint32(0xFFFFFF)).astype(np.float64) / float(0xFFFFFF)


def value_noise(points, frequency, seed):
    """Smooth 3D value noise in [0,1]; integer hashed so it is bit-stable everywhere."""
    p = np.asarray(points, dtype=float) * frequency
    i0 = np.floor(p).astype(np.int64)
    f = p - i0
    f = f * f * (3.0 - 2.0 * f)
    i0 = i0.astype(np.int64) + 1024
    out = 0.0
    for dx in (0, 1):
        wx = f[..., 0] if dx else 1.0 - f[..., 0]
        for dy in (0, 1):
            wy = f[..., 1] if dy else 1.0 - f[..., 1]
            for dz in (0, 1):
                wz = f[..., 2] if dz else 1.0 - f[..., 2]
                out = out + wx * wy * wz * _hash_cell(i0[..., 0] + dx, i0[..., 1] + dy, i0[..., 2] + dz, seed)
    return out


def fbm(points, frequency, octaves, seed, gain=0.5, lacunarity=2.0):
    total = np.zeros(np.asarray(points).shape[:-1], dtype=float)
    amp = 1.0
    norm = 0.0
    freq = frequency
    for o in range(octaves):
        total = total + amp * value_noise(points, freq, seed + o * 7919)
        norm += amp
        amp *= gain
        freq *= lacunarity
    return total / max(norm, 1e-9)


def ridged(points, frequency, octaves, seed):
    return 1.0 - np.abs(fbm(points, frequency, octaves, seed) * 2.0 - 1.0)


# --------------------------------------------------------------------------- OBJ input


def load_obj(path):
    """Parse a Wavefront OBJ into per-group face lists. Positions/UVs stay shared."""
    verts = []
    uvs = []
    groups = defaultdict(list)
    group = 'default'
    with open(path, 'r', encoding='utf-8') as handle:
        for line in handle:
            if line.startswith('v '):
                parts = line.split()
                verts.append((float(parts[1]), float(parts[2]), float(parts[3])))
            elif line.startswith('vt '):
                parts = line.split()
                uvs.append((float(parts[1]), float(parts[2])))
            elif line.startswith('g '):
                group = line[2:].strip()
            elif line.startswith('f '):
                face = []
                for token in line.split()[1:]:
                    bits = token.split('/')
                    vi = int(bits[0]) - 1
                    ti = int(bits[1]) - 1 if len(bits) > 1 and bits[1] else -1
                    face.append((vi, ti))
                groups[group].append(tuple(face))
    return {
        'verts': np.array(verts, dtype=float),
        'uvs': np.array(uvs, dtype=float) if uvs else np.zeros((0, 2)),
        'groups': dict(groups),
    }


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


# --------------------------------------------------------------------------- parts


class Part:
    """A chunk of authored geometry with per-corner UVs and per-vertex paint channels.

    `paint` names the atlas region and the procedural paint routine; `material` names the
    exported glTF material. Several parts share one material (the navy coat, the breeches
    and the tricorn crown are all `cloth_navy`) while keeping their own atlas region.
    """

    __slots__ = ('name', 'material', 'paint', 'verts', 'shade', 'wear', 'faces', 'face_uvs', 'weights')

    def __init__(self, name, material, paint, weights='body'):
        self.name = name
        self.material = material
        self.paint = paint
        self.weights = weights
        self.verts = []
        self.shade = []
        self.wear = []
        self.faces = []
        self.face_uvs = []

    def vert(self, point, shade=0.5, wear=0.0):
        self.verts.append((float(point[0]), float(point[1]), float(point[2])))
        self.shade.append(float(shade))
        self.wear.append(float(wear))
        return len(self.verts) - 1

    def face(self, indices, uvs):
        self.faces.append(tuple(int(i) for i in indices))
        self.face_uvs.append(tuple((float(u), float(v)) for u, v in uvs))

    def triangles(self):
        return sum(len(f) - 2 for f in self.faces)

    def offset(self, other_vertex_count):
        return other_vertex_count


def _border_edges(faces):
    """Directed edges used by exactly one face, in that face's winding order."""
    seen = defaultdict(int)
    directed = []
    for face in faces:
        for a, b in zip(face, face[1:] + face[:1]):
            seen[(min(a, b), max(a, b))] += 1
            directed.append((a, b))
    return [(a, b) for (a, b) in directed if seen[(min(a, b), max(a, b))] == 1]


def shell(part, nu, nv, surface, thickness, uv, mask=None, wrap_u=False,
          shade=None, wear=None, rim_shade=-0.12):
    """Build a solid garment panel from a parametric surface plus an inward thickness.

    surface(i, j) -> (outer_point, inward_unit_vector) on an (nu+1) x (nv+1) node grid
    thickness(i, j) -> metres pushed along the inward vector to form the back face
    uv(i, j) -> atlas UV for the outer node (Blender orientation, v up)
    mask(i, j) -> keep the quad whose low corner is node (i, j)

    Rim quads close every open border, so lapels, cuffs, coat tails and brims all read
    as cloth with real thickness instead of paper. Returns the outer node index grid.
    """
    cols = nu if wrap_u else nu + 1
    outer = np.full((cols, nv + 1), -1, dtype=int)
    inner = np.full((cols, nv + 1), -1, dtype=int)
    uvs = {}
    for i in range(cols):
        for j in range(nv + 1):
            point, inward = surface(i, j)
            t = thickness(i, j)
            s = shade(i, j) if shade else 0.5
            w = wear(i, j) if wear else 0.0
            outer[i, j] = part.vert(point, s, w)
            inner[i, j] = part.vert(np.asarray(point, dtype=float) - np.asarray(inward, dtype=float) * t,
                                    s + rim_shade, w * 0.3)
            uvs[(i, j)] = uv(i, j)

    def node_uv(i, j):
        if (i, j) in uvs:
            return uvs[(i, j)]
        return uv(i, j)

    outer_faces = []
    for i in range(nu):
        for j in range(nv):
            if mask and not mask(i, j):
                continue
            i1 = (i + 1) % cols
            quad = (outer[i, j], outer[i1, j], outer[i1, j + 1], outer[i, j + 1])
            quad_uv = (node_uv(i, j), node_uv(i + 1, j), node_uv(i + 1, j + 1), node_uv(i, j + 1))
            part.face(quad, quad_uv)
            outer_faces.append(quad)
            part.face((inner[i, j + 1], inner[i1, j + 1], inner[i1, j], inner[i, j]),
                      (quad_uv[3], quad_uv[2], quad_uv[1], quad_uv[0]))

    lookup = {}
    for i in range(cols):
        for j in range(nv + 1):
            lookup[outer[i, j]] = (inner[i, j], node_uv(i, j))
    for a, b in _border_edges(outer_faces):
        ia, uva = lookup[a]
        ib, uvb = lookup[b]
        pa = np.array(part.verts[a])
        pb = np.array(part.verts[b])
        if float(np.linalg.norm(pb - pa)) < 1e-6:
            continue  # pole of a dome: the border edge has no length, so it needs no rim
        part.face((b, a, ia, ib), (uvb, uva, uva, uvb))
    return outer


def tube(part, axis_points, radii, segments, uv_rect, shade_base=0.5, wear_base=0.0,
         cap_start=True, cap_end=True, twist=0.0, up_hint=(0.0, 1.0, 0.0), squash=None):
    """Closed swept tube along a polyline; used for straps, belts, queues and eye posts."""
    axis = np.asarray(axis_points, dtype=float)
    n = len(axis)
    rings = []
    prev_ref = np.asarray(up_hint, dtype=float)
    for k in range(n):
        if k == 0:
            tangent = axis[1] - axis[0]
        elif k == n - 1:
            tangent = axis[-1] - axis[-2]
        else:
            tangent = axis[k + 1] - axis[k - 1]
        tangent = unit(tangent)
        ref = prev_ref
        if abs(float(np.dot(ref, tangent))) > 0.95:
            ref = np.array([1.0, 0.0, 0.0]) if abs(tangent[0]) < 0.9 else np.array([0.0, 0.0, 1.0])
        side = unit(np.cross(ref, tangent))
        upv = unit(np.cross(tangent, side))
        prev_ref = upv
        ring = []
        for s in range(segments):
            a = TAU * s / segments + twist * k
            sx, sy = (1.0, 1.0) if squash is None else squash(k)
            offset = side * (math.cos(a) * radii[k] * sx) + upv * (math.sin(a) * radii[k] * sy)
            ring.append(axis[k] + offset)
        rings.append(ring)

    u0, v0, u1, v1 = uv_rect
    idx = []
    for k, ring in enumerate(rings):
        row = []
        for s, point in enumerate(ring):
            shading = shade_base + 0.16 * math.sin(TAU * s / segments)
            row.append(part.vert(point, shading, wear_base))
        idx.append(row)
    for k in range(n - 1):
        for s in range(segments):
            s1 = (s + 1) % segments
            uu0 = u0 + (u1 - u0) * (s / segments)
            uu1 = u0 + (u1 - u0) * ((s + 1) / segments)
            vv0 = v0 + (v1 - v0) * (k / max(n - 1, 1))
            vv1 = v0 + (v1 - v0) * ((k + 1) / max(n - 1, 1))
            part.face((idx[k][s], idx[k][s1], idx[k + 1][s1], idx[k + 1][s]),
                      ((uu0, vv0), (uu1, vv0), (uu1, vv1), (uu0, vv1)))
    mid_u, mid_v = (u0 + u1) * 0.5, (v0 + v1) * 0.5
    if cap_start:
        centre = part.vert(axis[0], shade_base - 0.1, wear_base)
        for s in range(segments):
            s1 = (s + 1) % segments
            part.face((centre, idx[0][s1], idx[0][s]), ((mid_u, mid_v), (mid_u, mid_v), (mid_u, mid_v)))
    if cap_end:
        centre = part.vert(axis[-1], shade_base - 0.1, wear_base)
        for s in range(segments):
            s1 = (s + 1) % segments
            part.face((centre, idx[-1][s], idx[-1][s1]), ((mid_u, mid_v), (mid_u, mid_v), (mid_u, mid_v)))
    return idx


def uv_sphere(part, centre, radius, rings, segments, uv_rect, shade_base=0.5, scale=(1.0, 1.0, 1.0)):
    u0, v0, u1, v1 = uv_rect
    centre = np.asarray(centre, dtype=float)
    scale = np.asarray(scale, dtype=float)
    grid = []
    for j in range(rings + 1):
        phi = math.pi * j / rings
        row = []
        for i in range(segments + 1):
            theta = TAU * i / segments
            n = np.array([math.sin(phi) * math.sin(theta), math.cos(phi), math.sin(phi) * math.cos(theta)])
            row.append(part.vert(centre + n * radius * scale, shade_base))
        grid.append(row)
    for j in range(rings):
        for i in range(segments):
            uu0 = u0 + (u1 - u0) * (i / segments)
            uu1 = u0 + (u1 - u0) * ((i + 1) / segments)
            vv0 = v1 + (v0 - v1) * (j / rings)
            vv1 = v1 + (v0 - v1) * ((j + 1) / rings)
            a, b, c, d = grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]
            part.face((a, d, c, b), ((uu0, vv0), (uu0, vv1), (uu1, vv1), (uu1, vv0)))
    return grid


# --------------------------------------------------------------------------- texture bake


class Atlas:
    """Fixed texel rectangles, one per paint routine. v runs up (Blender orientation)."""

    def __init__(self, size, regions):
        self.size = size
        self.regions = regions

    def rect(self, name):
        return self.regions[name]

    def map(self, name, u, v, sub=(0.0, 0.0, 1.0, 1.0)):
        r0, s0, r1, s1 = self.regions[name]
        a0, b0, a1, b1 = sub
        uu = r0 + (r1 - r0) * (a0 + (a1 - a0) * min(max(u, 0.0), 1.0))
        vv = s0 + (s1 - s0) * (b0 + (b1 - b0) * min(max(v, 0.0), 1.0))
        return (uu, vv)


def rasterize(parts, atlas, paint_ids):
    """Rasterise every part into position / normal / shade / wear G-buffers.

    UV layout only controls texel density here: the paint routines read object-space
    position, so UV seams never show as colour breaks.
    """
    size = atlas.size
    pos = np.zeros((size, size, 3), dtype=np.float32)
    nrm = np.zeros((size, size, 3), dtype=np.float32)
    aux = np.zeros((size, size, 2), dtype=np.float32)
    pid = np.full((size, size), -1, dtype=np.int16)

    for part in parts:
        verts = np.array(part.verts, dtype=float)
        shade = np.array(part.shade, dtype=float)
        wear = np.array(part.wear, dtype=float)
        pindex = paint_ids[part.paint]
        for face, fuv in zip(part.faces, part.face_uvs):
            ring = list(zip(face, fuv))
            p0 = verts[face[0]]
            e1 = verts[face[1]] - p0
            e2 = verts[face[-1]] - p0
            fn = np.cross(e1, e2)
            fn_len = np.linalg.norm(fn)
            fn = fn / fn_len if fn_len > 1e-12 else np.array([0.0, 1.0, 0.0])
            for k in range(1, len(ring) - 1):
                tri = (ring[0], ring[k], ring[k + 1])
                _raster_tri(pos, nrm, aux, pid, size, tri, verts, shade, wear, fn, pindex)
    return {'pos': pos, 'nrm': nrm, 'aux': aux, 'pid': pid}


def _raster_tri(pos, nrm, aux, pid, size, tri, verts, shade, wear, fn, pindex):
    uv = np.array([t[1] for t in tri], dtype=float) * size
    idx = [t[0] for t in tri]
    minx = int(math.floor(uv[:, 0].min() - 1.0))
    maxx = int(math.ceil(uv[:, 0].max() + 1.0))
    miny = int(math.floor(uv[:, 1].min() - 1.0))
    maxy = int(math.ceil(uv[:, 1].max() + 1.0))
    minx = max(minx, 0)
    miny = max(miny, 0)
    maxx = min(maxx, size - 1)
    maxy = min(maxy, size - 1)
    if maxx < minx or maxy < miny:
        return
    x = np.arange(minx, maxx + 1) + 0.5
    y = np.arange(miny, maxy + 1) + 0.5
    gx, gy = np.meshgrid(x, y)
    ax, ay = uv[0]
    bx, by = uv[1]
    cx, cy = uv[2]
    det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(det) < 1e-9:
        return
    l0 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / det
    l1 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / det
    l2 = 1.0 - l0 - l1
    eps = -0.004
    inside = (l0 >= eps) & (l1 >= eps) & (l2 >= eps)
    if not inside.any():
        return
    ys, xs = np.nonzero(inside)
    ys = ys + miny
    xs = xs + minx
    w0 = l0[inside][:, None]
    w1 = l1[inside][:, None]
    w2 = l2[inside][:, None]
    p = verts[idx[0]] * w0 + verts[idx[1]] * w1 + verts[idx[2]] * w2
    s = shade[idx[0]] * w0[:, 0] + shade[idx[1]] * w1[:, 0] + shade[idx[2]] * w2[:, 0]
    wv = wear[idx[0]] * w0[:, 0] + wear[idx[1]] * w1[:, 0] + wear[idx[2]] * w2[:, 0]
    pos[ys, xs] = p
    nrm[ys, xs] = fn
    aux[ys, xs, 0] = s
    aux[ys, xs, 1] = wv
    pid[ys, xs] = pindex


def dilate(buffers, iterations):
    """Grow every rasterised island outward so bilinear filtering never samples a hole."""
    pid = buffers['pid']
    filled = pid >= 0
    for _ in range(iterations):
        holes = ~filled
        if not holes.any():
            break
        src_pid = pid.copy()
        src_filled = filled.copy()
        stacks = []
        for axis, shift in ((0, 1), (0, -1), (1, 1), (1, -1)):
            stacks.append((np.roll(src_filled, shift, axis=axis), shift, axis))
        take = np.zeros_like(filled)
        for valid, shift, axis in stacks:
            pick = holes & valid & ~take
            if not pick.any():
                continue
            for key in ('pos', 'nrm', 'aux'):
                buffers[key][pick] = np.roll(buffers[key], shift, axis=axis)[pick]
            pid[pick] = np.roll(src_pid, shift, axis=axis)[pick]
            take |= pick
        filled = filled | take
    return filled


def height_to_normal(height, strength, downsample=1):
    """Tangent-space normal map from an atlas-space height field (OpenGL / glTF green-up)."""
    h = height.astype(np.float32)
    if downsample > 1:
        n = h.shape[0] // downsample
        h = h.reshape(n, downsample, n, downsample).mean(axis=(1, 3))
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nx = -dx * strength
    ny = -dy * strength
    nz = np.ones_like(h)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    out = np.stack([nx / length, ny / length, nz / length], axis=-1)
    return np.clip(out * 0.5 + 0.5, 0.0, 1.0)


def srgb_bytes(linear_or_srgb):
    return np.clip(np.rint(np.asarray(linear_or_srgb) * 255.0), 0, 255).astype(np.uint8)


def write_png(path, pixels):
    """Deterministic 8-bit RGB PNG. Row 0 of `pixels` is the BOTTOM of the UV space."""
    pixels = np.asarray(pixels, dtype=np.uint8)
    flipped = pixels[::-1]
    height, width, channels = flipped.shape
    assert channels == 3

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)

    raw = b''.join(b'\0' + row.tobytes() for row in flipped)
    blob = b'\x89PNG\r\n\x1a\n'
    blob += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    blob += chunk(b'IDAT', zlib.compress(raw, 9))
    blob += chunk(b'IEND', b'')
    path.write_bytes(blob)
    return len(blob)


def hex_to_rgb(value):
    """sRGB 0..1 - the value an 8-bit sRGB texture byte encodes."""
    value = value.lstrip('#')
    return np.array([int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=float)


def srgb_to_linear(value):
    """Blender node colours and glTF factors are linear; palette hexes are sRGB."""
    c = np.asarray(value, dtype=float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def uv_islands(face_uv_ids):
    """Group faces into UV islands: two faces share an island if they share a UV index."""
    parent = {}

    def find(a):
        parent.setdefault(a, a)
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for ids in face_uv_ids:
        for other in ids[1:]:
            union(ids[0], other)
    islands = defaultdict(list)
    for index, ids in enumerate(face_uv_ids):
        islands[find(ids[0])].append(index)
    return [islands[key] for key in sorted(islands)]


def shelf_pack(sizes, margin=0.006, steps=34):
    """Largest uniform scale that fits every box into the unit square, shelf packed.

    Returns (scale, [(x, y), ...]). Used to lay the retained MakeHuman UV islands out in
    the skin atlas region with real gutters instead of reprojecting the head, which is
    what made the authored face topology overlap itself.
    """
    order = sorted(range(len(sizes)), key=lambda i: -sizes[i][1])

    def attempt(scale):
        place = [None] * len(sizes)
        x = margin
        y = margin
        row_h = 0.0
        for i in order:
            w = sizes[i][0] * scale + margin
            h = sizes[i][1] * scale + margin
            if w > 1.0 - margin or h > 1.0 - margin:
                return None
            if x + w > 1.0 - margin:
                x = margin
                y += row_h
                row_h = 0.0
            if y + h > 1.0 - margin:
                return None
            place[i] = (x, y)
            x += w
            row_h = max(row_h, h)
        return place

    lo, hi = 1e-4, 40.0
    best = attempt(lo)
    for _ in range(steps):
        mid = (lo + hi) * 0.5
        got = attempt(mid)
        if got is None:
            hi = mid
        else:
            lo, best = mid, got
    return lo, best


def smooth_table(table, passes=2, wrap_axis=1):
    """Small separable blur over a sampled radius table; wraps in the angular axis."""
    out = np.array(table, dtype=float)
    for _ in range(passes):
        along = np.empty_like(out)
        along[0] = out[0]
        along[-1] = out[-1]
        along[1:-1] = (out[:-2] + 2.0 * out[1:-1] + out[2:]) * 0.25
        rolled = (np.roll(along, 1, axis=wrap_axis) + 2.0 * along + np.roll(along, -1, axis=wrap_axis)) * 0.25
        out = rolled
    return out


def bilinear(table, u, v):
    """u indexes axis 0 (clamped), v indexes axis 1 (wrapped); both in table index units."""
    n, m = table.shape
    u = min(max(u, 0.0), n - 1.0)
    i0 = int(math.floor(u))
    i1 = min(i0 + 1, n - 1)
    fu = u - i0
    v = v % m
    j0 = int(math.floor(v))
    j1 = (j0 + 1) % m
    fv = v - j0
    return float((table[i0, j0] * (1 - fu) + table[i1, j0] * fu) * (1 - fv)
                 + (table[i0, j1] * (1 - fu) + table[i1, j1] * fu) * fv)


# --------------------------------------------------------------------------- glTF inspection

_COMPONENT_SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
_COMPONENT_DTYPE = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_TYPE_COUNT = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


class Glb:
    """Minimal read-only GLB reader used to validate the file we actually shipped."""

    def __init__(self, path):
        blob = path.read_bytes()
        self.bytes = len(blob)
        magic, version, total = struct.unpack_from('<4sII', blob, 0)
        assert magic == b'glTF' and version == 2, 'not a glTF 2.0 binary'
        assert total == len(blob), 'GLB length field does not match file size'
        offset = 12
        self.json = None
        self.bin = b''
        self.chunks = []
        while offset < total:
            length, kind = struct.unpack_from('<II', blob, offset)
            payload = blob[offset + 8:offset + 8 + length]
            self.chunks.append(kind)
            if kind == 0x4E4F534A:
                import json as _json
                self.json = _json.loads(payload.decode('utf-8'))
            elif kind == 0x004E4942:
                self.bin = payload
            offset += 8 + length + ((4 - length % 4) % 4 if length % 4 else 0)
        assert self.json is not None, 'missing JSON chunk'

    def accessor(self, index):
        acc = self.json['accessors'][index]
        count = acc['count']
        comps = _TYPE_COUNT[acc['type']]
        dtype = _COMPONENT_DTYPE[acc['componentType']]
        view = self.json['bufferViews'][acc['bufferView']]
        base = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
        stride = view.get('byteStride') or comps * _COMPONENT_SIZE[acc['componentType']]
        packed = comps * _COMPONENT_SIZE[acc['componentType']]
        if stride == packed:
            data = np.frombuffer(self.bin, dtype=dtype, count=count * comps, offset=base)
            return data.reshape(count, comps) if comps > 1 else data
        rows = []
        for i in range(count):
            rows.append(np.frombuffer(self.bin, dtype=dtype, count=comps, offset=base + i * stride))
        out = np.array(rows)
        return out if comps > 1 else out[:, 0]

    def image_bytes(self, index):
        img = self.json['images'][index]
        view = self.json['bufferViews'][img['bufferView']]
        base = view.get('byteOffset', 0)
        return self.bin[base:base + view['byteLength']]


def png_dimensions(blob):
    assert blob[:8] == b'\x89PNG\r\n\x1a\n', 'embedded image is not a PNG'
    assert blob[12:16] == b'IHDR'
    width, height = struct.unpack_from('>II', blob, 16)
    return width, height


def decoded_texture_bytes(width, height):
    """RGBA bytes for the base level plus every integer-halved mip down to 1x1.

    Matches client/environment-assets.js textureMemoryBytes.
    """
    total = 0
    w, h = width, height
    while True:
        total += w * h * 4
        if w == 1 and h == 1:
            break
        w = max(1, w // 2)
        h = max(1, h // 2)
    return total
