"""Body <-> cap parameter sync via drivers.

Confirmed live: a driver on a cap's modifier socket can target another object's modifier
socket path directly (`modifiers["Packaging"]["Socket_N"]`) -- no mirrored custom property
on the body object is needed as an indirection layer.
"""

import json

import bpy

from . import properties

MODIFIER_NAME = 'Packaging'


def link_cap_to_body(cap_obj, body_obj, key_pairs):
    """Add drivers on `cap_obj`'s Packaging modifier so each (cap_key, body_key) pair stays
    live-linked to the body's value. Also records the link (PKG_SYNC_SOURCE_KEY) so the
    N-panel can show/manage it.
    """
    body_socket_ids = json.loads(body_obj[properties.PKG_SOCKET_IDS_KEY])
    cap_socket_ids = json.loads(cap_obj[properties.PKG_SOCKET_IDS_KEY])
    cap_mod = cap_obj.modifiers[MODIFIER_NAME]

    for cap_key, body_key in key_pairs:
        body_id = body_socket_ids.get(body_key)
        cap_id = cap_socket_ids.get(cap_key)
        if body_id is None or cap_id is None:
            continue

        data_path = f'["{cap_id}"]'
        try:
            cap_mod.driver_remove(data_path)
        except TypeError:
            pass

        fcurve = cap_mod.driver_add(data_path)
        drv = fcurve.driver
        drv.type = 'SUM'
        var = drv.variables.new()
        var.name = 'v'
        var.type = 'SINGLE_PROP'
        target = var.targets[0]
        target.id_type = 'OBJECT'
        target.id = body_obj
        target.data_path = f'modifiers["{MODIFIER_NAME}"]["{body_id}"]'
        drv.expression = 'v'

    cap_obj[properties.PKG_SYNC_SOURCE_KEY] = body_obj.name


def unlink_cap(cap_obj, key_pairs):
    cap_socket_ids = json.loads(cap_obj[properties.PKG_SOCKET_IDS_KEY])
    cap_mod = cap_obj.modifiers[MODIFIER_NAME]
    for cap_key, _body_key in key_pairs:
        cap_id = cap_socket_ids.get(cap_key)
        if cap_id is None:
            continue
        try:
            cap_mod.driver_remove(f'["{cap_id}"]')
        except TypeError:
            pass
    if properties.PKG_SYNC_SOURCE_KEY in cap_obj:
        del cap_obj[properties.PKG_SYNC_SOURCE_KEY]


class PACKAGING_OT_link_cap_to_body(bpy.types.Operator):
    bl_idname = 'object.packaging_link_cap_to_body'
    bl_label = 'Link to Body'
    bl_description = 'Sync this cap\'s shared parameters to the other selected packaging body'
    bl_options = {'REGISTER', 'UNDO'}

    @classmethod
    def poll(cls, context):
        cap = context.active_object
        if cap is None or cap.get(properties.PKG_SHAPE_TYPE_KEY) not in properties.CAP_SYNC_KEY_PAIRS:
            return False
        others = [o for o in context.selected_objects if o is not cap]
        return len(others) == 1 and others[0].get(properties.PKG_SHAPE_TYPE_KEY) in properties.BODY_SHAPE_TYPES

    def execute(self, context):
        cap = context.active_object
        body = next(o for o in context.selected_objects if o is not cap)
        key_pairs = properties.CAP_SYNC_KEY_PAIRS[cap[properties.PKG_SHAPE_TYPE_KEY]]
        link_cap_to_body(cap, body, key_pairs)
        return {'FINISHED'}


def register():
    bpy.utils.register_class(PACKAGING_OT_link_cap_to_body)


def unregister():
    bpy.utils.unregister_class(PACKAGING_OT_link_cap_to_body)
