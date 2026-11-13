import { useEffect, useRef, useState, type ReactNode } from 'react';
import { courseColor, REVIEW, type Role } from '../lib/format';
import { useMe } from '../auth';
import { t } from '../lib/i18n';

export const Card = ({ title, action, children }: { title?: ReactNode; action?: ReactNode; children?: ReactNode }) => (
  <div className="card">{title != null && <h3><span>{title}</span>{action}</h3>}{children}</div>
);

/** Tiêu đề trang + nút hành động ở góc phải. */
export const PageHead = ({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) => (
  <div className="phead"><div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>{children && <div className="pacts">{children}</div>}</div>
);

/** Nút mở hộp thoại (<dialog> gốc: Esc đóng, nhấn nền đóng, khóa focus). Nội dung chỉ dựng khi mở nên form luôn sạch. */
export function ModalButton({ label, title, className, children }: { label: ReactNode; title: ReactNode; className?: string; children: (close: () => void) => ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (d) { if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }
  }, [open]);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{label}</button>
      <dialog ref={ref} onClose={close} onClick={(e) => e.target === ref.current && close()}>
        {open && <div className="dlg">
          <div className="dlg-h"><h3>{title}</h3><button type="button" className="x" aria-label={t('Đóng hộp thoại')} onClick={close}>×</button></div>
          <div className="dlg-b">{children(close)}</div>
        </div>}
      </dialog>
    </>
  );
}
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Loading = ({ error }: { error?: string }) =>
  error ? <div className="empty bad">{error}</div> : <div className="empty">{t('Đang tải…')}</div>;

export const Meter = ({ pct }: { pct: number }) => (
  <><span className="meter"><i style={{ width: `${pct}%` }} /></span>{pct}%</>
);
export const Dot = ({ on }: { on: boolean }) => <><span className={on ? 'dot on' : 'dot'} />{on ? 'Online' : 'Offline'}</>;
export const Swatch = ({ id }: { id?: number | null }) => <span className="sw" style={{ background: courseColor(id) }} />;
export const Review = ({ v }: { v?: string | null }) =>
  v && REVIEW[v] ? <span className={REVIEW[v].cls}>{REVIEW[v].label}</span> : <span className="muted">{t('chưa')}</span>;

export function Tabs<K extends string>({ value, items, onChange }: { value: K; items: [K, string][]; onChange: (k: K) => void }) {
  return (
    <div className="tabs">
      {items.map(([k, label]) => (
        <button type="button" key={k} className={k === value ? 'on' : ''} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  );
}

export const SearchOp = () => (
  <select name="op"><option value="contains">{t('Chứa')}</option><option value="equals">{t('Bằng')}</option><option value="starts">{t('Bắt đầu bằng')}</option></select>
);

/** Chỉ hiện nội dung cho các vai trò được phép (RLS ở DB vẫn là lớp bảo vệ thật). */
export function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { me } = useMe();
  return roles.includes(me.role) ? children : <Empty>{t('Bạn không có quyền xem trang này.')}</Empty>;
}
