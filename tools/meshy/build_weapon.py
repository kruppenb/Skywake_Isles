"""Fit a Meshy weapon GLB into Skywake gun space and split off its moving action.

Usage:
  blender --background --factory-startup --python-exit-code 1 --python build_weapon.py -- \
      --in <meshy.glb> --kind flintlock --out client/assets/weapons/flintlock.glb \
      [--length 1.30] [--bore-y .13] [--muzzle-z -1.0] \
      [--forward auto|+X|-X|+Y|-Y|+Z|-Z] [--up auto|...] [--lock-side auto|+X|-X] \
      [--muzzle-end thinner|wider] [--level-band .02 .35] \
      [--action-box x0 y0 z0 x1 y1 z1] [--hinge x y z] [--hinge-axis -1 0 0] \
      [--bore-from muzzle-face|band] [--texture-size 1024] [--texture-format auto|png|jpeg] \
      [--report <json>] [--allow-misfit]

Gun space (the runtime contract, glTF axes): -Z is the muzzle direction, +Y is up, +X is the gun's
right side -- the lock plate / hammer side. The shipped GLB is a root node named <kind> (identity
TRS) with children `body` (mesh, identity TRS), optional `action` (mesh whose node position is the
hinge pivot and whose extras carry `hingeAxis`) and the empty `muzzle`.

`--kind` also selects the landmark table the export is verified against (CONTRACTS below, one
entry per shipped gun; an unknown kind is an error, never a silent flintlock).

`--muzzle-end wider` flips the auto muzzle-end vote for a gun whose muzzle is the *fatter* end (a
blunderbuss flare); `--level-band lo hi` moves the bore-levelling window off the flare onto the
straight barrel behind it. Both default to the flintlock's behaviour.

Axis bookkeeping: Blender's glTF importer maps glTF +Y-up/-Z-forward onto Blender Z-up/-Y-forward
(blender = (gx, -gz, gy)) and the exporter maps back with export_yup=True. Every decision below is
reasoned in glTF axes; `gun_to_blender` / `blender_to_gun` are the only places the two frames meet.
`--forward`, `--up` and `--action-box` / `--hinge` are all glTF axes: the flags name axes of the
*input* model, the box and hinge are in *output* gun space (run once without them and read the
report's `hammerHint`).

What it does:
  * imports the Meshy GLB, drops everything that is not a mesh, applies transforms and joins
  * clears Meshy's custom split normals (shade-auto-smooth instead) so a mirror stays sane
  * rebuilds the material: one Principled BSDF with the albedo in Base Color, metallic 0,
    roughness .7, no emission (Meshy wires the albedo into emission, which renders unlit)
  * orients: PCA longest axis = barrel; the thinner end is the muzzle (--muzzle-end wider for a
    flared one); the half with the most vertices far from the bore is the grip; the lock plate
    goes to +X (mirroring if it is on -X)
  * scales so the length along gun Z is --length, then translates the barrel-span bore centroid to
    x 0 / y --bore-y and the front-most z to --muzzle-z
  * splits the faces whose centroid is inside --action-box into `action`, fills the holes left in
    both halves with the flat `fill` material (#1c2a33), moves the action origin to --hinge
  * adds the `muzzle` empty at the measured bore end, parents everything to the root
  * downscales the albedo to --texture-size and packs it, then exports the GLB
  * re-reads the exported bytes, measures the landmarks from them against CONTRACTS[--kind],
    prints the table and writes --report; exits 1 on a landmark miss unless --allow-misfit
"""
import bpy, bmesh, json, math, os, struct, sys, tempfile
import numpy as np
from mathutils import Matrix, Vector

# ----------------------------------------------------------------------------- arguments
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
FLAGS = {'allow-misfit'}
ARITY = {'action-box': 6, 'hinge': 3, 'hinge-axis': 3, 'level-band': 2}
opts = {}
i = 0
while i < len(argv):
    key = argv[i].lstrip('-')
    if key in FLAGS:
        opts[key] = True; i += 1
    else:
        n = ARITY.get(key, 1)
        opts[key] = argv[i + 1] if n == 1 else [float(v) for v in argv[i + 1:i + 1 + n]]
        i += 1 + n

SRC = opts['in']
KIND = opts.get('kind', 'flintlock')
OUT = os.path.abspath(opts['out'])
LENGTH = float(opts.get('length', 1.30))
BORE_Y = float(opts.get('bore-y', .13))
MUZZLE_Z = float(opts.get('muzzle-z', -1.0))
FORWARD = opts.get('forward', 'auto')
UP = opts.get('up', 'auto')
LOCK = opts.get('lock-side', 'auto')
MUZZLE_END = opts.get('muzzle-end', 'thinner')
LEVEL_BAND = tuple(float(v) for v in opts.get('level-band', [.02, .35]))
ACTION_BOX = opts.get('action-box')
HINGE = opts.get('hinge')
HINGE_AXIS = opts.get('hinge-axis', [-1.0, 0.0, 0.0])
BORE_FROM = opts.get('bore-from', 'muzzle-face')
TEXTURE_SIZE = int(opts.get('texture-size', 1024))
TEXTURE_FORMAT = opts.get('texture-format', 'auto')
REPORT = opts.get('report')
ALLOW_MISFIT = bool(opts.get('allow-misfit'))

# Fractions of the length used by the auto passes. Kept here so the report can state them.
END_FRACTION = .25          # outer slice at each end compared for the muzzle test
BARREL_BAND = (.05, .35)    # slice behind the muzzle used as the barrel sample
MUZZLE_FACE = .04           # slice at the very muzzle whose cross-section centre is the bore
BORE_SAMPLE = .30           # front slice whose centroid defines the bore axis point
GRIP_RADIUS = .30           # "far from the bore" threshold for the grip-half vote
LOCK_Z = (-.35, .10)        # breech window for the lock-plate vote (gun space, after the fit)
FILL_COLOR = (0x1c, 0x2a, 0x33)

AXES = {'+X': (1., 0., 0.), '-X': (-1., 0., 0.), '+Y': (0., 1., 0.),
        '-Y': (0., -1., 0.), '+Z': (0., 0., 1.), '-Z': (0., 0., -1.)}

if MUZZLE_END not in ('thinner', 'wider'):
    raise SystemExit(f'--muzzle-end must be thinner or wider, not {MUZZLE_END!r}')
if not (0.0 <= LEVEL_BAND[0] < LEVEL_BAND[1] <= 1.0):
    raise SystemExit(f'--level-band wants two increasing fractions of the length in [0, 1], '
                     f'got {LEVEL_BAND[0]} {LEVEL_BAND[1]}')

# ----------------------------------------------------------------------------- contracts
# The gun-space landmark table the exported bytes are verified against, one entry per shipped gun.
# These are the same numbers test/weapon-assets.test.js checks independently against the shipped
# GLB, and docs/WEAPON_MODELS.md quotes for the flintlock; a new gun gets its own entry here rather
# than widening someone else's. Every range is [lo, hi]; a bare number is an upper bound.
#   grip.zFrom (optional) -- only body vertices at or behind this z count as grip, so a fore-end
#   hanging under the barrel cannot drag the grip centroid forward. The flintlock has none.
CONTRACTS = {
    'flintlock': {
        'bounds': {'zMin': (-1.12, -.92), 'zMax': .50, 'yMin': (-.60, -.22), 'yMax': .50, 'absX': .22},
        'muzzle': {'zBelowMin': -.02, 'zAboveMin': .06, 'y': (.08, .18), 'absX': .03},
        'grip': {'band': (-.24, -.14), 'absCentroidX': .05, 'centroidZ': (-.02, .30),
                 'extentX': .30, 'extentZ': .36},
        'barrel': {'band': (-.90, -.60), 'centroidY': (.05, .20), 'absCentroidX': .03,
                   'extentX': .22, 'extentY': .34},
        'action': {'reach': .30, 'y': (.10, .55)},
    },
    # The blunderbuss: the flare is the wide part, so the envelope, the barrel band (behind the
    # flare) and the action floor all move; the fore-end under the barrel is why grip.zFrom exists.
    # Its grip band also catches the trigger-guard bow at z -.05..+.02, a good .24 ahead of the raked
    # grip (measured z .19 .. .43 on the Meshy mesh), so the depth guard is .48 instead of the pistol's
    # .36; a band that had swallowed the barrel would still read near 1.0.
    'scatter': {
        'bounds': {'zMin': (-1.08, -.88), 'zMax': .60, 'yMin': (-.60, -.20), 'yMax': .55, 'absX': .30},
        'muzzle': {'zBelowMin': -.02, 'zAboveMin': .06, 'y': (.07, .17), 'absX': .03},
        'grip': {'band': (-.24, -.14), 'zFrom': -.10, 'absCentroidX': .05, 'centroidZ': (-.02, .30),
                 'extentX': .30, 'extentZ': .48},
        'barrel': {'band': (-.60, -.35), 'centroidY': (-.05, .20), 'absCentroidX': .03,
                   'extentX': .30, 'extentY': .45},
        'action': {'reach': .30, 'y': (.05, .55)},
    },
    # The repeater: a compact carbine, so 'grip' is a stock-wrist band (y -.20..-.08) rather than a
    # pistol grip band, with zFrom -.02 so neither the box magazine (z -.26..-.03) nor the
    # trigger-guard bow counts as grip and the centroid has to land on the pistol grip / stock wrist
    # at z .05 .. .40. The barrel band z -.90..-.66 sits ahead of the fore-end and behind the brass
    # muzzle ring. Its action is the magazine hanging *under* the receiver, which the frame code
    # TRANSLATES rather than rotates (--hinge-axis 0 0 1, an identity hinge frame), so the action y
    # band is negative; reach .40 covers the magazine's far bottom corner from a pivot at its top
    # centre. Measured off the approved side plate at length 1.45 with the bore at y .17: the
    # magazine, not the grip, is the gun's lowest point and its brass base plate bottoms out near
    # y -.26 (so yMin's upper bound is -.18, not the grip's -.20), and its top meets the receiver
    # underside near y +.06, which is where the split seam runs (so the action band reaches y .10).
    'repeater': {
        'bounds': {'zMin': (-1.10, -.90), 'zMax': .60, 'yMin': (-.65, -.18), 'yMax': .55, 'absX': .25},
        'muzzle': {'zBelowMin': -.02, 'zAboveMin': .06, 'y': (.12, .22), 'absX': .03},
        'grip': {'band': (-.20, -.08), 'zFrom': -.02, 'absCentroidX': .06, 'centroidZ': (.05, .40),
                 'extentX': .30, 'extentZ': .50},
        'barrel': {'band': (-.90, -.66), 'centroidY': (.02, .25), 'absCentroidX': .03,
                   'extentX': .25, 'extentY': .40},
        'action': {'reach': .40, 'y': (-.60, .10)},
    },
}
if KIND not in CONTRACTS:
    raise SystemExit(f'no landmark contract for --kind {KIND!r}; known kinds are '
                     f'{", ".join(sorted(CONTRACTS))}. Add {KIND}\'s table to CONTRACTS in '
                     f'tools/meshy/build_weapon.py (and to CONTRACTS in test/weapon-assets.test.js) '
                     f'before fitting it.')
CONTRACT = CONTRACTS[KIND]


def log(*args):
    print(*args, flush=True)


def gun_to_blender(v):
    return np.array([v[0], -v[2], v[1]], dtype=np.float64)


def blender_to_gun(v):
    return np.array([v[0], v[2], -v[1]], dtype=np.float64)


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    n = np.linalg.norm(v)
    return v / n if n else v


def axis_name(v):
    """Nearest signed cardinal axis, for printing an auto-detected direction in glTF terms."""
    v = blender_to_gun(v)
    k = int(np.argmax(np.abs(v)))
    return f'{"+" if v[k] >= 0 else "-"}{"XYZ"[k]}'


def srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


# ----------------------------------------------------------------------------- import
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=SRC)
imported = [o for o in bpy.data.objects if o not in before]
meshes = [o for o in imported if o.type == 'MESH']
if not meshes:
    raise SystemExit(f'no mesh objects in {SRC}')
log('imported:', [f'{o.name}({o.type})' for o in imported])

bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if any(o.parent for o in meshes):
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
for o in imported:
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = 'body'
body.data.name = 'body'
log(f'joined {len(meshes)} mesh object(s) -> body: {len(body.data.vertices)} verts, '
    f'{len(body.data.polygons)} faces, materials {[m.name if m else None for m in body.data.materials]}')

# glTF stores one vertex per (position, uv, normal) triple, so a re-imported GLB is split along
# every UV seam: each seam edge has one face on each side but two separate edges, which makes the
# mesh look full of holes and would have `fill` painted over half the gun. Weld by distance first
# (loop UVs are per corner, so the seams survive the merge) and report what boundary is left.
extent = float(max(body.dimensions)) or 1.0
weld = bmesh.new()
weld.from_mesh(body.data)
before_verts = len(weld.verts)
bmesh.ops.remove_doubles(weld, verts=weld.verts[:], dist=extent * 1e-5)
open_edges = sum(1 for e in weld.edges if len(e.link_faces) == 1)
weld.to_mesh(body.data)
weld.free()
body.data.update()
log(f'welded {before_verts} -> {len(body.data.vertices)} verts; {open_edges} boundary edge(s) left')
if open_edges:
    log('  note: the input is not a closed shell, so the fill pass will also cap those '
        'pre-existing openings with the fill material')

# Meshy ships custom split normals; they survive a rotation but not the lock-side mirror, and the
# gun reads better with real hard edges anyway. Drop them and shade by angle instead.
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
try:
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
except Exception as exc:
    log('custom split normals: nothing to clear', f'({exc})')
try:
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
except Exception as exc:
    bpy.ops.object.shade_smooth()
    log('shade_auto_smooth unavailable, used shade_smooth', f'({exc})')

# ----------------------------------------------------------------------------- material
def texture_image(mat):
    """The image feeding Base Color (or Emission -- Meshy wires the albedo there)."""
    if not mat or not mat.node_tree:
        return None
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    for socket in ('Base Color', 'Emission Color'):
        node = None
        if bsdf:
            link = next((l for l in nt.links if l.to_node == bsdf and l.to_socket.name == socket), None)
            node = link.from_node if link else None
        hops = 0
        while node is not None and node.type != 'TEX_IMAGE' and hops < 8:
            up = next((l for l in nt.links if l.to_node == node), None)
            node = up.from_node if up else None
            hops += 1
        if node is not None and node.type == 'TEX_IMAGE' and node.image:
            return node.image
    return next((n.image for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image), None)


candidates = []
for mat in body.data.materials:
    image = texture_image(mat)
    if image and image.size[0] and image not in candidates:
        candidates.append(image)
if len(candidates) > 1:
    log('WARNING: several base-colour images found', [im.name for im in candidates],
        '- keeping the largest (the contract allows exactly one)')
albedo = max(candidates, key=lambda im: im.size[0] * im.size[1]) if candidates else None
if albedo is None:
    log('WARNING: no base-colour texture found in the input; the body material will be flat')

texture_info = None
if albedo is not None:
    src_w, src_h = albedo.size[0], albedo.size[1]
    side = min(TEXTURE_SIZE, max(src_w, src_h))          # downscale only, never upscale
    scale = side / max(src_w, src_h)
    new_w, new_h = max(1, int(round(src_w * scale))), max(1, int(round(src_h * scale)))
    if (new_w, new_h) != (src_w, src_h):
        albedo.scale(new_w, new_h)
    tmp_dir = tempfile.mkdtemp(prefix='skywake-weapon-')
    png_path = os.path.join(tmp_dir, f'{KIND}-albedo.png')
    albedo.file_format = 'PNG'
    albedo.filepath_raw = png_path
    albedo.save()
    chosen, chosen_path = 'PNG', png_path
    has_alpha = albedo.depth in (32, 64)
    if TEXTURE_FORMAT == 'jpeg' or (TEXTURE_FORMAT == 'auto' and not has_alpha
                                    and os.path.getsize(png_path) > 1_500_000):
        jpeg_path = os.path.join(tmp_dir, f'{KIND}-albedo.jpg')
        albedo.file_format = 'JPEG'
        albedo.filepath_raw = jpeg_path
        try:
            albedo.save(quality=92)
        except TypeError:
            albedo.save()
        if os.path.getsize(jpeg_path) < os.path.getsize(png_path):
            chosen, chosen_path = 'JPEG', jpeg_path
    packed = bpy.data.images.load(chosen_path)
    packed.name = f'{KIND}-albedo'
    packed.colorspace_settings.name = 'sRGB'
    packed.alpha_mode = 'NONE'
    packed.pack()
    albedo = packed
    texture_info = {'name': packed.name, 'format': chosen, 'sourceSize': [src_w, src_h],
                    'size': [new_w, new_h], 'fileBytes': os.path.getsize(chosen_path)}
    log(f'albedo {src_w}x{src_h} -> {new_w}x{new_h} {chosen}, {os.path.getsize(chosen_path)} bytes packed')

main_mat = bpy.data.materials.new(KIND)
main_mat.use_nodes = True
nt = main_mat.node_tree
bsdf = nt.nodes['Principled BSDF']
bsdf.inputs['Metallic'].default_value = 0.0
bsdf.inputs['Roughness'].default_value = 0.7
bsdf.inputs['Emission Strength'].default_value = 0.0
bsdf.inputs['Emission Color'].default_value = (0, 0, 0, 1)
if albedo is not None:
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = albedo
    tex.location = (-400, 0)
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])

main_mat.use_backface_culling = True          # closed shell; single-sided keeps the GLB honest

fill_mat = bpy.data.materials.new('fill')
fill_mat.use_nodes = True
fill_bsdf = fill_mat.node_tree.nodes['Principled BSDF']
fill_bsdf.inputs['Base Color'].default_value = (*[srgb_to_linear(c) for c in FILL_COLOR], 1.0)
fill_bsdf.inputs['Metallic'].default_value = 0.0
fill_bsdf.inputs['Roughness'].default_value = 0.7
fill_bsdf.inputs['Emission Strength'].default_value = 0.0
fill_mat.use_backface_culling = True

body.data.materials.clear()
body.data.materials.append(main_mat)
body.data.materials.append(fill_mat)
for poly in body.data.polygons:
    poly.material_index = 0

# ----------------------------------------------------------------------------- orientation
V = np.empty(len(body.data.vertices) * 3, dtype=np.float64)
body.data.vertices.foreach_get('co', V)
V = V.reshape(-1, 3)
centre = V.mean(axis=0)
cov = np.cov((V - centre).T)
eigvals, eigvecs = np.linalg.eigh(cov)
order = np.argsort(eigvals)[::-1]
eigvals, eigvecs = eigvals[order], eigvecs[:, order]
pca_axis = unit(eigvecs[:, 0])

decisions = {}
if FORWARD != 'auto':
    forward = unit(gun_to_blender(AXES[FORWARD]))
    decisions['forward'] = {'source': 'flag', 'value': FORWARD}
    log(f'forward: {FORWARD} (flag)')
else:
    t = (V - centre) @ pca_axis
    span = float(t.max() - t.min())
    cut = span * END_FRACTION
    perp = np.stack([(V - centre) @ unit(eigvecs[:, 1]), (V - centre) @ unit(eigvecs[:, 2])], axis=1)

    def cross_area(mask):
        if mask.sum() < 4:
            return float('inf')
        e = perp[mask].max(axis=0) - perp[mask].min(axis=0)
        return float(e[0] * e[1])
    area_hi, area_lo = cross_area(t >= t.max() - cut), cross_area(t <= t.min() + cut)
    # Default: the thinner end is the muzzle. A trumpet-flared blunderbuss is the exception --
    # its muzzle is the fattest cross-section on the gun -- so --muzzle-end wider flips the vote.
    thinner_is_muzzle = MUZZLE_END == 'thinner'
    forward = pca_axis if (area_hi < area_lo) == thinner_is_muzzle else -pca_axis
    coarse = axis_name(forward)
    # The whole-model PCA axis is pulled off the bore by the grip's mass, which is enough to put
    # the butt within 30 % of the length of the "bore axis". Re-run the PCA on the front 40 % --
    # barrel, ramrod and fore-end, all parallel to the bore -- until the axis settles.
    for _ in range(4):
        t = V @ forward
        front = V[t >= t.max() - (t.max() - t.min()) * .40]
        if len(front) < 8:
            break
        w, vecs = np.linalg.eigh(np.cov((front - front.mean(axis=0)).T))
        axis = unit(vecs[:, int(np.argmax(w))])
        if axis @ forward < 0:
            axis = -axis
        if float(np.linalg.norm(axis - forward)) < 1e-9:
            forward = axis
            break
        forward = axis
    tilt = math.degrees(math.acos(min(1.0, abs(float(forward @ pca_axis)))))
    decisions['forward'] = {'source': 'auto', 'value': axis_name(forward),
                            'coarsePcaAxis': coarse, 'refinedFromCoarseDegrees': tilt,
                            'pcaEigenvalues': [float(v) for v in eigvals],
                            'lengthAlongAxis': span,
                            'muzzleEnd': MUZZLE_END,
                            'muzzleEndSource': 'flag' if 'muzzle-end' in opts else 'default',
                            'endCrossSection': {'positive': area_hi, 'negative': area_lo}}
    log(f'forward: {axis_name(forward)} (auto; PCA eigenvalues '
        f'{[round(float(v), 5) for v in eigvals]}, length {span:.4f}; outer {END_FRACTION:.0%} '
        f'cross-section +{area_hi:.4f} vs -{area_lo:.4f}, the {MUZZLE_END} end is the muzzle '
        f'(--muzzle-end {MUZZLE_END}); barrel-slice refinement moved the axis {tilt:.2f} deg off '
        f'the whole-model PCA axis)')

t = V @ forward
span = float(t.max() - t.min())
# A point on the bore: the centre of the barrel's cross-section at the muzzle face. The centroid of
# the whole front slice sits well below the bore on a real gun (fore-end, ramrod, trigger guard),
# which drags the "bore axis" down far enough to hide the butt from the grip test below.
perp = np.stack([unit(np.cross(forward, eigvecs[:, 1])), np.cross(forward, np.cross(forward, eigvecs[:, 1]))])
perp[1] = unit(perp[1])
face_slab = V[t >= t.max() - span * MUZZLE_FACE]
if len(face_slab) >= 6:
    uv = face_slab @ perp.T
    centre_uv = (uv.min(axis=0) + uv.max(axis=0)) / 2
    bore_point = perp.T @ centre_uv + forward * float(t.max())
else:
    bore_point = V[t >= t.max() - span * BORE_SAMPLE].mean(axis=0)
rel = V - bore_point
radial = rel - np.outer(rel @ forward, forward)
radius = np.linalg.norm(radial, axis=1)

if UP != 'auto':
    up = unit(gun_to_blender(AXES[UP]))
    decisions['up'] = {'source': 'flag', 'value': UP}
    log(f'up: {UP} (flag)')
else:
    threshold = GRIP_RADIUS
    far = radius > span * threshold
    while far.sum() < 8 and threshold > .10:
        threshold -= .05
        far = radius > span * threshold
        log(f'  grip auto-detect: nothing beyond {threshold + .05:.0%} of the length from the '
            f'bore, retrying at {threshold:.0%}')
    if far.sum() < 3:
        raise SystemExit(f'grip auto-detect found only {int(far.sum())} vertices further than '
                         f'{threshold:.0%} of the length from the bore; pass --up explicitly')
    down = unit(radial[far].mean(axis=0))
    up = -down
    decisions['up'] = {'source': 'auto', 'value': axis_name(up), 'gripVertices': int(far.sum()),
                       'gripDirection': axis_name(down), 'gripRadiusFraction': threshold}
    log(f'up: {axis_name(up)} (auto; {int(far.sum())} vertices beyond {threshold:.0%} of the '
        f'length from the bore axis lie toward {axis_name(down)}, so that half is the grip)')

up = unit(up - forward * float(up @ forward))
gun_z = -forward
gun_y = up
gun_x = unit(np.cross(gun_y, gun_z))
A = np.stack([gun_x, gun_y, gun_z])                     # rows: gun basis in Blender coords

# Level the bore. A PCA axis -- whole model or front slice -- is pulled off the barrel by anything
# parallel but offset (the ramrod, the fore-end), which leaves the gun a few degrees nose-up and
# the muzzle socket off the bore. Take the centre of the barrel's cross-section at the muzzle face
# and again at the back of the barrel band (bounding-box centres, so a ramrod tucked inside the
# barrel's own radius cannot move them) and rotate the frame until that line is exactly gun -Z.
def rotation_between(a, b):
    axis = np.cross(a, b)
    s, c = float(np.linalg.norm(axis)), float(a @ b)
    if s < 1e-12:
        return np.eye(3)
    k = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + k + k @ k * ((1 - c) / (s * s))


def theil_sen(xs, ys):
    """Median pairwise slope -- one odd slab (a front sight, a barrel band) cannot swing it."""
    slopes = [(ys[j] - ys[i]) / (xs[j] - xs[i])
              for i in range(len(xs)) for j in range(i + 1, len(xs)) if abs(xs[j] - xs[i]) > 1e-6]
    return float(np.median(slopes)) if slopes else 0.0


level_deg = 0.0
if FORWARD == 'auto':
    for _ in range(4):
        Gl = V @ A.T
        z_lo, reach = float(Gl[:, 2].min()), float(Gl[:, 2].max() - Gl[:, 2].min())
        s0 = Gl[:, 2] <= z_lo + reach * MUZZLE_FACE
        if s0.sum() < 6:
            break
        c0 = np.array([(float(Gl[s0, 0].min()) + float(Gl[s0, 0].max())) / 2,
                       (float(Gl[s0, 1].min()) + float(Gl[s0, 1].max())) / 2])
        r0 = float(np.max(np.linalg.norm(Gl[s0, :2] - c0, axis=1)))
        near = np.linalg.norm(Gl[:, :2] - c0, axis=1) <= r0 * 1.6
        # The barrel's top and its two sides run parallel to the bore and, unlike its underside,
        # are not shared with a ramrod, a ramrod pipe or a stock fore-end. Track them across
        # --level-band (fractions of the length, the front third by default) and take the median
        # slope. A gun whose front third is a trumpet flare needs a band behind the flare instead:
        # the flare's silhouette is not parallel to the bore and would tip the whole frame.
        edges = np.linspace(z_lo + reach * LEVEL_BAND[0], z_lo + reach * LEVEL_BAND[1], 9)
        zs, tops, mids = [], [], []
        for a_, b_ in zip(edges[:-1], edges[1:]):
            m = near & (Gl[:, 2] >= a_) & (Gl[:, 2] < b_)
            if m.sum() < 6:
                continue
            zs.append(float(Gl[m, 2].mean()))
            tops.append(float(Gl[m, 1].max()))
            mids.append((float(Gl[m, 0].min()) + float(Gl[m, 0].max())) / 2)
        if len(zs) < 4:
            break
        bore_dir = unit(np.array([-theil_sen(zs, mids), -theil_sen(zs, tops), -1.0]))
        step = math.degrees(math.acos(min(1.0, abs(float(bore_dir @ np.array([0., 0., -1.]))))))
        A = rotation_between(bore_dir, np.array([0., 0., -1.])) @ A
        level_deg += step
        if step < 1e-3:
            break
    decisions['boreLevelling'] = {'totalDegrees': level_deg, 'band': [float(v) for v in LEVEL_BAND],
                                  'bandSource': 'flag' if 'level-band' in opts else 'default'}
    log(f'bore levelling: rotated the frame {level_deg:.2f} deg so the barrel\'s top and side '
        f'silhouettes run parallel to gun Z (--level-band {LEVEL_BAND[0]:g} {LEVEL_BAND[1]:g}, '
        f'the {LEVEL_BAND[0]:.0%}..{LEVEL_BAND[1]:.0%} slice of the length behind the muzzle)')

# ----------------------------------------------------------------------------- fit
G = V @ A.T
fit_scale = LENGTH / float(G[:, 2].max() - G[:, 2].min())
G = G * fit_scale
z_min = float(G[:, 2].min())
band = (G[:, 2] >= z_min + LENGTH * BARREL_BAND[0]) & (G[:, 2] <= z_min + LENGTH * BARREL_BAND[1])
if band.sum() < 4:
    raise SystemExit('the barrel band is empty; check --length / the orientation')
face = G[:, 2] <= z_min + LENGTH * MUZZLE_FACE
if face.sum() < 4:
    raise SystemExit('the muzzle-face slice is empty; check --length / the orientation')
# The bore centre is the centre of the barrel's cross-section at the muzzle face, not the plain
# centroid of the barrel band: a ramrod slung under the barrel drags that centroid several
# centimetres below the bore and would hang the muzzle socket off the barrel. --bore-from band
# restores the plain centroid for a gun with nothing under the barrel.
band_centre = np.array([float(G[band, 0].mean()), float(G[band, 1].mean())])
face_centre = np.array([(float(G[face, 0].min()) + float(G[face, 0].max())) / 2,
                        (float(G[face, 1].min()) + float(G[face, 1].max())) / 2])
bore_centre = band_centre if BORE_FROM == 'band' else face_centre
offset = np.array([-bore_centre[0], BORE_Y - bore_centre[1], MUZZLE_Z - z_min])
G = G + offset
log(f'fit: scale {fit_scale:.5f} (span {LENGTH / fit_scale:.4f} -> {LENGTH}); bore centre from '
    f'the {BORE_FROM} = [{bore_centre[0]:.4f}, {bore_centre[1]:.4f}] (muzzle face, '
    f'{int(face.sum())} verts -> [{face_centre[0]:.4f}, {face_centre[1]:.4f}]; barrel band, '
    f'{int(band.sum())} verts -> [{band_centre[0]:.4f}, {band_centre[1]:.4f}]); translate '
    f'[{offset[0]:.4f}, {offset[1]:.4f}, {offset[2]:.4f}]')

above = (G[:, 1] > BORE_Y) & (G[:, 2] >= LOCK_Z[0]) & (G[:, 2] <= LOCK_Z[1])
if above.sum() >= 3:
    plus = max(0.0, float(G[above, 0].max()))
    minus = max(0.0, float(-G[above, 0].min()))
else:
    plus = minus = 0.0
detected_lock = '+X' if plus >= minus else '-X'
lock_side = LOCK if LOCK != 'auto' else detected_lock
mirror = -1.0 if lock_side == '-X' else 1.0
decisions['lockSide'] = {'source': 'flag' if LOCK != 'auto' else 'auto', 'value': lock_side,
                         'detected': detected_lock, 'breechExtent': {'plusX': plus, 'minusX': minus},
                         'mirrored': mirror < 0}
log(f'lock side: {lock_side} ({"flag" if LOCK != "auto" else "auto"}; above the bore in '
    f'z {LOCK_Z}, +X reaches {plus:.4f} and -X reaches {minus:.4f})')
if mirror < 0:
    log('  -> the lock is on the gun\'s left; mirroring across x = 0 so it lands on +X. '
        '(Forward and up already fix the frame, so a mirror is the only way to move the lock; '
        'pass --lock-side +X to skip it.)')

# One Blender matrix for orientation + scale + translation (positive determinant, so normals and
# winding survive transform_apply); the mirror is a separate data-space flip with reversed winding.
C = np.array([[1., 0., 0.], [0., 0., -1.], [0., 1., 0.]])       # gun -> Blender
L = C @ (fit_scale * A)
T = C @ offset
body.matrix_world = Matrix(((L[0, 0], L[0, 1], L[0, 2], T[0]),
                            (L[1, 0], L[1, 1], L[1, 2], T[1]),
                            (L[2, 0], L[2, 1], L[2, 2], T[2]),
                            (0., 0., 0., 1.)))
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if mirror < 0:
    body.data.transform(Matrix.Scale(-1.0, 4, (1.0, 0.0, 0.0)))
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()

# Re-measure in gun space from the real Blender data rather than from the numpy prediction.
placed = np.empty(len(body.data.vertices) * 3, dtype=np.float64)
body.data.vertices.foreach_get('co', placed)
placed = placed.reshape(-1, 3)
G = np.stack([placed[:, 0], placed[:, 2], -placed[:, 1]], axis=1)
log(f'gun-space bounds after the fit: min {[round(v, 4) for v in G.min(axis=0)]} '
    f'max {[round(v, 4) for v in G.max(axis=0)]}')

# Where an operator should look for the hammer: the lock-side mass above the bore near the breech,
# then its top 55 % -- on a flintlock that is the cock standing above the lock plate.
lock_mass = (G[:, 0] > .02) & (G[:, 1] > BORE_Y + .04) & (G[:, 2] > -.45) & (G[:, 2] < .30)
hammer_hint = None
if lock_mass.sum() >= 6:
    m_lo, m_hi = G[lock_mass].min(axis=0), G[lock_mass].max(axis=0)
    cut = float(m_lo[1] + (m_hi[1] - m_lo[1]) * .45)
    top = lock_mass & (G[:, 1] >= cut)
    lo, hi = (G[top].min(axis=0), G[top].max(axis=0)) if top.sum() >= 4 else (m_lo, m_hi)
    hammer_hint = {
        'lockMassVertices': int(lock_mass.sum()),
        'lockMassBounds': {'min': [round(float(v), 4) for v in m_lo], 'max': [round(float(v), 4) for v in m_hi]},
        'hammerVertices': int(top.sum()),
        'hammerBounds': {'min': [round(float(v), 4) for v in lo], 'max': [round(float(v), 4) for v in hi]},
        'suggestedActionBox': [round(float(lo[0] - .02), 3), round(cut, 3), round(float(lo[2] - .02), 3),
                               round(float(hi[0] + .02), 3), round(float(hi[1] + .03), 3),
                               round(float(hi[2] + .02), 3)],
        'suggestedHinge': [round(float((lo[0] + hi[0]) / 2), 3), round(cut, 3),
                           round(float((lo[2] + hi[2]) / 2), 3)],
    }
    log(f'hammer hint: the lock-side mass above the bore spans {hammer_hint["lockMassBounds"]["min"]}'
        f'..{hammer_hint["lockMassBounds"]["max"]}; its top 55 % (the likely hammer) spans '
        f'{hammer_hint["hammerBounds"]["min"]}..{hammer_hint["hammerBounds"]["max"]}. Try '
        f'--action-box {" ".join(str(v) for v in hammer_hint["suggestedActionBox"])} '
        f'--hinge {" ".join(str(v) for v in hammer_hint["suggestedHinge"])}')

# ----------------------------------------------------------------------------- action split
action = None
fill_counts = {'body': 0, 'action': 0}


def fill_open_edges(obj):
    """Cap the boundary left by the split and paint the new faces with the fill material.

    Walks the boundary into closed loops and makes one n-gon per loop, then triangulates it.
    (bpy.ops.mesh.fill_holes / bmesh.ops.holes_fill silently do nothing on this mesh state, so
    the loops are built here where the result can be counted.)
    """
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    boundary = [e for e in bm.edges if len(e.link_faces) == 1]
    if not boundary:
        bm.free()
        return 0, 0
    # Walk in edge-index order, never in set order, so two runs of the same input agree.
    bm.edges.index_update()
    adjacency = {}
    for edge in boundary:
        for v in edge.verts:
            adjacency.setdefault(v, []).append(edge)
    remaining, made, skipped = {e.index for e in boundary}, [], 0
    for seed in boundary:
        if seed.index not in remaining:
            continue
        remaining.discard(seed.index)
        chain = [seed.verts[0], seed.verts[1]]
        while True:
            nxt = next((e for e in adjacency.get(chain[-1], []) if e.index in remaining), None)
            if nxt is None:
                break
            remaining.discard(nxt.index)
            chain.append(nxt.other_vert(chain[-1]))
        if len(chain) < 4 or chain[0] is not chain[-1]:
            skipped += 1
            continue
        chain.pop()
        try:
            face = bm.faces.new(chain)
        except ValueError:
            skipped += 1
            continue
        face.material_index = 1
        made.append(face)
    if made:
        made = bmesh.ops.triangulate(bm, faces=made)['faces']
        for face in made:
            face.material_index = 1
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    # Triangulating a non-planar cap can leave slivers the exporter would complain about.
    if me.validate(verbose=False):
        log(f'  {obj.name}: mesh.validate() removed degenerate geometry from the cap')
    me.update()
    if skipped:
        log(f'  {obj.name}: {skipped} open boundary chain(s) were not closed loops and stay open')
    return len(made), len(boundary)


if ACTION_BOX:
    if not HINGE:
        raise SystemExit('--action-box needs --hinge (the pivot the part swings about)')
    lo = np.array(ACTION_BOX[:3]); hi = np.array(ACTION_BOX[3:])
    lo, hi = np.minimum(lo, hi), np.maximum(lo, hi)
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type='FACE')
    bpy.ops.mesh.select_all(action='DESELECT')
    bm = bmesh.from_edit_mesh(body.data)
    selected = 0
    for f in bm.faces:
        g = blender_to_gun(np.array(f.calc_center_median()))
        inside = bool(np.all(g >= lo) and np.all(g <= hi))
        f.select_set(inside)
        selected += inside
    bmesh.update_edit_mesh(body.data)
    log(f'action split: {selected} of {len(bm.faces)} faces have their centroid inside '
        f'{[round(v, 3) for v in lo]}..{[round(v, 3) for v in hi]}')
    if selected == 0:
        bpy.ops.object.mode_set(mode='OBJECT')
        raise SystemExit('--action-box caught no faces; run once without it and read the '
                         'report\'s hammerHint, or widen the box')
    kept = set(bpy.data.objects)
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    action = next(o for o in bpy.data.objects if o not in kept)
    action.name = 'action'
    action.data.name = 'action'
    fill_counts['body'], body_open = fill_open_edges(body)
    fill_counts['action'], action_open = fill_open_edges(action)
    log(f'fill: body capped {body_open} open edge(s) with {fill_counts["body"]} face(s), '
        f'action capped {action_open} with {fill_counts["action"]}')
    pivot = np.array(HINGE, dtype=np.float64)
    pivot_b = gun_to_blender(pivot)
    action.data.transform(Matrix.Translation(-Vector(pivot_b)))
    action.location = Vector(pivot_b)
    axis = unit(HINGE_AXIS)
    action['hingeAxis'] = [float(v) for v in axis]
    log(f'action origin at gun {[round(float(v), 4) for v in pivot]}, '
        f'hingeAxis {[round(float(v), 4) for v in axis]}')
elif HINGE:
    log('WARNING: --hinge without --action-box; no action part will be split')

# ----------------------------------------------------------------------------- muzzle + root
near_bore = (np.abs(G[:, 0]) < .12) & (np.abs(G[:, 1] - BORE_Y) < .12)
bore_front = float(G[near_bore, 2].min()) if near_bore.sum() else float(G[:, 2].min())
muzzle_pos = np.array([0.0, BORE_Y, bore_front])
muzzle = bpy.data.objects.new('muzzle', None)
muzzle.empty_display_type = 'PLAIN_AXES'
muzzle.empty_display_size = .05
scene.collection.objects.link(muzzle)
muzzle.location = Vector(gun_to_blender(muzzle_pos))
log(f'muzzle empty at gun {[round(float(v), 4) for v in muzzle_pos]} '
    f'({int(near_bore.sum())} vertices within 12 cm of the bore axis)')

root = bpy.data.objects.new(KIND, None)
scene.collection.objects.link(root)
for child in [body, action, muzzle]:
    if child is not None:
        child.parent = root
        child.matrix_parent_inverse = Matrix.Identity(4)

for block in list(bpy.data.meshes):
    if block.users == 0:
        bpy.data.meshes.remove(block)
for block in list(bpy.data.materials):
    if block.users == 0:
        bpy.data.materials.remove(block)

body.data.calc_loop_triangles()
tri_body = len(body.data.loop_triangles)
tri_action = 0
if action is not None:
    action.data.calc_loop_triangles()
    tri_action = len(action.data.loop_triangles)
log(f'triangles: body {tri_body}, action {tri_action}')

# ----------------------------------------------------------------------------- export
os.makedirs(os.path.dirname(OUT), exist_ok=True)
log('exporting objects:', sorted(o.name for o in bpy.data.objects))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', use_selection=False,
    export_yup=True, export_apply=True, export_extras=True,
    export_texcoords=True, export_normals=True, export_tangents=False,
    export_materials='EXPORT', export_image_format='AUTO',
    export_skins=False, export_animations=False, export_cameras=False, export_lights=False,
)
log('wrote', OUT, os.path.getsize(OUT), 'bytes')

# ------------------------------------------------------- verify against the exported bytes
NPTYPE = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    raw = open(path, 'rb').read()
    if raw[:4] != b'glTF':
        raise SystemExit(f'{path} is not a GLB')
    off, gltf, binary = 12, None, b''
    while off + 8 <= len(raw):
        length, kind = struct.unpack_from('<II', raw, off)
        chunk = raw[off + 8:off + 8 + length]
        off += 8 + length
        if kind == 0x4E4F534A:
            gltf = json.loads(chunk.decode('utf8'))
        elif kind == 0x004E4942:
            binary = chunk
    return raw, gltf, binary


def read_accessor(gltf, binary, index):
    acc = gltf['accessors'][index]
    view = gltf['bufferViews'][acc['bufferView']]
    width, dtype = WIDTH[acc['type']], NPTYPE[acc['componentType']]
    item = np.dtype(dtype).itemsize
    base = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = view.get('byteStride') or width * item
    if stride == width * item:
        return np.frombuffer(binary, dtype=dtype, count=acc['count'] * width, offset=base).reshape(-1, width)
    out = np.empty((acc['count'], width), dtype=dtype)
    for i in range(acc['count']):
        out[i] = np.frombuffer(binary, dtype=dtype, count=width, offset=base + i * stride)
    return out


raw, gltf, binary = read_glb(OUT)
nodes = gltf['nodes']
by_name = {n.get('name'): i for i, n in enumerate(nodes)}
if KIND not in by_name or 'body' not in by_name or 'muzzle' not in by_name:
    raise SystemExit(f'exported nodes are {sorted(by_name)}; expected {KIND}/body/muzzle')


def node_positions(name):
    node = nodes[by_name[name]]
    origin = np.array(node.get('translation', [0, 0, 0]), dtype=np.float64)
    if 'mesh' not in node:
        return origin.reshape(1, 3), 0
    rows, tris = [], 0
    for prim in gltf['meshes'][node['mesh']]['primitives']:
        rows.append(read_accessor(gltf, binary, prim['attributes']['POSITION']).astype(np.float64))
        tris += len(read_accessor(gltf, binary, prim['indices'])) // 3
    return np.concatenate(rows) + origin, tris


body_v, body_tris = node_positions('body')
action_v, action_tris = (node_positions('action') if 'action' in by_name else (None, 0))
muzzle_v = np.array(nodes[by_name['muzzle']].get('translation', [0, 0, 0]), dtype=np.float64)
all_v = body_v if action_v is None else np.concatenate([body_v, action_v])
lo, hi = all_v.min(axis=0), all_v.max(axis=0)

checks = []


def record(name, measured, expected, ok, fmt='{:.4f}'):
    text = measured if isinstance(measured, str) else ', '.join(fmt.format(float(v)) for v in np.atleast_1d(measured))
    checks.append({'name': name, 'measured': text, 'expected': expected, 'ok': bool(ok)})


# Every bound below comes from CONTRACTS[KIND], not from the flintlock: the blunderbuss is wider
# and its barrel band sits behind the flare. The "expected" column prints that kind's own numbers.
c_bounds, c_muzzle = CONTRACT['bounds'], CONTRACT['muzzle']
c_grip, c_barrel, c_action = CONTRACT['grip'], CONTRACT['barrel'], CONTRACT['action']
record('bounds z_min', lo[2], f'{c_bounds["zMin"][0]:.2f} .. {c_bounds["zMin"][1]:.2f}',
       c_bounds['zMin'][0] <= lo[2] <= c_bounds['zMin'][1])
record('bounds z_max', hi[2], f'<= {c_bounds["zMax"]:.2f}', hi[2] <= c_bounds['zMax'])
record('bounds y_min', lo[1], f'{c_bounds["yMin"][0]:.2f} .. {c_bounds["yMin"][1]:.2f}',
       c_bounds['yMin'][0] <= lo[1] <= c_bounds['yMin'][1])
record('bounds y_max', hi[1], f'<= {c_bounds["yMax"]:.2f}', hi[1] <= c_bounds['yMax'])
record('bounds |x|', max(abs(lo[0]), abs(hi[0])), f'<= {c_bounds["absX"]:.2f}',
       max(abs(lo[0]), abs(hi[0])) <= c_bounds['absX'])
record('muzzle z', muzzle_v[2],
       f'{lo[2] + c_muzzle["zBelowMin"]:.3f} .. {lo[2] + c_muzzle["zAboveMin"]:.3f}',
       lo[2] + c_muzzle['zBelowMin'] <= muzzle_v[2] <= lo[2] + c_muzzle['zAboveMin'])
record('muzzle y', muzzle_v[1], f'{c_muzzle["y"][0]:.2f} .. {c_muzzle["y"][1]:.2f}',
       c_muzzle['y'][0] <= muzzle_v[1] <= c_muzzle['y'][1])
record('muzzle |x|', abs(muzzle_v[0]), f'<= {c_muzzle["absX"]:.2f}', abs(muzzle_v[0]) <= c_muzzle['absX'])

# grip.zFrom, where a kind has one, keeps a fore-end hanging under the barrel out of the grip band.
grip_mask = (body_v[:, 1] >= c_grip['band'][0]) & (body_v[:, 1] <= c_grip['band'][1])
grip_from = c_grip.get('zFrom')
if grip_from is not None:
    grip_mask &= body_v[:, 2] >= grip_from
grip = body_v[grip_mask]
grip_label = (f'grip band y {c_grip["band"][0]:.2f}..{c_grip["band"][1]:.2f}'
              + ('' if grip_from is None else f', z >= {grip_from:.2f}'))
if len(grip):
    gc = grip.mean(axis=0)
    gx, gz = grip[:, 0].max() - grip[:, 0].min(), grip[:, 2].max() - grip[:, 2].min()
    record('grip centroid |x|', abs(gc[0]), f'<= {c_grip["absCentroidX"]:.2f}', abs(gc[0]) <= c_grip['absCentroidX'])
    record('grip centroid z', gc[2], f'{c_grip["centroidZ"][0]:.2f} .. {c_grip["centroidZ"][1]:.2f}',
           c_grip['centroidZ'][0] <= gc[2] <= c_grip['centroidZ'][1])
    record('grip x-extent', gx, f'<= {c_grip["extentX"]:.2f}', gx <= c_grip['extentX'])
    record('grip z-extent', gz, f'<= {c_grip["extentZ"]:.2f}', gz <= c_grip['extentZ'])
else:
    record(grip_label, 'no vertices', 'non-empty', False)

barrel = body_v[(body_v[:, 2] >= c_barrel['band'][0]) & (body_v[:, 2] <= c_barrel['band'][1])]
if len(barrel):
    bc = barrel.mean(axis=0)
    bx, by = barrel[:, 0].max() - barrel[:, 0].min(), barrel[:, 1].max() - barrel[:, 1].min()
    record('barrel centroid y', bc[1], f'{c_barrel["centroidY"][0]:.2f} .. {c_barrel["centroidY"][1]:.2f}',
           c_barrel['centroidY'][0] <= bc[1] <= c_barrel['centroidY'][1])
    record('barrel centroid |x|', abs(bc[0]), f'<= {c_barrel["absCentroidX"]:.2f}',
           abs(bc[0]) <= c_barrel['absCentroidX'])
    record('barrel x-extent', bx, f'<= {c_barrel["extentX"]:.2f}', bx <= c_barrel['extentX'])
    record('barrel y-extent', by, f'<= {c_barrel["extentY"]:.2f}', by <= c_barrel['extentY'])
else:
    record(f'barrel band z {c_barrel["band"][0]:.2f}..{c_barrel["band"][1]:.2f}', 'no vertices', 'non-empty', False)

hinge_axis_out = None
pivot_out = None
if action_v is not None:
    node = nodes[by_name['action']]
    pivot_out = np.array(node.get('translation', [0, 0, 0]), dtype=np.float64)
    hinge_axis_out = (node.get('extras') or {}).get('hingeAxis')
    body_lo, body_hi = body_v.min(axis=0), body_v.max(axis=0)
    record('action pivot in body bounds', pivot_out, 'inside the body bounds',
           bool(np.all(pivot_out >= body_lo - 1e-6) and np.all(pivot_out <= body_hi + 1e-6)))
    reach = float(np.linalg.norm(action_v - pivot_out, axis=1).max())
    record('action reach from pivot', reach, f'<= {c_action["reach"]:.2f}', reach <= c_action['reach'])
    record('action y range', [action_v[:, 1].min(), action_v[:, 1].max()],
           f'{c_action["y"][0]:.2f} .. {c_action["y"][1]:.2f}',
           action_v[:, 1].min() >= c_action['y'][0] and action_v[:, 1].max() <= c_action['y'][1])
    ok_axis = bool(hinge_axis_out) and abs(float(np.linalg.norm(hinge_axis_out)) - 1) < 1e-4
    record('hingeAxis (extras, unit)', str(hinge_axis_out), 'unit vector', ok_axis)
    record('action triangles', action_tris, '<= 1500', action_tris <= 1500, '{:.0f}')
record('body triangles', body_tris, '<= 9000', body_tris <= 9000, '{:.0f}')
record('GLB bytes', len(raw), '<= 3 MiB', len(raw) <= 3 * 1024 * 1024, '{:.0f}')
images = gltf.get('images', [])
record('images', len(images), 'exactly 1', len(images) == 1, '{:.0f}')
record('extensionsRequired', str(gltf.get('extensionsRequired', [])), 'empty', not gltf.get('extensionsRequired'))
extras_used = set(gltf.get('extensionsUsed', [])) - {'KHR_materials_specular', 'KHR_materials_ior'}
record('extensionsUsed', str(gltf.get('extensionsUsed', [])),
       'subset of specular/ior', not extras_used)

width = max(len(c['name']) for c in checks)
log('')
log(f'{"landmark".ljust(width)}  {"measured".ljust(26)}  {"expected".ljust(24)}  ok')
log('-' * (width + 60))
for c in checks:
    log(f'{c["name"].ljust(width)}  {c["measured"].ljust(26)}  {c["expected"].ljust(24)}  '
        f'{"ok" if c["ok"] else "MISS"}')
log('')

report = {
    'kind': KIND,
    'source': os.path.abspath(SRC),
    'out': OUT,
    'generator': 'tools/meshy/build_weapon.py (Blender %s)' % bpy.app.version_string.split()[0],
    'gunSpace': {'forward': '-Z', 'up': '+Y', 'lockSide': '+X', 'length': LENGTH,
                 'boreY': BORE_Y, 'muzzleZ': MUZZLE_Z},
    'contract': CONTRACT,
    'orientation': decisions,
    'fit': {'scale': fit_scale, 'translate': [float(v) for v in offset],
            'boreFrom': BORE_FROM, 'boreCentre': [float(v) for v in bore_centre],
            'boreCentreMuzzleFace': [float(v) for v in face_centre],
            'boreCentreBarrelBand': [float(v) for v in band_centre],
            'barrelBand': list(BARREL_BAND), 'barrelBandVertices': int(band.sum()),
            'mirrored': mirror < 0},
    'counts': {'bodyTriangles': body_tris, 'actionTriangles': action_tris,
               'fillFaces': fill_counts, 'images': len(images)},
    'texture': texture_info,
    'measured': {
        'bounds': {'min': [float(v) for v in lo], 'max': [float(v) for v in hi]},
        'muzzle': [float(v) for v in muzzle_v],
        'hingePivot': None if pivot_out is None else [float(v) for v in pivot_out],
        'hingeAxis': hinge_axis_out,
        'materialNames': [m.get('name') for m in gltf.get('materials', [])],
        'nodeNames': sorted(by_name),
        'bytes': len(raw),
    },
    'hammerHint': hammer_hint,
    'checks': checks,
    'allowMisfit': ALLOW_MISFIT,
}
if REPORT:
    os.makedirs(os.path.dirname(os.path.abspath(REPORT)), exist_ok=True)
    with open(REPORT, 'w', encoding='utf8') as fh:
        json.dump(report, fh, indent=2)
    log('report', os.path.abspath(REPORT))

missed = [c['name'] for c in checks if not c['ok']]
if missed:
    log(f'{len(missed)} landmark(s) outside the contract: {", ".join(missed)}')
    if not ALLOW_MISFIT:
        raise SystemExit('landmark miss - adjust the flags, or pass --allow-misfit to keep the file')
    log('--allow-misfit given; keeping the export anyway')
log('ok')
