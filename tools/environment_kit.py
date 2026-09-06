"""Shared deterministic Blender mesh, material and export helpers for environment kits.

Area generators own their seed, models, layouts, material policy and validation.
MATERIALS/PREFABS are process-local registries; run each generator in its own
background Blender process. Do not use these helpers in an interactive scene.
"""

import math
import struct
import zlib
from collections import defaultdict

import bpy
import numpy as np
from mathutils import Vector

MATERIALS = {}
PREFABS = {}
TAU = math.tau


def clamp(value, low=0.0, high=1.0):
    return min(high, max(low, value))


def game_to_blender(v):
    return (v[0], -v[2], v[1])


def unit(v):
    return Vector(v).normalized()


def rotate_y(v, angle):
    c, s = math.cos(angle), math.sin(angle)
    return Vector((v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c))


def png(path, pixels):
    """Minimal deterministic PNG writer; no external texture tooling required."""
    pixels = np.asarray(pixels, dtype=np.uint8)
    h, w, channels = pixels.shape
    assert channels == 3
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    rows = b''.join(b'\0' + row.tobytes() for row in pixels)
    payload = b'\x89PNG\r\n\x1a\n'
    payload += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    payload += chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')
    path.write_bytes(payload)


def tile_noise(size, frequency, rng):
    """Periodic value noise, cubic interpolation; edges tile in both directions."""
    grid = rng.random((frequency, frequency))
    xy = np.arange(size, dtype=float) * frequency / size
    ij = np.floor(xy).astype(int)
    f = xy - ij
    f = f * f * (3 - 2 * f)
    a = grid[ij[:, None] % frequency, ij[None, :] % frequency]
    b = grid[ij[:, None] % frequency, (ij[None, :] + 1) % frequency]
    c = grid[(ij[:, None] + 1) % frequency, ij[None, :] % frequency]
    d = grid[(ij[:, None] + 1) % frequency, (ij[None, :] + 1) % frequency]
    return ((a * (1 - f[None, :]) + b * f[None, :]) * (1 - f[:, None])
            + (c * (1 - f[None, :]) + d * f[None, :]) * f[:, None])


class KitMesh:
    """Accumulate material groups with explicit UVs and original vertex colors."""
    def __init__(self, name):
        self.name = name
        self.groups = defaultdict(lambda: {'vertices': [], 'faces': [], 'uv': [], 'colors': [], 'smooth': []})

    def polygon(self, points, material, color=(1, 1, 1), uvs=None, smooth=False):
        data = self.groups[material]
        offset = len(data['vertices'])
        data['vertices'].extend(tuple(p) for p in points)
        data['faces'].append(tuple(range(offset, offset + len(points))))
        if uvs is None:
            # Explicit planar mapping by dominant face normal, at metric scale.
            normal = (Vector(points[1]) - Vector(points[0])).cross(Vector(points[2]) - Vector(points[0]))
            axis = max(range(3), key=lambda i: abs(normal[i]))
            axes = [i for i in range(3) if i != axis]
            uvs = [(p[axes[0]], p[axes[1]]) for p in points]
        data['uv'].extend(uvs)
        if len(color) == len(points) and isinstance(color[0], (tuple, list)):
            data['colors'].extend(tuple(c[:3]) + (1,) for c in color)
        else:
            data['colors'].extend(tuple(color[:3]) + (1,) for _ in points)
        data['smooth'].append(smooth)

    def block(self, center, size, material='watch_stone', color=(1, 1, 1), bevel=.035, yaw=0, axis_y=None, skew=0):
        half = [v * .5 for v in size]
        bevel = min(bevel, min(half) * .43)
        vertices = {}
        if axis_y is None:
            transform = lambda p: rotate_y(p, yaw) + Vector(center)
        else:
            ay = unit(axis_y)
            ax = ay.cross(Vector((0, 0, 1)))
            if ax.length < .01:
                ax = ay.cross(Vector((1, 0, 0)))
            ax.normalize()
            az = ax.cross(ay).normalized()
            transform = lambda p: ax * p[0] + ay * p[1] + az * p[2] + Vector(center)
        if bevel <= 0:
            for axis in range(3):
                other = [k for k in range(3) if k != axis]
                for sign in (-1, 1):
                    points = []
                    for s1, s2 in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                        p = [0, 0, 0]
                        p[axis], p[other[0]], p[other[1]] = sign * half[axis], s1 * half[other[0]], s2 * half[other[1]]
                        points.append(transform(p))
                    n = (points[1] - points[0]).cross(points[2] - points[0])
                    if n.dot(sum(points, Vector()) / 4 - Vector(center)) < 0:
                        points.reverse()
                    self.polygon(points, material, color)
            return
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    signs = (sx, sy, sz)
                    for axis in range(3):
                        p = [signs[k] * (half[k] if k == axis else half[k] - bevel) for k in range(3)]
                        p[0] += p[1] * skew
                        vertices[(sx, sy, sz, axis)] = transform(p)
        # Winding all faces from their outward normal after transforming.
        faces = []
        for axis in range(3):
            remaining = [k for k in range(3) if k != axis]
            for side in (-1, 1):
                keys = []
                for s1, s2 in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    signs = [0, 0, 0]
                    signs[axis], signs[remaining[0]], signs[remaining[1]] = side, s1, s2
                    keys.append(tuple(signs) + (axis,))
                faces.append(keys)
        for varying in range(3):
            fixed = [k for k in range(3) if k != varying]
            for s1 in (-1, 1):
                for s2 in (-1, 1):
                    keys = []
                    for vary, face_axis in ((-1, fixed[0]), (1, fixed[0]), (1, fixed[1]), (-1, fixed[1])):
                        signs = [0, 0, 0]
                        signs[varying], signs[fixed[0]], signs[fixed[1]] = vary, s1, s2
                        keys.append(tuple(signs) + (face_axis,))
                    faces.append(keys)
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    faces.append([(sx, sy, sz, axis) for axis in range(3)])
        for keys in faces:
            points = [vertices[k] for k in keys]
            n = (points[1] - points[0]).cross(points[2] - points[0])
            fc = sum(points, Vector()) / len(points) - Vector(center)
            if n.dot(fc) < 0:
                points.reverse()
            # Preserve grain along a beam's long axis by mapping local positions.
            if material in ('aged_timber', 'pine_bark'):
                long_axis = max(range(3), key=lambda i: size[i])
                uvs = []
                for p in points:
                    q = p - Vector(center)
                    longitudinal = q.dot(unit(axis_y)) if axis_y is not None else rotate_y(q, -yaw)[long_axis]
                    transverse = (q.x + q.z) * .55 if long_axis == 1 or axis_y is not None else q.y + q.z * .6
                    uvs.append((transverse * 1.5, longitudinal / 2.2))
            else:
                uvs = None
            self.polygon(points, material, color, uvs)

    def beam(self, a, b, width=.12, depth=None, color=(1, 1, 1), material='aged_timber'):
        a, b = Vector(a), Vector(b)
        self.block((a + b) * .5, (width, (b - a).length, depth or width), material,
                   color, min(.018, width * .14), axis_y=b - a)

    def tube(self, points, radii, material='pine_bark', color=(1, 1, 1), sides=7):
        rings = []
        traveled = [0.0]
        for i, (p, radius) in enumerate(zip(points, radii)):
            direction = unit(Vector(points[min(i + 1, len(points) - 1)]) - Vector(points[max(0, i - 1)]))
            ax = direction.cross(Vector((0, 0, 1)))
            if ax.length < .01:
                ax = direction.cross(Vector((1, 0, 0)))
            ax.normalize()
            az = ax.cross(direction).normalized()
            rings.append([Vector(p) + (ax * math.cos(j * TAU / sides) + az * math.sin(j * TAU / sides)) * radius for j in range(sides)])
            if i:
                traveled.append(traveled[-1] + (Vector(p) - Vector(points[i - 1])).length)
        self.polygon(rings[0], material, color)
        for i in range(len(rings) - 1):
            for j in range(sides):
                nj = (j + 1) % sides
                self.polygon((rings[i][j], rings[i + 1][j], rings[i + 1][nj], rings[i][nj]), material, color,
                             ((j / sides, traveled[i] / 2), (j / sides, traveled[i + 1] / 2),
                              ((j + 1) / sides, traveled[i + 1] / 2), ((j + 1) / sides, traveled[i] / 2)), smooth=True)
        self.polygon(list(reversed(rings[-1])), material, color)

    def finish(self):
        root = bpy.data.objects.new(self.name, None)
        bpy.context.collection.objects.link(root)
        for material, data in self.groups.items():
            mesh = bpy.data.meshes.new(f'{self.name}__{material}')
            mesh.from_pydata([game_to_blender(p) for p in data['vertices']], [], data['faces'])
            mesh.materials.append(MATERIALS[material])
            uv = mesh.uv_layers.new(name='UVMap')
            colors = mesh.color_attributes.new(name='Color', type='BYTE_COLOR', domain='CORNER')
            for polygon, smooth in zip(mesh.polygons, data['smooth']):
                polygon.use_smooth = smooth
                for loop_index in polygon.loop_indices:
                    vid = mesh.loops[loop_index].vertex_index
                    uv.data[loop_index].uv = data['uv'][vid]
                    colors.data[loop_index].color_srgb = data['colors'][vid]
            mesh.update()
            obj = bpy.data.objects.new(mesh.name, mesh)
            bpy.context.collection.objects.link(obj)
            obj.parent = root
        PREFABS[self.name] = root
        return root


def create_textured_material(name, images, roughness, tint, *, double_sided=False, normal_strength=1):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = not double_sided
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = 0
    shader.inputs['Base Color'].default_value = tint
    color = nodes.new('ShaderNodeTexImage')
    color.image = images[0]
    color.extension = 'REPEAT'
    links.new(color.outputs['Color'], shader.inputs['Base Color'])
    # glTF multiplies the exported vertex COLOR_0 into its PBR base color.
    # Use the supported vertex-color multiply graph for Blender previews.
    vertex = nodes.new('ShaderNodeVertexColor')
    vertex.layer_name = 'Color'
    multiply = nodes.new('ShaderNodeMixRGB')
    multiply.blend_type = 'MULTIPLY'
    multiply.inputs[0].default_value = 1
    links.new(color.outputs['Color'], multiply.inputs[1])
    links.new(vertex.outputs['Color'], multiply.inputs[2])
    links.new(multiply.outputs['Color'], shader.inputs['Base Color'])
    normaltex = nodes.new('ShaderNodeTexImage')
    normaltex.image = images[1]
    normaltex.extension = 'REPEAT'
    normal = nodes.new('ShaderNodeNormalMap')
    normal.inputs['Strength'].default_value = normal_strength
    links.new(normaltex.outputs['Color'], normal.inputs['Color'])
    links.new(normal.outputs['Normal'], shader.inputs['Normal'])
    MATERIALS[name] = mat


def create_binding_material(name, *, double_sided=False):
    """Export a UV/color material slot; runtime borrows the shared kit's textures."""
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.use_backface_culling = not double_sided
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (1, 1, 1, 1)
    shader.inputs['Roughness'].default_value = .93
    vertex = material.node_tree.nodes.new('ShaderNodeVertexColor')
    vertex.layer_name = 'Color'
    material.node_tree.links.new(vertex.outputs['Color'], shader.inputs['Base Color'])
    MATERIALS[name] = material
    return material


def export_glb(output):
    """One uncompressed local glTF contract, with metric UVs and weathering colors."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', export_yup=True,
                              export_apply=True, export_texcoords=True, export_normals=True,
                              export_materials='EXPORT', export_image_format='AUTO',
                              export_animations=False, export_cameras=False, export_lights=False,
                              export_draco_mesh_compression_enable=False, export_extras=False,
                              export_attributes=True, export_all_vertex_colors=False,
                              export_vertex_color='NAME', export_vertex_color_name='Color',
                              export_active_vertex_color_when_no_material=True)
