'use strict';
// Keeps the todo list in one JSON file on disk.
const fs = require('node:fs');
const path = require('node:path');

const DATA_FILE = process.env.TODO_FILE || path.join(__dirname, 'todos.json');

// Reads every saved todo; a missing file means an empty list.
function loadTodos() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

// Writes the whole list back to the file.
function saveTodos(todos) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(todos, null, 2));
}

module.exports = { loadTodos, saveTodos, DATA_FILE };
