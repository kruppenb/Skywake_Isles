"""Build the original Old Watch environment kit with Blender, without downloads.

    blender --background --factory-startup --python-exit-code 1 --python tools/build-old-watch.py

All geometry is authored in game coordinates (X right, Y up, Z forward), then
converted to Blender coordinates at mesh creation. Only the generated GLB and
its manifest are shipping assets. Optional --preview writes a contact sheet to
the supplied path; it never opens or changes an interactive Blender session.
"""

import argparse
import hashlib
import json
import math
import pathlib
import random
import struct
import sys
import tempfile
import zlib
from collections import defaultdict

import bpy
import numpy as np
from mathutils import Vector


ROOT = pathlib.Path(__file__).resolve().parents[1]
SEED = 481503
RNG = random.Random(SEED)
TAU = math.tau
PREFABS = {}
MATERIALS = {}
TEXTURES = []


def clamp(value, low=0.0, high=1.0):
    return min(high, max(low, value))


def game_to_blender(v):
    return (v[0], -v[2], v[1])


def unit(v):
    return Vector(v).normalized()


def rotate_y(v, angle):
    c, s = math.cos(angle), math.sin(angle)
    return Vector((v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c))


def png(path, pixels):
    """Minimal deterministic PNG writer; no external texture tooling required."""
    pixels = np.asarray(pixels, dtype=np.uint8)
    h, w, channels = pixels.shape
    assert channels == 3
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    rows = b''.join(b'\0' + row.tobytes() for row in pixels)
    payload = b'\x89PNG\r\n\x1a\n'
    payload += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    payload += chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')
    path.write_bytes(payload)


def tile_noise(size, frequency, rng):
    """Periodic value noise, cubic interpolation; edges tile in both directions."""
    grid = rng.random((frequency, frequency))
    xy = np.arange(size, dtype=float) * frequency / size
    ij = np.floor(xy).astype(int)
    f = xy - ij
    f = f * f * (3 - 2 * f)
    a = grid[ij[:, None] % frequency, ij[None, :] % frequency]
    b = grid[ij[:, None] % frequency, (ij[None, :] + 1) % frequency]
    c = grid[(ij[:, None] + 1) % frequency, ij[None, :] % frequency]
    d = grid[(ij[:, None] + 1) % frequency, (ij[None, :] + 1) % frequency]
    return ((a * (1 - f[None, :]) + b * f[None, :]) * (1 - f[:, None])
            + (c * (1 - f[None, :]) + d * f[None, :]) * f[:, None])


def texture_arrays(kind, size):
    rng = np.random.default_rng(SEED + sum(map(ord, kind)))
    yy, xx = np.mgrid[0:size, 0:size] / size
    broad = tile_noise(size, 5, rng)
    middle = tile_noise(size, 19, rng)
    fine = tile_noise(size, 65, rng)
    grit = rng.random((size, size))
    if kind == 'stone':
        height = broad * .35 + middle * .27 + fine * .2 + grit * .075
        mineral = np.clip((tile_noise(size, 12, rng) - .56) * 4, 0, 1)
        cracks = np.clip((.055 - np.abs(np.sin((xx * 8 + broad * .17) * TAU))) * 7, 0, .3)
        value = .58 + broad * .25 + middle * .17 + (fine - .5) * .17 - cracks
        rgb = np.stack((value * .48 + mineral * .035,
                        value * .49 + mineral * .045,
                        value * .455 + mineral * .007), axis=-1)
        height -= cracks * .13
        normal_strength = 2.8
    elif kind == 'timber':
        warp = np.sin(yy * TAU * 2) * .013 + (broad - .5) * .027
        grain = (np.sin((xx + warp) * TAU * 41) * .5 + .5) ** 7
        fibers = (np.sin((xx + warp * .45) * TAU * 109) * .5 + .5) ** 12
        split = np.clip((grain - .81) * 1.5, 0, 1) * (middle * .8 + .2)
        knots = np.zeros((size, size))
        for kx, ky in ((.23, .28), (.74, .79)):
            dx = np.minimum(np.abs(xx - kx), 1 - np.abs(xx - kx))
            dy = np.minimum(np.abs(yy - ky), 1 - np.abs(yy - ky))
            distance = np.sqrt((dx * 6.0) ** 2 + (dy * 2.0) ** 2)
            knots += np.exp(-distance * 7) * (.55 + .45 * np.sin(distance * 110))
        value = .75 + broad * .14 + (middle - .5) * .12 - split * .26 - fibers * .055 - knots * .3
        rgb = np.stack((value * .49, value * .435, value * .34), axis=-1)
        # Silvered fibers, darker elongated pores, and knots are surface color,
        # not baked shadows. Each beam receives additional vertex tint.
        silver = np.clip((fine - .6) * 1.0, 0, .22)
        rgb += silver[..., None] * np.array([.20, .23, .26])
        height = middle * .14 + fine * .03 - split * .18 - fibers * .045 - knots * .15
        normal_strength = 3.5
    elif kind == 'slate':
        strata = (np.sin((yy * 37 + broad * .21) * TAU) * .5 + .5) ** 12
        value = .60 + broad * .23 + middle * .15 + (fine - .5) * .08 - strata * .09
        rgb = np.stack((value * .29, value * .35, value * .38), axis=-1)
        height = broad * .12 + middle * .06 + strata * .025
        normal_strength = 2.0
    elif kind == 'earth':
        value = .57 + broad * .20 + middle * .12 + (fine - .5) * .10
        rgb = np.stack((value * .47, value * .415, value * .305), axis=-1)
        height = middle * .2 + fine * .13 + grit * .025
        # Tileable, differently sized grit/pebbles. Mask coverage is low enough
        # to read as soil at distance rather than patterned paving.
        for _ in range(135):
            px, py = rng.random(2)
            rx = rng.uniform(.003, .014)
            ry = rx * rng.uniform(.6, 1.35)
            dx = np.minimum(np.abs(xx - px), 1 - np.abs(xx - px)) / rx
            dy = np.minimum(np.abs(yy - py), 1 - np.abs(yy - py)) / ry
            r = np.sqrt(dx * dx + dy * dy)
            mask = np.clip((1.08 - r) * 7, 0, 1)
            pebble = np.array([.36, .365, .325]) * rng.uniform(.7, 1.4)
            rgb = rgb * (1 - mask[..., None]) + pebble * mask[..., None]
            height += np.clip(1 - r, 0, 1) * .09
        normal_strength = 3.4
    else:
        spine = np.exp(-np.abs(xx - .5) * 75)
        veins = np.clip(np.cos((yy * 14 + np.abs(xx - .5) * 6) * TAU), 0, 1) ** 10
        value = .80 + middle * .13 + fine * .07 + spine * .12 + veins * .025
        rgb = np.stack((value * .36, value * .47, value * .235), axis=-1)
        height = spine * .05 + veins * .015
        normal_strength = 1.5
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * normal_strength
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * normal_strength
    normal = np.stack((-dx, dy, np.ones_like(dx)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1)[..., None]
    # Six-bit normal precision is ample for these subtle surface slopes and
    # avoids spending the download budget on imperceptible high-entropy noise.
    normal_pixels = np.clip(np.round((normal * .5 + .5) * 255 / 4) * 4, 0, 255).astype(np.uint8)
    return np.round(np.clip(rgb, 0, 1) * 255).astype(np.uint8), normal_pixels


def create_materials(temp):
    image_sets = {}
    for kind in ('stone', 'timber', 'slate', 'earth', 'foliage'):
        size = 256 if kind in ('slate', 'foliage') else 512
        arrays = texture_arrays(kind, size)
        image_sets[kind] = []
        for suffix, pixels in zip(('color', 'normal'), arrays):
            path = temp / f'{kind}_{suffix}.png'
            png(path, pixels)
            img = bpy.data.images.load(str(path))
            img.name = f'old_watch_{kind}_{suffix}'
            img.colorspace_settings.name = 'sRGB' if suffix == 'color' else 'Non-Color'
            img.pack()
            image_sets[kind].append(img)
            TEXTURES.append({'name': img.name, 'width': size, 'height': size,
                             'colorSpace': 'sRGB' if suffix == 'color' else 'linear',
                             'sourcePngBytes': path.stat().st_size})
    for name, kind, roughness, tint in (
            ('watch_stone', 'stone', .94, (1, 1, 1, 1)),
            ('aged_timber', 'timber', .91, (1, 1, 1, 1)),
            ('pine_bark', 'timber', .98, (.56, .48, .36, 1)),
            ('dark_slate', 'slate', .87, (1, 1, 1, 1)),
            ('ground_earth', 'earth', .99, (1, 1, 1, 1)),
            ('needle_foliage', 'foliage', .95, (1, 1, 1, 1))):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        mat.use_backface_culling = name != 'needle_foliage'
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        shader = nodes.get('Principled BSDF')
        shader.inputs['Roughness'].default_value = roughness
        shader.inputs['Metallic'].default_value = 0
        shader.inputs['Base Color'].default_value = tint
        color = nodes.new('ShaderNodeTexImage')
        color.image = image_sets[kind][0]
        color.extension = 'REPEAT'
        links.new(color.outputs['Color'], shader.inputs['Base Color'])
        # glTF multiplies the exported vertex COLOR_0 into its PBR base color.
        # Use the supported vertex-color multiply graph for Blender previews.
        vertex = nodes.new('ShaderNodeVertexColor')
        vertex.layer_name = 'Color'
        multiply = nodes.new('ShaderNodeMixRGB')
        multiply.blend_type = 'MULTIPLY'
        multiply.inputs[0].default_value = 1
        links.new(color.outputs['Color'], multiply.inputs[1])
        links.new(vertex.outputs['Color'], multiply.inputs[2])
        links.new(multiply.outputs['Color'], shader.inputs['Base Color'])
        normaltex = nodes.new('ShaderNodeTexImage')
        normaltex.image = image_sets[kind][1]
        normaltex.extension = 'REPEAT'
        normal = nodes.new('ShaderNodeNormalMap')
        normal.inputs['Strength'].default_value = .7 if kind == 'foliage' else 1
        links.new(normaltex.outputs['Color'], normal.inputs['Color'])
        links.new(normal.outputs['Normal'], shader.inputs['Normal'])
        MATERIALS[name] = mat
    for name, rgba, roughness, metallic in (
            ('forged_iron', (.105, .112, .10, 1), .85, .5),
            ('recess_shadow', (.032, .035, .03, 1), 1, 0),
            ('lantern_amber', (.70, .28, .065, 1), .65, 0)):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        shader = mat.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value = rgba
        shader.inputs['Roughness'].default_value = roughness
        shader.inputs['Metallic'].default_value = metallic
        if name == 'lantern_amber':
            shader.inputs['Emission Color'].default_value = (1, .31, .048, 1)
            shader.inputs['Emission Strength'].default_value = .65
        MATERIALS[name] = mat


class KitMesh:
    """Accumulate material groups with explicit UVs and original vertex colors."""
    def __init__(self, name):
        self.name = name
        self.groups = defaultdict(lambda: {'vertices': [], 'faces': [], 'uv': [], 'colors': [], 'smooth': []})

    def polygon(self, points, material, color=(1, 1, 1), uvs=None, smooth=False):
        data = self.groups[material]
        offset = len(data['vertices'])
        data['vertices'].extend(tuple(p) for p in points)
        data['faces'].append(tuple(range(offset, offset + len(points))))
        if uvs is None:
            # Explicit planar mapping by dominant face normal, at metric scale.
            normal = (Vector(points[1]) - Vector(points[0])).cross(Vector(points[2]) - Vector(points[0]))
            axis = max(range(3), key=lambda i: abs(normal[i]))
            axes = [i for i in range(3) if i != axis]
            uvs = [(p[axes[0]], p[axes[1]]) for p in points]
        data['uv'].extend(uvs)
        if len(color) == len(points) and isinstance(color[0], (tuple, list)):
            data['colors'].extend(tuple(c[:3]) + (1,) for c in color)
        else:
            data['colors'].extend(tuple(color[:3]) + (1,) for _ in points)
        data['smooth'].append(smooth)

    def block(self, center, size, material='watch_stone', color=(1, 1, 1), bevel=.035, yaw=0, axis_y=None, skew=0):
        half = [v * .5 for v in size]
        bevel = min(bevel, min(half) * .43)
        vertices = {}
        if axis_y is None:
            transform = lambda p: rotate_y(p, yaw) + Vector(center)
        else:
            ay = unit(axis_y)
            ax = ay.cross(Vector((0, 0, 1)))
            if ax.length < .01:
                ax = ay.cross(Vector((1, 0, 0)))
            ax.normalize()
            az = ax.cross(ay).normalized()
            transform = lambda p: ax * p[0] + ay * p[1] + az * p[2] + Vector(center)
        if bevel <= 0:
            for axis in range(3):
                other = [k for k in range(3) if k != axis]
                for sign in (-1, 1):
                    points = []
                    for s1, s2 in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                        p = [0, 0, 0]
                        p[axis], p[other[0]], p[other[1]] = sign * half[axis], s1 * half[other[0]], s2 * half[other[1]]
                        points.append(transform(p))
                    n = (points[1] - points[0]).cross(points[2] - points[0])
                    if n.dot(sum(points, Vector()) / 4 - Vector(center)) < 0:
                        points.reverse()
                    self.polygon(points, material, color)
            return
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    signs = (sx, sy, sz)
                    for axis in range(3):
                        p = [signs[k] * (half[k] if k == axis else half[k] - bevel) for k in range(3)]
                        p[0] += p[1] * skew
                        vertices[(sx, sy, sz, axis)] = transform(p)
        # Winding all faces from their outward normal after transforming.
        faces = []
        for axis in range(3):
            remaining = [k for k in range(3) if k != axis]
            for side in (-1, 1):
                keys = []
                for s1, s2 in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    signs = [0, 0, 0]
                    signs[axis], signs[remaining[0]], signs[remaining[1]] = side, s1, s2
                    keys.append(tuple(signs) + (axis,))
                faces.append(keys)
        for varying in range(3):
            fixed = [k for k in range(3) if k != varying]
            for s1 in (-1, 1):
                for s2 in (-1, 1):
                    keys = []
                    for vary, face_axis in ((-1, fixed[0]), (1, fixed[0]), (1, fixed[1]), (-1, fixed[1])):
                        signs = [0, 0, 0]
                        signs[varying], signs[fixed[0]], signs[fixed[1]] = vary, s1, s2
                        keys.append(tuple(signs) + (face_axis,))
                    faces.append(keys)
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    faces.append([(sx, sy, sz, axis) for axis in range(3)])
        for keys in faces:
            points = [vertices[k] for k in keys]
            n = (points[1] - points[0]).cross(points[2] - points[0])
            fc = sum(points, Vector()) / len(points) - Vector(center)
            if n.dot(fc) < 0:
                points.reverse()
            # Preserve grain along a beam's long axis by mapping local positions.
            if material in ('aged_timber', 'pine_bark'):
                long_axis = max(range(3), key=lambda i: size[i])
                uvs = []
                for p in points:
                    q = p - Vector(center)
                    longitudinal = q.dot(unit(axis_y)) if axis_y is not None else rotate_y(q, -yaw)[long_axis]
                    transverse = (q.x + q.z) * .55 if long_axis == 1 or axis_y is not None else q.y + q.z * .6
                    uvs.append((transverse * 1.5, longitudinal / 2.2))
            else:
                uvs = None
            self.polygon(points, material, color, uvs)

    def beam(self, a, b, width=.12, depth=None, color=(1, 1, 1), material='aged_timber'):
        a, b = Vector(a), Vector(b)
        self.block((a + b) * .5, (width, (b - a).length, depth or width), material,
                   color, min(.018, width * .14), axis_y=b - a)

    def tube(self, points, radii, material='pine_bark', color=(1, 1, 1), sides=7):
        rings = []
        traveled = [0.0]
        for i, (p, radius) in enumerate(zip(points, radii)):
            direction = unit(Vector(points[min(i + 1, len(points) - 1)]) - Vector(points[max(0, i - 1)]))
            ax = direction.cross(Vector((0, 0, 1)))
            if ax.length < .01:
                ax = direction.cross(Vector((1, 0, 0)))
            ax.normalize()
            az = ax.cross(direction).normalized()
            rings.append([Vector(p) + (ax * math.cos(j * TAU / sides) + az * math.sin(j * TAU / sides)) * radius for j in range(sides)])
            if i:
                traveled.append(traveled[-1] + (Vector(p) - Vector(points[i - 1])).length)
        self.polygon(rings[0], material, color)
        for i in range(len(rings) - 1):
            for j in range(sides):
                nj = (j + 1) % sides
                self.polygon((rings[i][j], rings[i + 1][j], rings[i + 1][nj], rings[i][nj]), material, color,
                             ((j / sides, traveled[i] / 2), (j / sides, traveled[i + 1] / 2),
                              ((j + 1) / sides, traveled[i + 1] / 2), ((j + 1) / sides, traveled[i] / 2)), smooth=True)
        self.polygon(list(reversed(rings[-1])), material, color)

    def finish(self):
        root = bpy.data.objects.new(self.name, None)
        bpy.context.collection.objects.link(root)
        for material, data in self.groups.items():
            mesh = bpy.data.meshes.new(f'{self.name}__{material}')
            mesh.from_pydata([game_to_blender(p) for p in data['vertices']], [], data['faces'])
            mesh.materials.append(MATERIALS[material])
            uv = mesh.uv_layers.new(name='UVMap')
            colors = mesh.color_attributes.new(name='Color', type='BYTE_COLOR', domain='CORNER')
            for polygon, smooth in zip(mesh.polygons, data['smooth']):
                polygon.use_smooth = smooth
                for loop_index in polygon.loop_indices:
                    vid = mesh.loops[loop_index].vertex_index
                    uv.data[loop_index].uv = data['uv'][vid]
                    colors.data[loop_index].color_srgb = data['colors'][vid]
            mesh.update()
            obj = bpy.data.objects.new(mesh.name, mesh)
            bpy.context.collection.objects.link(obj)
            obj.parent = root
        PREFABS[self.name] = root
        return root


def stone_color(y=2, rng=RNG):
    value = rng.uniform(.80, 1.08)
    if y < .65 and rng.random() < .66:
        return (value * .77, value * .90, value * .64)
    if rng.random() < .18:
        return (value * .90, value * .97, value * .82)
    return (value, value * rng.uniform(.96, 1.02), value * rng.uniform(.92, 1.01))


def stone_span(mesh, start, end, bottom, top, depth, axis='x', fixed=0, nominal=.58):
    row_height = .36
    rows = max(1, round((top - bottom) / row_height))
    dy = (top - bottom) / rows
    for row in range(rows):
        y = bottom + (row + .5) * dy
        width = end - start
        count = max(1, round(width / nominal))
        edges = [start] + [start + width * (i + (.2 if row % 2 else -.1)) / count for i in range(1, count)] + [end]
        for a, b in zip(edges, edges[1:]):
            jitter = RNG.uniform(-.009, .009)
            center = ((a + b) * .5, y + jitter, fixed) if axis == 'x' else (fixed, y + jitter, (a + b) * .5)
            size = (b - a - .025, dy - .018, depth) if axis == 'x' else (depth, dy - .018, b - a - .025)
            mesh.block(center, size, color=stone_color(y), bevel=RNG.uniform(.025, .057))


def doorway(mesh, z, width=1.37, height=2.38):
    # Closed arched tower door: eight independently worn boards and forged bands.
    for i in range(8):
        x = (i - 3.5) * width / 8
        arch = math.sqrt(max(0, (width * .5) ** 2 - x * x))
        h = height - width * .5 + arch
        mesh.block((x, h * .5 + .03, z), (width / 8 - .012, h, .12), 'aged_timber',
                   (.66, .67, .57), .012, skew=RNG.uniform(-.004, .004))
    for y in (.47, 1.45):
        mesh.block((0, y, z + .073), (width * .84, .075, .033), 'forged_iron', bevel=.012)
        for x in (-width * .34, 0, width * .34):
            mesh.block((x, y, z + .095), (.04, .04, .027), 'forged_iron', bevel=.008)
    mesh.tube([(.42, 1.02, z + .11), (.42, 1.17, z + .11)], [.025, .025], 'forged_iron', sides=7)
    # Real radial arch stones, individually beveled; dark core behind the joins.
    for side in (-1, 1):
        for j in range(5):
            mesh.block((side * (width * .5 + .16), .19 + j * .335, z - .035), (.30, .32, .32),
                       color=stone_color(), bevel=.035)
    for i in range(9):
        angle = i * math.pi / 8
        center = (math.cos(angle) * (width * .5 + .14), height - width * .5 + math.sin(angle) * (width * .5 + .14), z - .03)
        tangent = (-math.sin(angle), math.cos(angle), 0)
        mesh.block(center, (.30, .28, .33), color=stone_color(), bevel=.028, axis_y=tangent)


def build_tower():
    mesh = KitMesh('watch_tower')
    # Inset structural core is visible only as recessed mortar and slit darkness.
    mesh.tube([(0, -.45, 0), (0, 8.24, 0)], [2.175, 2.245], 'recess_shadow', sides=24)
    courses = 18
    for row in range(courses):
        y = -.37 + row * .46
        radius = 2.21 + max(0, 1.25 - y) * .105
        n = 19
        for j in range(n):
            angle = (j + (row % 2) * .5) * TAU / n
            wrapped = abs((angle + math.pi) % TAU - math.pi)
            if y < 2.36 and wrapped < .37:
                continue
            if 4.7 < y < 6.2 and min(abs((angle - a + math.pi) % TAU - math.pi) for a in (0, 2.1, 4.2)) < .16:
                continue
            width = radius * TAU / n - RNG.uniform(.018, .045)
            mesh.block((math.sin(angle) * radius, y, math.cos(angle) * radius),
                       (width, .441 + RNG.uniform(-.013, .008), .47 + RNG.uniform(-.03, .045)),
                       color=stone_color(y), bevel=RNG.uniform(.035, .065), yaw=angle,
                       skew=RNG.uniform(-.02, .02))
    # Compact feet reinforce the silhouette within the existing collider radius.
    for angle in (1.02, 2.40, 3.9, 5.27):
        for j in range(5):
            radius = 2.53 - j * .045
            mesh.block((math.sin(angle) * radius, -.42 + j * .38, math.cos(angle) * radius),
                       (.66 - j * .018, .375, .67 - j * .075), color=stone_color(j * .38), bevel=.055, yaw=angle)
    for y, radius in ((7.75, 2.24), (8.13, 2.34)):
        for j in range(20):
            angle = j * TAU / 20
            mesh.block((math.sin(angle) * radius, y, math.cos(angle) * radius),
                       (.735, .27, .42), color=stone_color(y), bevel=.04, yaw=angle)
    # Exposed timber corbels and uneven surviving merlons, rather than a crown
    # of identical boxes. A parapet walkway remains visible from gliding height.
    mesh.tube([(0, 8.22, 0), (0, 8.27, 0)], [2.15, 2.15], 'aged_timber', (.72, .74, .63), sides=24)
    for j in range(14):
        angle = j * TAU / 14
        radius = 2.33
        h = (1.06, .78, .93, 1.00, .68, .93, 1.06)[j % 7]
        for k in range(2):
            if j == 5 and k == 1:
                continue
            mesh.block((math.sin(angle) * radius, 8.26 + h * (k + .5) / 2, math.cos(angle) * radius),
                       (.67 - k * .015, h * .5 - .02, .54), color=stone_color(8), bevel=.06, yaw=angle, skew=RNG.uniform(-.04, .04))
        mesh.block((math.sin(angle) * 2.39, 7.41, math.cos(angle) * 2.39), (.18, .62, .36),
                   'aged_timber', (.66, .64, .55), .018, yaw=angle)
    doorway(mesh, 2.34)
    for angle in (0, 2.1, 4.2):
        # Narrow recessed arrow slit with a crossbar. Its framing has real depth.
        for side in (-1, 1):
            p = rotate_y((side * .22, 5.48, 2.235), angle)
            mesh.block(p, (.12, 1.19, .39), color=stone_color(), bevel=.021, yaw=angle)
        for y in (4.84, 6.1):
            mesh.block(rotate_y((0, y, 2.26), angle), (.57, .16, .39), color=stone_color(), bevel=.028, yaw=angle)
        mesh.block(rotate_y((0, 5.49, 2.24), angle), (.045, 1.11, .032), 'forged_iron', bevel=.006, yaw=angle)
    # Small original wall lantern with a warm lens, no runtime light or shadow.
    mesh.beam((1.12, 2.11, 2.22), (1.12, 2.11, 2.57), .055, material='forged_iron')
    mesh.block((1.12, 1.89, 2.52), (.19, .30, .15), 'lantern_amber', bevel=.018)
    for y in (1.70, 2.08):
        mesh.block((1.12, y, 2.52), (.28, .09, .24), 'forged_iron', bevel=.02)
    for x in (.997, 1.243):
        mesh.block((x, 1.89, 2.61), (.025, .31, .025), 'forged_iron', bevel=.004)
    mesh.finish()


def timber_panel(mesh, start, end, bottom, top, axis='x', fixed=0, depth=.16):
    count = max(1, round((end - start) / .25))
    width = (end - start) / count
    for i in range(count):
        mid = start + (i + .5) * width
        center = (mid, (bottom + top) * .5, fixed) if axis == 'x' else (fixed, (bottom + top) * .5, mid)
        size = (width - .01, top - bottom, depth) if axis == 'x' else (depth, top - bottom, width - .01)
        value = RNG.uniform(.79, 1.07)
        mesh.block(center, size, 'aged_timber', (value * .93, value, value * .89), .012,
                   skew=RNG.uniform(-.003, .003))


def build_barracks():
    base = KitMesh('barracks_base')
    # Subsurface floor has no projecting step across either gameplay doorway.
    base.block((0, -.065, 0), (4.24, .13, 3.52), color=(.86, .89, .81), bevel=.035)
    for i in range(10):
        base.block(((i - 4.5) * .379, .012, 0), (.368, .045, 3.02), 'aged_timber',
                   (.63 + RNG.random() * .10, .64, .54), bevel=.008)
    for sign in (-1, 1):
        stone_span(base, -1.77, 1.77, .035, .48, .24, axis='z', fixed=sign * 2.01)
        for a, b in ((-1.89, -1.15), (1.15, 1.89)):
            stone_span(base, a, b, .035, .48, .24, fixed=sign * 1.65)
    base.finish()
    for sign, name in ((1, 'east'), (-1, 'west')):
        mesh = KitMesh(f'barracks_wall_{name}')
        fixed = sign * 2.01
        stone_span(mesh, -1.77, 1.77, .48, 1.18, .24, axis='z', fixed=fixed)
        # Long walls contain two inset leaded windows; all pieces belong to
        # this face so the existing cutaway can remove a whole side cleanly.
        for a, b in ((-1.77, -1.03), (-.37, .37), (1.03, 1.77)):
            timber_panel(mesh, a, b, 1.18, 3.11, 'z', fixed)
        for center in (-.70, .70):
            timber_panel(mesh, center - .33, center + .33, 1.18, 1.74, 'z', fixed)
            timber_panel(mesh, center - .33, center + .33, 2.40, 3.11, 'z', fixed)
            mesh.block((fixed, 2.07, center), (.17, .66, .66), 'recess_shadow', bevel=.013)
            for z in (center - .37, center + .37):
                mesh.block((fixed, 2.07, z), (.24, .81, .075), 'aged_timber', (.76, .79, .69), bevel=.012)
            for y in (1.70, 2.44):
                mesh.block((fixed, y, center), (.24, .095, .81), 'aged_timber', (.76, .79, .69), bevel=.014)
            mesh.block((fixed + sign * .104, 2.07, center), (.03, .65, .042), 'forged_iron', bevel=.005)
            mesh.block((fixed + sign * .104, 2.07, center), (.03, .038, .65), 'forged_iron', bevel=.005)
        for z in (-1.65, 0, 1.65):
            mesh.block((fixed, 2.14, z), (.24, 1.91, .17), 'aged_timber', (.67, .69, .57), bevel=.02)
        mesh.block((fixed, 3.09, 0), (.24, .22, 3.54), 'aged_timber', (.73, .72, .64), bevel=.018)
        for a, b in ((-1.55, -1.05), (1.05, 1.55)):
            mesh.beam((fixed + sign * .06, 2.57, a), (fixed + sign * .06, 3.05, b), .10, color=(.76, .75, .66))
        mesh.finish()
    for sign, name in ((1, 'front'), (-1, 'back')):
        mesh = KitMesh(f'barracks_wall_{name}')
        fixed = sign * 1.65
        for a, b in ((-1.89, -1.15), (1.15, 1.89)):
            stone_span(mesh, a, b, .48, 1.18, .24, fixed=fixed)
            timber_panel(mesh, a, b, 1.18, 2.96, fixed=fixed)
        # Interior edge of posts exactly 1.15: 2.30m openings stay unobstructed.
        for x in (-1.23, 1.23):
            mesh.block((x, 1.89, fixed), (.16, 2.18, .24), 'aged_timber', (.72, .72, .61), bevel=.018)
        mesh.block((0, 2.98, fixed), (3.78, .36, .24), 'aged_timber', (.69, .71, .59), bevel=.025)
        for x in (-1.53, 1.53):
            mesh.block((x, 2.98, fixed + sign * .105), (.23, .07, .027), 'forged_iron', bevel=.008)
        mesh.finish()
    roof = KitMesh('barracks_roof')
    # Gable infill and rafters remain entirely in the removable roof root.
    for z in (-1.67, 1.67):
        for i in range(16):
            x = (i - 7.5) * .25
            h = 1.60 * (1 - abs(x) / 2.05)
            if h > .08:
                roof.block((x, 3.23 + h * .5, z), (.24, h, .11), 'aged_timber', (.75, .78, .68), bevel=.01)
        for sign in (-1, 1):
            roof.beam((sign * 2.19, 3.26, z), (0, 4.96, z), .17, .18, (.64, .67, .58))
            roof.beam((0, 3.27, z), (sign * 1.36, 3.81, z), .115, color=(.72, .71, .61))
        roof.beam((0, 3.24, z), (0, 4.93, z), .14, color=(.61, .64, .54))
    for x in (-2.18, 2.18):
        roof.beam((x, 3.30, -1.88), (x, 3.30, 1.88), .14, color=(.62, .64, .53))
    # Underroof planes seal joints. Individual overlapping chipped slates create
    # convincing eaves, breakup, and grazing-angle shadows without displacement.
    for sign in (-1, 1):
        a, b = (sign * 2.22, 3.27, -1.85), (0, 5.025, -1.85)
        roof.polygon((a, b, (b[0], b[1], 1.85), (a[0], a[1], 1.85)), 'dark_slate', (.76, .79, .83))
        rows = 8
        for row in range(rows):
            t = (row + .35) / rows
            x = sign * 2.19 * (1 - t)
            y = 3.30 + 1.73 * t
            cols = 12
            for j in range(cols):
                z = -1.84 + (j + .5) * 3.68 / cols
                width = .312 + RNG.uniform(-.018, .008)
                # Flat beveled boxes oriented so their long axis follows the
                # slope; exposed edges have small physical chips and offsets.
                value = RNG.uniform(.78, 1.14)
                roof.block((x + RNG.uniform(-.008, .008), y + RNG.uniform(-.009, .009), z),
                           (.035, .435, width), 'dark_slate', (value * .95, value, value), bevel=0,
                           axis_y=(-sign * 2.19, 1.73, 0))
    for j in range(13):
        z = (j - 6) * .287
        roof.block((0, 5.025, z), (.22, .13, .297), 'dark_slate', (.91, .96, .97), bevel=.045)
    roof.finish()


def build_ruin():
    mesh = KitMesh('ruin_wall')
    tops = (.9, 1.55, 1.7, 1.21, .72, 1.04, 1.37)
    for col in range(7):
        x = -1.8 + col * .6
        count = max(1, round((tops[col] + .25) / .34))
        h = (tops[col] + .25) / count
        for row in range(count):
            y = -.25 + (row + .5) * h
            mesh.block((x + RNG.uniform(-.004, .004), y, RNG.uniform(-.024, .024)),
                       (.58, h - .016, RNG.uniform(.49, .59)), color=stone_color(y), bevel=RNG.uniform(.045, .078), skew=RNG.uniform(-.03, .03))
    # A few fallen chips sit inside the footprint, creating a believable base.
    for i in range(7):
        mesh.block((-1.87 + i * .57, -.14, RNG.uniform(-.16, .16)), (.36, .17, .30),
                   color=stone_color(0), bevel=.043, yaw=RNG.uniform(-.35, .35))
    mesh.finish()


def build_rock(name, variant):
    mesh = KitMesh(name)
    rings, segments = 11, 19
    rows = []
    for i in range(rings + 1):
        theta = math.pi * i / rings
        row = []
        for j in range(segments):
            phi = j * TAU / segments
            noise = 1 + math.sin(phi * 3 + theta * 5 + variant) * .085 + math.sin(phi * 7 - theta * 2) * .065
            radius = math.sin(theta) * .92 * noise
            x = radius * math.cos(phi) * (1 if variant == 0 else .89)
            z = radius * math.sin(phi) * (.92 if variant == 0 else .99)
            y = .48 + math.cos(theta) * .715
            y += math.sin(phi * 3 + theta * 5) * math.sin(theta) * .085
            x += math.cos(theta) * (.075 if variant else -.04)
            # Flatten the buried base while keeping its contour irregular.
            y = max(-.249, y)
            row.append(Vector((x, y, z)))
        rows.append(row)
    # Clamp horizontal radius to the collision contract after shaping.
    radius = max(math.hypot(p.x, p.z) for row in rows for p in row)
    for row in rows:
        for p in row:
            p.x *= .988 / max(1, radius)
            p.z *= .988 / max(1, radius)
    for i in range(rings):
        for j in range(segments):
            nj = (j + 1) % segments
            points = (rows[i][nj], rows[i + 1][nj], rows[i + 1][j], rows[i][j])
            if 2 <= i <= rings - 3:
                normal = (points[1] - points[0]).cross(points[2] - points[0])
                away = sum(points, Vector()) / 4 - Vector((0, .48, 0))
                assert normal.dot(away) > 0, f'{name}: inward rock face'
            colors = []
            for p in points:
                moss = clamp((p.y - .44) * .9 + .17 * math.sin(p.x * 13 + p.z * 8))
                value = .86 + .10 * math.sin(p.x * 8 + p.z * 9 + p.y * 4)
                colors.append((value * (1 - moss * .22), value * (1 - moss * .06), value * (1 - moss * .36)))
            mesh.polygon(points, 'watch_stone', colors, [(p.x * .95 + p.z * .34, p.y * .85 + p.z * .31) for p in points], smooth=False)
    mesh.finish()


def foliage_spray(mesh, origin, direction, length, width, tint, pitch=0):
    """A convex serrated fir spray, modeled silhouette (no cards or alpha)."""
    origin, direction = Vector(origin), unit(direction)
    sideways = direction.cross(Vector((0, 1, 0))).normalized()
    up = sideways.cross(direction).normalized()
    if up.y < 0:
        up.negate()
    up = up * math.cos(pitch) + sideways * math.sin(pitch)
    sides = []
    lobes = 5
    for side in (-1, 1):
        edge = []
        for i in range(lobes):
            t = i / lobes
            shape = math.sin((t * .88 + .08) * math.pi) ** .62 * (1 - t * .27)
            center = origin + direction * length * t + up * (math.sin(t * math.pi) * .055)
            edge.append(center + sideways * side * width * shape)
            edge.append(origin + direction * length * (t + .075) + sideways * side * width * shape * .34)
        edge.append(origin + direction * length)
        sides.append(edge)
    for side_index, edge in enumerate(sides):
        for i in range(len(edge) - 1):
            t = (i + .5) / (len(edge) - 1)
            spine = origin + direction * length * t + up * (math.sin(t * math.pi) * .09)
            pts = (edge[i], edge[i + 1], spine)
            if side_index:
                pts = tuple(reversed(pts))
            mesh.polygon(pts, 'needle_foliage', tint,
                         ((0 if side_index == 0 else 1, i / len(edge)),
                          (0 if side_index == 0 else 1, (i + 1) / len(edge)), (.5, t)))


def build_pine(name, height, max_radius, variant):
    mesh = KitMesh(name)
    trunk_radius = .28 if height == 8 else .32
    trunk = [(math.sin(i * .51 + variant) * .052 * i / 8, height * i / 8,
              math.sin(i * .72) * .047 * i / 8) for i in range(9)]
    mesh.tube(trunk, [trunk_radius * (1 - i / 9) ** 1.15 for i in range(9)], color=(.63, .65, .55), sides=10)
    # Root flares stay inside the existing narrow trunk collision envelope.
    for j in range(5):
        a = j * TAU / 5 + variant
        mesh.tube([(math.cos(a) * trunk_radius * 1.13, -.14, math.sin(a) * trunk_radius * 1.13),
                   (math.cos(a) * trunk_radius * .64, .35, math.sin(a) * trunk_radius * .64), (0, .87, 0)],
                  [.08, .075, .05], color=(.67, .67, .56), sides=5)
    tiers = 7 if height == 8 else 8
    for tier in range(tiers):
        y = height * (.19 + tier * .095)
        remaining = 1 - (y / height)
        reach = max_radius * (remaining ** .69) * RNG.uniform(.84, 1.0)
        count = 6 if tier < tiers - 2 else 5
        offset = tier * 1.913 + variant
        for j in range(count):
            angle = j * TAU / count + offset + RNG.uniform(-.17, .17)
            direction = Vector((math.cos(angle), 0, math.sin(angle)))
            side = Vector((-direction.z, 0, direction.x))
            length = reach * RNG.uniform(.76, 1.05)
            start = Vector((0, y + RNG.uniform(-.13, .13), 0))
            mid = start + direction * length * .52 + Vector((0, -.18, 0))
            end = start + direction * length + Vector((0, .12 + tier * .035, 0))
            mesh.tube((start, mid, end), (.069 * remaining, .035, .009), color=(.56, .57, .45), sides=5)
            for k in range(5):
                t = .22 + k * .15
                position = start.lerp(end, t) + Vector((0, -.14 * math.sin(t * math.pi), 0))
                for branch_side in (-1, 1):
                    lateral = direction * .60 + side * branch_side * .8
                    lateral.y = RNG.uniform(-.04, .21)
                    spray_length = (.61 - t * .19) * (remaining * .65 + .60)
                    value = RNG.uniform(.70, .96)
                    tint = (value * .67, value * .88, value * .63)
                    foliage_spray(mesh, position, lateral, spray_length, spray_length * .33, tint,
                                  RNG.uniform(-.35, .35))
            foliage_spray(mesh, end - direction * .17, direction + Vector((0, .23, 0)), .39, .14, (.68, .89, .59))
    # Uneven leader sprays complete the crown without a cone or globe cap.
    for i in range(8):
        angle = i * 2.399
        y = height * (.79 + i * .021)
        direction = Vector((math.cos(angle) * .5, .73, math.sin(angle) * .5))
        foliage_spray(mesh, (0, y, 0), direction, min(.58, height - y - .03), .16, (.70, .91, .65))
    mesh.finish()


def build_grass():
    mesh = KitMesh('grass_clump')
    for i in range(47):
        angle = RNG.random() * TAU
        radius = RNG.random() ** .5 * .21
        origin = Vector((math.cos(angle) * radius, 0, math.sin(angle) * radius))
        lean = Vector((math.cos(angle + .4), 0, math.sin(angle + .4))) * RNG.uniform(.07, .20)
        across = Vector((-math.sin(angle), 0, math.cos(angle)))
        h = RNG.uniform(.27, .65)
        width = RNG.uniform(.012, .025)
        points = []
        for j in range(5):
            t = j / 4
            center = origin + Vector((0, h * (t - .14 * t ** 3), 0)) + lean * t ** 2
            points.append((center - across * width * (1 - t), center + across * width * (1 - t)))
        warm = i % 3 != 0
        for j in range(4):
            t = j / 4
            tint = (.95 + t * .05, .68 + t * .09, .48 + t * .18) if warm else (.74, .88, .48)
            mesh.polygon((points[j][0], points[j][1], points[j + 1][1], points[j + 1][0]),
                         'needle_foliage', tint, ((0, j / 4), (1, j / 4), (1, (j + 1) / 4), (0, (j + 1) / 4)))
    mesh.finish()


def build_fern():
    mesh = KitMesh('fern_clump')
    for frond in range(9):
        angle = frond * 2.399
        reach = RNG.uniform(.40, .60)
        rise = RNG.uniform(.39, .68)
        direction = Vector((math.cos(angle), 0, math.sin(angle)))
        sideways = Vector((-direction.z, 0, direction.x))
        def point(t):
            return direction * reach * t + Vector((0, rise * math.sin(t * math.pi * .77), 0))
        spine = [point(i / 9) for i in range(10)]
        mesh.tube(spine, [.009 * (1 - i / 11) for i in range(10)], 'needle_foliage', (.86, 1.03, .57), sides=4)
        for j in range(1, 10):
            t = j / 10
            width = math.sin(t * math.pi) * .18 * (1 - t * .35)
            center = point(t)
            for sign in (-1, 1):
                end = center + sideways * sign * width + direction * .074 + Vector((0, -.008, 0))
                mid = center.lerp(end, .50) + Vector((0, .017, 0))
                spread = direction * (.028 * (1 - t * .5))
                value = RNG.uniform(.83, 1.05)
                tint = (value * .74, value, value * .57)
                mesh.polygon((center, mid - spread, end, mid + spread), 'needle_foliage', tint,
                             ((.5, 0), (0, .5), (.5, 1), (1, .5)))
    mesh.finish()


EXPECTED = ['watch_tower', 'barracks_base', 'barracks_wall_east', 'barracks_wall_west',
            'barracks_wall_front', 'barracks_wall_back', 'barracks_roof', 'ruin_wall',
            'rock_a', 'rock_b', 'pine_a', 'pine_b', 'grass_clump', 'fern_clump', 'ground_sample']


def inspect_glb(path):
    raw = path.read_bytes()
    magic, version, length = struct.unpack_from('<4sII', raw)
    assert (magic, version, length) == (b'glTF', 2, len(raw))
    json_length, json_type = struct.unpack_from('<II', raw, 12)
    assert json_type == 0x4e4f534a
    gltf = json.loads(raw[20:20 + json_length])
    bin_start = 20 + json_length + 8
    def positions_for(accessor_index):
        accessor = gltf['accessors'][accessor_index]
        view = gltf['bufferViews'][accessor['bufferView']]
        assert accessor['componentType'] == 5126 and accessor['type'] == 'VEC3'
        assert view.get('byteStride', 12) == 12
        offset = bin_start + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        return np.frombuffer(raw, dtype='<f4', count=accessor['count'] * 3, offset=offset).reshape((-1, 3))
    nodes = gltf['nodes']
    roots = {nodes[i]['name']: i for i in gltf['scenes'][gltf.get('scene', 0)]['nodes']}
    assert set(roots) == set(EXPECTED), f'Unexpected prefab roots: {roots.keys()}'
    manifest = {'schemaVersion': 1, 'generator': 'tools/build-old-watch.py', 'seed': SEED,
                'blenderVersion': bpy.app.version_string, 'coordinateSystem': 'Y-up, meters, +Z front',
                'sourceLicense': 'Original Skywake Isles project assets; see CREDITS.md',
                'file': 'kit.glb', 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                'prefabs': {}, 'textures': TEXTURES}
    total_triangles = 0
    for name, index in roots.items():
        node = nodes[index]
        assert 'translation' not in node and 'rotation' not in node and 'scale' not in node and 'matrix' not in node, f'{name}: root must be identity'
        minimum = np.array([float('inf')] * 3)
        maximum = -minimum
        triangles, materials, primitives, horizontal_radius = 0, set(), 0, 0
        todo = [index]
        while todo:
            n = nodes[todo.pop()]
            todo.extend(n.get('children', []))
            assert not any(key in n for key in ('matrix', 'translation', 'rotation', 'scale')), f'{name}: child transform must be baked'
            if 'mesh' not in n:
                continue
            for primitive in gltf['meshes'][n['mesh']]['primitives']:
                primitives += 1
                attributes = primitive['attributes']
                assert all(key in attributes for key in ('NORMAL', 'TEXCOORD_0', 'COLOR_0'))
                accessor = gltf['accessors'][attributes['POSITION']]
                positions = positions_for(attributes['POSITION'])
                assert np.isfinite(positions).all(), f'{name}: non-finite vertex'
                horizontal_radius = max(horizontal_radius, float(np.linalg.norm(positions[:, (0, 2)], axis=1).max()))
                if name in ('barracks_base', 'barracks_wall_front', 'barracks_wall_back'):
                    in_door = ((np.abs(positions[:, 0]) < 1.1499) & (np.abs(positions[:, 2]) > 1.49)
                               & (positions[:, 1] > .08) & (positions[:, 1] < 2.7999))
                    assert not in_door.any(), f'{name}: geometry obstructs 2.30m door opening'
                minimum = np.minimum(minimum, accessor['min'])
                maximum = np.maximum(maximum, accessor['max'])
                triangles += gltf['accessors'][primitive['indices']]['count'] // 3
                materials.add(gltf['materials'][primitive['material']]['name'])
        total_triangles += triangles
        manifest['prefabs'][name] = {'bounds': {'min': minimum.round(5).tolist(), 'max': maximum.round(5).tolist()},
                                     'dimensions': (maximum - minimum).round(5).tolist(),
                                     'horizontalRadius': round(horizontal_radius, 5),
                                     'triangles': triangles, 'primitives': primitives, 'materials': sorted(materials)}
    def bounds(name):
        p = manifest['prefabs'][name]['bounds']
        return p['min'], p['max']
    for name in ('barracks_base', 'barracks_wall_east', 'barracks_wall_west', 'barracks_wall_front', 'barracks_wall_back'):
        low, high = bounds(name)
        assert low[0] >= -2.1301 and high[0] <= 2.1301 and low[2] >= -1.7701 and high[2] <= 1.7701, (name, low, high)
        assert high[1] <= 3.205
    low, high = bounds('barracks_roof')
    assert low[0] >= -2.30 and high[0] <= 2.30 and low[2] >= -1.95 and high[2] <= 1.95
    assert low[1] >= 3.2 and high[1] <= 5.5
    low, high = bounds('ruin_wall')
    assert low[0] >= -2.1 and high[0] <= 2.1 and low[2] >= -.325 and high[2] <= .325
    assert low[1] >= -.25 and high[1] <= 1.7
    low, high = bounds('watch_tower')
    assert low[1] >= -.8 and high[1] <= 10 and max(abs(low[0]), abs(high[0]), abs(low[2]), abs(high[2])) <= 3
    assert manifest['prefabs']['watch_tower']['horizontalRadius'] <= 3
    for name in ('rock_a', 'rock_b'):
        low, high = bounds(name)
        assert low[1] >= -.255 and high[1] <= 1.25
        assert max(abs(low[0]), abs(high[0]), abs(low[2]), abs(high[2])) <= 1.001
        assert manifest['prefabs'][name]['horizontalRadius'] <= 1.001
    for name, height, radius in (('pine_a', 8, 2.4), ('pine_b', 10, 2.9), ('grass_clump', .65, .45), ('fern_clump', .75, .65)):
        low, high = bounds(name)
        assert high[1] <= height + .001, (name, high)
        assert max(abs(low[0]), abs(high[0]), abs(low[2]), abs(high[2])) <= radius, (name, low, high)
        assert manifest['prefabs'][name]['horizontalRadius'] <= radius + .001, (name, manifest['prefabs'][name])
    assert 'ground_earth' in manifest['prefabs']['ground_sample']['materials']
    assert len(raw) <= 8 * 1024 * 1024, len(raw)
    assert total_triangles <= 120000, total_triangles
    assert all('uri' not in img and 'bufferView' in img for img in gltf['images']), 'Images must be embedded'
    assert all('uri' not in buffer for buffer in gltf['buffers']), 'Buffers must be embedded'
    manifest['totalTriangles'] = total_triangles
    manifest['totalPrimitives'] = sum(p['primitives'] for p in manifest['prefabs'].values())
    manifest['embeddedImageCount'] = len(gltf['images'])
    return manifest


def preview(path):
    """Optional offline overview for artist QA, outside the shipping directory."""
    for name, root in PREFABS.items():
        root.hide_render = name == 'ground_sample'
    positions = {'watch_tower': (-4.9, 0, 0), 'barracks_base': (2.4, 0, 0),
                 'barracks_wall_east': (2.4, 0, 0), 'barracks_wall_west': (2.4, 0, 0),
                 'barracks_wall_front': (2.4, 0, 0), 'barracks_wall_back': (2.4, 0, 0),
                 'barracks_roof': (2.4, 0, 0), 'pine_a': (-1.5, 0, -5.0), 'pine_b': (5.5, 0, -5.2),
                 'rock_a': (-.4, 0, 2.7), 'rock_b': (-2.0, 0, 2.7), 'ruin_wall': (3.0, 0, 3.1),
                 'grass_clump': (-.3, 0, 4.2), 'fern_clump': (-1.3, 0, 4.0)}
    for name, position in positions.items():
        PREFABS[name].location = game_to_blender(position)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.24))
    ground = bpy.context.object
    ground.data.materials.append(MATERIALS['ground_earth'])
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    world = bpy.data.worlds.new('preview_world')
    world.use_nodes = True
    world.node_tree.nodes.get('Background').inputs['Color'].default_value = (.37, .47, .60, 1)
    world.node_tree.nodes.get('Background').inputs['Strength'].default_value = .6
    scene.world = world
    bpy.ops.object.light_add(type='AREA', location=(-7, -4, 14))
    key = bpy.context.object
    key.data.energy = 2800
    key.data.shape = 'DISK'
    key.data.size = 8
    key.data.color = (1, .88, .70)
    key.rotation_euler = (Vector((0, 0, 2)) - key.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.ops.object.camera_add(location=(16, -24, 16))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((.1, 1.0, 3.3)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 19
    scene.camera = camera
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1100
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'AgX'
    scene.render.filepath = str(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'client/assets/old-watch')
    parser.add_argument('--preview', type=pathlib.Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    args.output.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    with tempfile.TemporaryDirectory(prefix='skywake-old-watch-') as temporary:
        create_materials(pathlib.Path(temporary))
        build_tower()
        build_barracks()
        build_ruin()
        build_rock('rock_a', 0)
        build_rock('rock_b', 1)
        build_pine('pine_a', 8, 2.4, .3)
        build_pine('pine_b', 10, 2.9, 1.1)
        build_grass()
        build_fern()
        ground = KitMesh('ground_sample')
        ground.polygon(((-.5, 0, -.5), (-.5, 0, .5), (.5, 0, .5), (.5, 0, -.5)), 'ground_earth')
        ground.finish()
        bpy.ops.object.select_all(action='SELECT')
        output = args.output / 'kit.glb'
        bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', export_yup=True,
                                  export_apply=True, export_texcoords=True, export_normals=True,
                                  export_materials='EXPORT', export_image_format='AUTO',
                                  export_animations=False, export_cameras=False, export_lights=False,
                                  export_draco_mesh_compression_enable=False, export_extras=False,
                                  export_attributes=True, export_all_vertex_colors=False,
                                  export_vertex_color='NAME', export_vertex_color_name='Color',
                                  export_active_vertex_color_when_no_material=True)
        manifest = inspect_glb(output)
        (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        print(f'OLD_WATCH_OK: {len(PREFABS)} prefabs, {manifest["totalTriangles"]:,} triangles, {manifest["bytes"]:,} bytes')
        if args.preview:
            preview(args.preview.resolve())


if __name__ == '__main__':
    main()
