# Assignment review: todo-app

**Score:** 60.1 / 95 (63%) · **Recommendation:** Advance

_1 rubric item(s) could not be assessed from the code and are left out of the total (full rubric is 100 pts). Check them in the interview._

Repo: tests/fixtures/todo-app · Reviewed 9 of 9 files · Graded against an intern-level bar

## Summary

A small, working full-stack todo app with a clean Express + SQLite backend and a simple React UI. The main gaps are server-side validation and error handling, which are very normal at intern level.

## ⚠️ Red flags

- A .env file is committed to the repo. Check whether it contains real secrets (API keys, DB passwords).

## Scorecard

| # | Rubric item | Rating | Points | Confidence |
|---|---|---|---|---|
| R1 | Functionality | 🟢 Meets intern bar | 18.8 / 25 | high |
| R2 | Backend API design | 🟢 Meets intern bar | 15 / 20 | high |
| R3 | Frontend | 🟡 Partially meets | 10 / 20 | medium |
| R4 | Code quality | 🟢 Meets intern bar | 11.3 / 15 | low |
| R5 | Validation & error handling | 🟠 Minimal | 2.5 / 10 | high |
| R6 | Documentation & setup | 🟡 Partially meets | 2.5 / 5 | high |
| R7 | Testing | ⚪ Can't assess | – / 5 | low |

## Requirements checklist

- ✅ Create, view, complete, delete todos _(client/src/App.jsx, server/routes/todos.js)_
- ✅ Persist todos in a database _(server/db/database.js (SQLite))_
- 🟡 Basic input validation _(client only)_

## Strengths and growth areas

**Strengths**

- End-to-end CRUD works
- Clear separation of routes and DB

**Growth areas (coach, don't penalize)**

- Server-side validation
- Showing API errors in the UI
- Tests

## Detailed review

### R1. Functionality: 🟢 Meets intern bar (18.8 / 25)

> All CRUD operations work end to end from the UI.

Create, list, toggle and delete are all wired from the React UI to the Express API and persisted in SQLite.

- **Strength** `client/src/App.jsx:14-25`: Add flow posts to the API and updates state.

  ```jsx
    async function addTodo(e) {
      e.preventDefault();
      if (!title.trim()) return;
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const todo = await res.json();
      setTodos([todo, ...todos]);
      setTitle("");
    }
  ```

- **Strength** `server/routes/todos.js:21-24`: Delete endpoint backs the UI button.

  ```js
  
  router.delete("/:id", (req, res) => {
    db.prepare("DELETE FROM todos WHERE id = ?").run(req.params.id);
    res.status(204).end();
  ```


**Tip for the candidate:** Re-fetch or reconcile with the server response after toggling so UI and DB can't drift.

**Ask in the interview:** Walk me through what happens, from click to database, when I tick a todo as done.

### R2. Backend API design: 🟢 Meets intern bar (15 / 20)

> Sensible REST routes, status codes, separation of routes and data access.

Routes are RESTful and live in their own router; the DB is a separate module. PATCH returns {ok:true} instead of the updated todo, and there is no 404 for unknown ids.

- **Strength** `server/index.js:8`: Router mounted under a clear resource path.

  ```js
  app.use("/api/todos", todosRouter);
  ```

- **Gap** `server/routes/todos.js:16-19`: No 404 when the id doesn't exist.

  ```js
  
  router.patch("/:id", (req, res) => {
    db.prepare("UPDATE todos SET done = ? WHERE id = ?").run(req.body.done ? 1 : 0, req.params.id);
    res.json({ ok: true });
  ```


**Tip for the candidate:** Return 404 when changes === 0, and return the updated row from PATCH.

**Ask in the interview:** What status code should PATCH /api/todos/999 return if that todo doesn't exist?

### R3. Frontend: 🟡 Partially meets (10 / 20)

> Components are reasonably split, state is handled correctly, API errors are shown to the user.

Component split is fine for the size, but fetch errors are never caught or shown.

- **Strength** `client/src/components/TodoItem.jsx:1-9`: Presentational component with callbacks.

  ```jsx
  export default function TodoItem({ todo, onToggle, onDelete }) {
    return (
      <li>
        <input type="checkbox" checked={!!todo.done} onChange={() => onToggle(todo)} />
        <span style={{ textDecoration: todo.done ? "line-through" : "none" }}>{todo.title}</span>
        <button onClick={() => onDelete(todo.id)}>Delete</button>
      </li>
    );
  }
  ```

- **Gap** `client/src/App.jsx:10-12`: No .catch; a down API leaves a silent empty list.

  ```jsx
    useEffect(() => {
      fetch(API).then(r => r.json()).then(setTodos);
    }, []);
  ```


**Tip for the candidate:** Add an error state and show a message when a request fails.

**Ask in the interview:** What does the user see if the server is down when the page loads?

### R4. Code quality: 🟢 Meets intern bar (11.3 / 15)

> Readable naming, no large duplicated blocks, consistent formatting.

Readable and consistent.

> ⚠️ No verified code evidence backs this rating. Check it yourself.

> ⚠️ Some cited evidence could not be found in the code.

- **Strength** `server/utils/helpers.js:1-5`: Helper functions are reused. ⚠️ _file does not exist in the repo, ignore this_

**Tip for the candidate:** Move the API URL to an env variable.

**Ask in the interview:** Why did you hardcode the API URL?

### R5. Validation & error handling: 🟠 Minimal (2.5 / 10)

> Empty or invalid input is rejected on the server; errors don't crash the app.

The client blocks empty titles, but the server inserts whatever it gets. A null title would hit the NOT NULL constraint and throw a 500.

- **Gap** `server/routes/todos.js:10-13`: No server-side validation.

  ```js
  
  router.post("/", (req, res) => {
    const { title } = req.body;
    const info = db.prepare("INSERT INTO todos (title, done) VALUES (?, 0)").run(title);
  ```

- **Strength** `client/src/App.jsx:16`: Client-side guard against empty input.

  ```jsx
      if (!title.trim()) return;
  ```


**Tip for the candidate:** Validate on the server too and return 400 with a message.

**Ask in the interview:** If I call your POST endpoint with curl and no body, what happens?

### R6. Documentation & setup: 🟡 Partially meets (2.5 / 5)

> README explains setup and run steps; secrets are not committed.

README has run steps, but a .env with a password is committed.

- **Strength** `README.md:3-4`: Clear run commands.

  ```md
  Run the server: `cd server && npm install && node index.js`
  Run the client: `cd client && npm install && npm run dev`
  ```

- **Gap** `.env:1`: Secret committed to git.

  ```env
  DB_PASSWORD=supersecret123
  ```


**Tip for the candidate:** Add .env to .gitignore and commit a .env.example instead.

**Ask in the interview:** How would you keep secrets out of a public repo?

### R7. Testing: ⚪ Can't assess (– / 5)

> Any automated tests, even a few, are a plus.

The model did not return a rating for this item. Review it manually.

> ⚠️ The reviewer skipped this item.


---
_Files reviewed: `README.md`, `client/src/App.jsx`, `.env`, `server/index.js`, `client/package.json`, `server/package.json`, `server/routes/todos.js`, `server/db/database.js`, `client/src/components/TodoItem.jsx`_
