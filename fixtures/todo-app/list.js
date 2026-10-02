'use strict';
// Lists the saved todos.
const { loadTodos } = require('./storage');

// Returns every todo, or only the unfinished ones when asked.
function listTodos({ onlyOpen = false } = {}) {
  const todos = loadTodos();
  return onlyOpen ? todos.filter((t) => !t.done) : todos;
}

module.exports = { listTodos };
