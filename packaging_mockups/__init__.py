bl_info = {
    "name": "Packaging Mockups",
    "author": "motion.tofu",
    "version": (0, 1, 0),
    "blender": (5, 1, 0),
    "location": "View3D > Add > Mesh > Packaging, View3D > Sidebar > Packaging",
    "description": "Procedural cosmetic packaging mockups (boxes, tubes, bottles, caps) via Geometry Nodes",
    "category": "Add Mesh",
}

from . import sync
from . import presets
from . import generators
from . import ui

_modules = (sync, presets, generators, ui)


def register():
    for m in _modules:
        m.register()


def unregister():
    for m in reversed(_modules):
        m.unregister()
