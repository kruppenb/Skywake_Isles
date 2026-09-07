"""Build the Moonwatch Observatory and Moonbloom Grove geometry-only environment kit extension.

    blender --background --factory-startup --python-exit-code 1 --python tools/build-moonwatch.py

Named slots borrow Old Watch's original textures at runtime, the same extension
pattern as Windward Farm, Tideglass Market, Saltwind Harbor, Driftwood Yard,
Palmheart Camp and the Cinderworks. --output supports independent byte
comparisons; --preview creates an untracked textured contact sheet after export,
without putting preview images into the shipping GLB.

Milestone 8 sample: a star-watcher's drum observatory in a moonlit grove.
Nothing here repeats a shipped row: the drum is pale silvered vertical staves
bound by pale wood hoops over cut moon-grey ashlar, and the roof is a ribbed
dome of luminous moon-glass panels between verdigris bronze ribs.

  moonwatch_observatory  ashlar plinth, silvered stave drum on three hooped
                         bands, cornice walkway and rail, ribbed moon-glass
                         dome with a closed slit hatch, star finial, closed
                         door on three steps and two portholes
  star_telescope         pale tripod, brass tube with verdigris bands, stool
  star_table             ashlar drums, inlaid bronze ring and gnomon, charts
  chart_crate            pale crate with an ajar lid, scrolls, satchel
  moon_lantern           silvered post, verdigris cage, moon-glass block
  armillary_sphere       ashlar pedestal, three tilted bronze rings, brass orb
  scholar_bench          pale bench on ashlar feet, open book and chart
  silver_tree_a/b        curling silver trunks, spiralling limbs, lavender leaf
                         clusters along the outer half of every limb, glow motes
  moon_mushroom          pale stem, broad lilac cap, luminous gill ring
  moon_crystal           faceted moon-glass shards on an ashlar base
  moon_boulder           pale moon-grey boulder with embedded glass shards
  moonbell_clump         seven arching stems with hanging bells, one primitive

The observatory is not enterable: one root, no cutaway parts, no door prism.
Trees are walkable decoration; the trunk-radius contract keeps the recorded
collidable moon tree inside its authored silhouette after runtime scaling.

Vertex colours are authored in sRGB and exported linear, so the per-slot
COLOR_0 averages the validator prints (and holds above .70) sit well below the
authored values; the Cinderworks basalt lesson is that a dark slot average
multiplies an already dark shared texture into a black silhouette.
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
from environment_kit import (MATERIALS, PREFABS, KitMesh, clamp, game_to_blender, unit,
                             create_binding_material, export_glb)

ROOT = pathlib.Path(__file__).resolve().parents[1]
SEED = 811224
RNG = random.Random(SEED)
TAU = math.tau
SHARED_KIT = '/assets/old-watch/kit.glb'
MATERIAL_BINDINGS = {
    'recess_shadow': {'source': 'recess_shadow'},
    'moon_ashlar': {'source': 'watch_stone', 'color': [2.30, 2.25, 2.45], 'normalScale': .70},
    'silver_stave': {'source': 'aged_timber', 'color': [4.40, 5.60, 9.20], 'normalScale': .35},
    'pale_frame': {'source': 'aged_timber', 'color': [5.60, 5.50, 5.40], 'normalScale': .30},
    'verdigris_bronze': {'source': 'forged_iron', 'color': [1.90, 3.40, 3.00]},
    'bright_brass': {'source': 'forged_iron', 'color': [7.50, 5.60, 2.60]},
    'moon_glass': {'source': 'lantern_amber', 'color': [.80, 2.90, 12.0],
                   'emissive': [.16, .40, .44], 'emissiveIntensity': 1.0, 'doubleSided': True},
    # The shared timber and foliage bases are warm and green (timber 104/93/74,
    # foliage 83/108/54 sRGB), so silver and lavender need blue far above red
    # and green well below it; the first pass (2.6/2.5/2.9 bark, 1.55/.95/1.85
    # leaves) rendered brown trunks under dead olive canopies in the game.
    'silver_bark': {'source': 'pine_bark', 'color': [3.90, 4.90, 8.60], 'normalScale': .70},
    'lavender_leaf': {'source': 'needle_foliage', 'color': [6.50, 2.40, 20.0], 'normalScale': .50,
                      'doubleSided': True},
    'mushroom_stem': {'source': 'aged_timber', 'color': [4.40, 4.50, 4.30], 'normalScale': .30},
    'mushroom_cap': {'source': 'watch_stone', 'color': [3.40, 2.60, 8.00], 'normalScale': .35},
    'moonbell': {'source': 'watch_stone', 'color': [5.60, 4.60, 8.00], 'normalScale': .40,
                 'doubleSided': True},
}
# The dome is one root: it is not enterable, so it has no cutaway parts.
OBSERVATORY = 'moonwatch_observatory'
BUILDING_CONTRACT = {'radius': 3.60, 'minY': -.80, 'maxY': 8.85, 'colliderRadius': 3.8,
                     'height': 9, 'enterable': False}
PROPS = ['star_telescope', 'star_table', 'chart_crate', 'moon_lantern', 'armillary_sphere',
         'scholar_bench', 'silver_tree_a', 'silver_tree_b', 'moon_mushroom', 'moon_crystal',
         'moon_boulder', 'moonbell_clump']
# root -> (maximum horizontal radius, minimum y, maximum y).
PROP_ENVELOPES = {
    'star_telescope': (1.40, -.05, 2.80),
    'star_table': (2.00, -.05, 1.40),
    'chart_crate': (1.10, -.05, 1.30),
    'moon_lantern': (.55, -.06, 2.70),
    'armillary_sphere': (.80, -.05, 2.10),
    'scholar_bench': (1.10, -.05, .95),
    'silver_tree_a': (3.40, -.22, 9.00),
    'silver_tree_b': (3.80, -.22, 11.00),
    'moon_mushroom': (1.80, -.05, 3.30),
    'moon_crystal': (.60, -.05, 1.60),
    'moon_boulder': (2.20, -.40, 4.00),
    'moonbell_clump': (.50, -.03, .70),
}
# Every silver_bark vertex below y 1 stays inside these radii, so a runtime-scaled
# trunk keeps its silhouette inside the recorded tree collider.
TRUNK_RADII = {'silver_tree_a': .40, 'silver_tree_b': .44}
EXPECTED = [OBSERVATORY] + PROPS

# Drum, plinth and dome contract; every number below is measured by inspect_glb.
PLINTH_R, PLINTH_TOP, PLINTH_FOOT = 3.10, .55, -.80
COPING_R, COPING_LOW = 3.20, .47
DRUM_R, DRUM_TOP, BACK_R = 2.95, 4.55, 2.85
STAVES, STAVE_WIDE, STAVE_DEEP = 88, .20, .10
HOOPS = (1.30, 2.70, 4.10)
CORNICE_R, CORNICE_TOP = 3.35, 4.85
RAIL_R, RAIL_TOP = 3.30, 5.60
DOME_R, DOME_TOP, DOME_ROWS, DOME_BAYS = 3.25, 8.05, 7, 8
DOME_APEX_R = .30
PHI_TOP = math.acos(DOME_APEX_R / DOME_R)
RIB_HALF, RIB_DEEP = .05, .06
DOOR_HALF, DOOR_TOP, DOOR_SECTOR = .55, 2.85, .27
PORTHOLE_Y, PORTHOLE_R = 2.90, .40
PORTHOLE_GAP = math.asin((PORTHOLE_R + .03) / DRUM_R)


def at(angle, radius, y):
    """A point on the drum's circle; angle 0 is +Z, the closed door's face."""
    return Vector((math.sin(angle) * radius, y, math.cos(angle) * radius))


def radial(angle):
    return Vector((math.sin(angle), 0, math.cos(angle)))


def tangent(angle):
    return Vector((math.cos(angle), 0, -math.sin(angle)))


def ashlar_color(rng=RNG):
    """Cut moon-grey ashlar with tight joints: neutral, faintly cool, no moss."""
    shade = rng.uniform(.86, 1.0)
    return (shade * .985, shade * .99, shade)


def stave_color(rng=RNG):
    shade = rng.uniform(.88, 1.0)
    return (shade * .955, shade * .97, shade)


def frame_color(rng=RNG):
    shade = rng.uniform(.90, 1.0)
    return (shade, shade * .99, shade * .975)


def bronze_color(rng=RNG):
    shade = rng.uniform(.88, 1.0)
    return (shade * .90, shade, shade * .97)


def brass_color(rng=RNG):
    shade = rng.uniform(.90, 1.0)
    return (shade, shade * .965, shade * .90)


def glass_color(t, rng=RNG):
    """Panels read full; the bays darken slightly where they meet a rib."""
    shade = clamp(rng.uniform(.955, 1.0) - .075 * t, .90, 1.0)
    return (shade, shade, shade)


def bark_color(rng=RNG):
    shade = rng.uniform(.97, 1.0) if rng.random() < .22 else rng.uniform(.86, .99)
    return (shade * .97, shade * .96, shade)


def leaf_color(rng=RNG):
    shade = rng.uniform(.88, 1.0)
    return (shade, shade * .935, shade)


def cap_color(t, rng=RNG):
    """The lilac cap darkens toward its rim; t is 0 at the rim, 1 at the crown."""
    shade = clamp(rng.uniform(.94, 1.0) * (.885 + .115 * t), .86, 1.0)
    return (shade, shade * .93, shade)


def stem_color(rng=RNG):
    shade = rng.uniform(.93, 1.0)
    return (shade, shade * .995, shade * .985)


def newell(points):
    normal = Vector()
    for i, p in enumerate(points):
        q = points[(i + 1) % len(points)]
        normal += Vector((p.y * q.z - p.z * q.y, p.z * q.x - p.x * q.z, p.x * q.y - p.y * q.x))
    return normal


def faced_polygon(mesh, points, outward, material, colors, smooth=False):
    """One outward-wound polygon; concave outlines keep a correct Newell normal."""
    points, colors = [Vector(p) for p in points], list(colors)
    if newell(points).dot(Vector(outward)) < 0:
        points.reverse()
        colors.reverse()
    mesh.polygon(points, material, colors, smooth=smooth)


def shaded_solid(mesh, vertices, faces, material, shade):
    """A closed convex solid whose vertex colors come from a position callback."""
    center = sum((Vector(p) for p in vertices), Vector()) / len(vertices)
    for indices in faces:
        points = [Vector(vertices[i]) for i in indices]
        outward = sum(points, Vector()) / len(points) - center
        faced_polygon(mesh, points, outward, material, [shade(p) for p in points])


def rock_prism(mesh, center, radius, height, material, shade, sides=8, squash=1.0, yaw=0.0, rng=RNG):
    """An irregular lump; per-vertex color carries the pale mineral grading."""
    cx, cy, cz = center
    lower, upper = [], []
    for i in range(sides):
        angle = yaw + i * TAU / sides
        r = radius * rng.uniform(.82, 1.12)
        lower.append((cx + math.cos(angle) * r, cy, cz + math.sin(angle) * r * squash))
        rt = r * rng.uniform(.58, .82)
        upper.append((cx + math.cos(angle) * rt, cy + height * rng.uniform(.84, 1.04),
                      cz + math.sin(angle) * rt * squash))
    faces = [list(range(sides)), list(range(sides, sides * 2))]
    faces += [[i, (i + 1) % sides, (i + 1) % sides + sides, i + sides] for i in range(sides)]
    shaded_solid(mesh, lower + upper, faces, material, shade)


def ring_band(mesh, y0, y1, r_in, r_out, material, shade, segments=44, start=0.0, span=TAU):
    """A closed annular band solid, or a capped sector of one; 8 triangles a step."""
    closed = abs(span - TAU) < 1e-9
    count = segments if closed else segments + 1
    angles = [start + span * i / segments for i in range(count)]
    for i in range(segments):
        a, b = angles[i], angles[(i + 1) % count]
        out = radial((a + b) * .5)
        for radius, facing in ((r_out, out), (r_in, -out)):
            quad = (at(a, radius, y0), at(a, radius, y1), at(b, radius, y1), at(b, radius, y0))
            faced_polygon(mesh, quad, facing, material, [shade(p) for p in quad])
        for y, up in ((y1, 1), (y0, -1)):
            quad = (at(a, r_in, y), at(a, r_out, y), at(b, r_out, y), at(b, r_in, y))
            faced_polygon(mesh, quad, (0, up, 0), material, [shade(p) for p in quad])
    if not closed:
        for angle, side in ((angles[0], -1), (angles[-1], 1)):
            quad = (at(angle, r_in, y0), at(angle, r_out, y0), at(angle, r_out, y1), at(angle, r_in, y1))
            faced_polygon(mesh, quad, tangent(angle) * side, material, [shade(p) for p in quad])


def arcs_between(gaps):
    """The arcs of a full circle left over after cutting (centre, half-angle) gaps."""
    if not gaps:
        return [(0.0, TAU)]
    edges = sorted((center - half, center + half) for center, half in gaps)
    return [(edges[i][1], (edges[(i + 1) % len(edges)][0] - edges[i][1]) % TAU) for i in range(len(edges))]


def sweep(mesh, stations, material, shade, cap=True, smooth=False):
    """A swept solid through equal-length cross-section loops."""
    count = len(stations[0])
    for i in range(len(stations) - 1):
        lower, upper = stations[i], stations[i + 1]
        center = (sum(lower, Vector()) + sum(upper, Vector())) / (count * 2)
        for j in range(count):
            k = (j + 1) % count
            quad = (lower[j], upper[j], upper[k], lower[k])
            faced_polygon(mesh, quad, sum(quad, Vector()) / 4 - center, material,
                          [shade(p) for p in quad], smooth=smooth)
    if cap:
        for loop, other in ((stations[0], stations[1]), (stations[-1], stations[-2])):
            outward = sum(loop, Vector()) / count - sum(other, Vector()) / count
            faced_polygon(mesh, loop, outward, material, [shade(p) for p in loop])


def disc(mesh, center, normal, up, radius, material, shade, sides=12, spin=0.0):
    """A flat n-gon facing `normal`; one polygon."""
    normal, up = unit(normal), unit(up)
    side = normal.cross(up).normalized()
    points = [Vector(center) + (side * math.cos(spin + i * TAU / sides)
                                + up * math.sin(spin + i * TAU / sides)) * radius for i in range(sides)]
    faced_polygon(mesh, points, normal, material, [shade(p) for p in points])


def annulus(mesh, center, normal, up, r_in, r_out, material, shade, sides=12):
    """A flat ring of quads facing `normal`; the mushroom's luminous gills."""
    normal, up = unit(normal), unit(up)
    side = normal.cross(up).normalized()
    for i in range(sides):
        a, b = i * TAU / sides, (i + 1) * TAU / sides
        ring = lambda angle, r: Vector(center) + (side * math.cos(angle) + up * math.sin(angle)) * r
        quad = (ring(a, r_in), ring(a, r_out), ring(b, r_out), ring(b, r_in))
        faced_polygon(mesh, quad, normal, material, [shade(p) for p in quad])


def octahedron(mesh, center, radius, material, shade, squash=1.0):
    """Eight faces; the finial star orb and the hanging glow motes."""
    c = Vector(center)
    poles = [c + Vector((0, radius * squash, 0)), c - Vector((0, radius * squash, 0))]
    belt = [c + Vector((math.cos(i * TAU / 4) * radius, 0, math.sin(i * TAU / 4) * radius)) for i in range(4)]
    for pole, sign in ((poles[0], 1), (poles[1], -1)):
        for i in range(4):
            face = (pole, belt[i], belt[(i + 1) % 4])
            faced_polygon(mesh, face, (sum(face, Vector()) / 3 - c) + Vector((0, sign * radius * .3, 0)),
                          material, [shade(p) for p in face])


def shard(mesh, base, radius, height, lean, spin, material, shade, sides=5):
    """A faceted pentagonal crystal pyramid leaning off vertical."""
    cx, cy, cz = base
    tip = Vector((cx + math.cos(spin) * lean * height, cy + height, cz + math.sin(spin) * lean * height))
    ring = [Vector((cx + math.cos(spin + i * TAU / sides) * radius, cy,
                    cz + math.sin(spin + i * TAU / sides) * radius)) for i in range(sides)]
    faced_polygon(mesh, ring, (0, -1, 0), material, [shade(p) for p in ring])
    for i in range(sides):
        face = (ring[i], ring[(i + 1) % sides], tip)
        faced_polygon(mesh, face, sum(face, Vector()) / 3 - Vector((cx, cy + height * .3, cz)),
                      material, [shade(p) for p in face])


def star_plate(mesh, center, normal, up, outer, inner, material, shade, points=5, spin=.0):
    """A flat star outline as one polygon; the plaque boss and the compass rose."""
    normal, up = unit(normal), unit(up)
    side = normal.cross(up).normalized()
    ring = []
    for i in range(points * 2):
        angle = spin + i * math.pi / points
        r = outer if i % 2 == 0 else inner
        ring.append(Vector(center) + (side * math.cos(angle) + up * math.sin(angle)) * r)
    faced_polygon(mesh, ring, normal, material, [shade(p) for p in ring])


def along(points, t):
    """Sample a polyline by normalized length index."""
    spans = len(points) - 1
    index = min(spans - 1, max(0, int(t * spans)))
    return Vector(points[index]).lerp(Vector(points[index + 1]), t * spans - index)


def clamp_radius(point, limit):
    radius = math.hypot(point.x, point.z)
    if radius <= limit or radius < 1e-6:
        return Vector(point)
    return Vector((point.x * limit / radius, point.y, point.z * limit / radius))


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


# ---------------------------------------------------------------- observatory

def build_plinth(mesh):
    """Two staggered courses of bevelled ashlar over a buried skirt, with a coping."""
    ring_band(mesh, PLINTH_FOOT, -.36, 2.94, PLINTH_R, 'moon_ashlar', lambda p: ashlar_color(), segments=40)
    rows, nominal = 3, .62
    count = max(1, round(TAU * PLINTH_R / nominal))
    for row in range(rows):
        y0 = -.36 + (PLINTH_TOP + .36) * row / rows
        y1 = -.36 + (PLINTH_TOP + .36) * (row + 1) / rows
        for j in range(count):
            angle = (j + (.5 if row % 2 else 0)) * TAU / count
            center = at(angle, PLINTH_R - .11, (y0 + y1) * .5)
            mesh.block(center, (TAU * PLINTH_R / count - .022, y1 - y0 - .012, .22),
                       material='moon_ashlar', color=ashlar_color(), bevel=RNG.uniform(.012, .020), yaw=angle)
    # The coping stops short of the door so the stoop meets the plinth face.
    ring_band(mesh, COPING_LOW, PLINTH_TOP, 3.02, COPING_R, 'moon_ashlar', lambda p: ashlar_color(),
              segments=38, start=.32, span=TAU - .64)


def build_steps(mesh):
    """Three ashlar steps hugging the round plinth, out to z 3.55."""
    for (r_out, half, y0, y1) in ((3.55, 1.00, -.05, .19), (3.35, .85, .19, .37), (3.15, .70, .37, .55)):
        span = math.asin(half / r_out) * 2
        ring_band(mesh, y0, y1, 2.90, r_out, 'moon_ashlar', lambda p: ashlar_color(),
                  segments=9, start=-span * .5, span=span)


def build_drum(mesh):
    """Silvered staves over a sealed backing, three hoops and their clasps."""
    mesh.tube([(0, PLINTH_TOP - .02, 0), (0, DRUM_TOP + .02, 0)], [BACK_R, BACK_R],
              material='recess_shadow', color=(1, 1, 1), sides=40)
    for j in range(STAVES):
        angle = j * TAU / STAVES
        wrapped = (angle + math.pi) % TAU - math.pi
        spans = [(PLINTH_TOP, DRUM_TOP)]
        if abs(wrapped) < DOOR_SECTOR:
            spans = [(3.06, DRUM_TOP)]
        elif abs(abs(wrapped) - math.pi * .5) < PORTHOLE_GAP:
            spans = [(PLINTH_TOP, PORTHOLE_Y - PORTHOLE_R - .03), (PORTHOLE_Y + PORTHOLE_R + .03, DRUM_TOP)]
        for y0, y1 in spans:
            mesh.block(at(angle, DRUM_R, (y0 + y1) * .5), (STAVE_WIDE, y1 - y0, STAVE_DEEP),
                       material='silver_stave', color=stave_color(), bevel=.014, yaw=angle)
    for y in HOOPS:
        # A hoop stops each side of the door and the portholes, ending in a clasp.
        gaps = ([(0.0, .30)] if y < DOOR_TOP + .20 else [])
        if abs(y - PORTHOLE_Y) <= PORTHOLE_R + .30:
            gaps += [(math.pi * .5, .21), (math.pi * 1.5, .21)]
        for start, span in arcs_between(gaps):
            closed = span > TAU - 1e-6
            ring_band(mesh, y - .08, y + .08, 2.94, 3.06, 'pale_frame', lambda p: frame_color(),
                      segments=max(4, round(40 * span / TAU)), start=start, span=span)
            count = 8 if closed else max(2, round(span / .95) + 1)
            for k in range(count):
                angle = start + (span * k / 8 + .18 if closed else span * k / (count - 1))
                mesh.block(at(angle, 3.05, y), (.12, .22, .07), material='verdigris_bronze',
                           color=bronze_color(), bevel=.010, yaw=angle)


def build_cornice(mesh):
    """The walkway ring at the drum head, its rail posts and the rail ring."""
    ring_band(mesh, DRUM_TOP, CORNICE_TOP, 2.78, CORNICE_R, 'moon_ashlar', lambda p: ashlar_color(),
              segments=44)
    for k in range(20):
        angle = k * TAU / 20 + .08
        mesh.block(at(angle, RAIL_R, (CORNICE_TOP + RAIL_TOP) * .5), (.05, RAIL_TOP - CORNICE_TOP, .05),
                   material='verdigris_bronze', color=bronze_color(), bevel=.008, yaw=angle)
    segments = 64
    points = [at(math.pi + i * TAU / segments, RAIL_R, RAIL_TOP) for i in range(segments + 1)]
    mesh.tube(points, [.038] * len(points), material='verdigris_bronze', color=bronze_color(), sides=4)


def dome_node(t):
    """Radius and height of the hemispherical dome profile, t from base to apex."""
    phi = PHI_TOP * t
    return DOME_R * math.cos(phi), CORNICE_TOP + (DOME_TOP - CORNICE_TOP) * math.sin(phi)


def dome_normal(t, angle):
    phi = PHI_TOP * t
    rise, span = DOME_TOP - CORNICE_TOP, DOME_R
    return unit(Vector((rise * math.cos(phi) * math.sin(angle), span * math.sin(phi),
                        rise * math.cos(phi) * math.cos(angle))))


def build_dome(mesh):
    """Eight verdigris ribs, 56 moon-glass panels, purlins, hatch and finial."""
    ribs = [math.pi / DOME_BAYS + k * TAU / DOME_BAYS for k in range(DOME_BAYS)]
    for angle in ribs:
        stations = []
        for i in range(DOME_ROWS + 1):
            t = i / DOME_ROWS
            radius, y = dome_node(t)
            center = at(angle, radius, y) + dome_normal(t, angle) * .03
            across, out = tangent(angle) * RIB_HALF, dome_normal(t, angle) * RIB_DEEP
            stations.append([center - across - out, center + across - out,
                             center + across + out, center - across + out])
        sweep(mesh, stations, 'verdigris_bronze', lambda p: bronze_color())
    for bay in range(DOME_BAYS):
        low_angle, high_angle = ribs[bay], ribs[(bay + 1) % DOME_BAYS]
        if high_angle < low_angle:
            high_angle += TAU
        for row in range(DOME_ROWS):
            corners, shades = [], []
            for t, edge in (((row) / DOME_ROWS, 0), ((row + 1) / DOME_ROWS, 1)):
                radius, y = dome_node(t)
                gap = (RIB_HALF + .03) / max(radius, .12)
                pair = (low_angle + gap, high_angle - gap)
                if edge:
                    pair = tuple(reversed(pair))
                for angle in pair:
                    corners.append(at(angle, radius, y) - dome_normal(t, angle) * .012)
                    shades.append(glass_color(1 - t * .5))
            faced_polygon(mesh, corners, dome_normal((row + .5) / DOME_ROWS, (low_angle + high_angle) * .5),
                          'moon_glass', shades, smooth=True)
    for row in (3, 5):
        radius, y = dome_node(row / DOME_ROWS)
        ring_band(mesh, y - .05, y + .05, radius - .08, radius + .08, 'verdigris_bronze',
                  lambda p: bronze_color(), segments=40)
    # The closed observation slit runs down the +Z bay from the collar to bay 4.
    stations = []
    for i in range(3, DOME_ROWS + 1):
        t = i / DOME_ROWS
        radius, y = dome_node(t)
        normal = dome_normal(t, 0)
        center = at(0, radius, y) + normal * .05
        across, out = Vector((min(.30, radius * .30), 0, 0)), normal * .035
        stations.append([center - across - out, center + across - out,
                         center + across + out, center - across + out])
    sweep(mesh, stations, 'verdigris_bronze', lambda p: bronze_color())
    for i in (4, 6):
        t = i / DOME_ROWS
        radius, y = dome_node(t)
        mesh.block(at(0, radius, y) + dome_normal(t, 0) * .11, (min(.42, radius * .44), .07, .05),
                   material='verdigris_bronze', color=bronze_color(), bevel=0)
    mesh.tube([(0, DOME_TOP - .11, 0), (0, DOME_TOP, 0)], [.38, .38], material='verdigris_bronze',
              color=bronze_color(), sides=16)
    mesh.block((0, DOME_TOP + .25, 0), (.14, .50, .14), material='verdigris_bronze',
               color=bronze_color(), bevel=.020)
    octahedron(mesh, (0, 8.65, 0), .16, 'bright_brass', lambda p: brass_color(), squash=1.0)


def build_door(mesh):
    """A closed pale door in a shadowed recess, hinges, knob, frame and plaque."""
    # The reveal sits level with the sealed backing so no corner cuts the staves.
    mesh.block((0, 1.72, 2.79), (1.34, 2.54, .12), material='recess_shadow', color=(1, 1, 1), bevel=0)
    mesh.block((0, (PLINTH_TOP + DOOR_TOP) * .5, 2.93), (DOOR_HALF * 2, DOOR_TOP - PLINTH_TOP, .10),
               material='pale_frame', color=frame_color(), bevel=.014)
    for k in range(4):
        x = -DOOR_HALF + .09 + k * (DOOR_HALF * 2 - .18) / 3
        mesh.block((x, (PLINTH_TOP + DOOR_TOP) * .5, 2.985), ((DOOR_HALF * 2 - .18) / 3 - .05,
                   DOOR_TOP - PLINTH_TOP - .10, .035), material='pale_frame', color=frame_color(), bevel=0)
    for y in (.95, 1.70, 2.45):
        mesh.block((-.30, y, 3.005), (.44, .09, .030), material='verdigris_bronze',
                   color=bronze_color(), bevel=0)
        mesh.block((-.50, y, 3.010), (.10, .13, .045), material='verdigris_bronze',
                   color=bronze_color(), bevel=.014)
    mesh.tube([(.38, 1.58, 2.97), (.38, 1.58, 3.07)], [.075, .058], material='bright_brass',
              color=brass_color(), sides=8)
    for x in (-.64, .64):
        mesh.block((x, (PLINTH_TOP + DOOR_TOP) * .5 + .09, 2.96), (.16, DOOR_TOP - PLINTH_TOP + .18, .14),
                   material='pale_frame', color=frame_color(), bevel=.016)
    mesh.block((0, DOOR_TOP + .09, 2.96), (1.52, .22, .16), material='pale_frame',
               color=frame_color(), bevel=.016)
    mesh.block((0, 3.26, 3.020), (.35, .35, .05), material='bright_brass', color=brass_color(), bevel=.012)
    star_plate(mesh, (0, 3.26, 3.050), (0, 0, 1), (0, 1, 0), .135, .058, 'bright_brass',
               lambda p: brass_color(), points=5, spin=math.pi * .5)


def build_portholes(mesh):
    """Two round moon-glass portholes in verdigris ring frames on local +/-x."""
    for angle in (math.pi * .5, -math.pi * .5):
        center = at(angle, DRUM_R, PORTHOLE_Y)
        normal, up = radial(angle), Vector((0, 1, 0))
        # A pale panel fills the cut in the staves; the glass reads against a
        # small dark disc rather than a black square hole.
        mesh.block(at(angle, 2.885, PORTHOLE_Y), (.94, .94, .07), material='pale_frame',
                   color=frame_color(), bevel=.014, yaw=angle)
        disc(mesh, center - normal * .025, normal, up, PORTHOLE_R - .05, 'recess_shadow',
             lambda p: (1, 1, 1), sides=12)
        disc(mesh, center - normal * .008, normal, up, PORTHOLE_R - .06, 'moon_glass',
             lambda p: glass_color(.2), sides=8)
        ring = [center + normal * .05 + (tangent(angle) * math.cos(i * TAU / 14)
                + up * math.sin(i * TAU / 14)) * PORTHOLE_R for i in range(15)]
        mesh.tube(ring, [.055] * len(ring), material='verdigris_bronze', color=bronze_color(), sides=4)


def build_observatory():
    """The whole drum, dome and stoop as one non-enterable root."""
    mesh = KitMesh(OBSERVATORY)
    build_plinth(mesh)
    build_steps(mesh)
    build_drum(mesh)
    build_cornice(mesh)
    build_dome(mesh)
    build_door(mesh)
    build_portholes(mesh)
    mesh.finish()


# ---------------------------------------------------------------------- props

def build_star_telescope():
    """Pale tripod, brass tube on a verdigris head, and a small step stool."""
    mesh = KitMesh('star_telescope')
    for k in range(3):
        angle = k * TAU / 3 + .4
        mesh.beam((math.cos(angle) * .75, -.015, math.sin(angle) * .75), (0, 1.42, 0), .085,
                  color=frame_color(), material='pale_frame')
        mesh.block((math.cos(angle) * .34, .62, math.sin(angle) * .34), (.055, .055, .34),
                   material='pale_frame', color=frame_color(), bevel=0, yaw=angle + math.pi * .5)
    mesh.block((0, 1.45, 0), (.24, .20, .24), material='verdigris_bronze', color=bronze_color(), bevel=.024)
    tube_low, tube_high = Vector((0, 1.50, .35)), Vector((0, 2.10, -1.05))
    axis = (tube_high - tube_low).normalized()
    mesh.tube([tube_low, tube_low.lerp(tube_high, .5), tube_high], [.17, .15, .13],
              material='bright_brass', color=brass_color(), sides=10)
    for t in (.16, .48, .82):
        seat = tube_low.lerp(tube_high, t)
        mesh.tube([seat - axis * .03, seat + axis * .03], [.183, .183], material='verdigris_bronze',
                  color=bronze_color(), sides=10)
    mesh.tube([tube_high - axis * .02, tube_high + axis * .19], [.085, .065],
              material='verdigris_bronze', color=bronze_color(), sides=8)
    disc(mesh, tube_low + axis * .01, -axis, (0, 1, 0), .155, 'moon_glass', lambda p: glass_color(.1), sides=8)
    mesh.block((0, 1.22, -.30), (.20, .20, .20), material='bright_brass', color=brass_color(), bevel=.040)
    for sx in (-1, 1):
        for sz in (-1, 1):
            mesh.block((.65 + sx * .19, .20, .55 + sz * .15), (.055, .44, .055),
                       material='pale_frame', color=frame_color(), bevel=.008)
    for z in (-.09, .09):
        mesh.block((.65, .445, .55 + z), (.50, .05, .15), material='pale_frame',
                   color=frame_color(), bevel=.010)
    mesh.finish()


def build_star_table():
    """Two ashlar drums with an inlaid bronze ring, a gnomon and charts."""
    mesh = KitMesh('star_table')
    mesh.tube([(0, -.05, 0), (0, .40, 0)], [1.55, 1.55], material='moon_ashlar',
              color=ashlar_color(), sides=20)
    mesh.tube([(0, .40, 0), (0, .66, 0), (0, .72, 0)], [1.62, 1.62, 1.55], material='moon_ashlar',
              color=ashlar_color(), sides=20)
    ring = [(math.cos(i * TAU / 28) * 1.30, .735, math.sin(i * TAU / 28) * 1.30) for i in range(29)]
    mesh.tube(ring, [.032] * len(ring), material='verdigris_bronze', color=bronze_color(), sides=4)
    for k in range(8):
        angle = k * TAU / 8 + .2
        mesh.block((math.cos(angle) * .76, .726, math.sin(angle) * .76), (1.02, .012, .045),
                   material='verdigris_bronze', color=bronze_color(), bevel=0,
                   yaw=math.pi * .5 - angle)
    mesh.tube([(.09, .72, -.04), (.03, 1.27, .09)], [.055, .006], material='bright_brass',
              color=brass_color(), sides=6)
    star_plate(mesh, (-.62, .729, .48), (0, 1, 0), (0, 0, 1), .18, .075, 'bright_brass',
               lambda p: brass_color(), points=8)
    for x, z, spin in ((.72, .52, .5), (.58, .78, 1.4)):
        mesh.tube([(x - .35 * math.cos(spin), .78, z - .35 * math.sin(spin)),
                   (x + .35 * math.cos(spin), .78, z + .35 * math.sin(spin))], [.06, .06],
                  material='pale_frame', color=frame_color(), sides=7)
    mesh.block((-.44, .729, -.62), (.55, .012, .42), material='pale_frame',
               color=(.93, .90, .97), bevel=0, yaw=.34)
    mesh.finish()


def build_chart_crate():
    """A pale crate with an ajar lid, standing scrolls, a chart and a satchel."""
    mesh = KitMesh('chart_crate')
    width, height, depth = .90, .84, .80
    mesh.block((0, -.005, 0), (width - .06, .05, depth - .06), material='pale_frame',
               color=frame_color(), bevel=0)
    for sign in (-1, 1):
        mesh.block((0, height * .5 - .02, sign * (depth * .5 - .03)), (width, height - .04, .06),
                   material='pale_frame', color=frame_color(), bevel=.010)
        mesh.block((sign * (width * .5 - .03), height * .5 - .02, 0), (.06, height - .04, depth - .12),
                   material='pale_frame', color=frame_color(), bevel=.010)
    for sx in (-1, 1):
        for sz in (-1, 1):
            mesh.block((sx * (width * .5 - .03), height * .5 - .02, sz * (depth * .5 - .03)),
                       (.075, height, .075), material='verdigris_bronze', color=bronze_color(), bevel=0)
    for y in (.18, .64):
        mesh.block((0, y, 0), (width + .014, .045, depth + .014), material='verdigris_bronze',
                   color=bronze_color(), bevel=0)
    lid_axis = Vector((0, math.cos(.35), -math.sin(.35)))
    mesh.block((0, .96, -.10), (width + .04, .06, depth + .04), material='pale_frame',
               color=frame_color(), bevel=.012, axis_y=lid_axis)
    for k in range(5):
        angle = k * 1.257 + .4
        x, z = math.cos(angle) * .22, math.sin(angle) * .19
        top = .55 + (k % 3) * .10
        mesh.tube([(x, .10, z), (x + .05, top + .18, z + .04)], [.05, .05],
                  material='pale_frame', color=frame_color(), sides=6)
        mesh.tube([(x + .05, top + .16, z + .04), (x + .055, top + .22, z + .045)], [.055, .055],
                  material='bright_brass', color=brass_color(), sides=6)
    for k in range(2):
        mesh.block((.48 + k * .04, .015 + k * .022, -.50 + k * .05), (.46, .020, .34),
                   material='pale_frame', color=(.94, .91, .97), bevel=0, yaw=.5 - k * .3)
    # The satchel is dark leather, so it uses the bark slot rather than dragging
    # the small mushroom_stem slot's COLOR_0 average below the .70 floor.
    for center, size, yaw in (((-.62, .22, .30), (.34, .40, .24), -.5), ((-.62, .44, .30), (.36, .10, .26), -.5)):
        mesh.block(center, size, material='silver_bark', color=(.72, .66, .62), bevel=.020, yaw=yaw)
    mesh.tube([(-.56, .40, .22), (-.50, .60, .10), (-.44, .40, -.02)], [.028, .026, .028],
              material='silver_bark', color=(.76, .70, .66), sides=4)
    mesh.finish()


def build_moon_lantern():
    """A silvered post under a verdigris cage of moon glass and a brass crescent."""
    mesh = KitMesh('moon_lantern')
    mesh.block((0, .105, 0), (.36, .25, .36), material='moon_ashlar', color=ashlar_color(), bevel=.028)
    mesh.block((0, 1.28, 0), (.11, 2.14, .11), material='silver_stave', color=stave_color(), bevel=.012)
    mesh.block((0, .28, 0), (.19, .07, .19), material='verdigris_bronze', color=bronze_color(), bevel=.012)
    mesh.block((0, 2.33, .10), (.07, .07, .28), material='verdigris_bronze', color=bronze_color(), bevel=0)
    mesh.block((0, 2.13, .24), (.34, .045, .34), material='verdigris_bronze', color=bronze_color(), bevel=.012)
    mesh.block((0, 1.65, .24), (.34, .045, .34), material='verdigris_bronze', color=bronze_color(), bevel=.012)
    mesh.block((0, 1.90, .24), (.24, .44, .24), material='moon_glass', color=glass_color(0), bevel=.030)
    for sx in (-1, 1):
        for sz in (-1, 1):
            mesh.block((sx * .155, 1.90, .24 + sz * .155), (.032, .48, .032),
                       material='verdigris_bronze', color=bronze_color(), bevel=0)
    mesh.block((0, 2.20, .24), (.22, .10, .22), material='verdigris_bronze', color=bronze_color(), bevel=.024)
    # The crescent is extruded, not two coincident faces, so it never z-fights.
    outline = [Vector((math.sin(-1.15 + i * 2.30 / 8) * .17,
                       2.42 + math.cos(-1.15 + i * 2.30 / 8) * .17, 0)) for i in range(9)]
    outline += [Vector((math.sin(-1.15 + i * 2.30 / 8) * .115 + .045,
                        2.42 + math.cos(-1.15 + i * 2.30 / 8) * .115, 0)) for i in range(8, -1, -1)]
    count = len(outline)
    area = sum(outline[i].x * outline[(i + 1) % count].y - outline[(i + 1) % count].x * outline[i].y
               for i in range(count)) * .5
    turn = 1 if area > 0 else -1
    near = [p + Vector((0, 0, .228)) for p in outline]
    far = [p + Vector((0, 0, .252)) for p in outline]
    faced_polygon(mesh, near, (0, 0, -1), 'bright_brass', [brass_color() for _ in near])
    faced_polygon(mesh, far, (0, 0, 1), 'bright_brass', [brass_color() for _ in far])
    for i in range(count):
        j = (i + 1) % count
        edge = outline[j] - outline[i]
        quad = (near[i], near[j], far[j], far[i])
        faced_polygon(mesh, quad, Vector((edge.y, -edge.x, 0)) * turn, 'bright_brass',
                      [brass_color() for _ in quad])
    mesh.finish()


def build_armillary_sphere():
    """An ashlar pedestal under three tilted bronze rings and a brass orb."""
    mesh = KitMesh('armillary_sphere')
    mesh.tube([(0, -.05, 0), (0, .18, 0), (0, .95, 0)], [.40, .34, .32], material='moon_ashlar',
              color=ashlar_color(), sides=8)
    ring_band(mesh, .95, 1.03, .28, .40, 'verdigris_bronze', lambda p: bronze_color(), segments=16)
    center = Vector((0, 1.50, 0))
    for radius, tilt, spin in ((.55, 0.0, .0), (.50, .6, 1.1), (.44, 1.2, 2.3)):
        up = Vector((math.sin(tilt) * math.cos(spin), math.cos(tilt), math.sin(tilt) * math.sin(spin))).normalized()
        _, side, other = frame(up)
        points = [center + (side * math.cos(i * TAU / 20) + other * math.sin(i * TAU / 20)) * radius
                  for i in range(21)]
        mesh.tube(points, [.030] * len(points), material='verdigris_bronze',
                  color=bronze_color(), sides=4)
    mesh.tube([(0, .90, 0), (0, 2.06, 0)], [.028, .022], material='bright_brass',
              color=brass_color(), sides=5)
    octahedron(mesh, center, .09, 'bright_brass', lambda p: brass_color())
    mesh.finish()


def build_scholar_bench():
    """A pale bench on ashlar feet with a back rail, an open book and a chart."""
    mesh = KitMesh('scholar_bench')
    for sx in (-1, 1):
        mesh.block((sx * .68, .22, 0), (.24, .50, .34), material='moon_ashlar',
                   color=ashlar_color(), bevel=.024)
        mesh.block((sx * .62, .70, -.16), (.075, .46, .075), material='pale_frame',
                   color=frame_color(), bevel=.010)
    mesh.block((0, .49, 0), (1.80, .07, .40), material='pale_frame', color=frame_color(), bevel=.014)
    mesh.block((0, .88, -.16), (1.40, .11, .06), material='pale_frame', color=frame_color(), bevel=.012)
    for sign in (-1, 1):
        mesh.block((.30 + sign * .13, .555, .04), (.26, .022, .21), material='pale_frame',
                   color=(.95, .93, .98), bevel=0, yaw=sign * .16)
    mesh.tube([(-.52, .565, .06), (-.16, .565, .00)], [.055, .055], material='pale_frame',
              color=frame_color(), sides=6)
    mesh.finish()


# ---------------------------------------------------------------------- grove

def moon_leaf(mesh, base, forward, side, length, width, tint, limit):
    """One ovate lavender leaf as a single quad: base, two shoulders and a tip."""
    quad = tuple(clamp_radius(p, limit) for p in
                 (Vector(base), Vector(base) + forward * (length * .38) + side * width,
                  Vector(base) + forward * length, Vector(base) + forward * (length * .38) - side * width))
    mesh.polygon(quad, 'lavender_leaf', [(tint[0] * .92, tint[1] * .94, tint[2] * .93), tint, tint,
                                         (tint[0] * 1.0, tint[1] * .99, tint[2] * 1.0)], smooth=True)


def leaf_cluster(mesh, origin, direction, rng, limit, scale=1.0):
    """A short twig carrying three pairs of leaves and one terminal leaf."""
    direction = unit(direction)
    tip = clamp_radius(Vector(origin) + direction * (.40 * scale), limit)
    mesh.tube([Vector(origin), tip], [.026 * scale, .011 * scale], material='silver_bark',
              color=bark_color(rng), sides=3)
    for k in range(3):
        anchor = Vector(origin).lerp(tip, .26 + k * .30)
        forward, side, up = frame(direction, rng.uniform(-.9, .9))
        for sign in (-1, 1):
            swing = (forward * .55 + side * (sign * .82) + Vector((0, rng.uniform(-.34, .04), 0))).normalized()
            _, across, _ = frame(swing, rng.uniform(-.6, .6))
            moon_leaf(mesh, anchor, swing, across, .42 * scale * rng.uniform(.84, 1.14),
                      .125 * scale * rng.uniform(.86, 1.14), leaf_color(rng), limit)
    _, across, _ = frame(direction, rng.uniform(-.6, .6))
    moon_leaf(mesh, tip, direction, across, .42 * scale * rng.uniform(.86, 1.10),
              .118 * scale * rng.uniform(.88, 1.10), leaf_color(rng), limit)


def curling_limb(mesh, rng, origin, angle, turn, reach, rise, radius, limit, sides=5):
    """A limb spiralling at least 120 degrees around the trunk axis as it rises."""
    steps = 6
    spine, radii = [], []
    for i in range(steps):
        t = i / (steps - 1)
        swing = angle + turn * t
        span = reach * t ** .78
        point = Vector(origin) + Vector((math.sin(swing) * span, rise * t ** .74, math.cos(swing) * span))
        spine.append(clamp_radius(point, limit))
        radii.append(radius * (1 - .74 * t))
    mesh.tube(spine, radii, material='silver_bark', color=bark_color(rng), sides=sides)
    return spine


def limb_sites(spine, count, low=.48):
    """Leaf sites spread along the outer half of a limb, not only at its tip."""
    sites = []
    for i in range(count):
        t = low + (1 - low) * (i / max(1, count - 1))
        point = along(spine, t)
        forward = (along(spine, min(1.0, t + .08)) - along(spine, max(0.0, t - .08)))
        if forward.length < 1e-4:
            forward = Vector((0, 1, 0))
        sites.append((point, forward.normalized()))
    return sites


def silver_tree(name, trunk, radii, limbs, clusters, branch_limit, leaf_limit, canopy_limit, motes=6):
    """A curling silver tree: sinuous trunk, spiralling limbs, twigs and leaves."""
    mesh = KitMesh(name)
    rng = RNG
    for low in range(0, len(trunk) - 1, 2):
        high = min(low + 2, len(trunk) - 1)
        mesh.tube(trunk[low:high + 1], radii[low:high + 1], material='silver_bark',
                  color=bark_color(rng), sides=8)
    sites, tips = [], []
    for angle, turn, reach, rise, height, radius in limbs:
        origin = along(trunk, height)
        spine = curling_limb(mesh, rng, origin, angle, turn, reach, rise, radius, branch_limit)
        sites += limb_sites(spine, 5)
        tips.append(spine[-1])
        for k in range(4):
            root = along(spine, .46 + k * .18)
            swing = angle + turn * (.46 + k * .18) + (1 if k % 2 else -1) * rng.uniform(.75, 1.25)
            end = clamp_radius(root + Vector((math.sin(swing), 0, math.cos(swing))) * rng.uniform(.48, .82)
                               + Vector((0, rng.uniform(.26, .62), 0)), branch_limit)
            mesh.tube([root, root.lerp(end, .55) + Vector((0, .06, 0)), end], [.052, .038, .024],
                      material='silver_bark', color=bark_color(rng), sides=4)
            sites += limb_sites([root, end], 3, low=.30)
            tips.append(end)
    for k in range(clusters):
        point, forward = sites[k % len(sites)]
        radial_swing = k * 2.3999 + rng.uniform(-.30, .30)
        outward = Vector((math.cos(radial_swing), 0, math.sin(radial_swing)))
        anchor = clamp_radius(point + outward * (.06 + (k // len(sites)) * .12)
                              + Vector((0, rng.uniform(-.10, .10), 0)), leaf_limit)
        direction = forward * .55 + outward * .78 + Vector((0, rng.uniform(-.44, .18), 0))
        leaf_cluster(mesh, anchor, direction, rng, canopy_limit, scale=rng.uniform(.86, 1.14))
    for k in range(motes):
        tip = tips[(k * 5 + 2) % len(tips)]
        hang = Vector((tip.x, tip.y - rng.uniform(.30, .52), tip.z))
        mesh.tube([tip, hang], [.014, .011], material='silver_bark', color=bark_color(rng), sides=3)
        octahedron(mesh, hang - Vector((0, .07, 0)), .07, 'moon_glass', lambda p: glass_color(0), squash=1.3)
    mesh.finish()


def build_silver_tree_a():
    trunk = [(0, -.22, 0), (0, .58, 0), (.05, 1.45, .03), (.18, 2.35, .11), (.36, 3.25, .19),
             (.52, 4.10, .21), (.55, 5.05, .12), (.42, 6.05, .01)]
    radii = [.345, .332, .312, .284, .250, .214, .172, .125]
    limbs = ((.55, 2.55, 2.15, 2.10, .44, .155), (2.35, -2.45, 2.05, 2.45, .58, .145),
             (4.05, 2.70, 1.95, 2.55, .72, .135), (5.55, -2.30, 1.75, 2.75, .88, .115))
    silver_tree('silver_tree_a', trunk, radii, limbs, 112, 2.62, 2.72, 3.38)


def build_silver_tree_b():
    trunk = [(0, -.22, 0), (0, .62, 0), (.06, 1.60, .04), (.22, 2.70, .14), (.46, 3.85, .24),
             (.66, 5.00, .26), (.72, 6.10, .16), (.60, 7.10, .04), (.44, 7.70, -.04)]
    radii = [.392, .378, .356, .326, .292, .256, .216, .176, .140]
    limbs = ((1.05, 2.60, 2.35, 2.10, .40, .175), (3.05, -2.50, 2.25, 2.35, .54, .165),
             (5.05, 2.75, 2.15, 2.30, .70, .150), (0.15, -2.35, 1.95, 2.85, .86, .130))
    silver_tree('silver_tree_b', trunk, radii, limbs, 148, 3.02, 3.12, 3.78, motes=6)


def build_moon_mushroom():
    """Pale stem, broad lilac cap, a luminous gill ring and pale cap spots."""
    mesh = KitMesh('moon_mushroom')
    rng = RNG
    mesh.tube([(0, -.05, 0), (0, .75, 0), (.07, 1.70, .02), (.13, 2.62, .04)],
              [.30, .278, .246, .220], material='mushroom_stem', color=stem_color(rng), sides=10)
    cap, radius, thickness, sides, rows = Vector((.15, 2.60, .05)), 1.60, .68, 12, 4
    for j in range(rows):
        for i in range(sides):
            corners, shades = [], []
            for t, edge in ((j / rows, 0), ((j + 1) / rows, 1)):
                phi = t * math.pi * .5
                r, y = radius * math.cos(phi), cap.y + thickness * math.sin(phi)
                pair = (i * TAU / sides, (i + 1) * TAU / sides)
                if edge:
                    pair = tuple(reversed(pair))
                for angle in pair:
                    corners.append(Vector((cap.x + math.cos(angle) * r, y, cap.z + math.sin(angle) * r)))
                    shades.append(cap_color(t, rng))
            faced_polygon(mesh, corners, sum(corners, Vector()) / 4 - Vector((cap.x, cap.y - .5, cap.z)),
                          'mushroom_cap', shades, smooth=True)
    disc(mesh, cap + Vector((0, .015, 0)), (0, -1, 0), (0, 0, 1), radius * .995, 'mushroom_cap',
         lambda p: cap_color(.1, rng), sides=sides)
    annulus(mesh, cap - Vector((0, .05, 0)), (0, -1, 0), (0, 0, 1), 1.10, 1.52, 'moon_glass',
            lambda p: glass_color(0), sides=12)
    for k in range(5):
        angle = k * 1.2566 + .6
        t = .34 + (k % 3) * .16
        phi = t * math.pi * .5
        r, y = radius * math.cos(phi), cap.y + thickness * math.sin(phi)
        spot = Vector((cap.x + math.cos(angle) * r, y, cap.z + math.sin(angle) * r))
        outward = unit(Vector((math.cos(angle) * thickness * math.cos(phi), radius * math.sin(phi),
                               math.sin(angle) * thickness * math.cos(phi))))
        disc(mesh, spot + outward * .015, outward, (0, 1, 0), .13 - (k % 3) * .022,
             'mushroom_stem', lambda p: stem_color(rng), sides=8)
    mesh.finish()


def build_moon_crystal():
    """Faceted moon-glass shards on a small ashlar rock base; two primitives."""
    mesh = KitMesh('moon_crystal')
    rng = RNG
    rock_prism(mesh, (0, -.05, 0), .42, .26, 'moon_ashlar', lambda p: ashlar_color(rng),
               sides=7, squash=.9, yaw=.4, rng=rng)
    for cx, cz, radius, height, lean, spin in ((.00, .00, .190, 1.40, .05, .4), (-.19, .12, .145, 1.12, .16, 2.3),
                                               (.20, .13, .125, .98, .18, 4.1), (-.06, -.21, .105, .86, .16, 5.4),
                                               (.13, -.19, .085, .68, .20, .9)):
        shard(mesh, (cx, .11, cz), radius, height, lean, spin, 'moon_glass',
              lambda p: glass_color(clamp(1 - p.y * .6)))
    mesh.finish()


def build_moon_boulder():
    """A rounded pale moon-grey boulder with embedded moon-glass shard clusters."""
    mesh = KitMesh('moon_boulder')
    rng = RNG
    rock_prism(mesh, (0, -.40, 0), 1.88, 3.90, 'moon_ashlar', lambda p: ashlar_color(rng),
               sides=10, squash=.9, yaw=.3, rng=rng)
    rock_prism(mesh, (-.98, -.26, .60), .92, 2.30, 'moon_ashlar', lambda p: ashlar_color(rng),
               sides=8, squash=.92, yaw=1.1, rng=rng)
    rock_prism(mesh, (1.02, -.30, -.55), .78, 1.55, 'moon_ashlar', lambda p: ashlar_color(rng),
               sides=7, squash=.95, yaw=2.4, rng=rng)
    rock_prism(mesh, (-.28, 2.85, .22), .78, .72, 'moon_ashlar', lambda p: ashlar_color(rng),
               sides=8, squash=.9, yaw=.8, rng=rng)
    # Shard clusters break out of the flank, so each cluster sits on the taper.
    for angle, reach, y in ((.55, 1.62, .95), (2.12, 1.48, 1.90), (3.69, 1.70, .40), (5.26, 1.55, 1.40)):
        for j in range(3):
            spin = angle + (j - 1) * .6
            base = (math.cos(angle) * reach + math.cos(spin) * .14, y,
                    math.sin(angle) * reach * .92 + math.sin(spin) * .14)
            shard(mesh, base, .085 - j * .016, .52 - j * .12, .45, spin, 'moon_glass',
                  lambda p, floor=y: glass_color(clamp(1 - (p.y - floor) * 1.2)))
    mesh.finish()


def build_moonbell_clump():
    """Seven arching stems with hanging bells; one moonbell primitive."""
    mesh = KitMesh('moonbell_clump')
    rng = RNG
    stem, bell = (.74, .90, .78), (1.0, .97, 1.0)
    for k in range(7):
        angle = k * 2.3999 + rng.uniform(-.24, .24)
        lean = rng.uniform(.16, .30)
        tall = rng.uniform(.44, .60)
        base = Vector((math.cos(angle) * .05, -.02, math.sin(angle) * .05))
        out = Vector((math.cos(angle), 0, math.sin(angle)))
        crest = base + out * (lean * .60) + Vector((0, tall, 0))
        tip = base + out * lean + Vector((0, tall - .10, 0))
        mesh.tube([base, base + out * (lean * .22) + Vector((0, tall * .52, 0)), crest, tip],
                  [.014, .012, .010, .009], material='moonbell', color=stem, sides=3)
        mesh.tube([tip, tip - Vector((0, .095, 0))], [.085, .026], material='moonbell', color=bell, sides=5)
    mesh.finish()


# ------------------------------------------------------------------ inspection

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
    assert not gltf.get('images') and not gltf.get('textures'), 'Moonwatch kit must not duplicate shared textures'
    assert all('uri' not in buffer for buffer in gltf['buffers'])
    assert {mat['name'] for mat in gltf['materials']} == set(MATERIAL_BINDINGS)
    shared = json.loads((ROOT / 'client/assets/old-watch/manifest.json').read_text())
    assert hashlib.sha256((ROOT / 'client/assets/old-watch/kit.glb').read_bytes()).hexdigest() == shared['sha256']
    manifest = {
        'schemaVersion': 1, 'generator': 'tools/build-moonwatch.py', 'seed': SEED,
        'blenderVersion': bpy.app.version_string, 'coordinateSystem': 'Y-up, meters, +Z front',
        'sourceLicense': 'Original Skywake Isles project assets; see CREDITS.md',
        'file': 'kit.glb', 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
        'dependencies': [{'url': SHARED_KIT, 'sha256': shared['sha256'],
                          'ownership': 'Shared cache owns original material textures and reusable props'}],
        'materialBindings': MATERIAL_BINDINGS, 'prefabs': {}, 'textures': [],
        'embeddedImageCount': 0, 'decodedTextureBytes': 0,
        'buildingContracts': {OBSERVATORY: dict(BUILDING_CONTRACT)},
        'propEnvelopes': {name: dict({'maxRadius': limit, 'minY': low, 'maxY': high},
                                     **({'trunkRadius': TRUNK_RADII[name]} if name in TRUNK_RADII else {}))
                          for name, (limit, low, high) in PROP_ENVELOPES.items()},
        'trunkRadii': {}, 'totalTriangles': 0, 'totalPrimitives': 0,
    }

    def values(index):
        accessor = gltf['accessors'][index]
        view = gltf['bufferViews'][accessor['bufferView']]
        assert accessor['componentType'] == 5126 and accessor['type'] == 'VEC3'
        assert view.get('byteStride', 12) == 12
        offset = bin_start + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        return np.frombuffer(raw, dtype='<f4', count=accessor['count'] * 3, offset=offset).reshape((-1, 3))

    def channels(index):
        """COLOR_0 as floats; glTF stores the exported vertex colours linear."""
        accessor = gltf['accessors'][index]
        view = gltf['bufferViews'][accessor['bufferView']]
        width = {'VEC3': 3, 'VEC4': 4}[accessor['type']]
        offset = bin_start + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        dtype, scale = {5121: ('<u1', 255.0), 5123: ('<u2', 65535.0), 5126: ('<f4', 1.0)}[accessor['componentType']]
        data = np.frombuffer(raw, dtype=dtype, count=accessor['count'] * width, offset=offset)
        return data.reshape((-1, width))[:, :3].astype(np.float64) / scale

    trunks, tints = {}, {}
    for name, index in roots.items():
        minimum = np.array([float('inf')] * 3)
        maximum = -minimum
        triangles, primitives, radius, materials = 0, 0, 0, set()
        todo = [index]
        meshes = 0
        while todo:
            node = nodes[todo.pop()]
            todo.extend(node.get('children', []))
            assert not any(key in node for key in ('matrix', 'translation', 'rotation', 'scale')), name
            if 'mesh' not in node:
                continue
            meshes += 1
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
                colors = channels(attributes['COLOR_0'])
                total, count = tints.get(material, (0.0, 0))
                tints[material] = (total + float(colors.sum()), count + colors.size)
                # A runtime-scaled trunk must stay inside the recorded tree collider.
                if name in TRUNK_RADII and material == 'silver_bark':
                    low = positions[positions[:, 1] < 1.0]
                    if len(low):
                        trunks[name] = max(trunks.get(name, 0),
                                           float(np.linalg.norm(low[:, (0, 2)], axis=1).max()))
                triangles += gltf['accessors'][primitive['indices']]['count'] // 3
                primitives += 1
        assert meshes >= 1, f'{name}: no mesh child'
        manifest['prefabs'][name] = {'bounds': {'min': minimum.round(5).tolist(), 'max': maximum.round(5).tolist()},
                                     'dimensions': (maximum - minimum).round(5).tolist(),
                                     'horizontalRadius': round(radius, 5), 'triangles': triangles,
                                     'primitives': primitives, 'materials': sorted(materials)}
    for name, prefab in manifest['prefabs'].items():
        low, high = prefab['bounds']['min'], prefab['bounds']['max']
        if name == OBSERVATORY:
            assert prefab['horizontalRadius'] <= BUILDING_CONTRACT['radius'], (name, prefab['horizontalRadius'])
            assert low[1] >= BUILDING_CONTRACT['minY'] - .0006, (name, low)
            assert high[1] <= BUILDING_CONTRACT['maxY'], (name, high)
            continue
        limit, floor, ceiling = PROP_ENVELOPES[name]
        assert prefab['horizontalRadius'] <= limit, (name, prefab['horizontalRadius'], limit)
        assert low[1] >= floor - .0006 and high[1] <= ceiling, (name, low, high)
    for name, limit in TRUNK_RADII.items():
        assert name in trunks, f'{name}: no silver_bark trunk below y 1'
        assert trunks[name] <= limit + .0002, (name, trunks[name], limit)
    assert manifest['prefabs']['moonbell_clump']['primitives'] == 1, 'moonbell_clump must instance as one primitive'
    assert manifest['prefabs']['moon_crystal']['primitives'] <= 2, manifest['prefabs']['moon_crystal']
    averages = {name: total / count for name, (total, count) in sorted(tints.items())}
    for name, average in averages.items():
        assert average >= .70, f'{name} COLOR_0 average {average:.3f} would darken the shared texture'
    manifest['trunkRadii'] = {name: round(value, 5) for name, value in sorted(trunks.items())}
    manifest['totalTriangles'] = sum(p['triangles'] for p in manifest['prefabs'].values())
    manifest['totalPrimitives'] = sum(p['primitives'] for p in manifest['prefabs'].values())
    assert manifest['bytes'] < 3.5 * 1024 * 1024, manifest['bytes']
    assert manifest['totalTriangles'] < 40000, manifest['totalTriangles']
    return manifest, averages


def preview(path):
    loader = importlib.util.spec_from_file_location('old_watch_preview', ROOT / 'tools/build-old-watch.py')
    old_watch = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(old_watch)
    with tempfile.TemporaryDirectory(prefix='skywake-moonwatch-preview-') as temporary:
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
                if 'emissive' in binding:
                    shader.inputs['Emission Color'].default_value = tuple(binding['emissive']) + (1,)
                    shader.inputs['Emission Strength'].default_value = binding.get('emissiveIntensity', 1)
                if 'normalScale' in binding:
                    for node in material.node_tree.nodes:
                        if node.type == 'NORMAL_MAP':
                            node.inputs['Strength'].default_value = binding['normalScale']
                child.data.materials[0] = material
        positions = {OBSERVATORY: (-10.5, 0, 0.0), 'star_telescope': (-4.6, 0, -2.4),
                     'star_table': (-1.4, 0, -2.4), 'chart_crate': (1.6, 0, -2.4),
                     'moon_lantern': (3.4, 0, -2.4), 'armillary_sphere': (5.0, 0, -2.4),
                     'scholar_bench': (7.0, 0, -2.4), 'silver_tree_a': (-4.0, 0, 6.5),
                     'silver_tree_b': (2.5, 0, 7.5), 'moon_mushroom': (8.6, 0, 4.0),
                     'moon_crystal': (10.6, 0, -1.0), 'moon_boulder': (12.4, 0, 3.0),
                     'moonbell_clump': (9.6, 0, -2.4)}
        for name, root in PREFABS.items():
            root.location = game_to_blender(positions[name])
        bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.02))
        bpy.context.object.data.materials.append(MATERIALS['ground_earth'])
        scene = bpy.context.scene
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = 32
        scene.cycles.use_denoising = True
        world = bpy.data.worlds.new('moonwatch_preview_world')
        world.use_nodes = True
        world.node_tree.nodes.get('Background').inputs['Color'].default_value = (.42, .43, .58, 1)
        world.node_tree.nodes.get('Background').inputs['Strength'].default_value = 1.1
        scene.world = world
        bpy.ops.object.light_add(type='AREA', location=(-12, -12, 24))
        key = bpy.context.object
        key.data.energy, key.data.shape, key.data.size = 7000, 'DISK', 14
        key.data.color = (.92, .94, 1)
        key.rotation_euler = (Vector((0, 0, 3)) - key.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.ops.object.camera_add(location=(15, -32, 17))
        camera = bpy.context.object
        camera.rotation_euler = (Vector((0, 1.5, 3.4)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.type, camera.data.ortho_scale = 'ORTHO', 32
        scene.camera = camera
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1800, 1200, 100
        scene.view_settings.view_transform = 'AgX'
        path.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'client/assets/moonwatch')
    parser.add_argument('--preview', type=pathlib.Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    args.output.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for name, binding in MATERIAL_BINDINGS.items():
        create_binding_material(name, double_sided=binding.get('doubleSided', False))
    build_observatory()
    build_star_telescope()
    build_star_table()
    build_chart_crate()
    build_moon_lantern()
    build_armillary_sphere()
    build_scholar_bench()
    build_silver_tree_a()
    build_silver_tree_b()
    build_moon_mushroom()
    build_moon_crystal()
    build_moon_boulder()
    build_moonbell_clump()
    output = args.output / 'kit.glb'
    export_glb(output)
    manifest, averages = inspect_glb(output)
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    tints = ' '.join(f'{name} {value:.3f}' for name, value in averages.items())
    print(f'MOONWATCH_OK: {len(PREFABS)} prefabs, {manifest["totalTriangles"]:,} triangles, '
          f'{manifest["totalPrimitives"]} primitives, {manifest["bytes"]:,} bytes, COLOR_0 {tints}')
    if args.preview:
        preview(args.preview.resolve())


if __name__ == '__main__':
    main()
