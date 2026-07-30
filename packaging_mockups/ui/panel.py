"""N-panel 'Packaging' tab: parameter rows for the active packaging object.

Parameter rows are drawn via `modifier["<socket_identifier>"]`, using the identifiers
cached on the object at generation time -- never the human-readable socket name (see
node_utils.py module docstring for why that matters).
"""

import json

import bpy

from .. import properties
from .. import presets


class VIEW3D_PT_packaging(bpy.types.Panel):
    bl_idname = 'VIEW3D_PT_packaging'
    bl_label = 'Packaging'
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'Packaging'

    @classmethod
    def poll(cls, context):
        obj = context.active_object
        return obj is not None and properties.PKG_SHAPE_TYPE_KEY in obj

    def draw(self, context):
        layout = self.layout
        obj = context.active_object
        shape_type = obj.get(properties.PKG_SHAPE_TYPE_KEY)
        socket_ids = json.loads(obj.get(properties.PKG_SOCKET_IDS_KEY, '{}'))
        params = properties.SHAPE_PARAMS.get(shape_type, [])

        layout.label(text=properties.SHAPE_LABELS.get(shape_type, shape_type))

        mod = obj.modifiers.get('Packaging')
        if mod is None:
            layout.label(text='No Packaging modifier found', icon='ERROR')
            return

        for key, label in params:
            socket_id = socket_ids.get(key)
            if socket_id is None:
                continue
            layout.prop(mod, f'["{socket_id}"]', text=label)

        if shape_type in properties.CAP_SYNC_KEY_PAIRS:
            box = layout.box()
            sync_source = obj.get(properties.PKG_SYNC_SOURCE_KEY)
            if sync_source:
                box.label(text=f'Synced to: {sync_source}', icon='LINKED')
            else:
                box.label(text='Not linked to a body', icon='UNLINKED')
            box.operator('object.packaging_link_cap_to_body')

        if shape_type in presets._FOOTPRINT_AREA:
            box = layout.box()
            box.label(text='Volume Preset (ml)')
            row = box.row(align=True)
            for ml in presets.PRESET_VOLUMES_ML:
                op = row.operator('object.packaging_apply_volume_preset', text=str(ml))
                op.volume_ml = ml


def register():
    bpy.utils.register_class(VIEW3D_PT_packaging)


def unregister():
    bpy.utils.unregister_class(VIEW3D_PT_packaging)
