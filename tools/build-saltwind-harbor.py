"""Build Saltwind Harbor's original, geometry-only environment kit extension.

    blender --background --factory-startup --python-exit-code 1 --python tools/build-saltwind-harbor.py

Named slots borrow Old Watch's original textures at runtime, the same
extension pattern as Windward Farm and Tideglass Market. --output supports
independent byte comparisons; --preview creates an untracked textured contact
sheet after export, without putting preview images into the shipping GLB.

Milestone 4 sample: the harbor's three enterable buildings and its working
waterfront dressing. Each building keeps the shared weathering language
(beveled blocks, vertex wear, metric UVs, stone footings, paired clear doors)
but owns a different siding treatment, trim and roof colour so the settlement
reads as one coastal village rather than three copies of one shed:

  net_house       unpainted salt-grey board-and-batten, tarred trim, green shakes
  tavern          lime-washed cream clapboard, honey oak frame, coral shingles,
                  stone chimney, hanging sign and door lantern
  fisher_cottage  whitewashed shiplap, sea-blue shutters, sun-faded salmon roof
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
SEED = 481203
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
    'tar_timber': {'source': 'aged_timber', 'color': [1.0, .95, .90], 'normalScale': .5},
    'salt_plank': {'source': 'aged_timber', 'color': [5.0, 5.7, 6.5], 'normalScale': .30},
    'shake_roof': {'source': 'dark_slate', 'color': [4.2, 4.8, 4.0], 'normalScale': .40},
    'oak_frame': {'source': 'aged_timber', 'color': [1.9, 1.6, 1.25], 'normalScale': .6},
    'tavern_wash': {'source': 'aged_timber', 'color': [6.4, 5.7, 4.3], 'normalScale': .30},
    'harbor_tile': {'source': 'dark_slate', 'color': [9.5, 2.2, 1.2], 'normalScale': .45},
    'cottage_wash': {'source': 'aged_timber', 'color': [6.2, 6.3, 5.9], 'normalScale': .28},
    'sea_blue': {'source': 'aged_timber', 'color': [1.5, 3.4, 4.6], 'normalScale': .45},
    'faded_tile': {'source': 'dark_slate', 'color': [10.0, 4.2, 3.0], 'normalScale': .45},
    'net_cord': {'source': 'needle_foliage', 'color': [2.4, 1.0, 1.35]},
    'float_cream': {'source': 'ground_earth', 'color': [9.6, 9.1, 7.7]},
    'float_coral': {'source': 'ground_earth', 'color': [9.0, 3.3, 2.2]},
}
# Matches shared/exploration.js structure(): width = radius*1.42, depth = radius*1.18,
# wallHeight = max(3.2, height*.58). The tavern chimney sits at the fallback's
# smoke emitter (-width*.29, -depth*.22) so the retained plume rises from it.
BUILDINGS = {
    'net_house': {'radius': 3.6, 'height': 6.0, 'siding': 'batten', 'wash': 'salt_plank', 'trim': 'tar_timber',
                  'skirt': .78, 'roof': 'shake_roof', 'ridge': 5.85, 'rows': 9, 'hatch': True, 'hoist': True},
    'tavern': {'radius': 4.0, 'height': 7.0, 'siding': 'clapboard', 'wash': 'tavern_wash', 'trim': 'oak_frame',
               'skirt': 1.0, 'roof': 'harbor_tile', 'ridge': 6.55, 'rows': 11, 'chimney': True, 'sign': True, 'lantern': True},
    'fisher_cottage': {'radius': 3.0, 'height': 5.5, 'siding': 'shiplap', 'wash': 'cottage_wash', 'trim': 'sea_blue',
                       'skirt': .70, 'roof': 'faded_tile', 'ridge': 5.28, 'rows': 8, 'shutters': True, 'buoys': True},
}
PROPS = ['drying_net', 'dock_post', 'mending_table', 'fish_crates', 'lobster_pot', 'harbor_lantern']
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


def batten_boards(mesh, start, end, bottom, top, *, fixed, axis, wash, trim, depth=.15):
    """Vertical boards with a narrow tarred batten over every interior seam."""
    count = max(1, round((end - start) / .27))
    spacing = (end - start) / count
    for j in range(count):
        place_block(mesh, start + (j + .5) * spacing, (bottom + top) / 2, fixed, axis, spacing - .008, top - bottom,
                    depth, wash, timber_color(), bevel=.010, skew=RNG.uniform(-.002, .002))
    # Skip the two span edges so a batten never crosses into an adjoining
    # doorway clearance or past the panel's own footprint.
    for j in range(1, count):
        place_block(mesh, start + j * spacing, (bottom + top) / 2, fixed, axis, .028, top - bottom,
                    depth + .012, trim, (.94, .95, .97), bevel=.006)


def shiplap_boards(mesh, start, end, bottom, top, *, fixed, axis, wash, trim, depth=.15):
    """Wide painted vertical boards with a shadow groove, no battens."""
    count = max(1, round((end - start) / .34))
    spacing = (end - start) / count
    for j in range(count):
        place_block(mesh, start + (j + .5) * spacing, (bottom + top) / 2, fixed, axis, spacing - .016, top - bottom,
                    depth, wash, wash_color(), bevel=.014, skew=RNG.uniform(-.0015, .0015))


def clapboards(mesh, start, end, bottom, top, *, fixed, axis, wash, trim, depth=.15):
    """Horizontal lapped boards: each course sits proud of the one above it."""
    rows = max(1, round((top - bottom) / .215))
    pitch = (top - bottom) / rows
    for row in range(rows):
        y = bottom + (row + .5) * pitch
        shade = wash_color()
        # Courses overlap by 2cm except the top one, which must not pass the wall cap.
        place_block(mesh, (start + end) / 2, y, fixed, axis, end - start - .012, pitch + (.02 if row < rows - 1 else 0),
                    depth - .02 + (row % 2) * .012, wash, shade, bevel=0)
        # A thin darker lip under each course reads as the lap shadow line.
        place_block(mesh, (start + end) / 2, bottom + row * pitch + .008, fixed, axis, end - start - .012, .016,
                    depth + .008, wash, (shade[0] * .62, shade[1] * .62, shade[2] * .62), bevel=0)


SIDING = {'batten': batten_boards, 'shiplap': shiplap_boards, 'clapboard': clapboards}


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
        # Open louvred shutters either side, hung slightly ajar on iron pintles.
        for side in (-1, 1):
            z = center_z + side * .77
            mesh.block((x + sign * .075, y, z), (.045, top - bottom + .02, .40), trim, (.92, .95, .98), bevel=.006)
            for k in range(5):
                mesh.block((x + sign * .10, bottom + (k + .5) * (top - bottom) / 5, z), (.012, .05, .34),
                           trim, (.72, .80, .86), bevel=0)
            for yy in (bottom + .12, top - .12):
                mesh.block((x + sign * .06, yy, z - side * .21), (.03, .04, .06), 'forged_iron', bevel=.003)


def build_base(prefix, W, D):
    xwall, zwall = (W - THICKNESS) / 2, (D - THICKNESS) / 2
    base = KitMesh(f'{prefix}_base')
    base.block((0, -.15, 0), (W, .30, D), color=(.82, .85, .80), bevel=.025)
    boards = max(9, round(W / .39))
    for j in range(boards):
        x = (j - (boards - 1) / 2) * (W - .48) / boards
        base.block((x, .004, 0), ((W - .48) / boards - .007, .042, D - .48), 'aged_timber', timber_color(), bevel=.004)
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
        if sign > 0 and spec.get('sign'):
            # Iron bracket and a swinging painted board with a fish outline, kept
            # above the doorway header height and inside the wall envelope in z.
            # Everything hung on the face sits proud of the siding surface (~z+.08).
            arm_y = WH - .20
            mesh.block((-1.95, arm_y, z + .14), (.06, .06, .20), 'forged_iron', bevel=.004)
            mesh.block((-1.95, arm_y - .30, z + .20), (.05, .60, .05), 'forged_iron', bevel=.003)
            mesh.block((-1.95, arm_y - .58, z + .20), (.98, .48, .05), wash, (.96, .93, .82), bevel=.012)
            mesh.block((-1.95, arm_y - .58, z + .20), (1.02, .52, .038), trim, (.72, .60, .45), bevel=.008)
            for j in range(6):
                t = j / 5 - .5
                mesh.block((-1.95 + t * .70, arm_y - .58 + math.sin(t * math.pi) * .06, z + .225),
                           (.13, .09 + .07 * math.cos(t * math.pi), .012), 'sea_blue', (.9, .95, 1.0), bevel=0)
        if sign > 0 and spec.get('lantern'):
            mesh.block((1.75, DOOR_HEIGHT - .55, z + .12), (.05, .05, .16), 'forged_iron', bevel=.003)
            mesh.block((1.75, DOOR_HEIGHT - .66, z + .20), (.16, .22, .13), 'lantern_amber', bevel=.02)
            for yy in (DOOR_HEIGHT - .55, DOOR_HEIGHT - .78):
                mesh.block((1.75, yy, z + .20), (.19, .025, .16), 'forged_iron', bevel=.004)
        if sign > 0 and spec.get('buoys'):
            for j, (dx, tint) in enumerate(((-1.72, 'float_coral'), (-1.55, 'float_cream'))):
                y = DOOR_HEIGHT - .25 - j * .28
                mesh.tube([(dx, y - .12, z + .19), (dx, y + .12, z + .19)], [.085, .085], tint, (.92, .90, .84), sides=8)
                mesh.tube([(dx, y + .14, z + .19), (dx + .02, DOOR_HEIGHT + .05, z + .12)], [.006, .006], 'net_cord', (.8, .76, .68), sides=4)
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
        if spec.get('hatch'):
            hz = z + (THICKNESS / 2 + .002) * (-1 if z < 0 else 1)
            half = .58
            mesh.block((0, eave + 1.05, hz), (half * 2, half * 2, .09), 'recess_shadow', bevel=0)
            for x in (-half - .09, half + .09):
                mesh.block((x, eave + 1.05, hz), (.16, half * 2 + .18, .085), trim, (.89, .90, .92), bevel=.009)
            for y in (eave + 1.05 - half - .09, eave + 1.05 + half + .09):
                mesh.block((0, y, hz), (half * 2 + .18, .16, .085), trim, (.90, .91, .93), bevel=.009)
            for j in range(3):
                mesh.block((0, eave + .62 + j * .43, hz + .005 * (-1 if z < 0 else 1)), (half * 2 - .1, .045, .05),
                           trim, (.87, .88, .90), bevel=.004)
    for sign in (-1, 1):
        prism(mesh, [(sign * reach, eave), (0, ridge - .035), (0, ridge + .018), (sign * reach, eave + .06)],
              -end, end, tile, (.74, .78, .74))
        rows, columns = spec['rows'], 12
        for row in range(rows):
            t0, t1 = row / rows, min(1, (row + 1.16) / rows)
            x0, x1 = sign * reach * (1 - t0), sign * reach * (1 - t1)
            y0, y1 = eave + .06 + (ridge - eave) * t0, eave + .06 + (ridge - eave) * t1
            for col in range(columns):
                jitter = RNG.uniform(-.006, .006)
                z0 = -end + col * 2 * end / columns + .004 + jitter
                z1 = -end + (col + 1) * 2 * end / columns - .004 + jitter
                wear = RNG.uniform(-.008, .007)
                value = RNG.uniform(.78, 1.12)
                mesh.polygon([(x0, y0 + wear, z0), (x1, y1 + wear, z0), (x1, y1 + .026 + wear, z1), (x0, y0 + .026 + wear, z1)],
                             tile, (value * .95, value, value * .93))
        for z in (-end + .03, end - .03):
            mesh.beam((sign * (reach - .05), eave + .05, z), (0, ridge + .01, z), .08, .07, (.31, .29, .27), material=trim)
        mesh.block((sign * (reach - .04), eave + .045, 0), (.07, .085, D + .26), trim, (.30, .28, .26), bevel=.009)
    for j in range(12):
        z = -end + (j + .5) * 2 * end / 12
        mesh.block((0, ridge + .07, z), (.16, .095, 2 * end / 12 - .004), tile, (.98, 1.01, .96), bevel=0)
    if spec.get('hoist'):
        # Hoist beam and pulley ring project from the ridge for hauling net
        # baskets, past the harbor-facing gable only; the roof bounds check allows it.
        mesh.beam((0, ridge - .16, 0), (0, ridge - .06, end + .68), .075, .09, (.31, .28, .25), material=trim)
        mesh.tube([(0, ridge - .12, end + .62), (0, ridge - .24, end + .62)], [.055, .050], 'forged_iron', sides=8)
    if spec.get('chimney'):
        # Fieldstone stack rising through the pitch at the retained smoke emitter.
        cx, cz = -W * .29, -D * .22
        slope_y = eave + (ridge - eave) * (1 - abs(cx) / reach)
        stack_top = H - .10
        for row in range(int((stack_top - slope_y + .55) / .31)):
            y0 = slope_y - .55 + row * .31
            for k, (ox, oz, sx, sz) in enumerate(((0, -.30, .70, .16), (0, .30, .70, .16), (-.27, 0, .16, .44), (.27, 0, .16, .44))):
                jitter = .03 if (row + k) % 2 else -.02
                mesh.block((cx + ox + jitter * (1 if k < 2 else 0), y0 + .155, cz + oz + jitter * (1 if k >= 2 else 0)),
                           (sx - .012, .30, sz - .012), color=stone_color(2), bevel=RNG.uniform(.02, .035))
            mesh.block((cx, y0 + .155, cz), (.52, .30, .38), 'recess_shadow', bevel=0)
        mesh.block((cx, stack_top - .045, cz), (.88, .09, .58), color=(.86, .88, .84), bevel=.02)
        mesh.block((cx, stack_top + .015, cz), (.42, .06, .28), 'recess_shadow', bevel=0)
        assert stack_top + .045 <= H, 'chimney must stay within the building height'
    mesh.finish()


def build_building(prefix, spec):
    W, D, WH, H = dimensions(spec)
    assert spec['ridge'] + .12 <= H, prefix
    build_base(prefix, W, D)
    build_side_walls(prefix, spec, W, D, WH)
    build_end_walls(prefix, spec, W, D, WH)
    build_roof(prefix, spec, W, D, WH, H)


def net_panel(mesh, x0, x1, top, bottom, columns, rows, sag=.07, z=0):
    for c in range(columns + 1):
        x = x0 + c * (x1 - x0) / columns
        upper, lower = Vector((x, top, z)), Vector((x, bottom, z))
        mid = upper.lerp(lower, .55) + Vector((math.sin(c * 1.7) * .05, 0, sag + .02 * math.sin(c * 2.1)))
        mesh.tube([upper, mid, lower], [.010, .009, .008], 'net_cord', (.86, .82, .74), sides=4)
    for r in range(rows + 1):
        t = r / rows
        y = top - t * (top - bottom)
        bow = (sag * .7) + sag * .7 * math.sin(t * math.pi)
        mesh.tube([Vector((x0, y, z + bow * .4)), Vector(((x0 + x1) / 2, y, z + bow)), Vector((x1, y, z + bow * .4))],
                  [.008] * 3, 'net_cord', (.84, .80, .72), sides=4)


def build_drying_net():
    mesh = KitMesh('drying_net')
    span, height = 1.85, 2.05
    for x in (-span / 2, span / 2):
        mesh.beam((x, height / 2, 0), (x, -.05, 0), .075, .09, (.30, .27, .25), material='tar_timber')
    mesh.beam((-span / 2, height, 0), (span / 2, height, 0), .06, .07, (.31, .28, .26), material='tar_timber')
    net_panel(mesh, -span / 2, span / 2, height - .05, .30, 6, 4)
    for j in range(7):
        x = -span / 2 + (j + .5) * span / 7
        radius = .075 + (j % 3) * .012
        y = .30 - radius * .35
        mesh.tube([(x, y - radius * .8, .07), (x, y + radius * .8, .07)], [radius, radius],
                  'float_coral' if j % 2 == 0 else 'float_cream', (.92, .90, .84), sides=8)
        mesh.tube([(x, y + radius * .85, .07), (x, .34, .075)], [.007, .006], 'net_cord', (.80, .76, .68), sides=4)
    mesh.finish()


def build_dock_post():
    mesh = KitMesh('dock_post')
    mesh.tube([(0, -.06, 0), (0, 1.28, 0), (0, 1.55, 0)], [.145, .125, .105], 'tar_timber', (.28, .26, .24), sides=8)
    for angle in (0, math.pi):
        mesh.block((math.sin(angle) * .13, 1.62, math.cos(angle) * .13), (.30, .075, .085), 'forged_iron', bevel=.010, yaw=angle)
    mesh.tube([(0, 1.60, 0), (0, 1.70, 0)], [.07, .05], 'tar_timber', (.30, .28, .26), sides=8)
    mesh.finish()


def slatted_crate(mesh, center, size, material='oak_frame'):
    cx, cy, cz = center
    w, h, d = size
    for sign in (-1, 1):
        for k in range(3):
            y = cy - h / 2 + (k + .5) * h / 3
            mesh.block((cx, y, cz + sign * (d / 2 - .02)), (w, h / 3 - .035, .04), material, timber_color(), bevel=.004)
            mesh.block((cx + sign * (w / 2 - .02), y, cz), (.04, h / 3 - .035, d - .08), material, timber_color(), bevel=.004)
    for sx in (-1, 1):
        for sz in (-1, 1):
            mesh.block((cx + sx * (w / 2 - .03), cy, cz + sz * (d / 2 - .03)), (.05, h, .05), material, (.74, .70, .58), bevel=.006)
    mesh.block((cx, cy - h / 2 + .03, cz), (w - .05, .05, d - .05), 'aged_timber', (.70, .68, .56), bevel=0)
    mesh.block((cx, cy + h / 2 - .03, cz), (w - .05, .05, d - .05), 'aged_timber', (.76, .74, .60), bevel=0)


def rope_coil(mesh, center, radius, turns=3, material='net_cord'):
    cx, cy, cz = center
    for k in range(turns):
        points = [(cx + math.cos(a) * (radius - k * .025), cy + k * .022, cz + math.sin(a) * (radius - k * .025))
                  for a in [i * TAU / 12 for i in range(13)]]
        mesh.tube(points, [.022] * len(points), material, (.82, .76, .66), sides=5)


def build_mending_table():
    mesh = KitMesh('mending_table')
    for x in (-.78, .78):
        for z in (-.36, .36):
            mesh.block((x, .38, z), (.09, .76, .09), 'oak_frame', timber_color(), bevel=.008, skew=.006 * (1 if x > 0 else -1))
        mesh.beam((x, .62, -.46), (x, .62, .46), .07, .06, (.78, .74, .62), material='oak_frame')
    for j in range(5):
        mesh.block((0, .80, (j - 2) * .19), (1.86, .05, .175), 'aged_timber', timber_color(), bevel=.005)
    # A loosely heaped net spills off one end of the table, with a few floats.
    for k in range(9):
        a = k * 2.399
        r = .28 + (k % 3) * .11
        loop = [(math.cos(a + t) * r + .25, .83 + .05 * math.sin(t * 3 + k) + (k % 2) * .035, math.sin(a + t) * r * .55)
                for t in [i * TAU / 10 for i in range(11)]]
        mesh.tube(loop, [.010] * len(loop), 'net_cord', (.85, .80, .70), sides=4)
    net_panel(mesh, .55, 1.05, .78, .12, 3, 3, sag=.10, z=.42)
    for j, tint in enumerate(('float_cream', 'float_coral', 'float_cream')):
        mesh.tube([(.60 + j * .22, .95, -.05 + j * .04), (.60 + j * .22, 1.09, -.05 + j * .04)], [.07, .07], tint, (.92, .90, .84), sides=8)
    # Stool and a bone needle in a small tin.
    mesh.block((-1.25, .42, .0), (.30, .04, .30), 'oak_frame', timber_color(), bevel=.006)
    for x in (-1.36, -1.14):
        for z in (-.11, .11):
            mesh.block((x, .20, z), (.045, .42, .045), 'oak_frame', (.72, .68, .56), bevel=.004)
    mesh.tube([(-.55, .82, .28), (-.55, .96, .28)], [.06, .06], 'forged_iron', sides=8)
    mesh.finish()


def build_fish_crates():
    mesh = KitMesh('fish_crates')
    slatted_crate(mesh, (-.38, .31, .05), (.72, .56, .56))
    slatted_crate(mesh, (.36, .31, -.10), (.72, .56, .56))
    slatted_crate(mesh, (-.02, .89, -.02), (.68, .54, .54))
    # Barrel: staves as a faceted tube with iron hoops and a plank lid.
    mesh.tube([(.72, 0, .50), (.72, .50, .50), (.72, .96, .50)], [.30, .34, .29], 'aged_timber', (.84, .82, .66), sides=10)
    for y in (.16, .78):
        mesh.tube([(.72, y - .03, .50), (.72, y + .03, .50)], [.35, .35], 'forged_iron', sides=10)
    mesh.block((.72, .975, .50), (.48, .035, .48), 'aged_timber', (.80, .78, .64), bevel=.004)
    rope_coil(mesh, (-.62, .03, .70), .24)
    rope_coil(mesh, (.34, .60, -.12), .16, turns=2)
    mesh.finish()


def build_lobster_pot():
    mesh = KitMesh('lobster_pot')
    width, length, height = .66, .90, .44
    for x in (-length / 2, length / 2):
        mesh.beam((x, .02, -width / 2), (x, .02, width / 2), .035, .028, (.74, .70, .58), material='oak_frame')
    for z in (-width / 2, width / 2):
        mesh.beam((-length / 2, .02, z), (length / 2, .02, z), .035, .028, (.74, .70, .58), material='oak_frame')
    for k in range(5):
        x = -length / 2 + k * length / 4
        arch = [(x, .03 + height * math.sin(t * math.pi), -width / 2 + t * width) for t in [i / 8 for i in range(9)]]
        mesh.tube(arch, [.014] * len(arch), 'oak_frame', (.70, .66, .54), sides=4)
    for t in [i / 6 for i in range(1, 6)]:
        y = .03 + height * math.sin(t * math.pi)
        z = -width / 2 + t * width
        mesh.tube([(-length / 2, y, z), (length / 2, y, z)], [.006, .006], 'net_cord', (.86, .82, .74), sides=3)
    for k in range(4):
        x = -length / 2 + (k + .5) * length / 4
        strand = [(x, .03 + height * math.sin(t * math.pi), -width / 2 + t * width) for t in [i / 8 for i in range(9)]]
        mesh.tube(strand, [.005] * len(strand), 'net_cord', (.84, .80, .72), sides=3)
    mesh.tube([(0, .05, 0), (0, .34, 0)], [.02, .02], 'forged_iron', sides=5)
    mesh.finish()


def build_harbor_lantern():
    mesh = KitMesh('harbor_lantern')
    mesh.tube([(0, -.05, 0), (0, 2.45, 0)], [.062, .05], 'tar_timber', (.30, .28, .26), sides=7)
    mesh.block((0, 2.48, .14), (.04, .04, .32), 'forged_iron', bevel=.003)
    mesh.block((0, 2.18, .30), (.04, .60, .04), 'forged_iron', bevel=.003)
    for y in (1.86, 2.16):
        mesh.block((0, y, .30), (.26, .03, .26), 'forged_iron', bevel=.004)
    mesh.block((0, 2.01, .30), (.20, .28, .20), 'lantern_amber', bevel=.03)
    mesh.block((0, 2.24, .30), (.14, .13, .14), 'forged_iron', bevel=.02)
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
    assert not gltf.get('images') and not gltf.get('textures'), 'Saltwind kit must not duplicate shared textures'
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
    tavern_w, tavern_d, _, tavern_h = dimensions(BUILDINGS['tavern'])
    contracts['tavern']['chimney'] = [-tavern_w * .29, tavern_h - .10, -tavern_d * .22]
    manifest = {
        'schemaVersion': 1, 'generator': 'tools/build-saltwind-harbor.py', 'seed': SEED,
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
                # The net-house hoist beam deliberately projects past the harbor-facing gable.
                extra = .70 if BUILDINGS[prefix].get('hoist') else 0
                assert low[0] >= -(W + .35) / 2 and high[0] <= (W + .35) / 2, (name, low, high)
                assert low[2] >= -(D + .35) / 2 and high[2] <= (D + .35) / 2 + extra, (name, low, high)
                assert low[1] >= WH - .001 and high[1] <= H, (name, low, high)
        elif name == 'drying_net':
            assert prefab['horizontalRadius'] <= 1.4 and low[1] >= -.06 and high[1] <= 2.35, (name, low, high)
        elif name == 'dock_post':
            assert prefab['horizontalRadius'] <= .30 and low[1] >= -.07 and high[1] <= 1.85, (name, low, high)
        elif name == 'mending_table':
            assert prefab['horizontalRadius'] <= 1.6 and low[1] >= -.02 and high[1] <= 1.3, (name, low, high)
        elif name == 'fish_crates':
            assert prefab['horizontalRadius'] <= 1.3 and low[1] >= -.02 and high[1] <= 1.4, (name, low, high)
        elif name == 'lobster_pot':
            assert prefab['horizontalRadius'] <= .6 and low[1] >= -.02 and high[1] <= .55, (name, low, high)
        elif name == 'harbor_lantern':
            assert prefab['horizontalRadius'] <= .5 and low[1] >= -.06 and high[1] <= 2.7, (name, low, high)
    manifest['totalTriangles'] = sum(p['triangles'] for p in manifest['prefabs'].values())
    manifest['totalPrimitives'] = sum(p['primitives'] for p in manifest['prefabs'].values())
    assert manifest['bytes'] < 3.5 * 1024 * 1024, manifest['bytes']
    assert manifest['totalTriangles'] < 42000, manifest['totalTriangles']
    return manifest


def preview(path):
    loader = importlib.util.spec_from_file_location('old_watch_preview', ROOT / 'tools/build-old-watch.py')
    old_watch = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(old_watch)
    with tempfile.TemporaryDirectory(prefix='skywake-saltwind-preview-') as temporary:
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
        positions = {'net_house': (-7.5, 0, 0), 'tavern': (0.5, 0, 0), 'fisher_cottage': (7.5, 0, 0),
                     'drying_net': (-9.5, 0, 5.4), 'dock_post': (-5.8, 0, 5.2), 'mending_table': (-2.6, 0, 5.4),
                     'fish_crates': (1.2, 0, 5.4), 'lobster_pot': (4.0, 0, 5.4), 'harbor_lantern': (6.2, 0, 5.2)}
        for name, root in PREFABS.items():
            prefix = next((p for p in BUILDINGS if name.startswith(p + '_')), name)
            root.location = game_to_blender(positions[prefix])
        bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.02))
        bpy.context.object.data.materials.append(MATERIALS['ground_earth'])
        scene = bpy.context.scene
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = 32
        scene.cycles.use_denoising = True
        world = bpy.data.worlds.new('saltwind_preview_world')
        world.use_nodes = True
        world.node_tree.nodes.get('Background').inputs['Color'].default_value = (.46, .56, .64, 1)
        world.node_tree.nodes.get('Background').inputs['Strength'].default_value = .9
        scene.world = world
        bpy.ops.object.light_add(type='AREA', location=(-9, -8, 18))
        key = bpy.context.object
        key.data.energy, key.data.shape, key.data.size = 5200, 'DISK', 11
        key.data.color = (1, .96, .88)
        key.rotation_euler = (Vector((0, 0, 1)) - key.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.ops.object.camera_add(location=(14, -24, 15))
        camera = bpy.context.object
        camera.rotation_euler = (Vector((0, 1.5, 2.2)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.type, camera.data.ortho_scale = 'ORTHO', 24
        scene.camera = camera
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1800, 1100, 100
        scene.view_settings.view_transform = 'AgX'
        path.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'client/assets/saltwind-harbor')
    parser.add_argument('--preview', type=pathlib.Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    args.output.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for name in MATERIAL_BINDINGS:
        create_binding_material(name, double_sided=name in ('net_cord',))
    for prefix, spec in BUILDINGS.items():
        build_building(prefix, spec)
    build_drying_net()
    build_dock_post()
    build_mending_table()
    build_fish_crates()
    build_lobster_pot()
    build_harbor_lantern()
    output = args.output / 'kit.glb'
    export_glb(output)
    manifest = inspect_glb(output)
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'SALTWIND_HARBOR_OK: {len(PREFABS)} prefabs, {manifest["totalTriangles"]:,} triangles, {manifest["bytes"]:,} bytes')
    if args.preview:
        preview(args.preview.resolve())


if __name__ == '__main__':
    main()
