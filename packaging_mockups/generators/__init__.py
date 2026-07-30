# Shape generator modules are added here as they're implemented.
# Each submodule exposes an Operator class plus register()/unregister().
from . import round_tube
from . import cap_screw
from . import bottle
from . import flat_tube
from . import box
from . import cap_dropper
from . import cap_pump
from . import cap_flip_top
from . import cap_spray

_submodules = (round_tube, cap_screw, bottle, flat_tube, box,
               cap_dropper, cap_pump, cap_flip_top, cap_spray)


def register():
    for m in _submodules:
        m.register()


def unregister():
    for m in reversed(_submodules):
        m.unregister()
