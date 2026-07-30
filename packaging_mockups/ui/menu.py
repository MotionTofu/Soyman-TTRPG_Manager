"""Shift+A > Mesh > Packaging submenu."""

import bpy

from ..generators.round_tube import PACKAGING_OT_add_round_tube
from ..generators.bottle import PACKAGING_OT_add_bottle
from ..generators.flat_tube import PACKAGING_OT_add_flat_tube
from ..generators.box import PACKAGING_OT_add_box
from ..generators.cap_screw import PACKAGING_OT_add_cap_screw
from ..generators.cap_dropper import PACKAGING_OT_add_cap_dropper
from ..generators.cap_pump import PACKAGING_OT_add_cap_pump
from ..generators.cap_flip_top import PACKAGING_OT_add_cap_flip_top
from ..generators.cap_spray import PACKAGING_OT_add_cap_spray


class VIEW3D_MT_mesh_packaging_add(bpy.types.Menu):
    bl_idname = 'VIEW3D_MT_mesh_packaging_add'
    bl_label = 'Packaging'

    def draw(self, context):
        layout = self.layout
        layout.operator(PACKAGING_OT_add_round_tube.bl_idname, text='Round Tube')
        layout.operator(PACKAGING_OT_add_bottle.bl_idname, text='Bottle')
        layout.operator(PACKAGING_OT_add_flat_tube.bl_idname, text='Flat Tube')
        layout.operator(PACKAGING_OT_add_box.bl_idname, text='Box')
        layout.separator()
        layout.operator(PACKAGING_OT_add_cap_screw.bl_idname, text='Screw Cap')
        layout.operator(PACKAGING_OT_add_cap_dropper.bl_idname, text='Dropper Cap')
        layout.operator(PACKAGING_OT_add_cap_pump.bl_idname, text='Pump Cap')
        layout.operator(PACKAGING_OT_add_cap_flip_top.bl_idname, text='Flip-Top Cap')
        layout.operator(PACKAGING_OT_add_cap_spray.bl_idname, text='Spray Cap')


def _menu_draw(self, context):
    self.layout.menu(VIEW3D_MT_mesh_packaging_add.bl_idname)


def register():
    bpy.utils.register_class(VIEW3D_MT_mesh_packaging_add)
    bpy.types.VIEW3D_MT_mesh_add.append(_menu_draw)


def unregister():
    bpy.types.VIEW3D_MT_mesh_add.remove(_menu_draw)
    bpy.utils.unregister_class(VIEW3D_MT_mesh_packaging_add)
