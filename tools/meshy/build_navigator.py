"""Merge Meshy's rigged character and its animation GLBs into one game-ready GLB.

Usage:
  blender --background --factory-startup --python-exit-code 1 --python build_navigator.py -- \
      --rig <rigged.glb> --clip idle=<idle.glb> --clip walk=<walking.glb> --clip run=<running.glb> \
      --out <navigator.glb> [--height 2.75] [--blend <scratch.blend>] \
      [--albedo <rgba.png> --sidecar <albedo.json>] [--head 1.22 --hands 1.2 --feet 1.15 --torso 1.1]

What it does (all of it is what Meshy's export leaves undone):
  * deletes the helper Icosphere and any non-character object
  * applies the 0.01 armature scale so bone and vertex data are in metres
  * optionally pushes the proportions toward the chunky adventure style: vertices are scaled about
    the head, wrist, ankle and spine pivots in proportion to their skin weight, so no bone moves and
    every Meshy/Mixamo clip still applies unchanged (--head/--hands/--feet/--torso factors)
  * optionally swaps the albedo for the prepared RGBA atlas from albedo.py (crew mask in alpha) and
    records the sidecar's crew-tint reference as material extras
  * removes the emissive link (Meshy wires the albedo into emission, which renders unlit in three.js)
  * rotates the character to face -Z (game convention) and scales it to --height metres, feet on y=0
  * gathers every clip onto the one armature as NLA tracks named idle/walk/run
  * adds weapon_grip.L/R, glider_grip.L/R (under the hands) and stow_back (under the chest) sockets
  * exports a single GLB with all clips
"""
import bpy, json, math, os, sys
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
opts = {'clips': []}
i = 0
while i < len(argv):
    key = argv[i]
    if key == '--clip':
        name, _, path = argv[i + 1].partition('='); opts['clips'].append((name, path)); i += 2
    else:
        opts[key.lstrip('-')] = argv[i + 1]; i += 2
RIG = opts['rig']; OUT = opts['out']; HEIGHT = float(opts.get('height', 2.75)); BLEND = opts.get('blend')
ALBEDO = opts.get('albedo'); SIDECAR = opts.get('sidecar')
PROPORTIONS = {key: float(opts.get(key, 1.0)) for key in ('head', 'hands', 'feet', 'torso')}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
if BLEND:
    os.makedirs(os.path.dirname(BLEND), exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE')
    meshes = [o for o in new if o.type == 'MESH' and o.parent == arm]
    junk = [o for o in new if o not in meshes and o is not arm]
    return arm, meshes, junk, new


def delete_objects(objs):
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)


def action_of(arm):
    ad = arm.animation_data
    return ad.action if ad else None


# ------------------------------------------------------------------ base rig
arm, meshes, junk, _ = import_glb(RIG)
print('rig objects:', arm.name, [m.name for m in meshes], 'junk:', [j.name for j in junk])
delete_objects(junk)
base_action = action_of(arm)
if base_action:
    arm.animation_data.action = None
# The importer also parks every imported animation in an NLA track; drop those so only our clips export.
if arm.animation_data:
    for track in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(track)
mesh = meshes[0]
mesh.name = 'SkywakeNavigatorMesh'; mesh.data.name = 'SkywakeNavigatorMesh'

# --------------------------------------------------- clips onto the base rig
bone_names = {b.name for b in arm.data.bones}
clips = []
for clip_name, path in opts['clips']:
    carm, cmeshes, cjunk, cnew = import_glb(path)
    caction = action_of(carm)
    missing = bone_names.symmetric_difference({b.name for b in carm.data.bones})
    if missing:
        raise SystemExit(f'{clip_name}: skeleton mismatch {sorted(missing)}')
    if caction is None:
        raise SystemExit(f'{clip_name}: no action in {path}')
    caction.name = clip_name
    caction.use_fake_user = True
    fr = caction.frame_range
    clips.append((clip_name, caction, float(fr[0]), float(fr[1])))
    carm.animation_data.action = None
    delete_objects(cnew)
    print(f'clip {clip_name}: frames {fr[0]:.2f}-{fr[1]:.2f}')

# Purge orphan meshes / materials / images from the deleted duplicates.
for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures):
    for block in list(coll):
        if block.users == 0:
            coll.remove(block)

# ---------------------------------------------------------------- transform
# Meshy: armature scale 0.01 with data in centimetres. Bake that scale into the bone and vertex
# data directly (uniform, so the skin binding stays valid) rather than through transform_apply,
# whose parent-inverse bookkeeping double-compensates the child mesh.
import numpy as np
inherit = arm.matrix_world.to_scale()
S = inherit.x
# The mesh's vertices are expressed in armature space through arm⁻¹ · mesh_world (the importer
# parks a 100× parent-inverse on the mesh, so its data is already in metres while bones are in cm).
mesh_to_arm = arm.matrix_world.inverted() @ mesh.matrix_world
vertex_factor = mesh_to_arm.to_scale().x * S
print(f'armature scale {S:.4f}, mesh->armature scale {mesh_to_arm.to_scale().x:.4f}, vertex factor {vertex_factor:.4f}')
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for eb in arm.data.edit_bones:
    eb.head = eb.head * S; eb.tail = eb.tail * S
bpy.ops.object.mode_set(mode='OBJECT')
arm.scale = (1, 1, 1); arm.location = (0, 0, 0)
co = np.empty(len(mesh.data.vertices) * 3, dtype=np.float32)
mesh.data.vertices.foreach_get('co', co); co *= vertex_factor; mesh.data.vertices.foreach_set('co', co)
mesh.data.update()
mesh.matrix_parent_inverse = Matrix.Identity(4)
mesh.scale = (1, 1, 1); mesh.location = (0, 0, 0); mesh.rotation_euler = (0, 0, 0)
# Actions carry Hips location keys in centimetres; scale those channels too.
def scale_location_curves(action, factor):
    def curves(a):
        try:
            return [fc for layer in a.layers for strip in layer.strips for cb in strip.channelbags for fc in cb.fcurves]
        except Exception:
            return list(a.fcurves)
    n = 0
    for fc in curves(action):
        if fc.data_path.endswith('.location'):
            for kp in fc.keyframe_points:
                kp.co.y *= factor; kp.handle_left.y *= factor; kp.handle_right.y *= factor
            n += 1
    return n
for clip_name, caction, *_ in clips:
    print(f'{clip_name}: scaled {scale_location_curves(caction, inherit.x)} location curves by {inherit.x}')

# ------------------------------------------------------------- proportions
# Blender space here: +Z up, the character faces -Y, +X is the character's left. Each edit scales
# vertices about a pivot by 1 + (factor - 1) * skin weight, which falls off smoothly across the
# joint blend and leaves every bone (and so every clip) untouched.
def group_weights(obj, names):
    index = {g.name: g.index for g in obj.vertex_groups}
    wanted = {index[n] for n in names if n in index}
    weights = np.zeros(len(obj.data.vertices), dtype=np.float32)
    for v in obj.data.vertices:
        weights[v.index] = sum(g.weight for g in v.groups if g.group in wanted)
    return np.clip(weights, 0, 1)

def bone_head(name):
    return Vector(arm.data.bones[name].head_local)

if any(abs(f - 1) > 1e-6 for f in PROPORTIONS.values()):
    verts = np.empty(len(mesh.data.vertices) * 3, dtype=np.float32)
    mesh.data.vertices.foreach_get('co', verts); verts = verts.reshape(-1, 3)
    def scale_about(weight, pivot, factors):
        amount = 1 + (np.asarray(factors, dtype=np.float32) - 1)[None, :] * weight[:, None]
        verts[:] = pivot + (verts - pivot) * amount
    if PROPORTIONS['head'] != 1:
        w = group_weights(mesh, ['Head', 'head_end', 'headfront'])
        pivot = bone_head('Head'); pivot.z = float(verts[w > 0.5, 2].min()) + 0.01  # chin stays in the collar
        scale_about(w, np.array(pivot, dtype=np.float32), [PROPORTIONS['head']] * 3)
        print(f'head x{PROPORTIONS["head"]} about {[round(c, 3) for c in pivot]}')
    if PROPORTIONS['hands'] != 1:
        for side in ('Left', 'Right'):
            w = group_weights(mesh, [f'{side}Hand'])
            pivot = np.array(bone_head(f'{side}Hand'), dtype=np.float32)
            scale_about(w, pivot, [PROPORTIONS['hands']] * 3)
        print(f'hands x{PROPORTIONS["hands"]}')
    if PROPORTIONS['feet'] != 1:
        for side in ('Left', 'Right'):
            w = group_weights(mesh, [f'{side}Foot', f'{side}ToeBase'])
            pivot = bone_head(f'{side}Foot'); pivot.z = float(verts[w > 0.5, 2].min())  # soles stay on the ground
            scale_about(w, np.array(pivot, dtype=np.float32), [PROPORTIONS['feet']] * 3)
        print(f'feet x{PROPORTIONS["feet"]}')
    if PROPORTIONS['torso'] != 1:
        w = group_weights(mesh, ['Hips', 'Spine02', 'Spine01', 'Spine'])
        pivot = bone_head('Spine'); pivot.x = 0.0
        depth = 1 + (PROPORTIONS['torso'] - 1) * 0.6
        scale_about(w, np.array(pivot, dtype=np.float32), [PROPORTIONS['torso'], depth, 1.0])
        print(f'torso width x{PROPORTIONS["torso"]}, depth x{depth:.3f}')
    mesh.data.vertices.foreach_set('co', verts.reshape(-1))
    mesh.data.update()

# Measure height in metres from the mesh (rest pose), then scale to the game height.
bpy.context.view_layer.update()  # matrix_world is stale until the depsgraph re-evaluates
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for v in mesh.data.vertices:
    w = mesh.matrix_world @ v.co
    lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
real_height = hi.z - lo.z
game_scale = HEIGHT / real_height
print(f'rest height {real_height:.3f} m -> game scale {game_scale:.4f}')

# Root node: face -Z in glTF. The importer maps glTF +Z (Meshy's face direction) to Blender -Y;
# the game wants glTF -Z, i.e. Blender +Y, so spin the root half a turn about Z.
root = bpy.data.objects.new('SkywakeNavigator', None)
scene.collection.objects.link(root)
arm.parent = root
root.rotation_euler = (0, 0, math.pi)
root.scale = (game_scale, game_scale, game_scale)
arm.location.z -= lo.z  # feet on the ground before the root scale

# ------------------------------------------------------------------ material
sidecar = json.load(open(SIDECAR)) if SIDECAR else None
for mat in mesh.data.materials:
    if not mat or not mat.node_tree:
        continue
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf:
        for link in list(nt.links):
            if link.to_node == bsdf and link.to_socket.name in ('Emission Color', 'Emission Strength'):
                nt.links.remove(link)
        bsdf.inputs['Emission Strength'].default_value = 0.0
        bsdf.inputs['Emission Color'].default_value = (0, 0, 0, 1)
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = 0.85
        if ALBEDO:
            # Swap Meshy's RGB atlas for the prepared RGBA one. The alpha is a data channel (the crew
            # mask), not transparency: keep it channel-packed and leave the BSDF alpha unlinked.
            image = bpy.data.images.load(ALBEDO)
            image.name = 'navigator_albedo'
            image.alpha_mode = 'CHANNEL_PACKED'
            image.colorspace_settings.name = 'sRGB'
            image.pack()
            base_link = next((l for l in nt.links if l.to_node == bsdf and l.to_socket.name == 'Base Color'), None)
            if base_link and base_link.from_node.type == 'TEX_IMAGE':
                base_link.from_node.image = image
            else:
                tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = image
                nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
            print('albedo replaced with', ALBEDO, image.size[:], 'channels', image.channels)
    mat.name = 'navigator'
    mat.surface_render_method = 'DITHERED'
    mat.blend_method = 'OPAQUE' if hasattr(mat, 'blend_method') else mat.blend_method
    if sidecar:
        # Exported as material extras (export_extras=True) so the runtime and the contract test can
        # read the tint convention from the asset itself.
        mat['crewMask'] = sidecar.get('crewMask', 'baseColorAlpha')
        mat['crewReference'] = [float(c) for c in sidecar.get('crewReference', [0.7, 0.4, 0.35])]

# -------------------------------------------------------------------- sockets
# Sockets are non-deforming leaf bones, so the glTF exporter emits them as plain child nodes of the
# hand / chest joints (bone-parented empties come out of the exporter 100x off for this rig).
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
def socket(name, parent, axis_from, along, offset):
    # Leaf bones (hands, toes, head_end) come out of the importer with meaningless tail lengths, so
    # take the direction from a real bone pair and use fixed metre distances.
    p = eb[parent]
    a, b_ = (eb[axis_from], p) if axis_from else (p, None)
    axis = ((p.head - eb[axis_from].head) if axis_from else (p.tail - p.head)).normalized()
    b = eb.new(name)
    b.head = p.head + axis * along + Vector(offset)
    b.tail = b.head + axis * 0.05
    b.parent = p; b.use_deform = False; b.use_connect = False
    print(f'socket {name}: head {[round(c, 3) for c in b.head]} (parent {parent} head {[round(c, 3) for c in p.head]})')
    return b
socket('weapon_grip.L', 'LeftHand', 'LeftForeArm', 0.09, (0, 0, 0))
socket('weapon_grip.R', 'RightHand', 'RightForeArm', 0.09, (0, 0, 0))
socket('glider_grip.L', 'LeftHand', 'LeftForeArm', 0.09, (0, 0, 0.02))
socket('glider_grip.R', 'RightHand', 'RightForeArm', 0.09, (0, 0, 0.02))
socket('stow_back', 'Spine', None, 0.05, (0, 0.12, 0))  # +Y in Blender is the character's back after the root spin
bpy.ops.object.mode_set(mode='OBJECT')
print('sockets added; bones now', len(arm.data.bones))

# ------------------------------------------------------------- NLA per clip
if not arm.animation_data:
    arm.animation_data_create()
ad = arm.animation_data
ad.action = None
for clip_name, caction, f0, f1 in clips:
    track = ad.nla_tracks.new(); track.name = clip_name
    strip = track.strips.new(clip_name, int(round(f0)), caction)
    strip.name = clip_name
    try:
        # Blender 5 slotted actions: the strip must know which slot drives the armature.
        if caction.slots:
            strip.action_slot = caction.slots[0]
    except Exception as exc:
        print('slot assignment skipped:', exc)
    track.mute = False

if BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=BLEND, compress=True)

# -------------------------------------------------------------------- export
keep = {root, arm, mesh} | {o for o in bpy.data.objects if o.parent is arm and o.type == 'EMPTY'}
stray = [o for o in bpy.data.objects if o not in keep]
print('stray objects removed before export:', [o.name for o in stray])
delete_objects(stray)
for block in list(bpy.data.meshes):
    if block.users == 0:
        bpy.data.meshes.remove(block)
print('exporting objects:', sorted(o.name for o in bpy.data.objects))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', use_selection=False,
    export_yup=True, export_apply=False,
    export_texcoords=True, export_normals=True, export_tangents=False,
    export_materials='EXPORT', export_image_format='AUTO',
    export_skins=True, export_all_influences=False, export_def_bones=False,
    export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
    export_optimize_animation_size=True, export_anim_single_armature=True, export_reset_pose_bones=True,
    export_cameras=False, export_lights=False, export_extras=bool(sidecar),
)
print('wrote', OUT, os.path.getsize(OUT), 'bytes')
