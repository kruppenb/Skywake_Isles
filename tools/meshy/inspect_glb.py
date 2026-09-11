"""Blender headless inspection of a Meshy GLB: objects, scale quirks, armature, materials, bounds.
Usage: blender --background --factory-startup --python-exit-code 1 --python inspect_glb.py -- <file.glb> [<report.json>]
"""
import bpy, json, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src = argv[0]
out = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

report = {'file': src, 'objects': [], 'armatures': [], 'materials': [], 'images': [], 'actions': []}
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for ob in bpy.data.objects:
    entry = {'name': ob.name, 'type': ob.type, 'parent': ob.parent.name if ob.parent else None,
             'scale': [round(s, 4) for s in ob.scale], 'location': [round(v, 4) for v in ob.location],
             'hide_render': ob.hide_render, 'hide_viewport': ob.hide_viewport, 'collections': [c.name for c in ob.users_collection]}
    if ob.type == 'MESH':
        me = ob.data
        me.calc_loop_triangles()
        entry.update({'verts': len(me.vertices), 'tris': len(me.loop_triangles), 'materials': [m.name if m else None for m in me.materials],
                      'vertex_groups': len(ob.vertex_groups), 'uv_layers': [u.name for u in me.uv_layers],
                      'modifiers': [(m.type, getattr(m, 'object', None).name if getattr(m, 'object', None) else None) for m in ob.modifiers]})
        for v in me.vertices:
            w = ob.matrix_world @ v.co
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    if ob.type == 'ARMATURE':
        arm = ob.data
        bones = []
        for b in arm.bones:
            head = ob.matrix_world @ b.head_local; tail = ob.matrix_world @ b.tail_local
            bones.append({'name': b.name, 'parent': b.parent.name if b.parent else None,
                          'head': [round(c, 4) for c in head], 'tail': [round(c, 4) for c in tail]})
        report['armatures'].append({'object': ob.name, 'bone_count': len(bones), 'bones': bones,
                                    'animation': ob.animation_data.action.name if ob.animation_data and ob.animation_data.action else None})
    report['objects'].append(entry)
report['world_bounds'] = {'min': [round(c, 4) for c in lo], 'max': [round(c, 4) for c in hi], 'size': [round(c, 4) for c in (hi - lo)]}
for m in bpy.data.materials:
    info = {'name': m.name, 'blend': getattr(m, 'surface_render_method', None), 'textures': []}
    if m.node_tree:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                info['textures'].append({'image': n.image.name, 'size': list(n.image.size), 'links': [l.to_socket.name for l in n.outputs[0].links]})
    report['materials'].append(info)
for im in bpy.data.images:
    report['images'].append({'name': im.name, 'size': list(im.size), 'packed': bool(im.packed_file)})
def fcurve_count(action):
    # Blender 5 slotted actions: layers -> strips -> channelbags -> fcurves. Fall back to the legacy API.
    try:
        return sum(len(cb.fcurves) for layer in action.layers for strip in layer.strips for cb in strip.channelbags)
    except Exception:
        try:
            return len(action.fcurves)
        except Exception:
            return -1
for a in bpy.data.actions:
    fr = a.frame_range
    report['actions'].append({'name': a.name, 'frame_range': [float(fr[0]), float(fr[1])], 'fcurves': fcurve_count(a),
                              'slots': [s.name_display if hasattr(s, 'name_display') else s.name for s in getattr(a, 'slots', [])]})
text = json.dumps(report, indent=1)
if out:
    open(out, 'w', encoding='utf-8').write(text)
summary = {k: v for k, v in report.items() if k != 'armatures'}
summary['armatures'] = [{'object': a['object'], 'bone_count': a['bone_count'], 'bones': [b['name'] for b in a['bones']], 'animation': a['animation']} for a in report['armatures']]
print(json.dumps(summary, indent=1))
