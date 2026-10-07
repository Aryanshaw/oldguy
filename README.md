<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/mascot-dark.svg">
    <img src="docs/assets/mascot.svg" width="150" alt="Yap's mascot, a cheerful wind-up alarm clock">
  </picture>
</p>

<h1 align="center">Yap</h1>

<p align="center">
  <em>Claude yaps. You watch.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/github/stars/Aryanshaw/yap?style=flat-square&color=111111&label=stars" alt="Stars">
  <img src="https://img.shields.io/npm/v/getyap?style=flat-square&color=111111&label=npm" alt="npm">
  <img src="https://img.shields.io/badge/works%20with-Claude%20Code-111111?style=flat-square" alt="Works with Claude Code">
  <img src="https://img.shields.io/badge/license-MIT-111111?style=flat-square" alt="MIT license">
</p>

---

You joined a new codebase. Someone sends you a 40-page design doc. You open it, scroll, close it, and ask in Slack
how checkout works instead.

Yap makes Claude answer with a short video. It reads your code, explains the flow in two or three minutes of
narrated chapters, and every claim points at the real lines it came from.

<p align="center">
  <img src="docs/assets/player.png" width="860" alt="The Yap player: a chapter playing, a timeline of chapters, and a chat where Claude answers with the code it used">
</p>

## Install

```
npx getyap
```

That's it. It adds Yap to Claude Code and asks before setting up anything else (the local voice, mostly).

Prefer doing it from inside Claude Code? Two prompts:

```
/plugin marketplace add Aryanshaw/yap
```
```
/plugin install yap@yap
```

## Use

```
/yap how does checkout work
```

Claude picks the flow, checks it against the code, records the chapters and opens them in your browser. Keep asking
in the chat: it answers with the code it used, and when a picture would help it offers **Make this a video**.

## How it works

```
1. Scope      one flow from your question
2. Verify     every claim cites real lines; a quote that does not match is cut
3. Narrate    a local voice, with captions timed to it
4. Render     short chapters, several at once
5. Watch      a local player, with a chat back to Claude
```

Everything runs on your machine. Your repository is only read, never edited.

## FAQ

**Does my code leave my machine?**
No more than it already does with Claude Code. The voice, the rendering and the player are all local.

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
