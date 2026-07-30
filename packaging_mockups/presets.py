"""Volume(ml) -> dimension solver, per body shape family.

Approximates each body as a simple prism/cylinder of its current footprint (silhouette-
plausible, not a physically-exact enclosed volume -- these meshes aren't necessarily closed
solids, and the shoulder/neck taper's small volume contribution is ignored). Keeps the
current diameter/width/depth fixed and solves for the height/body_height that hits the
target volume, so a preset click doesn't also change how "fat" the container looks.
"""

import math

import bpy

from . import properties

MODIFIER_NAME = 'Packaging'
PRESET_VOLUMES_ML = (15, 30, 50, 100, 200)

# footprint area (mm^2) given a modifier's current socket values, per shape type.
_FOOTPRINT_AREA = {
    'round_tube': lambda mod, ids: math.pi * (mod[ids['body_diameter']] / 2.0) ** 2,
    'bottle': lambda mod, ids: math.pi * (mod[ids['body_diameter']] / 2.0) ** 2,
    'flat_tube': lambda mod, ids: math.pi * (mod[ids['body_diameter']] / 2.0) ** 2 * mod[ids['width_to_depth_ratio']],
    'box': lambda mod, ids: mod[ids['width']] * mod[ids['depth']],
}

_HEIGHT_KEY = {
    'round_tube': 'body_height',
    'bottle': 'body_height',
    'flat_tube': 'body_height',
    'box': 'height',
}


def apply_volume_preset(obj, target_ml):
    shape_type = obj.get(properties.PKG_SHAPE_TYPE_KEY)
    area_fn = _FOOTPRINT_AREA.get(shape_type)
    height_key = _HEIGHT_KEY.get(shape_type)
    if area_fn is None or height_key is None:
        return False

    import json
    socket_ids = json.loads(obj[properties.PKG_SOCKET_IDS_KEY])
    mod = obj.modifiers[MODIFIER_NAME]

    area_mm2 = area_fn(mod, socket_ids)
    if area_mm2 <= 0:
        return False

    target_mm3 = target_ml * 1000.0
    new_height = target_mm3 / area_mm2

    mod[socket_ids[height_key]] = new_height
    mod.node_group = mod.node_group  # confirmed-reliable refresh for a direct value write
    return True


class PACKAGING_OT_apply_volume_preset(bpy.types.Operator):
    bl_idname = 'object.packaging_apply_volume_preset'
    bl_label = 'Apply Volume Preset'
    bl_description = 'Set this body\'s height so its silhouette holds roughly the given volume'
    bl_options = {'REGISTER', 'UNDO'}

    volume_ml: bpy.props.FloatProperty(name='Volume (ml)', default=50.0, min=0.1)

    @classmethod
    def poll(cls, context):
        obj = context.active_object
        return obj is not None and obj.get(properties.PKG_SHAPE_TYPE_KEY) in _FOOTPRINT_AREA

    def execute(self, context):
        if not apply_volume_preset(context.active_object, self.volume_ml):
            self.report({'WARNING'}, 'Could not apply volume preset to this object')
            return {'CANCELLED'}
        return {'FINISHED'}


def register():
    bpy.utils.register_class(PACKAGING_OT_apply_volume_preset)


def unregister():
    bpy.utils.unregister_class(PACKAGING_OT_apply_volume_preset)
