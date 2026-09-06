"""Build Driftwood Yard and Sunwake Strand's original, geometry-only environment kit extension.

    blender --background --factory-startup --python-exit-code 1 --python tools/build-driftwood-yard.py

Named slots borrow Old Watch's original textures at runtime, the same
extension pattern as Windward Farm, Tideglass Market and Saltwind Harbor.
--output supports independent byte comparisons; --preview creates an untracked
textured contact sheet after export, without putting preview images into the
shipping GLB.

Milestone 5 sample: a working boatyard and the open strand below it. Both
buildings keep the shared weathering language (beveled blocks, vertex wear,
metric UVs, stone footings, paired clear doors) but own siding, trim and roof
treatments that no shipped area uses:

  timber_shed         raw fresh-sawn honey weatherboard over stone, tarred trim,
                      pitch-tarred vertical roof boards under bleached battens,
                      a builder's half-hull sign and a tool rack
  shipwright_cottage  oxblood clinker planking, bleached driftwood trim and
                      solid shutters, silver-grey shingles, a carved gull finial
                      and oars leaning by the door

The strand props (pier section, banner pole and pennant line, landing crates,
driftwood logs, fingerboard signpost) are shared by the yard and the beach.
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

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from environment_kit import (MATERIALS, PREFABS, KitMesh, game_to_blender,
                             create_binding_material, export_glb)

ROOT = pathlib.Path(__file__).resolve().parents[1]
SEED = 733901
RNG = random.Random(SEED)
TAU = math.tau
SHARED_KIT = '/assets/old-watch/kit.glb'
DOOR_WIDTH, DOOR_HEIGHT, THICKNESS = 2.30, 2.80, .24
MATERIAL_BINDINGS = {
    'watch_stone': {'source': 'watch_stone'},
    'aged_timber': {'source': 'aged_timber'},
    'forged_iron': {'source': 'forged_iron'},
    'recess_shadow': {'source': 'recess_shadow'},
    'lantern_amber': {'source': 'lantern_amber'},
    'raw_plank': {'source': 'aged_timber', 'color': [5.4, 4.1, 2.3], 'normalScale': .45},
    'pitch_black': {'source': 'aged_timber', 'color': [.55, .5, .45], 'normalScale': .35},
    'tar_roof': {'source': 'aged_timber', 'color': [.85, .76, .66], 'normalScale': .30},
    'oxblood_paint': {'source': 'aged_timber', 'color': [3.6, 1.05, .9], 'normalScale': .35},
    'bleached_wood': {'source': 'aged_timber', 'color': [5.8, 5.7, 5.3], 'normalScale': .30},
    'silver_shingle': {'source': 'dark_slate', 'color': [5.8, 5.4, 4.3], 'normalScale': .40},
    'sail_canvas': {'source': 'ground_earth', 'color': [8.5, 8.0, 6.8], 'doubleSided': True},
    'hemp_rope': {'source': 'needle_foliage', 'color': [2.6, 1.7, 1.1]},
}
# Matches shared/exploration.js structure(): width = radius*1.42, depth = radius*1.18,
# wallHeight = max(3.2, height*.58). Neither building has a chimney; the fallback
# kinds (warehouse, cottage) draw none.
BUILDINGS = {
    'timber_shed': {'radius': 3.3, 'height': 6.0, 'siding': 'weatherboard', 'wash': 'raw_plank', 'trim': 'pitch_black',
                    'skirt': .78, 'roof': 'tar_roof', 'cover': 'boards', 'ridge': 5.85,
                    'halfHull': True, 'toolRack': True},
    'shipwright_cottage': {'radius': 3.0, 'height': 5.5, 'siding': 'clinker', 'wash': 'oxblood_paint',
                           'trim': 'bleached_wood', 'skirt': .70, 'roof': 'silver_shingle', 'cover': 'shingle',
                           'ridge': 5.28, 'rows': 8, 'shutters': True, 'finial': True, 'oars': True},
}
PROPS = ['hull_frame', 'timber_stack', 'yard_lantern', 'sawhorse_bench', 'pitch_kettle', 'pier_section',
         'banner_pole', 'banner_line', 'landing_crates', 'driftwood_log', 'strand_signpost']
# root -> (maximum horizontal radius, minimum y, maximum y); pier_section is
# checked against its rectangular deck instead of a radius.
PROP_ENVELOPES = {
    'hull_frame': (3.45, -.05, 2.6),
    'timber_stack': (1.95, -.05, 1.6),
    'yard_lantern': (.50, -.06, 2.7),
    'sawhorse_bench': (1.5, -.03, 1.1),
    'pitch_kettle': (.75, -.03, 1.25),
    'banner_pole': (.25, -.5, 5.5),
    'banner_line': (7.05, -1.3, .15),
    'landing_crates': (1.15, -.02, 1.7),
    'driftwood_log': (1.4, -.06, .7),
    'strand_signpost': (.8, -.4, 3.1),
}
PENNANT_COLORS = ((1, .82, .42), (1, .55, .42), (.42, .78, .74))
EXPECTED = [f'{prefix}_{part}' for prefix in BUILDINGS
            for part in ('base', 'wall_east', 'wall_west', 'wall_front', 'wall_back', 'roof')] + PROPS


def dimensions(spec):
    radius, height = spec['radius'], spec['height']
    return radius * 1.42, radius * 1.18, max(3.2, height * .58), height


def stone_color(y):
    shade = RNG.uniform(.78, 1.03)
    moss = .17 if y < .62 and RNG.random() < .5 else .03
    return (shade * (1 - moss), shade * (1 - moss * .3), shade * (1 - moss * 1.3))


def timber_color():
    shade = RNG.uniform(.80, 1.04)
    return (shade, shade * .95, shade * .84)


def wash_color():
    shade = RNG.uniform(.86, 1.0)
    return (shade, shade * .99, shade * .96)


def drift_color():
    """Salt-bleached timber: near neutral, slightly cooler than fresh sawn stock."""
    shade = RNG.uniform(.84, 1.05)
    return (shade, shade * .99, shade * .97)


def stone_span(mesh, start, end, bottom, top, *, fixed, axis='x', depth=.24):
    rows = max(1, round((top - bottom) / .31))
    for row in range(rows):
        y0, y1 = bottom + (top - bottom) * row / rows, bottom + (top - bottom) * (row + 1) / rows
        count = max(1, round((end - start) / .60))
        edges = [start] + [start + (end - start) * (j + (.17 if row % 2 else -.12)) / count
                           for j in range(1, count)] + [end]
        for a, b in zip(edges, edges[1:]):
            center = ((a + b) / 2, (y0 + y1) / 2, fixed) if axis == 'x' else (fixed, (y0 + y1) / 2, (a + b) / 2)
            size = (b - a - .014, y1 - y0 - .010, depth) if axis == 'x' else (depth, y1 - y0 - .010, b - a - .014)
            mesh.block(center, size, color=stone_color(y0), bevel=RNG.uniform(.022, .038))


def place_block(mesh, along, y, fixed, axis, size_along, size_y, depth, material, color, **kw):
    center = (along, y, fixed) if axis == 'x' else (fixed, y, along)
    size = (size_along, size_y, depth) if axis == 'x' else (depth, size_y, size_along)
    mesh.block(center, size, material, color, **kw)


def weatherboard(mesh, start, end, bottom, top, *, fixed, axis, wash, trim, depth=.15):
    """Unpainted lapped boards with a waney sawn lower edge and the odd knot."""
    span = end - start
    rows = max(1, round((top - bottom) / .24))
    pitch = (top - bottom) / rows
    for row in range(rows):
        shade = timber_color()
        # Each course stands proud of the one above; the top course stays flush
        # with the wall cap so the wall height contract holds.
        place_block(mesh, (start + end) / 2, bottom + (row + .5) * pitch, fixed, axis, span - .010,
                    pitch + (.018 if row < rows - 1 else 0), depth - .028 + (row % 2) * .010,
                    wash, shade, bevel=0)
        # The exposed lower edge is sawn off the round, so it wanders in short
        # segments instead of running dead straight along the course.
        pieces = max(2, round(span / .70))
        for j in range(pieces):
            a, b = start + span * j / pieces + .006, start + span * (j + 1) / pieces - .006
            place_block(mesh, (a + b) / 2, bottom + row * pitch + .028 + RNG.uniform(-.012, .014), fixed, axis,
                        b - a, .050, depth + .012, wash, (shade[0] * .70, shade[1] * .66, shade[2] * .58), bevel=0)
    place_block(mesh, start + span * RNG.uniform(.18, .82), bottom + (top - bottom) * RNG.uniform(.20, .85),
                fixed, axis, .085, .065, depth + .016, wash, (.44, .37, .28), bevel=.014)


def clinker_boards(mesh, start, end, bottom, top, *, fixed, axis, wash, trim, depth=.15):
    """Painted lapped planking; weather takes the paint off every exposed lip."""
    rows = max(1, round((top - bottom) / .20))
    pitch = (top - bottom) / rows
    for row in range(rows):
        shade = wash_color()
        place_block(mesh, (start + end) / 2, bottom + (row + .5) * pitch, fixed, axis, end - start - .012,
                    pitch + (.022 if row < rows - 1 else 0), depth - .022, wash, shade, bevel=0)
        worn = drift_color()
        place_block(mesh, (start + end) / 2, bottom + row * pitch + .016, fixed, axis, end - start - .012, .030,
                    depth + .010, trim, (worn[0] * .92, worn[1] * .90, worn[2] * .88), bevel=0)


SIDING = {'weatherboard': weatherboard, 'clinker': clinker_boards}


def side_window(mesh, x, center_z, sign, bottom, top, trim, shutters=False):
    y = (bottom + top) / 2
    mesh.block((x, y, center_z), (.09, top - bottom, .78), 'recess_shadow', bevel=0)
    for z in (center_z - .43, center_z + .43):
        mesh.block((x, y, z), (.22, top - bottom + .13, .095), trim, (.90, .91, .93), bevel=.009)
    for yy in (bottom - .05, top + .05):
        mesh.block((x, yy, center_z), (.22, .095, .93), trim, (.91, .92, .94), bevel=.009)
    mesh.block((x + sign * .066, y, center_z), (.05, top - bottom - .05, .052), trim, (.86, .87, .89), bevel=.005)
    mesh.block((x + sign * .095, y, center_z), (.024, .045, .10), 'forged_iron', bevel=.004)
    if shutters:
        # Solid plank shutters hung open, each carrying a painted oxblood diamond.
        for side in (-1, 1):
            z = center_z + side * .74
            mesh.block((x + sign * .072, y, z), (.045, top - bottom + .04, .42), trim, drift_color(), bevel=.007)
            for k in range(3):
                mesh.block((x + sign * .084, y, z + (k - 1) * .135), (.020, top - bottom + .02, .012),
                           trim, (.74, .75, .77), bevel=0)
            for scale, thin in ((.20, .014), (.13, .016)):
                mesh.block((x + sign * .096, y, z), (thin, scale * 1.5, scale), 'oxblood_paint', (.95, .92, .90),
                           bevel=0, axis_y=Vector((0, math.cos(.785), math.sin(.785))))
            for yy in (bottom + .10, top - .10):
                mesh.block((x + sign * .058, yy, z - side * .22), (.03, .04, .06), 'forged_iron', bevel=.003)


def half_hull_sign(mesh, z, wash, trim, top):
    """Builder's half-hull model on a tarred board, clear above the door header."""
    y = top - .34
    mesh.block((0, y, z + .085), (1.94, .58, .050), trim, (.44, .42, .40), bevel=.010)
    for j in range(9):
        t = (j / 8 - .5) * 2
        keel, sheer = y - .16 + .13 * t * t, y + .20 + .045 * t * t
        beam = .022 + .105 * math.cos(t * math.pi / 2)
        mesh.block((t * .82, (keel + sheer) / 2, z + .095 + beam / 2), (.20, sheer - keel, beam),
                   wash, timber_color(), bevel=.012)
    mesh.block((0, y - .17, z + .12), (1.58, .055, .085), trim, (.40, .38, .36), bevel=.008)


def tool_rack(mesh, z, wash, trim, top):
    """Mallet and adze laid across pegged cleats, high on the back gable wall."""
    for y in (top - .10, top - .36):
        mesh.block((-.55, y, z - .050), (1.62, .075, .055), wash, timber_color(), bevel=.008)
    for x in (-1.30, -.52, .24):
        mesh.block((x, top - .23, z - .062), (.045, .050, .075), trim, (.48, .46, .44), bevel=.004)
    mallet = top - .23
    mesh.tube([(-1.24, mallet, z - .088), (-.36, mallet + .012, z - .088)], [.024, .024], wash, (.88, .82, .68), sides=5)
    mesh.block((-.20, mallet + .015, z - .086), (.19, .115, .060), wash, (.76, .70, .58), bevel=.014)
    adze = top - .44
    mesh.tube([(-.10, adze, z - .088), (.56, adze + .030, z - .088)], [.021, .019], wash, (.86, .80, .66), sides=5)
    mesh.block((.70, adze + .040, z - .084), (.16, .135, .052), 'forged_iron', bevel=.006)


def leaning_oars(mesh, z, trim):
    """Two oars stood on the plinth beside the door, clear of the doorway prism."""
    for x, lean, top in ((1.80, .09, 2.56), (1.90, -.05, 2.34)):
        tone = drift_color()
        foot, head = (x - lean, .55, z + .126), (x + lean, top, z + .082)
        mesh.tube([foot, head], [.036, .028], trim, tone, sides=5)
        mesh.block((foot[0] - lean * .18, .78, foot[2] + .004), (.135, .50, .048), trim,
                   (tone[0] * .95, tone[1] * .95, tone[2] * .97), bevel=.010)
        mesh.block((head[0], top + .05, head[2]), (.070, .10, .070), trim, tone, bevel=.012)


def build_base(prefix, W, D):
    xwall, zwall = (W - THICKNESS) / 2, (D - THICKNESS) / 2
    base = KitMesh(f'{prefix}_base')
    base.block((0, -.15, 0), (W, .30, D), color=(.82, .85, .80), bevel=.025)
    boards = max(9, round(W / .39))
    for j in range(boards):
        x = (j - (boards - 1) / 2) * (W - .48) / boards
        base.block((x, .004, 0), ((W - .48) / boards - .007, .042, D - .48), 'aged_timber', timber_color(), bevel=0)
    for sign in (-1, 1):
        stone_span(base, -D / 2, D / 2, .025, .48, fixed=sign * xwall, axis='z')
        for a, b in ((-xwall + .12, -DOOR_WIDTH / 2), (DOOR_WIDTH / 2, xwall - .12)):
            stone_span(base, a, b, .025, .48, fixed=sign * zwall)
    base.finish()


def build_side_walls(prefix, spec, W, D, WH):
    xwall, zwall = (W - THICKNESS) / 2, (D - THICKNESS) / 2
    skirt, wash, trim, siding = spec['skirt'], spec['wash'], spec['trim'], SIDING[spec['siding']]
    win_center, win_half = skirt + (WH - skirt) * .52, .34
    for sign, name in ((1, 'east'), (-1, 'west')):
        mesh = KitMesh(f'{prefix}_wall_{name}')
        x = sign * xwall
        stone_span(mesh, -D / 2, D / 2, .48, skirt, fixed=x, axis='z')
        for a, b in ((-D / 2, -.52), (.52, D / 2)):
            siding(mesh, a, b, skirt, WH, fixed=x, axis='z', wash=wash, trim=trim)
        siding(mesh, -.52, .52, skirt, win_center - win_half, fixed=x, axis='z', wash=wash, trim=trim)
        siding(mesh, -.52, .52, win_center + win_half, WH, fixed=x, axis='z', wash=wash, trim=trim)
        side_window(mesh, x, 0, sign, win_center - win_half, win_center + win_half, trim, spec.get('shutters', False))
        for z in (-zwall, 0, zwall):
            mesh.block((x, (skirt + WH) / 2, z), (.22, WH - skirt, .155), trim, (.89, .90, .92), bevel=.011)
        mesh.block((x, skirt - .02, 0), (.22, .095, D), trim, (.90, .91, .93), bevel=.010)
        mesh.finish()


def build_end_walls(prefix, spec, W, D, WH):
    xwall, zwall = (W - THICKNESS) / 2, (D - THICKNESS) / 2
    skirt, wash, trim, siding = spec['skirt'], spec['wash'], spec['trim'], SIDING[spec['siding']]
    for sign, name in ((1, 'front'), (-1, 'back')):
        mesh = KitMesh(f'{prefix}_wall_{name}')
        z = sign * zwall
        for a, b in ((-xwall + .12, -1.15), (1.15, xwall - .12)):
            stone_span(mesh, a, b, .48, skirt, fixed=z)
            siding(mesh, a, b, skirt, WH, fixed=z, axis='x', wash=wash, trim=trim)
        for x in (-1.25, 1.25):
            mesh.block((x, (DOOR_HEIGHT + .80) / 2, z), (.18, DOOR_HEIGHT - .80, .24), trim, (.88, .89, .91), bevel=.013)
        mesh.block((0, DOOR_HEIGHT + (WH - DOOR_HEIGHT) / 2, z), (W - .48, WH - DOOR_HEIGHT, .24), trim, (.90, .91, .93), bevel=.012)
        for x in (-1.63, 1.63):
            mesh.block((x, DOOR_HEIGHT + .11, z + sign * .108), (.28, .09, .020), 'forged_iron', bevel=.007)
            mesh.block((x, 1.52, z + sign * .09), (.20, .07, .024), 'forged_iron', bevel=.006)
        # Everything hung on a face sits proud of the siding but inside the
        # footprint bound, and clears the doorway prism in x or in height.
        if sign > 0 and spec.get('halfHull'):
            half_hull_sign(mesh, z, wash, trim, WH)
        if sign < 0 and spec.get('toolRack'):
            tool_rack(mesh, z, wash, trim, WH)
        if sign > 0 and spec.get('oars'):
            leaning_oars(mesh, z, trim)
        mesh.finish()


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


def board_roof_cover(mesh, spec, reach, end, eave, ridge):
    """Tarred boards run eave to ridge; bleached battens cap every seam."""
    tile, batten = spec['roof'], 'bleached_wood'
    count = max(3, round(2 * end / .30))
    for sign in (-1, 1):
        rise = ridge - eave - .06
        length = math.hypot(reach, rise)
        normal = (sign * rise / length, reach / length)
        slope = (-sign * reach / length, rise / length)
        edges = [-end + 2 * end * j / count + (RNG.uniform(-.011, .011) if 0 < j < count else 0)
                 for j in range(count + 1)]
        # Boards start .06 inside the eave line so their battens keep the roof
        # inside the overhang bounds.
        foot, head = sign * (reach - .06), 0.0
        for j in range(count):
            z = (edges[j] + edges[j + 1]) / 2
            shade = RNG.uniform(.78, 1.10)
            mesh.beam((foot, eave + .06, z), (head, ridge, z), .055, edges[j + 1] - edges[j] - .006,
                      (shade, shade * .99, shade * .97), material=tile)
        for j in range(1, count):
            z = edges[j]
            a = (foot + normal[0] * .048 + slope[0] * .10, eave + .06 + normal[1] * .048 + slope[1] * .10, z)
            b = (head + normal[0] * .048, ridge + normal[1] * .048, z)
            mesh.beam(a, b, .058, .062, drift_color(), material=batten)
        mesh.block((sign * (reach - .04), eave + .050, 0), (.07, .085, 2 * end - .02), batten, (.90, .91, .92), bevel=.009)
    for j in range(10):
        z = -end + (j + .5) * 2 * end / 10
        mesh.block((0, ridge + .070, z), (.26, .100, 2 * end / 10 - .006), batten, drift_color(), bevel=.010)


def shingle_roof_cover(mesh, spec, reach, end, eave, ridge):
    """Staggered bleached shingle courses between bleached barge boards."""
    tile, trim, rows, columns = spec['roof'], spec['trim'], spec['rows'], 10
    step = 2 * end / columns
    for sign in (-1, 1):
        for row in range(rows):
            t0, t1 = row / rows, min(1, (row + 1.18) / rows)
            x0, x1 = sign * reach * (1 - t0), sign * reach * (1 - t1)
            y0, y1 = eave + .06 + (ridge - eave) * t0, eave + .06 + (ridge - eave) * t1
            offset = .5 if row % 2 else 0
            for col in range(columns + 1):
                z0 = max(-end, -end + (col - offset) * step + .005)
                z1 = min(end, z0 + step - .010)
                if z1 - z0 < .03:
                    continue
                wear, value = RNG.uniform(-.007, .007), RNG.uniform(.80, 1.14)
                mesh.polygon([(x0, y0 + wear, z0), (x1, y1 + wear, z0), (x1, y1 + .028 + wear, z1), (x0, y0 + .028 + wear, z1)],
                             tile, (value * .97, value, value * 1.01))
        for z in (-end + .03, end - .03):
            mesh.beam((sign * (reach - .05), eave + .05, z), (0, ridge + .01, z), .08, .07, drift_color(), material=trim)
        mesh.block((sign * (reach - .04), eave + .050, 0), (.07, .085, 2 * end - .02), trim, (.90, .91, .92), bevel=.009)
    for j in range(10):
        z = -end + (j + .5) * 2 * end / 10
        mesh.block((0, ridge + .07, z), (.17, .095, 2 * end / 10 - .004), tile, (.98, 1.01, .99), bevel=0)
    if spec.get('finial'):
        # A carved gull rides the ridge, well inside the building height.
        body = ridge + .12
        mesh.block((0, body, .30), (.085, .115, .36), trim, drift_color(), bevel=.022)
        mesh.block((0, body + .02, .50), (.065, .075, .14), trim, drift_color(), bevel=.020)
        for side in (-1, 1):
            mesh.block((side * .10, body - .01, .27), (.16, .036, .21), trim, drift_color(), bevel=.012,
                       yaw=side * .38)


ROOF_COVER = {'boards': board_roof_cover, 'shingle': shingle_roof_cover}


def build_roof(prefix, spec, W, D, WH, H):
    mesh = KitMesh(f'{prefix}_roof')
    eave, ridge, trim, tile = WH, spec['ridge'], spec['trim'], spec['roof']
    reach, end = W / 2 + .14, D / 2 + .14
    for z in (-D / 2 + THICKNESS / 2, D / 2 - THICKNESS / 2):
        # Sealed timber gable, closed against the weather like the walls below.
        gable = [Vector((-W / 2, eave, z)), Vector((W / 2, eave, z)), Vector((0, ridge - .05, z))]
        if (gable[1] - gable[0]).cross(gable[2] - gable[0]).dot(Vector((0, 0, z))) < 0:
            gable.reverse()
        mesh.polygon(gable, spec['wash'], (.86, .87, .78))
        mesh.polygon(list(reversed(gable)), 'aged_timber', (.72, .73, .64))
        for sign in (-1, 1):
            mesh.beam((sign * (W / 2 - .07), eave + .05, z), (0, ridge - .09, z), .10, .12, (.30, .28, .25), material=trim)
        mesh.beam((0, eave + .02, z), (0, ridge - .11, z), .11, .12, (.31, .29, .26), material=trim)
    for sign in (-1, 1):
        prism(mesh, [(sign * reach, eave), (0, ridge - .035), (0, ridge + .018), (sign * reach, eave + .06)],
              -end, end, tile, (.74, .78, .74))
    ROOF_COVER[spec['cover']](mesh, spec, reach, end, eave, ridge)
    mesh.finish()


def build_building(prefix, spec):
    W, D, WH, H = dimensions(spec)
    assert spec['ridge'] + .12 <= H, prefix
    build_base(prefix, W, D)
    build_side_walls(prefix, spec, W, D, WH)
    build_end_walls(prefix, spec, W, D, WH)
    build_roof(prefix, spec, W, D, WH, H)


def run_boards(mesh, points, thickness, height, material, color, bevel=0):
    """A fitted plank run stepped through a curved station line."""
    for a, b in zip(points, points[1:]):
        dx, dy, dz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        mesh.block(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2),
                   (thickness, height, math.hypot(math.hypot(dx, dz), dy)), material, color,
                   bevel=bevel, yaw=math.atan2(dx, dz))


def rope_loop(mesh, center, radius, *, turns=1, rise=.05, sides=3, tube=.020, color=(.88, .82, .70)):
    cx, cy, cz = center
    points = [(cx + math.cos(a) * radius, cy + rise * a / TAU, cz + math.sin(a) * radius)
              for a in [i * TAU / 9 for i in range(9 * turns + 1)]]
    mesh.tube(points, [tube] * len(points), 'hemp_rope', color, sides=sides)


HULL_LENGTH, HULL_BEAM, HULL_TOP, HULL_KEEL = 3.05, 1.06, 1.92, .50


def hull_point(side, z, u):
    """A point on the hull surface: u runs 0 at the keel to 1 at the sheer."""
    taper = max(0.0, 1 - (min(abs(z), HULL_LENGTH) / HULL_LENGTH) ** 2.4) ** .55
    return (side * HULL_BEAM * taper * u ** .62, HULL_KEEL + (HULL_TOP - HULL_KEEL) * u ** 1.25, z)


def build_hull_frame():
    mesh = KitMesh('hull_frame')
    mesh.block((0, HULL_KEEL - .04, 0), (.17, .30, 5.80), 'pitch_black', (.52, .50, .48), bevel=.014)
    mesh.beam((0, HULL_KEEL - .02, 2.84), (0, 2.30, 3.00), .16, .19, (.50, .48, .46), material='pitch_black')
    mesh.beam((0, HULL_KEEL - .02, -2.84), (0, 1.94, -3.00), .16, .18, (.50, .48, .46), material='pitch_black')
    for z in (-1.62, 1.62):
        mesh.block((0, .185, z), (1.52, .37, .42), 'raw_plank', timber_color(), bevel=.014)
        for side in (-1, 1):
            mesh.block((side * .62, .44, z), (.26, .22, .34), 'raw_plank', timber_color(), bevel=0, skew=side * .18)
            mesh.block((side * .70, .05, z), (.24, .10, .30), 'pitch_black', (.48, .46, .44), bevel=0)
    for k in range(9):
        z = -2.5 + k * .625
        for side in (-1, 1):
            rib = [hull_point(side, z, u) for u in (0.0, .30, 1.0)]
            rib[0] = (side * .085, HULL_KEEL, z)
            mesh.tube(rib, [.056, .049, .042], 'pitch_black', (.50 + k * .004, .48, .46), sides=4)
    stations = [-2.72 + j * .906 for j in range(7)]
    for side, levels in ((-1, (.16, .30, .44, .60)), (1, (.16, .31, .47))):
        for u in levels:
            run_boards(mesh, [hull_point(side, z, u) for z in stations], .052, .175, 'raw_plank', timber_color())
    clamp = [(1.34, .14, -2.24), (1.16, .60, -1.62), (.96, 1.10, -.92), (.82, 1.46, -.30)]
    run_boards(mesh, clamp, .055, .22, 'raw_plank', timber_color())
    for point in (clamp[1], clamp[2]):
        mesh.block((point[0] - .04, point[1] + .04, point[2]), (.22, .10, .10), 'forged_iron', bevel=0)
        mesh.block((point[0] - .13, point[1] - .02, point[2]), (.06, .20, .06), 'forged_iron', bevel=0)
    rope_loop(mesh, (-1.30, .05, 1.12), .28, turns=2, rise=.055, tube=.022)
    mesh.tube([hull_point(-1, .62, .78), (-1.24, .10, 1.10)], [.020, .018], 'hemp_rope', (.86, .80, .68), sides=3)
    for k in range(5):
        mesh.block((RNG.uniform(-1.7, 1.7), -.01, RNG.uniform(-2.2, 2.2)), (.30, .045, .13), 'raw_plank',
                   timber_color(), bevel=0, yaw=RNG.uniform(0, TAU))
    mesh.finish()


def build_timber_stack():
    mesh = KitMesh('timber_stack')
    for x in (-.86, 0, .86):
        mesh.block((x, .07, 0), (.18, .14, 1.44), 'pitch_black', (.50, .48, .46), bevel=0)
    layers = ((.215, .135, .215, 5), (.355, .145, .245, 5), (.485, .115, .200, 6),
              (.605, .125, .230, 5), (.730, .105, .185, 6), (.845, .135, .255, 4))
    for y, height, width, count in layers:
        for j in range(count):
            z = (j - (count - 1) / 2) * (1.32 / count)
            mesh.block((RNG.uniform(-.05, .05), y, z), (2.32, height, width - .022), 'raw_plank',
                       timber_color(), bevel=0)
    for side in (-1, 1):
        mesh.block((side * 1.06, .22, side * .34), (.20, .16, .30), 'raw_plank', timber_color(),
                   bevel=0, skew=side * .30)
    lean = [(1.42, .16, .58), (1.10, .58, .42), (.76, 1.04, .26), (.52, 1.36, .14)]
    run_boards(mesh, lean, .060, .26, 'raw_plank', timber_color())
    rope_loop(mesh, (.10, .50, 0), .58, turns=1, rise=.06, tube=.022)
    rope_loop(mesh, (.10, .82, 0), .40, turns=1, rise=.05, tube=.020)
    mesh.finish()


def build_yard_lantern():
    mesh = KitMesh('yard_lantern')
    mesh.block((0, 1.18, 0), (.118, 2.48, .118), 'raw_plank', timber_color(), bevel=.012)
    mesh.block((0, 2.40, .11), (.062, .062, .28), 'pitch_black', (.50, .48, .45), bevel=.005)
    mesh.block((0, 2.14, .25), (.05, .54, .05), 'pitch_black', (.48, .46, .44), bevel=.004)
    for y in (1.84, 2.13):
        mesh.block((0, y, .25), (.28, .035, .28), 'pitch_black', (.46, .44, .42), bevel=.006)
    mesh.block((0, 1.985, .25), (.21, .27, .21), 'lantern_amber', bevel=.03)
    mesh.block((0, 2.235, .25), (.17, .15, .17), 'pitch_black', (.46, .44, .42), bevel=.02)
    mesh.block((0, .92, 0), (.22, .075, .22), 'pitch_black', (.50, .48, .46), bevel=.008)
    for side in (-1, 1):
        mesh.beam((side * .10, 2.28, .02), (side * .04, 2.44, .17), .035, .035, (.48, .46, .44), material='pitch_black')
    mesh.finish()


def sawhorse(mesh, x):
    for sx in (-1, 1):
        for sz in (-1, 1):
            mesh.block((x + sx * .055, .38, sz * .30), (.078, .76, .078), 'raw_plank', timber_color(),
                       bevel=0, skew=sx * .11)
    mesh.block((x, .80, 0), (.30, .095, .84), 'raw_plank', timber_color(), bevel=.009)
    mesh.block((x, .55, 0), (.24, .06, .58), 'raw_plank', timber_color(), bevel=0)


def build_sawhorse_bench():
    mesh = KitMesh('sawhorse_bench')
    for x in (-.72, .72):
        sawhorse(mesh, x)
    for j in range(3):
        mesh.block((0, .885, (j - 1) * .26), (2.24, .055, .245), 'raw_plank', timber_color(), bevel=.006)
    # Bow saw stood against the bench end, and a mallet left on the plank.
    run_boards(mesh, [(1.16, .04, .30), (1.02, .48, .24), (.88, .94, .18)], .055, .075, 'raw_plank', timber_color())
    mesh.block((.94, .72, .10), (.045, .050, .40), 'raw_plank', timber_color(), bevel=0, yaw=.30)
    mesh.block((1.02, .40, .11), (.030, .075, .44), 'forged_iron', bevel=0, yaw=.30)
    mesh.tube([(1.05, .49, .40), (.90, .95, .34)], [.012, .012], 'hemp_rope', (.86, .80, .68), sides=3)
    mesh.tube([(-.36, .945, -.10), (.14, .955, -.02)], [.026, .024], 'raw_plank', (.90, .84, .70), sides=5)
    mesh.block((.30, .965, 0), (.20, .115, .105), 'raw_plank', timber_color(), bevel=.016)
    mesh.block((-.95, .05, -.22), (.42, .10, .30), 'raw_plank', timber_color(), bevel=0, yaw=.4)
    mesh.finish()


def build_pitch_kettle():
    mesh = KitMesh('pitch_kettle')
    for k in range(9):
        a = k * TAU / 9 + .21
        r = .50 + (k % 2) * .035
        mesh.block((math.cos(a) * r, .115, math.sin(a) * r), (.25, .23, .19), color=stone_color(.2),
                   bevel=.030, yaw=math.atan2(-math.cos(a), -math.sin(a)))
    for k in range(3):
        a = k * TAU / 3 + .5
        mesh.beam((math.cos(a) * .22, .02, math.sin(a) * .22), (math.cos(a) * .13, .44, math.sin(a) * .13),
                  .055, .055, (.9, .9, .9), material='forged_iron')
    mesh.tube([(0, .40, 0), (0, .58, 0), (0, .80, 0)], [.22, .32, .30], 'forged_iron', (.92, .92, .94), sides=9)
    mesh.tube([(0, .805, 0), (0, .818, 0)], [.275, .275], 'pitch_black', (.42, .40, .38), sides=9)
    mesh.tube([(-.31, .74, 0), (-.26, 1.02, 0), (0, 1.08, 0), (.26, 1.02, 0), (.31, .74, 0)],
              [.018] * 5, 'forged_iron', (.9, .9, .9), sides=4)
    mesh.tube([(.52, .01, .30), (.30, .58, .18), (.19, .93, .12)], [.026, .022, .020], 'raw_plank',
              (.90, .84, .70), sides=5)
    mesh.block((.17, 1.02, .11), (.075, .16, .085), 'pitch_black', (.44, .42, .40), bevel=.012)
    mesh.block((-.40, .04, -.32), (.26, .07, .20), 'pitch_black', (.42, .40, .38), bevel=0, yaw=.6)
    mesh.finish()


def build_pier_section():
    mesh = KitMesh('pier_section')
    for z in (-.85, .85):
        mesh.block((0, .055, z), (4.34, .17, .18), 'pitch_black', (.52, .50, .48), bevel=.012)
    for row in (-.78, 0, .78):
        for j in range(5):
            mesh.block(((j - 2) * .866, .140, row), (.846, .062, .72), 'bleached_wood', drift_color(), bevel=.006)
    for side in (-1, 1):
        x = side * 2.05
        mesh.tube([(x, -4.0, 0), (x, -.30, 0), (x, .58, 0), (x, .95, 0)], [.185, .175, .160, .145],
                  'pitch_black', (.50, .48, .46), sides=7)
        mesh.block((x, .985, 0), (.30, .10, .30), 'pitch_black', (.54, .52, .50), bevel=.018)
        rope_loop(mesh, (x, .30, 0), .205, turns=1, rise=.10, tube=.022)
        mesh.block((x, .17, side * .55), (.14, .10, .82), 'bleached_wood', drift_color(), bevel=0)
    for z in (-1.14, 1.14):
        mesh.block((0, .175, z), (4.24, .05, .085), 'bleached_wood', drift_color(), bevel=0)
    mesh.finish()


def build_banner_pole():
    mesh = KitMesh('banner_pole')
    mesh.tube([(0, -.5, 0), (0, 2.2, 0), (0, 4.90, 0)], [.115, .092, .070], 'bleached_wood', drift_color(), sides=7)
    for y in (1.30, 2.62, 3.94):
        rope_loop(mesh, (0, y, 0), .105, turns=1, rise=.06, tube=.017)
    mesh.tube([(0, 4.88, 0), (0, 5.02, 0)], [.058, .046], 'forged_iron', (.9, .9, .9), sides=7)
    ring = [(math.cos(a) * .085, 5.09 + math.sin(a) * .085, 0) for a in [i * TAU / 8 for i in range(9)]]
    mesh.tube(ring, [.018] * len(ring), 'forged_iron', (.9, .9, .9), sides=4)
    for side in (-1, 1):
        mesh.block((side * .09, 4.62, 0), (.10, .075, .075), 'forged_iron', (.9, .9, .9), bevel=0)
    mesh.finish()


def build_banner_line():
    mesh = KitMesh('banner_line')

    def sag(x):
        return -.45 * (1 - (x / 7) ** 2)

    points = [(-7 + j * 14 / 14, sag(-7 + j * 14 / 14), 0) for j in range(15)]
    mesh.tube(points, [.018] * len(points), 'hemp_rope', (.88, .82, .70), sides=3)
    for k in range(9):
        x = -6.4 + k * 1.6
        top = sag(x)
        color = PENNANT_COLORS[k % 3]
        mesh.polygon([(x - .21, top - .012, -.030), (x + .21, top - .012, -.030), (x, top - .80, .020)],
                     'sail_canvas', color)
        mesh.tube([(x, top + .012, 0), (x, top - .030, .010)], [.014, .012], 'hemp_rope', (.86, .80, .68), sides=3)
    mesh.finish()


def slat_crate(mesh, center, size, material, tie=True):
    cx, cy, cz = center
    w, h, d = size
    for sign in (-1, 1):
        for k in range(3):
            y = cy - h / 2 + (k + .5) * h / 3
            mesh.block((cx, y, cz + sign * (d / 2 - .02)), (w, h / 3 - .035, .042), material, drift_color(), bevel=0)
            mesh.block((cx + sign * (w / 2 - .02), y, cz), (.042, h / 3 - .035, d - .08), material, drift_color(), bevel=0)
    for sx in (-1, 1):
        for sz in (-1, 1):
            mesh.block((cx + sx * (w / 2 - .03), cy, cz + sz * (d / 2 - .03)), (.052, h, .052), material,
                       (.80, .78, .74), bevel=.006)
    mesh.block((cx, cy - h / 2 + .03, cz), (w - .05, .05, d - .05), material, (.78, .76, .72), bevel=0)
    mesh.block((cx, cy + h / 2 - .03, cz), (w - .05, .05, d - .05), material, (.84, .82, .78), bevel=0)
    if tie:
        mesh.block((cx, cy, cz), (w + .012, .036, d + .012), 'hemp_rope', (.86, .80, .68), bevel=0)
        mesh.block((cx, cy + .04, cz), (.045, h + .010, d + .012), 'hemp_rope', (.84, .78, .66), bevel=0)


def build_landing_crates():
    mesh = KitMesh('landing_crates')
    slat_crate(mesh, (-.24, .33, .04), (.80, .64, .62), 'bleached_wood')
    slat_crate(mesh, (-.20, .93, -.02), (.70, .54, .54), 'raw_plank')
    body = [(.62, .10, .44), (.58, .30, .40), (.52, .48, .36), (.50, .60, .34)]
    for a, b in zip(body, body[1:]):
        mesh.tube([a, b], [.24, .21], 'sail_canvas', (.92, .88, .78), sides=6)
    mesh.tube([(.50, .58, .34), (.49, .68, .33)], [.10, .075], 'sail_canvas', (.88, .84, .74), sides=6)
    rope_loop(mesh, (.50, .60, .34), .105, turns=1, rise=.05, tube=.018)
    rope_loop(mesh, (-.62, .03, .52), .22, turns=1, rise=.05, tube=.022)
    mesh.finish()


def build_driftwood_log():
    mesh = KitMesh('driftwood_log')
    spine = [(-1.20, .12, .16), (-.60, .19, -.03), (.02, .21, .06), (.64, .18, .13), (1.18, .11, -.01)]
    mesh.tube(spine, [.10, .20, .22, .18, .105], 'bleached_wood', drift_color(), sides=6)
    mesh.tube([(.10, .28, .04), (.26, .46, -.12), (.36, .58, -.22)], [.075, .055, .035], 'bleached_wood',
              drift_color(), sides=5)
    mesh.tube([(-.72, .24, -.06), (-.86, .38, -.18)], [.055, .030], 'bleached_wood', drift_color(), sides=4)
    for k in range(4):
        mesh.block((-.85 + k * .58, .10, .22 + (k % 2) * .06), (.42, .07, .10), 'bleached_wood', drift_color(),
                   bevel=0, yaw=.18 * (1 if k % 2 else -1))
    mesh.block((1.14, .08, .02), (.16, .19, .22), 'bleached_wood', (.72, .71, .70), bevel=.030)
    mesh.finish()


def build_strand_signpost():
    mesh = KitMesh('strand_signpost')
    mesh.block((0, 1.22, 0), (.135, 3.24, .135), 'bleached_wood', drift_color(), bevel=.014)
    mesh.block((0, 2.90, 0), (.20, .10, .20), 'bleached_wood', drift_color(), bevel=.022)
    for y, yaw, tint in ((2.54, .38, (1, .55, .42)), (2.10, -1.18, (1, .78, .40)), (1.66, 2.34, (.42, .78, .74))):
        length, width = .68, .175
        mesh.block((math.sin(yaw) * (.06 + length / 2), y, math.cos(yaw) * (.06 + length / 2)),
                   (.055, width, length), 'bleached_wood', drift_color(), bevel=.009, yaw=yaw)
        mesh.block((math.sin(yaw) * .655, y, math.cos(yaw) * .655), (.062, width + .006, .17),
                   'bleached_wood', tint, bevel=.009, yaw=yaw)
        mesh.block((math.sin(yaw) * .10, y - .13, math.cos(yaw) * .10), (.05, .16, .13), 'forged_iron',
                   bevel=0, yaw=yaw)
    rope_loop(mesh, (0, 1.34, 0), .12, turns=1, rise=.07, tube=.017)
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
    assert not gltf.get('images') and not gltf.get('textures'), 'Driftwood kit must not duplicate shared textures'
    assert all('uri' not in buffer for buffer in gltf['buffers'])
    assert {mat['name'] for mat in gltf['materials']} == set(MATERIAL_BINDINGS)
    shared = json.loads((ROOT / 'client/assets/old-watch/manifest.json').read_text())
    assert hashlib.sha256((ROOT / 'client/assets/old-watch/kit.glb').read_bytes()).hexdigest() == shared['sha256']
    contracts = {}
    for prefix, spec in BUILDINGS.items():
        W, D, WH, H = dimensions(spec)
        contracts[prefix] = {'width': W, 'depth': D, 'wallHeight': WH, 'height': H, 'thickness': THICKNESS,
                             'doorWidth': DOOR_WIDTH, 'doorHeight': DOOR_HEIGHT, 'baseTop': .48, 'floorTop': .025,
                             'ridge': spec['ridge']}
    manifest = {
        'schemaVersion': 1, 'generator': 'tools/build-driftwood-yard.py', 'seed': SEED,
        'blenderVersion': bpy.app.version_string, 'coordinateSystem': 'Y-up, meters, +Z front',
        'sourceLicense': 'Original Skywake Isles project assets; see CREDITS.md',
        'file': 'kit.glb', 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
        'dependencies': [{'url': SHARED_KIT, 'sha256': shared['sha256'],
                          'ownership': 'Shared cache owns original material textures and reusable props'}],
        'materialBindings': MATERIAL_BINDINGS, 'prefabs': {}, 'textures': [],
        'embeddedImageCount': 0, 'decodedTextureBytes': 0, 'buildingContracts': contracts,
    }
    def values(index):
        accessor = gltf['accessors'][index]
        view = gltf['bufferViews'][accessor['bufferView']]
        assert accessor['componentType'] == 5126 and accessor['type'] == 'VEC3'
        assert view.get('byteStride', 12) == 12
        offset = bin_start + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        return np.frombuffer(raw, dtype='<f4', count=accessor['count'] * 3, offset=offset).reshape((-1, 3))
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
                triangles += gltf['accessors'][primitive['indices']]['count'] // 3
                primitives += 1
                materials.add(gltf['materials'][primitive['material']]['name'])
        manifest['prefabs'][name] = {'bounds': {'min': minimum.round(5).tolist(), 'max': maximum.round(5).tolist()},
                                     'dimensions': (maximum - minimum).round(5).tolist(),
                                     'horizontalRadius': round(radius, 5), 'triangles': triangles,
                                     'primitives': primitives, 'materials': sorted(materials)}
    for name, prefab in manifest['prefabs'].items():
        low, high = prefab['bounds']['min'], prefab['bounds']['max']
        prefix = next((p for p in BUILDINGS if name.startswith(p + '_')), None)
        if prefix:
            W, D, WH, H = dimensions(BUILDINGS[prefix])
            part = name.split(prefix + '_')[1]
            if part != 'roof':
                assert low[0] >= -W / 2 - .001 and high[0] <= W / 2 + .001, (name, low, high)
                assert low[2] >= -D / 2 - .001 and high[2] <= D / 2 + .16, (name, low, high)
                assert high[1] <= WH + .001, (name, low, high)
                assert (high[1] <= .4801 if part == 'base' else low[1] >= .4799), (name, low, high)
            else:
                assert low[0] >= -(W + .35) / 2 and high[0] <= (W + .35) / 2, (name, low, high)
                assert low[2] >= -(D + .35) / 2 and high[2] <= (D + .35) / 2, (name, low, high)
                assert low[1] >= WH - .001 and high[1] <= H, (name, low, high)
        elif name == 'pier_section':
            # A rectangular deck rather than a radius: the pilings define its span.
            assert low[0] >= -2.3 and high[0] <= 2.3, (name, low, high)
            assert low[2] >= -1.2 and high[2] <= 1.2, (name, low, high)
            assert low[1] >= -4.0 and high[1] <= 1.1, (name, low, high)
        else:
            limit, floor, ceiling = PROP_ENVELOPES[name]
            assert prefab['horizontalRadius'] <= limit, (name, prefab['horizontalRadius'])
            assert low[1] >= floor and high[1] <= ceiling, (name, low, high)
    manifest['totalTriangles'] = sum(p['triangles'] for p in manifest['prefabs'].values())
    manifest['totalPrimitives'] = sum(p['primitives'] for p in manifest['prefabs'].values())
    assert manifest['bytes'] < 3.5 * 1024 * 1024, manifest['bytes']
    assert manifest['totalTriangles'] < 40000, manifest['totalTriangles']
    return manifest


def preview(path):
    loader = importlib.util.spec_from_file_location('old_watch_preview', ROOT / 'tools/build-old-watch.py')
    old_watch = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(old_watch)
    with tempfile.TemporaryDirectory(prefix='skywake-driftwood-preview-') as temporary:
        old_watch.create_materials(pathlib.Path(temporary))
        for root in PREFABS.values():
            for child in root.children:
                binding = MATERIAL_BINDINGS[child.data.materials[0].name]
                material = MATERIALS[binding['source']].copy()
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
        positions = {'timber_shed': (-6.0, 0, 0), 'shipwright_cottage': (1.5, 0, 0),
                     'hull_frame': (8.5, 0, 1.0), 'timber_stack': (-10.5, 0, 6.0),
                     'yard_lantern': (-7.6, 0, 6.0), 'sawhorse_bench': (-5.2, 0, 6.2),
                     'pitch_kettle': (-2.6, 0, 6.0), 'pier_section': (1.0, 0, 6.4),
                     'banner_pole': (4.4, 0, 6.0), 'banner_line': (-1.0, 5.4, 9.6),
                     'landing_crates': (6.4, 0, 6.2), 'driftwood_log': (8.6, 0, 6.4),
                     'strand_signpost': (10.6, 0, 6.0)}
        for name, root in PREFABS.items():
            prefix = next((p for p in BUILDINGS if name.startswith(p + '_')), name)
            root.location = game_to_blender(positions[prefix])
        bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.02))
        bpy.context.object.data.materials.append(MATERIALS['ground_earth'])
        scene = bpy.context.scene
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = 32
        scene.cycles.use_denoising = True
        world = bpy.data.worlds.new('driftwood_preview_world')
        world.use_nodes = True
        world.node_tree.nodes.get('Background').inputs['Color'].default_value = (.52, .62, .68, 1)
        world.node_tree.nodes.get('Background').inputs['Strength'].default_value = 1.0
        scene.world = world
        bpy.ops.object.light_add(type='AREA', location=(-9, -8, 18))
        key = bpy.context.object
        key.data.energy, key.data.shape, key.data.size = 5200, 'DISK', 11
        key.data.color = (1, .96, .88)
        key.rotation_euler = (Vector((0, 0, 1)) - key.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.ops.object.camera_add(location=(16, -26, 16))
        camera = bpy.context.object
        camera.rotation_euler = (Vector((0, 2.0, 2.2)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.type, camera.data.ortho_scale = 'ORTHO', 28
        scene.camera = camera
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1800, 1100, 100
        scene.view_settings.view_transform = 'AgX'
        path.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'client/assets/driftwood-yard')
    parser.add_argument('--preview', type=pathlib.Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    args.output.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for name in MATERIAL_BINDINGS:
        create_binding_material(name, double_sided=name in ('sail_canvas',))
    for prefix, spec in BUILDINGS.items():
        build_building(prefix, spec)
    build_hull_frame()
    build_timber_stack()
    build_yard_lantern()
    build_sawhorse_bench()
    build_pitch_kettle()
    build_pier_section()
    build_banner_pole()
    build_banner_line()
    build_landing_crates()
    build_driftwood_log()
    build_strand_signpost()
    output = args.output / 'kit.glb'
    export_glb(output)
    manifest = inspect_glb(output)
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'DRIFTWOOD_YARD_OK: {len(PREFABS)} prefabs, {manifest["totalTriangles"]:,} triangles, {manifest["bytes"]:,} bytes')
    if args.preview:
        preview(args.preview.resolve())


if __name__ == '__main__':
    main()
