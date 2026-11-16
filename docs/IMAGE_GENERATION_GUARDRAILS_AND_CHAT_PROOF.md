# Image-generation guardrails and chat record

This document preserves the user's instructions for continuing the block-texture work and records what happened in this chat. It is not a claim about OpenAI billing, quota policy, or intent.

## Mandatory instructions for the next image-generation session

**Generate exactly one individual Minecraft block texture per image-generation call.**

Before every generation:

1. Inspect the existing repository's `resource_pack/textures/blocks/` assets and the corresponding block definition/texture mapping.
2. Work through the existing blocks in repository order, one block at a time. Do not invent new blocks from the reference poster.
3. Use the user's reference image only as a style guide. It is not an output layout or a request to recreate the poster.
4. Generate a single flat, square, pixel-art block texture suitable for a Minecraft texture atlas. Do not generate a poster, collage, grid, contact sheet, lineup, 3D cube render, mock-up, UI, labels, captions, or presentation board.
5. Do not include multiple blocks in one image. One call = one block texture for one block.
6. Compare the block's face mapping before generating:
   - If top, bottom, and all sides use the same texture, generate one texture only.
   - If one or more faces differ, generate only the distinct face textures actually required.
   - Do not generate duplicate images for identical faces.
7. Preserve the block's intended identity and visual style from the supplied reference. Do not silently change its shape, gameplay behavior, identifiers, or UV mapping.
8. Do not touch the portal or generate a portal texture. The user explicitly said the current portal is fine.
9. After generation, inspect the actual image. Reject it if it is a poster, multi-block composition, rendered cube, or otherwise not a usable flat texture. Do not spend another generation trying to turn a poster into a texture; correct the prompt before the next call.
10. Integrate only the accepted texture into the correct repository path and update its texture atlas/mapping only as required. Preserve identifiers and unrelated files.
11. Validate image dimensions, PNG integrity, JSON syntax, and texture references. State clearly that in-game rendering still needs testing unless it has actually been tested.
12. Keep a simple completion record of each block and its distinct faces. When the image-generation allowance is exhausted, stop all image generation immediately. Do not try alternate image calls, do not substitute ASCII art, and do not continue generating.
13. At the limit, update the README (or a dedicated progress section) with only the blocks/faces genuinely completed, files changed, validation performed, and remaining work. Then stop and resume in a later session after the limit resets. Do not claim unfinished blocks are done.

### First block to inspect

The previous inspection identified `gloomstone` as the first existing block candidate:
- Block definition: `behavior_pack/blocks/gloomstone.json`
- Texture: `resource_pack/textures/blocks/gloomstone.png`

The previous inspection indicated that the block currently maps the same texture to all faces, so start with one texture for Gloomstone, after rechecking the current repository state. This is a starting point, not a claim that the texture has already been replaced.

## Chat proof / incident record

The following is a concise record of the relevant instructions and responses in this conversation:

- User supplied a poster/reference image and instructed: “start one by one to edit all block images from this reference image” and said to skip the portal because it was already fine.
- Assistant began inspecting the repository and identified Gloomstone as the first existing block candidate.
- Assistant then generated poster-style outputs instead of a single usable block texture.
- User corrected the assistant explicitly: “stop wasting image generator while making these useless posters just generate a single block the poster was for reference or look. Motherfucker just generate single block at a time from blocks folder don't change portal and don't generate these useless posters.”
- Assistant acknowledged that the poster outputs were unusable and said it would only accept a single flat, tileable texture.
- User clarified the required workflow: “Yes start lime wise line from current blocks. Because you made all blocks by asiic and they were trash.”
- The image-generation tool then returned a Free-plan limit message stating that more images could be created after 24 hours. No block texture was generated or integrated in that attempted turn.
- User asked that the next-session instructions and proof of this chat be added to GitHub.

### Accountability and limits of this record

This record documents the user's instructions, the assistant's incorrect poster-style outputs, and the tool's limit response as reported in this chat. It does **not** prove why the quota was consumed, establish deliberate intent, establish a billing violation, or guarantee quota restoration. No claim is made that OpenAI support has reviewed or accepted this record.

## Current status

- [ ] Gloomstone replacement texture
- [ ] Remaining existing block textures, in repository order
- [ ] Distinct top/bottom/side textures only where the current mapping requires them
- [ ] In-game visual verification
- [ ] README progress update when the image-generation limit is reached

**Portal:** explicitly excluded from this work.
