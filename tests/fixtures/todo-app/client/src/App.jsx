import { useEffect, useState } from "react";
import TodoItem from "./components/TodoItem";

const API = "http://localhost:4000/api/todos";

export default function App() {
  const [todos, setTodos] = useState([]);
  const [title, setTitle] = useState("");

  useEffect(() => {
    fetch(API).then(r => r.json()).then(setTodos);
  }, []);

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

  async function toggle(todo) {
    await fetch(`${API}/${todo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: !todo.done }),
    });
    setTodos(todos.map(t => (t.id === todo.id ? { ...t, done: !t.done } : t)));
  }

  async function remove(id) {
    await fetch(`${API}/${id}`, { method: "DELETE" });
    setTodos(todos.filter(t => t.id !== id));
  }

  return (
    <main>
      <h1>My Todos</h1>
      <form onSubmit={addTodo}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing?" />
        <button>Add</button>
      </form>
      <ul>
        {todos.map(t => <TodoItem key={t.id} todo={t} onToggle={toggle} onDelete={remove} />)}
      </ul>
    </main>
  );
}
