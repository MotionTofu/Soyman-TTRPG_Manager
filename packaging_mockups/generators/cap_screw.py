"""Screw cap generator: cap_common skirt + a rounded top, synced to a body's neck."""

import json

import bpy

from .. import node_utils
from .. import shading_materials
from .. import properties
from .. import sync
from . import cap_common


def build_node_group(name):
    b = node_utils.GNTreeBuilder(name)

    b.add_socket('Neck Diameter', 'INPUT', 'NodeSocketFloat', key='neck_diameter',
                 default=18.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Wall Thickness', 'INPUT', 'NodeSocketFloat', key='wall_thickness',
                 default=1.5, min_value=0.2, subtype='DISTANCE')
    b.add_socket('Skirt Height', 'INPUT', 'NodeSocketFloat', key='skirt_height',
                 default=10.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Top Dome Height', 'INPUT', 'NodeSocketFloat', key='top_dome_height',
                 default=2.0, min_value=0.5, subtype='DISTANCE')
    b.add_socket('Segments', 'INPUT', 'NodeSocketInt', key='segments', default=32, min_value=3)

    points, min_h, max_h = cap_common.build_skirt_points(b)
    mesh_socket = node_utils.revolve_profile_to_mesh(b, points, b.input_socket('segments'))
    mesh_socket = node_utils.store_cylindrical_uv(b, mesh_socket, min_h, max_h)
    final = node_utils.apply_clean_shading(b, mesh_socket)
    b.finalize(final)

    return b


class PACKAGING_OT_add_cap_screw(bpy.types.Operator):
    bl_idname = 'object.packaging_add_cap_screw'
    bl_label = 'Screw Cap'
    bl_description = ('Add a procedural screw cap (Geometry Nodes). If a packaging body is '
                       'the active object, the cap is auto-linked and seated on its neck.')
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        body_obj = context.active_object
        has_body = (body_obj is not None
                    and body_obj.get(properties.PKG_SHAPE_TYPE_KEY) in properties.BODY_SHAPE_TYPES
                    and properties.PKG_SOCKET_IDS_KEY in body_obj)

        b = build_node_group('PKG_CapScrew')

        mesh = bpy.data.meshes.new('CapScrew')
        obj = bpy.data.objects.new('CapScrew', mesh)
        context.collection.objects.link(obj)

        mod = obj.modifiers.new('Packaging', 'NODES')
        mod.node_group = b.tree

        obj[properties.PKG_SHAPE_TYPE_KEY] = 'cap_screw'
        obj[properties.PKG_SOCKET_IDS_KEY] = json.dumps(b.socket_ids)

        shading_materials.assign_material_slots(obj, ('Cap',))

        if has_body:
            body_socket_ids = json.loads(body_obj[properties.PKG_SOCKET_IDS_KEY])
            body_mod = body_obj.modifiers.get('Packaging')
            obj.location = body_obj.location.copy()
            try:
                neck_top = body_mod[body_socket_ids['body_height']] + body_mod[body_socket_ids['neck_height']]
                obj.location.z += neck_top
            except KeyError:
                pass

            sync.link_cap_to_body(obj, body_obj, properties.CAP_SYNC_KEY_PAIRS['cap_screw'])

        for other in context.view_layer.objects:
            other.select_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj

        bpy.ops.object.shade_auto_smooth()

        return {'FINISHED'}


def register():
    bpy.utils.register_class(PACKAGING_OT_add_cap_screw)


def unregister():
    bpy.utils.unregister_class(PACKAGING_OT_add_cap_screw)
