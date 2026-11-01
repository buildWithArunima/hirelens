const Database = require("better-sqlite3");
const db = new Database("todos.db");

db.exec(`CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  done INTEGER DEFAULT 0
)`);

module.exports = db;
