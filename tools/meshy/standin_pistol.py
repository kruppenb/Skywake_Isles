"""A blocky stand-in pistol that exercises build_weapon.py without spending Meshy credits.

Usage:
  blender --background --factory-startup --python-exit-code 1 --python standin_pistol.py -- \
      --out <scratch>/standin-pistol.glb [--texture-size 512]

The shape is authored in gun space (-Z muzzle, +Y up, +X lock side) roughly to the approved
flintlock proportions -- barrel about 62 % of the length, a grip raking back 30 degrees to a butt
cap, overall height about half the length -- with the hammer deliberately on the gun's LEFT so the
fit has to mirror it, and the whole thing is then rotated into a deliberately non-gun-space frame
before export: the exported GLB has the barrel along +X, the grip hanging along -Z and the hammer
on +Y. Overlapping primitives are welded with boolean unions and subdivided, so the mesh is a
single closed shell like a Meshy export and the action split really has holes to fill.
"""
import bpy, bmesh, json, math, os, sys
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
opts = {}
i = 0
while i < len(argv):
    opts[argv[i].lstrip('-')] = argv[i + 1]
    i += 2
OUT = os.path.abspath(opts['out'])
TEXTURE_SIZE = int(opts.get('texture-size', 512))
os.makedirs(os.path.dirname(OUT), exist_ok=True)


def log(*args):
    print(*args, flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# --------------------------------------------------------------- parts, authored in gun space
RAKE = math.radians(-30)        # the grip leans back 30 degrees from vertical


def box(name, centre, size, rake=False):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    ob = bpy.context.object
    ob.name = name
    ob.scale = Vector(size)
    ob.rotation_euler = (RAKE, 0, 0) if rake else (0, 0, 0)
    ob.location = Vector(centre)
    return ob


def cylinder(name, z0, z1, radius, y, segments=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=segments, radius=radius, depth=abs(z1 - z0),
                                        location=(0, y, (z0 + z1) / 2))
    ob = bpy.context.object
    ob.name = name
    return ob


parts = [
    cylinder('barrel', -1.00, -0.194, 0.075, 0.13, 24),
    cylinder('ramrod', -0.90, -0.19, 0.025, 0.045, 12),
    box('receiver', (0, 0.1325, -0.06), (0.17, 0.205, 0.32)),
    box('hammer', (-0.115, 0.265, 0.0575), (0.11, 0.13, 0.115)),   # gun LEFT on purpose
    box('guard', (0, 0.0075, -0.03), (0.07, 0.105, 0.14)),
    box('grip', (0, -0.096, 0.12), (0.145, 0.36, 0.135), rake=True),
    box('buttcap', (0, -0.252, 0.21), (0.16, 0.10, 0.17), rake=True),
]
bpy.ops.object.select_all(action='DESELECT')
for ob in parts:
    ob.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

base = parts[0]
for part in parts[1:]:
    mod = base.modifiers.new(part.name, 'BOOLEAN')
    mod.operation = 'UNION'
    mod.object = part
    mod.solver = 'EXACT'
bpy.ops.object.select_all(action='DESELECT')
base.select_set(True)
bpy.context.view_layer.objects.active = base
for mod in list(base.modifiers):
    bpy.ops.object.modifier_apply(modifier=mod.name)
for part in parts[1:]:
    bpy.data.objects.remove(part, do_unlink=True)
base.name = 'standin-pistol'
base.data.name = 'standin-pistol'
log(f'boolean union: {len(base.data.vertices)} verts, {len(base.data.polygons)} faces')

# A plain cylinder has rings only at its caps; densify so the barrel really has vertices in the
# landmark bands, the way a Meshy remesh would.
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.subdivide(number_cuts=3)
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
bpy.ops.object.mode_set(mode='OBJECT')
log(f'subdivided + unwrapped: {len(base.data.vertices)} verts, {len(base.data.polygons)} faces')

# ------------------------------------------------------------------------- checker texture
size = TEXTURE_SIZE
u = np.linspace(0, 1, size, dtype=np.float32)[None, :]
v = np.linspace(0, 1, size, dtype=np.float32)[:, None]
checker = ((np.floor(u * 8) + np.floor(v * 8)) % 2).astype(np.float32)
px = np.zeros((size, size, 4), dtype=np.float32)
px[..., 0] = np.clip(0.16 + 0.62 * u + 0.14 * checker, 0, 1)
px[..., 1] = np.clip(0.12 + 0.34 * v + 0.16 * checker, 0, 1)
px[..., 2] = np.clip(0.38 - 0.26 * u + 0.22 * v + 0.10 * checker, 0, 1)
px[:size // 8, :size // 8] = (0.95, 0.10, 0.65, 1.0)          # orientation marker
px[..., 3] = 1.0
image = bpy.data.images.new('standin-checker', size, size, alpha=False)
image.pixels.foreach_set(px.ravel())
png = os.path.join(os.path.dirname(OUT), 'standin-checker.png')
image.file_format = 'PNG'
image.filepath_raw = png
image.save()
packed = bpy.data.images.load(png)
packed.name = 'standin-checker'
packed.pack()

material = bpy.data.materials.new('standin')
material.use_nodes = True
nt = material.node_tree
bsdf = nt.nodes['Principled BSDF']
bsdf.inputs['Metallic'].default_value = 0.0
bsdf.inputs['Roughness'].default_value = 0.6
tex = nt.nodes.new('ShaderNodeTexImage')
tex.image = packed
tex.location = (-400, 0)
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
# Meshy also wires the albedo into emission; copy that quirk so the fit has to strip it.
nt.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
bsdf.inputs['Emission Strength'].default_value = 1.0
base.data.materials.clear()
base.data.materials.append(material)

# ----------------------------------------------------- scramble out of gun space, then export
# gun -Z (muzzle) -> glTF +X, gun +Y (up) -> glTF +Z, gun -X (the hammer) -> glTF +Y.
# In Blender (blender = (gx, -gz, gy)) that composite rotation is:
SCRAMBLE = Matrix(((0, 0, -1, 0), (0, -1, 0, 0), (-1, 0, 0, 0), (0, 0, 0, 1)))
base.matrix_world = SCRAMBLE
bpy.ops.object.select_all(action='DESELECT')
base.select_set(True)
bpy.context.view_layer.objects.active = base
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', use_selection=False,
    export_yup=True, export_apply=True, export_extras=False,
    export_texcoords=True, export_normals=True, export_tangents=False,
    export_materials='EXPORT', export_image_format='AUTO',
    export_skins=False, export_animations=False, export_cameras=False, export_lights=False,
)
base.data.calc_loop_triangles()
log(json.dumps({'out': OUT, 'bytes': os.path.getsize(OUT), 'texture': png,
                'triangles': len(base.data.loop_triangles),
                'gltfAxes': {'muzzle': '+X', 'up': '+Z', 'hammer': '+Y', 'grip': '-Z'}}, indent=2))
