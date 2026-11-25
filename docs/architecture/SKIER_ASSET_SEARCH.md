# Skier Asset Search

_2026-11-25 · Status: no external asset approved. The procedural skier (WP-2) stays in use._

## 1. Preferred asset: "Skieur" by Frédérik Prévost (Sketchfab)

https://sketchfab.com/3d-models/skieur-2fe31a3c191f4c86a0474278b205994d

Source: public Sketchfab API (`/v3/models/2fe31a3c191f4c86a0474278b205994d`) and the model page, both checked
2026-11-25.

| Property  | Value                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------- |
| License   | **None set** (empty license field, no license on the page), so all rights are reserved by default.       |
| Download  | `isDownloadable: false`, 0 downloads, not for sale                                                       |
| Geometry  | 188.9k triangles, 94.7k vertices                                                                        |
| Materials | 2 materials, 8 textures, PBR metalness                                                                  |
| Rig       | Not stated. 0 animations. Tagged "grab", so probably a sculpted static grab pose.                       |
| Origin    | Student project for a digital-sculpture course (2020). Made with ZBrush, 3ds Max, Maya and Substance.     |

**Verdict:** we cannot use it without the author's written permission and source files. We also will not
rebuild it from screenshots, because that would be a copy of the author's work.

**If permission is granted**, it needs a new work package (character owner, and Blender 5.2+ must be
installed first):

1. Get the source files. Ideal: an FBX or OBJ in T-pose or A-pose with separate skis and poles, plus textures.
   If only the grab-posed sculpt exists, it must be re-posed to an A-pose. That is substantial work.
2. Retopologise from ~189k to about 20–30k triangles, and bake normal maps from the sculpt.
3. Rig with our 25 bone names (`SkierModel` / `IK` contract), skin weights and deformation tests.
4. Resize and compress the textures (2k, KTX2 or WebP) and export to GLB. Check it with `threejs-asset-pipeline`.
5. Load it through `GLTFLoader` behind the existing `SkierModel` interface. Animation stays procedural
   (`SkierAnimator`); no clips are needed from the author.

### Draft permission request (the user sends this from their own Sketchfab account or by email)

> Hi Frédérik,
>
> I really like your model "Skieur" on Sketchfab. I'm building a small browser freestyle-skiing game in
> Three.js, and your skier is exactly the look I'm after.
>
> Would you be willing to let me use it in the game? If so, could you share the source files (ideally FBX
> or OBJ in a T- or A-pose, with textures)? I would retopologise and rig it myself for real-time use.
>
> I would credit you by name in the game and its documentation, and I'm happy to agree to whatever terms
> you prefer (e.g. a CC-BY license, credit wording, or no redistribution of the source files). Please
> also let me know if commercial use would be acceptable.
>
> Thank you!

## 2. Alternatives (CC0 / CC-BY, commercial use allowed)

Searched: Sketchfab public search API (skier, freestyle ski, downloadable, rigged filter), the web
(CGTrader, TurboSquid, RenderHub, OpenGameArt, itch.io), Quaternius and Kenney.

**Finding: no CC0 or CC-BY model exists that is a rigged freestyle skier with equipment.** Every rigged
skier found is a paid marketplace asset.

| Candidate | License | Facts | Assessment |
| --- | --- | --- | --- |
| [Skier low poly character](https://sketchfab.com/3d-models/skier-low-poly-character-13ae2a85b3af43ab8b1e984c8f8c87e2) (SweeD_tort) | CC Attribution, commercial OK | 4.1k tris, 1 texture, downloadable, no rig stated, "Casual Skier" | Unrigged low-poly figure, lower quality than the current procedural skier. Not recommended. |
| [Quaternius Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) | CC0 (free Standard tier) | Humanoid rig, ~13k tris, FBX/glTF. Free tier has 2 base bodies; .blend source is paid ($19.99+). No clothing, no animations. | Best **CC0 body base**. Ski clothing and equipment would still be ours (procedural or Blender-modelled). Rest pose not stated, so verify after download. |
| [plewr "3D Rigged Character"](https://plewr.itch.io/3d-rigged-character) | CC0 | Free rigged GLB (993 kB) plus Mixamo FBX. Poly count and pose not stated. | Generic low-poly body. Weaker than Quaternius. |
| [Mountain-skier](https://sketchfab.com/3d-models/e1a96e547ab2412590665ed3d6dafde2) (Viktor.Yakin) | CC Attribution | 567k faces, tagged 3D printing | A print mesh, not a game asset. Excluded. |
| Sketchfab "Fortnite skin skier" models | Labelled CC-BY | — | Third-party game IP; the label is not credible. **Excluded.** |
| [RenderHub skier rigged](https://www.renderhub.com/andriano/skier-rigged-3d-character) | Paid, royalty-free (not CC) | $25, 42 bones, includes a freestyle animation | Outside the CC0/CC-BY brief. Listed only for completeness; needs the user's decision. |

## 3. Recommendation

1. The user asks the author of "Skieur" for permission (draft above). This is the preferred route.
2. Meanwhile, keep the procedural skier. Nothing is downloaded or integrated.
3. If permission is refused or there's no reply: the best licensed fallback is a Quaternius CC0 base body
   with our own ski clothing and equipment. Only consider it if it would clearly beat the current procedural
   skier in a side-by-side comparison; a generic base body alone does not.
