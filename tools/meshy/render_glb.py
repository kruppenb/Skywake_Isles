"""Render a GLB on a neutral studio set from front / back / three-quarter / face cameras.
Usage: blender --background --factory-startup --python-exit-code 1 --python render_glb.py -- <file.glb> <out-dir> [frame] [--wide]
  --wide  landscape frames fitted to the longest horizontal axis, for props (weapons) rather than
          standing characters; without it the framing is the portrait character one.
"""
import bpy, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
WIDE = '--wide' in argv
argv = [a for a in argv if not a.startswith('--')]
src, out = argv[0], argv[1]
frame = int(argv[2]) if len(argv) > 2 else None
os.makedirs(out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
if frame is not None:
    scene.frame_set(frame)

# Bounds over evaluated meshes (so armature deformation counts).
dg = bpy.context.evaluated_depsgraph_get()
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for ob in bpy.data.objects:
    if ob.type != 'MESH' or ob.hide_render:
        continue
    ev = ob.evaluated_get(dg)
    for v in ev.data.vertices:
        w = ev.matrix_world @ v.co
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
size = hi - lo; center = (lo + hi) / 2; height = size.z
# What the camera distance is scaled by: the standing height, or for a wide prop whatever it takes
# to fit its longest horizontal axis across a landscape frame.
frame_h = max(height, max(size.x, size.y) / 1.35) if WIDE else height
print('bounds', [round(c, 3) for c in lo], [round(c, 3) for c in hi], 'height', round(height, 3),
      'frame height', round(frame_h, 3), 'wide' if WIDE else 'portrait')

# Studio: grey ground disc, soft key/fill/rim, ACES-ish view transform.
bpy.ops.mesh.primitive_circle_add(vertices=64, radius=height * 3, fill_type='NGON', location=(center.x, center.y, lo.z))
ground = bpy.context.object
gm = bpy.data.materials.new('ground'); gm.use_nodes = True
gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.30, 0.33, 0.36, 1)
gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
ground.data.materials.append(gm)
world = bpy.data.worlds.new('studio'); scene.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.22, 0.26, 0.29, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0

def light(name, kind, loc, energy, size=None, color=(1, 1, 1)):
    data = bpy.data.lights.new(name, kind); data.energy = energy; data.color = color
    if size is not None: data.shadow_soft_size = size
    if kind == 'AREA': data.size = size or 2
    ob = bpy.data.objects.new(name, data); scene.collection.objects.link(ob); ob.location = loc
    look = center - Vector(loc); ob.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
    return ob
light('key', 'AREA', (center.x - height * 1.6, center.y - height * 1.9, lo.z + height * 1.7), 900 * height, 2.5, (1, .97, .92))
light('fill', 'AREA', (center.x + height * 2.0, center.y - height * 1.2, lo.z + height * 1.1), 300 * height, 4, (.9, .95, 1))
light('rim', 'AREA', (center.x + height * .6, center.y + height * 2.2, lo.z + height * 1.9), 500 * height, 1.5, (1, 1, 1))

scene.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, 'SceneEEVEE') and 'BLENDER_EEVEE_NEXT' in [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = (1536, 1024) if WIDE else (1024, 1536)
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'; scene.render.film_transparent = False
scene.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
scene.view_settings.exposure = 0.0

cam_data = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_data); scene.collection.objects.link(cam); scene.camera = cam
cam_data.lens = 65; cam_data.sensor_fit = 'VERTICAL'; cam_data.sensor_height = 24

# The glTF importer converts +Y-up/-Z-forward (glTF) to Blender Z-up/-Y-forward... a glTF model whose
# face points +Z (Meshy convention) ends up facing -Y in Blender. Front camera sits on -Y.
def shot(name, yaw_deg, pitch_deg, dist_mult, target_frac=0.5, lens=65):
    yaw = math.radians(yaw_deg); pitch = math.radians(pitch_deg)
    target = Vector((center.x, center.y, lo.z + height * target_frac))
    dist = frame_h * dist_mult
    loc = target + Vector((math.sin(yaw) * math.cos(pitch) * dist, -math.cos(yaw) * math.cos(pitch) * dist, math.sin(pitch) * dist))
    cam.location = loc; cam.rotation_euler = (target - loc).to_track_quat('-Z', 'Y').to_euler(); cam_data.lens = lens
    scene.render.filepath = os.path.join(out, name + '.png')
    bpy.ops.render.render(write_still=True)
    print('wrote', scene.render.filepath)

shot('front', 0, 6, 2.6)
shot('three-quarter', -38, 8, 2.6)
shot('back', 180, 6, 2.6)
shot('side', 90, 4, 2.6)
shot('face', -18, 4, 0.9, target_frac=0.86, lens=85)
