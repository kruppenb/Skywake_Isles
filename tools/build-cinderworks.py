"""Build the Cinderworks and Emberpeak original, geometry-only environment kit extension.

    blender --background --factory-startup --python-exit-code 1 --python tools/build-cinderworks.py

Named slots borrow Old Watch's original textures at runtime, the same extension
pattern as Windward Farm, Tideglass Market, Saltwind Harbor, Driftwood Yard and
Palmheart Camp. --output supports independent byte comparisons; --preview
creates an untracked textured contact sheet after export, without putting
preview images into the shipping GLB.

Milestone 7 sample: a working smithy on a scorched volcanic shoulder. Nothing
here repeats a shipped row: the forge is coursed black basalt to shoulder
height under oiled charred vertical boards bound with riveted iron straps, and
the roof is rust-red riveted iron sheeting rather than slate, tile, shake or
board.

  cinder_forge_*      basalt plinth and flagstones, soot-graded courses,
                      charred boarding on iron straps, an interior flue hood
                      over the bench, ribbed rust sheeting in lapped courses,
                      and a basalt stack with an iron cowl on the retained
                      smoke emitter
  forge_sign          hanging iron hammer plate on short chains
  forge_anvil         basalt footing, timber stump, iron anvil, quench trough
  ore_pile            heaped ore, ingots, an iron-strapped charred crate
  forge_lantern       iron post, caged amber glass
  coal_bin            iron-strapped charred plank bin, coal heap, shovel
  slag_heap           glassy scoria mound with ember glints
  basalt_outcrop      nine hexagonal columns replacing the collidable rock
  basalt_boulder_a/b  columnar-fracture boulders
  cinder_clump        scoria lumps, one primitive for instancing
  ember_crystal       faceted amber shards, one primitive for instancing
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
from environment_kit import (MATERIALS, PREFABS, KitMesh, clamp, game_to_blender,
                             create_binding_material, export_glb)

ROOT = pathlib.Path(__file__).resolve().parents[1]
SEED = 640311
RNG = random.Random(SEED)
TAU = math.tau
SHARED_KIT = '/assets/old-watch/kit.glb'
DOOR_WIDTH, DOOR_HEIGHT, THICKNESS = 2.30, 2.80, .24
# Masonry stops here so the iron-banded jamb post owns the whole doorway reveal.
JAMB = 1.35
MATERIAL_BINDINGS = {
    'watch_stone': {'source': 'watch_stone'},
    'aged_timber': {'source': 'aged_timber'},
    'forged_iron': {'source': 'forged_iron'},
    'recess_shadow': {'source': 'recess_shadow'},
    'lantern_amber': {'source': 'lantern_amber'},
    # Basalt vertex colours average .45, so the in-engine tints sit well above
    # one; the first pass (.70/.60/.58) rendered the walls as a black hole.
    'basalt_block': {'source': 'watch_stone', 'color': [1.75, 1.45, 1.38], 'normalScale': 1.0},
    'soot_stone': {'source': 'watch_stone', 'color': [1.0, .88, .85], 'normalScale': .8},
    'charred_board': {'source': 'aged_timber', 'color': [1.15, .90, .72], 'normalScale': .45},
    'rust_sheet': {'source': 'ground_earth', 'color': [2.3, 1.35, .95], 'normalScale': .40},
    'ore_rock': {'source': 'watch_stone', 'color': [1.45, .95, .62], 'normalScale': .9},
    'scoria': {'source': 'watch_stone', 'color': [1.05, .70, .62], 'normalScale': 1.0},
    'coal': {'source': 'watch_stone', 'color': [.30, .29, .29], 'normalScale': .6},
    'sign_plate': {'source': 'forged_iron', 'color': [1.0, 1.0, 1.0]},
    'ember_crystal': {'source': 'lantern_amber', 'color': [1.15, .75, .50]},
}
# Matches shared/exploration.js structure(): width = radius*1.42, depth = radius*1.18,
# wallHeight = max(3.2, height*.58). The stack sits at the fallback forge's smoke
# emitter (-width*.29, -depth*.22) so the retained plume rises from real masonry.
BUILDINGS = {
    'cinder_forge': {'radius': 3.4, 'height': 7.0, 'skirt': 2.25, 'ridge': 6.40,
                     'chimney': True, 'hood': True, 'bracket': True, 'toolBoard': True},
}
PROPS = ['forge_sign', 'forge_anvil', 'ore_pile', 'forge_lantern', 'coal_bin', 'slag_heap',
         'basalt_outcrop', 'basalt_boulder_a', 'basalt_boulder_b', 'cinder_clump', 'ember_crystal']
# root -> (maximum horizontal radius, minimum y, maximum y).
PROP_ENVELOPES = {
    'forge_sign': (.45, -.85, .05),
    'forge_anvil': (1.60, -.05, 1.50),
    'ore_pile': (1.70, -.05, 1.40),
    'forge_lantern': (.50, -.06, 2.70),
    'coal_bin': (1.00, -.03, 1.15),
    'slag_heap': (1.30, -.05, .90),
    'basalt_outcrop': (3.00, -.50, 8.00),
    'basalt_boulder_a': (1.10, -.25, 1.30),
    'basalt_boulder_b': (1.35, -.25, 1.60),
    'cinder_clump': (.55, -.03, .42),
    'ember_crystal': (.50, -.05, 1.00),
}
# The hung sign is thin so the runtime can hang it at z = depth/2 + .09 and stay
# inside the .16m hung-detail bound the wall roots use.
SIGN_DEPTH = (-.06, .07)
EXPECTED = [f'{prefix}_{part}' for prefix in BUILDINGS
            for part in ('base', 'wall_east', 'wall_west', 'wall_front', 'wall_back', 'roof')] + PROPS


def dimensions(spec):
    radius, height = spec['radius'], spec['height']
    return radius * 1.42, radius * 1.18, max(3.2, height * .58), height


def basalt_color(point, W, D, rng=RNG):
    """Coursed basalt, soot-graded toward the chimney corner and up the forge wall."""
    x, y, z = point
    shade = rng.uniform(.78, 1.0)
    soot = clamp(.34 * (.5 - x / W) + .18 * (.5 - z / D) + .10 * (y - 1.2), 0, .44)
    value = clamp(shade * (1 - soot), .55, 1.0)
    return (value, value * .985, value * .965)


def chimney_color(y, rng=RNG):
    shade = rng.uniform(.70, .96)
    value = clamp(shade * (1 - clamp((y - 4.4) * .17, 0, .40)), .55, 1.0)
    return (value, value * .98, value * .96)


def stone_color(rng=RNG):
    shade = rng.uniform(.62, .88)
    return (shade, shade * .99, shade * .97)


def board_color(rng=RNG):
    shade = rng.uniform(.80, 1.05)
    return (shade, shade * .97, shade * .92)


def timber_color(rng=RNG):
    shade = rng.uniform(.78, 1.02)
    return (shade, shade * .95, shade * .84)


def iron_color(rng=RNG):
    shade = rng.uniform(.82, 1.06)
    return (shade, shade * .99, shade)


def rust_color(t, rng=RNG):
    """Orange-brown sheeting; streaks run brighter toward the ridge."""
    streak = rng.uniform(.60, 1.04)
    value = clamp(streak * (.80 + .30 * t), .42, 1.14)
    return (value, value * rng.uniform(.86, .96), value * rng.uniform(.68, .84))


def scoria_color(rng=RNG):
    shade = rng.uniform(.72, 1.06)
    return (shade, shade * rng.uniform(.92, 1.0), shade * rng.uniform(.88, .98))


def ore_color(rng=RNG):
    shade = rng.uniform(.72, 1.06)
    return (shade, shade * rng.uniform(.88, .98), shade * rng.uniform(.80, .92))


def coal_color(rng=RNG):
    shade = rng.uniform(.70, 1.10)
    return (shade, shade, shade * 1.02)


def newell(points):
    normal = Vector()
    for i, p in enumerate(points):
        q = points[(i + 1) % len(points)]
        normal += Vector((p.y * q.z - p.z * q.y, p.z * q.x - p.x * q.z, p.x * q.y - p.y * q.x))
    return normal


def faced_polygon(mesh, points, outward, material, colors):
    """One outward-wound polygon; concave outlines keep a correct Newell normal."""
    points, colors = [Vector(p) for p in points], list(colors)
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
    """An irregular lump; per-vertex color carries the ash and glassy sheen."""
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


def solid(mesh, vertices, faces, material, color):
    center = sum((Vector(p) for p in vertices), Vector()) / len(vertices)
    for indices in faces:
        points = [Vector(vertices[i]) for i in indices]
        normal = (points[1] - points[0]).cross(points[2] - points[0])
        if normal.dot(sum(points, Vector()) / len(points) - center) < 0:
            points.reverse()
        mesh.polygon(points, material, color)


def prism(mesh, profile, low_z, high_z, material, color):
    count = len(profile)
    vertices = [(x, y, z) for z in (low_z, high_z) for x, y in profile]
    faces = [list(range(count)), list(range(count, count * 2))]
    faces += [[j, (j + 1) % count, (j + 1) % count + count, j + count] for j in range(count)]
    solid(mesh, vertices, faces, material, color)


def place_block(mesh, along, y, fixed, axis, size_along, size_y, depth, material, color, **kw):
    center = (along, y, fixed) if axis == 'x' else (fixed, y, along)
    size = (size_along, size_y, depth) if axis == 'x' else (depth, size_y, size_along)
    mesh.block(center, size, material, color, **kw)


def basalt_span(mesh, start, end, bottom, top, *, face, outward, axis, W, D, course=.26, nominal=.42):
    """Staggered basalt courses on a sealed backing; the odd worn block stands proud.

    Course joints stop short of the span edges so a door reveal never opens a
    slot through the wall, and a soot backing closes the joints from behind.
    """
    # The backing sits .005 behind the deepest course so no two faces ever land
    # on the same plane and fight.
    place_block(mesh, (start + end) / 2, (bottom + top) / 2, face - outward * .20, axis,
                end - start, top - bottom, .07, 'soot_stone', (.70, .69, .68), bevel=0)
    rows = max(1, round((top - bottom) / course))
    for row in range(rows):
        y0 = bottom + (top - bottom) * row / rows + (.0055 if row else 0)
        y1 = bottom + (top - bottom) * (row + 1) / rows - (.0055 if row < rows - 1 else 0)
        count = max(1, round((end - start) / nominal))
        edges = [start] + [start + (end - start) * (j + (.15 if row % 2 else -.12)) / count
                           for j in range(1, count)] + [end]
        for a, b in zip(edges, edges[1:]):
            lo = a + (.0065 if a > start else 0)
            hi = b - (.0065 if b < end else 0)
            depth = .24 if RNG.random() < .14 else .218
            coord = face - outward * depth / 2
            center = ((lo + hi) / 2, (y0 + y1) / 2, coord) if axis == 'x' else (coord, (y0 + y1) / 2, (lo + hi) / 2)
            size = ((hi - lo, y1 - y0, depth) if axis == 'x' else (depth, y1 - y0, hi - lo))
            mesh.block(center, size, 'basalt_block', basalt_color(center, W, D), bevel=RNG.uniform(.012, .020))


def charred_panel(mesh, start, end, bottom, top, *, face, outward, axis):
    """Oiled charred boarding standing .04 proud of a soot-dark sheathing plane."""
    place_block(mesh, (start + end) / 2, (bottom + top) / 2, face - outward * .17, axis,
                end - start, top - bottom, .14, 'soot_stone', (.74, .73, .72), bevel=0)
    count = max(1, round((end - start) / .16))
    spacing = (end - start) / count
    for j in range(count):
        place_block(mesh, start + (j + .5) * spacing, (bottom + top) / 2, face - outward * .11, axis,
                    spacing - .026, top - bottom - .010, .10, 'charred_board', board_color(), bevel=.008)


def iron_straps(mesh, start, end, bottom, top, *, face, outward, axis, rows=3):
    """Three riveted straps per face, rivets on roughly .4m centres."""
    for k in range(rows):
        y = bottom + (k + .5) * (top - bottom) / rows
        place_block(mesh, (start + end) / 2, y, face - outward * .045, axis,
                    end - start - .02, .085, .05, 'forged_iron', iron_color(), bevel=0)
        rivets = max(2, round((end - start) / .40))
        for j in range(rivets):
            place_block(mesh, start + (j + .5) * (end - start) / rivets, y, face - outward * .0325, axis,
                        .052, .052, .045, 'forged_iron', iron_color(), bevel=0)


def vent_slit(mesh, face, outward, W):
    """A narrow grilled slit high on each long wall."""
    mesh.block((face - outward * .13, 3.00, 0), (.10, .46, .32), 'recess_shadow', bevel=0)
    for k in range(3):
        mesh.block((face - outward * .055, 3.00, (k - 1) * .105), (.05, .44, .028), 'forged_iron',
                   iron_color(), bevel=0)
    for y in (2.75, 3.25):
        mesh.block((face - outward * .05, y, 0), (.05, .06, .44), 'forged_iron', iron_color(), bevel=0)


def flue_hood(mesh, W, WH):
    """Interior hood over the bench: it never reaches past x = -1.65."""
    inner, lip = -W / 2 + .24, -1.66
    mid, width = (inner + lip) / 2, lip - inner
    for z in (-1.52, -.28):
        mesh.block((mid, 2.225, z), (width, .55, .06), 'soot_stone', stone_color(), bevel=.010)
    mesh.block((mid, 2.44, -.90), (width, .16, 1.30), 'soot_stone', stone_color(), bevel=.012)
    mesh.block((inner + .055, 2.15, -.90), (.11, .40, 1.18), 'recess_shadow', bevel=0)
    mesh.block((mid - .04, 2.32, -.90), (width - .08, .08, 1.18), 'recess_shadow', bevel=0)
    mesh.block((inner + .20, 1.99, -.88), (.40, .10, .90), 'lantern_amber', (1, .96, .90), bevel=.02)
    mesh.block((lip - .06, 1.99, -.90), (.12, .12, 1.30), 'soot_stone', stone_color(), bevel=.010)
    for y0, y1, back, half, material in ((2.52, 3.10, .394, .62, 'soot_stone'),
                                         (3.10, 3.62, .254, .52, 'rust_sheet'),
                                         (3.62, WH, .174, .40, 'rust_sheet')):
        color = stone_color() if material == 'soot_stone' else rust_color(.4)
        mesh.block((inner + back / 2, (y0 + y1) / 2, -.90), (back, y1 - y0, half * 2), material, color, bevel=.010)
    for y in (2.60, 3.18):
        mesh.block((inner + .18, y, -.90), (.34, .055, 1.20), 'forged_iron', iron_color(), bevel=0)


def build_base(prefix, W, D):
    base = KitMesh(f'{prefix}_base')
    base.block((0, -.15, 0), (W - .006, .30, D - .006), 'basalt_block', (.60, .59, .58), bevel=.025)
    columns, rows = 5, 4
    span_x, span_z = W - .48, D - .48
    for i in range(columns):
        for j in range(rows):
            x = (i - (columns - 1) / 2) * span_x / columns
            z = (j - (rows - 1) / 2) * span_z / rows
            # The flagstones darken toward the bench and hood wall at local -x.
            value = clamp(RNG.uniform(.78, 1.0) * (1 - clamp(.50 * (.5 - x / W) + .06, 0, .45)), .55, 1.0)
            base.block((x + RNG.uniform(-.018, .018), .0035, z + RNG.uniform(-.018, .018)),
                       (span_x / columns - .035, .043, span_z / rows - .035), 'basalt_block',
                       (value, value * .985, value * .965), bevel=.014)
    for sign in (-1, 1):
        basalt_span(base, -D / 2, D / 2, .025, .48, face=sign * W / 2, outward=sign, axis='z', W=W, D=D)
        for a, b in ((-W / 2 + .24, -JAMB), (JAMB, W / 2 - .24)):
            basalt_span(base, a, b, .025, .48, face=sign * D / 2, outward=sign, axis='x', W=W, D=D)
        # Solid threshold jambs so the doorway reveal is one dressed stone, not open joints.
        for x in (-1.25, 1.25):
            center = (x, .2525, sign * (D / 2 - .12))
            base.block(center, (.20, .455, .24), 'basalt_block', basalt_color(center, W, D), bevel=.014)
    base.finish()


def build_side_walls(prefix, spec, W, D, WH):
    skirt = spec['skirt']
    for sign, name in ((1, 'east'), (-1, 'west')):
        mesh = KitMesh(f'{prefix}_wall_{name}')
        face = sign * W / 2
        basalt_span(mesh, -D / 2, D / 2, .48, skirt, face=face, outward=sign, axis='z', W=W, D=D)
        charred_panel(mesh, -D / 2, D / 2, skirt, WH, face=face, outward=sign, axis='z')
        iron_straps(mesh, -D / 2 + .10, D / 2 - .10, skirt, WH, face=face, outward=sign, axis='z')
        for z in (-D / 2 + .10, D / 2 - .10):
            mesh.block((face - sign * .11, (skirt + WH) / 2, z), (.22, WH - skirt, .20),
                       'charred_board', board_color(), bevel=.012)
            for y in (skirt + .30, WH - .30):
                mesh.block((face - sign * .095, y, z), (.17, .075, .24), 'forged_iron', iron_color(), bevel=0)
        vent_slit(mesh, face, sign, W)
        if name == 'west' and spec.get('hood'):
            flue_hood(mesh, W, WH)
        mesh.finish()


def tool_board(mesh, face, outward):
    """Tongs and two hammers hung on the back wall, clear of the doorway prism."""
    for y in (3.62, 3.02):
        mesh.block((-1.65, y, face + outward * .045), (.86, .075, .09), 'charred_board', board_color(), bevel=.008)
    for x in (-2.00, -1.30):
        mesh.block((x, 3.32, face + outward * .075), (.05, .05, .06), 'forged_iron', iron_color(), bevel=0)
    hang = face + outward * .105
    for x, head, length in ((-1.98, .19, .74), (-1.32, .16, .62)):
        mesh.tube([(x, 3.58, hang), (x, 3.58 - length, hang)], [.023, .020], 'aged_timber', timber_color(), sides=5)
        mesh.block((x, 3.60, hang), (head, .085, .075), 'forged_iron', iron_color(), bevel=.012)
    for lean in (-.11, .11):
        mesh.tube([(-1.65 + lean * .3, 3.56, hang), (-1.65 + lean, 2.86, hang)], [.020, .015],
                  'forged_iron', iron_color(), sides=4)
    mesh.block((-1.65, 3.60, hang), (.09, .07, .07), 'forged_iron', iron_color(), bevel=0)


def sign_bracket(mesh, D):
    """Iron bracket at (1.55, 3.85); the hung plate is the separate forge_sign root."""
    mesh.block((1.55, 3.85, D / 2 - .06), (.10, .28, .14), 'forged_iron', iron_color(), bevel=0)
    mesh.block((1.55, 3.87, D / 2 + .04), (.075, .075, .20), 'forged_iron', iron_color(), bevel=0)
    mesh.tube([(1.55, 3.60, D / 2 - .02), (1.55, 3.84, D / 2 + .10)], [.024, .020], 'forged_iron',
              iron_color(), sides=4)
    mesh.block((1.55, 3.82, D / 2 + .095), (.055, .075, .055), 'forged_iron', iron_color(), bevel=0)


def build_end_walls(prefix, spec, W, D, WH):
    skirt = spec['skirt']
    for sign, name in ((1, 'front'), (-1, 'back')):
        mesh = KitMesh(f'{prefix}_wall_{name}')
        face = sign * D / 2
        # Boarding runs .12 wider than the masonry so it meets the corner posts.
        for a, b in ((-W / 2 + .24, -JAMB), (JAMB, W / 2 - .24)):
            edge = b + .12 if b > 0 else b
            start = a - .12 if a < 0 else a
            basalt_span(mesh, a, b, .48, skirt, face=face, outward=sign, axis='x', W=W, D=D)
            charred_panel(mesh, start, edge, skirt, DOOR_HEIGHT, face=face, outward=sign, axis='x')
            iron_straps(mesh, a + .08, b - .08, skirt, DOOR_HEIGHT, face=face, outward=sign, axis='x', rows=1)
        # The jamb post is the whole reveal, so no course joint opens onto the doorway.
        for x in (-1.25, 1.25):
            mesh.block((x, (.48 + DOOR_HEIGHT) / 2, face - sign * .12), (.20, DOOR_HEIGHT - .48, .24),
                       'charred_board', board_color(), bevel=.012)
            for y in (1.05, 2.35):
                mesh.block((x, y, face - sign * .115), (.17, .10, .27), 'forged_iron', iron_color(), bevel=0)
        # Header band: boarding on its own sheathing, a lintel strap and two riveted bands.
        charred_panel(mesh, -W / 2 + .12, W / 2 - .12, DOOR_HEIGHT, WH, face=face, outward=sign, axis='x')
        mesh.block((0, DOOR_HEIGHT + .065, face - sign * .045), (W - .48, .13, .05), 'forged_iron',
                   iron_color(), bevel=0)
        iron_straps(mesh, -W / 2 + .32, W / 2 - .32, DOOR_HEIGHT + .14, WH, face=face, outward=sign,
                    axis='x', rows=2)
        for x in (-1.62, 1.62):
            mesh.block((x, DOOR_HEIGHT + .13, face - sign * .10), (.30, .09, .28), 'forged_iron',
                       iron_color(), bevel=0)
        if sign > 0 and spec.get('bracket'):
            sign_bracket(mesh, D)
        if sign < 0 and spec.get('toolBoard'):
            tool_board(mesh, face, sign)
        mesh.finish()


def rust_roof_cover(mesh, reach, end, eave, ridge):
    """Two lapped courses of ribbed sheeting per side, riveted at lap and eave."""
    base_y = eave + .06
    rise = ridge + .018 - base_y
    length = math.hypot(reach, rise)
    for sign in (-1, 1):
        nx, ny = sign * rise / length, reach / length
        dx, dy = -sign * reach / length, rise / length

        def at(s, offset, z):
            return (sign * reach + dx * s + nx * offset, base_y + dy * s + ny * offset, z)

        for course, (s0, s1) in enumerate(((.10, length / 2 + .025), (length / 2 - .025, length - .02))):
            offset = .028 + course * .030
            panels = 8
            for j in range(panels):
                z0 = -end + 2 * end * j / panels
                z1 = -end + 2 * end * (j + 1) / panels
                low, high = rust_color(s0 / length), rust_color(s1 / length)
                faced_polygon(mesh, [at(s0, offset, z0), at(s1, offset, z0), at(s1, offset, z1), at(s0, offset, z1)],
                              (nx, ny, 0), 'rust_sheet', [low, high, high, low])
            ribs = max(2, round(2 * end / .25))
            for j in range(ribs):
                z = -end + (j + .5) * 2 * end / ribs
                a, b = at(s0 + .04, offset + .018, z), at(s1 - .04, offset + .018, z)
                mesh.block(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z), (.05, (s1 - s0) - .08, .05),
                           'rust_sheet', rust_color((s0 + s1) / (2 * length)), bevel=0,
                           axis_y=Vector((dx, dy, 0)))
            for j in range(9):
                z = -end + (j + .5) * 2 * end / 9
                for s in (s0 + .09, s1 - .09):
                    p = at(s, offset + .034, z)
                    mesh.block(p, (.055, .055, .055), 'forged_iron', iron_color(), bevel=0)
        for j in range(7):
            z = -end + (j + .5) * 2 * end / 7
            p = at(.16, .045, z)
            mesh.block((p[0], p[1], z), (.10, .075, 2 * end / 7 - .05), 'forged_iron', iron_color(), bevel=0,
                       axis_y=Vector((dx, dy, 0)))
    for j in range(10):
        z = -end + (j + .5) * 2 * end / 10
        mesh.block((0, ridge + .095, z), (.34, .105, 2 * end / 10 - .008), 'rust_sheet', rust_color(1.0), bevel=0)
        mesh.block((0, ridge + .145, z), (.075, .05, 2 * end / 10 - .12), 'forged_iron', iron_color(), bevel=0)


def chimney_stack(mesh, W, D, H, eave, ridge, reach):
    """Basalt stack through the pitch at the retained smoke emitter, iron cowl on top."""
    cx, cz = -W * .29, -D * .22
    stack_top, bottom, rows = H - .10, 4.50, 8
    for row in range(rows):
        y0 = bottom + (stack_top - bottom) * row / rows
        y1 = bottom + (stack_top - bottom) * (row + 1) / rows
        material = 'soot_stone' if row >= rows - 2 else 'basalt_block'
        for k, (ox, oz, sx, sz) in enumerate(((0, -.21, .86, .16), (0, .21, .86, .16),
                                              (-.35, 0, .16, .26), (.35, 0, .16, .26))):
            jitter = .022 if (row + k) % 2 else -.016
            mesh.block((cx + ox + (jitter if k >= 2 else 0), (y0 + y1) / 2, cz + oz + (jitter if k < 2 else 0)),
                       (sx - .012, y1 - y0 - .012, sz - .012), material, chimney_color(y0),
                       bevel=RNG.uniform(.014, .022))
        mesh.block((cx, (y0 + y1) / 2, cz), (.56, y1 - y0, .28), 'recess_shadow', bevel=0)
    for ox, oz, sx, sz in ((0, -.27, .96, .14), (0, .27, .96, .14), (-.41, 0, .14, .40), (.41, 0, .14, .40)):
        mesh.block((cx + ox, stack_top - .07, cz + oz), (sx, .14, sz), 'soot_stone', chimney_color(stack_top),
                   bevel=.018)
    mesh.block((cx, stack_top - .12, cz), (.66, .16, .38), 'recess_shadow', bevel=0)
    for sx in (-1, 1):
        for sz in (-1, 1):
            mesh.block((cx + sx * .43, stack_top - .01, cz + sz * .29), (.05, .10, .05), 'forged_iron',
                       iron_color(), bevel=0)
    mesh.block((cx, stack_top + .028, cz), (.98, .042, .72), 'forged_iron', iron_color(), bevel=0)
    for ox, oz, sx, sz in ((0, -.34, .98, .045), (0, .34, .98, .045), (-.47, 0, .045, .68), (.47, 0, .045, .68)):
        mesh.block((cx + ox, stack_top + .005, cz + oz), (sx, .05, sz), 'forged_iron', iron_color(), bevel=0)
    assert stack_top + .049 <= H - .045, 'chimney cowl must stay under the building height'


def build_roof(prefix, spec, W, D, WH, H):
    mesh = KitMesh(f'{prefix}_roof')
    eave, ridge = WH, spec['ridge']
    reach, end = W / 2 + .14, D / 2 + .14
    for z in (-D / 2 + THICKNESS / 2, D / 2 - THICKNESS / 2):
        out = 1 if z > 0 else -1
        gable = [(-W / 2, eave, z), (W / 2, eave, z), (0, ridge - .05, z)]
        faced_polygon(mesh, gable, (0, 0, out), 'charred_board', [board_color() for _ in gable])
        faced_polygon(mesh, gable, (0, 0, -out), 'charred_board', [(.62, .60, .57) for _ in gable])
        boards = 13
        for j in range(boards):
            x = (j - (boards - 1) / 2) * (W - .12) / boards
            top = eave + (ridge - .09 - eave) * (1 - abs(x) / (W / 2))
            if top - eave < .10:
                continue
            mesh.block((x, (eave + top) / 2, z + out * .035), ((W - .12) / boards - .014, top - eave, .07),
                       'charred_board', board_color(), bevel=0)
        for t in (.26, .58):
            mesh.block((0, eave + (ridge - .09 - eave) * t, z + out * .075), ((W - .16) * (1 - t), .075, .05),
                       'forged_iron', iron_color(), bevel=0)
    for sign in (-1, 1):
        prism(mesh, [(sign * reach, eave), (0, ridge - .035), (0, ridge + .018), (sign * reach, eave + .06)],
              -end, end, 'soot_stone', (.80, .79, .78))
    rust_roof_cover(mesh, reach, end, eave, ridge)
    if spec.get('chimney'):
        chimney_stack(mesh, W, D, H, eave, ridge, reach)
    mesh.finish()


def build_building(prefix, spec):
    W, D, WH, H = dimensions(spec)
    assert spec['ridge'] + .12 <= H, prefix
    build_base(prefix, W, D)
    build_side_walls(prefix, spec, W, D, WH)
    build_end_walls(prefix, spec, W, D, WH)
    build_roof(prefix, spec, W, D, WH, H)


def build_forge_sign():
    mesh = KitMesh('forge_sign')
    mesh.block((0, .014, .002), (.62, .034, .034), 'sign_plate', iron_color(), bevel=0)
    for x in (-.27, .27):
        for k in range(3):
            mesh.block((x, -.030 - k * .072, .002), (.034, .060, .030), 'sign_plate', iron_color(),
                       bevel=0, yaw=0 if k % 2 else 1.05)
        mesh.block((x, -.235, .004), (.030, .090, .026), 'sign_plate', iron_color(), bevel=0)
    mesh.block((0, -.50, .004), (.70, .46, .034), 'sign_plate', (.94, .95, .96), bevel=.012)
    for y in (-.275, -.725):
        mesh.block((0, y, .006), (.74, .045, .026), 'sign_plate', iron_color(), bevel=0)
    for x in (-.355, .355):
        mesh.block((x, -.50, .006), (.045, .50, .026), 'sign_plate', iron_color(), bevel=0)
    mesh.block((-.09, -.50, .050), (.34, .058, .026), 'sign_plate', (.80, .81, .83), bevel=0)
    mesh.block((.155, -.50, .050), (.145, .200, .028), 'sign_plate', (.86, .87, .89), bevel=0)
    mesh.block((.245, -.50, .050), (.065, .115, .026), 'sign_plate', (.84, .85, .87), bevel=0)
    mesh.finish()


def build_forge_anvil():
    mesh = KitMesh('forge_anvil')
    mesh.block((-.40, .11, -.05), (.94, .26, .74), 'watch_stone', stone_color(), bevel=.026)
    mesh.tube([(-.40, .21, -.05), (-.40, .63, -.05)], [.30, .27], 'aged_timber', timber_color(), sides=8)
    mesh.block((-.40, .585, -.05), (.62, .11, .32), 'forged_iron', iron_color(), bevel=.014)
    mesh.block((-.40, .700, -.05), (.34, .16, .22), 'forged_iron', iron_color(), bevel=.012)
    mesh.block((-.40, .845, -.05), (.80, .15, .28), 'forged_iron', iron_color(), bevel=.016)
    mesh.tube([(.00, .855, -.05), (.34, .870, -.05)], [.095, .028], 'forged_iron', iron_color(), sides=5)
    mesh.block((-.72, .915, -.05), (.075, .035, .075), 'recess_shadow', bevel=0)
    mesh.tube([(-.64, .955, .015), (-.22, .955, .055)], [.023, .021], 'aged_timber', timber_color(), sides=5)
    mesh.block((-.14, .965, .062), (.17, .095, .085), 'forged_iron', iron_color(), bevel=.014)
    for lean in (-.06, .06):
        mesh.tube([(.10 + lean, .02, .30), (-.08 + lean, .80, .16)], [.022, .017], 'forged_iron',
                  iron_color(), sides=4)
    mesh.block((.02, .82, .22), (.09, .06, .07), 'forged_iron', iron_color(), bevel=0)
    for sz in (-1, 1):
        mesh.block((.85, .31, sz * .275), (.96, .62, .07), 'aged_timber', timber_color(), bevel=.010)
    for sx in (-1, 1):
        mesh.block((.85 + sx * .445, .31, 0), (.07, .62, .48), 'aged_timber', timber_color(), bevel=.010)
    mesh.block((.85, .045, 0), (.90, .09, .56), 'aged_timber', timber_color(), bevel=.010)
    for y in (.14, .50):
        mesh.block((.85, y, 0), (1.00, .055, .66), 'forged_iron', iron_color(), bevel=0)
    mesh.block((.85, .605, 0), (.82, .030, .48), 'recess_shadow', bevel=0)
    mesh.tube([(.30, .02, .80), (.30, .34, .80)], [.19, .205], 'forged_iron', iron_color(), sides=8)
    mesh.tube([(.13, .33, .80), (.30, .50, .80), (.47, .33, .80)], [.016] * 3, 'forged_iron',
              iron_color(), sides=4)
    for k in range(6):
        angle = k * 1.361 + .5
        radius = .95 + (k % 3) * .16
        rock_prism(mesh, (math.cos(angle) * radius - .10, -.015, math.sin(angle) * radius * .8),
                   RNG.uniform(.13, .20), RNG.uniform(.05, .11), 'scoria', lambda p: scoria_color(), sides=6)
    mesh.finish()


def build_ore_pile():
    mesh = KitMesh('ore_pile')
    for k in range(13):
        angle = k * 2.3999 + .35
        radius = .18 + .74 * ((k % 5) / 4) ** .8
        base = 0 if k % 5 else .34
        rock_prism(mesh, (math.cos(angle) * radius - .12, base - .02, math.sin(angle) * radius * .92),
                   RNG.uniform(.22, .33), RNG.uniform(.34, .60), 'ore_rock', lambda p: ore_color(),
                   sides=8, yaw=angle)
    for k in range(3):
        mesh.block((-.72 + k * .07, .055 + k * .10, .58 - k * .05), (.36, .10, .15), 'forged_iron',
                   iron_color(), bevel=.014, yaw=.32 - k * .18)
    cx, cz = .98, -.52
    for sz in (-1, 1):
        for k in range(3):
            mesh.block((cx, .10 + k * .21, cz + sz * .29), (.70, .19, .05), 'charred_board', board_color(), bevel=0)
    for sx in (-1, 1):
        for k in range(3):
            mesh.block((cx + sx * .34, .10 + k * .21, cz), (.05, .19, .58), 'charred_board', board_color(), bevel=0)
    for sx in (-1, 1):
        for sz in (-1, 1):
            mesh.block((cx + sx * .33, .31, cz + sz * .28), (.075, .62, .075), 'charred_board',
                       board_color(), bevel=.008)
    for y in (.16, .50):
        mesh.block((cx, y, cz), (.72, .045, .62), 'forged_iron', iron_color(), bevel=0)
    mesh.block((cx, .625, cz), (.70, .05, .58), 'charred_board', board_color(), bevel=0)
    for k in range(7):
        angle = k * 1.795 + .9
        radius = 1.08 + (k % 3) * .14
        rock_prism(mesh, (math.cos(angle) * radius - .10, -.02, math.sin(angle) * radius * .84),
                   RNG.uniform(.13, .19), RNG.uniform(.05, .12), 'scoria', lambda p: scoria_color(), sides=6)
    mesh.finish()


def build_forge_lantern():
    mesh = KitMesh('forge_lantern')
    mesh.block((0, .095, 0), (.46, .21, .46), 'watch_stone', stone_color(), bevel=.030)
    mesh.block((0, 1.30, 0), (.115, 2.20, .115), 'forged_iron', iron_color(), bevel=.010)
    mesh.block((0, .27, 0), (.20, .075, .20), 'forged_iron', iron_color(), bevel=.010)
    mesh.block((0, 2.34, .13), (.075, .075, .34), 'forged_iron', iron_color(), bevel=0)
    mesh.tube([(0, 2.06, .02), (0, 2.30, .21)], [.024, .020], 'forged_iron', iron_color(), sides=4)
    mesh.block((0, 2.22, .30), (.028, .19, .028), 'forged_iron', iron_color(), bevel=0)
    mesh.block((0, 2.09, .30), (.24, .05, .24), 'forged_iron', iron_color(), bevel=.012)
    mesh.block((0, 1.79, .30), (.24, .05, .24), 'forged_iron', iron_color(), bevel=.012)
    mesh.block((0, 1.945, .30), (.19, .26, .19), 'lantern_amber', (1, .97, .92), bevel=.030)
    for sx in (-1, 1):
        for sz in (-1, 1):
            mesh.block((sx * .095, 1.945, .30 + sz * .095), (.026, .28, .026), 'forged_iron', iron_color(), bevel=0)
    mesh.block((0, 2.16, .30), (.17, .09, .17), 'forged_iron', iron_color(), bevel=.020)
    mesh.finish()


def build_coal_bin():
    mesh = KitMesh('coal_bin')
    width, depth = 1.24, .86
    mesh.block((0, .035, 0), (width - .14, .07, depth - .14), 'aged_timber', timber_color(), bevel=0)
    for sz in (-1, 1):
        for k in range(3):
            mesh.block((0, .12 + k * .24, sz * (depth / 2 - .03)), (width - .10, .215, .055),
                       'charred_board', board_color(), bevel=0)
    for sx in (-1, 1):
        for k in range(3):
            mesh.block((sx * (width / 2 - .03), .12 + k * .24, 0), (.055, .215, depth - .10),
                       'charred_board', board_color(), bevel=0)
    for sx in (-1, 1):
        for sz in (-1, 1):
            mesh.block((sx * (width / 2 - .04), .38, sz * (depth / 2 - .04)), (.085, .78, .085),
                       'aged_timber', timber_color(), bevel=.008)
    for y in (.185, .585):
        mesh.block((0, y, 0), (width + .015, .05, depth + .015), 'forged_iron', iron_color(), bevel=0)
    for k in range(9):
        angle = k * 2.3999
        radius = .16 + (k % 3) * .21
        rock_prism(mesh, (math.cos(angle) * radius, .60, math.sin(angle) * radius * .62),
                   RNG.uniform(.16, .24), RNG.uniform(.12, .24), 'coal', lambda p: coal_color(),
                   sides=6, yaw=angle)
    mesh.tube([(.70, .02, .30), (.44, 1.06, .19)], [.026, .022], 'aged_timber', timber_color(), sides=5)
    mesh.block((.42, 1.10, .185), (.075, .09, .10), 'aged_timber', timber_color(), bevel=.014)
    mesh.block((.735, .10, .315), (.24, .05, .19), 'forged_iron', iron_color(), bevel=0, yaw=.4)
    mesh.finish()


def build_slag_heap():
    mesh = KitMesh('slag_heap')
    for k in range(11):
        angle = k * 2.3999 + .2
        radius = .10 + .78 * ((k % 4) / 3) ** .75
        rock_prism(mesh, (math.cos(angle) * radius, -.02, math.sin(angle) * radius * .95),
                   RNG.uniform(.22, .34), RNG.uniform(.30, .70) * (1 - radius * .5), 'scoria',
                   lambda p: scoria_color(), sides=8, yaw=angle)
    for k in range(5):
        angle = k * 1.257 + .7
        radius = .22 + (k % 3) * .22
        mesh.block((math.cos(angle) * radius, .16 + (k % 2) * .12, math.sin(angle) * radius * .9),
                   (.11, .075, .10), 'lantern_amber', (1, .92, .84), bevel=.020, yaw=angle)
    mesh.finish()


def hex_column(mesh, angle, distance, radius, height, tilt, base_y=-.48):
    """A jointed hexagonal basalt column with a slightly uneven fractured top."""
    cx, cz = math.cos(angle) * distance, math.sin(angle) * distance
    drift = math.tan(math.radians(tilt)) * height
    lower, upper = [], []
    for i in range(6):
        a = angle * .3 + i * TAU / 6
        px, pz = math.cos(a) * radius, math.sin(a) * radius
        lower.append((cx + px, base_y, cz + pz))
        upper.append((cx + px * .94 + math.cos(angle) * drift, height + RNG.uniform(-.12, -.005),
                      cz + pz * .94 + math.sin(angle) * drift))
    faces = [list(range(6)), list(range(6, 12))]
    faces += [[i, (i + 1) % 6, (i + 1) % 6 + 6, i + 6] for i in range(6)]

    def shade(point):
        value = clamp(RNG.uniform(.70, 1.0) * (1 - clamp(.22 - point.y * .028, 0, .30)), .55, 1.0)
        return (value, value * .985, value * .96)

    shaded_solid(mesh, lower + upper, faces, 'basalt_block', shade)


def build_basalt_outcrop():
    mesh = KitMesh('basalt_outcrop')
    columns = ((0.00, 0.00, .90, 7.98, 0.0), (0.40, 1.30, .70, 6.20, 4.0), (1.35, 1.55, .58, 4.80, 5.0),
               (2.30, 1.72, .50, 3.60, 6.0), (3.15, 1.42, .66, 5.60, 3.5), (3.95, 1.80, .47, 3.20, 5.0),
               (4.75, 1.62, .55, 4.30, 4.5), (5.45, 1.36, .74, 6.50, 3.0), (6.05, 1.90, .45, 3.00, 6.0))
    for angle, distance, radius, height, tilt in columns:
        hex_column(mesh, angle, distance, radius, height, tilt)
    for k in range(14):
        angle = k * 2.3999 + .3
        distance = 1.95 + (k % 4) * .16
        rock_prism(mesh, (math.cos(angle) * distance, -.10, math.sin(angle) * distance),
                   RNG.uniform(.22, .30), RNG.uniform(.22, .48), 'scoria', lambda p: scoria_color(),
                   sides=6, yaw=angle)
    mesh.finish()


def columnar_boulder(name, blocks, chips, limit):
    mesh = KitMesh(name)
    for cx, cy, cz, sx, sy, sz, yaw, skew in blocks:
        mesh.block((cx, cy, cz), (sx, sy, sz), 'basalt_block',
                   basalt_color((cx, cy, cz), 6, 6), bevel=.022, yaw=yaw, skew=skew)
    for k in range(chips):
        angle = k * 2.3999 + .4
        distance = limit * (.62 + (k % 3) * .09)
        rock_prism(mesh, (math.cos(angle) * distance, -.10, math.sin(angle) * distance),
                   RNG.uniform(.11, .17), RNG.uniform(.08, .18), 'scoria', lambda p: scoria_color(), sides=6)
    mesh.finish()


def build_basalt_boulder_a():
    columnar_boulder('basalt_boulder_a', (
        (-.10, .38, -.04, .88, 1.10, .74, .28, .07),
        (.36, .26, .26, .52, .78, .50, -.42, -.05),
        (-.44, .20, .30, .46, .62, .44, .74, .04),
        (.14, .82, -.28, .50, .44, .40, .12, -.08),
    ), 5, .84)


def build_basalt_boulder_b():
    columnar_boulder('basalt_boulder_b', (
        (-.06, .48, .00, 1.02, 1.30, .86, -.22, -.06),
        (.52, .34, -.32, .60, .94, .56, .48, .05),
        (-.58, .30, -.26, .54, .80, .50, -.66, .06),
        (-.18, .26, .52, .70, .66, .48, .20, -.04),
        (.06, 1.06, .06, .58, .58, .46, .34, .09),
    ), 6, 1.06)


def build_cinder_clump():
    mesh = KitMesh('cinder_clump')
    for k in range(6):
        angle = k * 2.3999 + .6
        distance = .06 + (k % 3) * .12
        rock_prism(mesh, (math.cos(angle) * distance, -.02, math.sin(angle) * distance),
                   RNG.uniform(.13, .19), RNG.uniform(.16, .34), 'scoria', lambda p: scoria_color(),
                   sides=6, yaw=angle)
    mesh.finish()


def build_ember_crystal():
    mesh = KitMesh('ember_crystal')

    def shade(point):
        value = clamp(.60 + point.y * .48, .55, 1.15)
        return (value, value * .92, value * .84)

    for cx, cz, radius, height, lean in ((.00, .00, .115, .92, 0.4), (-.17, .12, .085, .58, 2.4),
                                         (.16, -.13, .075, .46, 5.1), (.05, .19, .062, .34, 3.5)):
        lower, upper, sides = [], [], 5
        for i in range(sides):
            a = lean + i * TAU / sides
            lower.append((cx + math.cos(a) * radius, -.03, cz + math.sin(a) * radius))
            upper.append((cx + math.cos(a) * radius * .16 + math.cos(lean) * height * .17, height,
                          cz + math.sin(a) * radius * .16 + math.sin(lean) * height * .17))
        faces = [list(range(sides)), list(range(sides, sides * 2))]
        faces += [[i, (i + 1) % sides, (i + 1) % sides + sides, i + sides] for i in range(sides)]
        shaded_solid(mesh, lower + upper, faces, 'ember_crystal', shade)
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
    assert not gltf.get('images') and not gltf.get('textures'), 'Cinderworks kit must not duplicate shared textures'
    assert all('uri' not in buffer for buffer in gltf['buffers'])
    assert {mat['name'] for mat in gltf['materials']} == set(MATERIAL_BINDINGS)
    shared = json.loads((ROOT / 'client/assets/old-watch/manifest.json').read_text())
    assert hashlib.sha256((ROOT / 'client/assets/old-watch/kit.glb').read_bytes()).hexdigest() == shared['sha256']
    contracts = {}
    for prefix, spec in BUILDINGS.items():
        W, D, WH, H = dimensions(spec)
        contracts[prefix] = {'width': W, 'depth': D, 'wallHeight': WH, 'height': H, 'thickness': THICKNESS,
                             'doorWidth': DOOR_WIDTH, 'doorHeight': DOOR_HEIGHT, 'baseTop': .48, 'floorTop': .025,
                             'ridge': spec['ridge'], 'chimney': [-W * .29, H - .10, -D * .22],
                             'sign': [1.55, 3.85, D / 2 + .09]}
    manifest = {
        'schemaVersion': 1, 'generator': 'tools/build-cinderworks.py', 'seed': SEED,
        'blenderVersion': bpy.app.version_string, 'coordinateSystem': 'Y-up, meters, +Z front',
        'sourceLicense': 'Original Skywake Isles project assets; see CREDITS.md',
        'file': 'kit.glb', 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
        'dependencies': [{'url': SHARED_KIT, 'sha256': shared['sha256'],
                          'ownership': 'Shared cache owns original material textures and reusable props'}],
        'materialBindings': MATERIAL_BINDINGS, 'prefabs': {}, 'textures': [],
        'embeddedImageCount': 0, 'decodedTextureBytes': 0, 'buildingContracts': contracts,
        'propEnvelopes': {name: {'maxRadius': limit, 'minY': low, 'maxY': high}
                          for name, (limit, low, high) in PROP_ENVELOPES.items()},
    }

    def values(index):
        accessor = gltf['accessors'][index]
        view = gltf['bufferViews'][accessor['bufferView']]
        assert accessor['componentType'] == 5126 and accessor['type'] == 'VEC3'
        assert view.get('byteStride', 12) == 12
        offset = bin_start + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        return np.frombuffer(raw, dtype='<f4', count=accessor['count'] * 3, offset=offset).reshape((-1, 3))

    forge = contracts['cinder_forge']
    stack = np.array([forge['chimney'][0], forge['chimney'][2]])
    chimney_high = 0.0
    for name, index in roots.items():
        minimum = np.array([float('inf')] * 3)
        maximum = -minimum
        triangles, primitives, radius, materials = 0, 0, 0, set()
        prefix = next((p for p in BUILDINGS if name.startswith(p + '_')), None)
        W, D, WH, H = dimensions(BUILDINGS[prefix]) if prefix else (0, 0, 0, 0)
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
                if prefix and name.split(prefix + '_')[1] in ('base', 'wall_front', 'wall_back'):
                    in_door = ((np.abs(positions[:, 0]) < DOOR_WIDTH / 2 - .0001)
                               & (np.abs(positions[:, 2]) > D / 2 - THICKNESS - .001)
                               & (positions[:, 1] > .0251) & (positions[:, 1] < DOOR_HEIGHT - .0001))
                    assert not in_door.any(), f'{name}: doorway prism is obstructed'
                if prefix and name.endswith('_roof'):
                    near = np.linalg.norm(positions[:, (0, 2)] - stack, axis=1) <= .5
                    if near.any():
                        chimney_high = max(chimney_high, float(positions[near, 1].max()))
                triangles += gltf['accessors'][primitive['indices']]['count'] // 3
                primitives += 1
                materials.add(gltf['materials'][primitive['material']]['name'])
        manifest['prefabs'][name] = {'bounds': {'min': minimum.round(5).tolist(), 'max': maximum.round(5).tolist()},
                                     'dimensions': (maximum - minimum).round(5).tolist(),
                                     'horizontalRadius': round(radius, 5), 'triangles': triangles,
                                     'primitives': primitives, 'materials': sorted(materials)}
    assert chimney_high > 6.6, chimney_high
    for name, prefab in manifest['prefabs'].items():
        low, high = prefab['bounds']['min'], prefab['bounds']['max']
        prefix = next((p for p in BUILDINGS if name.startswith(p + '_')), None)
        if prefix:
            W, D, WH, H = dimensions(BUILDINGS[prefix])
            part = name.split(prefix + '_')[1]
            if part != 'roof':
                assert low[0] >= -W / 2 - .001 and high[0] <= W / 2 + .001, (name, low, high)
                edge = D / 2 + (.001 if part == 'base' else .16)
                assert low[2] >= -edge and high[2] <= edge, (name, low, high)
                assert high[1] <= WH + .001, (name, low, high)
                assert (high[1] <= .4801 if part == 'base' else low[1] >= .4799), (name, low, high)
            else:
                assert low[0] >= -(W + .35) / 2 and high[0] <= (W + .35) / 2, (name, low, high)
                assert low[2] >= -(D + .35) / 2 and high[2] <= (D + .35) / 2, (name, low, high)
                assert low[1] >= WH - .001 and high[1] <= H, (name, low, high)
        else:
            limit, floor, ceiling = PROP_ENVELOPES[name]
            assert prefab['horizontalRadius'] <= limit, (name, prefab['horizontalRadius'], limit)
            assert low[1] >= floor - .0006 and high[1] <= ceiling, (name, low, high)
        if name == 'forge_sign':
            assert low[2] >= SIGN_DEPTH[0] and high[2] <= SIGN_DEPTH[1], (name, low, high)
        if name == 'basalt_outcrop':
            assert prefab['horizontalRadius'] <= 3.0 and high[1] <= 8.0, (name, prefab)
    manifest['totalTriangles'] = sum(p['triangles'] for p in manifest['prefabs'].values())
    manifest['totalPrimitives'] = sum(p['primitives'] for p in manifest['prefabs'].values())
    assert manifest['bytes'] < 3.5 * 1024 * 1024, manifest['bytes']
    assert manifest['totalTriangles'] < 40000, manifest['totalTriangles']
    return manifest


def preview(path):
    loader = importlib.util.spec_from_file_location('old_watch_preview', ROOT / 'tools/build-old-watch.py')
    old_watch = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(old_watch)
    with tempfile.TemporaryDirectory(prefix='skywake-cinderworks-preview-') as temporary:
        old_watch.create_materials(pathlib.Path(temporary))
        for root in PREFABS.values():
            for child in root.children:
                binding = MATERIAL_BINDINGS[child.data.materials[0].name]
                material = MATERIALS[binding['source']].copy()
                material.use_backface_culling = not binding.get('doubleSided', False)
                nodes, links = material.node_tree.nodes, material.node_tree.links
                shader = nodes.get('Principled BSDF')
                if 'color' in binding:
                    # The iron/amber sources are flat colours with no upstream link.
                    if shader.inputs['Base Color'].links:
                        upstream = shader.inputs['Base Color'].links[0].from_socket
                        tint = nodes.new('ShaderNodeMixRGB')
                        tint.blend_type = 'MULTIPLY'
                        tint.inputs[0].default_value = 1
                        tint.inputs[2].default_value = tuple(binding['color']) + (1,)
                        links.new(upstream, tint.inputs[1])
                        links.new(tint.outputs['Color'], shader.inputs['Base Color'])
                    else:
                        base = shader.inputs['Base Color'].default_value
                        shader.inputs['Base Color'].default_value = tuple(
                            min(1.0, base[i] * binding['color'][i]) for i in range(3)) + (1,)
                if 'normalScale' in binding:
                    for node in material.node_tree.nodes:
                        if node.type == 'NORMAL_MAP':
                            node.inputs['Strength'].default_value = binding['normalScale']
                child.data.materials[0] = material
        # The sign hangs where the runtime places it, on the front wall bracket.
        positions = {'cinder_forge': (-9.5, 0, 0.0), 'forge_sign': (-7.95, 3.85, 2.096),
                     'forge_anvil': (-5.0, 0, -2.0), 'ore_pile': (-2.2, 0, -2.0),
                     'forge_lantern': (0.2, 0, -2.0), 'coal_bin': (2.0, 0, -2.0),
                     'slag_heap': (4.2, 0, -2.0), 'basalt_outcrop': (11.0, 0, 1.0),
                     'basalt_boulder_a': (-2.0, 0, 5.6), 'basalt_boulder_b': (0.5, 0, 5.8),
                     'cinder_clump': (2.7, 0, 5.4), 'ember_crystal': (4.0, 0, 5.4)}
        for name, root in PREFABS.items():
            prefix = next((p for p in BUILDINGS if name.startswith(p + '_')), name)
            root.location = game_to_blender(positions[prefix])
        bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.02))
        bpy.context.object.data.materials.append(MATERIALS['ground_earth'])
        scene = bpy.context.scene
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = 32
        scene.cycles.use_denoising = True
        world = bpy.data.worlds.new('cinderworks_preview_world')
        world.use_nodes = True
        world.node_tree.nodes.get('Background').inputs['Color'].default_value = (.60, .52, .44, 1)
        world.node_tree.nodes.get('Background').inputs['Strength'].default_value = 1.1
        scene.world = world
        bpy.ops.object.light_add(type='AREA', location=(-10, -10, 22))
        key = bpy.context.object
        key.data.energy, key.data.shape, key.data.size = 7200, 'DISK', 13
        key.data.color = (1, .94, .84)
        key.rotation_euler = (Vector((0, 0, 2)) - key.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.ops.object.camera_add(location=(14, -30, 16))
        camera = bpy.context.object
        camera.rotation_euler = (Vector((-0.5, -1.5, 2.6)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.type, camera.data.ortho_scale = 'ORTHO', 31
        scene.camera = camera
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1800, 1150, 100
        scene.view_settings.view_transform = 'AgX'
        path.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'client/assets/cinderworks')
    parser.add_argument('--preview', type=pathlib.Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    args.output.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for name, binding in MATERIAL_BINDINGS.items():
        create_binding_material(name, double_sided=binding.get('doubleSided', False))
    for prefix, spec in BUILDINGS.items():
        build_building(prefix, spec)
    build_forge_sign()
    build_forge_anvil()
    build_ore_pile()
    build_forge_lantern()
    build_coal_bin()
    build_slag_heap()
    build_basalt_outcrop()
    build_basalt_boulder_a()
    build_basalt_boulder_b()
    build_cinder_clump()
    build_ember_crystal()
    output = args.output / 'kit.glb'
    export_glb(output)
    manifest = inspect_glb(output)
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'CINDERWORKS_OK: {len(PREFABS)} prefabs, {manifest["totalTriangles"]:,} triangles, '
          f'{manifest["totalPrimitives"]} primitives, {manifest["bytes"]:,} bytes')
    if args.preview:
        preview(args.preview.resolve())


if __name__ == '__main__':
    main()
