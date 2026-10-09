# Flat art style prompt

The fixed prompt for every library image. Model, calls and the rest of the pipeline: `RUNBOOK.md`. Look target:
TED-Ed illustrated lessons (reference: "Hawking's black hole paradox explained"): flat vector art, solid fills, no
outlines, a small warm-on-cool palette, geometric people with long necks, dot eyes and bar brows.

## What the look is (checklist for judging a result)

- Solid flat fills only. No outline, no line art, no gradient, no shading or highlight, no texture or grain, no drop
  shadow. Interior detail is a separate flat shape (a fold is a slightly different fill, never a line).
- **Faces have character (hard rule, from the Gate 1 review).** Small solid dark oval eyes (no whites) under a
  **heavy lid**: a flat shape one skin step darker cutting the top of each eye. Thick flat bar brows that are
  **angled** to carry the feeling (inner ends down for focus or anger, up for worry). **Coloured lips**: a small flat
  `coralDark` or `peachDark` shape, never a plain dark line. One angular nose shape a step darker than the skin, a
  clear jaw line, a face slightly longer than wide. Every pose names an expression; no blank or generic smiles. No
  blush, no eyelashes.
- **Hands (hard rule).** Simple and readable like TED-Ed: four fingers grouped as one or two flat shapes plus a clean
  thumb shape; a pointing hand shows the index finger. No mittens, no blobs, no finger or knuckle lines.
- **Words only on cards (hard rule).** No lettering in the art except where it is part of a host's identity and
  large (at least ~20 px tall in the generated image): the old guy's cap "#1 DEV" and his mug "LEGACY CODE FUEL".
  Badges, stickers, signs and screens are blank coloured shapes; the compiler puts readable words on cards.
- Bodies: slightly elongated, long neck, narrow shoulders, simple tube limbs. Clothes are big single-colour shapes.
- Hair: one or two flat shapes with a simple silhouette, never strands.
- Props: big simple geometric shapes with crisp edges, drawn so they read as the thing at a glance (a counter has a
  till and an overhanging top, not just a box); straight-on front views.
- Colour: only palette colours (below), cool grounds with warm accents. Skin and hair from the skin/hair tokens.
- One subject, centred, full body unless the pose says close-up, on plain `#FFFFFF` (cut out later).

## Size

Every library SVG is at most **20 KB** (compiled scenes inline every drawing). Prompts ask for big simple shapes and
minimal detail partly for this reason: a person at the default `vectorize.py` settings is about 7-9 KB, a prop 3-6 KB,
a host 12-19 KB.

## Palette (exact hex, from `art/flat/PALETTE.json`)

The file is grouped (`groups.<group>.<token>`; tools name a colour `group.token`, and `--allow` also takes the bare
token, which is unique). Same file as the code track (`lib/catalog.mts` reads it), plus `grounds.periwinkle` and
`floors.periwinkleFloor`.

- grounds: `indigo #221C55`, `blue #1F5FA8`, `offwhite #F2EDE1`, `nearblack #16141F`, `periwinkle #5558A5`
- floors (drawn in code): `indigoFloor #2D2668`, `blueFloor #1A5091`, `offwhiteFloor #E0D8C4`, `nearblackFloor #24212F`,
  `periwinkleFloor #464A94`
- accents: `coral #FF6B57`, `peach #F6A57C`, `yellow #F6C945`, `lilac #9A8FE6`, `orange #FF8A1F`
- neutrals: `sky #8CCBEB` (pale blue: lab coats, shirts), `grey #B9B4D6`, `wood #C99A62` (also khaki trousers)
- shades: `coralDark #D9493A`, `peachDark #D9845C`, `yellowDark #D9A520`, `lilacDark #6F63C4`, `orangeDark #D96A0A`,
  `skyDark #5FA6CC`, `greyDark #7D7899`, `woodDark #9C7444`
- skin: `skin1 #F9D3B4`, `skin2 #F0B48A`, `skin3 #D28C5E`, `skin4 #A8653D`, `skin5 #6B3D25`
- hair: `hairInk #1B1640`, `hairBrown #5A3420`, `hairAuburn #A8432A`, `hairBlond #E9C46A`, `hairGrey #C9C5D6`,
  `hairRed #D9502F`
- marks: `chalk #FFFFFF`, `paper #FFF8E7`, `ink #14110A`

Cast are drawn in the `coral` colourway (skin `skin2`, hair `hairInk`, top `coral`, bottom `blue`, shoes `ink`) so the
five recolour groups are five clearly different fills; the compiler swaps them for the other colourways. Eyes and
brows are `hairInk`, lids and nose `peachDark` on `skin2` (one skin step darker on other skins), lips `coralDark`.

## STYLE block (paste first in every prompt)

```
Draw in EXACTLY the flat illustration style of the reference frames (TED-Ed animated lesson style): flat 2D vector
art, solid flat colour fills only, NO outlines, NO line art, NO gradients, NO shading, NO texture, NO drop shadows.
Face with TED-Ed character: small solid dark oval eyes under heavy flat lids (a skin-shade shape covering the top of
each eye), thick flat bar eyebrows ANGLED to show the expression, a small flat coral lip shape, one simple angular nose
shape in a darker skin tone, a clear jaw. Hands: four fingers grouped as simple flat shapes plus a clean thumb, no
mittens, no finger lines. Slightly elongated simple proportions, long neck. Big simple shapes, minimal detail. No
lettering.
```

## Negative list (append when a result drifts)

`no outlines, no black contour lines, no sketch lines, no cross-hatching, no gradients, no soft shading, no
highlights, no paper texture, no grain, no drop shadow, no floor shadow, no background objects, no text or letters, no
eye whites, no eyelashes, no blush, no blank smile, no mitten hands, no finger lines, no hair strands, no 3D, no
isometric camera, no photo-real hands`

## Templates

Fill the `<…>` parts; keep the rest word for word. Colours are always given as hex from the palette.

### cast pose

```
<STYLE block> Match the <model sheet | style-bible person> reference exactly (same construction, same face, same
flatness).
Subject: ONE <body description, e.g. lanky young man>, full body head to toe, <pose sentence, e.g. standing,
three-quarter view facing right, right arm stretched straight out POINTING with the index finger at something
off-picture, other arm relaxed>, <expression, e.g. focused: brows angled down, lids heavy, lips set>. Hair #1B1640,
skin #F0B48A with lids and nose #D9845C, lips #D9493A, top #FF6B57, trousers #1F5FA8, shoes #14110A. Eyes and brows
#1B1640.
Use only these exact colours. Centred on a plain pure white #FFFFFF background, nothing else, no floor, no shadow,
no text.
```

References: the body's model sheet first (or the style-bible person until model sheets exist) + TED-Ed crowd frame
(faces) + TED-Ed people strip.
### model sheet (cast body)

```
MODEL SHEET, body <A|B|C>. <A NEW character | Draw the man from the first reference image> in exactly the same flat
TED-Ed construction as the man in the first reference image: <build, age, hair shape>. NEUTRAL FRONT view: standing
straight, facing the viewer, full body head to toe, feet slightly apart, both arms hanging relaxed a little away from
the body so the hands are clear of the torso. Face with TED-Ed character: <eyes, lids, angled brows, lips, mood>.
Hands: four fingers grouped as a flat shape plus a clean thumb, no mittens, no finger lines.
Keep five clearly separate flat colour groups: skin #F0B48A (face, neck, hands), hair #1B1640, top #FF6B57,
trousers #1F5FA8, shoes #14110A. Lids and nose #D9845C, lips #D9493A, eyes and brows #1B1640.
<STYLE block tail: flat fills only, no outlines…> Centred on a plain pure white #FFFFFF background.
```

References: the approved body A point pose first, then the TED-Ed people strip and crowd frame.

### host pose

The first attempt ("redraw the brand-sheet character in TED-Ed style") kept the brand sheets' cartoon construction
(bulb noses, outlines, finger lines). What works: lead with our own approved flat person as the style anchor, use the
brand sheets for identity only, and draw each host alone at `size: "2K"`:

```
<MODEL SHEET, host: the old guy | the new guy | the pose sentence>. Draw <host> from the second reference image (his
identity: features, costume, colours) in exactly the same flat TED-Ed construction as the man in the first reference
image. <view and pose>. Face with TED-Ed character: <lids, angled brows, lips, mood>. Hands: four fingers grouped as a
flat shape plus a clean thumb, no mittens, no finger or knuckle lines.
Identity: <identity line, below>.
No other text anywhere. <STYLE block tail> Centred on a plain pure white #FFFFFF background.
```

Identity lines (keep every feature; the only words allowed are the old guy's cap and mug):

- Old guy: `short and chubby older developer, round belly, big red-orange beard and hair as one smooth flat shape
  #D9502F, skin #F0B48A, lids and nose #D9845C, lips #D9493A, round glasses with flat frames #1B1640, trucker cap:
  crown #6F63C4 and cream front panel #FFF8E7 reading "#1 DEV" in large thick #1B1640 letters, small flat headset
  with mic arm #14110A, yellow pencil behind his ear, yellow t-shirt #F6C945 with a simple flat sunflower (petals
  #FF8A1F, centre #5A3420), jeans #1F5FA8, dark sandals #5A3420, a cream mug #FFF8E7 with "LEGACY CODE FUEL" in three
  lines of large thick #1B1640 letters filling the mug face`
- New guy: `tall skinny junior with a long neck, big curly brown hair as one simple flat cloud shape #5A3420,
  backwards cap #1F5FA8 with a small blank cream tag #FFF8E7 hanging off it, skin #F9D3B4, lids and nose #D9845C,
  white polo shirt #FFFFFF, a BLANK pink name sticker (a #FF6B57 rounded rectangle with a blank white panel, no
  letters), a blue #1F5FA8 lanyard with a BLANK lilac #9A8FE6 badge card, khaki trousers #C99A62, white sneakers with
  blue #1F5FA8 accents`

References, in this order: the approved body A point pose, the earlier flat hosts image (identity and layout), the
TED-Ed crowd frame (its bearded men are the model for the old guy's beard), the host's brand-sheet panel; from Task 10
on, the approved host model sheet first.

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
