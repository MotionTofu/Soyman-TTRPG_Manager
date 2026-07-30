"""Spray cap generator: pump-like housing + stem + actuator button, plus a horizontal
nozzle -- the nozzle is built as a normal vertical revolve then rotated 90 degrees and
translated into place, the fiddliest join/pivot case among the caps.
"""

import json

import bpy

from .. import node_utils
from .. import shading_materials
from .. import properties
from .. import sync
from . import cap_common


def _translated(builder, mesh_socket, offset_vec_socket):
    nodes = builder.nodes
    links = builder.links
    transform = nodes.new('GeometryNodeTransform')
    links.new(mesh_socket, transform.inputs['Geometry'])
    links.new(offset_vec_socket, transform.inputs['Translation'])
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
                 default=18.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Actuator Diameter', 'INPUT', 'NodeSocketFloat', key='actuator_diameter',
                 default=16.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Actuator Height', 'INPUT', 'NodeSocketFloat', key='actuator_height',
                 default=8.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Nozzle Length', 'INPUT', 'NodeSocketFloat', key='nozzle_length',
                 default=10.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Nozzle Diameter', 'INPUT', 'NodeSocketFloat', key='nozzle_diameter',
                 default=4.0, min_value=0.5, subtype='DISTANCE')
    b.add_socket('Segments', 'INPUT', 'NodeSocketInt', key='segments', default=16, min_value=3)

    nodes = b.nodes
    links = b.links

    housing_points, min_h, housing_top = cap_common.build_skirt_points(b)
    housing_mesh = node_utils.revolve_profile_to_mesh(b, housing_points, b.input_socket('segments'))

    zero = nodes.new('ShaderNodeValue')
    zero.outputs[0].default_value = 0.0

    stem_radius = nodes.new('ShaderNodeMath')
    stem_radius.operation = 'MULTIPLY'
    links.new(b.input_socket('actuator_diameter'), stem_radius.inputs[0])
    stem_radius.inputs[1].default_value = 0.15
    stem_points = [
        (zero.outputs[0], stem_radius.outputs['Value']),
        (b.input_socket('stem_height'), stem_radius.outputs['Value']),
    ]
    stem_mesh_raw = node_utils.revolve_profile_to_mesh(b, stem_points, b.input_socket('segments'))
    stem_vec = nodes.new('ShaderNodeCombineXYZ')
    stem_vec.inputs['X'].default_value = 0.0
    stem_vec.inputs['Y'].default_value = 0.0
    links.new(b.input_socket('skirt_height'), stem_vec.inputs['Z'])
    stem_mesh = _translated(b, stem_mesh_raw, stem_vec.outputs['Vector'])

    stem_top = nodes.new('ShaderNodeMath')
    stem_top.operation = 'ADD'
    links.new(b.input_socket('skirt_height'), stem_top.inputs[0])
    links.new(b.input_socket('stem_height'), stem_top.inputs[1])

    actuator_radius = nodes.new('ShaderNodeMath')
    actuator_radius.operation = 'DIVIDE'
    links.new(b.input_socket('actuator_diameter'), actuator_radius.inputs[0])
    actuator_radius.inputs[1].default_value = 2.0
    actuator_points = [
        (zero.outputs[0], stem_radius.outputs['Value']),
        (b.input_socket('actuator_height'), actuator_radius.outputs['Value']),
    ]
    actuator_mesh_raw = node_utils.revolve_profile_to_mesh(b, actuator_points, b.input_socket('segments'))
    actuator_vec = nodes.new('ShaderNodeCombineXYZ')
    actuator_vec.inputs['X'].default_value = 0.0
    actuator_vec.inputs['Y'].default_value = 0.0
    links.new(stem_top.outputs['Value'], actuator_vec.inputs['Z'])
    actuator_mesh = _translated(b, actuator_mesh_raw, actuator_vec.outputs['Vector'])

    # nozzle: build vertical, rotate 90 deg around Y so it points along +X, then move to the
    # actuator's mid-height and forward by half its own length plus the actuator radius.
    nozzle_radius = nodes.new('ShaderNodeMath')
    nozzle_radius.operation = 'DIVIDE'
    links.new(b.input_socket('nozzle_diameter'), nozzle_radius.inputs[0])
    nozzle_radius.inputs[1].default_value = 2.0
    nozzle_points = [
        (zero.outputs[0], nozzle_radius.outputs['Value']),
        (b.input_socket('nozzle_length'), nozzle_radius.outputs['Value']),
    ]
    nozzle_mesh_raw = node_utils.revolve_profile_to_mesh(b, nozzle_points, b.input_socket('segments'))

    rotate_y90 = nodes.new('GeometryNodeTransform')
    rotate_vec = nodes.new('ShaderNodeCombineXYZ')
    rotate_vec.inputs['X'].default_value = 0.0
    rotate_vec.inputs['Y'].default_value = 1.5707963
    rotate_vec.inputs['Z'].default_value = 0.0
    links.new(nozzle_mesh_raw, rotate_y90.inputs['Geometry'])
    links.new(rotate_vec.outputs['Vector'], rotate_y90.inputs['Rotation'])

    actuator_mid = nodes.new('ShaderNodeMath')
    actuator_mid.operation = 'MULTIPLY'
    links.new(b.input_socket('actuator_height'), actuator_mid.inputs[0])
    actuator_mid.inputs[1].default_value = 0.6
    nozzle_z = nodes.new('ShaderNodeMath')
    nozzle_z.operation = 'ADD'
    links.new(stem_top.outputs['Value'], nozzle_z.inputs[0])
    links.new(actuator_mid.outputs['Value'], nozzle_z.inputs[1])

    nozzle_vec = nodes.new('ShaderNodeCombineXYZ')
    links.new(actuator_radius.outputs['Value'], nozzle_vec.inputs['X'])
    nozzle_vec.inputs['Y'].default_value = 0.0
    links.new(nozzle_z.outputs['Value'], nozzle_vec.inputs['Z'])
    nozzle_mesh = _translated(b, rotate_y90.outputs['Geometry'], nozzle_vec.outputs['Vector'])

    join = nodes.new('GeometryNodeJoinGeometry')
    links.new(housing_mesh, join.inputs['Geometry'])
    links.new(stem_mesh, join.inputs['Geometry'])
    links.new(actuator_mesh, join.inputs['Geometry'])
    links.new(nozzle_mesh, join.inputs['Geometry'])
    mesh_socket = join.outputs['Geometry']

    top_total = nodes.new('ShaderNodeMath')
    top_total.operation = 'ADD'
    links.new(stem_top.outputs['Value'], top_total.inputs[0])
    links.new(b.input_socket('actuator_height'), top_total.inputs[1])

    mesh_socket = node_utils.store_cylindrical_uv(b, mesh_socket, min_h, top_total.outputs['Value'])
    final = node_utils.apply_clean_shading(b, mesh_socket)
    b.finalize(final)

    return b


class PACKAGING_OT_add_cap_spray(bpy.types.Operator):
    bl_idname = 'object.packaging_add_cap_spray'
    bl_label = 'Spray Cap'
    bl_description = ('Add a procedural spray cap (Geometry Nodes). If a packaging body is '
                       'the active object, the cap is auto-linked and seated on its neck.')
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        body_obj = context.active_object
        has_body = (body_obj is not None
                    and body_obj.get(properties.PKG_SHAPE_TYPE_KEY) in properties.BODY_SHAPE_TYPES
                    and properties.PKG_SOCKET_IDS_KEY in body_obj)

        b = build_node_group('PKG_CapSpray')

        mesh = bpy.data.meshes.new('CapSpray')
        obj = bpy.data.objects.new('CapSpray', mesh)
        context.collection.objects.link(obj)

        mod = obj.modifiers.new('Packaging', 'NODES')
        mod.node_group = b.tree

        obj[properties.PKG_SHAPE_TYPE_KEY] = 'cap_spray'
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
            sync.link_cap_to_body(obj, body_obj, properties.CAP_SYNC_KEY_PAIRS['cap_spray'])

        for other in context.view_layer.objects:
            other.select_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj

        bpy.ops.object.shade_auto_smooth()

        return {'FINISHED'}


def register():
    bpy.utils.register_class(PACKAGING_OT_add_cap_spray)


def unregister():
    bpy.utils.unregister_class(PACKAGING_OT_add_cap_spray)
