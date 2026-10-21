"""
Repack a Quaternius robot GLB for the game: every skinned part joined into
one mesh with its flat material colours baked into vertex colours (one draw
call per robot), a _GLOW vertex attribute marking the lit-up parts (eyes,
indicator lights), and only the animation clips the game plays.

  Blender -b --factory-startup --python tools/blender/pack-robots.py -- in.glb out.glb
"""

import sys

import bpy

KEEP_CLIPS = {'Idle', 'Walk', 'Run', 'Shoot', 'Attack', 'Death', 'Dead'}

src, dst = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

# the importer's bone-shape sphere and the source scene's lights
for o in list(bpy.data.objects):
    if o.type in {'LIGHT', 'CAMERA'} or (o.type == 'MESH' and not o.parent):
        bpy.data.objects.remove(o)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']


def glows(rgb):
    # the models' only saturated colours are their eyes and status lights
    return max(rgb) - min(rgb) > 0.75


for o in meshes:
    me = o.data
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    glow = me.attributes.new('_GLOW', 'FLOAT', 'POINT')
    rgb = [tuple(s.material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value[:3])
           if s.material else (0.5, 0.5, 0.5) for s in o.material_slots]
    for poly in me.polygons:
        c = rgb[poly.material_index] if rgb else (0.5, 0.5, 0.5)
        for li in poly.loop_indices:
            col.data[li].color = (*c, 1.0)
        if glows(c):
            for vi in poly.vertices:
                glow.data[vi].value = 1.0
    me.color_attributes.active_color = col
    o.data.materials.clear()

bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
mat = bpy.data.materials.new('Robot')
body.data.materials.append(mat)

for a in list(bpy.data.actions):
    if a.name.split('|')[-1] not in KEEP_CLIPS:
        bpy.data.actions.remove(a)

bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format='GLB',
    export_skins=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_vertex_color='ACTIVE',
    export_attributes=True,
    export_lights=False,
    export_cameras=False,
)
