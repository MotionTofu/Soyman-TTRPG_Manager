"""Pump dispenser cap generator: housing (cap_common skirt) + stem + actuator head, each
built as its own zero-based revolve and translated into place, then joined.

Building each sub-part on its own 0-based spine and translating it up (rather than starting
its profile's height control points above zero) avoids wasted overlapping geometry inside
the housing -- a revolved profile's spine always starts at the origin (see
node_utils.build_profile_polyline), so a sub-part meant to start higher up needs an explicit
translate, not a shifted point list.
"""

import json

import bpy

from .. import node_utils
from .. import shading_materials
from .. import properties
from .. import sync
from . import cap_common


def _translated(builder, mesh_socket, z_offset_socket):
    nodes = builder.nodes
    links = builder.links
    transform = nodes.new('GeometryNodeTransform')
    translation = nodes.new('ShaderNodeCombineXYZ')
    translation.inputs['X'].default_value = 0.0
    translation.inputs['Y'].default_value = 0.0
    links.new(z_offset_socket, translation.inputs['Z'])
    links.new(mesh_socket, transform.inputs['Geometry'])
    links.new(translation.outputs['Vector'], transform.inputs['Translation'])
    return transform.outputs['Geometry']


def build_node_group(name):
    b = node_utils.GNTreeBuilder(name)

    b.add_socket('Neck Diameter', 'INPUT', 'NodeSocketFloat', key='neck_diameter',
                 default=18.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Wall Thickness', 'INPUT', 'NodeSocketFloat', key='wall_thickness',
                 default=1.5, min_value=0.2, subtype='DISTANCE')
    b.add_socket('Housing Height', 'INPUT', 'NodeSocketFloat', key='skirt_height',
                 default=14.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Housing Top', 'INPUT', 'NodeSocketFloat', key='top_dome_height',
                 default=0.5, min_value=0.5, subtype='DISTANCE')
    b.add_socket('Stem Height', 'INPUT', 'NodeSocketFloat', key='stem_height',
                 default=25.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Stem Diameter', 'INPUT', 'NodeSocketFloat', key='stem_diameter',
                 default=4.0, min_value=0.5, subtype='DISTANCE')
    b.add_socket('Head Height', 'INPUT', 'NodeSocketFloat', key='head_height',
                 default=10.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Head Diameter', 'INPUT', 'NodeSocketFloat', key='head_diameter',
                 default=14.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Segments', 'INPUT', 'NodeSocketInt', key='segments', default=20, min_value=3)

    nodes = b.nodes
    links = b.links

    housing_points, min_h, housing_top = cap_common.build_skirt_points(b)
    housing_mesh = node_utils.revolve_profile_to_mesh(b, housing_points, b.input_socket('segments'))

    stem_radius = nodes.new('ShaderNodeMath')
    stem_radius.operation = 'DIVIDE'
    links.new(b.input_socket('stem_diameter'), stem_radius.inputs[0])
    stem_radius.inputs[1].default_value = 2.0
    zero = nodes.new('ShaderNodeValue')
    zero.outputs[0].default_value = 0.0
    stem_points = [
        (zero.outputs[0], stem_radius.outputs['Value']),
        (b.input_socket('stem_height'), stem_radius.outputs['Value']),
    ]
    stem_mesh_raw = node_utils.revolve_profile_to_mesh(b, stem_points, b.input_socket('segments'))
    stem_mesh = _translated(b, stem_mesh_raw, b.input_socket('skirt_height'))

    head_radius = nodes.new('ShaderNodeMath')
    head_radius.operation = 'DIVIDE'
    links.new(b.input_socket('head_diameter'), head_radius.inputs[0])
    head_radius.inputs[1].default_value = 2.0
    head_mid_h = nodes.new('ShaderNodeMath')
    head_mid_h.operation = 'MULTIPLY'
    links.new(b.input_socket('head_height'), head_mid_h.inputs[0])
    head_mid_h.inputs[1].default_value = 0.3
    small_head_radius = nodes.new('ShaderNodeMath')
    small_head_radius.operation = 'MULTIPLY'
    links.new(head_radius.outputs['Value'], small_head_radius.inputs[0])
    small_head_radius.inputs[1].default_value = 0.6
    head_points = [
        (zero.outputs[0], stem_radius.outputs['Value']),
        (head_mid_h.outputs['Value'], head_radius.outputs['Value']),
        (b.input_socket('head_height'), small_head_radius.outputs['Value']),
    ]
    head_mesh_raw = node_utils.revolve_profile_to_mesh(b, head_points, b.input_socket('segments'))

    stem_top = nodes.new('ShaderNodeMath')
    stem_top.operation = 'ADD'
    links.new(b.input_socket('skirt_height'), stem_top.inputs[0])
    links.new(b.input_socket('stem_height'), stem_top.inputs[1])
    head_mesh = _translated(b, head_mesh_raw, stem_top.outputs['Value'])

    join = nodes.new('GeometryNodeJoinGeometry')
    links.new(housing_mesh, join.inputs['Geometry'])
    links.new(stem_mesh, join.inputs['Geometry'])
    links.new(head_mesh, join.inputs['Geometry'])
    mesh_socket = join.outputs['Geometry']

    top_total = nodes.new('ShaderNodeMath')
    top_total.operation = 'ADD'
    links.new(stem_top.outputs['Value'], top_total.inputs[0])
    links.new(b.input_socket('head_height'), top_total.inputs[1])

    mesh_socket = node_utils.store_cylindrical_uv(b, mesh_socket, min_h, top_total.outputs['Value'])
    final = node_utils.apply_clean_shading(b, mesh_socket)
    b.finalize(final)

    return b


class PACKAGING_OT_add_cap_pump(bpy.types.Operator):
    bl_idname = 'object.packaging_add_cap_pump'
    bl_label = 'Pump Cap'
    bl_description = ('Add a procedural pump dispenser cap (Geometry Nodes). If a packaging '
                       'body is the active object, the cap is auto-linked and seated on its neck.')
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        body_obj = context.active_object
        has_body = (body_obj is not None
                    and body_obj.get(properties.PKG_SHAPE_TYPE_KEY) in properties.BODY_SHAPE_TYPES
                    and properties.PKG_SOCKET_IDS_KEY in body_obj)

        b = build_node_group('PKG_CapPump')

        mesh = bpy.data.meshes.new('CapPump')
        obj = bpy.data.objects.new('CapPump', mesh)
        context.collection.objects.link(obj)

        mod = obj.modifiers.new('Packaging', 'NODES')
        mod.node_group = b.tree

        obj[properties.PKG_SHAPE_TYPE_KEY] = 'cap_pump'
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
            sync.link_cap_to_body(obj, body_obj, properties.CAP_SYNC_KEY_PAIRS['cap_pump'])

        for other in context.view_layer.objects:
            other.select_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj

        bpy.ops.object.shade_auto_smooth()

        return {'FINISHED'}


def register():
    bpy.utils.register_class(PACKAGING_OT_add_cap_pump)


def unregister():
    bpy.utils.unregister_class(PACKAGING_OT_add_cap_pump)
