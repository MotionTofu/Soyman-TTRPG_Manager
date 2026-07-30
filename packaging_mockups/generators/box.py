"""Standalone rounded box generator (secondary/carton packaging -- no separate lid in v1,
see plan decisions)."""

import json

import bpy

from .. import node_utils
from .. import shading_materials
from .. import properties


def build_node_group(name):
    b = node_utils.GNTreeBuilder(name)

    b.add_socket('Width', 'INPUT', 'NodeSocketFloat', key='width',
                 default=60.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Depth', 'INPUT', 'NodeSocketFloat', key='depth',
                 default=35.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Height', 'INPUT', 'NodeSocketFloat', key='height',
                 default=90.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Corner Radius', 'INPUT', 'NodeSocketFloat', key='corner_radius',
                 default=3.0, min_value=0.0, subtype='DISTANCE')
    b.add_socket('Corner Segments', 'INPUT', 'NodeSocketInt', key='corner_segments',
                 default=6, min_value=1)

    mesh_socket = node_utils.build_rounded_box(
        b,
        b.input_socket('width'), b.input_socket('depth'), b.input_socket('height'),
        b.input_socket('corner_radius'), b.input_socket('corner_segments'),
    )
    mesh_socket = node_utils.store_planar_box_uv(b, mesh_socket)
    final = node_utils.apply_clean_shading(b, mesh_socket)
    b.finalize(final)

    return b


class PACKAGING_OT_add_box(bpy.types.Operator):
    bl_idname = 'object.packaging_add_box'
    bl_label = 'Box'
    bl_description = 'Add a procedural rounded carton box (Geometry Nodes)'
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        b = build_node_group('PKG_Box')

        mesh = bpy.data.meshes.new('Box')
        obj = bpy.data.objects.new('Box', mesh)
        context.collection.objects.link(obj)

        mod = obj.modifiers.new('Packaging', 'NODES')
        mod.node_group = b.tree

        obj[properties.PKG_SHAPE_TYPE_KEY] = 'box'
        obj[properties.PKG_SOCKET_IDS_KEY] = json.dumps(b.socket_ids)

        shading_materials.assign_material_slots(obj, ('Body', 'Label'))

        for other in context.view_layer.objects:
            other.select_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj

        bpy.ops.object.shade_auto_smooth()

        return {'FINISHED'}


def register():
    bpy.utils.register_class(PACKAGING_OT_add_box)


def unregister():
    bpy.utils.unregister_class(PACKAGING_OT_add_box)
