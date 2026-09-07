"""Build Palmheart Camp and Wilds' original, geometry-only environment kit extension.

    blender --background --factory-startup --python-exit-code 1 --python tools/build-palmheart-camp.py

Named slots borrow Old Watch's original textures at runtime, the same extension
pattern as Windward Farm, Tideglass Market, Saltwind Harbor and Driftwood Yard.
--output supports independent byte comparisons; --preview creates an untracked
textured contact sheet after export, without putting preview images into the
shipping GLB.

Milestone 6 sample: a trail-keeper's camp in humid jungle. Nothing here repeats
a shipped coastal row: the shelter is woven palm matting lashed to a dark
hardwood pole frame under layered palm-frond thatch, and the wilds are
buttressed broadleaf hardwoods, tall pinnate palms and elephant-ear clumps.

  trailkeepers_tent   A-frame ridge shelter, lashed tripods, thatched slopes,
                      woven mat walls, a rolled canvas door flap, buried skirt
  fire_ring           fieldstone ring with sooted inner faces, ash, charred
                      logs, an iron tripod and kettle, split-log benches
  gear_rack           lashed drying rack with a hung hide, slat crate, water
                      cask and a coral trail-keeper pennant
  camp_lantern        hardwood post, rope wraps, thatch hood over amber glass
  jungle_tree_a/b     buttressed broadleaf hardwoods, modelled ovate leaves
  jungle_palm         ringed curved trunk with arching pinnate fronds
  elephant_ear_clump  heart-shaped ground leaves on arching stalks

Trees are walkable decoration; the trunk-radius contract below keeps the four
recorded collidable jungle trees inside their authored silhouettes.
"""

import argparse
import hashlib
import importlib.util
import json
import math
import pathlib
import random
import struct
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Vector

# Blender does not automatically add a --python script's directory to sys.path.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from environment_kit import (MATERIALS, PREFABS, KitMesh, game_to_blender, unit,
                             create_binding_material, export_glb)

ROOT = pathlib.Path(__file__).resolve().parents[1]
SEED = 512023
RNG = random.Random(SEED)
TAU = math.tau
SHARED_KIT = '/assets/old-watch/kit.glb'
MATERIAL_BINDINGS = {
    'watch_stone': {'source': 'watch_stone'},
    'aged_timber': {'source': 'aged_timber'},
    'forged_iron': {'source': 'forged_iron'},
    'recess_shadow': {'source': 'recess_shadow'},
    'lantern_amber': {'source': 'lantern_amber'},
    'needle_foliage': {'source': 'needle_foliage'},
    'jungle_hardwood': {'source': 'aged_timber', 'color': [1.6, 1.15, .85], 'normalScale': .5},
    'palm_thatch': {'source': 'needle_foliage', 'color': [3.0, 2.3, 1.0], 'normalScale': .6, 'doubleSided': True},
    'woven_mat': {'source': 'ground_earth', 'color': [4.6, 3.9, 2.4], 'normalScale': .35},
    'hemp_rope': {'source': 'needle_foliage', 'color': [2.6, 1.7, 1.1]},
    'canvas_flap': {'source': 'ground_earth', 'color': [7.5, 7.0, 5.6], 'doubleSided': True},
    'charred_wood': {'source': 'aged_timber', 'color': [.45, .40, .36], 'normalScale': .3},
    'jungle_bark': {'source': 'pine_bark', 'color': [1.35, 1.2, 1.05], 'normalScale': .8},
    'broad_leaf': {'source': 'needle_foliage', 'color': [.85, 1.35, .75], 'normalScale': .5, 'doubleSided': True},
    'palm_frond': {'source': 'needle_foliage', 'color': [1.05, 1.45, .70], 'normalScale': .5, 'doubleSided': True},
    'elephant_ear': {'source': 'needle_foliage', 'color': [.75, 1.30, .68], 'normalScale': .5, 'doubleSided': True},
}
# root -> (maximum horizontal radius, minimum y, maximum y).
PROP_ENVELOPES = {
    'trailkeepers_tent': (2.95, -.50, 4.10),
    'fire_ring': (1.70, -.05, 1.55),
    'gear_rack': (1.70, -.05, 3.10),
    'camp_lantern': (.50, -.06, 2.70),
    'jungle_tree_a': (3.40, -.20, 9.00),
    'jungle_tree_b': (3.80, -.20, 11.00),
    'jungle_palm': (3.30, -.20, 9.50),
    'elephant_ear_clump': (.90, .00, 1.10),
}
# Every jungle_bark vertex between y 0 and 1 stays inside these radii, so a
# runtime-scaled trunk keeps its silhouette inside the recorded tree collider.
TRUNK_LIMITS = {'jungle_tree_a': .40, 'jungle_tree_b': .44, 'jungle_palm': .32}
EXPECTED = list(PROP_ENVELOPES)


def wood_color(rng=RNG):
    shade = rng.uniform(.80, 1.05)
    return (shade, shade * .96, shade * .87)


def bark_color(y, rng=RNG):
    """Damp jungle bark: mossier and darker near the humid forest floor."""
    shade = rng.uniform(.74, 1.02)
    moss = rng.uniform(.14, .26) if y < 1.6 and rng.random() < .5 else .02
    return (shade * (1 - moss * .70), shade * (1 - moss * .12), shade * (1 - moss * .95))


def buttress_color(point, rng=RNG):
    """Buttress fins read as bark: the hardwood slot's tint is cancelled by the
    ratio between the two bindings, and moss fades smoothly off the ground."""
    shade = rng.uniform(.82, 1.02)
    moss = max(0.0, min(1.0, (1.10 - point.y) * .58)) * (.50 + .28 * math.sin(point.x * 7 + point.z * 5))
    base = (shade * (1 - moss * .36), shade * (1 - moss * .07), shade * (1 - moss * .48))
    return (base[0] * .844, base[1] * 1.043, base[2] * 1.235)


def stone_color(y, rng=RNG):
    shade = rng.uniform(.76, 1.04)
    moss = rng.uniform(.16, .30) if y < .34 and rng.random() < .55 else .03
    return (shade * (1 - moss), shade * (1 - moss * .22), shade * (1 - moss * 1.3))


def mat_color(rng=RNG):
    shade = rng.uniform(.78, 1.04)
    return (shade, shade * .93, shade * .80)


def canvas_color(rng=RNG):
    shade = rng.uniform(.84, 1.03)
    return (shade, shade * .98, shade * .93)


def leaf_tint(value, rng=RNG):
    return (value * rng.uniform(.86, .98), value * rng.uniform(1.0, 1.10), value * rng.uniform(.78, .90))


def newell(points):
    normal = Vector()
    for i, p in enumerate(points):
        q = points[(i + 1) % len(points)]
        normal += Vector((p.y * q.z - p.z * q.y, p.z * q.x - p.x * q.z, p.x * q.y - p.y * q.x))
    return normal


def faced_polygon(mesh, points, outward, material, colors):
    """One outward-wound polygon; concave outlines keep a correct Newell normal."""
    points, colors = list(points), list(colors)
    if newell(points).dot(Vector(outward)) < 0:
        points.reverse()
        colors.reverse()
    mesh.polygon(points, material, colors)


def shaded_solid(mesh, vertices, faces, material, shade):
    """A closed convex solid whose vertex colors come from a position callback."""
    center = sum((Vector(p) for p in vertices), Vector()) / len(vertices)
    for indices in faces:
        points = [Vector(vertices[i]) for i in indices]
        outward = sum(points, Vector()) / len(points) - center
        faced_polygon(mesh, points, outward, material, [shade(p) for p in points])


def rock_prism(mesh, center, radius, height, material, shade, sides=8, squash=1.0, yaw=0.0, rng=RNG):
    """An irregular low fieldstone; per-vertex color carries moss and soot."""
    cx, cy, cz = center
    lower, upper = [], []
    for i in range(sides):
        angle = yaw + i * TAU / sides
        r = radius * rng.uniform(.80, 1.14)
        lower.append((cx + math.cos(angle) * r, cy, cz + math.sin(angle) * r * squash))
        rt = r * rng.uniform(.56, .80)
        upper.append((cx + math.cos(angle) * rt, cy + height * rng.uniform(.82, 1.06),
                      cz + math.sin(angle) * rt * squash))
    faces = [list(range(sides)), list(range(sides, sides * 2))]
    faces += [[i, (i + 1) % sides, (i + 1) % sides + sides, i + sides] for i in range(sides)]
    shaded_solid(mesh, lower + upper, faces, material, shade)


def lash(mesh, center, axis, radius, *, turns=1, tube=.021, color=(.88, .80, .62), steps=6):
    """A hemp rope wrap around a pole crossing."""
    axis = unit(axis)
    ax = axis.cross(Vector((0, 0, 1)))
    if ax.length < .01:
        ax = axis.cross(Vector((1, 0, 0)))
    ax.normalize()
    az = ax.cross(axis).normalized()
    count = steps * turns
    points = [Vector(center) + (ax * math.cos(i * TAU / steps) + az * math.sin(i * TAU / steps)) * radius
              + axis * (tube * 1.7 * (i / steps - turns * .5)) for i in range(count + 1)]
    mesh.tube(points, [tube] * len(points), 'hemp_rope', color, sides=3)


def rope_loop(mesh, center, radius, *, turns=1, rise=.05, sides=3, tube=.020, color=(.88, .82, .68)):
    cx, cy, cz = center
    points = [(cx + math.cos(a) * radius, cy + rise * a / TAU, cz + math.sin(a) * radius)
              for a in [i * TAU / 9 for i in range(9 * turns + 1)]]
    mesh.tube(points, [tube] * len(points), 'hemp_rope', color, sides=sides)


def fin(mesh, origin, angle, profile, thickness, material, shade):
    """Extrude a (radial, height) outline into a thin outward-wound buttress plate."""
    radial = Vector((math.cos(angle), 0, math.sin(angle)))
    tangent = Vector((-math.sin(angle), 0, math.cos(angle)))
    up = Vector((0, 1, 0))
    count = len(profile)
    near = [Vector(origin) + radial * r + up * y - tangent * (thickness * .5) for r, y in profile]
    far = [Vector(origin) + radial * r + up * y + tangent * (thickness * .5) for r, y in profile]
    area = sum(profile[i][0] * profile[(i + 1) % count][1] - profile[(i + 1) % count][0] * profile[i][1]
               for i in range(count)) * .5
    turn = 1 if area > 0 else -1
    faced_polygon(mesh, near, -tangent, material, [shade(p) for p in near])
    faced_polygon(mesh, far, tangent, material, [shade(p) for p in far])
    for i in range(count):
        j = (i + 1) % count
        dr, dy = profile[j][0] - profile[i][0], profile[j][1] - profile[i][1]
        quad = [near[i], near[j], far[j], far[i]]
        faced_polygon(mesh, quad, (radial * dy - up * dr) * turn, material, [shade(p) for p in quad])


def along(points, t):
    """Sample a polyline by normalized length index."""
    spans = len(points) - 1
    index = min(spans - 1, max(0, int(t * spans)))
    return Vector(points[index]).lerp(Vector(points[index + 1]), t * spans - index)


def clamp_radius(point, limit):
    radius = math.hypot(point.x, point.z)
    if radius <= limit or radius < 1e-6:
        return Vector(point)
    scale = limit / radius
    return Vector((point.x * scale, point.y, point.z * scale))


def frame(forward, roll=0.0):
    """A leaf frame: forward axis, an upward-ish face normal, rolled about forward."""
    forward = unit(forward)
    side = forward.cross(Vector((0, 1, 0)))
    if side.length < .01:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(forward).normalized()
    if roll:
        up, side = ((up * math.cos(roll) - side * math.sin(roll)).normalized(),
                    (side * math.cos(roll) + up * math.sin(roll)).normalized())
    return forward, side, up


def ovate_leaf(mesh, base, forward, up, length, width, material, tint, rng, droop=.26, fold=.16):
    """A modelled ovate broadleaf: two halves folded either side of a raised midrib."""
    side = forward.cross(up).normalized()
    down = Vector((0, -1, 0))
    samples = (0.0, .34, .70, 1.0)
    mid = [Vector(base) + forward * (length * t) + down * (droop * length * t * t)
           + up * (fold * width * math.sin(t * math.pi)) for t in samples]
    half = [width * math.sin(math.pi * (t ** .74)) ** .62 for t in samples]
    for sign in (-1, 1):
        edge = [mid[i] + side * (sign * half[i]) - up * (fold * half[i] * .55) for i in range(4)]
        shade = [(tint[0] * v, tint[1] * v, tint[2] * v)
                 for v in (rng.uniform(.80, .92), rng.uniform(.93, 1.02),
                           rng.uniform(.98, 1.08), rng.uniform(1.02, 1.14))]
        mesh.polygon((mid[0], edge[1], mid[1]), material, [shade[0], shade[1], shade[1]])
        mesh.polygon((mid[1], edge[1], edge[2], mid[2]), material, [shade[1], shade[1], shade[2], shade[2]])
        mesh.polygon((mid[2], edge[2], mid[3]), material, [shade[2], shade[2], shade[3]])


def heart_leaf(mesh, base, forward, up, length, width, material, tint, rng, fold=.15):
    """An elephant-ear leaf: a basal notch, two lobes and a drawn tip, six polygons."""
    side = forward.cross(up).normalized()
    m0 = Vector(base) + forward * (-.04 * length)
    m1 = Vector(base) + forward * (.22 * length) + up * (fold * width)
    m2 = Vector(base) + forward * (.62 * length) + up * (fold * width * .60)
    m3 = Vector(base) + forward * length
    for sign in (-1, 1):
        e0 = Vector(base) + forward * (-.18 * length) + side * (sign * width * .55) - up * (fold * width * .30)
        e1 = Vector(base) + forward * (.24 * length) + side * (sign * width) - up * (fold * width * .55)
        e2 = Vector(base) + forward * (.66 * length) + side * (sign * width * .72) - up * (fold * width * .40)
        shade = [(tint[0] * v, tint[1] * v, tint[2] * v)
                 for v in (rng.uniform(.78, .90), rng.uniform(.92, 1.02), rng.uniform(1.0, 1.12))]
        mesh.polygon((m0, e0, e1, m1), material, [shade[0], shade[0], shade[1], shade[1]])
        mesh.polygon((m1, e1, e2, m2), material, [shade[1], shade[1], shade[2], shade[2]])
        mesh.polygon((m2, e2, m3), material, [shade[2], shade[2], shade[2]])


def leaf_cluster(mesh, origin, direction, rng, *, count=8, leaf=.55, width=.15, scale=1.0,
                 material='broad_leaf', twig=.44):
    """A twig carrying modelled ovate leaves; no spheres, no cards."""
    direction = unit(direction)
    tip = Vector(origin) + direction * (twig * scale)
    mesh.tube([Vector(origin), tip], [.026 * scale, .011 * scale], 'jungle_bark', bark_color(4.0, rng), sides=4)
    base_value = rng.uniform(.82, 1.08)
    for k in range(count):
        t = .16 + .80 * (k / max(1, count - 1))
        anchor = Vector(origin).lerp(tip, t)
        radial = k * 2.399 + rng.uniform(-.35, .35)
        outward = Vector((math.cos(radial), 0, math.sin(radial)))
        forward, side, up = frame(direction * .32 + outward * .95 + Vector((0, rng.uniform(-.58, -.10), 0)),
                                  rng.uniform(-.7, .7))
        ovate_leaf(mesh, anchor, forward, up, leaf * scale * rng.uniform(.82, 1.14),
                   width * scale * rng.uniform(.86, 1.12), material,
                   leaf_tint(base_value * rng.uniform(.88, 1.10), rng), rng)


def palm_frond(mesh, origin, angle, length, rng, *, tint=(.86, 1.02, .60), leaflets=24,
               rise=.95, drop=1.55, spine_color=(.80, .92, .58), reach_limit=None):
    """An arching pinnate frond: a spine tube with paired modelled leaflets."""
    direction = Vector((math.cos(angle), 0, math.sin(angle)))
    sideways = Vector((-direction.z, 0, direction.x))

    def spine(t):
        point = Vector(origin) + direction * (length * t) + Vector((0, rise * math.sin(t * math.pi * .82)
                                                                    - drop * t ** 2.6, 0))
        return clamp_radius(point, reach_limit) if reach_limit else point

    points = [spine(i / 11) for i in range(12)]
    mesh.tube(points, [.045 * (1 - i / 15) for i in range(12)], 'palm_frond', spine_color, sides=4)
    for j in range(2, leaflets):
        t = j / leaflets
        width = length * .175 * math.sin(t * math.pi) ** .48 * (1 - t * .30)
        center = spine(t)
        for sign in (-1, 1):
            value = rng.uniform(.84, 1.10)
            shade = (tint[0] * value, tint[1] * value, tint[2] * value)
            end = center + sideways * (sign * width) + direction * (width * .48) + Vector((0, -width * .62, 0))
            mid = center.lerp(end, .55) + Vector((0, width * .11, 0))
            spread = direction * (width * .17)
            mesh.polygon((center, mid - spread, end, mid + spread), 'palm_frond',
                         [(shade[0] * .92, shade[1] * .94, shade[2] * .92), shade, shade,
                          (shade[0] * 1.04, shade[1] * 1.03, shade[2] * 1.02)])


def grass_tuft(mesh, center, rng, *, count=7, height=.30, tint=(1.02, .84, .48)):
    """Dry leaf-litter grass at a trodden camp edge; blades, not cards."""
    for _ in range(count):
        angle = rng.random() * TAU
        radius = rng.random() ** .5 * .11
        origin = Vector((center[0] + math.cos(angle) * radius, center[1], center[2] + math.sin(angle) * radius))
        lean = Vector((math.cos(angle + .5), 0, math.sin(angle + .5))) * rng.uniform(.05, .15)
        across = Vector((-math.sin(angle), 0, math.cos(angle)))
        tall = height * rng.uniform(.62, 1.18)
        wide = rng.uniform(.010, .019)
        blade = []
        for j in range(4):
            t = j / 3
            middle = origin + Vector((0, tall * (t - .16 * t ** 3), 0)) + lean * t * t
            blade.append((middle - across * (wide * (1 - t)), middle + across * (wide * (1 - t))))
        value = rng.uniform(.78, 1.08)
        shade = [(tint[0] * value, tint[1] * value, tint[2] * value)] * 4
        for j in range(3):
            mesh.polygon((blade[j][0], blade[j][1], blade[j + 1][1], blade[j + 1][0]), 'needle_foliage', shade,
                         ((0, j / 3), (1, j / 3), (1, (j + 1) / 3), (0, (j + 1) / 3)))


TENT_WALL_X, TENT_EAVE_X, TENT_EAVE_Y, TENT_RIDGE = 1.94, 2.06, 1.30, 3.70
TENT_GABLE_Z, TENT_THATCH_Z = 1.76, 1.88
TENT_DOOR_HALF, TENT_DOOR_TOP, TENT_DOOR_Z = .58, 2.06, 1.80


def thatch_slope(mesh, sign, rng, rows=8, across=11):
    """Overlapping rows of frond polygons: sun-dried straw at the ridge, with
    only a hint of green left in the olive drip edge at the eave."""
    eave = Vector((sign * TENT_EAVE_X, TENT_EAVE_Y, 0))
    length = math.hypot(TENT_EAVE_X, TENT_RIDGE - TENT_EAVE_Y)
    up_slope = Vector((-sign * TENT_EAVE_X, TENT_RIDGE - TENT_EAVE_Y, 0)) / length
    outward = Vector((sign * (TENT_RIDGE - TENT_EAVE_Y), TENT_EAVE_X, 0)) / length
    across_z = Vector((0, 0, 1))
    span, frond = TENT_THATCH_Z - .24, length * 2.05 / rows
    half = span * 2 / (across - 1) * .70
    for row in range(rows):
        t = -.055 + row * (.985 / rows)
        green = min(1.0, max(0.0, row / (rows - 1.0)))
        for j in range(across):
            offset = .26 if row % 2 else -.26
            v = -span + (j + offset) * (span * 2 / (across - 1))
            base = eave + up_slope * (t * length) + across_z * v \
                + outward * (.022 + (row % 2) * .014 + rng.uniform(-.004, .010))
            wide = half * rng.uniform(.86, 1.14)
            long = frond * rng.uniform(.88, 1.12)
            value = rng.uniform(.82, 1.10)
            tint = (value * (.80 + green * .20), value * (.78 + green * .14), value * (.46 + green * .16))
            shade = [(tint[0] * .93, tint[1] * .95, tint[2] * .90), tint, tint, tint,
                     (tint[0] * 1.05, tint[1] * 1.02, tint[2] * 1.03)]
            mesh.polygon((base,
                          base + up_slope * (long * .30) - across_z * wide,
                          base + up_slope * long - across_z * (wide * .66),
                          base + up_slope * long + across_z * (wide * .66),
                          base + up_slope * (long * .30) + across_z * wide),
                         'palm_thatch', shade)


def thatch_ridge(mesh, rng, count=12):
    """A straddling cap course closes the ridge line."""
    span = TENT_THATCH_Z - .10
    for j in range(count):
        z = -span + j * (span * 2 / (count - 1))
        lift = TENT_RIDGE + .055 + rng.uniform(-.008, .016)
        reach = .52 + rng.uniform(-.05, .07)
        value = rng.uniform(.86, 1.10)
        tint = (value * .98, value * .92, value * .60)
        for sign in (-1, 1):
            drop = Vector((sign * reach, lift - .42, z))
            shade = [(tint[0] * 1.04, tint[1] * 1.02, tint[2] * 1.04), tint, tint,
                     (tint[0] * .92, tint[1] * .94, tint[2] * .90)]
            mesh.polygon((Vector((0, lift, z - .07)), Vector((0, lift, z + .07)),
                          drop + Vector((0, 0, .09)), drop + Vector((0, 0, -.09))),
                         'palm_thatch', shade)


def mat_panel(mesh, center, size, rng):
    mesh.block(center, size, 'woven_mat', mat_color(rng), bevel=0)


def slab(mesh, profile, z0, z1, material, shade):
    """Extrude an (x, y) outline through z into one outward-wound panel."""
    near = [Vector((x, y, z0)) for x, y in profile]
    far = [Vector((x, y, z1)) for x, y in profile]
    count = len(profile)
    area = sum(profile[i][0] * profile[(i + 1) % count][1] - profile[(i + 1) % count][0] * profile[i][1]
               for i in range(count)) * .5
    turn = 1 if area > 0 else -1
    faced_polygon(mesh, near, (0, 0, -1), material, [shade(p) for p in near])
    faced_polygon(mesh, far, (0, 0, 1), material, [shade(p) for p in far])
    for i in range(count):
        j = (i + 1) % count
        dx, dy = profile[j][0] - profile[i][0], profile[j][1] - profile[i][1]
        quad = [near[i], near[j], far[j], far[i]]
        faced_polygon(mesh, quad, Vector((dy, -dx, 0)) * turn, material, [shade(p) for p in quad])


def gable_half(y):
    """Half width of the tent's gable at a height, following the roof line."""
    if y <= TENT_EAVE_Y:
        return TENT_WALL_X
    return TENT_WALL_X * (TENT_RIDGE - y) / (TENT_RIDGE - TENT_EAVE_Y)


def door_bow(x, y):
    """The hanging door flap bellies out slightly and hangs away from the frame."""
    return TENT_DOOR_Z + .05 + math.cos(x * 2.4) * .035 - (TENT_DOOR_TOP - y) * .012


def build_trailkeepers_tent():
    """A-frame ridge shelter: hardwood poles, woven matting, layered frond thatch."""
    mesh = KitMesh('trailkeepers_tent')
    rng = RNG
    # Buried skirt: a packed sill plus fieldstones on both long sides, down to
    # -.5m, so a downhill pitch never shows daylight under the mat wall.
    for sign in (-1, 1):
        mesh.block((sign * 1.985, -.18, 0), (.28, .64, 3.50), 'watch_stone', stone_color(-.1, rng), bevel=.022)
        for k in range(5):
            z = -1.56 + k * .78
            rock_prism(mesh, (sign * 2.02, -.34, z + rng.uniform(-.06, .06)), .21, .50, 'watch_stone',
                       lambda p: stone_color(p.y, rng), sides=7, yaw=rng.uniform(0, TAU), rng=rng)
    mesh.block((0, .06, 1.98), (1.16, .24, .40), 'watch_stone', stone_color(.06, rng), bevel=.028)
    # Pole frame: two lashed tripods at z = +/-1.75 meeting the ridge at 3.7m.
    mesh.tube([(0, TENT_RIDGE, -1.95), (0, TENT_RIDGE, 1.95)], [.085, .085], 'jungle_hardwood',
              wood_color(rng), sides=6)
    for sign in (-1, 1):
        z = sign * 1.75
        apex = (0, TENT_RIDGE, z)
        for foot in (-TENT_WALL_X, TENT_WALL_X):
            mesh.tube([(foot, -.06, z), apex], [.085, .062], 'jungle_hardwood', wood_color(rng), sides=5)
        mesh.tube([apex, (sign * 1.05, -.06, sign * 2.42)], [.070, .088], 'jungle_hardwood',
                  wood_color(rng), sides=5)
        lash(mesh, (0, TENT_RIDGE - .16, z), (0, 1, 0), .155, turns=2, tube=.023)
    for sign in (-1, 1):
        for z in (-1.30, -.44, .44, 1.30):
            mesh.tube([(0, TENT_RIDGE - .05, z), (sign * (TENT_EAVE_X - .05), TENT_EAVE_Y + .04, z)],
                      [.058, .050], 'jungle_hardwood', wood_color(rng), sides=5)
            lash(mesh, (sign * .14, TENT_RIDGE - .10, z), (sign * -1, -.9, 0), .10, tube=.017)
        for t in (.34, .68):
            x = sign * (TENT_EAVE_X * (1 - t) + .04)
            y = TENT_EAVE_Y + (TENT_RIDGE - TENT_EAVE_Y) * t
            mesh.tube([(x, y, -1.86), (x, y, 0), (x, y, 1.86)], [.044, .044, .044], 'jungle_hardwood',
                      wood_color(rng), sides=5)
        mesh.tube([(sign * (TENT_EAVE_X - .04), TENT_EAVE_Y + .02, -1.86),
                   (sign * (TENT_EAVE_X - .04), TENT_EAVE_Y + .02, 1.86)], [.060, .060], 'jungle_hardwood',
                  wood_color(rng), sides=5)
        for z in (-1.72, 0, 1.72):
            mesh.tube([(sign * TENT_WALL_X, -.10, z), (sign * TENT_WALL_X, TENT_EAVE_Y + .06, z)],
                      [.072, .062], 'jungle_hardwood', wood_color(rng), sides=5)
            lash(mesh, (sign * TENT_WALL_X, TENT_EAVE_Y - .04, z), (0, 1, 0), .095, tube=.017)
    # Woven matting: horizontal courses with vertical weave slats lashed over them.
    for sign in (-1, 1):
        for row in range(5):
            mat_panel(mesh, (sign * TENT_WALL_X, -.06 + (row + .5) * .272, 0), (.075, .258, 3.52), rng)
        for k in range(7):
            mat_panel(mesh, (sign * 1.985, .62, -1.50 + k * .50), (.046, 1.34, .17), rng)
    # Gable matting: one triangular panel per end; the front leaves the doorway
    # open below 2.06m and closes again above the door header.
    shade = lambda p: mat_color(rng)
    wide, jamb, header = TENT_WALL_X, TENT_DOOR_HALF + .08, gable_half(TENT_DOOR_TOP)
    for sign in (-1, 1):
        z0, z1 = sign * TENT_GABLE_Z - .043, sign * TENT_GABLE_Z + .043
        if sign < 0:
            slab(mesh, ((-wide, -.06), (wide, -.06), (wide, TENT_EAVE_Y), (0, TENT_RIDGE - .04),
                        (-wide, TENT_EAVE_Y)), z0, z1, 'woven_mat', shade)
            continue
        for side in (-1, 1):
            slab(mesh, ((side * wide, -.06), (side * jamb, -.06), (side * jamb, TENT_DOOR_TOP),
                        (side * header, TENT_DOOR_TOP), (side * wide, TENT_EAVE_Y)),
                 z0, z1, 'woven_mat', shade)
        slab(mesh, ((-header, TENT_DOOR_TOP), (header, TENT_DOOR_TOP), (0, TENT_RIDGE - .04)),
             z0, z1, 'woven_mat', shade)
        for k in range(5):
            y = TENT_DOOR_TOP + .18 + k * .30
            half = gable_half(y) - .08
            if half < .08:
                continue
            mesh.tube([(-half, y, sign * TENT_GABLE_Z - .08), (half, y, sign * TENT_GABLE_Z - .08)],
                      [.030, .030], 'jungle_hardwood', wood_color(rng), sides=4)
    # Doorway: framing poles, a rolled canvas flap and the closed flap below it.
    mesh.block((0, 1.00, 1.66), (1.18, 2.02, .06), 'recess_shadow', (1, 1, 1), bevel=0)
    for side in (-1, 1):
        mesh.tube([(side * .62, -.06, TENT_DOOR_Z), (side * .62, TENT_DOOR_TOP + .10, TENT_DOOR_Z)],
                  [.066, .058], 'jungle_hardwood', wood_color(rng), sides=5)
    mesh.tube([(-.74, TENT_DOOR_TOP + .06, TENT_DOOR_Z), (.74, TENT_DOOR_TOP + .06, TENT_DOOR_Z)],
              [.056, .056], 'jungle_hardwood', wood_color(rng), sides=5)
    mesh.tube([(-.58, TENT_DOOR_TOP - .08, TENT_DOOR_Z + .06), (.58, TENT_DOOR_TOP - .08, TENT_DOOR_Z + .06)],
              [.105, .105], 'canvas_flap', canvas_color(rng), sides=6)
    for side in (-1, 1):
        lash(mesh, (side * .40, TENT_DOOR_TOP - .08, TENT_DOOR_Z + .06), (1, 0, 0), .125, tube=.016)
    columns, courses = 4, 4
    for i in range(columns):
        for j in range(courses):
            x0, x1 = -.58 + i * (1.16 / columns), -.58 + (i + 1) * (1.16 / columns)
            y0 = TENT_DOOR_TOP - .12 - j * ((TENT_DOOR_TOP - .16) / courses)
            y1 = y0 - (TENT_DOOR_TOP - .16) / courses
            value = rng.uniform(.80, 1.02) * (.98 if j < courses - 1 else .82)
            shade = [(value, value * .98, value * .93)] * 4
            mesh.polygon((Vector((x0, y0, door_bow(x0, y0))), Vector((x1, y0, door_bow(x1, y0))),
                          Vector((x1, y1, door_bow(x1, y1))), Vector((x0, y1, door_bow(x0, y1)))),
                         'canvas_flap', shade)
    for sign in (-1, 1):
        thatch_slope(mesh, sign, rng)
    thatch_ridge(mesh, rng)
    for sign in (-1, 1):
        grass_tuft(mesh, (sign * 2.16, .0, sign * 1.24), rng, count=6, height=.26)
    mesh.finish()


def build_fire_ring():
    """Fieldstone ring, ash bed, charred logs, iron tripod and split-log benches."""
    mesh = KitMesh('fire_ring')
    rng = RNG

    def hearth_stone(p):
        """Inner faces are sooted; the outer skirt keeps its damp moss."""
        soot = max(0.0, min(1.0, (1.06 - math.hypot(p.x, p.z) / .74) * 1.5)) * max(0.0, 1 - p.y / .34)
        base = stone_color(p.y, rng)
        return (base[0] * (1 - soot * .74), base[1] * (1 - soot * .78), base[2] * (1 - soot * .80))

    for k in range(9):
        angle = k * TAU / 9 + .18
        rock_prism(mesh, (math.cos(angle) * .74, -.03, math.sin(angle) * .74), .26, .34, 'watch_stone',
                   hearth_stone, sides=8, yaw=angle * 1.7, rng=rng)
    for k in range(5):
        angle = k * TAU / 5 + .9
        rock_prism(mesh, (math.cos(angle) * .96, -.03, math.sin(angle) * .96), .13, .16, 'watch_stone',
                   hearth_stone, sides=6, yaw=angle, rng=rng)
    # Ash bed: a low charred disc with paler ash toward its centre.
    rim = [Vector((math.cos(i * TAU / 14) * .60, .034, math.sin(i * TAU / 14) * .60)) for i in range(14)]
    for i in range(14):
        a, b = rim[i], rim[(i + 1) % 14]
        edge = (rng.uniform(.62, .86),) * 3
        faced_polygon(mesh, (Vector((0, .045, 0)), a, b), (0, 1, 0), 'charred_wood',
                      [(1.35, 1.28, 1.22), (edge[0], edge[1] * .98, edge[2] * .96),
                       (edge[0], edge[1] * .98, edge[2] * .96)])
    for a, b, lift in (((-.42, .09, -.26), (.40, .13, .30), .0), ((-.34, .16, .34), (.44, .10, -.30), .06),
                       ((.04, .21, -.46), (-.10, .11, .44), .12)):
        mid = ((a[0] + b[0]) * .5, (a[1] + b[1]) * .5 + lift + .05, (a[2] + b[2]) * .5)
        mesh.tube([a, mid, b], [.070, .078, .062], 'charred_wood', (rng.uniform(.72, 1.0),) * 3, sides=5)
    mesh.block((0, .12, 0), (.30, .12, .30), 'lantern_amber', (1, 1, 1), bevel=.026)
    # Iron tripod and hanging kettle.
    for k in range(3):
        angle = k * TAU / 3 + .4
        mesh.tube([(math.cos(angle) * .60, -.02, math.sin(angle) * .60), (0, 1.34, 0)], [.030, .020],
                  'forged_iron', (.92, .92, .94), sides=4)
    lash(mesh, (0, 1.26, 0), (0, 1, 0), .056, turns=2, tube=.014)
    mesh.tube([(0, 1.24, 0), (0, 1.03, 0)], [.011, .011], 'forged_iron', (.86, .86, .88), sides=3)
    mesh.tube([(0, .60, 0), (0, .76, 0), (0, .96, 0)], [.105, .195, .160], 'forged_iron', (.62, .62, .64), sides=9)
    mesh.tube([(0, .955, 0), (0, .985, 0)], [.172, .172], 'forged_iron', (.80, .80, .82), sides=9)
    mesh.tube([(-.17, .90, 0), (-.13, 1.03, 0), (0, 1.07, 0), (.13, 1.03, 0), (.17, .90, 0)], [.013] * 5,
              'forged_iron', (.88, .88, .90), sides=3)
    # Split-log benches: half-round hardwood on stub legs, clear of the stones.
    for sign in (-1, 1):
        x = sign * 1.15
        mesh.tube([(x, .34, -.86), (x, .34, .86)], [.145, .145], 'jungle_hardwood', wood_color(rng), sides=6)
        mesh.block((x, .40, 0), (.30, .075, 1.72), 'jungle_hardwood', wood_color(rng), bevel=0)
        for z in (-.62, .62):
            mesh.block((x, .12, z), (.155, .30, .175), 'jungle_hardwood', wood_color(rng), bevel=0)
    # Firewood, stacked crosswise clear of the bench run.
    for k in range(6):
        y = .055 + (k // 3) * .115
        z = -.90 + (k % 3) * .145 + (k // 3) * .06
        mesh.tube([(-1.32, y, z), (-.66, y + rng.uniform(-.02, .02), z + rng.uniform(-.03, .03))],
                  [.058, .052], 'charred_wood', (rng.uniform(.86, 1.15),) * 3, sides=5)
    grass_tuft(mesh, (-.28, .0, 1.26), rng, count=6, height=.24)
    grass_tuft(mesh, (.58, .0, -1.20), rng, count=5, height=.22)
    mesh.finish()


def slat_crate(mesh, center, size, rng, material='jungle_hardwood', tie=True):
    """A slatted trail crate; copied from the yard generator, not imported."""
    cx, cy, cz = center
    w, h, d = size
    for sign in (-1, 1):
        for k in range(3):
            y = cy - h * .5 + (k + .5) * h / 3
            mesh.block((cx, y, cz + sign * (d * .5 - .02)), (w, h / 3 - .035, .042), material,
                       wood_color(rng), bevel=0)
            mesh.block((cx + sign * (w * .5 - .02), y, cz), (.042, h / 3 - .035, d - .08), material,
                       wood_color(rng), bevel=0)
    for sx in (-1, 1):
        for sz in (-1, 1):
            mesh.block((cx + sx * (w * .5 - .03), cy, cz + sz * (d * .5 - .03)), (.052, h, .052), material,
                       (.80, .78, .72), bevel=0)
    mesh.block((cx, cy - h * .5 + .03, cz), (w - .05, .05, d - .05), material, (.78, .76, .70), bevel=0)
    mesh.block((cx, cy + h * .5 - .03, cz), (w - .05, .05, d - .05), material, (.86, .84, .78), bevel=0)
    if tie:
        mesh.block((cx, cy, cz), (w + .012, .034, d + .012), 'hemp_rope', (.86, .80, .66), bevel=0)


def cloth_sag(x):
    """The hung hide sags between the two rack uprights."""
    return -.07 * (1 - (x / .68) ** 2)


def build_gear_rack():
    """Lashed drying rack, hung hide, crate, water cask and the coral pennant."""
    mesh = KitMesh('gear_rack')
    rng = RNG
    cross_y = 1.90
    for sign in (-1, 1):
        mesh.tube([(sign * .85, -.05, -.30), (sign * .85, 1.02, -.30), (sign * .85, 2.05, -.30)],
                  [.082, .074, .062], 'jungle_hardwood', wood_color(rng), sides=6)
        lash(mesh, (sign * .85, cross_y, -.30), (0, 1, 0), .098, turns=2, tube=.018)
        mesh.tube([(sign * .85, 1.42, -.30), (sign * .45, cross_y - .04, -.30)], [.040, .034],
                  'jungle_hardwood', wood_color(rng), sides=4)
    mesh.tube([(-1.02, cross_y, -.30), (1.02, cross_y, -.30)], [.062, .062], 'jungle_hardwood',
              wood_color(rng), sides=6)
    # Hide draped over the cross pole, sagging between the uprights.
    drape = ((-.36, .86), (-.24, 1.22), (-.14, 1.58), (-.09, 1.82), (0, 1.985),
             (.09, 1.82), (.14, 1.58), (.24, 1.22), (.36, .86))
    columns = 8
    for i in range(columns):
        x0, x1 = -.62 + i * (1.24 / columns), -.62 + (i + 1) * (1.24 / columns)
        for j in range(len(drape) - 1):
            quad = [Vector((x0, drape[j][1] + cloth_sag(x0), drape[j][0] - .30)),
                    Vector((x1, drape[j][1] + cloth_sag(x1), drape[j][0] - .30)),
                    Vector((x1, drape[j + 1][1] + cloth_sag(x1), drape[j + 1][0] - .30)),
                    Vector((x0, drape[j + 1][1] + cloth_sag(x0), drape[j + 1][0] - .30))]
            grime = .74 + .26 * min(1.0, (drape[j][1] - .86) / .9)
            value = rng.uniform(.88, 1.04) * grime
            mesh.polygon(quad, 'canvas_flap', [(value, value * .98, value * .92)] * 4)
    rope_loop(mesh, (-.68, 1.66, -.30), .095, turns=2, rise=.13, tube=.017)
    rope_loop(mesh, (.70, 1.72, -.30), .085, turns=2, rise=.11, tube=.016)
    mesh.tube([(-.68, cross_y - .03, -.30), (-.68, 1.74, -.30)], [.014, .014], 'hemp_rope', (.86, .80, .66), sides=3)
    mesh.tube([(.70, cross_y - .03, -.30), (.70, 1.80, -.30)], [.014, .014], 'hemp_rope', (.86, .80, .66), sides=3)
    slat_crate(mesh, (.74, .28, .74), (.66, .56, .56), rng)
    # Water cask: aged timber staves under forged iron hoops.
    cask = (-.82, .0, .62)
    for k in range(11):
        angle = k * TAU / 11
        mesh.block((cask[0] + math.cos(angle) * .28, .34, cask[2] + math.sin(angle) * .28),
                   (.098, .68, .085), 'aged_timber', wood_color(rng), bevel=0,
                   yaw=math.atan2(math.cos(angle), math.sin(angle)))
    for y in (.14, .56):
        points = [(cask[0] + math.cos(i * TAU / 10) * .305, y, cask[2] + math.sin(i * TAU / 10) * .305)
                  for i in range(11)]
        mesh.tube(points, [.018] * 11, 'forged_iron', (.86, .86, .88), sides=3)
    lid = [Vector((cask[0] + math.cos(i * TAU / 11) * .27, .69, cask[2] + math.sin(i * TAU / 11) * .27))
           for i in range(11)]
    faced_polygon(mesh, lid, (0, 1, 0), 'aged_timber', [wood_color(rng) for _ in lid])
    # Trail-keeper pennant on a 3m pole, swayed by the runtime wind hook.
    pole = (-1.20, -.60)
    mesh.tube([(pole[0], -.05, pole[1]), (pole[0], 1.50, pole[1]), (pole[0], 2.96, pole[1])],
              [.072, .060, .048], 'jungle_hardwood', wood_color(rng), sides=6)
    mesh.block((pole[0], 3.00, pole[1]), (.10, .075, .10), 'jungle_hardwood', wood_color(rng), bevel=.018)
    for y in (.80, 1.84):
        lash(mesh, (pole[0], y, pole[1]), (0, 1, 0), .082, tube=.015)
    mesh.tube([(pole[0], 2.72, pole[1]), (pole[0] + .52, 2.72, pole[1])], [.030, .022], 'jungle_hardwood',
              wood_color(rng), sides=4)
    mesh.polygon((Vector((pole[0] + .04, 2.70, pole[1])), Vector((pole[0] + .50, 2.70, pole[1] + .02)),
                  Vector((pole[0] + .30, 2.06, pole[1] + .05))), 'canvas_flap',
                 [(1, .55, .42), (1, .58, .45), (.88, .48, .37)])
    mesh.polygon((Vector((pole[0] + .04, 2.70, pole[1])), Vector((pole[0] + .30, 2.06, pole[1] + .05)),
                  Vector((pole[0] + .06, 2.28, pole[1] + .03))), 'canvas_flap',
                 [(1, .55, .42), (.88, .48, .37), (.94, .52, .40)])
    for k in range(3):
        angle = k * 2.1 + .6
        rock_prism(mesh, (math.cos(angle) * 1.34, -.04, math.sin(angle) * 1.02), .16, .18, 'watch_stone',
                   lambda p: stone_color(p.y, rng), sides=6, yaw=angle, rng=rng)
    grass_tuft(mesh, (.18, .0, -1.16), rng, count=6, height=.26)
    grass_tuft(mesh, (-1.30, .0, .10), rng, count=5, height=.22)
    mesh.finish()


def build_camp_lantern():
    """A rope-wrapped hardwood post, a thatch hood and amber glass in an iron cage."""
    mesh = KitMesh('camp_lantern')
    rng = RNG
    mesh.tube([(0, -.06, 0), (0, .84, 0), (0, 1.72, 0), (0, 1.88, 0)], [.090, .082, .073, .070],
              'jungle_bark', bark_color(.4, rng), sides=8)
    for y in (.56, 1.22, 1.78):
        lash(mesh, (0, y, 0), (0, 1, 0), .094, turns=2, tube=.017)
    mesh.block((0, 1.92, 0), (.24, .045, .24), 'forged_iron', (.84, .84, .86), bevel=0)
    mesh.block((0, 2.30, 0), (.28, .040, .28), 'forged_iron', (.86, .86, .88), bevel=0)
    for sx in (-1, 1):
        for sz in (-1, 1):
            mesh.block((sx * .105, 2.11, sz * .105), (.030, .40, .030), 'forged_iron', (.88, .88, .90), bevel=0)
    mesh.block((0, 2.11, 0), (.20, .30, .20), 'lantern_amber', (1, 1, 1), bevel=.030)
    # Woven-thatch hood: two courses of frond polygons over the glass.
    for layer, (count, radius, lip, apex) in enumerate(((12, .40, 2.34, 2.62), (8, .28, 2.50, 2.68))):
        for k in range(count):
            angle = k * TAU / count + layer * .26
            step = TAU / count
            value = rng.uniform(.84, 1.10)
            tint = (value * (.80 + layer * .20), value * (.78 + layer * .14), value * (.46 + layer * .16))
            mesh.polygon((Vector((0, apex, 0)),
                          Vector((math.cos(angle - step * .5) * radius * .86, lip + .04,
                                  math.sin(angle - step * .5) * radius * .86)),
                          Vector((math.cos(angle) * radius, lip, math.sin(angle) * radius)),
                          Vector((math.cos(angle + step * .5) * radius * .86, lip + .04,
                                  math.sin(angle + step * .5) * radius * .86))),
                         'palm_thatch', [(tint[0] * 1.06, tint[1] * 1.03, tint[2] * 1.06), tint, tint,
                                         (tint[0] * .94, tint[1] * .96, tint[2] * .92)])
    mesh.tube([(0, 2.60, 0), (0, 2.70, 0)], [.05, .028], 'palm_thatch', (1.0, .92, .62), sides=6)
    for k in range(3):
        angle = k * 2.2 + .3
        rock_prism(mesh, (math.cos(angle) * .26, -.05, math.sin(angle) * .26), .13, .16, 'watch_stone',
                   lambda p: stone_color(p.y, rng), sides=6, yaw=angle, rng=rng)
    grass_tuft(mesh, (.15, .0, -.09), rng, count=5, height=.22)
    mesh.finish()


def buttresses(mesh, rng, profiles, thickness):
    """Root buttresses: outside the bark trunk contract, so they use the
    hardwood slot with its tint cancelled back to a bark reading."""
    for angle, profile in profiles:
        fin(mesh, (0, 0, 0), angle, profile, thickness, 'jungle_hardwood',
            lambda p: buttress_color(p, rng))


def branch_sites(rng, spine, angle, count, limit, scale):
    """Leaf sites spread along the outer 55% of a branch, not only at its tip."""
    sites = []
    for i in range(count):
        t = 1.0 if count < 2 else 1.0 - i * (.55 / (count - 1))
        swing = angle + rng.uniform(-1.05, 1.05)
        direction = Vector((math.cos(swing) * .72, rng.uniform(.26, .86), math.sin(swing) * .72))
        sites.append((clamp_radius(along(spine, t), limit), direction, scale))
    return sites


def hardwood_branches(mesh, rng, limbs, *, branch_limit, leaf_limit, secondary, tertiary,
                      secondaries=3, tertiaries=2, limb_sites=2, secondary_sites=2, tertiary_sites=1):
    """Limbs, secondaries and tertiaries; returns the twig sites for leaf clusters."""
    sites = []
    for angle, reach, rise, start in limbs:
        base = Vector(start)
        direction = Vector((math.cos(angle), 0, math.sin(angle)))
        spine = [base,
                 base + direction * (reach * .38) + Vector((0, rise * .48, 0)),
                 base + direction * (reach * .74) + Vector((0, rise * .82, 0)),
                 clamp_radius(base + direction * reach + Vector((0, rise, 0)), branch_limit)]
        mesh.tube(spine, [.180, .130, .092, .062], 'jungle_bark', bark_color(base.y, rng), sides=6)
        sites += branch_sites(rng, spine, angle, limb_sites, leaf_limit, 1.0)
        for k in range(secondaries):
            root = along(spine, .30 + k * (.66 / max(1, secondaries - 1)))
            turn = angle + (k - (secondaries - 1) * .5) * (3.10 / secondaries) + rng.uniform(-.24, .24)
            out = Vector((math.cos(turn), 0, math.sin(turn)))
            lift = secondary[1] * rng.uniform(.7, 1.2)
            tip = clamp_radius(root + out * (secondary[0] * rng.uniform(.82, 1.15))
                               + Vector((0, lift, 0)), branch_limit)
            middle = root.lerp(tip, .5) + Vector((0, lift * .22, 0))
            mesh.tube([root, middle, tip], [.082, .060, .040], 'jungle_bark', bark_color(root.y, rng), sides=5)
            sites += branch_sites(rng, [root, middle, tip], turn, secondary_sites, leaf_limit, .96)
            for j in range(tertiaries):
                anchor = along([root, middle, tip], .42 + j * (.54 / max(1, tertiaries - 1)))
                swing = turn + (1 if j % 2 else -1) * rng.uniform(.55, 1.0)
                lateral = Vector((math.cos(swing), 0, math.sin(swing)))
                end = clamp_radius(anchor + lateral * (tertiary * rng.uniform(.75, 1.2))
                                   + Vector((0, rng.uniform(.10, .38), 0)), branch_limit)
                mesh.tube([anchor, end], [.042, .026], 'jungle_bark', bark_color(anchor.y, rng), sides=4)
                sites += branch_sites(rng, [anchor, end], swing, tertiary_sites, leaf_limit, .90)
    return sites


def build_jungle_tree_a():
    """Buttressed broadleaf hardwood: leaning trunk, three limbs, ovate canopy."""
    mesh = KitMesh('jungle_tree_a')
    rng = RNG
    trunk = [(0, -.19, 0), (0, .34, 0), (.02, 1.00, .01), (.07, 2.10, .04),
             (.15, 3.30, .08), (.25, 4.40, .13), (.33, 5.15, .17)]
    radii = [.386, .376, .358, .320, .282, .240, .205]
    for low, high in ((0, 2), (2, 4), (4, 6)):
        mesh.tube(trunk[low:high + 1], radii[low:high + 1], 'jungle_bark', bark_color(trunk[low][1], rng), sides=9)
    profile = ((.26, -.19), (.88, -.15), (.62, .40), (.44, .84), (.30, 1.26))
    buttresses(mesh, rng, [(k * TAU / 4 + .35, profile) for k in range(4)], .105)
    limbs = ((.55, 2.05, 1.95, (.22, 4.35, .11)), (2.55, 1.85, 2.15, (.28, 4.80, .14)),
             (4.45, 2.10, 1.75, (.33, 5.10, .17)))
    sites = hardwood_branches(mesh, rng, limbs, branch_limit=2.34, leaf_limit=2.34,
                              secondary=(.82, .55), tertiary=.56, secondaries=6, tertiaries=2,
                              limb_sites=2, secondary_sites=2, tertiary_sites=1)
    for origin, direction, scale in sites:
        leaf_cluster(mesh, origin, direction, rng, count=rng.randint(10, 13), leaf=.65, width=.175, scale=scale)
    mesh.finish()


def build_jungle_tree_b():
    """The taller hardwood: straighter trunk, two canopy tiers and hanging lianas."""
    mesh = KitMesh('jungle_tree_b')
    rng = RNG
    trunk = [(0, -.19, 0), (0, .36, 0), (.01, 1.00, .01), (.04, 2.40, .02),
             (.09, 3.90, .05), (.14, 5.40, .08), (.19, 6.60, .11), (.22, 7.20, .13)]
    radii = [.428, .418, .402, .360, .318, .272, .228, .196]
    for low, high in ((0, 2), (2, 4), (4, 6), (6, 7)):
        mesh.tube(trunk[low:high + 1], radii[low:high + 1], 'jungle_bark', bark_color(trunk[low][1], rng), sides=9)
    profile = ((.28, -.19), (.96, -.14), (.68, .46), (.48, .96), (.32, 1.44))
    buttresses(mesh, rng, [(k * TAU / 5 + .82, profile) for k in range(5)], .100)
    lower = ((.90, 2.15, 1.35, (.13, 5.10, .07)), (3.00, 2.00, 1.55, (.15, 5.55, .09)),
             (5.05, 2.20, 1.20, (.17, 5.90, .10)))
    upper = ((1.95, 1.70, 1.85, (.21, 6.95, .12)), (4.05, 1.55, 2.05, (.22, 7.15, .13)),
             (6.05, 1.80, 1.70, (.22, 7.20, .13)))
    sites = hardwood_branches(mesh, rng, lower, branch_limit=2.72, leaf_limit=2.72,
                              secondary=(.88, .50), tertiary=.58, secondaries=4, tertiaries=2,
                              limb_sites=1, secondary_sites=2, tertiary_sites=1)
    sites += hardwood_branches(mesh, rng, upper, branch_limit=2.48, leaf_limit=2.48,
                               secondary=(.80, .55), tertiary=.52, secondaries=4, tertiaries=2,
                               limb_sites=1, secondary_sites=2, tertiary_sites=1)
    for origin, direction, scale in sites:
        leaf_cluster(mesh, origin, direction, rng, count=rng.randint(8, 11), leaf=.66, width=.18, scale=scale)
    # Lianas hang from the lower tier; they stay well above the trunk contract band.
    for k in range(7):
        anchor = sites[k * 3 % len(sites)][0]
        drop = rng.uniform(2.0, 3.0)
        foot = max(1.75, anchor.y - drop)
        sway = rng.uniform(-.22, .22)
        mesh.tube([Vector((anchor.x, anchor.y - .10, anchor.z)),
                   Vector((anchor.x + sway, (anchor.y + foot) * .5, anchor.z - sway * .7)),
                   Vector((anchor.x + sway * 1.5, foot, anchor.z - sway))],
                  [.034, .028, .020], 'jungle_bark', bark_color(3.0, rng), sides=4)
    mesh.finish()


def build_jungle_palm():
    """Tall jungle palm: a curved ringed trunk under nine arching pinnate fronds."""
    mesh = KitMesh('jungle_palm')
    rng = RNG
    points, radii = [], []
    for i in range(13):
        t = i / 12
        points.append((math.sin(t * .80) * .62 * t, -.19 + t * 8.60, math.sin(t * 1.65) * .20 * t))
        radii.append((.292 * (1 - t * .40)) * (1.065 if i % 2 else 1.0))
    mesh.tube(points, radii, 'jungle_bark', bark_color(2.0, rng), sides=8)
    crown = Vector(points[-1])
    mesh.tube([crown - Vector((0, .30, 0)), crown + Vector((0, .16, 0))], [.20, .155], 'jungle_bark',
              bark_color(6.0, rng), sides=8)
    # Dead fronds hang in a straw-coloured boot under the living crown.
    for k in range(5):
        angle = k * TAU / 5 + .5
        palm_frond(mesh, crown + Vector((0, -.16, 0)), angle, 1.55, rng, tint=(1.08, .86, .48),
                   leaflets=12, rise=.10, drop=1.45, spine_color=(1.0, .84, .50), reach_limit=2.85)
    for k in range(9):
        angle = k * TAU / 9 + .22
        palm_frond(mesh, crown + Vector((0, .14, 0)), angle, 3.05 * rng.uniform(.92, 1.06), rng,
                   leaflets=24, rise=.98, drop=1.62, reach_limit=2.85)
    for k in range(9):
        angle = k * 2.399
        radius = .22 + (k % 3) * .07
        mesh.block((crown.x + math.cos(angle) * radius, crown.y - .34 - (k % 3) * .11,
                    crown.z + math.sin(angle) * radius), (.13, .15, .13), 'palm_frond',
                   (1.05, .92, .48), bevel=0, yaw=angle)
    mesh.finish()


def build_elephant_ear_clump():
    """Heart-shaped ground leaves on arching stalks; one material primitive."""
    mesh = KitMesh('elephant_ear_clump')
    rng = RNG
    for k in range(9):
        angle = k * 2.399 + rng.uniform(-.22, .22)
        lean = rng.uniform(.20, .34)
        tall = rng.uniform(.58, .90)
        base = Vector((math.cos(angle) * .05, .03, math.sin(angle) * .05))
        direction = Vector((math.cos(angle), 0, math.sin(angle)))
        tip = base + direction * lean + Vector((0, tall, 0))
        mesh.tube([base, base.lerp(tip, .48) + Vector((0, .05, 0)), tip], [.026, .020, .014],
                  'elephant_ear', (.74, .96, .58), sides=4)
        forward, side, up = frame(direction * .62 + Vector((0, -.78, 0)), rng.uniform(-.35, .35))
        heart_leaf(mesh, tip, forward, up, .52 * rng.uniform(.86, 1.10), .21 * rng.uniform(.88, 1.12),
                   'elephant_ear', leaf_tint(rng.uniform(.82, 1.06), rng), rng)
    for k in range(4):
        angle = k * 1.7 + 1.1
        base = Vector((math.cos(angle) * .13, .03, math.sin(angle) * .13))
        tip = base + Vector((math.cos(angle) * .10, rng.uniform(.26, .40), math.sin(angle) * .10))
        mesh.tube([base, tip], [.024, .012], 'elephant_ear', (.78, .98, .60), sides=4)
        forward, side, up = frame(Vector((math.cos(angle) * .5, .82, math.sin(angle) * .5)), .2)
        heart_leaf(mesh, tip, forward, up, .20, .07, 'elephant_ear', leaf_tint(rng.uniform(.90, 1.12), rng), rng)
    mesh.finish()


def inspect_glb(path):
    raw = path.read_bytes()
    assert struct.unpack_from('<4sII', raw) == (b'glTF', 2, len(raw))
    json_length, json_type = struct.unpack_from('<II', raw, 12)
    assert json_type == 0x4e4f534a
    gltf = json.loads(raw[20:20 + json_length])
    bin_start = 28 + json_length
    nodes = gltf['nodes']
    roots = {nodes[i]['name']: i for i in gltf['scenes'][gltf.get('scene', 0)]['nodes']}
    assert set(roots) == set(EXPECTED), roots.keys()
    assert not gltf.get('images') and not gltf.get('textures'), 'Palmheart kit must not duplicate shared textures'
    assert all('uri' not in buffer for buffer in gltf['buffers'])
    assert {mat['name'] for mat in gltf['materials']} == set(MATERIAL_BINDINGS)
    shared = json.loads((ROOT / 'client/assets/old-watch/manifest.json').read_text())
    assert hashlib.sha256((ROOT / 'client/assets/old-watch/kit.glb').read_bytes()).hexdigest() == shared['sha256']
    manifest = {
        'schemaVersion': 1, 'generator': 'tools/build-palmheart-camp.py', 'seed': SEED,
        'blenderVersion': bpy.app.version_string, 'coordinateSystem': 'Y-up, meters, +Z front',
        'sourceLicense': 'Original Skywake Isles project assets; see CREDITS.md',
        'file': 'kit.glb', 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
        'dependencies': [{'url': SHARED_KIT, 'sha256': shared['sha256'],
                          'ownership': 'Shared cache owns original material textures and reusable props'}],
        'materialBindings': MATERIAL_BINDINGS, 'prefabs': {}, 'textures': [],
        'embeddedImageCount': 0, 'decodedTextureBytes': 0,
        'propEnvelopes': {name: dict({'maxRadius': limit, 'minY': low, 'maxY': high},
                                     **({'trunkRadius': TRUNK_LIMITS[name]} if name in TRUNK_LIMITS else {}))
                          for name, (limit, low, high) in PROP_ENVELOPES.items()},
    }

    def values(index):
        accessor = gltf['accessors'][index]
        view = gltf['bufferViews'][accessor['bufferView']]
        assert accessor['componentType'] == 5126 and accessor['type'] == 'VEC3'
        assert view.get('byteStride', 12) == 12
        offset = bin_start + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        return np.frombuffer(raw, dtype='<f4', count=accessor['count'] * 3, offset=offset).reshape((-1, 3))

    trunks = {}
    for name, index in roots.items():
        minimum = np.array([float('inf')] * 3)
        maximum = -minimum
        triangles, primitives, radius, materials = 0, 0, 0, set()
        todo = [index]
        while todo:
            node = nodes[todo.pop()]
            todo.extend(node.get('children', []))
            assert not any(key in node for key in ('matrix', 'translation', 'rotation', 'scale')), name
            if 'mesh' not in node:
                continue
            for primitive in gltf['meshes'][node['mesh']]['primitives']:
                attributes = primitive['attributes']
                assert all(key in attributes for key in ('NORMAL', 'TEXCOORD_0', 'COLOR_0')), name
                positions = values(attributes['POSITION'])
                assert np.isfinite(positions).all(), name
                minimum = np.minimum(minimum, positions.min(axis=0))
                maximum = np.maximum(maximum, positions.max(axis=0))
                radius = max(radius, float(np.linalg.norm(positions[:, (0, 2)], axis=1).max()))
                material = gltf['materials'][primitive['material']]['name']
                materials.add(material)
                # The authored trunk silhouette must stay inside the recorded
                # collider after runtime scaling, buttress fins included.
                if name in TRUNK_LIMITS and material == 'jungle_bark':
                    low = positions[(positions[:, 1] >= 0) & (positions[:, 1] <= 1)]
                    if len(low):
                        trunks[name] = max(trunks.get(name, 0),
                                           float(np.linalg.norm(low[:, (0, 2)], axis=1).max()))
                triangles += gltf['accessors'][primitive['indices']]['count'] // 3
                primitives += 1
        manifest['prefabs'][name] = {'bounds': {'min': minimum.round(5).tolist(), 'max': maximum.round(5).tolist()},
                                     'dimensions': (maximum - minimum).round(5).tolist(),
                                     'horizontalRadius': round(radius, 5), 'triangles': triangles,
                                     'primitives': primitives, 'materials': sorted(materials)}
    for name, prefab in manifest['prefabs'].items():
        low, high = prefab['bounds']['min'], prefab['bounds']['max']
        limit, floor, ceiling = PROP_ENVELOPES[name]
        assert prefab['horizontalRadius'] <= limit, (name, prefab['horizontalRadius'], limit)
        assert low[1] >= floor - .0006 and high[1] <= ceiling, (name, low, high)
    for name, limit in TRUNK_LIMITS.items():
        assert name in trunks, f'{name}: no jungle_bark trunk between y 0 and 1'
        assert trunks[name] <= limit + .0002, (name, trunks[name], limit)
    manifest['trunkRadii'] = {name: round(value, 5) for name, value in sorted(trunks.items())}
    manifest['totalTriangles'] = sum(p['triangles'] for p in manifest['prefabs'].values())
    manifest['totalPrimitives'] = sum(p['primitives'] for p in manifest['prefabs'].values())
    assert manifest['bytes'] < 3.0 * 1024 * 1024, manifest['bytes']
    assert manifest['totalTriangles'] < 36000, manifest['totalTriangles']
    return manifest


def preview(path):
    loader = importlib.util.spec_from_file_location('old_watch_preview', ROOT / 'tools/build-old-watch.py')
    old_watch = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(old_watch)
    with tempfile.TemporaryDirectory(prefix='skywake-palmheart-preview-') as temporary:
        old_watch.create_materials(pathlib.Path(temporary))
        for root in PREFABS.values():
            for child in root.children:
                binding = MATERIAL_BINDINGS[child.data.materials[0].name]
                material = MATERIALS[binding['source']].copy()
                material.use_backface_culling = not binding.get('doubleSided', False)
                if 'color' in binding:
                    nodes, links = material.node_tree.nodes, material.node_tree.links
                    shader = nodes.get('Principled BSDF')
                    upstream = shader.inputs['Base Color'].links[0].from_socket
                    tint = nodes.new('ShaderNodeMixRGB')
                    tint.blend_type = 'MULTIPLY'
                    tint.inputs[0].default_value = 1
                    tint.inputs[2].default_value = tuple(binding['color']) + (1,)
                    links.new(upstream, tint.inputs[1])
                    links.new(tint.outputs['Color'], shader.inputs['Base Color'])
                if 'normalScale' in binding:
                    for node in material.node_tree.nodes:
                        if node.type == 'NORMAL_MAP':
                            node.inputs['Strength'].default_value = binding['normalScale']
                child.data.materials[0] = material
        positions = {'trailkeepers_tent': (-8.0, 0, -1.0), 'fire_ring': (-2.4, 0, -1.2),
                     'gear_rack': (1.6, 0, -1.2), 'camp_lantern': (4.6, 0, -1.2),
                     'elephant_ear_clump': (6.4, 0, -1.4), 'jungle_tree_a': (-7.0, 0, 8.0),
                     'jungle_tree_b': (0.5, 0, 9.5), 'jungle_palm': (8.0, 0, 8.0)}
        for name, root in PREFABS.items():
            root.location = game_to_blender(positions[name])
        bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.02))
        bpy.context.object.data.materials.append(MATERIALS['ground_earth'])
        scene = bpy.context.scene
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = 32
        scene.cycles.use_denoising = True
        world = bpy.data.worlds.new('palmheart_preview_world')
        world.use_nodes = True
        world.node_tree.nodes.get('Background').inputs['Color'].default_value = (.46, .58, .48, 1)
        world.node_tree.nodes.get('Background').inputs['Strength'].default_value = 1.1
        scene.world = world
        bpy.ops.object.light_add(type='AREA', location=(-10, -12, 22))
        key = bpy.context.object
        key.data.energy, key.data.shape, key.data.size = 6400, 'DISK', 13
        key.data.color = (1, .97, .90)
        key.rotation_euler = (Vector((0, 0, 2)) - key.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.ops.object.camera_add(location=(14, -30, 15))
        camera = bpy.context.object
        camera.rotation_euler = (Vector((0, 2.5, 4.0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.type, camera.data.ortho_scale = 'ORTHO', 30
        scene.camera = camera
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1800, 1200, 100
        scene.view_settings.view_transform = 'AgX'
        path.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'client/assets/palmheart-camp')
    parser.add_argument('--preview', type=pathlib.Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    args.output.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for name, binding in MATERIAL_BINDINGS.items():
        create_binding_material(name, double_sided=binding.get('doubleSided', False))
    build_trailkeepers_tent()
    build_fire_ring()
    build_gear_rack()
    build_camp_lantern()
    build_jungle_tree_a()
    build_jungle_tree_b()
    build_jungle_palm()
    build_elephant_ear_clump()
    output = args.output / 'kit.glb'
    export_glb(output)
    manifest = inspect_glb(output)
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'PALMHEART_CAMP_OK: {len(PREFABS)} prefabs, {manifest["totalTriangles"]:,} triangles, '
          f'{manifest["totalPrimitives"]} primitives, {manifest["bytes"]:,} bytes')
    if args.preview:
        preview(args.preview.resolve())


if __name__ == '__main__':
    main()
