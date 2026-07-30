"""Shared Geometry Nodes tree-building toolkit for the packaging generators.

Every generator builds its node tree entirely in Python at operator-run time (no bundled
template .blend). Two load-bearing facts, confirmed live against Blender 5.1.2 before this
module was written (see the plan file for the full probe transcripts):

- Modifier inputs must be read/written via the node-group interface socket's auto-generated
  `.identifier` (e.g. "Socket_0"), never its human-readable name -- `modifier["Diameter"]`
  silently creates an unrelated custom property and has no effect on the evaluated geometry.
- `GeometryNodeCurveToMesh` always sweeps its `Profile Curve` using the `Curve` input's local
  frame at each point. The `Curve` input must therefore be the axis you want geometry to
  stay *aligned with* (e.g. a vertical Z spine), and `Profile Curve` the cross-section swept
  along it -- not the other way around. This one pattern (vertical spine + swept cross
  section, with a `Scale` field driving the cross-section's size per point) covers both
  revolved bodies (circle profile) and the rounded box (filleted-rectangle profile).
"""

import bpy


class GNTreeBuilder:
    """Thin wrapper around a GeometryNodeTree that tracks interface socket identifiers.

    Socket `.identifier` values (e.g. "Socket_0") are assigned by Blender from a single
    counter shared across INPUT and OUTPUT sockets, in creation order -- they must be
    captured at creation time under a caller-chosen `key`, never re-derived from the name.
    """

    def __init__(self, name, geometry_in=True, geometry_out=True):
        self.tree = bpy.data.node_groups.new(name, 'GeometryNodeTree')
        self.nodes = self.tree.nodes
        self.links = self.tree.links
        self.socket_ids = {}
        self._group_input_node = None
        self._group_output_node = None

        if geometry_in:
            self.add_socket('Geometry', 'INPUT', 'NodeSocketGeometry', key='geometry_in')
        if geometry_out:
            self.add_socket('Geometry', 'OUTPUT', 'NodeSocketGeometry', key='geometry_out')

    def add_socket(self, name, in_out, socket_type, key=None,
                    default=None, min_value=None, max_value=None, subtype=None):
        socket = self.tree.interface.new_socket(name=name, in_out=in_out, socket_type=socket_type)
        if default is not None and hasattr(socket, 'default_value'):
            socket.default_value = default
        if min_value is not None and hasattr(socket, 'min_value'):
            socket.min_value = min_value
        if max_value is not None and hasattr(socket, 'max_value'):
            socket.max_value = max_value
        if subtype is not None and hasattr(socket, 'subtype'):
            socket.subtype = subtype
        self.socket_ids[key or name] = socket.identifier
        return socket.identifier

    def link(self, from_socket, to_socket):
        return self.links.new(from_socket, to_socket)

    @property
    def group_input(self):
        if self._group_input_node is None:
            self._group_input_node = self.nodes.new('NodeGroupInput')
        return self._group_input_node

    @property
    def group_output(self):
        if self._group_output_node is None:
            self._group_output_node = self.nodes.new('NodeGroupOutput')
        return self._group_output_node

    def input_socket(self, key):
        """The NodeGroupInput node's output socket for the interface INPUT registered under `key`."""
        identifier = self.socket_ids[key]
        for out in self.group_input.outputs:
            if out.identifier == identifier:
                return out
        raise KeyError(f'No group input socket for key {key!r}')

    def output_socket(self, key):
        """The NodeGroupOutput node's input socket for the interface OUTPUT registered under `key`."""
        identifier = self.socket_ids[key]
        for inp in self.group_output.inputs:
            if inp.identifier == identifier:
                return inp
        raise KeyError(f'No group output socket for key {key!r}')

    def finalize(self, final_geometry_socket, key='geometry_out'):
        self.link(final_geometry_socket, self.output_socket(key))


def _z_only_vector(builder, z_socket):
    combine = builder.nodes.new('ShaderNodeCombineXYZ')
    combine.inputs['X'].default_value = 0.0
    combine.inputs['Y'].default_value = 0.0
    builder.link(z_socket, combine.inputs['Z'])
    return combine.outputs['Vector']


def _piecewise_linear_ramp(builder, x_field_socket, points):
    """Build a float field: y as a piecewise-linear function of `x_field_socket`.

    `points`: list of (x_socket, y_socket) node output sockets, ascending by x (the caller
    guarantees monotonic x at evaluation time -- e.g. cumulative height offsets that stay
    positive). Uses the standard shader-graph ramp trick: accumulate, per segment, a Map
    Range (clamped) that contributes 0 outside its own [x_i, x_i+1] range and the full
    delta-y inside it -- so segments stitch into one continuous piecewise-linear curve
    without any branching/switch nodes.
    """
    nodes = builder.nodes
    links = builder.links

    _base_x, base_y = points[0]
    accum_socket = base_y

    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        delta = nodes.new('ShaderNodeMath')
        delta.operation = 'SUBTRACT'
        links.new(y1, delta.inputs[0])
        links.new(y0, delta.inputs[1])

        map_range = nodes.new('ShaderNodeMapRange')
        map_range.clamp = True
        map_range.inputs['To Min'].default_value = 0.0
        links.new(x0, map_range.inputs['From Min'])
        links.new(x1, map_range.inputs['From Max'])
        links.new(delta.outputs['Value'], map_range.inputs['To Max'])
        links.new(x_field_socket, map_range.inputs['Value'])

        add_node = nodes.new('ShaderNodeMath')
        add_node.operation = 'ADD'
        links.new(accum_socket, add_node.inputs[0])
        links.new(map_range.outputs['Result'], add_node.inputs[1])
        accum_socket = add_node.outputs[0]

    return accum_socket


def build_profile_polyline(builder, points, resample_count=64):
    """Build a vertical Z spine plus a radius field interpolated through `points`.

    `points`: list of (height_socket, radius_socket), ascending by height.
    Returns (spine_curve_socket, radius_field_socket). `radius_field_socket` only resolves
    to real numbers once connected somewhere that evaluates per-point Position -- e.g. wired
    into `revolve_profile_to_mesh`'s Scale input.
    """
    nodes = builder.nodes
    links = builder.links

    top_height_socket = points[-1][0]

    spine_line = nodes.new('GeometryNodeCurvePrimitiveLine')
    spine_line.mode = 'POINTS'
    spine_line.inputs['Start'].default_value = (0.0, 0.0, 0.0)
    links.new(_z_only_vector(builder, top_height_socket), spine_line.inputs['End'])

    resample = nodes.new('GeometryNodeResampleCurve')
    resample.inputs['Mode'].default_value = 'Count'  # NodeSocketMenu, not a node property
    resample.inputs['Count'].default_value = resample_count
    links.new(spine_line.outputs['Curve'], resample.inputs['Curve'])

    position = nodes.new('GeometryNodeInputPosition')
    separate = nodes.new('ShaderNodeSeparateXYZ')
    links.new(position.outputs['Position'], separate.inputs['Vector'])
    height_field = separate.outputs['Z']

    radius_field = _piecewise_linear_ramp(builder, height_field, points)

    return resample.outputs['Curve'], radius_field


def revolve_profile_to_mesh(builder, points, segments_socket, resample_count=64, fill_caps=True):
    """Revolve a (height, radius) profile around Z into a mesh.

    `points`: list of (height_socket, radius_socket), ascending by height.
    `segments_socket`: int socket controlling the circle's Resolution (revolve segment count).
    Returns the resulting Mesh geometry socket.
    """
    nodes = builder.nodes
    links = builder.links

    spine_socket, radius_field = build_profile_polyline(builder, points, resample_count=resample_count)

    circle = nodes.new('GeometryNodeCurvePrimitiveCircle')
    circle.inputs['Radius'].default_value = 1.0
    links.new(segments_socket, circle.inputs['Resolution'])

    curve_to_mesh = nodes.new('GeometryNodeCurveToMesh')
    curve_to_mesh.inputs['Fill Caps'].default_value = fill_caps
    links.new(spine_socket, curve_to_mesh.inputs['Curve'])
    links.new(circle.outputs['Curve'], curve_to_mesh.inputs['Profile Curve'])
    links.new(radius_field, curve_to_mesh.inputs['Scale'])

    return curve_to_mesh.outputs['Mesh']


def build_rounded_box(builder, width_socket, depth_socket, height_socket,
                       corner_radius_socket, corner_segments_socket):
    """A vertically-extruded rounded rectangle (no mesh-domain bevel node exists in 5.1.2,
    confirmed live -- this manual sweep is the fallback, and guarantees quad topology anyway).

    Curve = vertical Z spine, Profile Curve = filleted rectangle. Swapping these two roles,
    the more intuitive-looking option, was tested live and produces a flat, wrong result --
    CurveToMesh always orients the Profile using the Curve's own local frame, so the swept
    shape must be the one whose orientation should stay constant (the spine), not the one
    tracing the footprint.
    """
    nodes = builder.nodes
    links = builder.links

    rect = nodes.new('GeometryNodeCurvePrimitiveQuadrilateral')
    rect.mode = 'RECTANGLE'
    links.new(width_socket, rect.inputs['Width'])
    links.new(depth_socket, rect.inputs['Height'])

    fillet = nodes.new('GeometryNodeFilletCurve')
    fillet.inputs['Mode'].default_value = 'Poly'  # NodeSocketMenu; exact valid strings are 'Poly' / 'Bézier'
    fillet.inputs['Limit Radius'].default_value = True
    links.new(corner_radius_socket, fillet.inputs['Radius'])
    links.new(corner_segments_socket, fillet.inputs['Count'])
    links.new(rect.outputs['Curve'], fillet.inputs['Curve'])

    spine = nodes.new('GeometryNodeCurvePrimitiveLine')
    spine.mode = 'POINTS'
    spine.inputs['Start'].default_value = (0.0, 0.0, 0.0)
    links.new(_z_only_vector(builder, height_socket), spine.inputs['End'])

    curve_to_mesh = nodes.new('GeometryNodeCurveToMesh')
    curve_to_mesh.inputs['Fill Caps'].default_value = True
    curve_to_mesh.inputs['Scale'].default_value = 1.0
    links.new(spine.outputs['Curve'], curve_to_mesh.inputs['Curve'])
    links.new(fillet.outputs['Curve'], curve_to_mesh.inputs['Profile Curve'])

    return curve_to_mesh.outputs['Mesh']


def store_cylindrical_uv(builder, mesh_socket, min_height_socket, max_height_socket, uv_name='UVMap'):
    """Cylindrical UV: U = angle around Z (0-1), V = height fraction (0-1).

    Stored as a real FLOAT2/CORNER attribute (confirmed live -- NOT 'VECTOR', which does not
    produce a usable mesh.uv_layers entry) so Cycles/Eevee shading and label textures read it
    directly. Note: a cylindrical wrap always has a U=0/1 seam by construction -- expected and
    generally acceptable for a bottle/tube label wrap, not a bug to fix here.
    """
    nodes = builder.nodes
    links = builder.links

    position = nodes.new('GeometryNodeInputPosition')
    separate = nodes.new('ShaderNodeSeparateXYZ')
    links.new(position.outputs['Position'], separate.inputs['Vector'])

    atan2 = nodes.new('ShaderNodeMath')
    atan2.operation = 'ARCTAN2'
    links.new(separate.outputs['Y'], atan2.inputs[0])
    links.new(separate.outputs['X'], atan2.inputs[1])

    u_map = nodes.new('ShaderNodeMapRange')
    u_map.inputs['From Min'].default_value = -3.14159265
    u_map.inputs['From Max'].default_value = 3.14159265
    u_map.inputs['To Min'].default_value = 0.0
    u_map.inputs['To Max'].default_value = 1.0
    links.new(atan2.outputs['Value'], u_map.inputs['Value'])

    v_map = nodes.new('ShaderNodeMapRange')
    v_map.clamp = True
    v_map.inputs['To Min'].default_value = 0.0
    v_map.inputs['To Max'].default_value = 1.0
    links.new(min_height_socket, v_map.inputs['From Min'])
    links.new(max_height_socket, v_map.inputs['From Max'])
    links.new(separate.outputs['Z'], v_map.inputs['Value'])

    combine_uv = nodes.new('ShaderNodeCombineXYZ')
    links.new(u_map.outputs['Result'], combine_uv.inputs['X'])
    links.new(v_map.outputs['Result'], combine_uv.inputs['Y'])

    store = nodes.new('GeometryNodeStoreNamedAttribute')
    store.data_type = 'FLOAT2'
    store.domain = 'CORNER'
    store.inputs['Name'].default_value = uv_name
    links.new(mesh_socket, store.inputs['Geometry'])
    links.new(combine_uv.outputs['Vector'], store.inputs['Value'])

    return store.outputs['Geometry']


def store_planar_box_uv(builder, mesh_socket, uv_name='UVMap'):
    """Per-face dominant-axis (box) UV projection, so each of the 6 box faces gets an
    undistorted planar unwrap instead of one shared projection stretching side faces.
    """
    nodes = builder.nodes
    links = builder.links

    normal = nodes.new('GeometryNodeInputNormal')
    abs_n = nodes.new('ShaderNodeSeparateXYZ')
    links.new(normal.outputs['Normal'], abs_n.inputs['Vector'])

    def abs_of(socket):
        m = nodes.new('ShaderNodeMath')
        m.operation = 'ABSOLUTE'
        links.new(socket, m.inputs[0])
        return m.outputs['Value']

    abs_x, abs_y, abs_z = abs_of(abs_n.outputs['X']), abs_of(abs_n.outputs['Y']), abs_of(abs_n.outputs['Z'])

    def compare_ge(a, b):
        c = nodes.new('ShaderNodeMath')
        c.operation = 'GREATER_THAN'
        links.new(a, c.inputs[0])
        links.new(b, c.inputs[1])
        return c.outputs['Value']

    x_dominant = compare_ge(abs_x, abs_y)  # placeholder combined below with abs_z compare
    x_ge_z = compare_ge(abs_x, abs_z)
    x_and = nodes.new('ShaderNodeMath')
    x_and.operation = 'MULTIPLY'
    links.new(x_dominant, x_and.inputs[0])
    links.new(x_ge_z, x_and.inputs[1])
    x_is_dominant = x_and.outputs['Value']

    y_ge_z = compare_ge(abs_y, abs_z)
    not_x = nodes.new('ShaderNodeMath')
    not_x.operation = 'SUBTRACT'
    not_x.inputs[0].default_value = 1.0
    links.new(x_is_dominant, not_x.inputs[1])
    y_and = nodes.new('ShaderNodeMath')
    y_and.operation = 'MULTIPLY'
    links.new(not_x.outputs['Value'], y_and.inputs[0])
    links.new(y_ge_z, y_and.inputs[1])
    y_is_dominant = y_and.outputs['Value']

    position = nodes.new('GeometryNodeInputPosition')
    pos_xyz = nodes.new('ShaderNodeSeparateXYZ')
    links.new(position.outputs['Position'], pos_xyz.inputs['Vector'])

    def switch_float(cond_socket, false_socket, true_socket):
        sw = nodes.new('GeometryNodeSwitch')
        sw.input_type = 'FLOAT'
        links.new(cond_socket, sw.inputs['Switch'])
        links.new(false_socket, sw.inputs['False'])
        links.new(true_socket, sw.inputs['True'])
        return sw.outputs['Output']

    # x-dominant face: U=Y, V=Z. y-dominant: U=X, V=Z. z-dominant (else): U=X, V=Y.
    u_not_x = switch_float(y_is_dominant, pos_xyz.outputs['X'], pos_xyz.outputs['X'])
    u = switch_float(x_is_dominant, u_not_x, pos_xyz.outputs['Y'])
    v_not_x = switch_float(y_is_dominant, pos_xyz.outputs['Y'], pos_xyz.outputs['Z'])
    v = switch_float(x_is_dominant, v_not_x, pos_xyz.outputs['Z'])

    combine_uv = nodes.new('ShaderNodeCombineXYZ')
    links.new(u, combine_uv.inputs['X'])
    links.new(v, combine_uv.inputs['Y'])

    store = nodes.new('GeometryNodeStoreNamedAttribute')
    store.data_type = 'FLOAT2'
    store.domain = 'CORNER'
    store.inputs['Name'].default_value = uv_name
    links.new(mesh_socket, store.inputs['Geometry'])
    links.new(combine_uv.outputs['Vector'], store.inputs['Value'])

    return store.outputs['Geometry']


def apply_clean_shading(builder, mesh_socket, sharp_selection_socket=None, domain='FACE'):
    """Shade everything smooth, then flip a given selection (if any) back to flat.

    A flat/smooth face discontinuity reads as a hard edge in render without needing a
    separate sharp-edge attribute -- e.g. flag a cap's flat end faces flat while its
    cylindrical wall stays smooth, and the boundary between them looks crisp.
    """
    nodes = builder.nodes
    links = builder.links

    smooth_all = nodes.new('GeometryNodeSetShadeSmooth')
    smooth_all.domain = domain
    smooth_all.inputs['Shade Smooth'].default_value = True
    links.new(mesh_socket, smooth_all.inputs['Mesh'])
    out_socket = smooth_all.outputs['Mesh']

    if sharp_selection_socket is not None:
        flat_selected = nodes.new('GeometryNodeSetShadeSmooth')
        flat_selected.domain = domain
        flat_selected.inputs['Shade Smooth'].default_value = False
        links.new(out_socket, flat_selected.inputs['Mesh'])
        links.new(sharp_selection_socket, flat_selected.inputs['Selection'])
        out_socket = flat_selected.outputs['Mesh']

    return out_socket
