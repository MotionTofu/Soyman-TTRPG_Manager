"""Dropper cap generator: cap_common skirt topped with a squeezable bulb (the bottle-profile
taper pattern turned upside down and bulged outward instead of tapering to a neck)."""

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
    b.add_socket('Bulb Height', 'INPUT', 'NodeSocketFloat', key='bulb_height',
                 default=22.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Bulb Bulge Factor', 'INPUT', 'NodeSocketFloat', key='bulb_bulge_factor',
                 default=1.6, min_value=1.0, max_value=3.0, subtype='FACTOR')
    b.add_socket('Segments', 'INPUT', 'NodeSocketInt', key='segments', default=24, min_value=3)
    # cap_common.build_skirt_points also needs a top_dome_height key -- reuse Skirt Height's
    # own straight top (dome height near-zero) so the skirt meets the bulb with a crisp seam.
    b.add_socket('Skirt Top Dome', 'INPUT', 'NodeSocketFloat', key='top_dome_height',
                 default=0.5, min_value=0.5, subtype='DISTANCE')

    nodes = b.nodes
    links = b.links

    skirt_points, min_h, _skirt_top = cap_common.build_skirt_points(b)

    outer_radius_node = nodes.new('ShaderNodeMath')
    outer_radius_node.operation = 'ADD'
    neck_radius = nodes.new('ShaderNodeMath')
    neck_radius.operation = 'DIVIDE'
    links.new(b.input_socket('neck_diameter'), neck_radius.inputs[0])
    neck_radius.inputs[1].default_value = 2.0
    links.new(neck_radius.outputs['Value'], outer_radius_node.inputs[0])
    links.new(b.input_socket('wall_thickness'), outer_radius_node.inputs[1])

    bulb_radius = nodes.new('ShaderNodeMath')
    bulb_radius.operation = 'MULTIPLY'
    links.new(outer_radius_node.outputs['Value'], bulb_radius.inputs[0])
    links.new(b.input_socket('bulb_bulge_factor'), bulb_radius.inputs[1])

    bulb_mid_h = nodes.new('ShaderNodeMath')
    bulb_mid_h.operation = 'ADD'
    half_bulb = nodes.new('ShaderNodeMath')
    half_bulb.operation = 'MULTIPLY'
    links.new(b.input_socket('bulb_height'), half_bulb.inputs[0])
    half_bulb.inputs[1].default_value = 0.4
    links.new(b.input_socket('skirt_height'), bulb_mid_h.inputs[0])
    links.new(half_bulb.outputs['Value'], bulb_mid_h.inputs[1])

    bulb_top_h = nodes.new('ShaderNodeMath')
    bulb_top_h.operation = 'ADD'
    links.new(b.input_socket('skirt_height'), bulb_top_h.inputs[0])
    links.new(b.input_socket('bulb_height'), bulb_top_h.inputs[1])

    small_radius = nodes.new('ShaderNodeMath')
    small_radius.operation = 'MULTIPLY'
    links.new(bulb_radius.outputs['Value'], small_radius.inputs[0])
    small_radius.inputs[1].default_value = 0.1

    points = skirt_points + [
        (bulb_mid_h.outputs['Value'], bulb_radius.outputs['Value']),
        (bulb_top_h.outputs['Value'], small_radius.outputs['Value']),
    ]

    mesh_socket = node_utils.revolve_profile_to_mesh(b, points, b.input_socket('segments'))
    mesh_socket = node_utils.store_cylindrical_uv(b, mesh_socket, min_h, bulb_top_h.outputs['Value'])
    final = node_utils.apply_clean_shading(b, mesh_socket)
    b.finalize(final)

    return b


class PACKAGING_OT_add_cap_dropper(bpy.types.Operator):
    bl_idname = 'object.packaging_add_cap_dropper'
    bl_label = 'Dropper Cap'
    bl_description = ('Add a procedural dropper cap (Geometry Nodes). If a packaging body is '
                       'the active object, the cap is auto-linked and seated on its neck.')
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        body_obj = context.active_object
        has_body = (body_obj is not None
                    and body_obj.get(properties.PKG_SHAPE_TYPE_KEY) in properties.BODY_SHAPE_TYPES
                    and properties.PKG_SOCKET_IDS_KEY in body_obj)

        b = build_node_group('PKG_CapDropper')

        mesh = bpy.data.meshes.new('CapDropper')
        obj = bpy.data.objects.new('CapDropper', mesh)
        context.collection.objects.link(obj)

        mod = obj.modifiers.new('Packaging', 'NODES')
        mod.node_group = b.tree

        obj[properties.PKG_SHAPE_TYPE_KEY] = 'cap_dropper'
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
            sync.link_cap_to_body(obj, body_obj, properties.CAP_SYNC_KEY_PAIRS['cap_dropper'])

        for other in context.view_layer.objects:
            other.select_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj

        bpy.ops.object.shade_auto_smooth()

        return {'FINISHED'}


def register():
    bpy.utils.register_class(PACKAGING_OT_add_cap_dropper)


def unregister():
    bpy.utils.unregister_class(PACKAGING_OT_add_cap_dropper)
