import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    el.showModal();
    return () => {
      el.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modalhead">
        <h2>{title}</h2>
        <button type="button" className="iconbtn" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Badge({ children }: { children: ReactNode }) {
  return <span className={`badge ${String(children).replaceAll(' ', '-')}`}>{children}</span>;
}
export function Empty({
  children = 'No records yet. Add your first record to get started.',
}: {
  children?: ReactNode;
}) {
  return <div className="empty">{children}</div>;
}
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card stat">
      <div className="stat-top">
        {label}
        <span className="stat-icon">↗</span>
      </div>
      <strong>{value}</strong>
      <small>{hint || 'Selected period'}</small>
    </div>
  );
}
