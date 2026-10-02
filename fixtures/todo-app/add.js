'use strict';
// Adds one new todo to the list.
const { loadTodos, saveTodos } = require('./storage');

// Checks the title, gives the todo the next id, and saves it.
function addTodo(title) {
  const text = String(title || '').trim();
  if (text === '') throw new Error('a todo needs a title');
  const todos = loadTodos();
  const id = todos.length === 0 ? 1 : Math.max(...todos.map((t) => t.id)) + 1;
  const todo = { id, title: text, done: false, createdAt: new Date().toISOString() };
  todos.push(todo);
  saveTodos(todos);
  return todo;
}

module.exports = { addTodo };
