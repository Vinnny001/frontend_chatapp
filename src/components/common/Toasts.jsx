import { useUI } from '../../store/ui.js';

export default function Toasts() {
  const toasts = useUI((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
