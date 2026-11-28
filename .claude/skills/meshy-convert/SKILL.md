---
name: meshy-convert
description: Convert an AI-generated (Meshy) GLB of a real car into one of the game's fictional cars in the flat-colour model format, replacing its in-game model. Use when the user hands over a Meshy .glb/.blend for a car and wants it in the game.
---

# Convert a Meshy model into a game car

Arguments: the path to the GLB and the game car it is for (its name in src/physics/params.ts or its body id,
e.g. `ljung2000`). Ask for whichever is missing. Below, `<carId>` is the body id.

Do not modify the source files; copy the GLB to the scratchpad. Blender: /Applications/Blender.app/Contents/MacOS/Blender
(run with -b). The car's procedural source is in blender/<carId>/ (build.py, shell.py, parts.py, common.py), its game
model in src/render/models/<carId>.ts, its body shape in src/render/bodies/<carId>.ts, its physics in src/physics/params.ts.

## Reference implementation

blender/henryTurbo4x4Meshy/convert.py did this for the Henry 2.0 Turbo 4x4. Read it first and follow its structure:
a new sibling folder blender/<carId>Meshy/ with convert.py and <carId>.blend (it must be named <carId>.blend so
blender/export.py writes src/render/models/<carId>.ts). Run it as
`blender -b --factory-startup -P blender/<carId>Meshy/convert.py -- <model.glb>`. Reuse the procedural car's common.py
(MATERIALS, M, set_materials, WHEELS, TRACK, GROUND, to_blender, to_car) and leave blender/<carId>/ untouched. When a
second car needs the same helpers, move the shared parts of convert.py into a shared module instead of copying them.

## Steps

1. Inspect the GLB: objects, bounds, material slots, which slots are textured. Measure in car coordinates (x left,
   y up, z forward; Blender X = x, Y = -z, Z = y). Compare with the game: the wheel positions in common.py
   WHEELS/TRACK and params.ts, the length/width/height in params.ts, ground y = -0.58, the current BodyShape.
2. Render the GLB with its textures (Workbench, color_type TEXTURE) from front, side, rear and top, plus
   orthographic views at a known scale (e.g. 1000x500 px over 5 m, so 1 px = 5 mm), and crop/zoom them with `sips`
   to read off the colour fields: glass (side windows, windscreen, rear screen, pillars), headlamps, blinkers, fog
   lamps, tail lamps (with reversing and amber parts), plates, grille, door seams, belt line, bumper seams, boot lid.
3. Write convert.py:
   - Load the GLB, apply the object transforms. Mark the faces of untextured slots (arch liners, cut faces) black first.
   - Weld with bmesh remove_doubles (~0.5 mm). The glTF importer splits vertices at UV seams; without the weld,
     smoothing tears the surface into cracks.
   - Symmetrize: bisect at x = 0, keep the cleaner half, mirror it, then recalc_face_normals over the whole mesh (the
     mirror leaves mixed winding). Pick the half from renders of both sides.
   - Smooth (Laplacian, volume preserving) and decimate (COLLAPSE, use_symmetry on X) BEFORE cutting, so the colour
     edges stay sharp. Decimating after colouring gave spikes on the roof.
   - Colour fields: do NOT classify by sampling the texture; it gives noisy, jagged fields and livery text becomes
     black specks. Bound every field with planes measured in step 2: bisect the mesh along them inside a zone, then
     choose the material per face from its centre and normal. All livery is 'paint'; no logo, text or real plate may
     survive (plates become blank 'plate').
   - If a plane runs almost along a lumpy surface (a screen's side along a pillar), the edge comes out ragged; move it
     inboard where the surface crosses the plane steeply.
   - Split into the same parts as the procedural model (see the names in src/render/models/<carId>.ts and how
     src/render/carMesh.ts uses them): 'body' and 'body_…' panels keep the car's origin; lamps, mirrors and plates are
     loose parts with their origin at their centre; lamps are copied out (keep=True), lifted ~5 mm along their normal,
     and the body under them is recoloured black.
   - Trap: `mesh.materials.clear()` resets the faces' material indices. When creating parts, append the source's
     materials instead of calling set_materials.
   - Fit to the game: scale x to the game's width, y about the ground to the roof height, and warp z with a smooth
     cubic through (tail, rear axle, front axle, nose) so the wheel arches land on the game's axles. Assert that the
     warp is monotonic.
   - Borrow from the procedural .blend (bpy.data.libraries.load) whatever is poor or missing in the GLB, usually the
     wheel, mud flaps, exhaust and spot lamp pod. Strip '.001' suffixes from the material names. Seat parts that sit
     on the body (the pod) on the new surface with a BVH ray cast.
   - If the GLB has a merged-in accessory (e.g. a pod cut off at the grille), flatten or recolour the scar.
   - Delete all images and non-palette materials before saving, and add a 'Reference' collection (ground plus the
     other three wheels) so blender/render.py works.
4. Export with `blender -b blender/<carId>Meshy/<carId>.blend -P blender/export.py`. Keep the file size in line with
   the other cars in src/render/models/ (~100–260 kB); adjust the decimate ratio if needed.
5. Update src/render/bodies/<carId>.ts from the converted mesh (measure it with a script): belt, roof, screen and
   backlight (z at base and top, on the centre line), doorSeams, tailY, tailX. Leave the physics unless asked.
6. Check:
   - blender/render.py renders (front34, side, rear34, headlight, wing) of the converted and the procedural model, plus
     the right side (yaw 325 and 210). Make a side-by-side image with Blender and numpy. In zsh pass the file list as
     an array; an unquoted string does not word-split.
   - In the game: add an uncommitted .claude/launch.json (vite on a free port with --strictPort), open `?webgl`,
     Karriär → Bilhandlare, step with the arrow keys to the car, drag to spin it, screenshot, check the console.
   - `npm run typecheck`, `test:physics`, `test:account`, `test:career`.
7. Before committing, ask which Meshy plan the model came from: a free-plan model is CC BY 4.0 and needs a credit
   line; a paid-plan model needs none.

## Rules

- No real brand or model names anywhere (files, code, comments, commits): use the game's fictional names.
- English everywhere except UI text.
- Commit the converted model (blender/<carId>Meshy/, src/render/models/<carId>.ts, src/render/bodies/<carId>.ts) as
  one self-contained commit. Don't push until the user has compared it with the current model; when they say so,
  rebase on origin/main, rerun the checks and push HEAD:main.
- Deliver the side-by-side renders, an in-game screenshot and a short note on what looks better and worse.
