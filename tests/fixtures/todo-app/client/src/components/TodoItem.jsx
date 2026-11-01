export default function TodoItem({ todo, onToggle, onDelete }) {
  return (
    <li>
      <input type="checkbox" checked={!!todo.done} onChange={() => onToggle(todo)} />
      <span style={{ textDecoration: todo.done ? "line-through" : "none" }}>{todo.title}</span>
      <button onClick={() => onDelete(todo.id)}>Delete</button>
    </li>
  );
}
