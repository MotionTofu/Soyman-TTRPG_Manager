"""Flip-top cap generator: housing (cap_common skirt) + a lid disc rotated around a hinge
pivot at the back edge, via the standard "translate to origin, rotate, translate back"
pattern (Geometry Nodes' Transform node only rotates around the geometry's own origin).
"""

import json
import math

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
    b.add_socket('Housing Height', 'INPUT', 'NodeSocketFloat', key='skirt_height',
                 default=12.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Housing Top', 'INPUT', 'NodeSocketFloat', key='top_dome_height',
                 default=0.5, min_value=0.5, subtype='DISTANCE')
    b.add_socket('Lid Thickness', 'INPUT', 'NodeSocketFloat', key='lid_thickness',
                 default=6.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Lid Open Angle', 'INPUT', 'NodeSocketFloat', key='lid_open_angle',
                 default=0.0, min_value=0.0, max_value=math.radians(140), subtype='ANGLE')
    b.add_socket('Segments', 'INPUT', 'NodeSocketInt', key='segments', default=24, min_value=3)

    nodes = b.nodes
    links = b.links

    housing_points, min_h, housing_top = cap_common.build_skirt_points(b)
    housing_mesh = node_utils.revolve_profile_to_mesh(b, housing_points, b.input_socket('segments'))

    outer_radius = nodes.new('ShaderNodeMath')
    outer_radius.operation = 'ADD'
    neck_radius = nodes.new('ShaderNodeMath')
    neck_radius.operation = 'DIVIDE'
    links.new(b.input_socket('neck_diameter'), neck_radius.inputs[0])
    neck_radius.inputs[1].default_value = 2.0
    links.new(neck_radius.outputs['Value'], outer_radius.inputs[0])
    links.new(b.input_socket('wall_thickness'), outer_radius.inputs[1])

    zero = nodes.new('ShaderNodeValue')
    zero.outputs[0].default_value = 0.0
    lid_dome_r = nodes.new('ShaderNodeMath')
    lid_dome_r.operation = 'MULTIPLY'
    links.new(outer_radius.outputs['Value'], lid_dome_r.inputs[0])
    lid_dome_r.inputs[1].default_value = 0.85
    lid_wall_top = nodes.new('ShaderNodeMath')
    lid_wall_top.operation = 'MULTIPLY'
    links.new(b.input_socket('lid_thickness'), lid_wall_top.inputs[0])
    lid_wall_top.inputs[1].default_value = 0.7
    # mostly-flat disc (straight wall for the first 70% of thickness) with only the last
    # bit tapering in -- a straight 2-point taper the full height would read as a full cone,
    # not a lid.
    lid_points = [
        (zero.outputs[0], outer_radius.outputs['Value']),
        (lid_wall_top.outputs['Value'], outer_radius.outputs['Value']),
        (b.input_socket('lid_thickness'), lid_dome_r.outputs['Value']),
    ]
    lid_mesh_raw = node_utils.revolve_profile_to_mesh(b, lid_points, b.input_socket('segments'))

    # hinge pivot: back edge of the lid's bottom rim (y = +outer_radius, z = housing_top).
    neg_outer = nodes.new('ShaderNodeMath')
    neg_outer.operation = 'MULTIPLY'
    links.new(outer_radius.outputs['Value'], neg_outer.inputs[0])
    neg_outer.inputs[1].default_value = -1.0

    to_origin = nodes.new('GeometryNodeTransform')
    to_origin_vec = nodes.new('ShaderNodeCombineXYZ')
    to_origin_vec.inputs['X'].default_value = 0.0
    links.new(neg_outer.outputs['Value'], to_origin_vec.inputs['Y'])
    to_origin_vec.inputs['Z'].default_value = 0.0
    links.new(lid_mesh_raw, to_origin.inputs['Geometry'])
    links.new(to_origin_vec.outputs['Vector'], to_origin.inputs['Translation'])

    rotate = nodes.new('GeometryNodeTransform')
    rotate_vec = nodes.new('ShaderNodeCombineXYZ')
    rotate_vec.inputs['Y'].default_value = 0.0
    rotate_vec.inputs['Z'].default_value = 0.0
    neg_angle = nodes.new('ShaderNodeMath')
    neg_angle.operation = 'MULTIPLY'
    links.new(b.input_socket('lid_open_angle'), neg_angle.inputs[0])
    neg_angle.inputs[1].default_value = -1.0
    links.new(neg_angle.outputs['Value'], rotate_vec.inputs['X'])
    links.new(to_origin.outputs['Geometry'], rotate.inputs['Geometry'])
    links.new(rotate_vec.outputs['Vector'], rotate.inputs['Rotation'])

    back_to_place = nodes.new('GeometryNodeTransform')
    back_vec = nodes.new('ShaderNodeCombineXYZ')
    back_vec.inputs['X'].default_value = 0.0
    links.new(outer_radius.outputs['Value'], back_vec.inputs['Y'])
    links.new(housing_top, back_vec.inputs['Z'])
    links.new(rotate.outputs['Geometry'], back_to_place.inputs['Geometry'])
    links.new(back_vec.outputs['Vector'], back_to_place.inputs['Translation'])

    join = nodes.new('GeometryNodeJoinGeometry')
    links.new(housing_mesh, join.inputs['Geometry'])
    links.new(back_to_place.outputs['Geometry'], join.inputs['Geometry'])
    mesh_socket = join.outputs['Geometry']

    lid_top = nodes.new('ShaderNodeMath')
    lid_top.operation = 'ADD'
    links.new(housing_top, lid_top.inputs[0])
    links.new(b.input_socket('lid_thickness'), lid_top.inputs[1])

    mesh_socket = node_utils.store_cylindrical_uv(b, mesh_socket, min_h, lid_top.outputs['Value'])
    final = node_utils.apply_clean_shading(b, mesh_socket)
    b.finalize(final)

    return b


class PACKAGING_OT_add_cap_flip_top(bpy.types.Operator):
    bl_idname = 'object.packaging_add_cap_flip_top'
    bl_label = 'Flip-Top Cap'
    bl_description = ('Add a procedural flip-top cap (Geometry Nodes). If a packaging body '
                       'is the active object, the cap is auto-linked and seated on its neck.')
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        body_obj = context.active_object
        has_body = (body_obj is not None
                    and body_obj.get(properties.PKG_SHAPE_TYPE_KEY) in properties.BODY_SHAPE_TYPES
                    and properties.PKG_SOCKET_IDS_KEY in body_obj)

        b = build_node_group('PKG_CapFlipTop')

        mesh = bpy.data.meshes.new('CapFlipTop')
        obj = bpy.data.objects.new('CapFlipTop', mesh)
        context.collection.objects.link(obj)

        mod = obj.modifiers.new('Packaging', 'NODES')
        mod.node_group = b.tree

        obj[properties.PKG_SHAPE_TYPE_KEY] = 'cap_flip_top'
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
            sync.link_cap_to_body(obj, body_obj, properties.CAP_SYNC_KEY_PAIRS['cap_flip_top'])

        for other in context.view_layer.objects:
            other.select_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj

        bpy.ops.object.shade_auto_smooth()

        return {'FINISHED'}


def register():
    bpy.utils.register_class(PACKAGING_OT_add_cap_flip_top)


def unregister():
    bpy.utils.unregister_class(PACKAGING_OT_add_cap_flip_top)
