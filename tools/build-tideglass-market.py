"""Build Tideglass Market's original, deterministic geometry-only environment kit.

    blender --background --factory-startup --python-exit-code 1 --python tools/build-tideglass-market.py

Named slots borrow Old Watch's original textures at runtime. --output supports
independent byte comparisons; --preview creates an untracked textured contact
sheet after export, without putting preview images into the shipping GLB.
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
SEED = 925713
RNG = random.Random(SEED)
TAU = math.tau
WIDTH, DEPTH, WALL_HEIGHT, HEIGHT, THICKNESS = 4.544, 3.776, 3.20, 5.50, .24
DOOR_WIDTH, DOOR_HEIGHT = 2.30, 2.80
MATERIAL_BINDINGS = {
    'watch_stone': {'source': 'watch_stone'},
    'aged_timber': {'source': 'aged_timber', 'color': [1.85, 1.85, 1.85]},
    'forged_iron': {'source': 'forged_iron'},
    'recess_shadow': {'source': 'recess_shadow'},
    'haven_plaster': {'source': 'watch_stone', 'color': [6.2, 6, 5], 'normalScale': .28},
    'harbor_teal': {'source': 'dark_slate', 'color': [1.25, 3.1, 2.5]},
    'canvas_cream': {'source': 'ground_earth', 'color': [10, 10, 12], 'normalScale': .18},
    'canvas_coral': {'source': 'ground_earth', 'color': [9, 3.8, 3.5], 'normalScale': .18},
    'canvas_teal': {'source': 'ground_earth', 'color': [2.6, 7, 10], 'normalScale': .18},
    'coastal_leaf': {'source': 'needle_foliage', 'color': [1.1, 1.4, .9]},
    'produce_gold': {'source': 'needle_foliage', 'color': [4.1, 2.1, .38]},
    'produce_coral': {'source': 'needle_foliage', 'color': [4.1, .85, .45]},
}
EXPECTED = ['cottage_base', 'cottage_wall_east', 'cottage_wall_west',
            'cottage_wall_front', 'cottage_wall_back', 'cottage_roof',
            'fruit_stall', 'sailcloth_stall', 'haven_hut', 'paving_slab', 'coastal_shrub']


def stone_color(y):
    shade = RNG.uniform(.78, 1.02)
    moss = .16 if y < .65 and RNG.random() < .45 else .025
    return (shade * (1 - moss), shade * (1 - moss * .25), shade * (1 - moss * 1.25))


def timber_color():
    shade = RNG.uniform(.79, 1.03)
    return (shade, shade * .94, shade * .82)


def solid(mesh, vertices, faces, material, color=(1, 1, 1)):
    """Convex original solids, oriented from their centroid in game space."""
    center = sum((Vector(p) for p in vertices), Vector()) / len(vertices)
    for indices in faces:
        points = [Vector(vertices[i]) for i in indices]
        normal = (points[1] - points[0]).cross(points[2] - points[0])
        if normal.dot(sum(points, Vector()) / len(points) - center) < 0:
            points.reverse()
        mesh.polygon(points, material, color)


def prism(mesh, profile, low_z, high_z, material, color=(1, 1, 1)):
    """Extrude an XY convex profile along Z, including both sealed end faces."""
    count = len(profile)
    vertices = [(x, y, z) for z in (low_z, high_z) for x, y in profile]
    faces = [list(range(count)), list(range(count, count * 2))]
    faces += [[j, (j + 1) % count, (j + 1) % count + count, j + count] for j in range(count)]
    solid(mesh, vertices, faces, material, color)


def stone_span(mesh, start, end, bottom, top, fixed, axis='x', depth=.24):
    rows = max(1, round((top - bottom) / .31))
    for row in range(rows):
        y0, y1 = bottom + (top - bottom) * row / rows, bottom + (top - bottom) * (row + 1) / rows
        count = max(1, round((end - start) / .59))
        edges = [start] + [start + (end - start) * (j + (.17 if row % 2 else -.11)) / count
                           for j in range(1, count)] + [end]
        for stone, (a, b) in enumerate(zip(edges, edges[1:])):
            center = ((a + b) / 2, (y0 + y1) / 2, fixed) if axis == 'x' else (fixed, (y0 + y1) / 2, (a + b) / 2)
            size = (b - a - .012, y1 - y0 - .009, depth) if axis == 'x' else (depth, y1 - y0 - .009, b - a - .012)
            # Large worn stones carry the silhouette; inset plain stones keep
            # the masonry economical without repeating every bevel everywhere.
            bevel = RNG.uniform(.020, .033) if (stone + row) % 4 == 0 else 0
            mesh.block(center, size, color=stone_color(y0), bevel=bevel)


def plaster_span(mesh, start, end, bottom, top, fixed, axis='x', depth=.18):
    center = ((start + end) / 2, (bottom + top) / 2, fixed) if axis == 'x' else (fixed, (bottom + top) / 2, (start + end) / 2)
    size = (end - start, top - bottom, depth) if axis == 'x' else (depth, top - bottom, end - start)
    mesh.block(center, size, 'haven_plaster', (.98, .98, .94), bevel=.009)


def side_window(mesh, x, center_z, sign, bottom=1.42, top=2.42):
    # The wall core is omitted here: the dark inset actually sits behind the
    # outer timber/shutter planes. All details stay inside the collider wall.
    y = (bottom + top) / 2
    mesh.block((x, y, center_z), (.095, top - bottom, .90), 'recess_shadow', bevel=0)
    for z in (center_z - .49, center_z + .49):
        mesh.block((x, y, z), (.24, top - bottom + .15, .10), 'aged_timber', timber_color(), bevel=.010)
    for yy in (bottom - .04, top + .04):
        mesh.block((x, yy, center_z), (.24, .10, 1.07), 'aged_timber', timber_color(), bevel=.010)
    for j in range(6):
        z = center_z + (j - 2.5) * .136
        mesh.block((x + sign * .073, y, z), (.052, top - bottom - .06, .126),
                   'harbor_teal', (.78 + RNG.random() * .14, .92, .86), bevel=.006)
    for yy in (bottom + .18, top - .18):
        mesh.block((x + sign * .103, yy, center_z), (.024, .055, .83), 'aged_timber', (.73, .75, .66), bevel=.003)
    mesh.block((x + sign * .106, y, center_z), (.025, .045, .10), 'forged_iron', bevel=.004)


def roof(mesh, width, depth, eave, ridge, rows=8, columns=11):
    """A sealed gable shell with overlapping tiles, fascia, and worn ridge caps."""
    reach, end = width / 2 + .13, depth / 2 + .13
    wall_z = depth / 2 - THICKNESS / 2
    for z in (-wall_z, wall_z):
        prism(mesh, [(-width / 2, eave), (width / 2, eave), (0, ridge - .055)],
              z - .075, z + .075, 'haven_plaster', (.92, .94, .89))
        for sign in (-1, 1):
            mesh.beam((sign * (width / 2 - .08), eave + .055, z), (0, ridge - .10, z),
                      .11, .13, (.69, .70, .61))
        mesh.beam((0, eave + .02, z), (0, ridge - .12, z), .12, .13, (.72, .73, .64))
    for sign in (-1, 1):
        # Underlay and tile courses are complete solids. Their joined edge
        # extends to the wall top, closing the roof from inside and underneath.
        profile = [(sign * reach, eave), (0, ridge - .04), (0, ridge + .015), (sign * reach, eave + .065)]
        prism(mesh, profile, -end, end, 'harbor_teal', (.72, .78, .76))
        for row in range(rows):
            t0, t1 = row / rows, min(1, (row + 1.14) / rows)
            x0, x1 = sign * reach * (1 - t0), sign * reach * (1 - t1)
            y0, y1 = eave + .056 + (ridge - eave) * t0, eave + .056 + (ridge - eave) * t1
            for col in range(columns):
                z0 = -end + col * 2 * end / columns + .003
                z1 = -end + (col + 1) * 2 * end / columns - .003
                wear = RNG.uniform(-.006, .006)
                value = RNG.uniform(.81, 1.10)
                prism(mesh, [(x0, y0 + wear), (x1, y1 + wear), (x1, y1 + .024 + wear), (x0, y0 + .024 + wear)],
                      z0, z1, 'harbor_teal', (value * .96, value, value * .96))
        for z in (-end + .03, end - .03):
            mesh.beam((sign * (reach - .055), eave + .055, z), (0, ridge + .009, z),
                      .085, .075, (.74, .75, .66))
        mesh.block((sign * (reach - .045), eave + .050, 0), (.075, .09, depth + .25),
                   'aged_timber', (.72, .74, .65), bevel=.01)
    for j in range(columns):
        z = -end + (j + .5) * 2 * end / columns
        mesh.block((0, ridge + .071, z), (.17, .10, 2 * end / columns - .003),
                   'harbor_teal', (.99, 1.02, .96), bevel=0)


def build_cottage():
    xwall, zwall = (WIDTH - THICKNESS) / 2, (DEPTH - THICKNESS) / 2
    base = KitMesh('cottage_base')
    base.block((0, -.15, 0), (WIDTH, .30, DEPTH), color=(.81, .85, .77), bevel=.02)
    for j in range(13):
        x = (j - 6) * (WIDTH - .48) / 13
        base.block((x, .004, 0), ((WIDTH - .48) / 13 - .007, .042, DEPTH - .48),
                   'aged_timber', timber_color(), bevel=.004)
    for sign in (-1, 1):
        # Continuous recessed mortar backs the jointed stonework, meets the
        # removable walls at .48, and never crosses either clear doorway.
        base.block((sign * xwall, .2525, 0), (.18, .455, DEPTH), color=(.70, .77, .67), bevel=0)
        stone_span(base, -DEPTH / 2, DEPTH / 2, .025, .48, sign * xwall, axis='z')
        for a, b in ((-WIDTH / 2 + .24, -1.15), (1.15, WIDTH / 2 - .24)):
            base.block(((a + b) / 2, .2525, sign * zwall), (b - a, .455, .18), color=(.70, .77, .67), bevel=0)
            stone_span(base, a, b, .025, .48, sign * zwall)
    base.finish()
    for sign, name in ((1, 'east'), (-1, 'west')):
        mesh = KitMesh('cottage_wall_' + name)
        x = sign * xwall
        for a, b in ((-DEPTH / 2, -.54), (.54, DEPTH / 2)):
            plaster_span(mesh, a, b, .48, 3.15, x, axis='z')
        plaster_span(mesh, -.54, .54, .48, 1.42, x, axis='z')
        plaster_span(mesh, -.54, .54, 2.42, 3.15, x, axis='z')
        side_window(mesh, x, 0, sign)
        for z in (-zwall, zwall):
            mesh.block((x, 1.825, z), (.24, 2.69, .16), 'aged_timber', timber_color(), bevel=.013)
        for y in (.57, 3.12):
            mesh.block((x, y, 0), (.24, .16, DEPTH), 'aged_timber', (.75, .76, .66), bevel=.012)
        for a, b in ((-1.70, -.64), (.64, 1.70)):
            mesh.beam((x + sign * .056, .67, a), (x + sign * .056, 1.37, b), .087, .10, (.75, .76, .66))
        # Sparse exposed stones through the limewash make wear irregular,
        # avoiding a repetitive solid stripe around the building.
        for j, z in enumerate((-.99, -1.31, 1.26, 1.49)):
            mesh.block((x + sign * .073, .80 + (j % 2) * .24, z), (.08, .20, .31),
                       color=stone_color(.6), bevel=.015)
        mesh.finish()
    for sign, name in ((1, 'front'), (-1, 'back')):
        mesh = KitMesh('cottage_wall_' + name)
        z = sign * zwall
        for a, b in ((-WIDTH / 2 + .24, -1.15), (1.15, WIDTH / 2 - .24)):
            plaster_span(mesh, a, b, .48, 3.12, z)
            stone_span(mesh, a, b, .48, .76, z)
        for x in (-1.225, 1.225):
            mesh.block((x, 1.64, z), (.15, 2.32, .24), 'aged_timber', (.73, .73, .63), bevel=.010)
        mesh.block((0, 3.0, z), (WIDTH - .48, .40, .24), 'aged_timber', (.74, .75, .65), bevel=.012)
        for x in (-1.67, 1.67):
            mesh.block((x, 2.98, z + sign * .108), (.30, .08, .022), 'forged_iron', bevel=.004)
        mesh.finish()
    mesh = KitMesh('cottage_roof')
    roof(mesh, WIDTH, DEPTH, 3.20, 5.37)
    mesh.finish()


def ellipsoid(mesh, center, scale, material, color):
    # Two poles and four eight-sided rings: legible round stock for 64 triangles.
    rings = []
    for j in range(1, 5):
        phi = math.pi * j / 5
        rings.append([(center[0] + math.cos(k * TAU / 8) * math.sin(phi) * scale[0],
                       center[1] + math.cos(phi) * scale[1],
                       center[2] + math.sin(k * TAU / 8) * math.sin(phi) * scale[2]) for k in range(8)])
    for k in range(8):
        nxt = (k + 1) % 8
        # Orient the convex patches from the fruit center, as for other solids.
        for points in (([center[0], center[1] + scale[1], center[2]], rings[0][k], rings[0][nxt]),
                       (rings[-1][nxt], rings[-1][k], [center[0], center[1] - scale[1], center[2]])):
            pp = [Vector(p) for p in points]
            if (pp[1] - pp[0]).cross(pp[2] - pp[0]).dot(sum(pp, Vector()) / 3 - Vector(center)) < 0:
                pp.reverse()
            mesh.polygon(pp, material, color, smooth=True)
        for row in range(3):
            pp = [Vector(p) for p in (rings[row][k], rings[row + 1][k], rings[row + 1][nxt], rings[row][nxt])]
            if (pp[1] - pp[0]).cross(pp[2] - pp[0]).dot(sum(pp, Vector()) / 4 - Vector(center)) < 0:
                pp.reverse()
            mesh.polygon(pp, material, color, smooth=True)


def canopy(mesh, accent):
    reach, end, stripes, rows = 1.84, 1.29, 10, 6
    def point(x, z, thickness=0):
        # Transverse drape and a gently arched central seam. All corners are
        # tied to posts, and the front valance hangs in small rounded scallops.
        return (x, 3.22 + .22 * (1 - (z / end) ** 2) - .16 * (1 - (x / reach) ** 2) + thickness, z)
    for stripe in range(stripes):
        a, b = -reach + stripe * 2 * reach / stripes, -reach + (stripe + 1) * 2 * reach / stripes
        material = accent if stripe % 2 else 'canvas_cream'
        tint = (.95 + RNG.random() * .04, .97, .91)
        for row in range(rows):
            z0, z1 = -end + row * 2 * end / rows, -end + (row + 1) * 2 * end / rows
            pts = [point(a, z0), point(a, z1), point(b, z1), point(b, z0)]
            mesh.polygon(pts, material, tint)
            mesh.polygon(list(reversed([point(a, z0, -.014), point(a, z1, -.014), point(b, z1, -.014), point(b, z0, -.014)])),
                         material, (.85, .88, .82))
        for sign in (-1, 1):
            for part in range(4):
                x0, x1 = a + (b - a) * part / 4, a + (b - a) * (part + 1) / 4
                top0, top1 = point(x0, sign * end), point(x1, sign * end)
                drop0 = .105 + .115 * math.sin(math.pi * part / 4)
                drop1 = .105 + .115 * math.sin(math.pi * (part + 1) / 4)
                pts = [top0, (x0, top0[1] - drop0, sign * end), (x1, top1[1] - drop1, sign * end), top1]
                if sign < 0:
                    pts.reverse()
                mesh.polygon(pts, material, tint)
                mesh.polygon(list(reversed(pts)), material, (.88, .90, .84))
        if stripe:
            seam = [point(a, -end + row * 2 * end / rows, .007) for row in range(rows + 1)]
            mesh.tube(seam, [.007] * len(seam), 'canvas_cream', (.80, .82, .74), sides=4)
    for x in (-1.59, 1.59):
        for z in (-1.0, 1.0):
            mesh.block((x, 1.36, z), (.13, 3.72, .13), 'aged_timber', timber_color(), bevel=.014)
            mesh.tube([(x, 2.97, z), (math.copysign(reach, x), 3.22, math.copysign(end, z))], [.016, .016],
                      'canvas_cream', (.75, .79, .70), sides=5)
            for yy in (3.0, 3.06):
                mesh.block((x, yy, z), (.157, .027, .157), 'canvas_cream', (.84, .87, .78), bevel=.008)
    for z in (-1.0, 1.0):
        mesh.beam((-1.65, 2.98, z), (1.65, 2.98, z), .10, .11, (.73, .76, .65))


def cabinet(mesh):
    mesh.block((0, -.22, 0), (3.11, .56, 2.15), color=(.73, .80, .68), bevel=.035)
    # Continuous dark core closes the cabinet behind its separated worn boards.
    mesh.block((0, .86, 0), (3.07, 1.74, 2.12), 'aged_timber', (.65, .68, .57), bevel=0)
    for sign in (-1, 1):
        for j in range(11):
            mesh.block(((j - 5) * .276, .86, sign * 1.062), (.266, 1.69, .08),
                       'aged_timber', timber_color(), bevel=0)
        for y in (.14, 1.52):
            mesh.block((0, y, sign * 1.087), (3.08, .105, .07), 'aged_timber', (.74, .77, .65), bevel=.010)
        mesh.block((0, .90, sign * 1.12), (.16, .11, .035), 'forged_iron', bevel=.006)
    for j in range(8):
        mesh.block((0, 1.74, (j - 3.5) * .278), (3.22, .105, .267), 'aged_timber', timber_color(), bevel=0)


def build_stalls():
    for fruit, name, accent in ((True, 'fruit_stall', 'canvas_coral'), (False, 'sailcloth_stall', 'canvas_teal')):
        mesh = KitMesh(name)
        cabinet(mesh)
        canopy(mesh, accent)
        if fruit:
            for side in (-1, 1):
                center = side * .77
                for x in (center - .64, center + .64):
                    mesh.block((x, 1.92, .0), (.07, .24, 1.80), 'aged_timber', (.82, .84, .70), bevel=.009)
                for z in (-.87, .87):
                    mesh.block((center, 1.92, z), (1.32, .24, .07), 'aged_timber', (.83, .84, .72), bevel=.009)
                for row in range(3):
                    for j in range(4):
                        x = center + (j - 1.5) * .265 + RNG.uniform(-.024, .024)
                        z = (row - 1) * .48 + RNG.uniform(-.03, .03)
                        radius = RNG.uniform(.125, .159)
                        y = 1.89 + RNG.uniform(0, .09)
                        material = 'produce_gold' if side < 0 else 'produce_coral'
                        ellipsoid(mesh, (x, y, z), (radius, radius * (1.20 if side < 0 else .92), radius),
                                  material, (RNG.uniform(.85, 1.0), .94, .88))
                        mesh.tube([(x, y + radius * .89, z), (x + .012, y + radius * 1.28, z + .015)],
                                  [.008, .006], 'aged_timber', (.67, .70, .55), sides=4)
        else:
            for j in range(7):
                x = -.91 + (j % 4) * .43
                y = 1.97 + (j // 4) * .31
                z0, z1 = -.65 + .09 * (j % 3), .72 + .07 * (j % 2)
                radius = .176 if j < 4 else .156
                material = 'canvas_cream' if j % 3 == 0 else 'canvas_teal'
                mesh.tube([(x, y, z0), (x, y, z1)], [radius, radius], material, (.98, .98, .93), sides=10)
                for z in (z0 + .18, z1 - .18):
                    mesh.tube([(x, y, z - .018), (x, y, z + .018)], [radius + .006] * 2,
                              'canvas_cream', (.84, .88, .79), sides=10)
                points = []
                for k in range(17):
                    a, r = k / 16 * TAU * 1.8, radius * (.90 - k / 16 * .74)
                    points.append((x + math.cos(a) * r, y + math.sin(a) * r, z1 + .009))
                mesh.tube(points, [.007] * len(points), 'aged_timber', (.59, .67, .57), sides=3)
            for j in range(4):
                mesh.block((1.14, 1.85 + j * .106, .05), (.57, .104, 1.12 - j * .045),
                           'canvas_cream' if j % 2 else 'canvas_teal', (.95, .98, .90), bevel=.018)
        mesh.finish()


def build_hut():
    mesh = KitMesh('haven_hut')
    width, depth, wall = 4.10, 3.75, 3.02
    xwall, zwall = (width - .24) / 2, (depth - .24) / 2
    mesh.block((0, -.215, 0), (width, .57, depth), color=(.80, .84, .73), bevel=.026)
    mesh.block((0, 1.51, 0), (width - .07, 2.90, depth - .07), 'haven_plaster', (.97, .98, .93), bevel=.018)
    for sign in (-1, 1):
        stone_span(mesh, -depth / 2, depth / 2, -.30, .67, sign * xwall, axis='z')
        stone_span(mesh, -width / 2 + .24, width / 2 - .24, -.30, .67, sign * zwall)
        for z in (-zwall, zwall):
            mesh.block((sign * xwall, 1.58, z), (.24, 2.87, .24), 'aged_timber', timber_color(), bevel=.016)
        mesh.block((sign * xwall, wall - .075, 0), (.24, .15, depth), 'aged_timber', (.77, .78, .67), bevel=.011)
        # Broad closed teal shutters retain a clear domestic silhouette.
        side_window(mesh, sign * xwall, -.14, sign, 1.40, 2.31)
    for sign in (-1, 1):
        mesh.block((0, wall - .075, sign * zwall), (width - .24, .15, .24), 'aged_timber', (.75, .76, .65), bevel=.011)
    z = depth / 2 + .004
    mesh.block((0, 1.22, z - .042), (1.18, 2.35, .12), 'recess_shadow', bevel=.01)
    for j in range(7):
        mesh.block(((j - 3) * .151, 1.18, z + .038), (.141, 2.19, .077),
                   'aged_timber', timber_color(), bevel=.009)
    for x in (-.64, .64):
        mesh.block((x, 1.23, z - .012), (.18, 2.46, .19), 'aged_timber', (.69, .72, .61), bevel=.015)
    mesh.block((0, 2.41, z - .012), (1.46, .18, .19), 'aged_timber', (.74, .76, .64), bevel=.015)
    for y in (.43, 1.82):
        mesh.block((0, y, z + .081), (1.03, .065, .026), 'forged_iron', bevel=.004)
    mesh.tube([(.35, 1.05, z + .098), (.35, 1.19, z + .098)], [.020, .020], 'forged_iron', sides=6)
    # The closed hut's end gables and complete roof share cottage materials.
    roof(mesh, width, depth, wall, 4.72, rows=7, columns=10)
    mesh.finish()


def leaf(mesh, origin, angle, length, width, rise, tint):
    direction = Vector((math.cos(angle), rise, math.sin(angle))).normalized()
    sideways = Vector((-math.sin(angle), 0, math.cos(angle)))
    rows = []
    for j in range(5):
        t = j / 4
        point = Vector(origin) + direction * length * t + Vector((0, math.sin(t * math.pi) * .045, 0))
        spread = sideways * width * math.sin(t * math.pi)
        rows.append((point - spread, point + Vector((0, .012, 0)), point + spread))
    for j in range(4):
        for k in range(2):
            mesh.polygon((rows[j][k], rows[j + 1][k], rows[j + 1][k + 1], rows[j][k + 1]),
                         'coastal_leaf', tint,
                         ((k / 2, j / 4), (k / 2, (j + 1) / 4), ((k + 1) / 2, (j + 1) / 4), ((k + 1) / 2, j / 4)))


def build_ground_props():
    paving = KitMesh('paving_slab')
    # A convex eight-sided worn slab is 28 source triangles, compared with
    # hundreds for the shared boulders. It is closed, outward and walkable.
    outline = [(-.37, -.19), (-.22, -.33), (.22, -.31), (.39, -.13),
               (.38, .16), (.16, .31), (-.25, .30), (-.40, .11)]
    vertices = [(x * scale, y, z * scale) for y, scale in ((-.03, .94), (.022, 1.0)) for x, z in outline]
    solid(paving, vertices, [list(range(8)), list(range(8, 16))] +
          [[j, (j + 1) % 8, (j + 1) % 8 + 8, j + 8] for j in range(8)],
          'watch_stone', (.99, 1.02, .92))
    paving.finish()
    shrub = KitMesh('coastal_shrub')
    # Sixteen broad, cupped leaves form a low salt-tolerant shrub; stems borrow
    # the foliage material so every instance uses exactly one draw primitive.
    for j in range(16):
        angle = j * 2.399
        h = .065 + (j % 4) * .074
        start = (math.cos(angle) * .055, h, math.sin(angle) * .055)
        end = (start[0] * 1.3, h + .12, start[2] * 1.3)
        tint = (RNG.uniform(.77, 1.0), RNG.uniform(.87, 1.0), .79)
        shrub.tube([(0, 0, 0), start, end], [.009, .007, .004], 'coastal_leaf', (.68, .77, .61), sides=4)
        leaf(shrub, end, angle, .29 if j < 10 else .23, .077, .48, tint)
    shrub.finish()


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
    assert not gltf.get('images') and not gltf.get('textures'), 'No duplicated shared images'
    assert all('uri' not in buffer for buffer in gltf['buffers'])
    assert {mat['name'] for mat in gltf['materials']} == set(MATERIAL_BINDINGS)
    shared = json.loads((ROOT / 'client/assets/old-watch/manifest.json').read_text())
    assert hashlib.sha256((ROOT / 'client/assets/old-watch/kit.glb').read_bytes()).hexdigest() == shared['sha256']
    manifest = {
        'schemaVersion': 1, 'generator': 'tools/build-tideglass-market.py', 'seed': SEED,
        'blenderVersion': bpy.app.version_string, 'coordinateSystem': 'Y-up, meters, +Z front',
        'sourceLicense': 'Original Skywake Isles project assets; see CREDITS.md',
        'file': 'kit.glb', 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
        'dependencies': [{'url': '/assets/old-watch/kit.glb', 'sha256': shared['sha256'],
                          'ownership': 'Shared cache owns original material textures and reusable props'}],
        'materialBindings': MATERIAL_BINDINGS, 'prefabs': {}, 'textures': [],
        'embeddedImageCount': 0, 'decodedTextureBytes': 0,
        'cottageContract': {'width': WIDTH, 'depth': DEPTH, 'wallHeight': WALL_HEIGHT, 'height': HEIGHT,
                            'thickness': THICKNESS, 'doorWidth': DOOR_WIDTH, 'doorHeight': DOOR_HEIGHT,
                            'baseTop': .48, 'floorTop': .025},
    }
    def values(index):
        accessor = gltf['accessors'][index]
        view = gltf['bufferViews'][accessor['bufferView']]
        dtype = {5121: '<u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[accessor['componentType']]
        size = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[accessor['type']]
        assert view.get('byteStride', np.dtype(dtype).itemsize * size) == np.dtype(dtype).itemsize * size
        offset = bin_start + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        return np.frombuffer(raw, dtype=dtype, count=accessor['count'] * size, offset=offset).reshape((-1, size))
    def triangle_hits_box(triangle, low, high):
        # Clip the whole triangle against an open doorway prism. Vertex-only
        # checks would miss a wide threshold/header spanning across the opening.
        polygon = [p.copy() for p in triangle]
        for axis in range(3):
            for bound, sign in ((low[axis], 1), (high[axis], -1)):
                result = []
                for i, a in enumerate(polygon):
                    b = polygon[(i + 1) % len(polygon)]
                    da, db = (a[axis] - bound) * sign, (b[axis] - bound) * sign
                    if da >= 0:
                        result.append(a)
                    if (da >= 0) != (db >= 0):
                        result.append(a + (b - a) * da / (da - db))
                polygon = result
                if not polygon:
                    return False
        return bool(polygon)
    for name, index in roots.items():
        minimum = np.array([float('inf')] * 3)
        maximum = -minimum
        triangles, primitives, radius, materials, signed_volume = 0, 0, 0, set(), 0
        todo = [index]
        while todo:
            node = nodes[todo.pop()]
            todo.extend(node.get('children', []))
            assert not any(key in node for key in ('matrix', 'translation', 'rotation', 'scale')), name
            if 'mesh' not in node:
                continue
            for primitive in gltf['meshes'][node['mesh']]['primitives']:
                attributes = primitive['attributes']
                assert all(key in attributes for key in ('POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0')), name
                assert primitive.get('mode', 4) == 4
                positions = values(attributes['POSITION'])
                assert all(np.isfinite(values(attributes[key])).all() for key in attributes), name
                normals = values(attributes['NORMAL'])
                assert np.allclose(np.linalg.norm(normals, axis=1), 1, atol=.0001), name
                minimum = np.minimum(minimum, positions.min(axis=0))
                maximum = np.maximum(maximum, positions.max(axis=0))
                radius = max(radius, float(np.linalg.norm(positions[:, (0, 2)], axis=1).max()))
                indices = values(primitive['indices']).flatten().reshape((-1, 3))
                points = positions[indices].astype(float)
                if name in ('cottage_base', 'cottage_wall_front', 'cottage_wall_back'):
                    for sign in (-1, 1):
                        lo = [-1.1499, .0251, sign * DEPTH / 2 - THICKNESS - .001]
                        hi = [1.1499, 2.7999, sign * DEPTH / 2 + THICKNESS + .001]
                        assert not any(triangle_hits_box(triangle, lo, hi) for triangle in points), f'{name}: full doorway prism blocked'
                signed_volume += float(np.einsum('ij,ij->i', points[:, 0], np.cross(points[:, 1], points[:, 2])).sum() / 6)
                triangles += len(points)
                primitives += 1
                materials.add(gltf['materials'][primitive['material']]['name'])
        manifest['prefabs'][name] = {'bounds': {'min': minimum.round(5).tolist(), 'max': maximum.round(5).tolist()},
                                    'dimensions': (maximum - minimum).round(5).tolist(),
                                    'horizontalRadius': round(radius, 5), 'triangles': triangles,
                                    'primitives': primitives, 'materials': sorted(materials)}
        if name.startswith('cottage_') and name != 'cottage_roof':
            assert minimum[0] >= -WIDTH / 2 - .0001 and maximum[0] <= WIDTH / 2 + .0001, (name, minimum, maximum)
            assert minimum[2] >= -DEPTH / 2 - .0001 and maximum[2] <= DEPTH / 2 + .0001, (name, minimum, maximum)
            assert maximum[1] <= WALL_HEIGHT + .0001
            assert (maximum[1] <= .4801 if name == 'cottage_base' else minimum[1] >= .4799)
        if name == 'cottage_roof':
            assert minimum[0] >= -WIDTH / 2 - .16 and maximum[0] <= WIDTH / 2 + .16
            assert minimum[2] >= -DEPTH / 2 - .16 and maximum[2] <= DEPTH / 2 + .16
            assert minimum[1] >= 3.1999 and maximum[1] <= HEIGHT
        if name in ('fruit_stall', 'sailcloth_stall', 'haven_hut'):
            limit = {'fruit_stall': 2.5, 'sailcloth_stall': 2.4, 'haven_hut': 3.2}[name]
            assert radius <= limit and minimum[1] >= -.5001 and maximum[1] <= (5 if name == 'haven_hut' else 4), (name, minimum, maximum, radius)
            assert signed_volume > 1, (name, 'solids must face outwards', signed_volume)
        if name == 'paving_slab':
            assert radius <= .55 and minimum[1] >= -.0301 and maximum[1] <= .035
            assert 0 < signed_volume < .1 and triangles <= 32, (signed_volume, triangles)
        if name == 'coastal_shrub':
            assert radius <= .5 and maximum[1] <= .8 and primitives == 1 and 250 <= triangles <= 650
    manifest['totalTriangles'] = sum(p['triangles'] for p in manifest['prefabs'].values())
    manifest['totalPrimitives'] = sum(p['primitives'] for p in manifest['prefabs'].values())
    assert len(raw) <= 2.3 * 1024 * 1024, len(raw)
    assert manifest['totalTriangles'] <= 24000, manifest['totalTriangles']
    return manifest


def preview(path):
    loader = importlib.util.spec_from_file_location('old_watch_preview', ROOT / 'tools/build-old-watch.py')
    old_watch = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(old_watch)
    with tempfile.TemporaryDirectory(prefix='skywake-market-preview-') as temporary:
        old_watch.create_materials(pathlib.Path(temporary))
        for root in PREFABS.values():
            for child in root.children:
                binding = MATERIAL_BINDINGS[child.data.materials[0].name]
                material = MATERIALS[binding['source']].copy()
                nodes, links = material.node_tree.nodes, material.node_tree.links
                if 'color' in binding:
                    shader = nodes.get('Principled BSDF')
                    upstream = shader.inputs['Base Color'].links[0].from_socket
                    tint = nodes.new('ShaderNodeMixRGB')
                    tint.blend_type = 'MULTIPLY'
                    tint.inputs[0].default_value = 1
                    tint.inputs[2].default_value = tuple(binding['color']) + (1,)
                    links.new(upstream, tint.inputs[1])
                    links.new(tint.outputs['Color'], shader.inputs['Base Color'])
                if 'normalScale' in binding:
                    for node in nodes:
                        if node.type == 'NORMAL_MAP':
                            node.inputs['Strength'].default_value = binding['normalScale']
                child.data.materials[0] = material
        positions = {'fruit_stall': (-3.3, 0, 4.1), 'sailcloth_stall': (2.0, 0, 4.1),
                     'haven_hut': (4.8, 0, -1.4), 'paving_slab': (-.5, 0, 6.1), 'coastal_shrub': (.5, 0, 6.1)}
        for name, root in PREFABS.items():
            root.location = game_to_blender((-2.6, 0, -1.3) if name.startswith('cottage_') else positions[name])
        bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.02))
        bpy.context.object.data.materials.append(MATERIALS['ground_earth'])
        scene = bpy.context.scene
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = 32
        scene.cycles.use_denoising = True
        world = bpy.data.worlds.new('market_preview_world')
        world.use_nodes = True
        world.node_tree.nodes.get('Background').inputs['Color'].default_value = (.44, .51, .59, 1)
        world.node_tree.nodes.get('Background').inputs['Strength'].default_value = .75
        scene.world = world
        bpy.ops.object.light_add(type='AREA', location=(-7, -5, 16))
        key = bpy.context.object
        key.data.energy, key.data.shape, key.data.size = 3300, 'DISK', 9
        key.data.color = (1, .94, .82)
        key.rotation_euler = (Vector((0, 0, 1)) - key.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.ops.object.camera_add(location=(15, -23, 16))
        camera = bpy.context.object
        camera.rotation_euler = (Vector((0, -1, 2)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.type, camera.data.ortho_scale = 'ORTHO', 17.5
        scene.camera = camera
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1600, 1200, 100
        scene.view_settings.view_transform = 'AgX'
        path.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'client/assets/tideglass-market')
    parser.add_argument('--preview', type=pathlib.Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    args.output.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for name in MATERIAL_BINDINGS:
        create_binding_material(name, double_sided=name in ('coastal_leaf', 'produce_gold', 'produce_coral'))
    build_cottage()
    build_stalls()
    build_hut()
    build_ground_props()
    output = args.output / 'kit.glb'
    export_glb(output)
    manifest = inspect_glb(output)
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'TIDEGLASS_MARKET_OK: {len(PREFABS)} prefabs, {manifest["totalTriangles"]:,} triangles, {manifest["bytes"]:,} bytes')
    if args.preview:
        preview(args.preview.resolve())


if __name__ == '__main__':
    main()
