<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/mascot-dark.svg">
    <img src="docs/assets/mascot.svg" width="160" alt="Yap's mascot, a cheerful wind-up alarm clock">
  </picture>
</p>

<h1 align="center">Yap</h1>

<p align="center">
  <em>Claude yaps. You watch.</em>
</p>

<p align="center">
  <a href="https://github.com/Aryanshaw/yap/stargazers"><img src="https://img.shields.io/github/stars/Aryanshaw/yap?style=flat&logo=github&label=stars" alt="Stars"></a>
  <a href="https://www.npmjs.com/package/getyap"><img src="https://img.shields.io/npm/v/getyap?style=flat&logo=npm&color=CB3837&label=npm" alt="npm"></a>
  <a href="https://github.com/Aryanshaw/yap/actions/workflows/player.yml"><img src="https://img.shields.io/github/actions/workflow/status/Aryanshaw/yap/player.yml?branch=master&style=flat&label=tests" alt="Tests"></a>
  <a href="https://claude.com/claude-code"><img src="https://img.shields.io/badge/works%20with-Claude%20Code-D97757?style=flat" alt="Works with Claude Code"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat" alt="MIT license"></a>
</p>

<p align="center">
  <strong>2&ndash;3 minute videos &middot; every claim cites your code &middot; rendered on your machine</strong><br>
  <sub>Short narrated chapters about how a feature of <em>your</em> codebase works, checked against the real lines before a word is recorded.</sub>
</p>

---

You know the drill. New repo. A 40-page design doc. A Slack thread from last spring that ends in "let's hop on a
call". You open the doc, scroll, close it, and go ask someone how checkout works.

Yap puts a narrator inside Claude Code. Ask how something works, and Claude reads the code and answers with a short
video: a few chapters, a calm voice, and on every claim, the file and lines it came from.

<p align="center">
  <img src="docs/assets/player.png" width="860" alt="The Yap player: a chapter playing, a timeline of chapters, and a chat where Claude answers with the code it used">
</p>

## Install

**Terminal**, one command:

```
npx getyap
```

**Claude Code**, as two separate prompts:

```
/plugin marketplace add Aryanshaw/yap
```
```
/plugin install yap@yap
```

Either way, Yap asks before it sets anything up on your machine (mostly the local voice). To update later, run
`npx getyap` again.

That was it. Go ask it something.

## Before / after

You want to know how checkout works.

**Before:** the design doc, a Slack search, a 30-minute call, and a diagram that was right two refactors ago.

**After:**

```
/yap how does checkout work
```

A few minutes later your browser opens on something like this (an example; your chapters come from your code):

```
1. One click, start to finish           0:28
2. What the cart sends                  0:34    src/cart/submit.ts:12-40
3. Where the price gets checked         0:31    api/orders/create.ts:55-71
4. Paying, and what happens if it fails 0:37    api/payments/charge.ts:20-48
```

Still confused about step 3? Ask in the chat. Claude answers with the code it used, and when a picture would help,
it offers **Make this a video**: one click, one new chapter.

## How it works

```
1. Scope      one flow from your question, for a beginner
2. Verify     every claim cites real lines; a quote that does not match is cut
3. Narrate    a local voice, with captions timed to it
4. Render     short chapters, several at once
5. Watch      a local player, with a chat back to Claude
```

Your repository is only read, never edited. If the feature you asked about is not in the code, Yap says so instead of
making something up.

## Commands

| Command | What it does |
|---------|--------------|
| `/yap <question>` | Make a video about how something in this repo works. |
| `/yap doctor` | Check this machine has what Yap needs, and offer to set up what is missing. |
| Chat, in the player | Ask follow-up questions; Claude answers with the code it used. |
| **Make this a video** | Turn an answer into a new chapter, placed where it fits the story. |
| **Sources**, in the player | The files and lines behind the chapter you are watching. |
| **Export**, in the player | Save the whole video as one mp4, with its script and sources. |
| `npx getyap [--yes \| --plugin-only]` | Install or update Yap; `--yes` sets everything up without asking. |

## FAQ

**Does my code leave my machine?**
No more than it already does with Claude Code. The voice, the rendering and the player all run locally.

**Can it be wrong?**
It can pick a boring flow. It cannot quietly invent one: every sentence that makes a claim is checked against the
lines it cites before anything is recorded.

**Why chapters, not one video?**
So a follow-up question adds a chapter instead of remaking the whole thing.

**What does it need?**
macOS or Linux, Node 22.18+, ffmpeg and Claude Code. `npx getyap` sets up the rest.

**Why "yap"?**
Claude talks a lot anyway. This time you get to watch.

## License

[MIT](LICENSE). Want to help? See [CONTRIBUTING.md](CONTRIBUTING.md).
