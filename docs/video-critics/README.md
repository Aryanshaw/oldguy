# Video critics

Four reusable agents (in `.claude/agents/`) that critique an oldguy video and score it. Give each the path to the video and its folder
(`.oldguy/<slug>/`); run them together and compare.

| Agent | Scores | Asks |
|---|---|---|
| `video-first-time-viewer` | understanding /10, % of flow that stuck | can a newcomer retell it and answer what-ifs? |
| `video-cognitive-psychologist` | cognitive load /10 | is it easy to process? |
| `video-instructional-designer` | instructional design /10 | does it teach? |
| `video-perception-psychologist` | knows where to look /10 | can the eye and ear follow it? |

All four follow `HOW.md`: pull frames, pauses and the script with ffmpeg into a temp folder, judge only what the
video shows, score strictly (9 = retell and answer what-ifs without rewatching), never edit the repository.

For a fair score after changes, use a fresh `video-first-time-viewer` that has not seen earlier versions: a
reviewer who watched several rounds learns the content and scores higher. Example: "Use the video-first-time-viewer
agent on .oldguy/add-todo/add-todo.mp4 with the folder .oldguy/add-todo".
