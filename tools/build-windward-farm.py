"""Build Windward Farm's original geometry-only extension to the shared environment kit.

    blender --background --factory-startup --python-exit-code 1 --python tools/build-windward-farm.py

The Old Watch GLB owns textures and common props. This smaller addition exports
named material slots, bound to that library by the client. --output permits a
separate regeneration; --preview renders an optional, untracked contact sheet
with the same original shared textures without embedding them in shipping GLB.
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
from environment_kit import (MATERIALS, PREFABS, KitMesh, clamp, game_to_blender,
                             unit, rotate_y, create_binding_material, export_glb)

ROOT = pathlib.Path(__file__).resolve().parents[1]
SEED = 735194
RNG = random.Random(SEED)
TAU = math.tau
SHARED_KIT = '/assets/old-watch/kit.glb'
MATERIAL_BINDINGS = {
    'watch_stone': {'source': 'watch_stone'},
    'aged_timber': {'source': 'aged_timber'},
    'forged_iron': {'source': 'forged_iron'},
    'recess_shadow': {'source': 'recess_shadow'},
    'farm_plaster': {'source': 'watch_stone', 'color': [1.65, 1.48, 1.20]},
    'farm_roof': {'source': 'dark_slate', 'color': [3.40, 1.22, .69]},
    'crop_straw': {'source': 'needle_foliage', 'color': [3.00, 1.65, .62]},
    'crop_leaf': {'source': 'needle_foliage', 'color': [.91, 1.16, .68]},
    'hay_straw': {'source': 'aged_timber', 'color': [2.20, 1.68, .74]},
}
EXPECTED = ['windmill_body', 'windmill_sails', 'barn_base', 'barn_wall_east',
            'barn_wall_west', 'barn_wall_front', 'barn_wall_back', 'barn_roof',
            'crop_wheat', 'crop_leafy', 'fence_section', 'hay_bale']
WIDTH, DEPTH, WALL_HEIGHT, DOOR_WIDTH, DOOR_HEIGHT = 4.97, 4.13, 3.48, 2.30, 2.80
THICKNESS = .24


def stone_color(y):
    value = RNG.uniform(.79, 1.05)
    moss = .2 if y < .7 and RNG.random() < .58 else .04
    return (value * (1 - moss), value * (1 - moss * .35), value * (1 - moss * 1.35))


def timber_color():
    value = RNG.uniform(.78, 1.05)
    return (value, value * .94, value * .80)


def stone_span(mesh, start, end, bottom, top, *, fixed, axis='x', depth=.24):
    rows = max(1, round((top - bottom) / .33))
    dy = (top - bottom) / rows
    for row in range(rows):
        count = max(1, round((end - start) / .61))
        edges = [start] + [start + (end - start) * (i + (.18 if row % 2 else -.12)) / count
                           for i in range(1, count)] + [end]
        for a, b in zip(edges, edges[1:]):
            y = bottom + (row + .5) * dy
            center = ((a + b) / 2, y, fixed) if axis == 'x' else (fixed, y, (a + b) / 2)
            size = (b - a - .018, dy - .012, depth) if axis == 'x' else (depth, dy - .012, b - a - .018)
            mesh.block(center, size, color=stone_color(y), bevel=RNG.uniform(.025, .048))


def planks(mesh, start, end, bottom, top, *, fixed, axis='x', depth=.16):
    count = max(1, round((end - start) / .29))
    spacing = (end - start) / count
    for i in range(count):
        mid = start + (i + .5) * spacing
        center = (mid, (bottom + top) / 2, fixed) if axis == 'x' else (fixed, (bottom + top) / 2, mid)
        size = (spacing - .009, top - bottom, depth) if axis == 'x' else (depth, top - bottom, spacing - .009)
        mesh.block(center, size, 'aged_timber', timber_color(), bevel=.011,
                   skew=RNG.uniform(-.002, .002))


def build_mill():
    mesh = KitMesh('windmill_body')
    # A continuous tapered core seals the mortar and cap joins. Plaster vertex
    # wear follows the base/patches, avoiding a stack of uniformly striped rings.
    segments = 20
    levels = [(-.65, 2.51), (.02, 2.50), (1.45, 2.31), (3.15, 2.11),
              (5.10, 1.91), (7.0, 1.70), (9.02, 1.49)]
    for row in range(len(levels) - 1):
        y0, r0 = levels[row]
        y1, r1 = levels[row + 1]
        for j in range(segments):
            a, b = j * TAU / segments, (j + 1) * TAU / segments
            pts = [(math.sin(a) * r0, y0, math.cos(a) * r0),
                   (math.sin(b) * r0, y0, math.cos(b) * r0),
                   (math.sin(b) * r1, y1, math.cos(b) * r1),
                   (math.sin(a) * r1, y1, math.cos(a) * r1)]
            value = RNG.uniform(.88, 1.04)
            colors = [(value * (.83 if y < .7 else 1), value * (.89 if y < .7 else .985),
                       value * (.69 if y < .7 else .93)) for _, y, _ in pts]
            mesh.polygon(pts, 'farm_plaster', colors,
                         [(a * r0, y0), (b * r0, y0), (b * r1, y1), (a * r1, y1)])
    # Real exposed fieldstone foot and a few scarred areas through old limewash.
    for row in range(4):
        y = -.45 + row * .37
        radius = 2.48 - max(0, y) * .125
        for j in range(18):
            angle = (j + (row % 2) * .5) * TAU / 18
            if y > .05 and min(angle, TAU - angle) < .27:
                continue
            mesh.block((math.sin(angle) * radius, y, math.cos(angle) * radius),
                       (radius * TAU / 18 - .025, .35, .29),
                       color=stone_color(y), bevel=.042, yaw=angle)
    for a0, y0, rows in ((1.42, 1.03, 3), (3.08, 2.0, 4), (4.61, 1.55, 2), (5.57, 4.46, 2)):
        for row in range(rows):
            y = y0 + row * .29
            radius = 2.49 - y * .112
            count = 3 if row == 0 else 2
            for j in range(count):
                angle = a0 + (j - (count - 1) / 2) * .16 + row * .028
                mesh.block((math.sin(angle) * radius, y, math.cos(angle) * radius),
                           (.35, .265, .095), color=stone_color(y), bevel=.023, yaw=angle)
    # Two slender timber hoops and upright cap supports establish the working
    # machinery silhouette without the decorative horizontal striping of a toy.
    for y in (3.15, 8.88):
        radius = 2.49 - y * .112 + .07
        for j in range(20):
            a, b = j * TAU / 20, (j + 1) * TAU / 20
            mesh.beam((math.sin(a) * radius, y, math.cos(a) * radius),
                      (math.sin(b) * radius, y, math.cos(b) * radius), .13,
                      color=(.69, .70, .58))
    # Recessed closed door is deliberately non-enterable, as the original mill.
    door_z = 2.505
    mesh.block((0, 1.11, door_z - .04), (1.17, 2.16, .13), 'recess_shadow', bevel=.018)
    for j in range(6):
        x = (j - 2.5) * .177
        mesh.block((x, 1.09, door_z + .025), (.166, 2.07, .085), 'aged_timber',
                   (.69, .68, .56), bevel=.012)
    for side in (-1, 1):
        for j in range(6):
            mesh.block((side * .655, .18 + j * .35, door_z - .10), (.245, .34, .30),
                       color=stone_color(j * .35), bevel=.025)
    for j in range(5):
        mesh.block(((j - 2) * .30, 2.24 + (.07 if j % 2 else 0), door_z - .10),
                   (.295, .24, .29), color=stone_color(2), bevel=.03)
    for y in (.55, 1.59):
        mesh.block((0, y, door_z + .085), (1.02, .073, .028), 'forged_iron', bevel=.008)
    mesh.tube([(.32, 1.02, door_z + .10), (.32, 1.17, door_z + .10)], [.022, .022], 'forged_iron', sides=6)
    # Deep glazed window slots sit proud of the sealed taper, with timber jambs.
    for angle, y in ((0, 5.16), (2.38, 4.45), (4.18, 6.13)):
        radius = 2.49 - y * .112 + .015
        mesh.block(rotate_y((0, y, radius), angle), (.64, .86, .17), 'recess_shadow', bevel=.012, yaw=angle)
        for x in (-.355, .355):
            mesh.block(rotate_y((x, y, radius + .04), angle), (.10, 1.06, .24),
                       'aged_timber', (.75, .73, .60), bevel=.018, yaw=angle)
        for yy in (y - .49, y + .49):
            mesh.block(rotate_y((0, yy, radius + .04), angle), (.81, .12, .27),
                       'aged_timber', (.74, .73, .61), bevel=.018, yaw=angle)
        mesh.block(rotate_y((0, y, radius + .10), angle), (.042, .85, .033), 'forged_iron', bevel=.004, yaw=angle)
    # Shingled russet cap: overlapping low-poly tile wedges close beneath their
    # joints. Small alternating setbacks break the perfect cone at grazing view.
    # The continuous underlay extends below the first course. Every lower tile
    # lip enters its solid cross-section, including the half-course offset;
    # this prevents a sky slit behind the projecting eave in ground-up views.
    underlay_bottom, underlay_top = 8.77, 11.58
    underlay_radius, underlay_tip = 2.137, .02
    mesh.tube([(0, underlay_bottom, 0), (0, underlay_top, 0)],
              [underlay_radius, underlay_tip], 'farm_roof', (.76, .77, .78), sides=20)
    for row in range(8):
        t0, t1 = row / 8, min(1, (row + 1.20) / 8)
        y0, y1 = 8.86 + t0 * 2.72, 8.86 + t1 * 2.72
        r0, r1 = 2.05 * (1 - t0) + .055, 2.05 * (1 - t1) + .055
        for j in range(20):
            a = (j + (row % 2) * .5) * TAU / 20
            b = a + TAU / 20 - .008
            yj = RNG.uniform(-.010, .008)
            value = RNG.uniform(.80, 1.12)
            pts = [(math.sin(a) * r0, y0 + yj, math.cos(a) * r0),
                   (math.sin(b) * r0, y0 + yj, math.cos(b) * r0),
                   (math.sin(b) * r1, y1 + yj, math.cos(b) * r1),
                   (math.sin(a) * r1, y1 + yj, math.cos(a) * r1)]
            mesh.polygon(pts, 'farm_roof', (value, value * .96, value * .91))
            lip_y, lip_radius = y0 + yj - .065, r0 * .975
            support_radius = underlay_radius + (underlay_tip - underlay_radius) * ((lip_y - underlay_bottom) / (underlay_top - underlay_bottom))
            assert lip_y >= underlay_bottom and lip_radius < support_radius * math.cos(math.pi / 20), 'Detached mill roof lip'
            mesh.polygon((pts[0], (pts[0][0] * .975, lip_y, pts[0][2] * .975),
                          (pts[1][0] * .975, lip_y, pts[1][2] * .975), pts[1]),
                         'farm_roof', (value * .73, value * .74, value * .75))
    mesh.tube([(0, 11.51, 0), (0, 11.75, 0)], [.09, .045], 'forged_iron', sides=8)
    # Hub support aligns to the retained rotor pivot; no shaft/roof gap.
    mesh.beam((0, 7.82, 1.46), (0, 7.82, 2.13), .28, color=(.63, .64, .52))
    mesh.block((0, 7.82, 1.72), (.59, .69, .22), 'aged_timber', (.75, .73, .60), bevel=.045)
    mesh.finish()


def build_sails():
    mesh = KitMesh('windmill_sails')
    for arm in range(4):
        angle = arm * math.pi / 2
        def point(x, y, z=0):
            return (x * math.cos(angle) + y * math.sin(angle),
                    -x * math.sin(angle) + y * math.cos(angle), z)
        mesh.beam(point(0, -.19), point(0, 2.35), .085, .10, (.77, .76, .62))
        mesh.beam(point(.58, .69), point(.58, 2.30), .05, .07, (.83, .82, .69))
        # Narrow overlapping canvas strips show a shallow wind-bowed surface.
        # Modeled back and front keep the sail legible from an aerial approach.
        for j in range(7):
            low, high = .69 + j * .227, .69 + (j + 1) * .227
            value = RNG.uniform(.88, 1.01)
            pts = [point(.055, low, .012), point(.56, low, .035),
                   point(.56, high, .035), point(.055, high, .012)]
            mesh.polygon(pts, 'farm_plaster', (value, value, value * .94),
                         ((0, low), (.48, low), (.48, high), (0, high)))
            mesh.polygon(list(reversed([point(.055, low, -.002), point(.56, low, .026),
                                       point(.56, high, .026), point(.055, high, -.002)])),
                         'farm_plaster', (value * .88, value * .90, value * .86))
            mesh.beam(point(-.055, low, .053), point(.625, low, .053), .023, .029, (.76, .76, .66))
        mesh.beam(point(.045, .72, .065), point(.58, 2.22, .065), .025, color=(.67, .70, .57))
    mesh.tube([(0, 0, -.16), (0, 0, .18)], [.19, .16], 'aged_timber', (.69, .69, .58), sides=10)
    mesh.tube([(0, 0, .16), (0, 0, .215)], [.095, .095], 'forged_iron', sides=10)
    mesh.finish()


def build_barn():
    xwall, zwall = (WIDTH - THICKNESS) / 2, (DEPTH - THICKNESS) / 2
    base = KitMesh('barn_base')
    base.block((0, -.15, 0), (WIDTH, .30, DEPTH), color=(.81, .85, .72), bevel=.033)
    # The floor remains at the authoritative furnished-building floor height.
    for j in range(13):
        x = (j - 6) * (WIDTH - .49) / 13
        base.block((x, .004, 0), ((WIDTH - .49) / 13 - .008, .042, DEPTH - .49),
                   'aged_timber', (.71 + RNG.random() * .11, .72, .57), bevel=.006)
    for sign in (-1, 1):
        stone_span(base, -DEPTH / 2, DEPTH / 2, .025, .48, fixed=sign * xwall, axis='z')
        for a, b in ((-xwall + .12, -DOOR_WIDTH / 2), (DOOR_WIDTH / 2, xwall - .12)):
            stone_span(base, a, b, .025, .48, fixed=sign * zwall)
    base.finish()
    for sign, name in ((1, 'east'), (-1, 'west')):
        mesh = KitMesh(f'barn_wall_{name}')
        x = sign * xwall
        stone_span(mesh, -DEPTH / 2, DEPTH / 2, .48, 1.08, fixed=x, axis='z')
        # Boards, recessed vents and braced joints all belong to this cutaway face.
        for a, b in ((-DEPTH / 2, -.52), (.52, DEPTH / 2)):
            planks(mesh, a, b, 1.08, 3.36, fixed=x, axis='z')
        planks(mesh, -.52, .52, 1.08, 2.05, fixed=x, axis='z')
        planks(mesh, -.52, .52, 2.73, 3.36, fixed=x, axis='z')
        mesh.block((x, 2.39, 0), (.15, .68, 1.04), 'recess_shadow', bevel=.01)
        for z in (-.57, .57):
            mesh.block((x, 2.39, z), (.24, .85, .09), 'aged_timber', (.71, .72, .60), bevel=.013)
        for y in (2.01, 2.77):
            mesh.block((x, y, 0), (.24, .10, 1.23), 'aged_timber', (.72, .72, .60), bevel=.012)
        for j in range(5):
            mesh.block((x + sign * .085, 2.39, (j - 2) * .19), (.048, .68, .048),
                       'aged_timber', (.80, .81, .68), bevel=.006)
        for z in (-zwall, 0, zwall):
            mesh.block((x, 2.19, z), (.24, 2.58, .17), 'aged_timber', (.68, .67, .55), bevel=.018)
        mesh.block((x, 3.38, 0), (.24, .20, DEPTH), 'aged_timber', (.73, .72, .59), bevel=.016)
        for a, b in ((-1.82, -.69), (.69, 1.82)):
            mesh.beam((x + sign * .04, 1.20, a), (x + sign * .04, 3.25, b), .105,
                      color=(.76, .73, .58))
        mesh.finish()
    for sign, name in ((1, 'front'), (-1, 'back')):
        mesh = KitMesh(f'barn_wall_{name}')
        z = sign * zwall
        for a, b in ((-xwall + .12, -1.15), (1.15, xwall - .12)):
            stone_span(mesh, a, b, .48, 1.08, fixed=z)
            planks(mesh, a, b, 1.08, 3.33, fixed=z)
        # Posts and open doors never enter |x|<1.15 below the 2.80m header.
        for x in (-1.24, 1.24):
            mesh.block((x, 1.90, z), (.18, 2.20, .24), 'aged_timber', (.68, .67, .54), bevel=.014)
        mesh.block((0, 3.14, z), (WIDTH - .48, .68, .24), 'aged_timber', (.70, .70, .56), bevel=.018)
        for x in (-1.63, 1.63):
            mesh.block((x, 3.11, z + sign * .109), (.29, .10, .018), 'forged_iron', bevel=.008)
            # Retained doorway has no decorative sill to catch player feet.
            mesh.block((x, 1.53, z + sign * .09), (.22, .07, .025), 'forged_iron', bevel=.006)
        mesh.finish()
    roof = KitMesh('barn_roof')
    eave, ridge, reach, end = 3.48, 5.77, 2.59, 2.18
    for z in (-zwall, zwall):
        for j in range(18):
            x = (j - 8.5) * .25
            height = (ridge - eave - .08) * (1 - abs(x) / 2.50)
            roof.block((x, eave + height / 2, z), (.243, height, .12),
                       'aged_timber', timber_color(), bevel=.009)
        for sign in (-1, 1):
            roof.beam((sign * 2.53, eave + .065, z), (0, ridge - .02, z), .14, .14, (.64, .66, .53))
        roof.beam((0, eave + .045, z), (0, ridge - .04, z), .13, color=(.67, .68, .53))
    for x in (-2.50, 2.50):
        roof.beam((x, eave + .05, -end), (x, eave + .05, end), .12, color=(.68, .69, .55))
    for sign in (-1, 1):
        pts = [(sign * reach, eave + .055, -end), (0, ridge, -end),
               (0, ridge, end), (sign * reach, eave + .055, end)]
        if sign < 0:
            pts.reverse()
        roof.polygon(pts, 'farm_roof', (.77, .79, .80))
        # Sealed underside is visible from the open door before cutaway triggers.
        roof.polygon(list(reversed(pts)), 'aged_timber', (.56, .57, .46))
        for row in range(9):
            t = (row + .45) / 9
            x, y = sign * 2.55 * (1 - t), eave + .093 + 2.26 * t
            for j in range(13):
                z = -end + (j + .5) * (2 * end) / 13
                value = RNG.uniform(.80, 1.13)
                roof.block((x, y + RNG.uniform(-.007, .007), z),
                           (.033, .445, 2 * end / 13 - .005), 'farm_roof',
                           (value, value * .96, value * .89), bevel=0,
                           axis_y=(-sign * 2.55, 2.26, 0))
        roof.beam((sign * 2.55, eave + .08, -end), (0, ridge + .025, -end), .11, color=(.69, .69, .56))
        roof.beam((sign * 2.55, eave + .08, end), (0, ridge + .025, end), .11, color=(.69, .69, .56))
    for j in range(15):
        roof.block((0, ridge + .01, (j - 7) * .29), (.21, .13, .299),
                   'farm_roof', (.95, .92, .85), bevel=.038)
    roof.finish()


def leaf(mesh, start, direction, length, width, material, color):
    start, direction = Vector(start), unit(direction)
    side = direction.cross(Vector((0, 1, 0))).normalized()
    rows = []
    for j in range(5):
        t = j / 4
        p = start + direction * length * t + Vector((0, math.sin(t * math.pi) * .085, 0))
        spread = side * width * math.sin(t * math.pi) ** .8
        rows.append((p - spread, p + Vector((0, width * .12, 0)), p + spread))
    for j in range(4):
        for k in range(2):
            mesh.polygon((rows[j][k], rows[j][k + 1], rows[j + 1][k + 1], rows[j + 1][k]),
                         material, color,
                         ((k / 2, j / 4), ((k + 1) / 2, j / 4), ((k + 1) / 2, (j + 1) / 4), (k / 2, (j + 1) / 4)))


def build_crops():
    wheat = KitMesh('crop_wheat')
    # Seven stalks share one material primitive, retaining readable seed heads
    # and lean at walking height rather than densely instancing heavy grass.
    for j in range(7):
        angle = j * 2.399
        radius = .13 * math.sqrt(j / 7)
        start = Vector((math.cos(angle) * radius, 0, math.sin(angle) * radius))
        height = RNG.uniform(.60, .74)
        lean = Vector((math.cos(angle + .7) * .065, 0, math.sin(angle + .7) * .065))
        end = start + Vector((0, height, 0)) + lean
        tint = (RNG.uniform(.82, 1.03), .91, .74)
        wheat.tube((start, start.lerp(end, .56), end), (.008, .006, .004), 'crop_straw', tint, sides=4)
        for k in range(2):
            direction = Vector((math.cos(angle + k * 2.3), .18, math.sin(angle + k * 2.3)))
            leaf(wheat, start.lerp(end, .25 + k * .26), direction, .21, .018, 'crop_straw', tint)
        for k in range(4):
            y = k * .021
            for side in (-1, 1):
                off = Vector((math.cos(angle) * side, .80, math.sin(angle) * side)) * .026
                point = end + Vector((0, y, 0))
                wheat.tube((point, point + off), (.0105, .003), 'crop_straw', tint, sides=4)
        wheat.tube((end, end + Vector((0, .115, 0))), (.004, .0008), 'crop_straw', tint, sides=4)
    wheat.finish()
    greens = KitMesh('crop_leafy')
    for j in range(9):
        angle = j * 2.399
        length = .21 if j > 5 else .32
        direction = (math.cos(angle), .4 + j * .052, math.sin(angle))
        leaf(greens, (0, .025 + j * .009, 0), direction, length, .084,
             'crop_leaf', (.81 + j * .013, .88 + j * .008, .72))
    greens.finish()


def build_props():
    fence = KitMesh('fence_section')
    for x in (-.92, .92):
        fence.block((x, .385, 0), (.15, 1.31, .14), 'aged_timber', (.77, .78, .64),
                    bevel=.024, skew=.008 if x < 0 else -.008)
        fence.block((x, 1.025, 0), (.135, .045, .127), 'aged_timber', (.81, .81, .66), bevel=.017)
    for y, tilt in ((.37, .022), (.82, -.026)):
        fence.beam((-.94, y - tilt, .014), (.94, y + tilt, .014), .095, .07, (.83, .80, .62))
    fence.beam((-.84, .39, -.047), (.84, .81, -.047), .053, .046, (.75, .75, .58))
    fence.finish()
    hay = KitMesh('hay_bale')
    # Rounded tied stack uses longitudinal timber fibers as dry straw; shallow
    # stalk ridges keep it readable without a unique texture or cylinder roll.
    hay.block((0, .265, 0), (.88, .53, .62), 'hay_straw', (.92, .93, .85), bevel=.065)
    for z in (-.22, .22):
        for x in (-.445, .445):
            hay.beam((x, .075, z), (x, .46, z), .017, color=(.64, .63, .49))
        for y in (.036, .514):
            hay.beam((-.38, y, z), (.38, y, z), .017, color=(.64, .63, .49))
    for j in range(10):
        z = (j - 4.5) * .053
        hay.beam((-.32, .530, z), (.30 + RNG.uniform(-.02, .04), .530, z), .012,
                 color=(.86, .89, .76), material='hay_straw')
    hay.finish()


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
    assert not gltf.get('images') and not gltf.get('textures'), 'Farm kit must not duplicate shared textures'
    assert all('uri' not in buffer for buffer in gltf['buffers'])
    assert {mat['name'] for mat in gltf['materials']} == set(MATERIAL_BINDINGS)
    shared = json.loads((ROOT / 'client/assets/old-watch/manifest.json').read_text())
    manifest = {
        'schemaVersion': 1, 'generator': 'tools/build-windward-farm.py', 'seed': SEED,
        'blenderVersion': bpy.app.version_string, 'coordinateSystem': 'Y-up, meters, +Z front',
        'sourceLicense': 'Original Skywake Isles project assets; see CREDITS.md',
        'file': 'kit.glb', 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
        'dependencies': [{'url': SHARED_KIT, 'sha256': shared['sha256'],
                          'ownership': 'Shared cache owns original material textures and reusable props'}],
        'materialBindings': MATERIAL_BINDINGS,
        'prefabs': {}, 'textures': [], 'embeddedImageCount': 0,
        'decodedTextureBytes': 0, 'windmillRotorPivot': [0, 7.82, 2.108],
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
                if name in ('barn_base', 'barn_wall_front', 'barn_wall_back'):
                    in_door = ((np.abs(positions[:, 0]) < DOOR_WIDTH / 2 - .0001)
                               & (np.abs(positions[:, 2]) > DEPTH / 2 - THICKNESS - .001)
                               & (positions[:, 1] > .0251) & (positions[:, 1] < DOOR_HEIGHT - .0001))
                    assert not in_door.any(), f'{name}: doorway prism is obstructed'
                if name == 'windmill_sails':
                    assert float(np.linalg.norm(positions[:, :2], axis=1).max()) <= 2.48, 'Rotor sweep'
                triangles += gltf['accessors'][primitive['indices']]['count'] // 3
                primitives += 1
                materials.add(gltf['materials'][primitive['material']]['name'])
        manifest['prefabs'][name] = {'bounds': {'min': minimum.round(5).tolist(), 'max': maximum.round(5).tolist()},
                                     'dimensions': (maximum - minimum).round(5).tolist(),
                                     'horizontalRadius': round(radius, 5), 'triangles': triangles,
                                     'primitives': primitives, 'materials': sorted(materials)}
    for name, prefab in manifest['prefabs'].items():
        low, high = prefab['bounds']['min'], prefab['bounds']['max']
        if name.startswith('barn_') and name != 'barn_roof':
            assert low[0] >= -WIDTH / 2 - .001 and high[0] <= WIDTH / 2 + .001, (name, low, high)
            assert low[2] >= -DEPTH / 2 - .001 and high[2] <= DEPTH / 2 + .001, (name, low, high)
            assert high[1] <= WALL_HEIGHT + .001, (name, low, high)
        if name == 'barn_roof':
            assert low[0] >= -(WIDTH + .35) / 2 and high[0] <= (WIDTH + .35) / 2, (name, low, high)
            assert low[2] >= -(DEPTH + .35) / 2 and high[2] <= (DEPTH + .35) / 2, (name, low, high)
            assert low[1] >= 3.47 and high[1] <= 6, (name, low, high)
        if name == 'windmill_body':
            assert low[1] >= -.66 and high[1] <= 12 and prefab['horizontalRadius'] <= 3.4, (name, low, high)
        if name == 'fence_section':
            assert low[0] >= -1.001 and high[0] <= 1.001 and high[1] <= 1.051, (name, low, high)
        if name == 'crop_wheat':
            assert high[1] <= .90 and prefab['horizontalRadius'] < .40, (name, low, high)
        if name == 'crop_leafy':
            assert high[1] < .50 and prefab['horizontalRadius'] < .40, (name, low, high)
    manifest['totalTriangles'] = sum(p['triangles'] for p in manifest['prefabs'].values())
    manifest['totalPrimitives'] = sum(p['primitives'] for p in manifest['prefabs'].values())
    assert manifest['bytes'] < 2.5 * 1024 * 1024, manifest['bytes']
    assert manifest['totalTriangles'] < 32000, manifest['totalTriangles']
    return manifest


def preview(path):
    # Preview source materials come from the original generator's exact texture
    # recipes. They are only installed after the geometry-only export completed.
    loader = importlib.util.spec_from_file_location('old_watch_preview', ROOT / 'tools/build-old-watch.py')
    old_watch = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(old_watch)
    with tempfile.TemporaryDirectory(prefix='skywake-farm-preview-') as temporary:
        old_watch.create_materials(pathlib.Path(temporary))
        for root in PREFABS.values():
            for child in root.children:
                slot = child.data.materials[0].name
                binding = MATERIAL_BINDINGS[slot]
                material = MATERIALS[binding['source']].copy()
                if 'color' in binding:
                    # Match runtime's linear PBR color multiplier in Blender.
                    nodes, links = material.node_tree.nodes, material.node_tree.links
                    shader = nodes.get('Principled BSDF')
                    upstream = shader.inputs['Base Color'].links[0].from_socket
                    tint = nodes.new('ShaderNodeMixRGB')
                    tint.blend_type = 'MULTIPLY'
                    tint.inputs[0].default_value = 1
                    links.new(upstream, tint.inputs[1])
                    tint.inputs[2].default_value = tuple(binding['color']) + (1,)
                    links.new(tint.outputs['Color'], shader.inputs['Base Color'])
                child.data.materials[0] = material
        for name, root in PREFABS.items():
            if name.startswith('windmill'):
                position = (-4.1, 0, -.8)
                if name == 'windmill_sails':
                    position = (-4.1, 7.82, 1.308)
                    root.rotation_euler.y = -.31
            elif name.startswith('barn'):
                position = (3.4, 0, -.5)
            else:
                position = {'crop_wheat': (-.9, 0, 3.6), 'crop_leafy': (.0, 0, 3.8),
                            'fence_section': (3.5, 0, 3.5), 'hay_bale': (1.3, 0, 3.7)}[name]
            root.location = game_to_blender(position)
        bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.21))
        bpy.context.object.data.materials.append(MATERIALS['ground_earth'])
        scene = bpy.context.scene
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = 32
        scene.cycles.use_denoising = True
        world = bpy.data.worlds.new('farm_preview_world')
        world.use_nodes = True
        world.node_tree.nodes.get('Background').inputs['Color'].default_value = (.40, .48, .59, 1)
        world.node_tree.nodes.get('Background').inputs['Strength'].default_value = .65
        scene.world = world
        bpy.ops.object.light_add(type='AREA', location=(-7, -5, 16))
        key = bpy.context.object
        key.data.energy = 3300
        key.data.shape = 'DISK'
        key.data.size = 9
        key.data.color = (1, .91, .75)
        key.rotation_euler = (Vector((0, 0, 3)) - key.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.ops.object.camera_add(location=(17, -25, 16))
        camera = bpy.context.object
        camera.rotation_euler = (Vector((0, 0, 4.7)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.type = 'ORTHO'
        camera.data.ortho_scale = 22
        scene.camera = camera
        scene.render.resolution_x = 1600
        scene.render.resolution_y = 1200
        scene.render.resolution_percentage = 100
        scene.view_settings.view_transform = 'AgX'
        path.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'client/assets/windward-farm')
    parser.add_argument('--preview', type=pathlib.Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    args.output.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for name in MATERIAL_BINDINGS:
        create_binding_material(name, double_sided=name in ('crop_straw', 'crop_leaf'))
    build_mill()
    build_sails()
    build_barn()
    build_crops()
    build_props()
    output = args.output / 'kit.glb'
    export_glb(output)
    manifest = inspect_glb(output)
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'WINDWARD_FARM_OK: {len(PREFABS)} prefabs, {manifest["totalTriangles"]:,} triangles, {manifest["bytes"]:,} bytes')
    if args.preview:
        preview(args.preview.resolve())


if __name__ == '__main__':
    main()
