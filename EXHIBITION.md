# Exhibition pages

The gallery reads the existing `ids.txt`, `titles/`, `descriptions/`, `thumbnails/` and `dyn/` files from GitHub Pages. Open `index.html` to browse. Existing `viewer.html?model=ID` links still open the submitted image and statement. Project titles are loaded as visitors browse. Text searches resolve uncached titles with at most five requests at a time. No copy of a roster or submission catalogue is needed.

`preview.html` opens a local GLB or STL on the visitor's device. The course-created colour sample contains opaque and translucent surfaces. Compare an export against the final model from above and from the side, then check repeated members, materials, axes and scale. Use Z-up for the course STL exporter and Y-up for an archived STL. A self-contained glTF 2.0 binary can retain the colour and transparency supplied by the exporter.

## Publish an approved model

After checking the model and confirming exhibition permission, place an uncompressed self-contained `ID.glb` under `verified-models/` as an ordinary Pages asset. The corresponding project page looks for this file and offers the colour model when it is available. The selected file should include all geometry and materials. No manifest generation is required.

When a colour model is unavailable, the submitted image remains the primary view and the visitor can choose to open the original geometry-only archive. Archived STLs can contain missing or misplaced components. The viewer reads a checked-out STL locally or follows the original gallery’s GitHub LFS media path. It shows download progress and retains the original image if the archived file cannot be opened. The site never infers material colours from old STL files.

The viewer uses the repository's three.js r122 and OrbitControls with the matching [GLTFLoader](https://github.com/mrdoob/three.js/blob/r122/examples/js/loaders/GLTFLoader.js) (MIT, `js/THREE-LICENSE.txt`). No external JavaScript CDN is needed. For browsers without WebGL, the local canvas renderer supports the course materials and up to 160,000 triangles.
