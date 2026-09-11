"""Build the Skywake navigator: the original skinned, textured player-character prototype.

    blender --background --factory-startup --python-exit-code 1 \
        --python tools/build-player-character.py -- \
        --output client/assets/player-character [--blend FILE] [--preview-dir DIR]

Original pirate design, clothing, textures and rig built in Blender on MakeHuman CC0
anatomy topology (tools/player-character/base.obj, see provenance.json). The anatomical
topology - continuous eyelids, lips, ears and fingers - is the credited free input; the
navigator's proportions, face sculpt, every garment, every texture, the armature, the
skinning and the clips here are authored by this script.

How the art is made, in order:
  1. The CC0 body group is parsed as data (helpers excluded), mapped source -> game space
     and pushed through `morph_body` + `sculpt_face`: a stylised ~6.4-head adult with a
     heavier jaw, stronger brow and cheek, broader shoulders and larger hands.
  2. Everything the clothes cover is deleted; the head, neck and hands survive, so the
     face keeps its authored topology instead of becoming a ball of primitives.
  3. Garments are grown FROM the body: a BVH of the morphed anatomy is ray-sampled to get
     the real surface radius at every (angle, height), and `pc.shell` lofts a panel at
     that radius plus a thickness, so the coat, shirt, breeches, boots, hair, beard and
     tricorn all fit the anatomy and carry genuine cloth thickness at every open edge.
  4. One 2K albedo and one 1K normal atlas are baked by rasterising every part into an
     object-space G-buffer and painting it procedurally. Paint reads 3D position, so UV
     seams never show as colour breaks and the face landmarks land where they belong.
  5. One armature, distance-falloff weights normalised to four influences, three clips.

Nothing is downloaded at build time and no vendor pixels are used: reference images were
looked at for style only.
"""

import argparse
import importlib.util
import json
import math
import pathlib
import shutil
import sys
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

ROOT = pathlib.Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location('player_character', ROOT / 'tools' / 'player_character.py')
pc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pc)

TAU = math.tau
SEED = 523118
BUILD_VERSION = '1.0.0-prototype'

# --------------------------------------------------------------------------- art direction

PALETTE = {
    'navy': '#243e51',
    'navy_deep': '#1a2e3d',
    'ivory': '#e8ddc5',
    'leather': '#654432',
    'leather_dark': '#4a3125',
    'brass': '#cfa657',
    'skin': '#b8815f',
    'hair': '#47372c',
    'crew': '#429f9a',
    'breeches': '#3a4a55',
    'sole': '#2f2722',
}

# Source anatomy (decimetre-ish, Y up, +Z front, mid-body origin) -> game metres.
SOURCE_GROUND = -8.18305
SCALE = 0.14693
HEAD_SCALE = 1.12

TARGET_HEIGHT = 2.72          # metres, crown of the tricorn, inside the 2.65-2.9 direction
FINAL_SCALE = 1.0             # set once in main() from the measured authored height

ATLAS_SIZE = 2048
NORMAL_SIZE = 1024
ATLAS_REGIONS = {
    #          u0     v0     u1     v1     (v runs up, Blender orientation)
    'skin':    (0.000, 0.500, 0.500, 1.000),
    'coat':    (0.500, 0.500, 1.000, 1.000),
    'shirt':   (0.000, 0.250, 0.250, 0.500),
    'leather': (0.250, 0.250, 0.500, 0.500),
    'trouser': (0.500, 0.250, 0.750, 0.500),
    'hat':     (0.750, 0.250, 1.000, 0.500),
    'hair':    (0.000, 0.000, 0.250, 0.250),
    'accent':  (0.250, 0.000, 0.500, 0.250),
    'brass':   (0.500, 0.000, 0.625, 0.125),
    'eye':     (0.625, 0.000, 0.750, 0.125),
}
ATLAS = pc.Atlas(ATLAS_SIZE, ATLAS_REGIONS)
PAINT_IDS = {name: i for i, name in enumerate(sorted(ATLAS_REGIONS))}

MATERIALS = {
    # name          paint-region default, roughness, metallic, base colour factor
    'skin':         dict(roughness=0.62, metallic=0.0, factor=(1.0, 1.0, 1.0)),
    'eye':          dict(roughness=0.18, metallic=0.0, factor=(1.0, 1.0, 1.0)),
    'hair':         dict(roughness=0.52, metallic=0.0, factor=(1.0, 1.0, 1.0)),
    'cloth_navy':   dict(roughness=0.82, metallic=0.0, factor=(1.0, 1.0, 1.0)),
    'cloth_ivory':  dict(roughness=0.86, metallic=0.0, factor=(1.0, 1.0, 1.0)),
    'leather':      dict(roughness=0.58, metallic=0.0, factor=(1.0, 1.0, 1.0)),
    'brass':        dict(roughness=0.34, metallic=0.9, factor=(1.0, 1.0, 1.0)),
    'crew_accent':  dict(roughness=0.78, metallic=0.0, factor=pc.srgb_to_linear(pc.hex_to_rgb(PALETTE['crew']))),
}

BONE_ORDER = [
    'root', 'hips', 'spine', 'chest', 'neck', 'head',
    'upper_arm.L', 'forearm.L', 'hand.L', 'upper_arm.R', 'forearm.R', 'hand.R',
    'thigh.L', 'shin.L', 'foot.L', 'thigh.R', 'shin.R', 'foot.R',
    'coat_tail.L', 'coat_tail.R',
]
LEG_BONES = {'thigh.L', 'shin.L', 'foot.L', 'thigh.R', 'shin.R', 'foot.R', 'coat_tail.L', 'coat_tail.R'}
TAIL_BONES = {'coat_tail.L', 'coat_tail.R'}


# --------------------------------------------------------------------------- anatomy input


def to_game(points):
    """Rotate the CC0 source 180 degrees about its own Y (front +Z -> -Z) and scale to metres.

    game = (-sx, sy - groundY, -sz) * SCALE. Both X and Z flip, so handedness - and the
    winding of every face we keep - is preserved.
    """
    p = np.asarray(points, dtype=float).reshape(-1, 3)
    out = np.stack([-p[:, 0], p[:, 1] - SOURCE_GROUND, -p[:, 2]], axis=-1) * SCALE
    return out


def _bump(y, lo, peak, hi):
    y = np.asarray(y, dtype=float)
    return np.where(y < peak, pc.smoothstep(lo, peak, y), 1.0 - pc.smoothstep(peak, hi, y))


HEAD_PIVOT = np.array([0.0, 2.000, -0.010])
TORSO_AXIS_Z = -0.035


def morph_body(points):
    """Stylise the neutral CC0 anatomy into the navigator's silhouette.

    Pure function of position, so the same call maps mesh vertices and joint centres.
    """
    p = np.asarray(points, dtype=float).reshape(-1, 3).copy()

    # 1. Head and neck volume: ~6.4 heads tall instead of the base mesh's ~7.
    t = pc.smoothstep(1.905, 2.075, p[:, 1])[:, None]
    k = 1.0 + (HEAD_SCALE - 1.0) * t
    p = HEAD_PIVOT + (p - HEAD_PIVOT) * k

    y = p[:, 1]
    # 2. Broader shoulders and deeper chest; the arms ride outward with them.
    shoulder = _bump(y, 1.60, 1.95, 2.06)
    p[:, 0] *= 1.0 + 0.085 * shoulder
    p[:, 2] = TORSO_AXIS_Z + (p[:, 2] - TORSO_AXIS_Z) * (1.0 + 0.055 * shoulder)

    # 3. Waist taken in so the coat has a line to follow.
    waist = _bump(y, 1.33, 1.60, 1.86)
    p[:, 0] *= 1.0 - 0.055 * waist
    p[:, 2] = TORSO_AXIS_Z + (p[:, 2] - TORSO_AXIS_Z) * (1.0 - 0.045 * waist)

    # 4. Slightly sturdier legs; boots and breeches read better on them.
    leg = pc.smoothstep(1.30, 1.10, y)
    axis_x = np.where(p[:, 0] < 0.0, -0.165, 0.165)
    p[:, 0] = axis_x + (p[:, 0] - axis_x) * (1.0 + 0.06 * leg)
    p[:, 2] = 0.0 + (p[:, 2] - 0.0) * (1.0 + 0.05 * leg)

    # 5. Substantial gameplay-readable hands, blended in across the wrist.
    for sign in (-1.0, 1.0):
        elbow = np.array([sign * 0.4598, 1.7156, -0.0194])
        wrist = np.array([sign * 0.6335, 1.5626, -0.2581])
        axis = wrist - elbow
        u = ((p - elbow) @ axis) / float(axis @ axis)
        near = pc.smoothstep(0.34, 0.18, np.linalg.norm(p - wrist, axis=1))
        blend = pc.smoothstep(0.80, 1.02, u) * near
        p += (p - wrist) * (0.16 * blend)[:, None]
    return p


def landmarks(joint_centres):
    return {name: morph_body(to_game(centre))[0] for name, centre in joint_centres.items()}


def sculpt_face(points, lm):
    """Grab-brush sculpt over the CC0 head: jaw, chin, brow, cheek, nose, lips, cranium.

    Amplitudes are single-digit millimetres on a 0.39 m head - enough to turn the neutral
    base into a specific adventurer, small enough that the authored eyelids and lips keep
    working.
    """
    p = np.asarray(points, dtype=float).reshape(-1, 3).copy()
    eye_l, eye_r = lm['eye_l'], lm['eye_r']
    mouth = lm['mouth']
    chin = np.array([0.0, mouth[1] - 0.052, mouth[2] - 0.018])
    brow_y = eye_l[1] + 0.028
    brushes = [
        # centre, radius, delta   (-Z is forward)
        (chin, 0.062, np.array([0.0, -0.006, -0.016])),
        (np.array([-0.080, mouth[1] + 0.006, mouth[2] + 0.052]), 0.072, np.array([-0.011, -0.004, 0.002])),
        (np.array([+0.080, mouth[1] + 0.006, mouth[2] + 0.052]), 0.072, np.array([+0.011, -0.004, 0.002])),
        (np.array([-eye_l[0], brow_y, eye_l[2] - 0.012]), 0.048, np.array([0.0, 0.002, -0.007])),
        (np.array([+eye_l[0], brow_y, eye_l[2] - 0.012]), 0.048, np.array([0.0, 0.002, -0.007])),
        (np.array([-0.058, eye_l[1] - 0.030, eye_l[2] - 0.010]), 0.050, np.array([-0.006, 0.0, -0.006])),
        (np.array([+0.058, eye_l[1] - 0.030, eye_l[2] - 0.010]), 0.050, np.array([+0.006, 0.0, -0.006])),
        (np.array([0.0, mouth[1] + 0.048, mouth[2] - 0.030]), 0.030, np.array([0.0, 0.001, -0.005])),
        (np.array([0.0, mouth[1], mouth[2] - 0.006]), 0.026, np.array([0.0, 0.0, -0.002])),
        (np.array([0.0, lm['head'][1] + 0.120, lm['head'][2] + 0.075]), 0.090, np.array([0.0, 0.005, 0.006])),
    ]
    for centre, radius, delta in brushes:
        d = np.linalg.norm(p - centre, axis=1) / radius
        fall = np.clip(1.0 - d * d, 0.0, 1.0) ** 2
        p += delta[None, :] * fall[:, None]
    return p


def load_anatomy(obj_path):
    """Body group only: no helper tights/skirt/hair/genital, no eye, teeth, tongue or
    eyelash helpers, no joint cubes. Joint cube centres are kept as rig landmark data."""
    data = pc.load_obj(obj_path)
    verts = data['verts']
    groups = data['groups']
    body = groups['body']
    joint_centres = {}
    for name, faces in groups.items():
        if not name.startswith('joint-'):
            continue
        idx = sorted({vi for face in faces for vi, _ in face})
        joint_centres[name] = verts[idx].mean(axis=0)

    used = sorted({vi for face in body for vi, _ in face})
    remap = {vi: i for i, vi in enumerate(used)}
    raw = verts[used]
    game = to_game(raw)
    morphed = morph_body(game)
    faces = [tuple(remap[vi] for vi, _ in face) for face in body]
    face_uv_ids = [tuple(ti for _, ti in face) for face in body]

    named = {
        'eye_l': joint_centres['joint-l-eye'], 'eye_r': joint_centres['joint-r-eye'],
        'mouth': joint_centres['joint-mouth'], 'neck': joint_centres['joint-neck'],
        'head': joint_centres['joint-head'], 'head_top': joint_centres['joint-head-2'],
        'pelvis': joint_centres['joint-pelvis'],
        'spine1': joint_centres['joint-spine-1'], 'spine3': joint_centres['joint-spine-3'],
        'shoulder_l': joint_centres['joint-l-shoulder'], 'shoulder_r': joint_centres['joint-r-shoulder'],
        'elbow_l': joint_centres['joint-l-elbow'], 'elbow_r': joint_centres['joint-r-elbow'],
        'wrist_l': joint_centres['joint-l-hand'], 'wrist_r': joint_centres['joint-r-hand'],
        'hip_l': joint_centres['joint-l-upper-leg'], 'hip_r': joint_centres['joint-r-upper-leg'],
        'knee_l': joint_centres['joint-l-knee'], 'knee_r': joint_centres['joint-r-knee'],
        'ankle_l': joint_centres['joint-l-ankle'], 'ankle_r': joint_centres['joint-r-ankle'],
        'toe_l': joint_centres['joint-l-foot-2'], 'toe_r': joint_centres['joint-r-foot-2'],
        'heel_l': joint_centres['joint-l-foot-1'], 'heel_r': joint_centres['joint-r-foot-1'],
        'finger_l': joint_centres['joint-l-finger-3-1'], 'finger_r': joint_centres['joint-r-finger-3-1'],
    }
    lm = landmarks(named)
    morphed = sculpt_face(morphed, lm)

    # joint-mouth is an internal jaw marker, ~35 mm above and 150 mm behind the actual
    # lips: placing face hair off it put the moustache on the nose. Measure the real
    # mouth, nose base and jaw line from the teeth helpers and the skin itself instead.
    def helper_bounds(name):
        idx = sorted({vi for face in groups[name] for vi, _ in face})
        pts = morph_body(to_game(verts[idx]))
        return pts.min(axis=0), pts.max(axis=0)

    upper_lo, upper_hi = helper_bounds('helper-upper-teeth')
    lower_lo, lower_hi = helper_bounds('helper-lower-teeth')
    head_pts = morphed[morphed[:, 1] > 2.02]
    jaw = head_pts[(np.abs(head_pts[:, 0]) < 0.050) & (head_pts[:, 2] < -0.18)]
    eye_open = {}
    for key in ('eye_l', 'eye_r'):
        near = morphed[np.linalg.norm(morphed - lm[key], axis=1) < 0.040]
        eye_open[key] = {'y_lo': float(near[:, 1].min()), 'y_hi': float(near[:, 1].max()),
                         'x_lo': float(np.abs(near[:, 0]).min()), 'x_hi': float(np.abs(near[:, 0]).max()),
                         'z': float(near[:, 2].min())}
    face = {
        'lip_y': float((upper_lo[1] + lower_hi[1]) * 0.5),
        'nose_base_y': float(upper_hi[1]),
        'mouth_half_x': float(upper_hi[0]),
        'chin_y': float(jaw[:, 1].min()) if len(jaw) else float(lower_lo[1] - 0.043),
        'eye': eye_open,
    }
    return {'verts': morphed, 'faces': faces, 'face_uv_ids': face_uv_ids, 'uvs': data['uvs'],
            'lm': lm, 'face': face, 'joint_centres': joint_centres}


# --------------------------------------------------------------------------- body sampling


def polyline_project(point, polyline):
    """Closest distance to a polyline plus the arc-length fraction of the closest point."""
    pts = np.asarray(polyline, dtype=float)
    lengths = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    total = float(lengths.sum())
    best = (1e9, 0.0)
    travelled = 0.0
    for k in range(len(pts) - 1):
        ab = pts[k + 1] - pts[k]
        denom = float(ab @ ab)
        t = float(np.clip(((point - pts[k]) @ ab) / max(denom, 1e-12), 0.0, 1.0))
        closest = pts[k] + ab * t
        d = float(np.linalg.norm(point - closest))
        if d < best[0]:
            best = (d, (travelled + lengths[k] * t) / max(total, 1e-9))
        travelled += lengths[k]
    return best


class BodySampler:
    """One smoothed radius field per body region, shared by every garment layer.

    Layers used to ray-sample the anatomy independently, so a coat panel and the shirt
    panel under it could disagree by a centimetre and swap sides. Every layer now reads
    the SAME cached, gap-filled, blurred table and adds its own offset, which makes the
    stacking order a guarantee instead of a hope.
    """

    TORSO_Y0, TORSO_Y1, TORSO_NY, TORSO_NA = 0.78, 2.14, 35, 48
    LIMB_NS, LIMB_NA = 19, 24
    HEAD_NE, HEAD_NA, HEAD_PHI0 = 19, 32, -1.32

    def __init__(self, verts, faces, lm):
        self.verts = verts
        self.lm = lm
        tris = []
        for face in faces:
            for k in range(1, len(face) - 1):
                tris.append((face[0], face[k], face[k + 1]))
        self.tris = tris
        centres = np.array([verts[list(t)].mean(axis=0) for t in tris])
        self.centres = centres
        self.arms = {side: [lm['shoulder_' + side.lower()], lm['elbow_' + side.lower()],
                            lm['wrist_' + side.lower()], lm['finger_' + side.lower()]]
                     for side in ('L', 'R')}
        self.legs = {side: [lm['hip_' + side.lower()], lm['knee_' + side.lower()],
                            lm['ankle_' + side.lower()], lm['toe_' + side.lower()]]
                     for side in ('L', 'R')}
        self.region = np.array([self._classify(c) for c in centres])
        self.trees = {}
        self.tables = {}

    def _classify(self, c):
        for side in ('L', 'R'):
            d, u = polyline_project(c, self.arms[side])
            if u > 0.085 and d < 0.16:
                return 'arm' + side
        if c[1] < 1.32:
            for side in ('L', 'R'):
                d, u = polyline_project(c, self.legs[side])
                if d < 0.20:
                    return 'leg' + side
        if c[1] > 1.86:
            # The head set has to reach down past the jaw: beard rays fan steeply downward
            # and used to escape through the missing neck, land nowhere, and fall back to a
            # nominal radius that the real chin then sawed straight through.
            return 'head'
        return 'torso'

    def tree(self, key):
        if key not in self.trees:
            if key == 'torso':
                wanted = np.isin(self.region, ['torso', 'head'])
            elif key == 'body':
                wanted = np.ones(len(self.region), dtype=bool)
            else:
                wanted = self.region == key
            sel = [t for t, ok in zip(self.tris, wanted) if ok]
            self.trees[key] = BVHTree.FromPolygons([tuple(v) for v in self.verts], sel, all_triangles=True)
        return self.trees[key]

    def _cast(self, key, origin, direction, reach):
        o = Vector(tuple(np.asarray(origin) + np.asarray(direction) * reach))
        hit = self.tree(key).ray_cast(o, Vector(tuple(-np.asarray(direction))), reach * 2.0)
        return None if hit[0] is None else reach - hit[3]

    @staticmethod
    def _fill_and_smooth(raw, fallback, passes=2):
        table = np.array(raw, dtype=float)
        for row in range(table.shape[0]):
            line = table[row]
            good = np.isfinite(line)
            if good.all():
                continue
            line[~good] = np.median(line[good]) if good.any() else fallback
        if not np.isfinite(table).all():
            table[~np.isfinite(table)] = fallback
        return pc.smooth_table(table, passes=passes)

    def torso_table(self):
        if 'torso' not in self.tables:
            raw = np.full((self.TORSO_NY, self.TORSO_NA), np.nan)
            for iy in range(self.TORSO_NY):
                y = self.TORSO_Y0 + (self.TORSO_Y1 - self.TORSO_Y0) * iy / (self.TORSO_NY - 1)
                for ia in range(self.TORSO_NA):
                    theta = TAU * ia / self.TORSO_NA
                    d = np.array([-math.sin(theta), 0.0, -math.cos(theta)])
                    raw[iy, ia] = self._cast('torso', np.array([0.0, y, TORSO_AXIS_Z]), d, 0.62) or np.nan
            self.tables['torso'] = self._fill_and_smooth(raw, 0.15, passes=2)
        return self.tables['torso']

    def torso_radius(self, theta, y):
        table = self.torso_table()
        u = (y - self.TORSO_Y0) / (self.TORSO_Y1 - self.TORSO_Y0) * (self.TORSO_NY - 1)
        v = (theta % TAU) / TAU * self.TORSO_NA
        return pc.bilinear(table, u, v)

    def limb_table(self, key, polyline, fallback):
        if key not in self.tables:
            raw = np.full((self.LIMB_NS, self.LIMB_NA), np.nan)
            for si in range(self.LIMB_NS):
                s = si / (self.LIMB_NS - 1)
                point, _, side, front = frame_at(polyline, s)
                for ai in range(self.LIMB_NA):
                    angle = TAU * ai / self.LIMB_NA
                    d = ring_dir(side, front, angle)
                    raw[si, ai] = self._cast(key.split(':')[0], point, d, 0.36) or np.nan
            self.tables[key] = self._fill_and_smooth(raw, fallback, passes=2)
        return self.tables[key]

    def limb_radius(self, key, polyline, s, angle, fallback=0.06):
        table = self.limb_table(key, polyline, fallback)
        u = min(max(s, 0.0), 1.0) * (self.LIMB_NS - 1)
        v = (angle % TAU) / TAU * self.LIMB_NA
        return pc.bilinear(table, u, v)

    def head_table(self, centre):
        if 'head' not in self.tables:
            raw = np.full((self.HEAD_NE, self.HEAD_NA), np.nan)
            for ie in range(self.HEAD_NE):
                phi = self.HEAD_PHI0 + (1.57 - self.HEAD_PHI0) * ie / (self.HEAD_NE - 1)
                for ia in range(self.HEAD_NA):
                    theta = TAU * ia / self.HEAD_NA
                    d = np.array([-math.sin(theta) * math.cos(phi), math.sin(phi),
                                  -math.cos(theta) * math.cos(phi)])
                    raw[ie, ia] = self._cast('head', centre, d, 0.34) or np.nan
            self.tables['head'] = self._fill_and_smooth(raw, 0.11, passes=1)
        return self.tables['head']

    def head_radius(self, centre, theta, phi):
        table = self.head_table(centre)
        u = (phi - self.HEAD_PHI0) / (1.57 - self.HEAD_PHI0) * (self.HEAD_NE - 1)
        v = (theta % TAU) / TAU * self.HEAD_NA
        return pc.bilinear(table, u, v)

    def head_radius_dir(self, centre, direction):
        d = pc.unit(np.asarray(direction, dtype=float))
        phi = math.asin(float(np.clip(d[1], -1.0, 1.0)))
        theta = math.atan2(-d[0], -d[2])
        return self.head_radius(centre, theta, phi)

    def face_drop(self, x, y):
        """Drop a point straight back onto the face along +Z and return it with its normal.

        Face hair is laid out in real (x, y) over the front of the face, so a band quoted
        between two measured heights lands between them. Angular fans off an interior
        marker were what put the moustache on the nose and the brows on the temples.
        """
        d = np.array([0.0, 0.0, 1.0])
        origin = np.array([float(x), float(y), -0.50])
        hit = self.tree('head').ray_cast(Vector(tuple(origin)), Vector(tuple(d)), 0.9)
        if hit[0] is None:
            return np.array([float(x), float(y), -0.24]), np.array([0.0, 0.0, -1.0])
        return np.array(hit[0], dtype=float), pc.unit(np.array(hit[1], dtype=float))

    def face_hit(self, origin, theta, phi):
        """Surface point AND its normal on the real face, for growing hair off the skin.

        Rays fan out from a point inside the jaw rather than running horizontally, so the
        cast direction turns with the chin instead of sliding under it, and the offset uses
        the hit normal. Horizontal casts plus a smoothed skull radius were what put a flat
        slab over the lips and let the chin saw back out through the beard.
        """
        d = np.array([-math.sin(theta) * math.cos(phi), math.sin(phi), -math.cos(theta) * math.cos(phi)])
        o = Vector(tuple(origin + d * 0.32))
        hit = self.tree('head').ray_cast(o, Vector(tuple(-d)), 0.64)
        if hit[0] is None:
            return origin + d * 0.11, d
        point = np.array(hit[0], dtype=float)
        reach = float(np.linalg.norm(point - origin))
        if not 0.045 < reach < 0.20:
            return origin + d * 0.11, d
        return point, pc.unit(np.array(hit[1], dtype=float))

    def head_ring_radius(self, centre, theta, y):
        """Horizontal skull radius at height y; three fixed-point steps, fully deterministic."""
        dy = y - centre[1]
        r = 0.13
        for _ in range(3):
            phi = math.atan2(dy, max(r, 1e-4))
            r = max(0.02, self.head_radius(centre, theta, phi) * math.cos(phi))
        return r


def frame_at(polyline, s):
    """Point plus an orthonormal frame along a limb polyline; angle 0 faces the character front."""
    pts = np.asarray(polyline, dtype=float)
    total = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    length = total[-1]
    d = np.clip(s, 0.0, 1.0) * length
    k = int(np.searchsorted(total, d, side='right') - 1)
    k = max(0, min(k, len(pts) - 2))
    local = (d - total[k]) / max(total[k + 1] - total[k], 1e-9)
    point = pts[k] + (pts[k + 1] - pts[k]) * local
    tangent = pc.unit(pts[k + 1] - pts[k])
    ref = np.array([0.0, 0.0, -1.0])
    if abs(float(tangent @ ref)) > 0.9:
        ref = np.array([0.0, 1.0, 0.0])
    side = pc.unit(np.cross(tangent, ref))
    front = pc.unit(np.cross(side, tangent))
    return point, tangent, side, front


def ring_dir(side, front, angle):
    return front * math.cos(angle) + side * math.sin(angle)


# --------------------------------------------------------------------------- skin


def rotate_part(part, angle, axis, pivot):
    rot = np.array(Matrix.Rotation(angle, 3, Vector(tuple(axis))))
    pivot = np.asarray(pivot, dtype=float)
    for i, v in enumerate(part.verts):
        p = np.asarray(v, dtype=float)
        part.verts[i] = tuple(pivot + rot @ (p - pivot))


# --------------------------------------------------------------------------- layer stack
#
# Every garment offsets the SAME smoothed body radius field, so the stacking order is a
# guarantee rather than a hope. Fold amplitudes are kept well below the gaps between
# consecutive offsets: the shirt can never surface through the coat.
SHIRT_OFFSET = 0.011
COAT_OFFSET = 0.036
SASH_OFFSET = 0.056
STRAP_OFFSET = 0.062
BELT_OFFSET = 0.076
SLEEVE_SHIRT = 0.013
SLEEVE_COAT = 0.038
BREECHES_OFFSET = 0.013
BOOT_OFFSET = 0.038
MAX_FOLD = 0.0045


def build_skin(anat):
    """Head, neck and hands survive; every square centimetre the clothes cover is deleted.

    UVs are the MakeHuman file's own retained face-corner UVs. The islands the kept faces
    use are isolated, normalised and shelf-packed into the skin atlas region with gutters.
    A cylindrical reprojection was tried first and was wrong: it folded the authored face
    topology onto itself around the sockets and under the jaw, which showed up as paired
    tonal discs on the eyes and a hard stripe across the cheeks.
    """
    verts = anat['verts']
    faces = anat['faces']
    uv_ids = anat['face_uv_ids']
    src_uv = anat['uvs']
    lm = anat['lm']
    part = pc.Part('skin', 'skin', 'skin', weights='body')

    wrists = {'L': lm['wrist_l'], 'R': lm['wrist_r']}
    elbows = {'L': lm['elbow_l'], 'R': lm['elbow_r']}

    def hand_param(centre):
        """How far past the wrist a face sits; distance-gated so legs never qualify."""
        best = -9.9
        for side in ('L', 'R'):
            if float(np.linalg.norm(centre - wrists[side])) > 0.30:
                continue
            axis = wrists[side] - elbows[side]
            best = max(best, float((centre - elbows[side]) @ axis) / float(axis @ axis))
        return best

    keep = []
    for face, ids in zip(faces, uv_ids):
        centre = verts[list(face)].mean(axis=0)
        if centre[1] > 2.062 or (centre[1] > 1.845 and abs(centre[0]) < 0.105) or hand_param(centre) > 0.93:
            keep.append((face, ids))

    islands = pc.uv_islands([ids for _, ids in keep])
    boxes = []
    for members in islands:
        coords = np.array([src_uv[t] for i in members for t in keep[i][1]])
        boxes.append((coords.min(axis=0), coords.max(axis=0)))
    sizes = [(float(hi[0] - lo[0]), float(hi[1] - lo[1])) for lo, hi in boxes]
    scale, places = pc.shelf_pack(sizes, margin=0.008)
    island_of = {}
    for k, members in enumerate(islands):
        for i in members:
            island_of[i] = k
    print(f'NAVIGATOR_UV: {len(islands)} retained skin islands packed at scale {scale:.3f}, '
          f'largest {max(w * h for w, h in sizes) * scale * scale:.3f} of the skin region')

    index = {}

    def vertex(i):
        if i not in index:
            index[i] = part.vert(verts[i], 0.5)
        return index[i]

    for order, (face, ids) in enumerate(keep):
        k = island_of[order]
        lo, _ = boxes[k]
        ox, oy = places[k]
        uvs = []
        for t in ids:
            u = (src_uv[t][0] - lo[0]) * scale + ox
            v = (src_uv[t][1] - lo[1]) * scale + oy
            uvs.append(ATLAS.map('skin', u, v))
        part.face([vertex(i) for i in face], uvs)

    head_pts = verts[[i for face, _ in keep for i in face if verts[i][1] > 2.062]]
    head_centre = np.array([0.0, (head_pts[:, 1].max() + anat['face']['lip_y']) * 0.5,
                            head_pts[:, 2].mean()])
    return part, head_centre


def build_eyes(lm):
    """Opaque eyeballs seated in the CC0 eyelids; iris and pupil are painted, not modelled."""
    part = pc.Part('eyes', 'eye', 'eye', weights='head')
    rect = ATLAS.map('eye', 0.04, 0.04) + ATLAS.map('eye', 0.96, 0.96)
    for key in ('eye_l', 'eye_r'):
        pc.uv_sphere(part, lm[key], 0.0228, 10, 16, rect, shade_base=0.5)
    return part


# --------------------------------------------------------------------------- hair and face hair


def build_hair(sampler, lm, head_centre):
    """Swept-back hair grown off the scalp by sampling the smoothed skull field, plus a queue."""
    part = pc.Part('hair', 'hair', 'hair', weights='head')
    nu, nv = 30, 7

    def hairline(theta):
        """Lower edge of the hair, as an elevation from the skull centre.

        High at the forehead so the brow reads, but well below the ears at the sides and
        lower again at the nape - stopping level with the skull centre left a bald band
        around the back of the head under the tricorn.
        """
        c = math.cos(theta)
        return -0.40 + 0.70 * max(0.0, c) ** 1.4 - 0.45 * max(0.0, -c)

    def node(i, j):
        theta = TAU * i / nu
        lo = hairline(theta)
        phi = lo + (1.50 - lo) * (j / nv)
        d = np.array([-math.sin(theta) * math.cos(phi), math.sin(phi), -math.cos(theta) * math.cos(phi)])
        r = sampler.head_radius(head_centre, theta, phi)
        t = j / nv
        wrapped = theta if theta < math.pi else theta - TAU
        quiff = 0.026 * math.exp(-(wrapped / 0.85) ** 2) * pc.smoothstep(0.30, 0.92, t)
        backs = 0.020 * max(0.0, -math.cos(theta)) * pc.smoothstep(0.0, 0.7, t)
        return head_centre + d * (r + 0.010 + float(quiff) + float(backs)), d

    def uv(i, j):
        return ATLAS.map('hair', (i % (nu + 1)) / nu, j / nv, (0.02, 0.30, 0.98, 0.98))

    def shade(i, j):
        theta = TAU * i / nu
        return 0.50 + 0.20 * math.sin(theta * 5.0 + j * 0.9) * (0.4 + 0.6 * j / nv)

    pc.shell(part, nu, nv, node, lambda i, j: 0.009 + 0.008 * (1.0 - j / nv), uv,
             wrap_u=True, shade=shade, rim_shade=-0.16)

    nape = head_centre + np.array([0.0, -0.078, 0.156])
    path = [nape,
            nape + np.array([0.0, -0.036, 0.034]),
            nape + np.array([0.0, -0.098, 0.048]),
            nape + np.array([0.0, -0.158, 0.040]),
            nape + np.array([0.0, -0.200, 0.020])]
    pc.tube(part, path, [0.034, 0.030, 0.023, 0.016, 0.007], 8,
            ATLAS.map('hair', 0.04, 0.02) + ATLAS.map('hair', 0.96, 0.26), shade_base=0.46)
    return part


def build_face_hair(sampler, face, head_centre):
    """Moustache, short beard and brows, placed off MEASURED face geometry.

    Everything here is laid out in real (x, y) on the face and dropped onto the skin by
    casting straight back along +Z, so a band quoted as 'between the lip line and the
    nose base' lands exactly there. The earlier passes hung this geometry off the
    joint-mouth marker - an internal jaw pivot 35 mm above and 150 mm behind the lips -
    and off an azimuth measured from the eyeball centre, which is why the moustache
    covered the nose and the brows sat out on the temples.
    """
    part = pc.Part('face_hair', 'hair', 'hair', weights='head')
    lip_y = face['lip_y']
    nose_base_y = face['nose_base_y']
    chin_y = face['chin_y']

    def drop(x, y, lift):
        point, normal = sampler.face_drop(x, y)
        return point + normal * lift, normal

    def band(nu, nv, x_half, edges, thickness, sub, shade_base, pinch=0.42):
        def node(i, j):
            u = i / nu
            x = -x_half + 2.0 * x_half * u
            lo, hi = edges(u)
            mid = (lo + hi) * 0.5
            half = (hi - lo) * 0.5 * math.sin(math.pi * min(max(u, 0.0), 1.0)) ** pinch
            return drop(x, mid + (2.0 * (j / nv) - 1.0) * half, 0.0048 + thickness(u, j / nv))

        pc.shell(part, nu, nv, node, lambda i, j: thickness(i / nu, j / nv),
                 lambda i, j: ATLAS.map('hair', i / nu, j / nv, sub),
                 shade=lambda i, j: shade_base + 0.20 * math.sin(i * 2.3 + j * 0.8)
                 + 0.10 * math.sin(i * 5.1 + 1.3),
                 rim_shade=-0.07)

    # --- short beard: jaw line up to just under the lower lip -------------------
    jaw_half = 0.072

    def beard_edges(u):
        a = abs(2.0 * u - 1.0)
        low = chin_y + 0.013 + 0.038 * a ** 2.0
        high = lip_y - 0.034 + 0.056 * a ** 1.1
        return low, high

    def beard_thick(u, v):
        return 0.0034 + 0.0052 * math.sin(math.pi * min(max(u, 0.0), 1.0)) ** 0.45 \
            * math.sin(math.pi * min(max(v, 0.0), 1.0)) ** 0.30

    band(24, 9, jaw_half, beard_edges, beard_thick, (0.50, 0.02, 0.98, 0.42), 0.50, pinch=0.36)

    # --- moustache: strictly between the lip line and the base of the nose ------
    def stache_edges(u):
        a = abs(2.0 * u - 1.0)
        span = nose_base_y - lip_y
        return lip_y + 0.16 * span + 0.10 * span * a, nose_base_y - 0.12 * span - 0.30 * span * a ** 1.4

    def stache_thick(u, v):
        return 0.0028 + 0.0040 * math.sin(math.pi * min(max(u, 0.0), 1.0)) ** 0.55

    band(16, 4, face['mouth_half_x'] * 0.92, stache_edges, stache_thick,
         (0.02, 0.02, 0.46, 0.18), 0.54, pinch=0.46)

    # --- brows: thin arcs directly above each eye opening ------------------------
    for key, sign in (('eye_l', -1.0), ('eye_r', 1.0)):
        eye = face['eye'][key]
        inner_x = sign * (eye['x_lo'] - 0.004)
        outer_x = sign * (eye['x_hi'] + 0.005)
        base_y = eye['y_hi'] + 0.009
        bu, bv = 12, 2

        def brow_node(i, j, inner_x=inner_x, outer_x=outer_x, base_y=base_y):
            u = i / bu
            x = inner_x + (outer_x - inner_x) * u
            arch = base_y + 0.008 * math.sin(math.pi * u ** 0.8) - 0.005 * u
            half = 0.0068 * math.sin(math.pi * min(max(u, 0.0), 1.0)) ** 0.45
            thick = 0.0028 + 0.0030 * math.sin(math.pi * min(max(u, 0.0), 1.0)) ** 0.5
            return drop(x, arch + (2.0 * (j / bv) - 1.0) * half, 0.0028 + thick)

        pc.shell(part, bu, bv, brow_node,
                 lambda i, j: 0.0028 + 0.0030 * math.sin(math.pi * (i / bu)) ** 0.5,
                 lambda i, j: ATLAS.map('hair', i / bu, j / bv, (0.02, 0.20, 0.46, 0.28)),
                 shade=lambda i, j: 0.44, rim_shade=-0.05)
    return part


# --------------------------------------------------------------------------- garments


def coat_gap(t):
    """Half-angle of the coat's front opening; snug at the collar, wide at the hem."""
    if t >= 0.52:
        return math.radians(11.0 + 9.0 * (1.0 - (t - 0.52) / 0.48))
    return math.radians(20.0 + 42.0 * (1.0 - t / 0.52) ** 1.25)


COAT_HEM = 0.845
COAT_WAIST_T = 0.52


# Arc-length fractions along arm_polyline, measured once from the CC0 joint spacing.
ARM_S_SHOULDER = 0.178
ARM_S_ELBOW = 0.563
ARM_S_WRIST = 0.940


def arm_polyline(lm, side):
    """Shoulder-cap start, shoulder, upper arm, elbow, wrist, a little past the hand.

    Every arm garment and the cached arm radius table share this one polyline, so the
    same s means the same place on the arm for all of them.
    """
    shoulder = lm['shoulder_' + side.lower()]
    elbow = lm['elbow_' + side.lower()]
    wrist = lm['wrist_' + side.lower()]
    return [shoulder + pc.unit(shoulder - elbow) * 0.155, shoulder,
            shoulder * 0.35 + elbow * 0.65, elbow, wrist, wrist + (wrist - elbow) * 0.16]


def leg_polyline(lm, side):
    hip = lm['hip_' + side.lower()]
    knee = lm['knee_' + side.lower()]
    ankle = lm['ankle_' + side.lower()]
    return [hip + np.array([0.0, 0.030, 0.0]), knee, ankle]


def build_coat(sampler, lm):
    """Fitted navy coat: real collar, open front, cuffed sleeves and split back tails.

    The back seam sits on a fixed column index at every height, so opening it into two
    tails below the waist produces two clean straight edges instead of the stair-stepped
    holes and bridges the first pass produced by masking a moving angular window.
    """
    part = pc.Part('coat', 'cloth_navy', 'coat', weights='coat')
    nu, nv = 40, 16
    half = nu // 2

    def top_y(theta):
        return 2.052 - 0.058 * math.sin(theta) ** 2 + 0.018 * max(0.0, -math.cos(theta)) ** 2

    waist_r = {}

    SHOULDER_Y = 1.972

    def body_radius(theta, y):
        if y <= SHOULDER_Y:
            return sampler.torso_radius(theta, y) + COAT_OFFSET
        base = sampler.torso_radius(theta, SHOULDER_Y) + COAT_OFFSET
        return base * (1.0 - 0.34 * pc.smoothstep(SHOULDER_Y, 2.052, y))

    def radius(theta, y, t):
        key = round(theta, 5)
        if key not in waist_r:
            waist_r[key] = sampler.torso_radius(theta, 1.418) + COAT_OFFSET
        if t >= COAT_WAIST_T:
            return body_radius(theta, y)
        flare = 1.0 + 1.00 * (1.0 - t / COAT_WAIST_T) ** 1.6
        blend = pc.smoothstep(COAT_WAIST_T - 0.16, COAT_WAIST_T, t)
        near = body_radius(theta, y)
        return float(waist_r[key] * flare * (1.0 - blend) + near * blend)

    def back_slit(t):
        if t >= COAT_WAIST_T:
            return math.radians(0.4)
        return math.radians(0.4 + 10.5 * (1.0 - t / COAT_WAIST_T) ** 1.15)

    def theta_of(i, j):
        t = j / nv
        g = coat_gap(t)
        s = back_slit(t)
        if i <= half:
            return g + (math.pi - s - g) * (i / half)
        return math.pi + s + (TAU - g - math.pi - s) * ((i - half - 1) / half)

    def fold(theta, t):
        return MAX_FOLD * (0.62 * math.sin(theta * 6.0 + 0.7) * (0.25 + 0.75 * (1.0 - t))
                           + 0.38 * math.sin(theta * 11.0 + 2.1) * (1.0 - t) ** 2)

    def node(i, j):
        t = j / nv
        theta = theta_of(i, j)
        y = COAT_HEM + (top_y(theta) - COAT_HEM) * t
        d = np.array([-math.sin(theta), 0.0, -math.cos(theta)])
        r = radius(theta, y, t) + fold(theta, t)
        return np.array([0.0, y, TORSO_AXIS_Z]) + d * r, d

    def shade(i, j):
        t = j / nv
        theta = theta_of(i, j)
        return 0.52 + 0.26 * math.sin(theta * 6.0 + 0.7) * (0.25 + 0.75 * (1.0 - t))

    # Node columns half and half+1 are the two sides of the back seam: the single quad
    # between them is the seam, and it is the only quad ever dropped.
    pc.shell(part, nu + 1, nv, node, lambda i, j: 0.009,
             lambda i, j: ATLAS.map('coat', i / (nu + 1), j / nv, (0.02, 0.34, 0.98, 0.98)),
             mask=lambda i, j: i != half, shade=shade, rim_shade=-0.14)

    # Lapels: the front edges folded back over the chest, thick enough to read in profile.
    for sign in (-1.0, 1.0):
        lu, lv = 7, 8

        def lapel_node(i, j, sign=sign):
            t = COAT_WAIST_T + (0.93 - COAT_WAIST_T) * (j / lv)
            g = coat_gap(t)
            width = math.radians(10.0 + 22.0 * (j / lv) ** 1.25)
            theta = (g + width * (i / lu)) * sign
            y = COAT_HEM + (top_y(theta) - COAT_HEM) * t
            d = np.array([-math.sin(theta), 0.0, -math.cos(theta)])
            curl = 0.014 * math.sin(math.pi * (i / lu) ** 0.85)
            r = body_radius(theta, y) + 0.002 + curl
            return np.array([0.0, y, TORSO_AXIS_Z]) + d * r, d

        pc.shell(part, lu, lv, lapel_node, lambda i, j: 0.008,
                 lambda i, j: ATLAS.map('coat', 0.04 + 0.42 * (i / lu), 0.03 + 0.26 * (j / lv)),
                 shade=lambda i, j: 0.62 - 0.16 * (i / lu), rim_shade=-0.18)

    # Sleeves with a turned-back cuff at the forearm.
    for side in ('L', 'R'):
        arm = arm_polyline(lm, side)
        su, sv = 16, 10

        def sleeve_node(i, j, arm=arm, side=side):
            s = (j / sv) * 0.79
            point, _, sd, front = frame_at(arm, s)
            angle = TAU * i / su
            r = sampler.limb_radius('arm' + side, arm, s, angle, fallback=0.062)
            grow = SLEEVE_COAT + 0.016 * pc.smoothstep(0.34, 0.16, s)
            cuff = 0.022 * pc.smoothstep(0.64, 0.72, s) * pc.smoothstep(0.82, 0.73, s)
            crease = 0.0035 * math.sin(angle * 4.0 + s * 9.0)
            cap = math.sin(min(1.0, s / 0.30) * math.pi * 0.5) ** 0.55
            d = ring_dir(sd, front, angle)
            return point + d * ((r + float(grow) + float(cuff) + crease) * cap), d

        pc.shell(part, su, sv, sleeve_node, lambda i, j: 0.008,
                 lambda i, j: ATLAS.map('coat', i / su, j / sv, (0.02, 0.03, 0.98, 0.30)),
                 wrap_u=True, shade=lambda i, j: 0.50 + 0.22 * math.sin(TAU * i / su * 2.0 + 0.4),
                 rim_shade=-0.16)
    return part


def build_shirt(sampler, lm):
    """Ivory shirt: deliberate broad folds, open neck, full sleeves to the wrist."""
    part = pc.Part('shirt', 'cloth_ivory', 'shirt', weights='body')
    nu, nv = 26, 9

    def top_y(theta):
        return 1.945 + 0.145 * (0.5 - 0.5 * math.cos(theta)) ** 0.7 - 0.055 * math.sin(theta) ** 2

    def node(i, j):
        theta = TAU * i / nu
        t = j / nv
        y = 1.285 + (top_y(theta) - 1.285) * t
        d = np.array([-math.sin(theta), 0.0, -math.cos(theta)])
        r = sampler.torso_radius(theta, y) + SHIRT_OFFSET
        r += MAX_FOLD * (0.65 * math.sin(theta * 5.0 + 1.3) * (0.3 + 0.7 * (1.0 - t))
                         + 0.35 * math.sin(theta * 9.0 + y * 7.0))
        return np.array([0.0, y, TORSO_AXIS_Z]) + d * r, d

    def shade(i, j):
        theta = TAU * i / nu
        return 0.55 + 0.28 * math.sin(theta * 5.0 + 1.3) * (0.3 + 0.7 * (1.0 - j / nv))

    pc.shell(part, nu, nv, node, lambda i, j: 0.006,
             lambda i, j: ATLAS.map('shirt', i / nu, j / nv, (0.02, 0.34, 0.98, 0.98)),
             wrap_u=True, shade=shade, rim_shade=-0.12)

    for side in ('L', 'R'):
        arm = arm_polyline(lm, side)
        su, sv = 16, 10

        def sleeve_node(i, j, arm=arm, side=side):
            s = (j / sv) * 0.965
            point, _, sd, front = frame_at(arm, s)
            angle = TAU * i / su
            r = sampler.limb_radius('arm' + side, arm, s, angle, fallback=0.060)
            slack = SLEEVE_SHIRT * (1.0 - 0.45 * pc.smoothstep(0.82, 0.95, s))
            billow = 0.0035 * math.sin(angle * 3.0 + s * 12.0) * (1.0 - pc.smoothstep(0.78, 0.95, s))
            cap = math.sin(min(1.0, s / 0.28) * math.pi * 0.5) ** 0.55
            d = ring_dir(sd, front, angle)
            return point + d * ((r + float(slack) + billow) * cap), d

        pc.shell(part, su, sv, sleeve_node, lambda i, j: 0.005,
                 lambda i, j: ATLAS.map('shirt', i / su, j / sv, (0.02, 0.03, 0.98, 0.30)),
                 wrap_u=True, shade=lambda i, j: 0.58 + 0.22 * math.sin(TAU * i / su * 3.0 + 0.8),
                 rim_shade=-0.14)
    return part


def build_breeches(sampler, lm):
    part = pc.Part('breeches', 'cloth_navy', 'trouser', weights='body')
    for side in ('L', 'R'):
        leg = leg_polyline(lm, side)
        nu, nv = 16, 7

        def node(i, j, leg=leg, side=side):
            s = (j / nv) * 0.84
            point, _, sd, front = frame_at(leg, s)
            angle = TAU * i / nu
            r = sampler.limb_radius('leg' + side, leg, s, angle, fallback=0.075)
            slack = BREECHES_OFFSET + 0.012 * pc.smoothstep(0.42, 0.62, s) \
                - 0.006 * pc.smoothstep(0.66, 0.84, s)
            crease = 0.0035 * math.sin(angle * 4.0 + s * 10.0)
            d = ring_dir(sd, front, angle)
            return point + d * (r + float(slack) + crease), d

        pc.shell(part, nu, nv, node, lambda i, j: 0.007,
                 lambda i, j: ATLAS.map('trouser', i / nu, j / nv, (0.03, 0.03, 0.97, 0.97)),
                 wrap_u=True, shade=lambda i, j: 0.50 + 0.20 * math.sin(TAU * i / nu * 4.0 + 0.5),
                 rim_shade=-0.14)
    return part


def build_boots(sampler, lm):
    """Umber boots: bucket cuff, a shaft that runs past the ankle into a closed foot.

    The first pass left the shaft and the foot as two disconnected shells with open toe
    and heel ends. The shaft now continues below the ankle and the foot's cross-section
    closes to the sole line at both ends, so the boot is one continuous, watertight read.
    """
    part = pc.Part('boots', 'leather', 'leather', weights='body')
    for side in ('L', 'R'):
        leg = leg_polyline(lm, side)
        knee = lm['knee_' + side.lower()]
        ankle = lm['ankle_' + side.lower()]
        toe = lm['toe_' + side.lower()]
        heel = lm['heel_' + side.lower()]
        down = ankle - knee
        shaft_axis = [knee + down * 0.30, knee + down * 0.66, ankle, ankle + down * 0.10]
        nu, nv = 16, 9

        def shaft(i, j, leg=leg, shaft_axis=shaft_axis, side=side):
            t = j / nv
            point, _, sd, front = frame_at(shaft_axis, t)
            angle = TAU * i / nu
            s_leg = min(1.0, 0.30 + 0.70 * (0.66 + 0.34 * t))
            r = sampler.limb_radius('leg' + side, leg, 0.30 + 0.70 * t, angle, fallback=0.070)
            grow = BOOT_OFFSET + 0.052 * pc.smoothstep(0.13, 0.0, t) + 0.014 * pc.smoothstep(0.70, 1.0, t)
            crease = 0.0035 * math.sin(angle * 5.0 + t * 14.0) * (1.0 - t)
            d = ring_dir(sd, front, angle)
            return point + d * (r + float(grow) + crease), d

        pc.shell(part, nu, nv, shaft, lambda i, j: 0.009,
                 lambda i, j: ATLAS.map('leather', i / nu, j / nv, (0.02, 0.52, 0.98, 0.98)),
                 wrap_u=True,
                 shade=lambda i, j: 0.50 + 0.22 * math.sin(TAU * i / nu * 3.0 + 1.1)
                 + 0.10 * pc.smoothstep(0.2, 0.0, j / nv), rim_shade=-0.18)

        cx = float(ankle[0])
        z_heel = float(heel[2]) + 0.062
        z_toe = float(toe[2]) - 0.034
        sole_y = 0.021
        fu, fv = 18, 12

        def taper(s):
            return (1.0 - (2.0 * s - 1.0) ** 8) ** 0.30

        def profile(s):
            shape = math.sin(math.pi * min(max(s, 0.0), 1.0) ** 0.8)
            width = (0.050 + 0.026 * shape) * taper(s)
            rise = 0.138 - 0.084 * pc.smoothstep(0.20, 0.94, s)
            return width, rise * taper(s) ** 0.55

        def foot_node(i, j, cx=cx, z_heel=z_heel, z_toe=z_toe):
            s = j / fv
            z = z_heel + (z_toe - z_heel) * s
            width, height = profile(s)
            a = TAU * i / fu
            up = max(0.0, math.sin(a)) ** 0.72
            point = np.array([cx + width * math.cos(a), sole_y + height * up, z])
            nrm = pc.unit(np.array([math.cos(a), math.sin(a) if up > 0 else -1.0, 0.0]))
            return point, nrm

        pc.shell(part, fu, fv, foot_node, lambda i, j: 0.008,
                 lambda i, j: ATLAS.map('leather', i / fu, j / fv, (0.02, 0.03, 0.98, 0.48)),
                 wrap_u=True,
                 shade=lambda i, j: 0.52 + 0.18 * math.sin(TAU * i / fu) - 0.08 * (j / fv),
                 rim_shade=-0.16)

        # Sole slab: the outer grid is the ground-contact face, the slab grows upward.
        su, sv = 10, 12

        def sole_node(i, j, cx=cx, z_heel=z_heel, z_toe=z_toe):
            s = j / sv
            z = z_heel + (z_toe - z_heel) * s
            width, _ = profile(s)
            x = cx + (2.0 * (i / su) - 1.0) * (width + 0.005)
            lift = 0.007 * pc.smoothstep(0.88, 1.0, s)
            return np.array([x, 0.0015 + float(lift), z]), np.array([0.0, -1.0, 0.0])

        pc.shell(part, su, sv, sole_node, lambda i, j: sole_y + 0.004,
                 lambda i, j: ATLAS.map('leather', 0.06 + 0.38 * (i / su), 0.50 + 0.46 * (j / sv)),
                 shade=lambda i, j: 0.26, wear=lambda i, j: 0.55, rim_shade=0.10)

        _box(part, np.array([cx, 0.0, z_heel - 0.026]), (0.047, 0.026, 0.040),
             ATLAS.rect('leather'), shade=0.24, sub=(0.55, 0.10, 0.90, 0.42))
    return part


def _box(part, centre, half, rect, shade=0.5, sub=(0.10, 0.10, 0.35, 0.35)):
    """Axis-aligned block; used for heels, buckle plates and hardware."""
    cx, cy, cz = centre
    hx, hy, hz = half
    corners = [(cx - hx, cy, cz - hz), (cx + hx, cy, cz - hz), (cx + hx, cy, cz + hz), (cx - hx, cy, cz + hz),
               (cx - hx, cy + hy * 2, cz - hz), (cx + hx, cy + hy * 2, cz - hz),
               (cx + hx, cy + hy * 2, cz + hz), (cx - hx, cy + hy * 2, cz + hz)]
    idx = [part.vert(c, shade) for c in corners]
    u0, v0, u1, v1 = rect
    a0, b0, a1, b1 = sub
    uv = [(u0 + (u1 - u0) * a0, v0 + (v1 - v0) * b0), (u0 + (u1 - u0) * a1, v0 + (v1 - v0) * b0),
          (u0 + (u1 - u0) * a1, v0 + (v1 - v0) * b1), (u0 + (u1 - u0) * a0, v0 + (v1 - v0) * b1)]
    quads = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    for q in quads:
        part.face([idx[k] for k in q], uv)


def crown_profile(t):
    """Short felt crown: straight sides for four fifths, then a rounded top."""
    if t <= 0.78:
        s = t / 0.78
        return 1.0 - 0.05 * s, 0.82 * s
    s = (t - 0.78) / 0.22
    return 0.95 * math.cos(s * math.pi * 0.5) ** 0.40, 0.82 + 0.18 * math.sin(s * math.pi * 0.5)


CROWN_H = 0.118


def build_hat(sampler, head_centre, hat_base_y, hat_fit_y):
    """Original tricorn.

    A tricorn is a round brim pinned UP on three sides; the three points are where the
    pinned sections meet, so the edge reaches furthest out at the points and rises highest
    between them. The first pass raised the points and left the sides flat, which read as
    a tall top hat with a floppy brim.
    """
    felt = pc.Part('tricorn', 'cloth_navy', 'hat', weights='head')
    band = pc.Part('hat_band', 'crew_accent', 'accent', weights='head')
    trim = pc.Part('hat_badge', 'brass', 'brass', weights='head')

    radii = {}

    def rad(theta):
        key = round(theta % TAU, 5)
        if key not in radii:
            radii[key] = sampler.head_ring_radius(head_centre, key, hat_fit_y) + 0.024
        return radii[key]

    nu, nv = 26, 7

    def crown_node(i, j):
        theta = TAU * i / nu
        factor, rise = crown_profile(j / nv)
        y = hat_base_y + CROWN_H * rise
        d = np.array([-math.sin(theta), 0.0, -math.cos(theta)])
        outward = pc.unit(d * max(factor, 0.05) + np.array([0.0, 1.6 * max(0.0, j / nv - 0.78) / 0.22, 0.0]))
        return np.array([0.0, y, head_centre[2]]) + d * (rad(theta) * factor), outward

    pc.shell(felt, nu, nv, crown_node, lambda i, j: 0.007,
             lambda i, j: ATLAS.map('hat', i / nu, 0.55 + 0.43 * (j / nv)), wrap_u=True,
             shade=lambda i, j: 0.56 - 0.14 * (j / nv), rim_shade=-0.16)

    bu, bv = 33, 5

    def point_lobe(theta):
        return (0.5 + 0.5 * math.cos(3.0 * theta)) ** 3.0

    def pinned(theta):
        return (0.5 - 0.5 * math.cos(3.0 * theta)) ** 1.15

    def brim_node(i, j):
        theta = TAU * i / bu
        t = j / bv
        inner = rad(theta) * 0.985
        outer = rad(theta) + 0.034 + 0.092 * point_lobe(theta)
        r = inner + (outer - inner) * t
        lift = (0.004 + 0.088 * pinned(theta)) * t ** 1.9 + 0.010 * point_lobe(theta) * t ** 2.4
        d = np.array([-math.sin(theta), 0.0, -math.cos(theta)])
        return np.array([0.0, hat_base_y + 0.004 + lift, head_centre[2]]) + d * r, np.array([0.0, -1.0, 0.0])

    pc.shell(felt, bu, bv, brim_node, lambda i, j: 0.009,
             lambda i, j: ATLAS.map('hat', i / bu, 0.02 + 0.48 * (j / bv)), wrap_u=True,
             shade=lambda i, j: 0.44 + 0.22 * (j / bv), rim_shade=-0.14)

    du, dv = 26, 2

    def band_node(i, j):
        theta = TAU * i / du
        rise = (0.020 + 0.030 * (j / dv)) / CROWN_H
        factor, _ = crown_profile(rise / 0.82 * 0.78)
        d = np.array([-math.sin(theta), 0.0, -math.cos(theta)])
        return (np.array([0.0, hat_base_y + CROWN_H * rise, head_centre[2]])
                + d * (rad(theta) * factor + 0.005), d)

    pc.shell(band, du, dv, band_node, lambda i, j: 0.005,
             lambda i, j: ATLAS.map('accent', i / du, 0.05 + 0.9 * (j / dv)), wrap_u=True,
             shade=lambda i, j: 0.55, rim_shade=-0.10)

    badge_centre = np.array([-0.056, hat_base_y + 0.042, head_centre[2] - rad(0.42) * 0.94])
    pc.uv_sphere(trim, badge_centre, 0.024, 6, 10, ATLAS.rect('brass'), shade_base=0.66,
                 scale=(1.0, 1.05, 0.34))
    return felt, band, trim


def build_sash(sampler):
    """Waist sash in the tintable crew accent, with a knot and a hanging tail."""
    part = pc.Part('sash', 'crew_accent', 'accent', weights='body')
    nu, nv = 30, 5

    def node(i, j):
        theta = TAU * i / nu
        t = j / nv
        y = 1.302 + 0.148 * t
        d = np.array([-math.sin(theta), 0.0, -math.cos(theta)])
        r = sampler.torso_radius(theta, y) + SASH_OFFSET
        knot = 0.009 * math.exp(-((((theta - 1.85 + math.pi) % TAU) - math.pi) / 0.30) ** 2)
        wrap = 0.004 * math.sin(theta * 7.0 + t * 5.0)
        return np.array([0.0, y, TORSO_AXIS_Z]) + d * (r + float(knot) + wrap), d

    pc.shell(part, nu, nv, node, lambda i, j: 0.007,
             lambda i, j: ATLAS.map('accent', i / nu, 0.05 + 0.42 * (j / nv)), wrap_u=True,
             shade=lambda i, j: 0.54 + 0.24 * math.sin(TAU * i / nu * 7.0 + (j / nv) * 5.0),
             rim_shade=-0.14)

    hip = np.array([-0.162, 1.330, 0.022])
    path = [hip, hip + np.array([-0.012, -0.062, 0.012]), hip + np.array([-0.004, -0.126, 0.030]),
            hip + np.array([0.010, -0.178, 0.036])]
    pc.tube(part, path, [0.034, 0.030, 0.024, 0.014], 8,
            ATLAS.map('accent', 0.05, 0.52) + ATLAS.map('accent', 0.95, 0.96), shade_base=0.50,
            squash=lambda k: (1.0, 0.42))
    return part


def build_leatherwork(sampler, lm):
    """Belt on the coat, diagonal map strap, satchel, chart roll and wrist bracers."""
    part = pc.Part('leatherwork', 'leather', 'leather', weights='body')
    nu, nv = 30, 3

    def belt_node(i, j):
        theta = TAU * i / nu
        y = 1.338 + 0.070 * (j / nv)
        d = np.array([-math.sin(theta), 0.0, -math.cos(theta)])
        return np.array([0.0, y, TORSO_AXIS_Z]) + d * (sampler.torso_radius(theta, y) + BELT_OFFSET), d

    pc.shell(part, nu, nv, belt_node, lambda i, j: 0.008,
             lambda i, j: ATLAS.map('leather', i / nu, 0.50 + 0.10 * (j / nv), (0.0, 0.0, 1.0, 1.0)),
             wrap_u=True, shade=lambda i, j: 0.44, rim_shade=-0.12)

    strap_path = []
    for k in range(11):
        t = k / 10.0
        theta = math.radians(-118.0) + math.radians(196.0) * t
        y = 2.000 - 0.63 * t
        d = np.array([-math.sin(theta), 0.0, -math.cos(theta)])
        r = sampler.torso_radius(theta, y) + (STRAP_OFFSET if 0.15 < t < 0.85 else STRAP_OFFSET - 0.008)
        strap_path.append(np.array([0.0, y, TORSO_AXIS_Z]) + d * r)
    pc.tube(part, strap_path, [0.020] + [0.028] * 9 + [0.020], 8,
            ATLAS.map('leather', 0.02, 0.62) + ATLAS.map('leather', 0.98, 0.72),
            shade_base=0.46, squash=lambda k: (1.0, 0.26))

    bag_centre = np.array([0.182, 1.176, 0.058])
    axis = [bag_centre + np.array([-0.052, 0.0, 0.0]), bag_centre, bag_centre + np.array([0.052, 0.0, 0.0])]
    pc.tube(part, axis, [0.070, 0.078, 0.068], 12,
            ATLAS.map('leather', 0.04, 0.06) + ATLAS.map('leather', 0.60, 0.44),
            shade_base=0.48, squash=lambda k: (0.62, 1.0))
    fu, fv = 8, 4

    def flap_node(i, j):
        u = i / fu
        v = j / fv
        x = bag_centre[0] + (u - 0.5) * 0.112
        ang = -0.35 + 2.05 * v
        z = bag_centre[2] + math.cos(ang) * 0.052
        y = bag_centre[1] + math.sin(ang) * 0.082
        return np.array([x, y, z]), pc.unit(np.array([0.0, -math.sin(ang), -math.cos(ang)]))

    pc.shell(part, fu, fv, flap_node, lambda i, j: 0.006,
             lambda i, j: ATLAS.map('leather', 0.62 + 0.34 * (i / fu), 0.06 + 0.36 * (j / fv)),
             shade=lambda i, j: 0.54 - 0.10 * (j / fv), rim_shade=-0.14)

    for side in ('L', 'R'):
        arm = arm_polyline(lm, side)
        bu, bv = 12, 2

        def bracer(i, j, arm=arm, side=side):
            s = 0.885 + 0.055 * (j / bv)
            point, _, sd, front = frame_at(arm, s)
            angle = TAU * i / bu
            r = sampler.limb_radius('arm' + side, arm, s, angle, fallback=0.050)
            d = ring_dir(sd, front, angle)
            return point + d * (r + SLEEVE_SHIRT + 0.006), d

        pc.shell(part, bu, bv, bracer, lambda i, j: 0.007,
                 lambda i, j: ATLAS.map('leather', 0.02 + 0.96 * (i / bu), 0.76 + 0.10 * (j / bv)),
                 wrap_u=True, shade=lambda i, j: 0.42, rim_shade=-0.12)
    return part


def build_hardware(sampler):
    """Warm brass only where hardware makes sense: belt buckle, coat buttons, strap clasp."""
    part = pc.Part('hardware', 'brass', 'brass', weights='body')
    r = sampler.torso_radius(0.0, 1.372) + BELT_OFFSET
    _box(part, np.array([0.0, 1.344, TORSO_AXIS_Z - r - 0.006]), (0.031, 0.028, 0.008),
         ATLAS.rect('brass'), shade=0.70, sub=(0.06, 0.06, 0.44, 0.44))
    _box(part, np.array([0.0, 1.352, TORSO_AXIS_Z - r - 0.010]), (0.018, 0.016, 0.005),
         ATLAS.rect('brass'), shade=0.52, sub=(0.56, 0.56, 0.92, 0.92))

    for k in range(3):
        y = 1.680 + 0.092 * k
        ang = math.radians(15.0 + 3.0 * k)
        d = np.array([-math.sin(ang), 0.0, -math.cos(ang)])
        rr = sampler.torso_radius(ang, y) + COAT_OFFSET + 0.010
        pc.uv_sphere(part, np.array([0.0, y, TORSO_AXIS_Z]) + d * rr, 0.0125, 5, 8,
                     ATLAS.rect('brass'), shade_base=0.72, scale=(1.0, 1.0, 0.55))

    ang = math.radians(-52.0)
    d = np.array([-math.sin(ang), 0.0, -math.cos(ang)])
    rr = sampler.torso_radius(ang, 1.742) + STRAP_OFFSET + 0.004
    clasp = np.array([0.0, 1.742, TORSO_AXIS_Z]) + d * rr
    pc.uv_sphere(part, clasp, 0.026, 6, 12, ATLAS.rect('brass'), shade_base=0.74, scale=(1.0, 1.0, 0.30))
    pc.uv_sphere(part, clasp + d * 0.006, 0.012, 5, 8, ATLAS.rect('brass'), shade_base=0.50,
                 scale=(1.0, 1.0, 0.45))
    return part


def build_chart_roll():
    """A rolled chart under the satchel flap: the navigator's one ivory prop."""
    part = pc.Part('chart', 'cloth_ivory', 'shirt', weights='body')
    centre = np.array([0.182, 1.240, 0.040])
    pc.tube(part, [centre + np.array([-0.070, 0.006, 0.0]), centre, centre + np.array([0.074, -0.004, 0.0])],
            [0.016, 0.018, 0.016], 8,
            ATLAS.map('shirt', 0.04, 0.04) + ATLAS.map('shirt', 0.46, 0.30), shade_base=0.62)
    return part


def build_parts(anat, sampler):
    lm = anat['lm']
    skin, head_centre = build_skin(anat)
    hat_base_y = lm['eye_l'][1] + 0.104
    felt, band, badge = build_hat(sampler, head_centre, hat_base_y, lm['eye_l'][1] + 0.032)
    parts = [
        skin,
        build_eyes(lm),
        build_hair(sampler, lm, head_centre),
        build_face_hair(sampler, anat['face'], head_centre),
        build_shirt(sampler, lm),
        build_breeches(sampler, lm),
        build_coat(sampler, lm),
        build_boots(sampler, lm),
        build_leatherwork(sampler, lm),
        build_sash(sampler),
        build_hardware(sampler),
        build_chart_roll(),
        felt, band, badge,
    ]
    for part in (felt, band, badge):
        rotate_part(part, math.radians(-7.0), (1.0, 0.0, 0.0),
                    (0.0, hat_base_y, head_centre[2] + 0.02))
    return parts, head_centre


# --------------------------------------------------------------------------- texture painting


def _blob(pos, centre, radius, falloff=2.0):
    d = np.linalg.norm(pos - np.asarray(centre, dtype=float), axis=1) / radius
    return np.clip(1.0 - d * d, 0.0, 1.0) ** falloff


def paint_skin(pos, nrm, shade, wear, ctx):
    lm = ctx['lm']
    base = pc.hex_to_rgb(PALETTE['skin'])
    rgb = np.tile(base, (len(pos), 1))
    grain = pc.fbm(pos, 13.0, 3, SEED + 11)
    rgb *= (0.965 + 0.07 * grain)[:, None]
    mottle = pc.fbm(pos, 7.0, 2, SEED + 23)
    rgb[:, 0] *= 1.0 + 0.035 * (mottle - 0.5)
    rgb[:, 2] *= 1.0 - 0.030 * (mottle - 0.5)

    face = ctx['face']
    eye_l, eye_r = lm['eye_l'], lm['eye_r']
    # Measured, not taken off joint-mouth: that marker is an interior jaw pivot.
    lip_y = face['lip_y']
    nose_base_y = face['nose_base_y']
    chin_y = face['chin_y']
    front_z = -0.262
    mouth = np.array([0.0, lip_y, front_z])
    warm = np.array([0.86, 0.46, 0.36])
    cool = np.array([0.44, 0.33, 0.30])

    for eye in (eye_l, eye_r):
        socket = _blob(pos, eye + np.array([0.0, 0.004, 0.014]), 0.052, 1.1)
        rgb = rgb * (1.0 - 0.20 * socket)[:, None] + cool * (0.20 * socket)[:, None]
        lid = _blob(pos, eye + np.array([0.0, 0.019, -0.004]), 0.032, 1.4)
        rgb *= (1.0 - 0.08 * lid)[:, None]
        cheek = _blob(pos, np.array([eye[0] * 1.30, eye[1] - 0.062, eye[2] - 0.006]), 0.070, 1.3)
        rgb = rgb * (1.0 - 0.22 * cheek)[:, None] + warm * (0.22 * cheek)[:, None]

    lips = _blob(pos, mouth, 0.030, 1.3)
    lips *= pc.smoothstep(0.026, 0.010, np.abs(pos[:, 0]) * 0.55 + np.abs(pos[:, 1] - lip_y))
    rose = np.array([0.70, 0.36, 0.32])
    rgb = rgb * (1.0 - 0.70 * lips)[:, None] + rose * (0.70 * lips)[:, None]
    seam = np.exp(-((pos[:, 1] - lip_y) / 0.0034) ** 2) * _blob(pos, mouth, 0.036, 1.0)
    rgb *= (1.0 - 0.40 * seam)[:, None]

    nose = _blob(pos, np.array([0.0, nose_base_y + 0.014, front_z - 0.010]), 0.028, 1.5)
    rgb = rgb * (1.0 - 0.20 * nose)[:, None] + warm * (0.20 * nose)[:, None]
    nostril = _blob(pos, np.array([0.0, nose_base_y - 0.001, front_z + 0.002]), 0.017, 1.0)
    rgb *= (1.0 - 0.28 * nostril)[:, None]

    hollow = _blob(pos, np.array([0.0, lip_y + 0.030, front_z + 0.010]), 0.150, 0.9) \
        * pc.smoothstep(lip_y + 0.090, lip_y + 0.030, pos[:, 1])
    rgb = rgb * (1.0 - 0.10 * hollow)[:, None] + np.array([0.58, 0.38, 0.31]) * (0.10 * hollow)[:, None]
    stubble = hollow * 0.0

    jaw_ao = pc.smoothstep(chin_y + 0.004, chin_y - 0.100, pos[:, 1])
    rgb *= (1.0 - 0.22 * jaw_ao)[:, None]
    down = np.clip(-nrm[:, 1], 0.0, 1.0)
    rgb *= (1.0 - 0.16 * down)[:, None]

    for sign in (-1.0, 1.0):
        ear = _blob(pos, np.array([sign * 0.098, eye_l[1] - 0.012, eye_l[2] + 0.072]), 0.040, 1.2)
        rgb = rgb * (1.0 - 0.30 * ear)[:, None] + np.array([0.72, 0.42, 0.34]) * (0.30 * ear)[:, None]

    hands = pc.smoothstep(1.72, 1.60, pos[:, 1])
    knuckle = pc.fbm(pos, 26.0, 2, SEED + 41)
    rgb *= (1.0 - 0.10 * hands * (1.0 - knuckle))[:, None]

    height = 0.50 + 0.09 * grain + 0.10 * lips - 0.22 * seam - 0.16 * nostril + 0.07 * stubble
    return rgb, height


def _cloth(pos, base, shade, wear, seed, weave=70.0, tone=0.30):
    rgb = np.tile(base, (len(pos), 1))
    fold = (shade - 0.5)
    rgb *= (1.0 + tone * fold)[:, None]
    w = pc.fbm(pos, weave, 2, seed)
    rgb *= (0.972 + 0.055 * w)[:, None]
    drift = pc.fbm(pos, 5.0, 2, seed + 101)
    rgb *= (0.94 + 0.12 * drift)[:, None]
    edge = np.clip(wear, 0.0, 1.0)
    rgb = rgb * (1.0 - 0.35 * edge)[:, None] + np.minimum(base * 2.1, 1.0) * (0.35 * edge)[:, None]
    height = 0.5 + 0.30 * fold + 0.05 * (w - 0.5)
    return rgb, height


def paint_coat(pos, nrm, shade, wear, ctx):
    rgb, height = _cloth(pos, pc.hex_to_rgb(PALETTE['navy']), shade, wear, SEED + 61, 62.0, 0.34)
    hem = pc.smoothstep(1.10, 0.86, pos[:, 1])
    rgb *= (1.0 - 0.16 * hem)[:, None]
    rgb *= (1.0 + 0.10 * pc.smoothstep(1.70, 2.05, pos[:, 1]))[:, None]
    return np.clip(rgb, 0.0, 1.0), height


def paint_hat(pos, nrm, shade, wear, ctx):
    rgb, height = _cloth(pos, pc.hex_to_rgb(PALETTE['navy_deep']), shade, wear, SEED + 67, 52.0, 0.30)
    dust = pc.fbm(pos, 18.0, 3, SEED + 71)
    rgb = rgb * (1.0 - 0.10 * dust)[:, None] + np.array([0.42, 0.40, 0.36]) * (0.10 * dust)[:, None]
    return np.clip(rgb, 0.0, 1.0), height


def paint_shirt(pos, nrm, shade, wear, ctx):
    rgb, height = _cloth(pos, pc.hex_to_rgb(PALETTE['ivory']), shade, wear, SEED + 73, 78.0, 0.26)
    warm = pc.fbm(pos, 9.0, 2, SEED + 79)
    rgb[:, 2] *= 0.97 + 0.05 * warm
    return np.clip(rgb, 0.0, 1.0), height


def paint_trouser(pos, nrm, shade, wear, ctx):
    rgb, height = _cloth(pos, pc.hex_to_rgb(PALETTE['breeches']), shade, wear, SEED + 83, 66.0, 0.30)
    knee = pc.smoothstep(0.80, 0.66, pos[:, 1]) * pc.smoothstep(0.52, 0.62, pos[:, 1])
    rgb *= (1.0 + 0.12 * knee)[:, None]
    return np.clip(rgb, 0.0, 1.0), height


def paint_accent(pos, nrm, shade, wear, ctx):
    """Near-neutral light weave: the crew tint lives in baseColorFactor, so it reads clean."""
    base = np.array([0.86, 0.87, 0.86])
    rgb, height = _cloth(pos, base, shade, wear, SEED + 89, 90.0, 0.26)
    return np.clip(rgb, 0.0, 1.0), height


def paint_leather(pos, nrm, shade, wear, ctx):
    base = pc.hex_to_rgb(PALETTE['leather'])
    rgb = np.tile(base, (len(pos), 1))
    grain = pc.ridged(pos, 38.0, 3, SEED + 97)
    rgb *= (0.925 + 0.14 * grain)[:, None]
    creases = pc.fbm(pos, 14.0, 2, SEED + 103)
    rgb *= (0.925 + 0.14 * creases)[:, None]
    rgb *= (1.0 + 0.30 * (shade - 0.5))[:, None]
    scuff = np.clip(pc.fbm(pos, 12.0, 3, SEED + 109) * 1.6 - 0.75, 0.0, 1.0) * np.clip(wear, 0.0, 1.0)
    rgb = rgb * (1.0 - 0.55 * scuff)[:, None] + np.array([0.55, 0.42, 0.31]) * (0.55 * scuff)[:, None]
    sole = pc.smoothstep(0.055, 0.020, pos[:, 1])
    rgb = rgb * (1.0 - 0.75 * sole)[:, None] + pc.hex_to_rgb(PALETTE['sole']) * (0.75 * sole)[:, None]
    height = 0.5 + 0.10 * (grain - 0.5) + 0.22 * (shade - 0.5) - 0.08 * scuff
    return np.clip(rgb, 0.0, 1.0), height


def paint_brass(pos, nrm, shade, wear, ctx):
    base = pc.hex_to_rgb(PALETTE['brass'])
    rgb = np.tile(base, (len(pos), 1))
    rgb *= (0.80 + 0.45 * shade)[:, None]
    patina = pc.fbm(pos, 46.0, 2, SEED + 113)
    rgb = rgb * (1.0 - 0.25 * patina)[:, None] + np.array([0.40, 0.44, 0.34]) * (0.25 * patina)[:, None]
    height = 0.5 + 0.18 * (shade - 0.5)
    return np.clip(rgb, 0.0, 1.0), height


def paint_hair(pos, nrm, shade, wear, ctx):
    base = pc.hex_to_rgb(PALETTE['hair'])
    rgb = np.tile(base, (len(pos), 1))
    strands = pc.fbm(pos, 105.0, 2, SEED + 127)
    rgb *= (0.86 + 0.42 * shade)[:, None]
    rgb *= (0.88 + 0.28 * strands)[:, None]
    warm = np.array([0.34, 0.24, 0.17])
    tip = pc.smoothstep(2.30, 2.52, pos[:, 1])
    rgb = rgb * (1.0 - 0.30 * tip)[:, None] + warm * (0.30 * tip)[:, None]
    height = 0.5 + 0.28 * (shade - 0.5) + 0.16 * (strands - 0.5)
    return np.clip(rgb, 0.0, 1.0), height


def paint_eye(pos, nrm, shade, wear, ctx):
    lm = ctx['lm']
    centres = np.stack([lm['eye_l'], lm['eye_r']])
    d0 = np.linalg.norm(pos - centres[0], axis=1)
    d1 = np.linalg.norm(pos - centres[1], axis=1)
    centre = np.where((d0 < d1)[:, None], centres[0], centres[1])
    dirv = pc.unit(pos - centre)
    look = pc.unit(np.array([0.0, 0.06, -1.0]))
    c = dirv @ look
    sclera = np.array([0.90, 0.88, 0.85])
    iris_outer = np.array([0.20, 0.12, 0.07])
    iris_inner = np.array([0.49, 0.31, 0.15])
    rgb = np.tile(sclera, (len(pos), 1))
    rgb *= (0.80 + 0.30 * pc.fbm(pos, 400.0, 2, SEED + 131))[:, None]
    iris = pc.smoothstep(0.930, 0.952, c)
    fibre = pc.fbm(pos, 900.0, 2, SEED + 137)
    iris_col = iris_outer[None, :] * (1.0 - pc.smoothstep(0.955, 0.995, c))[:, None] \
        + iris_inner[None, :] * pc.smoothstep(0.955, 0.995, c)[:, None]
    iris_col = iris_col * (0.82 + 0.36 * fibre)[:, None]
    rgb = rgb * (1.0 - iris)[:, None] + iris_col * iris[:, None]
    limbal = pc.smoothstep(0.926, 0.936, c) * (1.0 - pc.smoothstep(0.940, 0.950, c))
    rgb *= (1.0 - 0.55 * limbal)[:, None]
    pupil = pc.smoothstep(0.9955, 0.9975, c)
    rgb *= (1.0 - 0.93 * pupil)[:, None]
    height = 0.5 - 0.25 * iris
    return np.clip(rgb, 0.0, 1.0), height


PAINTERS = {
    'skin': paint_skin, 'coat': paint_coat, 'shirt': paint_shirt, 'trouser': paint_trouser,
    'hat': paint_hat, 'leather': paint_leather, 'brass': paint_brass, 'hair': paint_hair,
    'accent': paint_accent, 'eye': paint_eye,
}


def bake_textures(parts, ctx, out_dir):
    """Rasterise every part into an object-space G-buffer, then paint it procedurally."""
    buffers = pc.rasterize(parts, ATLAS, PAINT_IDS)
    filled = pc.dilate(buffers, 10)
    size = ATLAS_SIZE
    albedo = np.zeros((size, size, 3), dtype=np.float32)
    height = np.full((size, size), 0.5, dtype=np.float32)
    albedo[:] = np.array([0.5, 0.45, 0.42], dtype=np.float32)
    stats = {}
    for name, index in sorted(PAINT_IDS.items(), key=lambda kv: kv[1]):
        mask = buffers['pid'] == index
        count = int(mask.sum())
        stats[name] = count
        if not count:
            continue
        pos = buffers['pos'][mask].astype(float)
        nrm = buffers['nrm'][mask].astype(float)
        shade = buffers['aux'][mask][:, 0].astype(float)
        wear = buffers['aux'][mask][:, 1].astype(float)
        rgb, h = PAINTERS[name](pos, nrm, shade, wear, ctx)
        albedo[mask] = np.clip(rgb, 0.0, 1.0).astype(np.float32)
        height[mask] = np.clip(h, 0.0, 1.0).astype(np.float32)
    albedo_path = out_dir / 'navigator_albedo.png'
    normal_path = out_dir / 'navigator_normal.png'
    pc.write_png(albedo_path, pc.srgb_bytes(albedo))
    normal = pc.height_to_normal(height, 2.1, downsample=size // NORMAL_SIZE)
    pc.write_png(normal_path, pc.srgb_bytes(normal))
    coverage = float(filled.mean())
    return albedo_path, normal_path, stats, coverage


# --------------------------------------------------------------------------- Blender objects


def game_to_blender(v):
    """Game (x, y up, -z front) -> Blender (x, -z, y up), with the one final stature scale.

    The art is authored at CC0 anatomical scale and stretched once, uniformly, at the very
    last step, so proportions (~6.4 heads) survive while the shipped character lands in the
    2.65-2.9 m stature band the direction asks for. Painting still happens in the authored
    space, which keeps every hard-coded landmark threshold in the paint routines valid.
    """
    k = FINAL_SCALE
    return (float(v[0]) * k, float(-v[2]) * k, float(v[1]) * k)


def create_objects(parts):
    """One object per material: eight primitives, eight materials, nothing duplicated."""
    grouped = {}
    order = []
    for part in parts:
        if part.material not in grouped:
            grouped[part.material] = []
            order.append(part.material)
        grouped[part.material].append(part)

    objects = {}
    skin_data = {}
    for material in order:
        verts = []
        faces = []
        uvs = []
        modes = []
        for part in grouped[material]:
            base = len(verts)
            verts.extend(part.verts)
            modes.extend([part.weights] * len(part.verts))
            for face, fuv in zip(part.faces, part.face_uvs):
                faces.append(tuple(i + base for i in face))
                uvs.append(fuv)
        mesh = bpy.data.meshes.new('navigator_' + material)
        mesh.from_pydata([game_to_blender(v) for v in verts], [], [list(f) for f in faces])
        mesh.validate(verbose=False)
        layer = mesh.uv_layers.new(name='UVMap')
        loop_uv = []
        for poly, fuv in zip(mesh.polygons, uvs):
            for k in range(poly.loop_total):
                loop_uv.extend(fuv[k])
        layer.data.foreach_set('uv', loop_uv)
        smooth = np.ones(len(mesh.polygons), dtype=bool)
        mesh.polygons.foreach_set('use_smooth', smooth)
        obj = bpy.data.objects.new('navigator_' + material, mesh)
        bpy.context.scene.collection.objects.link(obj)
        objects[material] = obj
        skin_data[material] = {'verts': np.array(verts, dtype=float), 'modes': modes}
        _mark_sharp(mesh, math.radians(46.0))
    return objects, skin_data


def _mark_sharp(mesh, threshold):
    bm = bmesh.new()
    bm.from_mesh(mesh)
    for edge in bm.edges:
        if len(edge.link_faces) == 2:
            edge.smooth = edge.calc_face_angle(0.0) < threshold
        else:
            edge.smooth = False
    bm.to_mesh(mesh)
    bm.free()


def create_materials(objects, albedo_path, normal_path):
    albedo = bpy.data.images.load(str(albedo_path))
    albedo.colorspace_settings.name = 'sRGB'
    normal = bpy.data.images.load(str(normal_path))
    normal.colorspace_settings.name = 'Non-Color'
    for name, spec in MATERIALS.items():
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = albedo
        nrm_tex = nt.nodes.new('ShaderNodeTexImage')
        nrm_tex.image = normal
        nrm_map = nt.nodes.new('ShaderNodeNormalMap')
        nrm_map.inputs['Strength'].default_value = 0.40
        nt.links.new(nrm_tex.outputs['Color'], nrm_map.inputs['Color'])
        nt.links.new(nrm_map.outputs['Normal'], bsdf.inputs['Normal'])
        factor = spec['factor']
        if tuple(np.round(factor, 4)) != (1.0, 1.0, 1.0):
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            mix.inputs[6].default_value = (*factor, 1.0)
            nt.links.new(tex.outputs['Color'], mix.inputs[7])
            nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
        else:
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = spec['roughness']
        bsdf.inputs['Metallic'].default_value = spec['metallic']
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
        mat.blend_method = 'OPAQUE' if hasattr(mat, 'blend_method') else None
        objects[name].data.materials.append(mat)
    return albedo, normal


def bone_layout(lm):
    """Rest pose keeps the CC0 relaxed stance: arms down, elbows softly forward.

    Bone axis convention is Blender's own - local +Y runs head->tail, roll left at the
    default so the axes stay predictable; every animation angle below is authored in
    armature space and converted per bone, so no bone-roll assumptions leak into clips.
    """
    crown = np.array([0.0, lm['head_top'][1], lm['head'][2]])
    pelvis = lm['pelvis']
    tail_l = np.array([pelvis[0] - 0.086, pelvis[1] - 0.010, pelvis[2] + 0.084])
    tail_r = np.array([pelvis[0] + 0.086, pelvis[1] - 0.010, pelvis[2] + 0.084])
    return [
        ('root', None, np.array([0.0, 0.0, 0.0]), np.array([0.0, 0.17, 0.0])),
        ('hips', 'root', lm['pelvis'], lm['spine3']),
        ('spine', 'hips', lm['spine3'], lm['spine1']),
        ('chest', 'spine', lm['spine1'], lm['neck']),
        ('neck', 'chest', lm['neck'], lm['head']),
        ('head', 'neck', lm['head'], crown),
        ('upper_arm.L', 'chest', lm['shoulder_l'], lm['elbow_l']),
        ('forearm.L', 'upper_arm.L', lm['elbow_l'], lm['wrist_l']),
        ('hand.L', 'forearm.L', lm['wrist_l'], lm['finger_l']),
        ('upper_arm.R', 'chest', lm['shoulder_r'], lm['elbow_r']),
        ('forearm.R', 'upper_arm.R', lm['elbow_r'], lm['wrist_r']),
        ('hand.R', 'forearm.R', lm['wrist_r'], lm['finger_r']),
        ('thigh.L', 'hips', lm['hip_l'], lm['knee_l']),
        ('shin.L', 'thigh.L', lm['knee_l'], lm['ankle_l']),
        ('foot.L', 'shin.L', lm['ankle_l'], lm['toe_l']),
        ('thigh.R', 'hips', lm['hip_r'], lm['knee_r']),
        ('shin.R', 'thigh.R', lm['knee_r'], lm['ankle_r']),
        ('foot.R', 'shin.R', lm['ankle_r'], lm['toe_r']),
        ('coat_tail.L', 'hips', tail_l, tail_l + np.array([-0.030, -0.400, 0.048])),
        ('coat_tail.R', 'hips', tail_r, tail_r + np.array([0.030, -0.400, 0.048])),
    ]


def create_armature(layout):
    data = bpy.data.armatures.new('navigator_rig')
    arm = bpy.data.objects.new('SkywakeNavigator', data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for name, parent, head, tail in layout:
        bone = data.edit_bones.new(name)
        bone.head = game_to_blender(head)
        bone.tail = game_to_blender(tail)
        bone.use_deform = name != 'root'
        if parent:
            bone.parent = data.edit_bones[parent]
            bone.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


def _segment_distance(points, a, b):
    ab = b - a
    denom = float(ab @ ab)
    t = np.clip(((points - a) @ ab) / max(denom, 1e-12), 0.0, 1.0)
    closest = a[None, :] + t[:, None] * ab[None, :]
    return np.linalg.norm(points - closest, axis=1)


def compute_weights(verts, modes, layout):
    """Smooth distance-falloff skinning, normalised to at most four influences.

    Coat geometry deliberately ignores the leg bones and picks up coat_tail.L/R instead,
    so the tails swing with the skirt rather than clipping through the thighs.
    """
    deform = [(name, head, tail) for name, parent, head, tail in layout if name != 'root']
    reach = {}
    for name, head, tail in deform:
        length = float(np.linalg.norm(tail - head))
        reach[name] = float(np.clip(length * 0.62, 0.075, 0.30))
    reach['hips'] = 0.24
    reach['chest'] = 0.26
    reach['head'] = 0.20

    modes = np.array(modes)
    weights = {}
    dist = {}
    for name, head, tail in deform:
        dist[name] = _segment_distance(verts, head, tail)

    left = 1.0 - pc.smoothstep(-0.045, 0.045, verts[:, 0])
    right = pc.smoothstep(-0.045, 0.045, verts[:, 0])
    raw = np.zeros((len(verts), len(deform)), dtype=float)
    names = [d[0] for d in deform]
    for k, (name, head, tail) in enumerate(deform):
        w = np.exp(-6.0 * (dist[name] / reach[name]) ** 2) + 1e-7
        if name in LEG_BONES:
            w = w * (left if name.endswith('.L') else right)
        allowed = np.ones(len(verts), dtype=float)
        if name in TAIL_BONES:
            allowed = (modes == 'coat').astype(float)
        elif name in LEG_BONES:
            allowed = (modes != 'coat').astype(float)
        head_only = (modes == 'head')
        allowed = allowed * (~head_only if name != 'head' else np.ones(len(verts), dtype=bool))
        raw[:, k] = w * allowed
    head_rows = modes == 'head'
    raw[head_rows, :] = 0.0
    raw[head_rows, names.index('head')] = 1.0

    order = np.argsort(-raw, axis=1)[:, :4]
    keep = np.zeros_like(raw)
    rows = np.arange(len(verts))[:, None]
    keep[rows, order] = raw[rows, order]
    totals = keep.sum(axis=1, keepdims=True)
    fallback = totals[:, 0] <= 1e-9
    if fallback.any():
        nearest = np.argmin(np.stack([dist[n] for n in names], axis=1)[fallback], axis=1)
        keep[np.nonzero(fallback)[0], nearest] = 1.0
        totals = keep.sum(axis=1, keepdims=True)
    keep = keep / np.maximum(totals, 1e-9)
    for k, name in enumerate(names):
        weights[name] = keep[:, k]
    return weights


def bind(objects, skin_data, arm, layout):
    for material, obj in objects.items():
        data = skin_data[material]
        weights = compute_weights(data['verts'], data['modes'], layout)
        for name, values in weights.items():
            idx = np.nonzero(values > 1e-4)[0]
            if not len(idx):
                continue
            group = obj.vertex_groups.new(name=name)
            for i in idx:
                group.add([int(i)], float(values[i]), 'REPLACE')
        obj.parent = arm
        obj.matrix_parent_inverse = Matrix.Identity(4)
        mod = obj.modifiers.new('Armature', 'ARMATURE')
        mod.object = arm
        mod.use_vertex_groups = True


SOCKETS = [
    ('weapon_grip.R', 'hand.R', (0.026, -0.020, -0.034)),
    ('weapon_grip.L', 'hand.L', (-0.026, -0.020, -0.034)),
    ('glider_grip.R', 'hand.R', (0.040, 0.010, -0.010)),
    ('glider_grip.L', 'hand.L', (-0.040, 0.010, -0.010)),
    ('stow_back', 'chest', (0.0, -0.030, 0.135)),
]


def create_sockets(arm, lm):
    """Future integration anchors. Bone-parented, so they ride the deforming skeleton."""
    made = {}
    anchors = {'hand.R': lm['wrist_r'], 'hand.L': lm['wrist_l'], 'chest': lm['spine1']}
    for name, bone_name, offset in SOCKETS:
        empty = bpy.data.objects.new(name, None)
        empty.empty_display_type = 'ARROWS'
        empty.empty_display_size = 0.06
        bpy.context.scene.collection.objects.link(empty)
        empty.parent = arm
        empty.parent_type = 'BONE'
        empty.parent_bone = bone_name
        bone = arm.data.bones[bone_name]
        tail_matrix = arm.matrix_world @ bone.matrix_local @ Matrix.Translation((0.0, bone.length, 0.0))
        target = np.asarray(anchors[bone_name], dtype=float) + np.asarray(offset, dtype=float)
        world = Matrix.Translation(Vector(game_to_blender(target)))
        empty.matrix_parent_inverse = Matrix.Identity(4)
        empty.matrix_basis = tail_matrix.inverted() @ world
        made[name] = (bone_name, tuple(float(v) for v in target))
    return made


# --------------------------------------------------------------------------- clips


def _local_rot(pb, rx, ry, rz):
    basis = pb.bone.matrix_local.to_3x3().inverted()
    q = Quaternion((1.0, 0.0, 0.0, 0.0))
    for axis, angle in ((Vector((1.0, 0.0, 0.0)), rx), (Vector((0.0, 1.0, 0.0)), ry),
                        (Vector((0.0, 0.0, 1.0)), rz)):
        if abs(angle) > 1e-9:
            q = Quaternion(basis @ axis, angle) @ q
    return q


def apply_pose(arm, pose):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.location = (0.0, 0.0, 0.0)
    for name, rot in pose.get('rot', {}).items():
        pb = arm.pose.bones[name]
        pb.rotation_quaternion = _local_rot(pb, *[math.radians(v) for v in rot])
    for name, loc in pose.get('loc', {}).items():
        pb = arm.pose.bones[name]
        pb.location = pb.bone.matrix_local.to_3x3().inverted() @ Vector(loc)


def make_action(arm, name, keys):
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = action
    for frame, pose in keys:
        apply_pose(arm, pose)
        for pb in arm.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=frame)
        for bone_name in ('hips', 'root'):
            arm.pose.bones[bone_name].keyframe_insert('location', frame=frame)
    return action


def idle_pose(t):
    breathe = math.sin(TAU * t)
    sway = math.sin(TAU * t + 1.25)
    return {
        'rot': {
            'spine': (0.9 * breathe, 0.0, 0.35 * sway),
            'chest': (1.5 * breathe, 0.0, 0.55 * sway),
            'neck': (-0.6 * breathe, 0.7 * sway, 0.0),
            'head': (-0.5 * breathe, 1.6 * sway, 0.5 * sway),
            'upper_arm.L': (1.9 * sway, 0.0, -1.4 * breathe),
            'upper_arm.R': (1.9 * sway, 0.0, 1.4 * breathe),
            'forearm.L': (-2.2 * breathe, 0.0, 0.0),
            'forearm.R': (-2.2 * breathe, 0.0, 0.0),
            'coat_tail.L': (1.6 * sway, 0.0, 0.0),
            'coat_tail.R': (1.6 * sway, 0.0, 0.0),
        },
        'loc': {'hips': (0.0, 0.0, 0.006 * breathe)},
    }


def _leg_cycle(phase):
    thigh = 22.0 * math.cos(phase)
    shin = -30.0 + 26.0 * math.cos(phase + 1.9) - 18.0 * math.cos(2.0 * phase)
    shin = min(-3.0, shin)
    foot = -(thigh + shin) * 0.55 + 6.0 * math.cos(phase + 2.6)
    return thigh, shin, foot


def walk_pose(t):
    phase = TAU * t
    lt, ls, lf = _leg_cycle(phase)
    rt, rs, rf = _leg_cycle(phase + math.pi)
    twist = 6.0 * math.sin(phase)
    return {
        'rot': {
            'hips': (2.0, 0.0, twist),
            'spine': (2.5, 0.0, -twist * 0.5),
            'chest': (1.5, 0.0, -twist * 0.7),
            'head': (-2.0, twist * 0.4, 0.0),
            'thigh.L': (lt, 0.0, 0.0), 'shin.L': (ls, 0.0, 0.0), 'foot.L': (lf, 0.0, 0.0),
            'thigh.R': (rt, 0.0, 0.0), 'shin.R': (rs, 0.0, 0.0), 'foot.R': (rf, 0.0, 0.0),
            'upper_arm.L': (-rt * 0.78, 0.0, -3.0), 'forearm.L': (-14.0 - 8.0 * math.cos(phase), 0.0, 0.0),
            'upper_arm.R': (-lt * 0.78, 0.0, 3.0), 'forearm.R': (-14.0 + 8.0 * math.cos(phase), 0.0, 0.0),
            'coat_tail.L': (-lt * 0.30, 0.0, 0.0),
            'coat_tail.R': (-rt * 0.30, 0.0, 0.0),
        },
        'loc': {'hips': (0.0, 0.0, 0.016 * math.cos(2.0 * phase))},
    }


RIG_CHECK_KEYS = [
    (1, {'rot': {}}),
    (13, {'rot': {
        'thigh.L': (52.0, 0.0, 6.0), 'shin.L': (-78.0, 0.0, 0.0), 'foot.L': (30.0, 0.0, 0.0),
        'thigh.R': (52.0, 0.0, -6.0), 'shin.R': (-78.0, 0.0, 0.0), 'foot.R': (30.0, 0.0, 0.0),
        'upper_arm.L': (44.0, 0.0, -16.0), 'forearm.L': (-82.0, 0.0, 0.0),
        'upper_arm.R': (44.0, 0.0, 16.0), 'forearm.R': (-82.0, 0.0, 0.0),
        'spine': (-10.0, 0.0, 0.0), 'chest': (-8.0, 0.0, 0.0), 'head': (12.0, 0.0, 0.0),
    }, 'loc': {'hips': (0.0, 0.0, -0.16)}}),
    (25, {'rot': {
        'spine': (0.0, 0.0, 22.0), 'chest': (0.0, 0.0, 16.0), 'head': (0.0, -18.0, 14.0),
        'upper_arm.L': (12.0, 0.0, -52.0), 'forearm.L': (-64.0, -24.0, 0.0),
        'upper_arm.R': (-24.0, 0.0, 30.0), 'forearm.R': (-70.0, 20.0, 0.0),
        'thigh.L': (26.0, 0.0, 8.0), 'shin.L': (-46.0, 0.0, 0.0), 'foot.L': (16.0, 0.0, 0.0),
        'thigh.R': (-14.0, 0.0, -4.0), 'shin.R': (-22.0, 0.0, 0.0),
        'coat_tail.L': (-16.0, 0.0, 6.0), 'coat_tail.R': (10.0, 0.0, -6.0),
    }}),
    (37, {'rot': {
        'spine': (0.0, 0.0, -22.0), 'chest': (0.0, 0.0, -16.0), 'head': (0.0, 18.0, -14.0),
        'upper_arm.R': (12.0, 0.0, 52.0), 'forearm.R': (-64.0, 24.0, 0.0),
        'upper_arm.L': (-24.0, 0.0, -30.0), 'forearm.L': (-70.0, -20.0, 0.0),
        'thigh.R': (26.0, 0.0, -8.0), 'shin.R': (-46.0, 0.0, 0.0), 'foot.R': (16.0, 0.0, 0.0),
        'thigh.L': (-14.0, 0.0, 4.0), 'shin.L': (-22.0, 0.0, 0.0),
        'coat_tail.R': (-16.0, 0.0, -6.0), 'coat_tail.L': (10.0, 0.0, 6.0),
    }}),
    (49, {'rot': {}}),
]


def create_clips(arm):
    idle_keys = [(1 + 8 * k, idle_pose((8 * k) / 96.0)) for k in range(13)]
    walk_keys = [(1 + 2 * k, walk_pose((2 * k) / 24.0)) for k in range(13)]
    actions = {
        'rig_check': make_action(arm, 'rig_check', RIG_CHECK_KEYS),
        'walk': make_action(arm, 'walk', walk_keys),
        'idle': make_action(arm, 'idle', idle_keys),
    }
    arm.animation_data.action = actions['idle']
    apply_pose(arm, {'rot': {}})
    return actions


BUDGETS = {
    'maxTriangles': 50000,
    'maxMaterials': 8,
    'maxMeshPrimitives': 16,
    'maxGlbBytes': 8 * 1024 * 1024,
    'maxDecodedTextureBytes': 32 * 1024 * 1024,
    'maxDeformJoints': 64,
    'maxImageDimension': 2048,
}


def export_glb(path):
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format='GLB',
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_keep_originals=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_skins=True,
        export_influence_nb=4,
        export_all_influences=False,
        export_def_bones=False,
        export_rest_position_armature=True,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_anim_single_armature=True,
        export_nla_strips=False,
        export_frame_range=False,
        export_force_sampling=True,
        export_bake_animation=False,
        export_optimize_animation_size=False,
        export_optimize_animation_keep_anim_armature=True,
        export_morph=False,
        export_attributes=False,
        use_selection=False,
        use_visible=True,
        use_renderable=False,
        use_active_collection=False,
    )


def inspect_and_validate(path, sockets, texture_stats):
    """Everything reported below is measured from the shipped GLB, never from source counts."""
    glb = pc.Glb(path)
    doc = glb.json
    problems = []

    def check(condition, message):
        if not condition:
            problems.append(message)

    check(glb.chunks[0] == 0x4E4F534A, 'first GLB chunk is not JSON')
    check(0x004E4942 in glb.chunks, 'GLB has no BIN chunk')
    check(not doc.get('extensionsRequired'), f'extensionsRequired must be empty, got {doc.get("extensionsRequired")}')
    check('cameras' not in doc or not doc['cameras'], 'GLB contains cameras')
    check('KHR_lights_punctual' not in (doc.get('extensionsUsed') or []), 'GLB contains punctual lights')

    triangles = 0
    primitives = 0
    skinned_primitives = 0
    bounds_min = np.array([math.inf] * 3)
    bounds_max = np.array([-math.inf] * 3)
    for mesh in doc.get('meshes', []):
        for prim in mesh['primitives']:
            primitives += 1
            check(prim.get('mode', 4) == 4, f'primitive in {mesh["name"]} is not TRIANGLES')
            indices = glb.accessor(prim['indices'])
            check(len(indices) % 3 == 0, 'index count is not a multiple of three')
            triangles += len(indices) // 3
            attrs = prim['attributes']
            check('NORMAL' in attrs and 'TEXCOORD_0' in attrs, f'{mesh["name"]} is missing normals or UVs')
            if 'JOINTS_0' in attrs and 'WEIGHTS_0' in attrs:
                skinned_primitives += 1
                weights = glb.accessor(attrs['WEIGHTS_0']).astype(float)
                sums = weights.sum(axis=1)
                check(float(np.abs(sums - 1.0).max()) < 2e-3,
                      f'{mesh["name"]} weights are not normalised (max drift {float(np.abs(sums - 1.0).max()):.4f})')
                joints = glb.accessor(attrs['JOINTS_0'])
                check(int(joints.max()) < len(doc['skins'][0]['joints']), 'JOINTS_0 index out of range')
            pos_acc = doc['accessors'][attrs['POSITION']]
            bounds_min = np.minimum(bounds_min, np.array(pos_acc['min'], dtype=float))
            bounds_max = np.maximum(bounds_max, np.array(pos_acc['max'], dtype=float))
            positions = glb.accessor(attrs['POSITION'])
            check(bool(np.isfinite(positions).all()), f'{mesh["name"]} has non-finite positions')

    material_names = [m.get('name', '') for m in doc.get('materials', [])]
    for mat in doc.get('materials', []):
        check(mat.get('alphaMode', 'OPAQUE') == 'OPAQUE', f'{mat.get("name")} is not OPAQUE')
        pbr = mat.get('pbrMetallicRoughness', {})
        check('baseColorTexture' in pbr, f'{mat.get("name")} has no baseColorTexture')
    check('crew_accent' in material_names, 'tintable material crew_accent is missing')
    check(len(material_names) == len(set(material_names)), 'duplicate material names')

    images = []
    total_decoded = 0
    for i, img in enumerate(doc.get('images', [])):
        blob = glb.image_bytes(i)
        width, height = pc.png_dimensions(blob)
        decoded = pc.decoded_texture_bytes(width, height)
        total_decoded += decoded
        images.append({'name': img.get('name', f'image{i}'), 'width': width, 'height': height,
                       'mimeType': img.get('mimeType', 'image/png'), 'embeddedBytes': len(blob),
                       'decodedBytes': decoded})
        check(width <= BUDGETS['maxImageDimension'] and height <= BUDGETS['maxImageDimension'],
              f'image {i} exceeds {BUDGETS["maxImageDimension"]}px')

    skins = doc.get('skins', [])
    joint_names = []
    if skins:
        nodes = doc['nodes']
        joint_names = [nodes[j].get('name', '') for j in skins[0]['joints']]
    for required in BONE_ORDER:
        check(required in joint_names, f'bone {required} missing from the exported skin')

    animations = []
    for anim in doc.get('animations', []):
        duration = 0.0
        for sampler in anim['samplers']:
            times = glb.accessor(sampler['input']).astype(float)
            check(bool(np.isfinite(times).all()), f'animation {anim.get("name")} has non-finite times')
            check(bool(np.all(np.diff(times) > -1e-9)), f'animation {anim.get("name")} times are not ordered')
            duration = max(duration, float(times.max()))
        moved = False
        for channel in anim['channels']:
            values = glb.accessor(anim['samplers'][channel['sampler']]['output']).astype(float)
            if values.ndim > 1 and float(np.abs(values - values[0]).max()) > 1e-5:
                moved = True
        check(moved, f'animation {anim.get("name")} has no channel that actually changes')
        animations.append({'name': anim.get('name'), 'duration': round(duration, 4),
                           'channels': len(anim['channels']), 'samplers': len(anim['samplers'])})
    names = [a['name'] for a in animations]
    for required in ('idle', 'walk', 'rig_check'):
        check(required in names, f'clip {required} missing from the exported GLB')
    check(len(names) == len(set(names)), 'duplicate clip names')

    node_names = [n.get('name', '') for n in doc.get('nodes', [])]
    parent_of = {}
    for i, node in enumerate(doc.get('nodes', [])):
        for child in node.get('children', []):
            parent_of[child] = i
    socket_report = []
    for name, (bone_name, translation) in sorted(sockets.items()):
        check(name in node_names, f'socket {name} missing')
        if name in node_names:
            idx = node_names.index(name)
            ancestry = []
            cursor = idx
            while cursor in parent_of:
                cursor = parent_of[cursor]
                ancestry.append(node_names[cursor])
            check(bone_name in ancestry, f'socket {name} is not parented under {bone_name} (ancestry {ancestry})')
            socket_report.append({'name': name, 'bone': bone_name, 'ancestry': ancestry,
                                  'restTranslationGame': [round(v, 4) for v in translation]})

    check(triangles <= BUDGETS['maxTriangles'], f'{triangles} triangles exceeds budget')
    check(len(material_names) <= BUDGETS['maxMaterials'], f'{len(material_names)} materials exceeds budget')
    check(primitives <= BUDGETS['maxMeshPrimitives'], f'{primitives} primitives exceeds budget')
    check(glb.bytes <= BUDGETS['maxGlbBytes'], f'{glb.bytes} bytes exceeds the GLB budget')
    check(total_decoded <= BUDGETS['maxDecodedTextureBytes'],
          f'{total_decoded} decoded texture bytes exceeds budget')
    check(len(joint_names) <= BUDGETS['maxDeformJoints'], f'{len(joint_names)} joints exceeds budget')
    check(abs(float(bounds_min[1])) < 0.02, f'feet are not on the ground plane (min Y {bounds_min[1]:.4f})')

    if problems:
        raise AssertionError('exported GLB failed validation:\n  - ' + '\n  - '.join(problems))

    crew = next(m for m in doc['materials'] if m.get('name') == 'crew_accent')
    return {
        'schemaVersion': 1,
        'id': 'skywake-navigator',
        'generator': 'tools/build-player-character.py',
        'buildVersion': BUILD_VERSION,
        'seed': SEED,
        'blenderVersion': bpy.app.version_string,
        'glb': path.name,
        'sha256': pc.sha256_file(path),
        'bytes': glb.bytes,
        'units': 'meters',
        'forward': '-Z',
        'up': '+Y',
        'rootNode': 'SkywakeNavigator',
        'triangles': triangles,
        'meshPrimitives': primitives,
        'skinnedPrimitives': skinned_primitives,
        'materialNames': material_names,
        'tintableMaterial': 'crew_accent',
        'tintableBaseColorFactor': crew.get('pbrMetallicRoughness', {}).get('baseColorFactor'),
        'textures': images,
        'decodedTextureBytes': total_decoded,
        'textureAccounting': ('sum of width*height*4 over the base level and every integer-halved mip '
                              'level down to 1x1, per unique embedded image; matches '
                              'client/environment-assets.js textureMemoryBytes'),
        'texelCoverage': texture_stats,
        'bounds': {'min': [round(float(v), 4) for v in bounds_min],
                   'max': [round(float(v), 4) for v in bounds_max]},
        'skins': len(skins),
        'jointCount': len(joint_names),
        'joints': joint_names,
        'animations': animations,
        'sockets': socket_report,
        'budgets': BUDGETS,
        'source': {
            'anatomy': 'tools/player-character/base.obj',
            'anatomySha256': None,
            'license': 'CC0 1.0 (MakeHuman base mesh hm08, released CC0 September 2020)',
            'statement': ('Original pirate design, clothing, textures and rig built in Blender on '
                          'MakeHuman CC0 anatomy topology.'),
        },
        'limitations': [
            'Renderer-only prototype: the live player is still client/models.js buildPirate.',
            'Sockets are future integration anchors; no current weapon or glider compatibility is claimed.',
            'walk is a rig proof, not production locomotion; idle is a subtle breathing loop.',
            'No finger or toe bones: hands and feet are rigid to hand.L/R and foot.L/R.',
            'Face detail is procedural texture plus a light sculpt over CC0 topology, not a hand sculpt.',
        ],
    }


# --------------------------------------------------------------------------- previews


def _look_at(obj, location, target):
    loc = Vector(location)
    direction = (loc - Vector(target)).normalized()
    right = Vector((0.0, 0.0, 1.0)).cross(direction).normalized()
    up = direction.cross(right)
    matrix = Matrix((right, up, direction)).transposed().to_4x4()
    matrix.translation = loc
    obj.matrix_world = matrix


def _area_light(name, location, target, energy, colour, size):
    data = bpy.data.lights.new(name, type='AREA')
    data.energy = energy
    data.color = colour
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    _look_at(obj, location, target)
    return obj


def render_previews(arm, out_dir, bounds, lm):
    """Neutral studio: readable face and materials, front facing camera, no moody darkness."""
    out_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0.0

    world = bpy.data.worlds.new('studio')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.26, 0.28, 0.31, 1.0)
    bg.inputs[1].default_value = 0.55
    scene.world = world

    ground = bpy.data.meshes.new('ground')
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, radius=7.0, segments=48)
    bm.to_mesh(ground)
    bm.free()
    ground_obj = bpy.data.objects.new('preview_ground', ground)
    bpy.context.scene.collection.objects.link(ground_obj)
    mat = bpy.data.materials.new('preview_ground')
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*pc.srgb_to_linear([0.60, 0.57, 0.51]), 1.0)
    mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95
    ground.materials.append(mat)

    head_z = float(bounds['max'][1])
    centre = Vector((0.0, 0.0, head_z * 0.52))
    # Aim the portrait at the actual eye landmark, not at a guess off the hat crown.
    eye = game_to_blender(lm['eye_l'] * 0.5 + lm['eye_r'] * 0.5)
    face = Vector((0.0, eye[1] - 0.02, eye[2] - 0.045))
    _area_light('key', (-2.6, 4.4, 3.4), centre, 300.0, (1.0, 0.95, 0.87), 3.0)
    _area_light('fill', (3.2, 3.0, 1.7), centre, 115.0, (0.82, 0.89, 1.0), 3.5)
    _area_light('rim', (1.4, -4.2, 3.0), centre, 150.0, (1.0, 0.97, 0.93), 2.5)

    arm.animation_data.action = None
    apply_pose(arm, {'rot': {
        'spine': (0.0, 0.0, 2.0), 'chest': (1.0, 0.0, 2.5), 'head': (-2.0, 4.0, 1.0),
        'upper_arm.L': (-2.0, 0.0, -5.0), 'forearm.L': (-16.0, -4.0, 0.0),
        'upper_arm.R': (-4.0, 0.0, 7.0), 'forearm.R': (-24.0, 6.0, 0.0),
        'thigh.L': (3.0, 0.0, 2.0), 'shin.L': (-6.0, 0.0, 0.0), 'foot.L': (3.0, 0.0, 0.0),
        'thigh.R': (-4.0, 0.0, -3.0), 'shin.R': (-4.0, 0.0, 0.0), 'foot.R': (4.0, 0.0, 0.0),
        'coat_tail.L': (-3.0, 0.0, 2.0), 'coat_tail.R': (2.0, 0.0, -2.0),
    }})
    bpy.context.view_layer.update()

    cam_data = bpy.data.cameras.new('preview_cam')
    cam_data.sensor_fit = 'VERTICAL'
    cam_data.sensor_height = 24.0
    cam = bpy.data.objects.new('preview_cam', cam_data)
    bpy.context.scene.collection.objects.link(cam)
    scene.camera = cam

    shots = [
        ('front', (0.0, 6.4, head_z * 0.54), centre, 50.0, (900, 1300)),
        ('three-quarter', (-4.3, 4.7, head_z * 0.62), centre, 50.0, (900, 1300)),
        ('back', (0.0, -6.4, head_z * 0.54), centre, 50.0, (900, 1300)),
        ('face-closeup', (face.x - 0.26, face.y + 1.34, face.z + 0.10), face, 85.0, (1000, 1000)),
    ]
    bent = ('rig-check', (-3.9, 4.6, head_z * 0.52), Vector((0.0, 0.0, head_z * 0.40)), 50.0, (900, 1150))
    written = []
    for name, location, target, lens, (width, height) in shots:
        cam_data.lens = lens
        scene.render.resolution_x = width
        scene.render.resolution_y = height
        scene.render.image_settings.file_format = 'PNG'
        _look_at(cam, location, target)
        path = out_dir / f'navigator-{name}.png'
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        written.append(path)

    # One deliberately extreme pose: deep knee bend, folded elbows, twisted spine.
    apply_pose(arm, RIG_CHECK_KEYS[1][1])
    bpy.context.view_layer.update()
    name, location, target, lens, (width, height) = bent
    cam_data.lens = lens
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    _look_at(cam, location, target)
    path = out_dir / f'navigator-{name}.png'
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    written.append(path)
    return written


# --------------------------------------------------------------------------- driver


def main():
    parser = argparse.ArgumentParser(description='Build the Skywake navigator player character.')
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'client/assets/player-character')
    parser.add_argument('--blend', type=pathlib.Path)
    parser.add_argument('--preview-dir', type=pathlib.Path)
    parser.add_argument('--base-obj', type=pathlib.Path, default=ROOT / 'tools/player-character/base.obj')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])

    base_obj = args.base_obj
    if not base_obj.exists():
        raise AssertionError(f'missing CC0 anatomy input at {base_obj}')
    digest = pc.sha256_file(base_obj)
    provenance_path = base_obj.parent / 'provenance.json'
    pinned = json.loads(provenance_path.read_text(encoding='utf-8'))['sha256']
    if digest != pinned:
        raise AssertionError(f'base.obj hash {digest} does not match pinned {pinned}')

    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.materials, bpy.data.images, bpy.data.actions):
        for item in list(block):
            block.remove(item)
    scene = bpy.context.scene
    scene.render.fps = 24
    scene.render.fps_base = 1.0
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0

    anat = load_anatomy(base_obj)
    sampler = BodySampler(anat['verts'], anat['faces'], anat['lm'])
    parts, head_centre = build_parts(anat, sampler)
    ctx = {'lm': anat['lm'], 'face': anat['face'], 'head_centre': head_centre}

    global FINAL_SCALE
    authored_top = max(max(v[1] for v in part.verts) for part in parts)
    FINAL_SCALE = TARGET_HEIGHT / authored_top
    tri_total = sum(part.triangles() for part in parts)
    print(f'NAVIGATOR: {len(parts)} parts, {tri_total:,} source triangles before export, '
          f'authored height {authored_top:.3f} m, stature scale {FINAL_SCALE:.4f}')
    for part in parts:
        pts = np.array(part.verts, dtype=float)
        print('NAVIGATOR_PART: {:<12} {:<12} {:>6} tris  y {:+.3f}..{:+.3f}  x {:+.3f}..{:+.3f}'.format(
            part.name, part.material, part.triangles(), pts[:, 1].min(), pts[:, 1].max(),
            pts[:, 0].min(), pts[:, 0].max()))

    tmp = pathlib.Path(tempfile.mkdtemp(prefix='navigator-tex-'))
    albedo_path, normal_path, texel_stats, coverage = bake_textures(parts, ctx, tmp)
    print(f'NAVIGATOR: atlas coverage {coverage * 100:.1f}% of {ATLAS_SIZE}^2, '
          f'albedo {albedo_path.stat().st_size:,} B, normal {normal_path.stat().st_size:,} B')

    objects, skin_data = create_objects(parts)
    albedo_image, normal_image = create_materials(objects, albedo_path, normal_path)
    layout = bone_layout(anat['lm'])
    arm = create_armature(layout)
    bind(objects, skin_data, arm, layout)
    sockets = create_sockets(arm, anat['lm'])
    create_clips(arm)
    bpy.context.view_layer.update()

    args.output.mkdir(parents=True, exist_ok=True)
    glb_path = args.output / 'hero.glb'
    export_glb(glb_path)
    manifest = inspect_and_validate(glb_path, sockets, texel_stats)
    manifest['source']['anatomySha256'] = digest
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')

    if args.blend:
        args.blend.parent.mkdir(parents=True, exist_ok=True)
        albedo_image.pack()
        normal_image.pack()
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend.resolve()), compress=True, copy=True)

    print('NAVIGATOR_OK: {tri:,} triangles, {prim} primitives, {mat} materials, {bytes:,} B, '
          '{tex:,} decoded texture bytes, {joints} joints, clips {clips}'.format(
              tri=manifest['triangles'], prim=manifest['meshPrimitives'],
              mat=len(manifest['materialNames']), bytes=manifest['bytes'],
              tex=manifest['decodedTextureBytes'], joints=manifest['jointCount'],
              clips=', '.join(f"{a['name']}({a['duration']}s/{a['channels']}ch)" for a in manifest['animations'])))
    print('NAVIGATOR_BOUNDS: min {} max {}'.format(manifest['bounds']['min'], manifest['bounds']['max']))

    if args.preview_dir:
        written = render_previews(arm, args.preview_dir.resolve(), manifest['bounds'], anat['lm'])
        for path in written:
            print(f'NAVIGATOR_PREVIEW: {path}')
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()




