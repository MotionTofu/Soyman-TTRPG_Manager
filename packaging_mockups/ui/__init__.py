# UI modules (N-panel, Add-mesh menu) are added here as they're implemented.
from . import panel
from . import menu

_submodules = (panel, menu)


def register():
    for m in _submodules:
        m.register()


def unregister():
    for m in reversed(_submodules):
        m.unregister()
