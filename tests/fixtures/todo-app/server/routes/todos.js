const express = require("express");
const db = require("../db/database");

const router = express.Router();

router.get("/", (req, res) => {
  const todos = db.prepare("SELECT * FROM todos ORDER BY id DESC").all();
  res.json(todos);
});

router.post("/", (req, res) => {
  const { title } = req.body;
  const info = db.prepare("INSERT INTO todos (title, done) VALUES (?, 0)").run(title);
  res.status(201).json({ id: info.lastInsertRowid, title, done: 0 });
});

router.patch("/:id", (req, res) => {
  db.prepare("UPDATE todos SET done = ? WHERE id = ?").run(req.body.done ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM todos WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

module.exports = router;
