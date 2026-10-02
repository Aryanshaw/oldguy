'use strict';
// Marks a todo as done.
const { loadTodos, saveTodos } = require('./storage');

// Finds the todo by id, sets done, and saves the list.
function completeTodo(id) {
  const todos = loadTodos();
  const todo = todos.find((t) => t.id === Number(id));
  if (!todo) throw new Error(`no todo with id ${id}`);
  todo.done = true;
  saveTodos(todos);
  return todo;
}

module.exports = { completeTodo };
