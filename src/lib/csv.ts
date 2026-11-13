/** Tải mảng object về dạng CSV (UTF-8 BOM để Excel đọc đúng tiếng Việt). */
export function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  const keys = Object.keys(rows[0] ?? {});
  const cell = (v: unknown) => {
    let s = v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // chặn CSV formula injection
    return `"${s.replace(/"/g, '""')}"`;
  };
  const text = [keys, ...rows.map((r) => keys.map((k) => r[k]))].map((r) => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
}
