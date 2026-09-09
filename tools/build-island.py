"""Build the Sunwake coast and Haven shoreline geometry-only environment kit.

    blender --background --factory-startup --python-exit-code 1 --python tools/build-island.py

Named slots borrow Old Watch's original textures at runtime, the same extension
pattern as Windward Farm, Tideglass Market, Saltwind Harbor, Driftwood Yard,
Palmheart Camp, the Cinderworks and Moonwatch. --output supports independent
byte comparisons; --preview creates an untracked textured contact sheet after
export, without putting preview images into the shipping GLB.

Milestone 9 slice 1: the coast every voyage starts from. Nothing here repeats a
shipped row -- Palmheart's palms are deep-green jungle palms with a dead-frond
skirt on a dark ringed trunk, these are bleached coconut palms leaning out over
the water, and no kit yet has a boat or a pale surf-worn rock.

  coast_palm_a  leaning coconut palm, ringed pale trunk on a flared buried foot,
                nine arching pinnate fronds, three dead straw fronds, five nuts
  coast_palm_b  slimmer S-curved palm leaning harder, eight fronds, one dead
                frond, three nuts
  coast_rock_a  tall surf-worn boulder, flat top ledge, two shoulder lumps, a
                seam crack and a tide stain carried by vertex colour
  coast_rock_b  lower boulder split into two lobes by a cleft
  fishing_skiff_a/b  clinker hull on five strakes a side with the top two
                painted, stem and stern posts, thwarts and a stern bench,
                shipped oars, a rope coil, iron oarlocks and a stem cleat, and a
                short mast carrying a brailed-up sail bundle on its yard

The palms are the only roots with a trunk contract: the collidable coast palms
scale up to 1.14 inside 2.0 m colliders, so every palm_trunk vertex stays inside
1.60 m of the origin at scale 1.

Vertex colours are authored in sRGB and exported linear, so the per-slot COLOR_0
averages the validator prints (and holds above .70) sit well below the authored
values; the Cinderworks basalt lesson is that a dark slot average multiplies an
already dark shared texture into a black silhouette, and the tide stain is the
only place this kit darkens anything.
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
SEED = 920417
RNG = random.Random(SEED)
TAU = math.tau
SHARED_KIT = '/assets/old-watch/kit.glb'
# Mirrors ISLAND_MATERIAL_BINDINGS in client/island.js byte for byte. Tints are
# linear multipliers over the measured shared texture means (timber/bark
# 104/93/74 sRGB, earth 86/77/57, foliage 83/108/54, stone 96/98/89), so a warm
# pale coast needs every channel well above 1 and the painted strakes need one
# channel far above the others to beat the warm timber base.
MATERIAL_BINDINGS = {
    'palm_trunk': {'source': 'pine_bark', 'color': [2.70, 2.60, 2.60], 'normalScale': .80},
    'coast_frond': {'source': 'needle_foliage', 'color': [3.20, 3.30, 2.00], 'normalScale': .50,
                    'doubleSided': True},
    'dead_frond': {'source': 'aged_timber', 'color': [2.40, 1.90, 1.20], 'normalScale': .40,
                   'doubleSided': True},
    'coconut': {'source': 'ground_earth', 'color': [1.60, 1.50, .90], 'normalScale': .60},
    'coast_stone': {'source': 'watch_stone', 'color': [5.20, 4.20, 3.40], 'normalScale': .80},
    'skiff_plank': {'source': 'aged_timber', 'color': [4.20, 3.90, 3.40], 'normalScale': .40},
    'skiff_teal': {'source': 'aged_timber', 'color': [.45, 3.40, 4.80], 'normalScale': .40},
    'skiff_coral': {'source': 'aged_timber', 'color': [6.60, 2.20, 2.20], 'normalScale': .40},
    'skiff_canvas': {'source': 'ground_earth', 'color': [8.50, 8.00, 6.80], 'normalScale': .18,
                     'doubleSided': True},
    'hemp_rope': {'source': 'needle_foliage', 'color': [2.60, 1.70, 1.10]},
    'forged_iron': {'source': 'forged_iron'},
}
EXPECTED = ['coast_palm_a', 'coast_palm_b', 'coast_rock_a', 'coast_rock_b',
            'fishing_skiff_a', 'fishing_skiff_b']
# root -> (maximum horizontal radius, minimum y, maximum y).
PROP_ENVELOPES = {
    'coast_palm_a': (4.60, -.40, 8.60),
    'coast_palm_b': (4.60, -.40, 7.80),
    'coast_rock_a': (2.50, -.40, 5.00),
    'coast_rock_b': (2.00, -.40, 3.00),
    'fishing_skiff_a': (2.40, -.40, 3.70),
    'fishing_skiff_b': (2.40, -.40, 3.70),
}
# Every palm_trunk vertex stays inside this horizontal reach, so a runtime-scaled
# collidable palm keeps its whole trunk inside its 2.0 m collider.
TRUNK_RADII = {'coast_palm_a': 1.60, 'coast_palm_b': 1.60}
TRIANGLE_BUDGETS = {'coast_palm_a': 4200, 'coast_palm_b': 4000, 'coast_rock_a': 1400,
                    'coast_rock_b': 1200, 'fishing_skiff_a': 3200, 'fishing_skiff_b': 3200}
# Slice 1 guard; later slices grow the kit toward the usual 3.5 MiB / 40k.
KIT_BYTE_LIMIT = int(2.5 * 1024 * 1024)
KIT_TRIANGLE_LIMIT = 24000


# ------------------------------------------------------------------- primitives

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
    mesh.polygon(points, material=material, color=colors, smooth=smooth)


def clamp_radius(point, limit):
    radius = math.hypot(point.x, point.z)
    if radius <= limit or radius < 1e-6:
        return Vector(point)
    return Vector((point.x * limit / radius, point.y, point.z * limit / radius))


def rope_coil(mesh, center, radius, rng, *, turns=2, rise=.05, tube=.024):
    """A flaked hemp coil; three-sided so a whole coil stays under 60 triangles."""
    cx, cy, cz = center
    points = [(cx + math.cos(a) * radius, cy + rise * a / TAU, cz + math.sin(a) * radius)
              for a in [i * TAU / 9 for i in range(9 * turns + 1)]]
    mesh.tube(points, [tube] * len(points), material='hemp_rope', color=rope_shade(rng), sides=3)


# ----------------------------------------------------------------------- colour

def bark_shade(rng=RNG):
    """Sun-bleached warm grey-tan, with the odd brighter salt-dried band."""
    shade = rng.uniform(.94, 1.0) if rng.random() < .28 else rng.uniform(.88, .99)
    return (shade, shade * .985, shade * .955)


def frond_shade(t, rng=RNG):
    """Bright yellow-green; the rachis end is a shade deeper than the tips."""
    shade = rng.uniform(.90, 1.0) * (.96 + .04 * t)
    return (shade * .98, shade, shade * .93)


def straw_shade(rng=RNG):
    """A dead frond hanging under the crown: dry, warm, still bright."""
    shade = rng.uniform(.90, 1.0)
    return (shade, shade * .965, shade * .930)


def nut_shade(rng=RNG):
    shade = rng.uniform(.88, 1.0)
    return (shade, shade * .960, shade * .920)


def stone_shade(y, dim, tide, rng=RNG):
    """Pale warm limestone; the tide band below `tide` darkens and warms, mildly."""
    stain = clamp((tide - y) / .95)
    shade = rng.uniform(.94, 1.0) * dim
    return (shade * (1 - .08 * stain), shade * (1 - .10 * stain), shade * (1 - .14 * stain))


def plank_shade(rng=RNG):
    shade = rng.uniform(.90, 1.0)
    return (shade, shade * .990, shade * .975)


def paint_shade(rng=RNG):
    shade = rng.uniform(.92, 1.0)
    return (shade, shade * .990, shade * .990)


def canvas_shade(rng=RNG):
    shade = rng.uniform(.92, 1.0)
    return (shade, shade * .990, shade * .970)


def rope_shade(rng=RNG):
    shade = rng.uniform(.90, 1.0)
    return (shade, shade * .970, shade * .940)


def iron_shade(rng=RNG):
    shade = rng.uniform(.93, 1.0)
    return (shade, shade, shade)


# ------------------------------------------------------------------------ palms

PALM_SPECS = {
    'coast_palm_a': {
        'crown': (0.0, 7.00, 1.10), 'foot': .30, 'top': .18, 'lean': 1.70, 'sway': .00,
        'drift': .00, 'flare': .95, 'steps': 15, 'sides': 8, 'reach': 4.50,
        'fronds': 9, 'length': (3.30, 4.00), 'leaflets': 28, 'rise': 1.45, 'drop': 2.15,
        'spin': .18, 'dead': 3, 'coconuts': 5, 'nut': .135,
    },
    'coast_palm_b': {
        'crown': (0.0, 6.20, 1.35), 'foot': .26, 'top': .16, 'lean': 1.95, 'sway': .21,
        'drift': .09, 'flare': .90, 'steps': 15, 'sides': 8, 'reach': 4.50,
        'fronds': 8, 'length': (3.20, 3.85), 'leaflets': 26, 'rise': 1.32, 'drop': 2.05,
        'spin': .74, 'dead': 1, 'coconuts': 3, 'nut': .125,
    },
}


def palm_trunk(spec):
    """Stations from the buried flared foot up to the crown, leaning toward +Z.

    The alternating radius is the ring of leaf scars a coconut palm carries all
    the way up its trunk; it costs nothing over a plain taper.
    """
    crown = Vector(spec['crown'])
    points, radii = [], []
    for i in range(spec['steps']):
        t = i / (spec['steps'] - 1)
        z = crown.z * t ** spec['lean'] - spec['sway'] * math.sin(t * math.pi)
        x = spec['drift'] * math.sin(t * math.pi * .9)
        y = -.40 + (crown.y + .40) * t
        flare = 1 + spec['flare'] * max(0.0, 1 - t / .14) ** 1.7
        taper = spec['foot'] + (spec['top'] - spec['foot']) * t ** .82
        points.append(Vector((x, y, z)))
        radii.append(taper * flare * (1.055 if i % 2 else .992))
    # The buried foot drops straight down, so the flared base ring stays level on
    # the envelope floor instead of dipping a tube radius below it.
    points[0] = Vector((points[1].x, -.40, points[1].z))
    return points, radii


def frond_reach(crown, angle, limit):
    """The frond length whose tip lands exactly on the envelope's horizontal limit."""
    along = crown.z * math.cos(angle)
    return -along + math.sqrt(along * along + limit * limit - crown.z * crown.z)


def pinnate_frond(mesh, origin, angle, length, rng, *, material, leaflets, rise, drop, limit,
                  spine_material, spine_shade, width=.175, hang=.85):
    """An arching pinnate frond: a tapered rachis carrying paired drooping leaflets."""
    direction = Vector((math.sin(angle), 0, math.cos(angle)))
    sideways = Vector((math.cos(angle), 0, -math.sin(angle)))

    def spine(t):
        point = (Vector(origin) + direction * (length * t)
                 + Vector((0, rise * math.sin(t * math.pi * .80) - drop * t ** 2.5, 0)))
        return clamp_radius(point, limit)

    points = [spine(i / 11) for i in range(12)]
    mesh.tube(points, [length * .0145 * (1 - i / 14) for i in range(12)],
              material=spine_material, color=spine_shade, sides=4)
    for j in range(2, leaflets):
        t = j / leaflets
        half = length * width * math.sin(t * math.pi) ** .45 * (1 - t * .26)
        center = spine(t)
        for sign in (-1, 1):
            shade = frond_shade(t, rng)
            end = (center + sideways * (sign * half) + direction * (half * .55)
                   + Vector((0, -half * hang, 0)))
            mid = center.lerp(end, .55) + Vector((0, half * .13, 0))
            spread = direction * (half * .18)
            quad = [clamp_radius(p, limit) for p in (center, mid - spread, end, mid + spread)]
            mesh.polygon(quad, material=material,
                         color=[(shade[0] * .93, shade[1] * .95, shade[2] * .93), shade, shade,
                                (shade[0], shade[1] * .99, shade[2])])


def coconut(mesh, center, radius, rng):
    """A husked green-brown nut; six sides is plenty at crown height."""
    cx, cy, cz = center
    shade = nut_shade(rng)
    mesh.tube([(cx, cy - radius, cz), (cx, cy - radius * .15, cz), (cx, cy + radius * .95, cz)],
              [radius * .42, radius, radius * .38], material='coconut', color=shade, sides=6)


def build_palm(name, spec):
    """One coconut palm: leaning ringed trunk, full crown, dead skirt and nuts."""
    mesh = KitMesh(name)
    rng = RNG
    crown = Vector(spec['crown'])
    points, radii = palm_trunk(spec)
    # Two spans a segment so every band of leaf scars carries its own weathering.
    for low in range(0, len(points) - 1, 2):
        high = min(low + 2, len(points) - 1)
        mesh.tube(points[low:high + 1], radii[low:high + 1], material='palm_trunk',
                  color=bark_shade(rng), sides=spec['sides'])
    collar = spec['top'] * 1.14
    mesh.tube([crown - Vector((0, .34, 0)), crown + Vector((0, .13, 0))], [collar, collar * .84],
              material='palm_trunk', color=bark_shade(rng), sides=spec['sides'])
    for k in range(spec['dead']):
        angle = k * TAU / max(1, spec['dead']) + spec['spin'] + 1.9
        reach = frond_reach(crown, angle, spec['reach'] - .10)
        pinnate_frond(mesh, crown + Vector((0, -.22, 0)), angle,
                      min(reach, rng.uniform(1.85, 2.35)), rng, material='dead_frond',
                      leaflets=13, rise=.10, drop=2.30, limit=spec['reach'],
                      spine_material='dead_frond', spine_shade=straw_shade(rng),
                      width=.150, hang=1.05)
    for k in range(spec['fronds']):
        angle = k * TAU / spec['fronds'] + spec['spin'] + rng.uniform(-.17, .17)
        reach = frond_reach(crown, angle, spec['reach'] - .12)
        length = min(reach, rng.uniform(*spec['length']))
        pinnate_frond(mesh, crown + Vector((0, rng.uniform(.02, .16), 0)), angle, length, rng,
                      material='coast_frond', leaflets=spec['leaflets'],
                      rise=spec['rise'] * rng.uniform(.86, 1.12),
                      drop=spec['drop'] * rng.uniform(.92, 1.10), limit=spec['reach'],
                      spine_material='coast_frond', spine_shade=frond_shade(.2, rng))
    for k in range(spec['coconuts']):
        angle = k * 2.3999 + spec['spin']
        radius = .20 + (k % 3) * .07
        coconut(mesh, (crown.x + math.cos(angle) * radius, crown.y - .30 - (k % 3) * .11,
                       crown.z + math.sin(angle) * radius), spec['nut'], rng)
    mesh.finish()


# ------------------------------------------------------------------------ rocks

ROCK_SPECS = {
    'coast_rock_a': {
        'limit': 2.46, 'floor': -.40, 'ceiling': 4.94, 'tide': 1.20,
        'lumps': (
            {'center': (0.0, -.40, 0.0), 'radius': 2.24, 'height': 5.28, 'sides': 18,
             'squash': .94, 'yaw': .35, 'wobble': .05,
             'profile': ((0.0, .84), (.08, .98), (.20, 1.02), (.34, 1.02), (.48, .97),
                         (.60, .90), (.72, .80), (.83, .68), (.92, .55), (1.0, .46)),
             'cracks': ({'index': 5, 'width': 1, 'depth': .19, 'low': .05, 'high': .82},
                        {'index': 13, 'width': 0, 'depth': .13, 'low': .30, 'high': .90})},
            {'center': (-1.35, 2.10, .66), 'radius': .84, 'height': 1.55, 'sides': 11,
             'squash': .95, 'yaw': 1.15, 'wobble': .04,
             'profile': ((0.0, .80), (.18, .98), (.38, 1.0), (.58, .90), (.78, .72),
                         (.92, .56), (1.0, .42)),
             'cracks': ()},
            {'center': (1.02, 3.05, -.52), 'radius': .68, 'height': 1.20, 'sides': 11,
             'squash': .96, 'yaw': 2.4, 'wobble': .04,
             'profile': ((0.0, .82), (.20, 1.0), (.42, .98), (.62, .88), (.80, .70),
                         (.92, .54), (1.0, .40)),
             'cracks': ()},
        ),
    },
    'coast_rock_b': {
        'limit': 1.97, 'floor': -.40, 'ceiling': 2.95, 'tide': .85,
        'lumps': (
            {'center': (-.56, -.40, -.06), 'radius': 1.24, 'height': 3.16, 'sides': 15,
             'squash': .95, 'yaw': .5, 'wobble': .04,
             'profile': ((0.0, .86), (.12, .99), (.28, 1.0), (.44, .96), (.60, .87),
                         (.74, .74), (.86, .60), (.94, .49), (1.0, .40)),
             'cracks': ({'index': 4, 'width': 1, 'depth': .16, 'low': .18, 'high': 1.0,
                         'rise': True},)},
            {'center': (.76, -.40, .18), 'radius': 1.00, 'height': 2.28, 'sides': 13,
             'squash': .94, 'yaw': 2.1, 'wobble': .04,
             'profile': ((0.0, .86), (.14, 1.0), (.34, .98), (.54, .90), (.72, .78),
                         (.88, .60), (1.0, .42)),
             'cracks': ({'index': 10, 'width': 1, 'depth': .16, 'low': .18, 'high': 1.0,
                         'rise': True},)},
        ),
    },
}


def fissure(cracks, i, sides, v):
    """How far a seam pulls this grid point in, and how much it darkens it."""
    pull = 0.0
    for crack in cracks:
        delta = ((i - crack['index'] + sides // 2) % sides) - sides // 2
        reach = crack['width']
        if abs(delta) > reach or not crack['low'] <= v <= crack['high']:
            continue
        across = 1 - abs(delta) / (reach + 1)
        fraction = (v - crack['low']) / (crack['high'] - crack['low'])
        span = fraction ** .55 if crack.get('rise') else math.sin(math.pi * fraction)
        pull = max(pull, crack['depth'] * across * span)
    return pull, 1 - .11 * (pull / .20 if pull else 0)


def boulder(mesh, lump, rng, *, limit, floor, ceiling, tide, material='coast_stone'):
    """A rounded surf-worn lump: one jittered lat-long shell over a flat top ledge."""
    cx, cy, cz = lump['center']
    sides, radius, height = lump['sides'], lump['radius'], lump['height']
    grid, tone = [], []
    for v, factor in lump['profile']:
        ring, shades = [], []
        for i in range(sides):
            angle = lump['yaw'] + i * TAU / sides
            pull, dim = fissure(lump['cracks'], i, sides, v)
            r = radius * factor * rng.uniform(.93, 1.07) * (1 - pull)
            y = cy + height * v + radius * lump['wobble'] * math.sin(angle * 2 + lump['yaw'])
            point = clamp_radius(Vector((cx + math.cos(angle) * r, y,
                                         cz + math.sin(angle) * r * lump['squash'])), limit)
            point.y = clamp(point.y, floor, ceiling)
            ring.append(point)
            shades.append(stone_shade(point.y, dim, tide, rng))
        grid.append(ring)
        tone.append(shades)
    axis = Vector((cx, cy + height * .5, cz))
    for j in range(len(grid) - 1):
        for i in range(sides):
            k = (i + 1) % sides
            quad = (grid[j][i], grid[j][k], grid[j + 1][k], grid[j + 1][i])
            faced_polygon(mesh, quad, sum(quad, Vector()) / 4 - axis, material,
                          (tone[j][i], tone[j][k], tone[j + 1][k], tone[j + 1][i]))
    faced_polygon(mesh, grid[-1], (0, 1, 0), material, tone[-1])
    faced_polygon(mesh, grid[0], (0, -1, 0), material, tone[0])


def build_rock(name, spec):
    """One surf-worn coast boulder; a shell per lump, no moss and nothing green."""
    mesh = KitMesh(name)
    for lump in spec['lumps']:
        boulder(mesh, lump, RNG, limit=spec['limit'], floor=spec['floor'],
                ceiling=spec['ceiling'], tide=spec['tide'])
    mesh.finish()


# ----------------------------------------------------------------------- skiffs

HULL_END, HULL_BEAM, KEEL_Y, SHEER_Y, ROCKER = 2.19, .95, -.35, .55, .20
STRAKES = (0.0, .21, .41, .61, .81, 1.0)
INNER = (0.0, .30, .58, .82, 1.0)
STATIONS = (-2.19, -1.98, -1.70, -1.36, -.96, -.52, 0.0, .52, .96, 1.36, 1.70, 1.98, 2.19)
LAP = .042
SKIFF_SPECS = {
    'fishing_skiff_a': {'paint': 'skiff_teal', 'sail': -1, 'coil': (.50, -1.42),
                        'oars': (((-.66, .20, 1.58), (.28, .02, -1.72)),
                                 ((-.42, .27, 1.66), (.52, .09, -1.60))),
                        'yard': ((.24, 1.24, .42), (.09, 3.30, -.96))},
    'fishing_skiff_b': {'paint': 'skiff_coral', 'sail': 1, 'coil': (-.46, 1.30),
                        'oars': (((.70, .19, -1.66), (-.24, .03, 1.68)),
                                 ((.44, .26, -1.58), (-.50, .10, 1.56))),
                        'yard': ((-.24, 1.24, .42), (-.09, 3.30, -.96))},
}


def hull_point(side, z, u):
    """A point on the hull surface; u runs 0 at the keel to 1 at the sheer."""
    t = min(1.0, abs(z) / HULL_END)
    fullness = 2.6 if z < 0 else 3.2  # a finer bow forward, a fuller run aft
    taper = max(0.0, 1 - t ** fullness) ** .52
    return Vector((side * HULL_BEAM * taper * u ** .58,
                   KEEL_Y + (SHEER_Y - KEEL_Y) * u ** 1.18 + ROCKER * t ** 2.4, z))


def hull_out(side, z, u):
    """Outward direction at a station: down at the keel, level at the sheer."""
    return unit(Vector((side * (.35 + .65 * math.sqrt(u)), -(.55 - .50 * u), 0)))


def inner_point(side, z, u):
    """The ceiling inside the hull, tucked in behind the strakes."""
    point = hull_point(side, z * .975, u)
    return Vector((point.x * .90, point.y + .045, point.z))


def hull_beam(z, u=1.0):
    return abs(inner_point(1, z, u).x) * 2


def skin_band(mesh, side, u0, u1, off0, off1, material, shade_of, rng):
    """One strake run: a lapped band of planking along the station line."""
    for z0, z1 in zip(STATIONS, STATIONS[1:]):
        shade = shade_of(rng)
        quad = (hull_point(side, z0, u0) + hull_out(side, z0, u0) * off0,
                hull_point(side, z1, u0) + hull_out(side, z1, u0) * off0,
                hull_point(side, z1, u1) + hull_out(side, z1, u1) * off1,
                hull_point(side, z0, u1) + hull_out(side, z0, u1) * off1)
        faced_polygon(mesh, quad, hull_out(side, (z0 + z1) * .5, (u0 + u1) * .5), material,
                      [shade] * 4)


def lap_step(mesh, side, u, inner_off, outer_off, material, shade_of, rng):
    """The plank edge above a lap; it faces down the shell and catches the shadow."""
    for z0, z1 in zip(STATIONS, STATIONS[1:]):
        shade = shade_of(rng)
        quad = (hull_point(side, z0, u) + hull_out(side, z0, u) * inner_off,
                hull_point(side, z1, u) + hull_out(side, z1, u) * inner_off,
                hull_point(side, z1, u) + hull_out(side, z1, u) * outer_off,
                hull_point(side, z0, u) + hull_out(side, z0, u) * outer_off)
        down = hull_point(side, (z0 + z1) * .5, max(0.0, u - .06)) - hull_point(side, (z0 + z1) * .5, u)
        faced_polygon(mesh, quad, down, material, [shade] * 4)


def build_hull(mesh, spec, rng):
    """Five clinker strakes a side with the top two painted, plus the ceiling."""
    paint = spec['paint']
    for index in range(len(STRAKES) - 1):
        u0, u1 = STRAKES[index], STRAKES[index + 1]
        material = paint if index >= 3 else 'skiff_plank'
        shade_of = paint_shade if index >= 3 else plank_shade
        for side in (-1, 1):
            skin_band(mesh, side, u0, u1, LAP if index else .006, .006, material, shade_of, rng)
            if index < len(STRAKES) - 2:
                above = paint if index + 1 >= 3 else 'skiff_plank'
                lap_step(mesh, side, u1, .006, LAP, above,
                         paint_shade if index + 1 >= 3 else plank_shade, rng)
    for u0, u1 in zip(INNER, INNER[1:]):
        for side in (-1, 1):
            for z0, z1 in zip(STATIONS, STATIONS[1:]):
                shade = plank_shade(rng)
                quad = (inner_point(side, z0, u0), inner_point(side, z1, u0),
                        inner_point(side, z1, u1), inner_point(side, z0, u1))
                faced_polygon(mesh, quad, -hull_out(side, (z0 + z1) * .5, (u0 + u1) * .5),
                              'skiff_plank', [shade] * 4)
    for side in (-1, 1):
        for z0, z1 in zip(STATIONS, STATIONS[1:]):
            shade = paint_shade(rng)
            quad = (hull_point(side, z0, 1.0) + hull_out(side, z0, 1.0) * .006,
                    hull_point(side, z1, 1.0) + hull_out(side, z1, 1.0) * .006,
                    inner_point(side, z1, 1.0), inner_point(side, z0, 1.0))
            faced_polygon(mesh, quad, (0, 1, 0), paint, [shade] * 4)
    for z0, z1 in zip(STATIONS[::2], STATIONS[2::2]):
        keel = (hull_point(1, z0, 0) + hull_point(1, z1, 0)) * .5
        mesh.block((keel.x, keel.y - .02, keel.z), (.11, .055, z1 - z0 + .02),
                   material='skiff_plank', color=plank_shade(rng), bevel=0)
    for sign, top in ((-1, .96), (1, .84)):
        end = Vector((0, KEEL_Y + ROCKER * .92, sign * (HULL_END - .04)))
        mesh.block((0, (end.y + top) * .5, end.z + sign * .01), (.115, top - end.y, .18),
                   material='skiff_plank', color=plank_shade(rng), bevel=.012)
        mesh.block((0, top + .045, end.z + sign * .005), (.13, .09, .19),
                   material=spec['paint'], color=paint_shade(rng), bevel=.014)


def build_fitout(mesh, spec, rng):
    """Thwarts, a stern bench, floorboards and the bilge stringers."""
    for z, depth in ((-.90, .26), (.42, .26), (1.52, .44)):
        mesh.block((0, .30, z), (hull_beam(z, .82), .062, depth), material='skiff_plank',
                   color=plank_shade(rng), bevel=.012)
        for side in (-1, 1):
            mesh.block((side * (hull_beam(z, .82) * .5 - .08), .21, z), (.10, .20, depth * .72),
                       material='skiff_plank', color=plank_shade(rng), bevel=.010)
    for z in (-1.55, -.35, .95):
        mesh.block((0, -.09, z), (hull_beam(z, .34), .040, .40), material='skiff_plank',
                   color=plank_shade(rng), bevel=0)
    for side in (-1, 1):
        for z0, z1 in zip(STATIONS[2:-2:2], STATIONS[4::2]):
            a, b = inner_point(side, z0, .52), inner_point(side, z1, .52)
            mesh.block(((a + b) * .5), (.05, .075, (b - a).length), material='skiff_plank',
                       color=plank_shade(rng), bevel=0, yaw=math.atan2(b.x - a.x, b.z - a.z))


def build_oar(mesh, loom, tip, rng):
    """A shipped oar: a tapered loom and a flat blade, stowed inboard."""
    loom, tip = Vector(loom), Vector(tip)
    axis = tip - loom
    shade = plank_shade(rng)
    mesh.tube([loom, loom.lerp(tip, .80)], [.036, .028], material='skiff_plank',
              color=shade, sides=5)
    mesh.block(loom.lerp(tip, .885), (.165, .56, .024), material='skiff_plank',
               color=plank_shade(rng), bevel=.010, axis_y=axis)
    mesh.block(loom - axis.normalized() * .05, (.055, .17, .055), material='skiff_plank',
               color=shade, bevel=.014, axis_y=axis)


def build_rig(mesh, spec, rng):
    """A short mast, its yard, and the brailed-up sail bundled against the yard."""
    mesh.tube([(0, -.18, -.72), (0, 1.70, -.70), (0, 3.50, -.68)], [.088, .072, .052],
              material='skiff_plank', color=plank_shade(rng), sides=8)
    mesh.block((0, 3.56, -.68), (.13, .10, .13), material='skiff_plank',
               color=plank_shade(rng), bevel=.026)
    mesh.block((0, .34, -.72), (.34, .075, .30), material='skiff_plank',
               color=plank_shade(rng), bevel=.012)
    low, high = Vector(spec['yard'][0]), Vector(spec['yard'][1])
    axis = (high - low).normalized()
    mesh.tube([low, low.lerp(high, .5), high], [.046, .042, .032], material='skiff_plank',
              color=plank_shade(rng), sides=5)
    side = Vector((spec['sail'] * .14, 0, 0))
    bundle = [low.lerp(high, t) + side * (1 + .5 * math.sin(t * math.pi)) for t in
              (.06, .26, .46, .66, .86)]
    mesh.tube(bundle, [.075, .155, .175, .150, .080], material='skiff_canvas',
              color=canvas_shade(rng), sides=6)
    # One loose fold spilling out of the bundle so it does not read as a sausage.
    fold = low.lerp(high, .40) + side * 1.6
    across = axis.cross(Vector((0, 0, 1)))
    across = across.normalized() if across.length > .01 else Vector((1, 0, 0))
    for k in range(3):
        drop = Vector((0, -.30 - k * .16, 0))
        shade = canvas_shade(rng)
        quad = (fold + across * (.02 + k * .06), fold + across * (.16 + k * .06),
                fold + across * (.20 + k * .07) + drop, fold + across * (.03 + k * .05) + drop)
        mesh.polygon(quad, material='skiff_canvas', color=[shade] * 4)
    for k, t in enumerate((.22, .52, .80)):
        anchor = low.lerp(high, t) + side * .5
        mesh.tube([anchor, Vector((0, anchor.y - .10, -.70))], [.016, .014],
                  material='hemp_rope', color=rope_shade(rng), sides=3)


def build_ironwork(mesh, spec, rng):
    """Two oarlocks on the gunwale, a stem cleat and its mooring line."""
    for side in (-1, 1):
        sheer = inner_point(side, -.10, 1.0)
        mesh.block((sheer.x + side * .055, sheer.y + .07, sheer.z), (.055, .13, .075),
                   material='forged_iron', color=iron_shade(rng), bevel=.010)
        mesh.block((sheer.x + side * .055, sheer.y + .14, sheer.z), (.045, .045, .19),
                   material='forged_iron', color=iron_shade(rng), bevel=.008)
    cleat = Vector((0, .95, -(HULL_END - .16)))
    mesh.block((cleat.x, cleat.y, cleat.z), (.22, .045, .050), material='forged_iron',
               color=iron_shade(rng), bevel=.008)
    for x in (-.07, .07):
        mesh.block((x, cleat.y - .05, cleat.z), (.045, .075, .045), material='forged_iron',
                   color=iron_shade(rng), bevel=0)
    mesh.tube([cleat + Vector((0, .02, 0)), Vector((spec['sail'] * .18, .60, cleat.z - .12)),
               Vector((spec['sail'] * .30, .10, cleat.z + .22))], [.020, .019, .018],
              material='hemp_rope', color=rope_shade(rng), sides=3)


def build_skiff(name, spec):
    """One moored clinker skiff, origin at the waterline amidships, bow toward -Z."""
    mesh = KitMesh(name)
    rng = RNG
    build_hull(mesh, spec, rng)
    build_fitout(mesh, spec, rng)
    for loom, tip in spec['oars']:
        build_oar(mesh, loom, tip, rng)
    rope_coil(mesh, (spec['coil'][0], -.04, spec['coil'][1]), .27, rng, turns=2, rise=.055)
    build_rig(mesh, spec, rng)
    build_ironwork(mesh, spec, rng)
    mesh.finish()


# ------------------------------------------------------------------- inspection

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
    assert not gltf.get('images') and not gltf.get('textures'), 'Island kit must not duplicate shared textures'
    assert all('uri' not in buffer for buffer in gltf['buffers'])
    assert {mat['name'] for mat in gltf['materials']} == set(MATERIAL_BINDINGS)
    shared = json.loads((ROOT / 'client/assets/old-watch/manifest.json').read_text())
    assert hashlib.sha256((ROOT / 'client/assets/old-watch/kit.glb').read_bytes()).hexdigest() == shared['sha256']
    manifest = {
        'schemaVersion': 1, 'generator': 'tools/build-island.py', 'seed': SEED,
        'blenderVersion': bpy.app.version_string, 'coordinateSystem': 'Y-up, meters, +Z front',
        'sourceLicense': 'Original Skywake Isles project assets; see CREDITS.md',
        'file': 'kit.glb', 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
        'dependencies': [{'url': SHARED_KIT, 'sha256': shared['sha256'],
                          'ownership': 'Shared cache owns original material textures and reusable props'}],
        'materialBindings': MATERIAL_BINDINGS, 'prefabs': {}, 'textures': [],
        'embeddedImageCount': 0, 'decodedTextureBytes': 0, 'buildingContracts': {},
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
        todo, meshes = [index], 0
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
                # The whole trunk, not just its foot: a runtime-scaled palm must
                # keep every trunk vertex inside its recorded collider.
                if name in TRUNK_RADII and material == 'palm_trunk':
                    trunks[name] = max(trunks.get(name, 0),
                                       float(np.linalg.norm(positions[:, (0, 2)], axis=1).max()))
                triangles += gltf['accessors'][primitive['indices']]['count'] // 3
                primitives += 1
        assert meshes >= 1, f'{name}: no mesh child'
        manifest['prefabs'][name] = {'bounds': {'min': minimum.round(5).tolist(), 'max': maximum.round(5).tolist()},
                                     'dimensions': (maximum - minimum).round(5).tolist(),
                                     'horizontalRadius': round(radius, 5), 'triangles': triangles,
                                     'primitives': primitives, 'materials': sorted(materials)}
    for name, prefab in manifest['prefabs'].items():
        low, high = prefab['bounds']['min'], prefab['bounds']['max']
        limit, floor, ceiling = PROP_ENVELOPES[name]
        assert prefab['horizontalRadius'] <= limit, (name, prefab['horizontalRadius'], limit)
        assert low[1] >= floor - .0006 and high[1] <= ceiling, (name, low, high)
        assert prefab['triangles'] <= TRIANGLE_BUDGETS[name], (name, prefab['triangles'])
    for name, limit in TRUNK_RADII.items():
        assert name in trunks, f'{name}: no palm_trunk geometry'
        assert trunks[name] <= limit + .0002, (name, trunks[name], limit)
    averages = {name: total / count for name, (total, count) in sorted(tints.items())}
    for name, average in averages.items():
        assert average >= .70, f'{name} COLOR_0 average {average:.3f} would darken the shared texture'
    manifest['trunkRadii'] = {name: round(value, 5) for name, value in sorted(trunks.items())}
    manifest['totalTriangles'] = sum(p['triangles'] for p in manifest['prefabs'].values())
    manifest['totalPrimitives'] = sum(p['primitives'] for p in manifest['prefabs'].values())
    assert manifest['bytes'] <= KIT_BYTE_LIMIT, manifest['bytes']
    assert manifest['totalTriangles'] <= KIT_TRIANGLE_LIMIT, manifest['totalTriangles']
    return manifest, averages


def preview(path):
    loader = importlib.util.spec_from_file_location('old_watch_preview', ROOT / 'tools/build-old-watch.py')
    old_watch = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(old_watch)
    with tempfile.TemporaryDirectory(prefix='skywake-island-preview-') as temporary:
        old_watch.create_materials(pathlib.Path(temporary))
        for root in PREFABS.values():
            for child in root.children:
                binding = MATERIAL_BINDINGS[child.data.materials[0].name]
                material = MATERIALS[binding['source']].copy()
                material.use_backface_culling = not binding.get('doubleSided', False)
                nodes, links = material.node_tree.nodes, material.node_tree.links
                shader = nodes.get('Principled BSDF')
                if 'color' in binding:
                    # The iron source is a flat colour with no upstream link.
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
        positions = {'coast_palm_a': (-8.0, 0, 0.0), 'coast_palm_b': (-2.6, 0, 1.2),
                     'coast_rock_a': (2.8, 0, -1.4), 'coast_rock_b': (6.6, 0, 1.6),
                     'fishing_skiff_a': (10.8, 0, -1.2), 'fishing_skiff_b': (15.4, 0, 1.6)}
        for name, root in PREFABS.items():
            root.location = game_to_blender(positions[name])
        bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.02))
        bpy.context.object.data.materials.append(MATERIALS['ground_earth'])
        scene = bpy.context.scene
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = 32
        scene.cycles.use_denoising = True
        world = bpy.data.worlds.new('island_preview_world')
        world.use_nodes = True
        world.node_tree.nodes.get('Background').inputs['Color'].default_value = (.62, .74, .88, 1)
        world.node_tree.nodes.get('Background').inputs['Strength'].default_value = 1.4
        scene.world = world
        bpy.ops.object.light_add(type='AREA', location=(-10, -14, 26))
        key = bpy.context.object
        key.data.energy, key.data.shape, key.data.size = 9000, 'DISK', 14
        key.data.color = (1, .97, .90)
        key.rotation_euler = (Vector((0, 0, 3)) - key.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.ops.object.camera_add(location=(14, -30, 15))
        camera = bpy.context.object
        camera.rotation_euler = (Vector((2, 1.5, 3.2)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.type, camera.data.ortho_scale = 'ORTHO', 30
        scene.camera = camera
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1800, 1100, 100
        scene.view_settings.view_transform = 'AgX'
        path.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'client/assets/island')
    parser.add_argument('--preview', type=pathlib.Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    args.output.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for name, binding in MATERIAL_BINDINGS.items():
        create_binding_material(name, double_sided=binding.get('doubleSided', False))
    for name in ('coast_palm_a', 'coast_palm_b'):
        build_palm(name, PALM_SPECS[name])
    for name in ('coast_rock_a', 'coast_rock_b'):
        build_rock(name, ROCK_SPECS[name])
    for name in ('fishing_skiff_a', 'fishing_skiff_b'):
        build_skiff(name, SKIFF_SPECS[name])
    output = args.output / 'kit.glb'
    export_glb(output)
    manifest, averages = inspect_glb(output)
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    tints = ' '.join(f'{name} {value:.3f}' for name, value in averages.items())
    print(f'ISLAND_OK: {len(PREFABS)} prefabs, {manifest["totalTriangles"]:,} triangles, '
          f'{manifest["totalPrimitives"]} primitives, {manifest["bytes"]:,} bytes, COLOR_0 {tints}')
    print('ISLAND_PREFABS: ' + ' | '.join(
        f'{name} tris={p["triangles"]} prims={p["primitives"]} r={p["horizontalRadius"]:.3f} '
        f'y=[{p["bounds"]["min"][1]:.3f},{p["bounds"]["max"][1]:.3f}]'
        for name, p in manifest['prefabs'].items()))
    print('ISLAND_TRUNKS: ' + ' '.join(f'{k}={v}' for k, v in manifest['trunkRadii'].items()))
    if args.preview:
        preview(args.preview.resolve())


if __name__ == '__main__':
    main()
