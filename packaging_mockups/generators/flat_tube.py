"""Flat/oval tube generator: round_tube's exact profile pipeline, non-uniformly scaled on
X to flatten the cross-section into an ellipse (an oval squeeze-tube silhouette) -- proves
the toolkit's revolve pipeline is reusable via a simple post-transform, not a rewrite.
"""

import json

import bpy

from .. import node_utils
from .. import shading_materials
from .. import properties


def build_node_group(name):
    b = node_utils.GNTreeBuilder(name)

    b.add_socket('Depth Diameter', 'INPUT', 'NodeSocketFloat', key='body_diameter',
                 default=35.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Width To Depth Ratio', 'INPUT', 'NodeSocketFloat', key='width_to_depth_ratio',
                 default=1.8, min_value=1.0, max_value=4.0, subtype='FACTOR')
    b.add_socket('Body Height', 'INPUT', 'NodeSocketFloat', key='body_height',
                 default=90.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Shoulder Height', 'INPUT', 'NodeSocketFloat', key='shoulder_height',
                 default=12.0, min_value=0.0, subtype='DISTANCE')
    b.add_socket('Neck Diameter', 'INPUT', 'NodeSocketFloat', key='neck_diameter',
                 default=18.0, min_value=1.0, subtype='DISTANCE')
    b.add_socket('Neck Height', 'INPUT', 'NodeSocketFloat', key='neck_height',
                 default=8.0, min_value=0.0, subtype='DISTANCE')
    b.add_socket('Segments', 'INPUT', 'NodeSocketInt', key='segments', default=32, min_value=3)
    b.add_socket('Label Band Start', 'INPUT', 'NodeSocketFloat', key='label_band_start',
                 default=0.15, min_value=0.0, max_value=1.0, subtype='FACTOR')
    b.add_socket('Label Band End', 'INPUT', 'NodeSocketFloat', key='label_band_end',
                 default=0.65, min_value=0.0, max_value=1.0, subtype='FACTOR')

    nodes = b.nodes
    links = b.links

    body_radius = nodes.new('ShaderNodeMath')
    body_radius.operation = 'DIVIDE'
    links.new(b.input_socket('body_diameter'), body_radius.inputs[0])
    body_radius.inputs[1].default_value = 2.0

    neck_radius = nodes.new('ShaderNodeMath')
    neck_radius.operation = 'DIVIDE'
    links.new(b.input_socket('neck_diameter'), neck_radius.inputs[0])
    neck_radius.inputs[1].default_value = 2.0

    wall_top = nodes.new('ShaderNodeMath')
    wall_top.operation = 'SUBTRACT'
    links.new(b.input_socket('body_height'), wall_top.inputs[0])
    links.new(b.input_socket('shoulder_height'), wall_top.inputs[1])

    neck_top = nodes.new('ShaderNodeMath')
    neck_top.operation = 'ADD'
    links.new(b.input_socket('body_height'), neck_top.inputs[0])
    links.new(b.input_socket('neck_height'), neck_top.inputs[1])

    zero = nodes.new('ShaderNodeValue')
    zero.outputs[0].default_value = 0.0

    points = [
        (zero.outputs[0], body_radius.outputs['Value']),
        (wall_top.outputs['Value'], body_radius.outputs['Value']),
        (b.input_socket('body_height'), neck_radius.outputs['Value']),
        (neck_top.outputs['Value'], neck_radius.outputs['Value']),
    ]

    mesh_socket = node_utils.revolve_profile_to_mesh(b, points, b.input_socket('segments'))

    # flatten: scale X by width_to_depth_ratio, leave Y (depth) and Z (height) untouched.
    transform = nodes.new('GeometryNodeTransform')
    combine_scale = nodes.new('ShaderNodeCombineXYZ')
    links.new(b.input_socket('width_to_depth_ratio'), combine_scale.inputs['X'])
    combine_scale.inputs['Y'].default_value = 1.0
    combine_scale.inputs['Z'].default_value = 1.0
    links.new(mesh_socket, transform.inputs['Geometry'])
    links.new(combine_scale.outputs['Vector'], transform.inputs['Scale'])
    mesh_socket = transform.outputs['Geometry']

    mesh_socket = node_utils.store_cylindrical_uv(b, mesh_socket, zero.outputs[0], neck_top.outputs['Value'])

    position = nodes.new('GeometryNodeInputPosition')
    separate = nodes.new('ShaderNodeSeparateXYZ')
    links.new(position.outputs['Position'], separate.inputs['Vector'])

    band_start_h = nodes.new('ShaderNodeMath')
    band_start_h.operation = 'MULTIPLY'
    links.new(wall_top.outputs['Value'], band_start_h.inputs[0])
    links.new(b.input_socket('label_band_start'), band_start_h.inputs[1])

    band_end_h = nodes.new('ShaderNodeMath')
    band_end_h.operation = 'MULTIPLY'
    links.new(wall_top.outputs['Value'], band_end_h.inputs[0])
    links.new(b.input_socket('label_band_end'), band_end_h.inputs[1])

    above_start = nodes.new('ShaderNodeMath')
    above_start.operation = 'GREATER_THAN'
    links.new(separate.outputs['Z'], above_start.inputs[0])
    links.new(band_start_h.outputs['Value'], above_start.inputs[1])

    below_end = nodes.new('ShaderNodeMath')
    below_end.operation = 'LESS_THAN'
    links.new(separate.outputs['Z'], below_end.inputs[0])
    links.new(band_end_h.outputs['Value'], below_end.inputs[1])

    in_band = nodes.new('ShaderNodeMath')
    in_band.operation = 'MULTIPLY'
    links.new(above_start.outputs['Value'], in_band.inputs[0])
    links.new(below_end.outputs['Value'], in_band.inputs[1])

    store_matidx = nodes.new('GeometryNodeStoreNamedAttribute')
    store_matidx.data_type = 'INT'
    store_matidx.domain = 'FACE'
    store_matidx.inputs['Name'].default_value = 'material_index'
    links.new(mesh_socket, store_matidx.inputs['Geometry'])
    links.new(in_band.outputs['Value'], store_matidx.inputs['Value'])
    mesh_socket = store_matidx.outputs['Geometry']

    final = node_utils.apply_clean_shading(b, mesh_socket)
    b.finalize(final)

    return b


class PACKAGING_OT_add_flat_tube(bpy.types.Operator):
    bl_idname = 'object.packaging_add_flat_tube'
    bl_label = 'Flat Tube'
    bl_description = 'Add a procedural flat/oval tube body (Geometry Nodes)'
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        b = build_node_group('PKG_FlatTube')

        mesh = bpy.data.meshes.new('FlatTube')
        obj = bpy.data.objects.new('FlatTube', mesh)
        context.collection.objects.link(obj)

        mod = obj.modifiers.new('Packaging', 'NODES')
        mod.node_group = b.tree

        obj[properties.PKG_SHAPE_TYPE_KEY] = 'flat_tube'
        obj[properties.PKG_SOCKET_IDS_KEY] = json.dumps(b.socket_ids)

        shading_materials.assign_material_slots(obj, ('Body', 'Label'))

        for other in context.view_layer.objects:
            other.select_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj

        bpy.ops.object.shade_auto_smooth()

        return {'FINISHED'}


def register():
    bpy.utils.register_class(PACKAGING_OT_add_flat_tube)


def unregister():
    bpy.utils.unregister_class(PACKAGING_OT_add_flat_tube)
