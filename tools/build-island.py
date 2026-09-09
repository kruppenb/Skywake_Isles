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

Milestone 9 slice 2 adds the three shrine landmarks. Palmheart's gate is worn
olive-jade cut block, the Moonbloom gate is pale dressed lunar stone around an
open aperture, and Emberpeak is fractured charcoal basalt with amber seams --
three separate identities, none of them another Old Watch grey-green settlement.

  palm_gate_pillar      stacked chipped masonry, mossy joints, carved leaf and
                        sun relief on both faces, wide two-tier capital
  palm_gate_lintel      11.5 m carved beam, five weathered segments, a dentil
                        run and stylized leaf/sun motifs; pivot at beam centre
  moon_gate_ring        24 bevelled voussoirs in the local XY plane around a
                        3.48 m aperture that stays completely empty, with sparse
                        cyan inlay and shallow star/crescent incisions
  moon_gate_orb         faceted luminous orb on a thin lunar-stone equator,
                        origin at the sphere centre
  shrine_mushroom       leaning pale stem, broad domed lilac cap, cyan gill rim
  shrine_moon_crystal   three faceted cyan shards, skirt buried to -.30 m
  caldera_ridge_a/b     fractured basalt towers, iron-weathered shoulders and
                        sparse amber seam facets, nominal height 10 m
  caldera_amber_crystal the same three-shard cluster in warm amber
  ember_core            shallow amber pool inside a fractured basalt rim
  ember_core_rock       fractured basalt lump centred on its own origin

The shrine roots draw from isolated per-root random streams (SHRINE_SEEDS), so
the six coast roots above keep byte-identical geometry across this slice.

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
    # Slice 2. Palmheart's gate reads olive-jade against the jungle, so green
    # leads red and blue trails far behind; the pale dressed edge is the same
    # stone opened up. Moonbloom borrows the grove's silver/lilac language, and
    # the luminous cyan is Moonwatch's moon_glass reused byte for byte so the
    # two areas glow with one colour. Emberpeak's charcoal comes from the
    # binding, never from dark vertex colours -- the Cinderworks lesson.
    'jungle_gate_stone': {'source': 'watch_stone', 'color': [2.70, 3.00, 1.90], 'normalScale': .75},
    'jungle_gate_edge': {'source': 'watch_stone', 'color': [4.00, 4.20, 2.70], 'normalScale': .60},
    'lunar_stone': {'source': 'watch_stone', 'color': [4.00, 3.60, 5.20], 'normalScale': .55},
    'lunar_cap': {'source': 'watch_stone', 'color': [3.40, 2.60, 8.00], 'normalScale': .35},
    'lunar_stem': {'source': 'aged_timber', 'color': [4.40, 4.50, 4.30], 'normalScale': .30},
    'lunar_glow': {'source': 'lantern_amber', 'color': [.80, 2.90, 12.0],
                   'emissive': [.16, .40, .44], 'emissiveIntensity': 1.0},
    'caldera_basalt': {'source': 'watch_stone', 'color': [1.85, 1.45, 1.40], 'normalScale': .90},
    'caldera_weathered': {'source': 'watch_stone', 'color': [2.70, 1.70, 1.10], 'normalScale': .80},
    'caldera_glow': {'source': 'lantern_amber', 'color': [1.15, .75, .50],
                     'emissive': [.55, .16, .025], 'emissiveIntensity': 1.0},
}
COAST_ROOTS = ['coast_palm_a', 'coast_palm_b', 'coast_rock_a', 'coast_rock_b',
               'fishing_skiff_a', 'fishing_skiff_b']
SHRINE_ROOTS = ['palm_gate_pillar', 'palm_gate_lintel', 'moon_gate_ring', 'moon_gate_orb',
                'shrine_mushroom', 'shrine_moon_crystal', 'caldera_ridge_a', 'caldera_ridge_b',
                'caldera_amber_crystal', 'ember_core', 'ember_core_rock']
EXPECTED = COAST_ROOTS + SHRINE_ROOTS
# Each shrine root owns a private random stream. The six coast roots above draw
# from the module RNG in their original order, so slice 2 cannot move a single
# coast vertex however much shrine authoring changes.
SHRINE_SEEDS = {name: 920417_000 + index for index, name in enumerate(SHRINE_ROOTS, start=1)}
# root -> (maximum horizontal radius, minimum y, maximum y).
PROP_ENVELOPES = {
    'coast_palm_a': (4.60, -.40, 8.60),
    'coast_palm_b': (4.60, -.40, 7.80),
    'coast_rock_a': (2.50, -.40, 5.00),
    'coast_rock_b': (2.00, -.40, 3.00),
    'fishing_skiff_a': (2.40, -.40, 3.70),
    'fishing_skiff_b': (2.40, -.40, 3.70),
    'palm_gate_pillar': (1.92, -.45, 6.12),
    'palm_gate_lintel': (5.84, -.55, .55),
    'moon_gate_ring': (4.32, -4.29, 4.29),
    'moon_gate_orb': (.75, -.75, .75),
    'shrine_mushroom': (1.80, -.25, 3.40),
    'shrine_moon_crystal': (1.00, -.30, 3.05),
    'caldera_ridge_a': (4.70, -2.60, 11.25),
    'caldera_ridge_b': (4.70, -2.60, 11.25),
    'caldera_amber_crystal': (1.00, -.30, 3.05),
    'ember_core': (5.00, -.20, .80),
    'ember_core_rock': (1.80, -1.70, 1.70),
}
# Roots whose contract also pins the individual horizontal axes: the gate beam
# must clear the approach in z, and the lava pool is an ellipse, not a circle.
AXIS_ENVELOPES = {'palm_gate_lintel': (5.75, 1.00), 'ember_core': (5.00, 4.00)}
# Every palm_trunk vertex stays inside this horizontal reach, so a runtime-scaled
# collidable palm keeps its whole trunk inside its 2.0 m collider.
TRUNK_RADII = {'coast_palm_a': 1.60, 'coast_palm_b': 1.60}
# The orb hangs free, so its contract is a sphere, not a horizontal disc.
SPHERE_RADII = {'moon_gate_orb': .75}
# root -> (height, maximum horizontal radius below it). The mushroom leans, but
# nothing of it may bulge into walking space around the stem.
LOW_REACH = {'shrine_mushroom': (1.00, .46)}
# The gate pillar's plan box, measured as the prefab-local X span (2 * max|x|)
# with the authored course yaw already in the vertices. Everything below
# PILLAR_CAPITAL_Y is body and fits the 2.1 m box the original scenery box
# occupied -- the buried footing too, since the pillars stand on heightAt and
# ground level is not a plane geometry can hide under. Only the corbel and
# capital above it widen, and only to the approved 2.7 m.
PILLAR_CAPITAL_Y = 5.12
PILLAR_BODY_WIDTH = 2.10
PILLAR_CAPITAL_WIDTH = 2.70
# The ember core reproduces the original scenery ellipsoid's upper crown on the
# same pivot: plan radii just inside its 5.0 x 4.0, a crest a hair under the .80
# envelope ceiling so the exported float32 cannot round past it, and the .30 the
# original ellipsoid still stands at where it meets its own rim.
EMBER_CORE_RADII = (4.62, 3.62)
EMBER_CORE_PLAN = (5.0, 4.0)      # the original scenery ellipsoid's plan radii
EMBER_CORE_CREST = .798
EMBER_CORE_RIM = .30
# Both crystal clusters bury their skirt this deep instead of being reanchored.
CRYSTAL_SKIRT = -.30
CRYSTAL_ROOTS = ('shrine_moon_crystal', 'caldera_amber_crystal')
# The Moonbloom gate's open aperture. Measured on projected triangles, not just
# on vertex radii: a triangle may not cross the disc even if its corners miss it.
RING_ROOT = 'moon_gate_ring'
RING_APERTURE = 3.48
RING_SEGMENTS = 24
RING_INNER = 3.56          # >= RING_APERTURE / cos(pi / (2 * RING_SEGMENTS))
RING_JOINT = .011
# Exported alongside propEnvelopes so the runtime and the tests can assert the
# same landmark facts the generator holds itself to.
LANDMARK_CONTRACTS = {
    # bodyWidth/capitalWidth are the approved v2 bounds, not the measured spans:
    # the widths the geometry may not exceed. Both are the prefab-local X span
    # (2 * max|x|) split at capitalY, with the authored course yaw already baked
    # into the vertices; runtime site rotations are not part of the measure.
    'palm_gate_pillar': {'origin': 'ground', 'capitalY': PILLAR_CAPITAL_Y,
                         'bodyWidth': PILLAR_BODY_WIDTH, 'capitalWidth': PILLAR_CAPITAL_WIDTH},
    'palm_gate_lintel': {'origin': 'beam centre', 'span': 11.50,
                         'maxAbsX': 5.75, 'maxAbsZ': 1.00},
    'moon_gate_ring': {'origin': 'ring centre', 'plane': 'local XY', 'majorRadius': 3.90,
                       'apertureRadius': RING_APERTURE, 'innerRadius': RING_INNER,
                       'segments': RING_SEGMENTS},
    'moon_gate_orb': {'origin': 'sphere centre', 'radius': SPHERE_RADII['moon_gate_orb']},
    'shrine_mushroom': {'origin': 'ground', 'unitScale': 'addMushroom',
                        'lowReachHeight': LOW_REACH['shrine_mushroom'][0],
                        'lowReachRadius': LOW_REACH['shrine_mushroom'][1]},
    'shrine_moon_crystal': {'origin': 'ground', 'unitScale': 'addCrystal',
                            'skirtDepth': CRYSTAL_SKIRT, 'shards': 3},
    'caldera_ridge_a': {'origin': 'ground', 'nominalHeight': 10.0, 'footprint': [3.8, 3.5],
                        'buriedFoot': -2.60},
    'caldera_ridge_b': {'origin': 'ground', 'nominalHeight': 10.0, 'footprint': [3.8, 3.5],
                        'buriedFoot': -2.60},
    'caldera_amber_crystal': {'origin': 'ground', 'unitScale': 'addCrystal',
                              'skirtDepth': CRYSTAL_SKIRT, 'shards': 3},
    'ember_core': {'origin': 'core groundY', 'maxAbsX': 5.00, 'maxAbsZ': 4.00},
    'ember_core_rock': {'origin': 'pebble centre', 'radius': 1.80},
}
# Exactly which slots each shrine root uses. Equality, not containment: a
# mistyped slot would ship a jungle pillar rendered in basalt, and a lost seam
# would ship an Emberpeak ridge with no amber in it at all.
ROOT_MATERIALS = {
    'palm_gate_pillar': {'jungle_gate_stone', 'jungle_gate_edge'},
    'palm_gate_lintel': {'jungle_gate_stone', 'jungle_gate_edge'},
    'moon_gate_ring': {'lunar_stone', 'lunar_glow'},
    'moon_gate_orb': {'lunar_stone', 'lunar_glow'},
    'shrine_mushroom': {'lunar_cap', 'lunar_stem', 'lunar_glow'},
    'shrine_moon_crystal': {'lunar_glow'},
    'caldera_ridge_a': {'caldera_basalt', 'caldera_weathered', 'caldera_glow'},
    'caldera_ridge_b': {'caldera_basalt', 'caldera_weathered', 'caldera_glow'},
    'caldera_amber_crystal': {'caldera_glow'},
    'ember_core': {'caldera_basalt', 'caldera_weathered', 'caldera_glow'},
    'ember_core_rock': {'caldera_basalt', 'caldera_weathered', 'caldera_glow'},
}
TRIANGLE_BUDGETS = {'coast_palm_a': 4200, 'coast_palm_b': 4000, 'coast_rock_a': 1400,
                    'coast_rock_b': 1200, 'fishing_skiff_a': 3200, 'fishing_skiff_b': 3200,
                    'palm_gate_pillar': 2200, 'palm_gate_lintel': 2200, 'moon_gate_ring': 2800,
                    'moon_gate_orb': 650, 'shrine_mushroom': 1700, 'shrine_moon_crystal': 650,
                    'caldera_ridge_a': 1500, 'caldera_ridge_b': 1500,
                    'caldera_amber_crystal': 650, 'ember_core': 1200, 'ember_core_rock': 700}
# Slice 2 raises the guard to the usual whole-island 3.5 MiB / 40k; the kit is
# expected to land well under 30k triangles.
KIT_BYTE_LIMIT = int(3.5 * 1024 * 1024)
KIT_TRIANGLE_LIMIT = 40000


def shrine_rng(name):
    """The private random stream for one shrine root."""
    return random.Random(SHRINE_SEEDS[name])


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


# ----------------------------------------------------------------- shrine hues
# Every shrine slot is authored bright (>= .86 sRGB) and lets its binding carry
# the hue. Emberpeak's charcoal in particular comes from caldera_basalt's tint;
# a dark COLOR_0 would multiply an already dark shared texture into a
# silhouette, which is exactly what the Cinderworks slice had to undo.

def gate_stone_shade(rng, moss=0.0):
    """Worn olive-jade block stone; `moss` is the damp shading inside a joint."""
    shade = rng.uniform(.90, 1.0) - .035 * moss
    return (shade * .975, shade, shade * .945)


def gate_edge_shade(rng):
    """The pale yellow-green face a chipped or dressed edge exposes."""
    shade = rng.uniform(.94, 1.0)
    return (shade * .995, shade, shade * .955)


def lunar_stone_shade(rng, dim=1.0):
    """Pale lilac-white dressed stone; `dim` is the shadow inside an incision."""
    shade = rng.uniform(.92, 1.0) * dim
    return (shade * .985, shade * .970, shade)


def lunar_cap_shade(t, rng):
    """The lilac cap; the rim keeps a shade more light than the crown."""
    shade = rng.uniform(.92, 1.0) * (.965 + .035 * t)
    return (shade * .995, shade * .960, shade)


def lunar_stem_shade(rng):
    shade = rng.uniform(.93, 1.0)
    return (shade, shade * .990, shade * .985)


def lunar_glow_shade(t, rng):
    """Cyan inlay, gills and orb glass; the binding, not COLOR_0, carries hue."""
    shade = rng.uniform(.94, 1.0) * (.965 + .035 * t)
    return (shade * .945, shade, shade)


def basalt_shade(rng, dim=1.0):
    shade = rng.uniform(.90, 1.0) * dim
    return (shade, shade * .985, shade * .975)


def weathered_shade(rng):
    """The iron-brown crust on a wind-facing basalt shoulder."""
    shade = rng.uniform(.92, 1.0)
    return (shade, shade * .970, shade * .935)


def ember_shade(t, rng):
    """Amber seam and magma glass; hotter toward the middle of a pool."""
    shade = rng.uniform(.93, 1.0) * (.96 + .04 * t)
    return (shade, shade * .965, shade * .925)


# ------------------------------------------------------------- shrine geometry

def disc(mesh, center, normal, up, radius, material, shade, sides=12, spin=0.0):
    """A flat n-gon facing `normal`; one polygon."""
    normal, up = unit(normal), unit(up)
    side = normal.cross(up).normalized()
    points = [Vector(center) + (side * math.cos(spin + i * TAU / sides)
                                + up * math.sin(spin + i * TAU / sides)) * radius
              for i in range(sides)]
    faced_polygon(mesh, points, normal, material, [shade(p) for p in points])


def annulus(mesh, center, normal, up, r_in, r_out, material, shade, sides=12):
    """A flat ring of quads facing `normal`; the mushroom's luminous gills."""
    normal, up = unit(normal), unit(up)
    side = normal.cross(up).normalized()
    ring = lambda angle, r: Vector(center) + (side * math.cos(angle) + up * math.sin(angle)) * r
    for i in range(sides):
        a, b = i * TAU / sides, (i + 1) * TAU / sides
        quad = (ring(a, r_in), ring(a, r_out), ring(b, r_out), ring(b, r_in))
        faced_polygon(mesh, quad, normal, material, [shade(p) for p in quad])


def star_plate(mesh, center, normal, up, outer, inner, material, shade, points=5, spin=0.0):
    """A flat star outline as one concave polygon; a shallow incision on stone."""
    normal, up = unit(normal), unit(up)
    side = normal.cross(up).normalized()
    ring = []
    for i in range(points * 2):
        angle = spin + i * math.pi / points
        r = outer if i % 2 == 0 else inner
        ring.append(Vector(center) + (side * math.cos(angle) + up * math.sin(angle)) * r)
    faced_polygon(mesh, ring, normal, material, [shade(p) for p in ring])


def crescent_plate(mesh, center, normal, up, radius, waist, material, shade, sides=7, spin=0.0):
    """A crescent: one outer arc closed by a shallower arc offset toward the tips."""
    normal, up = unit(normal), unit(up)
    side = normal.cross(up).normalized()
    span = math.pi * 1.18
    at = lambda angle, r, shift: (Vector(center) + side * (math.cos(angle) * r + shift)
                                  + up * (math.sin(angle) * r))
    outer = [at(spin - span * .5 + span * i / (sides - 1), radius, 0.0) for i in range(sides)]
    inner = [at(spin + span * .5 - span * i / (sides - 1), radius * waist,
                radius * (1 - waist) * .62) for i in range(sides)]
    ring = outer + inner
    faced_polygon(mesh, ring, normal, material, [shade(p) for p in ring])


def swept_solid(mesh, loops, material, shade, cap=True, smooth=False):
    """A closed solid swept through equal-length cross-section loops."""
    count = len(loops[0])
    for index in range(len(loops) - 1):
        lower, upper = loops[index], loops[index + 1]
        center = (sum(lower, Vector()) + sum(upper, Vector())) / (count * 2)
        for j in range(count):
            k = (j + 1) % count
            quad = (lower[j], upper[j], upper[k], lower[k])
            faced_polygon(mesh, quad, sum(quad, Vector()) / 4 - center, material,
                          [shade(p) for p in quad], smooth=smooth)
    if cap:
        for loop, other in ((loops[0], loops[1]), (loops[-1], loops[-2])):
            outward = sum(loop, Vector()) / count - sum(other, Vector()) / count
            faced_polygon(mesh, loop, outward, material, [shade(p) for p in loop])


def ring_band(mesh, y0, y1, r_in, r_out, material, shade, segments=12, center=(0, 0, 0)):
    """A closed annular band solid around the +Y axis; eight triangles a step."""
    cx, cy, cz = center
    at = lambda a, r, y: Vector((cx + math.cos(a) * r, cy + y, cz + math.sin(a) * r))
    for i in range(segments):
        a, b = i * TAU / segments, (i + 1) * TAU / segments
        out = Vector((math.cos((a + b) * .5), 0, math.sin((a + b) * .5)))
        for radius, facing in ((r_out, out), (r_in, -out)):
            quad = (at(a, radius, y0), at(a, radius, y1), at(b, radius, y1), at(b, radius, y0))
            faced_polygon(mesh, quad, facing, material, [shade(p) for p in quad])
        for y, up in ((y1, 1), (y0, -1)):
            quad = (at(a, r_in, y), at(a, r_out, y), at(b, r_out, y), at(b, r_in, y))
            faced_polygon(mesh, quad, (0, up, 0), material, [shade(p) for p in quad])


def faceted_sphere(mesh, center, radius, material, shade, sides=12, rows=6):
    """A low-facet sphere: two triangle fans over stacked quad bands."""
    c = Vector(center)
    rings = []
    for j in range(1, rows):
        phi = math.pi * j / rows
        r, y = radius * math.sin(phi), radius * math.cos(phi)
        rings.append([c + Vector((math.cos(i * TAU / sides) * r, y, math.sin(i * TAU / sides) * r))
                      for i in range(sides)])
    top, bottom = c + Vector((0, radius, 0)), c - Vector((0, radius, 0))
    for i in range(sides):
        k = (i + 1) % sides
        for face in ((top, rings[0][k], rings[0][i]), (bottom, rings[-1][i], rings[-1][k])):
            faced_polygon(mesh, face, sum(face, Vector()) / 3 - c, material,
                          [shade(p) for p in face])
    for j in range(len(rings) - 1):
        for i in range(sides):
            k = (i + 1) % sides
            quad = (rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i])
            faced_polygon(mesh, quad, sum(quad, Vector()) / 4 - c, material,
                          [shade(p) for p in quad])


def facet_shell(mesh, center, radii, rng, facet, *, sides=10, rows=5, twist=.21,
                jitter=(.82, 1.12)):
    """A jittered lat-long lump. `facet(row, column)` picks the slot per face, so
    a seam or a weathered crust is part of the shell instead of floating on it."""
    c, (rx, ry, rz) = Vector(center), radii
    rings = []
    for j in range(1, rows):
        phi = math.pi * j / rows
        span, height = math.sin(phi), math.cos(phi)
        ring = []
        for i in range(sides):
            angle = i * TAU / sides + j * twist
            reach = rng.uniform(*jitter)
            ring.append(c + Vector((math.cos(angle) * rx * span * reach,
                                    ry * height * rng.uniform(.90, 1.06),
                                    math.sin(angle) * rz * span * reach)))
        rings.append(ring)
    top = c + Vector((0, ry * rng.uniform(.90, 1.04), 0))
    bottom = c - Vector((0, ry * rng.uniform(.90, 1.04), 0))
    for i in range(sides):
        k = (i + 1) % sides
        for row, face in ((0, (top, rings[0][k], rings[0][i])),
                          (rows - 1, (bottom, rings[-1][i], rings[-1][k]))):
            material, shade = facet(row, i)
            faced_polygon(mesh, face, sum(face, Vector()) / 3 - c, material,
                          [shade() for _ in face])
    for j in range(len(rings) - 1):
        for i in range(sides):
            k = (i + 1) % sides
            quad = (rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i])
            material, shade = facet(j + 1, i)
            faced_polygon(mesh, quad, sum(quad, Vector()) / 4 - c, material,
                          [shade() for _ in quad])


def leaning_slab(mesh, center, size, tilt, spin, material, color, bevel=.05):
    """A fractured slab tipped off vertical; the caldera rim's broken crust."""
    axis = Vector((math.cos(spin) * math.sin(tilt), math.cos(tilt), math.sin(spin) * math.sin(tilt)))
    mesh.block(center, size, material=material, color=color, bevel=bevel, axis_y=axis)


def patch_frame(corners, outward):
    """A bilinear (u, v) sampler over four shell vertices, plus its outward normal.

    Anything authored through this sampler is built from the rock's own surface,
    so it lies on the shell instead of being positioned near it and hoping.
    """
    q0, q1, q2, q3 = (Vector(c) for c in corners)
    normal = (q1 - q0).cross(q3 - q0)
    if normal.dot(Vector(outward)) < 0:
        normal = -normal
    normal = normal.normalized() if normal.length > 1e-9 else unit(Vector(outward))
    return (lambda u, v: (1 - v) * ((1 - u) * q0 + u * q1) + v * ((1 - u) * q3 + u * q2)), normal


def seam_strip(mesh, corners, outward, rng, material, shade, steps=3):
    """A narrow amber fissure wandering up one shell facet.

    Colouring a whole facet instead paints a rectangle about a metre across --
    a panel, not a crack -- which is what the first caldera pass shipped. The
    strip is 6-12 cm wide, laid on the facet's own surface with a hair of lift
    so it never z-fights the rock it belongs to.
    """
    at, normal = patch_frame(corners, outward)
    lift = normal * .006
    across = max((Vector(corners[1]) - Vector(corners[0])).length, .001)
    edge = rng.uniform(.30, .70)
    lower, low, high = None, rng.uniform(.02, .16), rng.uniform(.84, .99)
    for step in range(steps + 1):
        v = low + (high - low) * step / steps
        edge = clamp(edge + rng.uniform(-.09, .09), .14, .86)
        half = rng.uniform(.028, .052) / across
        upper = (at(edge - half, v) + lift, at(edge + half, v) + lift)
        if lower:
            quad = (lower[0], lower[1], upper[1], upper[0])
            faced_polygon(mesh, quad, normal, material, [shade() for _ in quad])
        lower = upper


def fracture_plate(mesh, corners, outward, thickness, rng, material, shade, points=6):
    """A sheared plate seated on the shell patch it is built from.

    Its back sits 6 cm inside the rock and its outline is an irregular polygon,
    because a bevelled block mounted at a computed radius reads as a crate
    bolted to the mountain -- projecting corners, visible gaps and all.
    """
    at, normal = patch_frame(corners, outward)
    ring = []
    for k in range(points):
        angle = k * TAU / points + rng.uniform(-.18, .18)
        reach = rng.uniform(.60, 1.0)
        ring.append((clamp(.5 + math.cos(angle) * .54 * reach, -.04, 1.04),
                     clamp(.5 + math.sin(angle) * .56 * reach, -.04, 1.04)))
    back = [at(u, v) - normal * .06 for u, v in ring]
    face = [at(.5 + (u - .5) * .80, .5 + (v - .5) * .84) + normal * thickness for u, v in ring]
    middle = at(.5, .5) + normal * (thickness * .5 - .03)
    faced_polygon(mesh, back, -normal, material, [shade() for _ in back])
    faced_polygon(mesh, face, normal, material, [shade() for _ in face])
    for k in range(points):
        j = (k + 1) % points
        quad = (back[k], back[j], face[j], face[k])
        faced_polygon(mesh, quad, sum(quad, Vector()) / 4 - middle, material,
                      [shade() for _ in quad])


def crystal_shard(mesh, base, radius, height, lean, spin, material, shade, sides=8):
    """A faceted crystal: a straight column that necks in to a leaning tip."""
    origin = Vector(base)
    tip = origin + Vector((math.cos(spin) * lean * height, height, math.sin(spin) * lean * height))

    def loop(t, scale):
        middle = origin.lerp(tip, t)
        return [middle + Vector((math.cos(spin + i * TAU / sides) * radius * scale, 0,
                                 math.sin(spin + i * TAU / sides) * radius * scale))
                for i in range(sides)]

    rings = [loop(0.0, 1.0), loop(.30, .99), loop(.58, .90), loop(.78, .70)]
    faced_polygon(mesh, rings[0], (0, -1, 0), material, [shade(p) for p in rings[0]])
    for lower, upper in zip(rings, rings[1:]):
        axis = (sum(lower, Vector()) + sum(upper, Vector())) / (sides * 2)
        for i in range(sides):
            k = (i + 1) % sides
            quad = (lower[i], upper[i], upper[k], lower[k])
            faced_polygon(mesh, quad, sum(quad, Vector()) / 4 - axis, material,
                          [shade(p) for p in quad])
    shoulder = sum(rings[-1], Vector()) / sides
    for i in range(sides):
        face = (rings[-1][i], rings[-1][(i + 1) % sides], tip)
        faced_polygon(mesh, face, sum(face, Vector()) / 3 - shoulder, material,
                      [shade(p) for p in face])


# ------------------------------------------------------------- Palmheart gate
# The original gate is two 2.1 m boxes under a 2.7 m capital carrying an 11.5 m
# beam. The authored pillar keeps that read: a visible body the same width, a
# capital no wider than 2.7 m, and the beam still crossing well above head
# height so the south approach through the gate stays open.
#
# The whole body -- every course, mortar band and chip below PILLAR_CAPITAL_Y,
# buried footing included, not merely the part above ground -- fits the original
# 2.1 m box. A wider buried plinth is not an exemption: the pillars stand on
# heightAt, so ground level is not a plane the geometry can hide under. Only the
# corbel and capital above that height widen, and only to the approved 2.7 m.

PILLAR_COURSES = (
    # (y0, y1, width, depth, bevel, moss). Body courses leave 4 cm for their
    # mortar band, which is the widest part of the body; the plinth carries no
    # band, so it takes that width directly.
    (-.45, .22, 2.09, 2.01, .055, .0),
    (.22, 1.08, 2.05, 1.96, .060, .9),
    (1.08, 1.90, 2.00, 1.93, .060, .5),
    (1.90, 2.74, 1.96, 1.89, .060, .7),
    (2.74, 3.56, 1.92, 1.85, .060, .3),
    (3.56, 4.36, 1.88, 1.81, .060, .5),
    (4.36, 5.12, 1.84, 1.77, .060, .2),
    (5.12, 5.60, 2.18, 2.04, .070, .0),
    (5.60, 6.12, 2.50, 2.24, .080, .0),
)


def pillar_yaw(rng, width, depth, limit):
    """How far a course may be set askew before a corner leaves the plan box.

    A block turned by t reaches width/2 * cos t + depth/2 * sin t across, so
    sin t <= (limit - max(width, depth)) / max(width, depth) keeps both plan
    axes inside `limit` however the course is set. The hand-stacked jitter is
    therefore bounded by the contract instead of being trusted to fit it.
    """
    reach = max(width, depth)
    return rng.uniform(-1, 1) * min(.016, math.asin(clamp((limit - reach) / reach)))


def leaf_relief(mesh, center, sign, span, rise, rng):
    """A stylized two-lobe leaf carved proud of a gate face."""
    cx, cy, cz = center
    for lobe in (-1, 1):
        quad = ((cx, cy - rise * .30, cz),
                (cx + lobe * span * .32, cy + rise, cz),
                (cx + lobe * span, cy + rise * .45, cz),
                (cx + lobe * span * .55, cy - rise * .55, cz))
        faced_polygon(mesh, quad, (0, 0, sign), 'jungle_gate_edge',
                      [gate_edge_shade(rng) for _ in quad])
    mesh.block((cx, cy - rise * .20, cz), (.075, rise * 1.30, .050),
               material='jungle_gate_edge', color=gate_edge_shade(rng), bevel=0)


def build_palm_gate_pillar():
    """One jungle gate pillar: stacked chipped masonry under a wide capital."""
    name = 'palm_gate_pillar'
    mesh = KitMesh(name)
    rng = shrine_rng(name)
    for index, (y0, y1, width, depth, bevel, moss) in enumerate(PILLAR_COURSES):
        limit = PILLAR_CAPITAL_WIDTH if y0 >= PILLAR_CAPITAL_Y else PILLAR_BODY_WIDTH
        mesh.block((0, (y0 + y1) * .5, 0), (width, y1 - y0, depth),
                   material='jungle_gate_stone', color=gate_stone_shade(rng, moss * .35),
                   bevel=bevel, yaw=pillar_yaw(rng, width, depth, limit))
        # The mortar course, on the body only: a capital is bedded straight onto
        # the shaft, and a band at the transition would push 2.23 m of stone
        # below PILLAR_CAPITAL_Y.
        if 0 < index < len(PILLAR_COURSES) - 2:
            # Damp lower joints keep the moss; the dry upper ones show the pale
            # dressed edge instead.
            mossy = moss > .45
            # 4 cm of overhang, not 5: the widest body element then lands a
            # centimetre inside PILLAR_BODY_WIDTH instead of exactly on it, so
            # a strict <= 2.1 test is not decided by float32 rounding.
            mesh.block((0, y0, 0), (width + .04, .085, depth + .04),
                       material='jungle_gate_stone' if mossy else 'jungle_gate_edge',
                       color=gate_stone_shade(rng, 1.0) if mossy else gate_edge_shade(rng),
                       bevel=0)
    for k in range(7):
        y0, y1, width, depth, _, _ = PILLAR_COURSES[1 + k % 6]
        side, along = (1 if k % 2 else -1), rng.uniform(-.30, .30)
        y = y0 + (y1 - y0) * rng.uniform(.28, .72)
        if k % 3 == 2:
            center, size = (side * (width * .5 - .06), y, along * depth), (.16, .20 + .10 * rng.random(), .34)
        else:
            center, size = (along * width, y, side * (depth * .5 - .06)), (.34, .20 + .12 * rng.random(), .16)
        mesh.block(center, size, material='jungle_gate_edge', color=gate_edge_shade(rng), bevel=.03)
    for sign in (-1, 1):
        # The relief plane follows the courses it crosses: they are 6 cm thinner
        # than they were, so it sits 3 cm shallower and stays a carving.
        z = sign * .90
        for cx, cy, sx, sy in ((-.62, 3.15, .10, 2.30), (.62, 3.15, .10, 2.30),
                               (0.0, 2.05, 1.34, .10), (0.0, 4.25, 1.34, .10)):
            mesh.block((cx, cy, z + sign * .045), (sx, sy, .09),
                       material='jungle_gate_edge', color=gate_edge_shade(rng), bevel=0)
        star_plate(mesh, (0, 3.86, z + sign * .075), (0, 0, sign), (0, 1, 0), .30, .15,
                   'jungle_gate_edge', lambda p: gate_edge_shade(rng), points=8, spin=.20)
        mesh.block((0, 2.95, z + sign * .055), (.075, 1.42, .05),
                   material='jungle_gate_edge', color=gate_edge_shade(rng), bevel=0)
        for k in range(4):
            for lobe in (-1, 1):
                y = 2.34 + k * .36
                quad = ((0, y - .06, z + sign * .06), (lobe * .16, y + .16, z + sign * .06),
                        (lobe * .38, y + .11, z + sign * .06), (lobe * .29, y - .07, z + sign * .06))
                faced_polygon(mesh, quad, (0, 0, sign), 'jungle_gate_edge',
                              [gate_edge_shade(rng) for _ in quad])
    mesh.finish()


def build_palm_gate_lintel():
    """The carved beam over the jungle gate; the pivot is the beam centre."""
    name = 'palm_gate_lintel'
    mesh = KitMesh(name)
    rng = shrine_rng(name)
    for k in range(5):
        cx = -4.60 + k * 2.30
        mesh.block((cx, rng.uniform(-.012, .012), 0), (2.30, .96, 1.52),
                   material='jungle_gate_stone', color=gate_stone_shade(rng, .3 if k % 2 else .0),
                   bevel=.06)
        mesh.block((cx, .40, 0), (2.28, .30, 1.62), material='jungle_gate_stone',
                   color=gate_stone_shade(rng), bevel=.05)
        mesh.block((cx, -.43, 0), (2.22, .24, 1.36), material='jungle_gate_edge',
                   color=gate_edge_shade(rng), bevel=.04)
    for k in range(17):
        mesh.block((-5.20 + k * .65, -.44, 0), (.34, .22, 1.82), material='jungle_gate_stone',
                   color=gate_stone_shade(rng, .4), bevel=0)
    mesh.block((0, .02, 0), (1.50, 1.02, 1.72), material='jungle_gate_stone',
               color=gate_stone_shade(rng), bevel=.07)
    for side in (-1, 1):
        mesh.block((side * 5.53, 0, 0), (.40, 1.08, 1.66), material='jungle_gate_edge',
                   color=gate_edge_shade(rng), bevel=.05)
    for sign in (-1, 1):
        star_plate(mesh, (0, .02, sign * .90), (0, 0, sign), (0, 1, 0), .34, .16,
                   'jungle_gate_edge', lambda p: gate_edge_shade(rng), points=8, spin=.19)
        for cx in (-3.45, 3.45):
            star_plate(mesh, (cx, .02, sign * .80), (0, 0, sign), (0, 1, 0), .32, .15,
                       'jungle_gate_edge', lambda p: gate_edge_shade(rng), points=8, spin=.36)
        for cx in (-4.95, -1.85, 1.85, 4.95):
            leaf_relief(mesh, (cx, .00, sign * .80), sign, .52, .30, rng)
    mesh.finish()


# ------------------------------------------------------------- Moonbloom gate
# The original ring is a torus of major radius 3.9 and tube .39, so its opening
# was 3.51 m across the radius. The authored voussoirs sit no closer than
# RING_INNER, which keeps every projected triangle -- not merely every vertex --
# outside the 3.48 m aperture the runtime and the tests both assert.

def ring_at(angle, radius, z):
    """A point on the gate ring: the ring plane is local XY, thickness along Z."""
    return Vector((math.cos(angle) * radius, math.sin(angle) * radius, z))


def build_moon_gate_ring():
    """Segmented cut stone around an open aperture, with sparse cyan inlay."""
    name = RING_ROOT
    mesh = KitMesh(name)
    rng = shrine_rng(name)
    inlays, stars, crescents = set(range(1, 24, 4)), {3, 11, 19}, {7, 15, 23}
    for v in range(RING_SEGMENTS):
        mid = v * TAU / RING_SEGMENTS
        half = (TAU / RING_SEGMENTS - RING_JOINT) * .5
        outer, thick, chamfer = rng.uniform(4.20, 4.28), rng.uniform(.40, .44), .09
        profile = ((RING_INNER + chamfer, -thick), (outer - chamfer, -thick),
                   (outer, -thick + chamfer), (outer, thick - chamfer),
                   (outer - chamfer, thick), (RING_INNER + chamfer, thick),
                   (RING_INNER, thick - chamfer), (RING_INNER, -thick + chamfer))
        loops = [[ring_at(mid + half * step, radius, z) for radius, z in profile]
                 for step in (-1.0, 0.0, 1.0)]
        swept_solid(mesh, loops, 'lunar_stone', lambda p: lunar_stone_shade(rng))
        for sign in (-1, 1):
            face = sign * (thick + .004)
            if v in inlays:
                quad = (ring_at(mid - half * .55, 3.80, face), ring_at(mid + half * .55, 3.80, face),
                        ring_at(mid + half * .55, 4.06, face), ring_at(mid - half * .55, 4.06, face))
                faced_polygon(mesh, quad, (0, 0, sign), 'lunar_glow',
                              [lunar_glow_shade(.65, rng) for _ in quad])
            up = Vector((math.cos(mid), math.sin(mid), 0))
            # An incision reads as a shadow cut into the dressed face, so it is
            # the one place this kit darkens lunar stone.
            if v in stars:
                star_plate(mesh, ring_at(mid, 3.92, face + sign * .002), (0, 0, sign), up,
                           .20, .095, 'lunar_stone', lambda p: lunar_stone_shade(rng, .82),
                           points=6, spin=.4)
            elif v in crescents:
                crescent_plate(mesh, ring_at(mid, 3.92, face + sign * .002), (0, 0, sign), up,
                               .21, .70, 'lunar_stone', lambda p: lunar_stone_shade(rng, .82),
                               sides=7, spin=math.pi * .5)
    mesh.finish()


def build_moon_gate_orb():
    """The suspended orb: faceted lunar glass on a thin lunar-stone equator."""
    name = 'moon_gate_orb'
    mesh = KitMesh(name)
    rng = shrine_rng(name)
    faceted_sphere(mesh, (0, 0, 0), .700, 'lunar_glow',
                   lambda p: lunar_glow_shade(clamp(.5 + p.y * .7), rng), sides=12, rows=6)
    # One thin equatorial band and nothing else: a second latitude ring made the
    # orb read as a striped beehive rather than a lamp inside a stone collar.
    ring_band(mesh, -.052, .052, .655, .742, 'lunar_stone',
              lambda p: lunar_stone_shade(rng), segments=12)
    mesh.finish()


def build_shrine_mushroom():
    """A leaning pale stem under a broad domed lilac cap with a cyan gill rim."""
    name = 'shrine_mushroom'
    mesh = KitMesh(name)
    rng = shrine_rng(name)
    # The buried foot drops straight down, so the base ring lies level on the
    # envelope floor instead of tipping a stem radius through it.
    stem = [(.02, -.25, .01), (.02, .55, .01), (.10, 1.50, .04), (.17, 2.20, .07), (.20, 2.58, .08)]
    mesh.tube(stem, [.335, .285, .255, .232, .225], material='lunar_stem',
              color=lunar_stem_shade(rng), sides=12)
    ring_band(mesh, -.030, .030, .245, .400, 'lunar_stem', lambda p: lunar_stem_shade(rng),
              segments=12, center=(.11, 1.62, .045))
    cap, radius, thickness, sides, rows = Vector((.20, 2.50, .08)), 1.20, .76, 16, 5
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
                    corners.append(Vector((cap.x + math.cos(angle) * r, y,
                                           cap.z + math.sin(angle) * r)))
                    shades.append(lunar_cap_shade(1 - t, rng))
            faced_polygon(mesh, corners,
                          sum(corners, Vector()) / 4 - Vector((cap.x, cap.y - .5, cap.z)),
                          'lunar_cap', shades, smooth=True)
    disc(mesh, cap + Vector((0, .02, 0)), (0, -1, 0), (0, 0, 1), radius * .99, 'lunar_cap',
         lambda p: lunar_cap_shade(.05, rng), sides=sides)
    annulus(mesh, cap - Vector((0, .06, 0)), (0, -1, 0), (0, 0, 1), .80, 1.14, 'lunar_glow',
            lambda p: lunar_glow_shade(.7, rng), sides=sides)
    for k in range(7):
        angle, t = k * 2.243 + .5, .26 + (k % 3) * .17
        phi = t * math.pi * .5
        r, y = radius * math.cos(phi), cap.y + thickness * math.sin(phi)
        spot = Vector((cap.x + math.cos(angle) * r, y, cap.z + math.sin(angle) * r))
        outward = unit(Vector((math.cos(angle) * thickness * math.cos(phi),
                               radius * math.sin(phi),
                               math.sin(angle) * thickness * math.cos(phi))))
        disc(mesh, spot + outward * .012, outward, (0, 1, 0), .155 - (k % 3) * .028,
             'lunar_stem', lambda p: lunar_stem_shade(rng), sides=8)
    mesh.finish()


# --------------------------------------------------------------- crystal pairs
# addCrystal draws exactly three shards -- a 3 m spire and two 1.8 m shoulders
# on a 2.3 rad spiral. Both authored clusters keep that count and silhouette and
# simply bury the skirt to CRYSTAL_SKIRT instead of being reanchored.

CRYSTAL_SHARDS = (
    # (x, z, radius, tip y, lean, spin)
    (.000, .000, .250, 3.00, .06, .30),
    (.240, -.180, .188, 1.86, .17, 2.60),
    (-.360, .380, .176, 1.74, .15, 4.90),
)


def build_crystal_cluster(name, material, shade):
    """Three faceted shards at addCrystal's unit scale; no rock base."""
    mesh = KitMesh(name)
    rng = shrine_rng(name)
    for x, z, radius, tip, lean, spin in CRYSTAL_SHARDS:
        crystal_shard(mesh, (x, CRYSTAL_SKIRT, z), radius, tip - CRYSTAL_SKIRT, lean,
                      spin + rng.uniform(-.20, .20), material,
                      lambda p, top=tip: shade(clamp(1 - p.y / top), rng), sides=8)
    mesh.finish()


# ---------------------------------------------------------------- Emberpeak
# The original crescent is a dodecahedron body 3.8 x 3.5 under a 2.4 m cone, at
# a nominal h of 10; the runtime scales only Y, so these towers are authored at
# that nominal height with a buried foot and a narrow upper spire.

RIDGE_SPECS = {
    'caldera_ridge_a': {
        'sides': 9, 'yaw': .35, 'footprint': (1.94, 1.78),
        # (y, radius factor, drift x, drift z). The body stays close to the
        # original 3.8 x 3.5 footprint until the shoulder, then breaks into the
        # narrow spire the original cone gave it.
        'stations': ((-2.60, 1.00, .00, .00), (-1.10, 1.05, .02, -.03), (.30, 1.04, .05, -.05),
                     (1.55, 1.02, .09, -.07), (2.80, 1.00, .13, -.09), (3.95, .98, .18, -.10),
                     (5.05, .94, .23, -.11), (6.10, .81, .29, -.11), (7.05, .62, .35, -.10),
                     (7.95, .53, .42, -.09), (8.75, .44, .49, -.08), (9.45, .34, .56, -.06),
                     (10.10, .25, .62, -.04), (10.70, .15, .68, -.02), (11.20, .05, .72, .00)),
        # A seam is a crack that wanders as it climbs, and the crust is a ragged
        # patch that narrows toward the spire -- neither is a rectangle of
        # facets, which is exactly what a straight index range renders as.
        # (band row, column) facets. Seams are fissures drawn ON these facets,
        # not facets recoloured: the shell stays basalt the whole way up.
        'seams': ((1, 4), (2, 4), (3, 5), (5, 5), (6, 5), (8, 6)),
        'weathered': {(2, 0), (2, 1), (3, 0), (3, 1), (3, 2), (4, 0), (4, 1), (4, 2), (4, 8),
                      (5, 1), (5, 2), (6, 1), (6, 2), (7, 2), (1, 7), (8, 0)},
        # (row0, row1, column, span, thickness). A plate is built from the shell
        # patch between those ring vertices, so its back is inside the rock.
        'plates': ((1, 3, 0, 2, .34), (1, 3, 4, 2, .32), (0, 2, 6, 2, .30),
                   (2, 4, 2, 1, .26), (2, 4, 7, 2, .24), (3, 5, 5, 1, .22),
                   (4, 6, 1, 1, .20), (4, 6, 6, 2, .20), (5, 7, 3, 1, .18),
                   (6, 8, 0, 1, .16), (8, 10, 2, 1, .13), (9, 11, 5, 1, .11)),
    },
    'caldera_ridge_b': {
        'sides': 9, 'yaw': 1.85, 'footprint': (1.88, 1.84),
        'stations': ((-2.60, 1.02, .00, .00), (-1.05, 1.04, -.04, .03), (.35, 1.03, -.09, .07),
                     (1.50, 1.01, -.15, .12), (2.55, .99, -.19, .17), (3.50, 1.00, -.21, .23),
                     (4.40, .92, -.19, .29), (5.35, .78, -.13, .33), (6.35, .68, -.05, .36),
                     (7.35, .58, .06, .35), (8.25, .48, .18, .32), (9.05, .38, .30, .27),
                     (9.75, .28, .40, .21), (10.50, .16, .48, .14), (11.10, .04, .54, .08)),
        'seams': ((1, 1), (2, 1), (3, 2), (4, 2), (6, 3), (9, 3)),
        'weathered': {(2, 5), (2, 6), (3, 5), (3, 6), (3, 7), (4, 4), (4, 5), (4, 6), (5, 5),
                      (5, 6), (6, 5), (7, 5), (7, 6), (1, 2), (9, 4)},
        'plates': ((1, 3, 3, 2, .34), (1, 3, 7, 2, .30), (0, 2, 0, 2, .32),
                   (2, 4, 5, 1, .26), (2, 4, 1, 2, .24), (3, 5, 8, 1, .22),
                   (4, 6, 4, 1, .20), (4, 6, 0, 2, .20), (5, 7, 6, 1, .18),
                   (6, 8, 3, 1, .16), (8, 10, 7, 1, .13), (9, 11, 1, 1, .11)),
    },
}


def ridge_section(stations, y):
    """The interpolated (radius factor, drift x, drift z) of a tower at height y."""
    last = len(stations) - 2
    for index in range(last + 1):
        low, high = stations[index], stations[index + 1]
        if y <= high[0] or index == last:
            t = clamp((y - low[0]) / (high[0] - low[0]))
            return tuple(low[i] + (high[i] - low[i]) * t for i in (1, 2, 3))
    return stations[-1][1:]


def fractured_tower(mesh, spec, rng):
    """A faceted basalt tower: an unbroken shell, fissures drawn on it, and
    sheared plates built out of its own facets."""
    sides, (rx, rz) = spec['sides'], spec['footprint']
    stations, rings = spec['stations'], []
    for index, (y, factor, dx, dz) in enumerate(stations):
        yaw = spec['yaw'] + rng.uniform(-.10, .10)
        # The buried foot and the spire tip stay on their contract heights; only
        # the courses between them break up into a fractured, uneven stack.
        ends = index in (0, len(stations) - 1)
        rings.append([Vector((dx + math.cos(yaw + i * TAU / sides) * rx * factor * rng.uniform(.86, 1.10),
                              y + (0.0 if ends else rng.uniform(-.06, .06) * factor),
                              dz + math.sin(yaw + i * TAU / sides) * rz * factor * rng.uniform(.86, 1.10)))
                      for i in range(sides)])
    def facet(j, i):
        """The four shell vertices of one band facet, and its outward direction."""
        k = (i + 1) % sides
        axis = (sum(rings[j], Vector()) + sum(rings[j + 1], Vector())) / (sides * 2)
        quad = (rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i])
        return quad, sum(quad, Vector()) / 4 - axis

    for j in range(len(rings) - 1):
        for i in range(sides):
            quad, outward = facet(j, i)
            weathered = (j, i) in spec['weathered']
            faced_polygon(mesh, quad, outward,
                          'caldera_weathered' if weathered else 'caldera_basalt',
                          [(weathered_shade(rng) if weathered else basalt_shade(rng))
                           for _ in quad])
    for ring, up in ((rings[0], (0, -1, 0)), (rings[-1], (0, 1, 0))):
        faced_polygon(mesh, ring, up, 'caldera_basalt', [basalt_shade(rng) for _ in ring])
    for j, i in spec['seams']:
        quad, outward = facet(j, i)
        seam_strip(mesh, quad, outward, rng, 'caldera_glow', lambda: ember_shade(.8, rng))
    for index, (row0, row1, column, span, thickness) in enumerate(spec['plates']):
        far = (column + span) % sides
        frame = (rings[row0][column], rings[row0][far], rings[row1][far], rings[row1][column])
        axis = (sum(rings[row0], Vector()) + sum(rings[row1], Vector())) / (sides * 2)
        outward = sum((Vector(p) for p in frame), Vector()) / 4 - axis
        _, normal = patch_frame(frame, outward)
        # The frame is a chord across the shell, and on a nine-sided tower a
        # two-column chord sags almost half a metre inside the rock. Pushing the
        # plate out by its thickness alone therefore buries it: measure how far
        # the real shell bulges past the chord first, so `thickness` is the
        # protrusion beyond the rock rather than beyond a line under it.
        sag = max((rings[row][(column + step) % sides] - Vector(frame[0])).dot(normal)
                  for row in range(row0, row1 + 1) for step in range(span + 1))
        weathered = index % 4 == 1
        fracture_plate(mesh, frame, outward, max(sag, 0.0) + thickness, rng,
                       'caldera_weathered' if weathered else 'caldera_basalt',
                       (lambda: weathered_shade(rng)) if weathered else (lambda: basalt_shade(rng)))


def build_caldera_ridge(name):
    """One fractured basalt tower of the caldera crescent."""
    mesh = KitMesh(name)
    fractured_tower(mesh, RIDGE_SPECS[name], shrine_rng(name))
    mesh.finish()


def ember_crown(t):
    """The original core's upper surface at normalized elliptical radius t.

    The scenery core is a `sphere` primitive, and the palette's sphere is unit
    *radius*, so [5.0, .50, 4.0] at coreY + .30 is an ellipsoid 10 m by 8 m in
    plan whose crown runs from .80 above the recorded core ground at the centre
    down to .30 at its rim. Reading that scale as a full size is what produced a
    pool a quarter of the area, flat at ground level -- and the caldera floor
    rises to about .75 just north of the core, so a flat disc there is sliced in
    half by the terrain and leaves a straight cut edge.
    """
    return EMBER_CORE_RIM + (EMBER_CORE_CREST - EMBER_CORE_RIM) * math.sqrt(max(0.0, 1 - t * t))


def build_ember_core():
    """A shallow crowned amber mound inside a fractured basalt rim.

    Not a scene light and not a flat overlay: a tessellated elliptical crown on
    the original root pivot, so the mound reads above the caldera floor from the
    south and approach the way the original did, while the north edge keeps the
    same partial occlusion the original had.
    """
    name = 'ember_core'
    mesh = KitMesh(name)
    rng = shrine_rng(name)
    sides, steps, edge = 26, 4, .88
    rx, rz = EMBER_CORE_RADII
    # A wobbled plan outline keeps the disc irregular; the crown height stays a
    # function of the true elliptical radius, so the surface itself is smooth.
    wobble = [.95 + .05 * math.sin(i * TAU / sides * 3 + .7) + rng.uniform(-.035, .035)
              for i in range(sides)]

    def surface(x, z, lift=0.0):
        """The original crown sampled at a real plan position, so the wobble
        moves the outline without ever moving the surface off the ellipsoid."""
        return Vector((x, ember_crown(math.hypot(x / EMBER_CORE_PLAN[0],
                                                 z / EMBER_CORE_PLAN[1])) + lift, z))

    def at(i, t, lift=0.0):
        angle = i * TAU / sides
        reach = t * wobble[i % sides]
        return surface(math.cos(angle) * rx * reach, math.sin(angle) * rz * reach, lift)

    apex = Vector((0, EMBER_CORE_CREST, 0))
    rings = [[at(i, edge * (step + 1) / steps) for i in range(sides)] for step in range(steps)]
    for i in range(sides):
        k = (i + 1) % sides
        face = (apex, rings[0][k], rings[0][i])
        faced_polygon(mesh, face, (0, 1, 0), 'caldera_glow', [ember_shade(.95, rng) for _ in face])
    for step in range(steps - 1):
        for i in range(sides):
            k = (i + 1) % sides
            quad = (rings[step][i], rings[step][k], rings[step + 1][k], rings[step + 1][i])
            faced_polygon(mesh, quad, (0, 1, 0), 'caldera_glow',
                          [ember_shade(.85 - step * .12, rng) for _ in quad])
    rim_top = [at(i, 1.0, rng.uniform(-.05, .045)) for i in range(sides)]
    foot = [Vector((p.x, -.20, p.z)) for p in rim_top]
    for i in range(sides):
        k = (i + 1) % sides
        weathered = i % 5 == 2
        material = 'caldera_weathered' if weathered else 'caldera_basalt'
        shade = (lambda: weathered_shade(rng)) if weathered else (lambda: basalt_shade(rng))
        for quad, outward in (((rings[-1][i], rings[-1][k], rim_top[k], rim_top[i]), Vector((0, 1, 0))),
                              ((rim_top[i], rim_top[k], foot[k], foot[i]),
                               Vector((rim_top[i].x + rim_top[k].x, 0, rim_top[i].z + rim_top[k].z)))):
            faced_polygon(mesh, quad, outward, material, [shade() for _ in quad])
        if i % 6 == 1:
            # An amber crack still running out over the cooled rim, laid on the
            # rim's own top face rather than buried inside it.
            lift = Vector((0, .014, 0))
            crack = (rings[-1][i] + lift, rings[-1][i].lerp(rings[-1][k], .34) + lift,
                     rim_top[i].lerp(rim_top[k], .34) + lift, rim_top[i] + lift)
            faced_polygon(mesh, crack, (0, 1, 0), 'caldera_glow',
                          [ember_shade(.5, rng) for _ in crack])
    # The mound is closed underneath: the caldera floor falls away to the south,
    # so an open shell would show its inside from the approach.
    faced_polygon(mesh, foot, (0, -1, 0), 'caldera_basalt', [basalt_shade(rng) for _ in foot])
    for k in range(6):
        angle, reach = k * 1.047 + .4, .30 + (k % 3) * .26
        center = surface(math.cos(angle) * rx * reach, math.sin(angle) * rz * reach, .014)
        disc(mesh, center, (0, 1, 0), (0, 0, 1), .30 + (k % 3) * .16, 'caldera_basalt',
             lambda p: basalt_shade(rng), sides=6, spin=angle)
    for k in range(10):
        # Flat crust fragments bedded into the outer crown, not chunks perched
        # on it: the crown carries them almost .25 m higher than a flat pool
        # did, so they have to lie down to stay under the .80 ceiling.
        angle = k * TAU / 10 + .31
        seat = at(k * sides // 10, .97)
        leaning_slab(mesh, (seat.x, seat.y - .14, seat.z), (.86, .38, .62), .16, angle + 1.3,
                     'caldera_basalt', basalt_shade(rng), bevel=.04)
    mesh.finish()


def build_ember_core_rock():
    """A fractured basalt lump centred on its own origin, not on the ground."""
    name = 'ember_core_rock'
    mesh = KitMesh(name)
    rng = shrine_rng(name)

    def facet(seams, weathered):
        def pick(row, column):
            if (row, column) in seams:
                return 'caldera_glow', lambda: ember_shade(.6, rng)
            if (row, column) in weathered:
                return 'caldera_weathered', lambda: weathered_shade(rng)
            return 'caldera_basalt', lambda: basalt_shade(rng)
        return pick

    facet_shell(mesh, (0, 0, 0), (.92, .86, .92), rng,
                facet({(2, 3), (3, 3), (2, 7)}, {(1, 0), (1, 1), (2, 0), (2, 1), (3, 8)}),
                sides=10, rows=6)
    facet_shell(mesh, (.62, .20, -.34), (.52, .46, .50), rng,
                facet({(2, 4)}, {(1, 5), (2, 5)}), sides=8, rows=4, twist=.34)
    facet_shell(mesh, (-.55, -.24, .42), (.44, .40, .46), rng,
                facet({(1, 2)}, {(2, 6)}), sides=8, rows=4, twist=.17)
    mesh.finish()


# ------------------------------------------------------------------- inspection

def ring_aperture(faces):
    """The smallest local-XY distance from the gate's origin to a filled
    projected triangle. Vertex radii alone would not do: one triangle spanning
    the opening passes a vertex test while completely blocking the gate. The
    distance is zero when the origin falls inside a projected triangle, and the
    minimum point-to-segment distance otherwise. Cap faces project to slivers of
    no area, which cannot enclose anything, so they fall through to the edges."""
    smallest, closest_vertex = float('inf'), float('inf')
    for batch in faces:
        for triangle in np.asarray(batch, dtype=np.float64):
            a, b, c = triangle
            twice = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
            wedges = (a[0] * b[1] - a[1] * b[0], b[0] * c[1] - b[1] * c[0],
                      c[0] * a[1] - c[1] * a[0])
            if abs(twice) > 1e-5 and (min(wedges) >= 0 or max(wedges) <= 0):
                return 0.0
            for p, q in ((a, b), (b, c), (c, a)):
                edge = q - p
                length = float(edge.dot(edge))
                t = 0.0 if length < 1e-18 else clamp(float(-p.dot(edge)) / length)
                smallest = min(smallest, float(np.linalg.norm(p + edge * t)))
            closest_vertex = min(closest_vertex, float(np.linalg.norm(triangle, axis=1).min()))
    assert closest_vertex >= RING_APERTURE - .0002, ('moon gate vertex radius', closest_vertex)
    return smallest


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
        'landmarkContracts': {name: dict(contract) for name, contract in LANDMARK_CONTRACTS.items()},
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

    def elements(index):
        """The index buffer as triangles; the aperture check needs whole faces."""
        accessor = gltf['accessors'][index]
        view = gltf['bufferViews'][accessor['bufferView']]
        dtype = {5121: '<u1', 5123: '<u2', 5125: '<u4'}[accessor['componentType']]
        offset = bin_start + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        return np.frombuffer(raw, dtype=dtype, count=accessor['count'],
                             offset=offset).reshape((-1, 3))

    trunks, tints, spheres, low_reach, ring_faces, pillar = {}, {}, {}, {}, [], {}
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
                flat = np.linalg.norm(positions[:, (0, 2)], axis=1)
                radius = max(radius, float(flat.max()))
                material = gltf['materials'][primitive['material']]['name']
                materials.add(material)
                colors = channels(attributes['COLOR_0'])
                total, count = tints.get(material, (0.0, 0))
                tints[material] = (total + float(colors.sum()), count + colors.size)
                # The whole trunk, not just its foot: a runtime-scaled palm must
                # keep every trunk vertex inside its recorded collider.
                if name in TRUNK_RADII and material == 'palm_trunk':
                    trunks[name] = max(trunks.get(name, 0), float(flat.max()))
                if name in SPHERE_RADII:
                    spheres[name] = max(spheres.get(name, 0),
                                        float(np.linalg.norm(positions, axis=1).max()))
                if name in LOW_REACH:
                    under = flat[positions[:, 1] < LOW_REACH[name][0]]
                    if under.size:
                        low_reach[name] = max(low_reach.get(name, 0), float(under.max()))
                if name == RING_ROOT:
                    ring_faces.append(positions[elements(primitive['indices'])][:, :, :2])
                if name == 'palm_gate_pillar':
                    # The plan span of the body, split at the capital. Only the
                    # corbel's own bottom face sits exactly on the split, and
                    # bevelling keeps it inside the body box, so the boundary
                    # needs no fudge factor.
                    body = positions[positions[:, 1] < PILLAR_CAPITAL_Y + .0006]
                    for key, source, axis in (('bodyX', body, 0), ('bodyZ', body, 2),
                                              ('capitalX', positions, 0), ('capitalZ', positions, 2)):
                        if source.size:
                            pillar[key] = max(pillar.get(key, 0),
                                              float(np.abs(source[:, axis]).max()) * 2)
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
        if name in AXIS_ENVELOPES:
            span_x, span_z = AXIS_ENVELOPES[name]
            assert max(abs(low[0]), abs(high[0])) <= span_x + .0006, (name, low[0], high[0], span_x)
            assert max(abs(low[2]), abs(high[2])) <= span_z + .0006, (name, low[2], high[2], span_z)
        if name in ROOT_MATERIALS:
            assert set(prefab['materials']) == ROOT_MATERIALS[name], (name, prefab['materials'])
        if name in CRYSTAL_ROOTS:
            # The skirt deepens instead of the cluster being reanchored, so the
            # buried foot has to actually reach CRYSTAL_SKIRT.
            assert abs(low[1] - CRYSTAL_SKIRT) <= .0006, (name, low[1], CRYSTAL_SKIRT)
    for name, limit in TRUNK_RADII.items():
        assert name in trunks, f'{name}: no palm_trunk geometry'
        assert trunks[name] <= limit + .0002, (name, trunks[name], limit)
    for name, limit in SPHERE_RADII.items():
        assert name in spheres, f'{name}: no geometry'
        assert spheres[name] <= limit + .0002, (name, spheres[name], limit)
    for name, (height, limit) in LOW_REACH.items():
        assert name in low_reach, f'{name}: nothing below {height} m'
        assert low_reach[name] <= limit + .0002, (name, low_reach[name], limit)
    # The gate pillar's visible body -- footing, courses, bands and chips alike
    # -- must still fit the 2.1 m box the original scenery box occupied; only
    # the capital above it may reach the approved 2.7 m.
    for key, limit in (('bodyX', PILLAR_BODY_WIDTH), ('bodyZ', PILLAR_BODY_WIDTH),
                       ('capitalX', PILLAR_CAPITAL_WIDTH), ('capitalZ', PILLAR_CAPITAL_WIDTH)):
        assert key in pillar, f'palm_gate_pillar: no {key} geometry'
        assert pillar[key] <= limit + .0012, ('palm_gate_pillar', key, pillar[key], limit)
    contract = manifest['landmarkContracts']['palm_gate_pillar']
    contract['measuredBodyWidth'] = round(pillar['bodyX'], 5)
    contract['measuredBodyDepth'] = round(pillar['bodyZ'], 5)
    contract['measuredCapitalWidth'] = round(pillar['capitalX'], 5)
    contract['measuredCapitalDepth'] = round(pillar['capitalZ'], 5)
    aperture = ring_aperture(ring_faces)
    assert aperture >= RING_APERTURE - .0002, (RING_ROOT, aperture, RING_APERTURE)
    manifest['landmarkContracts'][RING_ROOT]['measuredApertureRadius'] = round(aperture, 5)
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
                if 'emissive' in binding:
                    shader.inputs['Emission Color'].default_value = tuple(binding['emissive']) + (1,)
                    shader.inputs['Emission Strength'].default_value = binding.get('emissiveIntensity', 1)
                if 'normalScale' in binding:
                    for node in material.node_tree.nodes:
                        if node.type == 'NORMAL_MAP':
                            node.inputs['Strength'].default_value = binding['normalScale']
                child.data.materials[0] = material
        # The contact sheet keeps the coast on the left and lays the three
        # shrine sets out to the right of it. The ring and the orb are the only
        # roots whose origin is not on the ground, so they are lifted here the
        # same way the runtime lifts them.
        positions = {'coast_palm_a': (-30.0, 0, 0.0), 'coast_palm_b': (-24.0, 0, 1.2),
                     'coast_rock_a': (-19.0, 0, -1.4), 'coast_rock_b': (-15.4, 0, 1.6),
                     'fishing_skiff_a': (-11.0, 0, -1.2), 'fishing_skiff_b': (-6.4, 0, 1.6),
                     'palm_gate_pillar': (-1.2, 0, 0.0), 'palm_gate_lintel': (4.6, 6.35, 0.0),
                     'moon_gate_ring': (14.0, 4.7, 0.0), 'moon_gate_orb': (16.4, 6.8, 0.0),
                     'shrine_mushroom': (20.5, 0, 1.6), 'shrine_moon_crystal': (23.6, 0, -1.4),
                     'caldera_ridge_a': (28.0, 0, 0.0), 'caldera_ridge_b': (33.0, 0, 1.0),
                     'caldera_amber_crystal': (36.6, 0, -1.6), 'ember_core': (42.0, 0, 0.0),
                     'ember_core_rock': (46.6, 1.1, 0.0)}
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
        bpy.ops.object.light_add(type='AREA', location=(-10, -30, 34))
        key = bpy.context.object
        key.data.energy, key.data.shape, key.data.size = 42000, 'DISK', 24
        key.data.color = (1, .97, .90)
        key.rotation_euler = (Vector((8, 0, 4)) - key.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.ops.object.camera_add(location=(20, -60, 26))
        camera = bpy.context.object
        camera.rotation_euler = (Vector((8, 1.5, 4.5)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.type, camera.data.ortho_scale = 'ORTHO', 86
        scene.camera = camera
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 2600, 1100, 100
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
    # Everything below draws from SHRINE_SEEDS, never from the module RNG, so
    # the six coast roots above stay byte-identical to slice 1.
    build_palm_gate_pillar()
    build_palm_gate_lintel()
    build_moon_gate_ring()
    build_moon_gate_orb()
    build_shrine_mushroom()
    build_crystal_cluster('shrine_moon_crystal', 'lunar_glow', lunar_glow_shade)
    for name in ('caldera_ridge_a', 'caldera_ridge_b'):
        build_caldera_ridge(name)
    build_crystal_cluster('caldera_amber_crystal', 'caldera_glow', ember_shade)
    build_ember_core()
    build_ember_core_rock()
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
    ring = manifest['landmarkContracts'][RING_ROOT]
    print(f'ISLAND_APERTURE: {RING_ROOT} contract={ring["apertureRadius"]} '
          f'measured={ring["measuredApertureRadius"]} (projected triangles, local XY)')
    pillar = manifest['landmarkContracts']['palm_gate_pillar']
    print(f'ISLAND_PILLAR: body x={pillar["measuredBodyWidth"]} z={pillar["measuredBodyDepth"]} '
          f'(<={pillar["bodyWidth"]} below y={pillar["capitalY"]}) | '
          f'capital x={pillar["measuredCapitalWidth"]} z={pillar["measuredCapitalDepth"]} '
          f'(<={pillar["capitalWidth"]})')
    if args.preview:
        preview(args.preview.resolve())


if __name__ == '__main__':
    main()
