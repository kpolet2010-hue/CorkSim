# Optional 3D models

Freeski runs entirely on procedural geometry, so this folder can stay empty.

Drop Blender-exported binary glTF files here to replace procedural assets:

| File       | Replaces                    | Notes                                                                     |
| ---------- | --------------------------- | ------------------------------------------------------------------------- |
| `pine.glb` | Near-LOD tree in the forest | Origin at the trunk base, +Y up, about 7 m tall. Vertex colours optional. |

Export settings (Blender → File → Export → glTF 2.0): Format _glTF Binary (.glb)_, _+Y Up_, apply modifiers.
Missing, invalid or slow-to-load files are ignored and the procedural version is used instead.
