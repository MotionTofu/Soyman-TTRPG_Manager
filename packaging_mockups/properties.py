"""Custom-property keys and per-shape-type parameter metadata (plain constants).

`pkg_socket_ids` lets the N-panel and the sync mechanism look up a modifier's real socket
identifiers (e.g. "Socket_0") without re-walking the node tree interface every draw call --
identifiers are captured once at generation time (see node_utils.GNTreeBuilder) and stored
as JSON on the object.
"""

PKG_SHAPE_TYPE_KEY = 'pkg_shape_type'
PKG_SOCKET_IDS_KEY = 'pkg_socket_ids'
PKG_SYNC_SOURCE_KEY = 'pkg_sync_source'  # on a cap object: name of the body object it's linked to

BODY_SHAPE_TYPES = {'round_tube', 'flat_tube', 'bottle', 'box'}
CAP_SHAPE_TYPES = {'cap_screw', 'cap_flip_top', 'cap_pump', 'cap_dropper', 'cap_spray'}

# key order here is also the N-panel's draw order.
ROUND_TUBE_PARAMS = [
    ('body_diameter', 'Body Diameter'),
    ('body_height', 'Body Height'),
    ('shoulder_height', 'Shoulder Height'),
    ('neck_diameter', 'Neck Diameter'),
    ('neck_height', 'Neck Height'),
    ('segments', 'Segments'),
    ('label_band_start', 'Label Start'),
    ('label_band_end', 'Label End'),
]

BOTTLE_PARAMS = [
    ('body_diameter', 'Body Diameter'),
    ('body_height', 'Body Height'),
    ('shoulder_height', 'Shoulder Height'),
    ('shoulder_curve_bias', 'Shoulder Curve Bias'),
    ('neck_diameter', 'Neck Diameter'),
    ('neck_height', 'Neck Height'),
    ('segments', 'Segments'),
    ('label_band_start', 'Label Start'),
    ('label_band_end', 'Label End'),
]

FLAT_TUBE_PARAMS = [
    ('body_diameter', 'Depth Diameter'),
    ('width_to_depth_ratio', 'Width To Depth Ratio'),
    ('body_height', 'Body Height'),
    ('shoulder_height', 'Shoulder Height'),
    ('neck_diameter', 'Neck Diameter'),
    ('neck_height', 'Neck Height'),
    ('segments', 'Segments'),
    ('label_band_start', 'Label Start'),
    ('label_band_end', 'Label End'),
]

BOX_PARAMS = [
    ('width', 'Width'),
    ('depth', 'Depth'),
    ('height', 'Height'),
    ('corner_radius', 'Corner Radius'),
    ('corner_segments', 'Corner Segments'),
]

CAP_SCREW_PARAMS = [
    ('neck_diameter', 'Neck Diameter'),
    ('wall_thickness', 'Wall Thickness'),
    ('skirt_height', 'Skirt Height'),
    ('top_dome_height', 'Top Dome Height'),
    ('segments', 'Segments'),
]

CAP_DROPPER_PARAMS = [
    ('neck_diameter', 'Neck Diameter'),
    ('wall_thickness', 'Wall Thickness'),
    ('skirt_height', 'Skirt Height'),
    ('top_dome_height', 'Skirt Top Dome'),
    ('bulb_height', 'Bulb Height'),
    ('bulb_bulge_factor', 'Bulb Bulge Factor'),
    ('segments', 'Segments'),
]

CAP_PUMP_PARAMS = [
    ('neck_diameter', 'Neck Diameter'),
    ('wall_thickness', 'Wall Thickness'),
    ('skirt_height', 'Housing Height'),
    ('top_dome_height', 'Housing Top'),
    ('stem_height', 'Stem Height'),
    ('stem_diameter', 'Stem Diameter'),
    ('head_height', 'Head Height'),
    ('head_diameter', 'Head Diameter'),
    ('segments', 'Segments'),
]

CAP_FLIP_TOP_PARAMS = [
    ('neck_diameter', 'Neck Diameter'),
    ('wall_thickness', 'Wall Thickness'),
    ('skirt_height', 'Housing Height'),
    ('top_dome_height', 'Housing Top'),
    ('lid_thickness', 'Lid Thickness'),
    ('lid_open_angle', 'Lid Open Angle'),
    ('segments', 'Segments'),
]

CAP_SPRAY_PARAMS = [
    ('neck_diameter', 'Neck Diameter'),
    ('wall_thickness', 'Wall Thickness'),
    ('skirt_height', 'Housing Height'),
    ('top_dome_height', 'Housing Top'),
    ('stem_height', 'Stem Height'),
    ('actuator_diameter', 'Actuator Diameter'),
    ('actuator_height', 'Actuator Height'),
    ('nozzle_length', 'Nozzle Length'),
    ('nozzle_diameter', 'Nozzle Diameter'),
    ('segments', 'Segments'),
]

# Parameters on this list that must stay synced to the body object they're attached to,
# for each shape type that can be a cap. Populated as cap generators are implemented.
SYNCED_PARAM_KEYS = {
    'round_tube': ('neck_diameter', 'neck_height'),
    'bottle': ('neck_diameter', 'neck_height'),
    'flat_tube': ('neck_diameter', 'neck_height'),
    'cap_screw': ('neck_diameter', 'skirt_height'),
}

# (cap socket key, body socket key) pairs kept in sync via drivers, per cap shape type --
# the single source of truth consumed both by each cap generator's operator and by the
# generic "Link to Body" panel button in sync.py.
CAP_SYNC_KEY_PAIRS = {
    'cap_screw': (
        ('neck_diameter', 'neck_diameter'),
        ('skirt_height', 'neck_height'),
    ),
    'cap_dropper': (
        ('neck_diameter', 'neck_diameter'),
        ('skirt_height', 'neck_height'),
    ),
    'cap_pump': (
        ('neck_diameter', 'neck_diameter'),
        ('skirt_height', 'neck_height'),
    ),
    'cap_flip_top': (
        ('neck_diameter', 'neck_diameter'),
        ('skirt_height', 'neck_height'),
    ),
    'cap_spray': (
        ('neck_diameter', 'neck_diameter'),
        ('skirt_height', 'neck_height'),
    ),
}

SHAPE_PARAMS = {
    'round_tube': ROUND_TUBE_PARAMS,
    'bottle': BOTTLE_PARAMS,
    'flat_tube': FLAT_TUBE_PARAMS,
    'box': BOX_PARAMS,
    'cap_screw': CAP_SCREW_PARAMS,
    'cap_dropper': CAP_DROPPER_PARAMS,
    'cap_pump': CAP_PUMP_PARAMS,
    'cap_flip_top': CAP_FLIP_TOP_PARAMS,
    'cap_spray': CAP_SPRAY_PARAMS,
}

SHAPE_LABELS = {
    'round_tube': 'Round Tube',
    'bottle': 'Bottle',
    'flat_tube': 'Flat Tube',
    'box': 'Box',
    'cap_screw': 'Screw Cap',
    'cap_dropper': 'Dropper Cap',
    'cap_pump': 'Pump Cap',
    'cap_flip_top': 'Flip-Top Cap',
    'cap_spray': 'Spray Cap',
}
