import { useState } from 'react';
import { Link } from 'react-router';
import { Card, Empty, Loading } from '../components/ui';
import { downloadCsv } from '../lib/csv';
import { fmt } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { q, rpc, supabase } from '../lib/supabase';
import type { EventRow } from '../lib/types';
import { t } from '../lib/i18n';

type Report = {
  sessions: number; running: number; reviewed: number;
  exams: { exam: string; n: number; avg: number | null }[];
  alerts: { type: string; n: number }[];
  sources: { source: string; n: number }[];
  latency: { n: number; avg: number; p50: number; p95: number; max: number } | null;
  broken: { id: number; broken_at: string }[];
  devices: { total: number; online: number };
};
type Filter = { type: string; source: string; student: string; alerts: boolean };

function EventSearch() {
  const [f, setF] = useState<Filter>({ type: '', source: '', student: '', alerts: false });
  const { data: rows, error } = useLoad(() => {
    let r = supabase.from('event_log').select('id, session_id, seq, ts, source, type, detail, student, exam').order('id', { ascending: false }).limit(300);
    if (f.type) r = r.ilike('type', `%${f.type}%`);
    if (f.source) r = r.eq('source', f.source);
    if (f.student) r = r.ilike('student', `%${f.student}%`);
    if (f.alerts) r = r.eq('alert', true);
    return q(r) as Promise<EventRow[]>;
  }, [f]);
  return (
    <Card title={t('Truy xuất sự kiện')}>
      <form className="row form2" onSubmit={(e) => {
        e.preventDefault();
        const v = new FormData(e.currentTarget);
        setF({ type: String(v.get('type')), source: String(v.get('source')), student: String(v.get('student')), alerts: v.has('alerts') });
      }}>
        <input name="type" placeholder={t('Loại (vd tab_blur)')} />
        <select name="source"><option value="">{t('Mọi nguồn')}</option>{['client', 'edge', 'iot', 'server'].map((s) => <option key={s}>{s}</option>)}</select>
        <input name="student" placeholder={t('Tên sinh viên')} />
        <label><input name="alerts" type="checkbox" /> {t('Chỉ cảnh báo')}</label>
        <button>{t('Tìm')}</button>
        <button type="button" className="ghost" onClick={() => rows && downloadCsv('su-kien.csv', rows)}>{t('Xuất CSV')}</button>
      </form>
      {!rows ? <Loading error={error} /> : rows.length ? (
        <table><thead><tr><th>{t('Thời gian')}</th><th>{t('Phiên')}</th><th>{t('Sinh viên')}</th><th>{t('Kỳ thi')}</th><th>{t('Nguồn')}</th><th>{t('Loại')}</th><th>{t('Chi tiết')}</th></tr></thead>
          <tbody>{rows.map((e) => (
            <tr key={e.id}><td>{fmt(e.ts)}</td><td><Link to={`/sessions/${e.session_id}`}>#{e.session_id}</Link></td><td>{e.student}</td><td>{e.exam}</td>
              <td>{e.source}</td><td>{e.type}</td><td className="pre">{JSON.stringify(e.detail)}</td></tr>
          ))}</tbody></table>
      ) : <Empty>{t('Không có sự kiện phù hợp.')}</Empty>}
    </Card>
  );
}

export default function Reports() {
  const { data: r, error } = useLoad(() => rpc<Report>('system_report'));
  if (!r) return <Loading error={error} />;
  const nAlerts = r.alerts.reduce((a, x) => a + x.n, 0), maxA = Math.max(1, ...r.alerts.map((a) => a.n));
  const stats: [React.ReactNode, string][] = [
    [r.sessions, t('Phiên thi')], [r.running, t('Chưa nộp')], [nAlerts, t('Sự kiện cảnh báo')], [`${r.reviewed}/${r.sessions}`, t('Phiên đã rà soát')],
    [r.latency ? `${r.latency.p95} ms` : '—', t('Độ trễ p95 biên → cloud')], [`${r.devices.online}/${r.devices.total}`, t('Thiết bị online')],
    [r.broken.length ? <span className="bad">{r.broken.length} {t('lỗi')}</span> : <span className="ok">{t('Toàn vẹn')}</span>, t('Chuỗi băm nhật ký')],
  ];
  return (
    <>
      <h1>{t('Báo cáo & truy xuất')}</h1>
      <div className="stats">{stats.map(([n, l]) => <div className="stat" key={l}><b>{n}</b><span>{l}</span></div>)}</div>
      <div className="cols">
        <div>
          <Card title={t('Cảnh báo theo loại')}>
            {r.alerts.length ? <table><tbody>{r.alerts.map((a) => (
              <tr key={a.type}><td>{a.type}</td><td>{a.n}</td><td className="w55"><span className="meter full" style={{ width: `${Math.max(4, (a.n / maxA) * 100)}%` }}><i /></span></td></tr>
            ))}</tbody></table> : <Empty>{t('Chưa có cảnh báo.')}</Empty>}
          </Card>
          <Card title={t('Sự kiện theo nguồn')}>
            {r.sources.length ? <table><thead><tr><th>{t('Nguồn')}</th><th>{t('Số sự kiện')}</th></tr></thead>
              <tbody>{r.sources.map((s) => <tr key={s.source}><td>{s.source}</td><td>{s.n}</td></tr>)}</tbody></table> : <Empty>{t('Chưa có dữ liệu.')}</Empty>}
          </Card>
        </div>
        <div>
          <Card title={t('Độ trễ biên → cloud (sự kiện IoT/Edge)')}>
            {r.latency ? <table><thead><tr><th>{t('Số mẫu')}</th><th>{t('Trung bình')}</th><th>p50</th><th>p95</th><th>Max</th></tr></thead>
              <tbody><tr><td>{r.latency.n}</td><td>{r.latency.avg} ms</td><td>{r.latency.p50} ms</td><td>{r.latency.p95} ms</td><td>{r.latency.max} ms</td></tr></tbody></table>
              : <Empty>{t('Chạy npm run sim để có số liệu.')}</Empty>}
          </Card>
          <Card title={t('Điểm trung bình theo kỳ thi')}>
            {r.exams.length ? <table><thead><tr><th>{t('Kỳ thi')}</th><th>{t('Số phiên')}</th><th>{t('Điểm TB')}</th></tr></thead>
              <tbody>{r.exams.map((x) => <tr key={x.exam}><td>{x.exam}</td><td>{x.n}</td><td>{x.avg ?? '-'}</td></tr>)}</tbody></table> : <Empty>{t('Chưa có dữ liệu.')}</Empty>}
          </Card>
          <Card title={t('Kiểm tra toàn vẹn')}><div>
            {r.broken.length ? r.broken.map((b) => <div className="bad" key={b.id}><Link to={`/sessions/${b.id}`}>{t('Phiên #')}{b.id}</Link> {t('bị sửa từ sự kiện #')}{b.broken_at}</div>)
              : <span className="ok">{t('Tất cả')} {r.sessions} {t('phiên có chuỗi băm hợp lệ.')}</span>}
          </div></Card>
        </div>
      </div>
      <EventSearch />
    </>
  );
}
