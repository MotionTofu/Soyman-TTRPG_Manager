"""Shared cap-skirt profile builder, reused by every cap crown type.

A solid (non-hollow) capped cylinder is enough for a render-only mockup -- a cap's
underside is never visible once it's seated on a neck, so there's no need to model real
wall thickness/interior geometry, only the outer silhouette.
"""

from .. import node_utils


def build_skirt_points(builder, neck_diameter_key='neck_diameter', wall_thickness_key='wall_thickness',
                        skirt_height_key='skirt_height', top_dome_key='top_dome_height'):
    """`builder` must already have INPUT sockets registered under the given keys.

    Returns (points, min_height_socket, max_height_socket): `points` is a list of
    (height_socket, radius_socket) ascending by height -- open rim at height 0, straight
    skirt wall up to `skirt_height`, then a rounded top tapering to a small (not zero, to
    avoid a pinched pole) radius over `top_dome_height`.
    """
    nodes = builder.nodes
    links = builder.links

    neck_radius = nodes.new('ShaderNodeMath')
    neck_radius.operation = 'DIVIDE'
    links.new(builder.input_socket(neck_diameter_key), neck_radius.inputs[0])
    neck_radius.inputs[1].default_value = 2.0

    outer_radius = nodes.new('ShaderNodeMath')
    outer_radius.operation = 'ADD'
    links.new(neck_radius.outputs['Value'], outer_radius.inputs[0])
    links.new(builder.input_socket(wall_thickness_key), outer_radius.inputs[1])

    zero = nodes.new('ShaderNodeValue')
    zero.outputs[0].default_value = 0.0

    dome_top = nodes.new('ShaderNodeMath')
    dome_top.operation = 'ADD'
    links.new(builder.input_socket(skirt_height_key), dome_top.inputs[0])
    links.new(builder.input_socket(top_dome_key), dome_top.inputs[1])

    small_radius = nodes.new('ShaderNodeMath')
    small_radius.operation = 'MULTIPLY'
    links.new(outer_radius.outputs['Value'], small_radius.inputs[0])
    small_radius.inputs[1].default_value = 0.15

    points = [
        (zero.outputs[0], outer_radius.outputs['Value']),
        (builder.input_socket(skirt_height_key), outer_radius.outputs['Value']),
        (dome_top.outputs['Value'], small_radius.outputs['Value']),
    ]
    return points, zero.outputs[0], dome_top.outputs['Value']
