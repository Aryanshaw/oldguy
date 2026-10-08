# Old Guy & New Guy: where every asset comes from

| File | What | Source | Licence |
| --- | --- | --- | --- |
| `assets/newguy-talk.webp` | the new guy talking (waving, mouth open) | the oldguy character kit: made from the owner's new-guy brand sheet with a prod-sg image edit model, background removed with prod-sg background removal, cut to 480x880 WebP. Byte-identical to `templates/tutor/assets/newguy-talk.webp`. | the project's own brand characters |
| `assets/newguy-react.webp` | the new guy reacting (standing, hand on hip) | the oldguy character kit (as above); same file as `templates/tutor/assets/newguy-idle.webp` | the project's own |
| `assets/oldguy-talk.webp` | the old guy talking (pointing, mug in hand) | the oldguy character kit, from the owner's old-guy brand sheet; same file as `templates/tutor/assets/oldguy-talk.webp` | the project's own |
| `assets/oldguy-react.webp` | the old guy reacting (thinking, mug in hand) | the oldguy character kit; same file as `templates/tutor/assets/oldguy-idle.webp` | the project's own |
| `assets/oldguy-laugh.webp` | the old guy laughing | the oldguy character kit; same file as `templates/tutor/assets/oldguy-laugh.webp` | the project's own |
| `assets/props/{cap,mug,pencil,computer}.webp` | the old guy's "#1 DEV" cap, "LEGACY CODE FUEL" mug, pencil and 1987 computer | the oldguy character kit's props sheet (prod-sg image model, background removed); same files as `templates/tutor/assets/props/` | the project's own |
| `assets/parkour.mp4` | 12 s square muted loop of Minecraft parkour gameplay, 540x540, 30 fps, H.264, 1,301,453 bytes | "Minecraft Parkour No Copyright Gameplay 4K \| 73" by GameplaysForFree, https://www.youtube.com/watch?v=3DziWHLockg (fetched through prod-sg download_youtube_video at 360p), cut from 2:20 to 2:32, centre-cropped to a square, scaled, audio removed with ffmpeg | offered by the channel as no-copyright, free-to-use gameplay footage (title and channel name). Minecraft is a trademark of Mojang; this is gameplay footage, not Mojang art. |

The reacting poses and the props are inlined into `stage.html` as data URIs by `build-stage.mjs`; the talking poses,
the laughing pose and the footage are copied into each chapter by the stage driver.

## Drawn in the scenes

The old guy's stopwatch and LEGACY CODE FUEL mug, and the new guy's guess card, are drawn as plain shapes (HTML and CSS)
in each chapter's designed scene, in the same colours as the kit pictures: a designed scene may not load pictures. No
file, no licence.
