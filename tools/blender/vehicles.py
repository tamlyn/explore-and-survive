"""
Readies the vehicle models for the game: colours baked into vertex colours
(the game weathers them in VehicleMaterial), the wheels cut out as their own
objects with their pivots at the hub, the windows knocked out so a driver
can see, scaled to metres and turned to face -z, with the ground under the
wheels at y = 0 and the wheelbase centred on the origin.

Prints each model's wheel layout for VehicleSpec.

  blender -b --python tools/blender/vehicles.py -- <source dir>

The sources are the poly.pizza downloads named in CREDITS.md, which aren't
kept in the repo.
"""

import json
import os
import sys

import bpy
import bmesh
import mathutils

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'models', 'vehicles')

# wheels are given either by object name, or (the buggy, a triangle soup)
# as a cylinder about the axle in source units: centre x and z, radius, and
# the span across y
CONFIG = {
    'buggy': {
        'src': 'Buggy by Nick Slough - eZ_13w7qZh7.glb',
        'scale': 1.0,
        # faces -x: turn to face +y, which glTF export makes -z
        'turn': -90,
        'wheels': {
            # facing -x, its right is +y
            'fl': {'cyl': (-1.285, -0.275, 0.27, -0.66, -0.50)},
            'fr': {'cyl': (-1.285, -0.275, 0.27, 0.50, 0.66)},
            'rl': {'cyl': (0.785, -0.165, 0.33, -0.97, -0.58)},
            'rr': {'cyl': (0.785, -0.165, 0.33, 0.58, 0.97)},
        },
        # the toy orange roll cage and yellow lamps, to faded olive and khaki
        'recolour': {
            'mat14': (0.075, 0.085, 0.035),
            'mat13': (0.16, 0.13, 0.055),
            'mat19': (0.12, 0.1, 0.05),
            'mat12': (0.5, 0.42, 0.18),
        },
        'decimate': {},
    },
    'rover': {
        'src': 'Range Rover by IvOfficial - 8zk4o6nALW.glb',
        # the source is half as long again as the real thing
        'scale': 0.7,
        'turn': 180,
        'wheels': {
            'fl': {'name': 'Tire1'},
            'fr': {'name': 'Tire3'},
            'rl': {'name': 'Tire2'},
            'rr': {'name': 'Tire4'},
        },
        'recolour': {},
        # each tyre is 4000 faces
        'decimate': {'Tire': 0.2, 'Spare Tire': 0.2},
    },
}

GLASS = 'Glass'


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material_colour(mat):
    """flat colour and, if any, the image it's multiplied by"""
    if mat is None or not mat.use_nodes:
        return (0.8, 0.8, 0.8), None
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        return (0.8, 0.8, 0.8), None
    base = bsdf.inputs['Base Color']
    image = None
    stack = [l.from_node for l in base.links]
    while stack:
        n = stack.pop()
        if n.type == 'TEX_IMAGE':
            image = n.image
            break
        stack.extend(l.from_node for i in n.inputs for l in i.links)
    return tuple(base.default_value[:3]), image


class Sampler:
    def __init__(self, image):
        self.w, self.h = image.size
        self.px = list(image.pixels)
        self.srgb = image.colorspace_settings.name == 'sRGB'

    def at(self, u, v):
        x = min(self.w - 1, max(0, int((u % 1) * self.w)))
        y = min(self.h - 1, max(0, int((v % 1) * self.h)))
        i = (y * self.w + x) * 4
        c = self.px[i:i + 3]
        return tuple(srgb_to_linear(k) for k in c) if self.srgb else tuple(c)


def bake_colours(obj, recolour):
    """every face corner takes its material's colour, sampled from the
    texture where there is one"""
    me = obj.data
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    uv = me.uv_layers.active
    samplers = {}
    for poly in me.polygons:
        mat = obj.material_slots[poly.material_index].material if obj.material_slots else None
        flat, image = material_colour(mat)
        if mat is not None and mat.name in recolour:
            flat, image = recolour[mat.name], None
        for li in poly.loop_indices:
            c = flat
            if image is not None and uv is not None:
                s = samplers.setdefault(image.name, Sampler(image))
                u, v = uv.data[li].uv
                t = s.at(u, v)
                c = (c[0] * t[0], c[1] * t[1], c[2] * t[2])
            attr.data[li].color = (*c, 1.0)
    me.color_attributes.active_color = attr


def drop_glass(obj):
    names = [s.material.name if s.material else '' for s in obj.material_slots]
    if GLASS not in names:
        return
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    glass = [f for f in bm.faces if names[f.material_index] == GLASS]
    bmesh.ops.delete(bm, geom=glass, context='FACES')
    bm.to_mesh(obj.data)
    bm.free()


def to_world(obj):
    """bake the object's transform into its mesh"""
    obj.data = obj.data.copy()
    mw = obj.matrix_world.copy()
    obj.parent = None
    obj.data.transform(mw)
    obj.matrix_world = mathutils.Matrix.Identity(4)


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def cut_cylinder(obj, cyl, name):
    """the faces of `obj` inside an axle-aligned cylinder, as a new object"""
    cx, cz, r, y0, y1 = cyl
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    inside = []
    for f in bm.faces:
        c = f.calc_center_median()
        if (c.x - cx) ** 2 + (c.z - cz) ** 2 <= (r + 0.01) ** 2 and y0 - 0.01 <= c.y <= y1 + 0.01:
            inside.append(f)
    for f in bm.faces:
        f.select = f in inside
    bm.to_mesh(obj.data)
    bm.free()
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    wheel = next(o for o in bpy.context.selected_objects if o is not obj)
    wheel.name = name
    wheel.data.name = name
    return wheel


def bounds(objs):
    vs = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    lo = mathutils.Vector([min(v[i] for v in vs) for i in range(3)])
    hi = mathutils.Vector([max(v[i] for v in vs) for i in range(3)])
    return lo, hi


def process(key, cfg, src_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src_dir, cfg['src']))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in meshes:
        to_world(o)
    for o in [o for o in bpy.context.scene.objects if o.type != 'MESH']:
        bpy.data.objects.remove(o)
    for o in meshes:
        bake_colours(o, cfg['recolour'])
        drop_glass(o)
        for prefix, ratio in cfg['decimate'].items():
            if o.name.startswith(prefix):
                mod = o.modifiers.new('decimate', 'DECIMATE')
                mod.ratio = ratio
                bpy.context.view_layer.objects.active = o
                bpy.ops.object.modifier_apply(modifier=mod.name)

    wheels = {}
    named = {w['name']: k for k, w in cfg['wheels'].items() if 'name' in w}
    for o in list(meshes):
        if o.name in named:
            wheels[named[o.name]] = o
            o.name = f'wheel_{named[o.name]}'
            meshes.remove(o)
    body = join(meshes, 'body')
    for k, w in cfg['wheels'].items():
        if 'cyl' in w:
            wheels[k] = cut_cylinder(body, w['cyl'], f'wheel_{k}')

    # turn, scale, then stand the wheels on y = 0 about the wheelbase centre
    turn = mathutils.Matrix.Rotation(cfg['turn'] * 3.14159265358979 / 180, 4, 'Z')
    m = mathutils.Matrix.Scale(cfg['scale'], 4) @ turn
    parts = [body, *wheels.values()]
    for o in parts:
        o.data.transform(m)
    lo, _ = bounds(list(wheels.values()))
    centres = {k: sum(bounds([o])[0:2], mathutils.Vector()) / 2 for k, o in wheels.items()}
    mid = sum(centres.values(), mathutils.Vector()) / len(centres)
    shift = mathutils.Matrix.Translation((-mid.x, -mid.y, -lo.z))
    for o in parts:
        o.data.transform(shift)
    for k, o in wheels.items():
        c = sum(bounds([o])[0:2], mathutils.Vector()) / 2
        o.data.transform(mathutils.Matrix.Translation(-c))
        o.location = c

    for o in parts:
        o.data.materials.clear()
        while o.data.uv_layers:
            o.data.uv_layers.remove(o.data.uv_layers[0])
    paint = bpy.data.materials.new('paint')
    for o in parts:
        o.data.materials.append(paint)

    # Blender is z-up with the front at +y; glTF is y-up with the front at -z
    def gl(v):
        return [round(v.x, 3), round(v.z, 3), round(-v.y, 3)]

    blo, bhi = bounds([body])
    layout = {'body': {'min': gl(mathutils.Vector((blo.x, bhi.y, blo.z))), 'max': gl(mathutils.Vector((bhi.x, blo.y, bhi.z)))}, 'wheels': {}}
    for k, o in wheels.items():
        wlo, whi = bounds([o])
        layout['wheels'][k] = {'at': gl(o.location), 'radius': round((whi.z - wlo.z) / 2, 3), 'width': round(whi.x - wlo.x, 3)}
    tris = sum(len(p.vertices) - 2 for o in parts for p in o.data.polygons)
    print(f'LAYOUT {key} {tris} tris', json.dumps(layout))

    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, f'{key}.glb'),
        export_format='GLB',
        export_yup=True,
        export_texcoords=False,
        export_vertex_color='ACTIVE',
        export_materials='EXPORT',
    )


src_dir = sys.argv[sys.argv.index('--') + 1]
for key, cfg in CONFIG.items():
    process(key, cfg, src_dir)
