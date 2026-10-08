# Flat art style prompt

The fixed prompt for every library image. Model, calls and the rest of the pipeline: `RUNBOOK.md`. Look target:
TED-Ed illustrated lessons (reference: "Hawking's black hole paradox explained"): flat vector art, solid fills, no
outlines, a small warm-on-cool palette, geometric people with long necks, dot eyes and bar brows.

## What the look is (checklist for judging a result)

- Solid flat fills only. No outline, no line art, no gradient, no shading or highlight, no texture or grain, no drop
  shadow. Interior detail is a separate flat shape (a fold is a slightly different fill, never a line).
- Faces: small solid dark oval eyes (no whites), thick flat bar brows, one angular nose shape a step darker than the
  skin, a small flat mouth (lips a coral/darker-skin shape). Ears as a simple bump. No cheeks blush, no eyelashes.
- Bodies: slightly elongated, long neck, narrow shoulders, simple tube limbs, simple hands (a thumb and a block or a
  few fingers). Clothes are big single-colour shapes.
- Hair: one or two flat shapes with a simple silhouette, never strands.
- Props: big simple geometric shapes with crisp straight edges; at most a darker side face for depth.
- Colour: only palette colours (below), cool grounds with warm accents. Skin and hair from the skin/hair tokens.
- One subject, centred, full body unless the pose says close-up, on plain `#FFFFFF` (cut out later).

## Size

Every library SVG is at most **20 KB** (compiled scenes inline every drawing). Prompts ask for big simple shapes and
minimal detail partly for this reason: a person at the default `vectorize.py` settings is about 7-9 KB, a prop 3 KB, a host with lettering 15-19 KB.
Small text (mug slogans, badges) costs the most bytes; keep it to the few words the identity needs.

## Palette (exact hex, from `art/flat/PALETTE.json`)

Grounds: `ground-indigo #1E1A4D`, `ground-blue #1C79BC`, `ground-paper #E3E1DC`, `ground-night #111019`.
Accents: `coral #E8636F`, `peach #FFB79C`, `yellow #F7CF46`, `lilac #9D8FE0`, `orange #F2843A`.
Skin: `skin-1 #FAD3B8`, `skin-2 #EE9F79`, `skin-3 #C97E55`, `skin-4 #975936`, `skin-5 #6A3D27`.
Hair: `hair-1 #1E1A2E`, `hair-2 #3E2A20`, `hair-3 #D9541E`, `hair-4 #D8B56A`, `hair-5 #C9C9CF`, `hair-6 #3A3AA8`.
Paper and marks: `chalk #FFFFFF`, `card #F8F0DC`, `ink #2D1F7A`.

Use the ground colours for clothes too (TED-Ed dresses people in the same blues and indigos as its grounds); the
compiler recolours cast clothes per scene so a person never vanishes into the ground.

## STYLE block (paste first in every prompt)

```
Draw in EXACTLY the flat illustration style of the reference frames (TED-Ed animated lesson style): flat 2D vector
art, solid flat colour fills only, NO outlines, NO line art, NO gradients, NO shading, NO texture, NO drop shadows.
Geometric simplified face: small solid dark oval dot eyes, thick flat bar eyebrows, one simple angular nose shape in a
darker skin tone, small flat mouth. Slightly elongated simple proportions, long neck, simple hands. Big simple shapes,
minimal detail.
```

## Negative list (append when a result drifts)

`no outlines, no black contour lines, no sketch lines, no cross-hatching, no gradients, no soft shading, no
highlights, no paper texture, no grain, no drop shadow, no floor shadow, no background objects, no text unless asked,
no eye whites, no eyelashes, no blush, no hair strands, no 3D, no isometric camera, no photo-real hands`

## Templates

Fill the `<…>` parts; keep the rest word for word. Colours are always given as hex from the palette.

### cast pose

```
<STYLE block> Match the <model sheet | style-bible person> reference exactly (same construction, same face, same
flatness).
Subject: ONE <body description, e.g. lanky young man>, full body head to toe, <pose sentence, e.g. standing,
three-quarter view facing right, right arm stretched straight out POINTING with the index finger at something
off-picture, other arm relaxed>, <expression>. Hair <hair token hex>, skin <skin hex> with nose <one skin step darker>,
top <hex>, trousers <hex>, shoes <hex>. Eyes and brows #2D1F7A.
Use only these exact colours. Centred on a plain pure white #FFFFFF background, nothing else, no floor, no shadow,
no text.
```

References: TED-Ed people strip + the body's model sheet (or the style-bible person until model sheets exist).
Keep each body's colour groups separate fills (skin, hair, top, bottom, shoes) so recolouring works.

### host pose

The first attempt ("redraw the brand-sheet character in TED-Ed style") kept the brand sheets' cartoon construction
(bulb noses, outlines, finger lines). What worked was to lead with our own TED-flat person as the style anchor and
use the brand sheets for identity only, then draw each host alone at `size: "2K"`:

```
Draw <the old guy | the new guy> in EXACTLY the same drawing style as the man in the first reference image and the
TED-Ed people in the other references: flat 2D vector art built from big solid flat colour shapes ONLY. Absolutely
NO lines of any kind: no outlines, no contour lines, no interior lines on hands, belly, clothes, shoes or hair, no
sketch lines, no gradients, no shading, no texture. Face built exactly like the first reference man: small solid dark
oval dot eyes, thick flat bar eyebrows, one simple angular nose shape a step darker than the skin, a small flat mouth
shape. Hands are simple flat mitten shapes with a thumb. Hair and beards are single smooth flat shapes with simple
silhouettes, never strands or tufts. The identity comes from the brand-sheet reference (features and costume only,
NOT its sketchy cartoon drawing style).
<host identity line, below>. Full body head to toe, <pose sentence>, <expression>. Text in big thick letters.
Use only these exact colours. Centred on a plain pure white #FFFFFF background, nothing else, no floor, no shadow.
```

Identity lines (keep every feature; text exactly as written):

- Old guy: `short and chubby older developer, round belly, big red-orange beard and hair as one smooth flat shape
  #D9541E, skin #EE9F79, round glasses with flat dark frames #2D1F7A, trucker cap: crown #3A3AA8 and cream front panel
  #F8F0DC reading "#1 DEV" in #2D1F7A, small flat headset with mic arm #111019, yellow pencil behind his ear, yellow
  t-shirt #F7CF46 with a simple flat sunflower (petals #F2843A, centre #3E2A20), jeans #1C79BC, dark sandals #3E2A20,
  holding a cream mug #F8F0DC reading "LEGACY CODE FUEL" in #2D1F7A`
- New guy: `tall skinny excited junior with a long neck, big curly brown hair as one simple flat cloud shape #3E2A20,
  backwards cap #1C79BC with a small cream tag #F8F0DC hanging off it, skin #FAD3B8, white polo shirt #FFFFFF, a pink
  #E8636F name sticker with "HELLO" in white on the top band and a white panel reading "NEW GUY" in big #2D1F7A
  letters, blue lanyard with a lilac #9D8FE0 badge reading "VISITOR" in big white letters, khaki trousers #D8B56A,
  white sneakers with blue #1C79BC accents`

References, in this order: the style-bible person (`body-a-point`), the TED-Ed people strip, the TED-Ed crowd frame
(its bearded men are the model for the old guy's beard), the host's brand-sheet panel; from Task 4 on, the approved
host model sheet first.

### prop

```
<STYLE block, from "flat 2D vector art"> Big simple geometric shapes, minimal detail, crisp straight edges.
Subject: ONE <prop>, <view: seen straight from the FRONT (flat orthographic, no perspective, no side face); a
three-quarter view drew a skewed side face>. <parts, each with one hex>. <proportions>. <state, e.g. empty top>.
Use only these exact colours. Centred on a plain pure white #FFFFFF background, nothing else, no floor, no shadow,
no text.
```

References: TED-Ed people strip (it has the yellow table) + the style-bible prop.

### scene (style bible and reference frames only; videos compose scenes in code)

```
<STYLE block> Match the person in the reference exactly.
Scene, wide 16:9 frame: a plain flat <ground hex> background filling the whole frame (no floor line, no texture).
<who, where, doing what>. <props with hex>. Calm, clear, lots of empty space, like a TED-Ed lesson frame.
Use only these exact colours plus white. No text, no subtitles.
```

## Reference images

Third-party TED-Ed frames are used as references from a local scratch folder only; they are never committed or
published. Approved style-bible frames (Task 3) become the main reference set for everything after.

Style bible (Task 3, waiting for the owner's approval): `art/flat/_review/style-bible/` holds `body-a-point.svg`,
`shop-counter.svg`, `scene-bell.svg`, `oldguy-stand.svg`, `newguy-wave.svg` and `hosts-together.svg`; the contact
sheet is `art/flat/_review/style-bible.png`. The source PNGs were generated with the templates above (cast and prop
from the people strip, the hosts from the style-bible person plus the brand sheets).
