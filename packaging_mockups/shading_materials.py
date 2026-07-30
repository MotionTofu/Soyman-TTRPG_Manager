"""Material slot + placeholder Principled BSDF helpers.

Each generated object gets its own per-object-named materials (not one shared global
material) so resizing/retexturing one packaging object never bleeds into another.
"""

import bpy

_DEFAULT_SLOT_COLORS = {
    'Body': (0.75, 0.76, 0.78, 1.0),
    'Cap': (0.15, 0.15, 0.17, 1.0),
    'Label': (1.0, 1.0, 1.0, 1.0),
}


def ensure_placeholder_material(name, base_color=(0.8, 0.8, 0.8, 1.0)):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        if bsdf is not None:
            bsdf.inputs['Base Color'].default_value = base_color
    return mat


def assign_material_slots(obj, slot_names):
    """Create/reuse a placeholder material per slot name (e.g. ('Body', 'Label')) and
    append them to `obj.data.materials` in order, clearing any prior slots first.
    """
    obj.data.materials.clear()
    for slot_name in slot_names:
        mat_name = f'{obj.name} {slot_name}'
        base_color = _DEFAULT_SLOT_COLORS.get(slot_name, (0.8, 0.8, 0.8, 1.0))
        mat = ensure_placeholder_material(mat_name, base_color)
        obj.data.materials.append(mat)
