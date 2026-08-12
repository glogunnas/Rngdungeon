# Tile rules for procedural room generation

## Wall perspective

The label suffix/word `perspective` is a placement property, not decorative
text:

```text
wall_*_perspective
```

These tiles show the back face of the wall and visually occupy the entire
32×32 square. Use them when the generated room needs a full wall face visible
from the camera's viewpoint.

Wall labels without `perspective` show only the thin top/side surface of the
wall. They are cap/edge pieces. They should be placed on the boundary where the
wall's narrow top surface is visible, not swapped in for a perspective wall.

## Tile categories currently present

- Floor variants: `B2:E4`
- Perspective top wall pieces: `A1:F1`
- Thin left/right wall pieces: `A2`, `F2`, `G2`, `I2`, `A3`, `F3`, `A4`,
  `F4`
- Thin bottom wall pieces: `H1`, `B5:E5`
- Perspective bottom wall pieces: `G3:J3`
- Ascending stairs: `G4`
- Descending stairs: `G5`
- Water top-edge pieces: `H4:K4`
- Water interior variants: `H5:K5`

The remaining labels describe gaps, recesses, indents, arches, and compound
corner transitions. Treat those as special structural pieces rather than
ordinary random wall or floor variants.

## Required generator metadata

For robust room generation, each tile should ultimately have:

1. A visual role, such as floor, wall cap, wall back face, water, or stairs.
2. A boundary/socket description: which sides connect to floor, wall, water,
   void, or an opening.
3. A footprint/collision rule: walkable, blocking, water, or decorative.
4. A rotation rule: fixed orientation or safely rotatable.
5. A variant group for interchangeable artwork.

The current spreadsheet provides the visual role names. The compound gap and
recess tiles may need socket metadata before they can be placed safely in
arbitrary room layouts.