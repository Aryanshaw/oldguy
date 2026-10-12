# How every video critic works (shared by the agents in this folder)

Input: a path to a video (an `.mp4`), and if there is one, the video folder (`.oldguy/<slug>/`) with `script.md`
(every narrated sentence, in order) and `chapters/<id>/beats.json` (when each sentence starts).

1. Make a scratch folder outside the repository (`mktemp -d`) and pull the evidence with ffmpeg:
   - a frame every 4 s: `ffmpeg -v error -i <video> -vf fps=1/4,scale=1280:-1 <tmp>/f%03d.jpg`
   - the length: `ffprobe -v error -show_entries format=duration -of csv=p=0 <video>`
   - pauses: `ffmpeg -i <video> -af silencedetect=n=-40dB:d=0.5 -f null - 2>&1 | grep silence_duration`
2. Read `script.md` and each chapter's `beats.json` (start times) so frames line up with sentences. With no script,
   say so and judge from the frames alone.
3. Look at every frame in order. Judge only what the video gives a viewer: do not read the repository's source to
   fill gaps the video leaves.
4. Score strictly. 9/10 means a newcomer could retell the whole flow and answer "why" and "what if" questions about
   it without rewatching; 10 means nothing is left unclear and it would be hard to make clearer. Never round up to be
   kind, and say exactly what earned any point above 8.
5. Report in under 600 words, in the format your own file asks for, ending with the top problems ranked, each with a
   concrete fix (what to change on screen or in the script, and where).

Never edit, write or delete files in the repository; scratch frames go in the temp folder only.
The rules these videos are meant to follow are in `skills/oldguy/references/teaching.md`; cite a rule when a
problem breaks one.
