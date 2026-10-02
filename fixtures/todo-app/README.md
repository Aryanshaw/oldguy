# todo-app

A tiny todo list with no dependencies, used to test Yap.

- `add.js` adds a todo, `list.js` lists them, `complete.js` marks one done.
- `storage.js` keeps every todo in `todos.json` (or the file named by `TODO_FILE`).
- `server.js` serves them over HTTP on port 3000.

Run `node server.js`, then `POST /todos` with `{"title":"buy milk"}`.
`GET /todos` lists todos and `POST /todos/1/done` completes the first one.
Run `node smoke.js` to check everything works.
