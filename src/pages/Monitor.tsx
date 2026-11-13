import { useEffect } from 'react';
import { Link } from 'react-router';
import { Card, Dot, Empty, Loading } from '../components/ui';
import { clock, fmt, fmtTime } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { q, supabase } from '../lib/supabase';
import type { EventRow, SessionRow } from '../lib/types';
import { locale, t } from '../lib/i18n';

export const isOnline = (lastSeen: string | null) => !!lastSeen && Date.now() - new Date(lastSeen).getTime() < 15000;

// ponytail: hỏi lại mỗi 3 giây; chuyển sang Supabase Realtime (postgres_changes trên events) khi số phòng thi lớn.
export default function Monitor() {
  const { data, error, reload } = useLoad(() => Promise.all([
    q(supabase.from('session_overview').select('*').eq('status', 'running').gt('deadline', new Date().toISOString()).order('id')) as Promise<SessionRow[]>,
    q(supabase.from('devices').select('id, name, room, last_seen').order('room')),
    q(supabase.from('event_log').select('id, session_id, ts, source, type, student').eq('alert', true).order('id', { ascending: false }).limit(15)) as Promise<EventRow[]>,
  ]));
  useEffect(() => { const timer = setInterval(reload, 3000); return () => clearInterval(timer); }, [reload]);
  if (!data) return <Loading error={error} />;
  const [live, devices, alerts] = data, now = Date.now();
  return (
    <>
      <h1>{t('Giám sát thi')}</h1>
      <p className="muted">{t('Tự cập nhật mỗi 3 giây ·')} {new Date().toLocaleTimeString(locale)}</p>
      <div className="cols">
        <div>
          <Card title={t('Phiên đang thi ({0})', live.length)}>
            {live.length ? (
              <table><thead><tr><th>#</th><th>{t('Sinh viên')}</th><th>{t('Kỳ thi')}</th><th>{t('Còn lại')}</th><th>{t('Cảnh báo')}</th><th>{t('Sự kiện cuối')}</th><th /></tr></thead>
                <tbody>{live.map((s) => (
                  <tr key={s.id}><td>{s.id}</td><td>{s.student}</td><td>{s.exam}</td><td>{clock(new Date(s.deadline).getTime() - now)}</td>
                    <td className={s.alerts ? 'bad' : ''}>{s.alerts}</td>
                    <td>{s.last_type} <span className="muted">{s.last_ts && t('{0}s trước', Math.round((now - new Date(s.last_ts).getTime()) / 1000))}</span></td>
                    <td><Link className="btn ghost" to={`/sessions/${s.id}`}>{t('Nhật ký')}</Link></td></tr>
                ))}</tbody></table>
            ) : <Empty>{t('Không có phiên thi nào đang diễn ra.')}</Empty>}
          </Card>
          <Card title={t('Cảnh báo mới nhất')}>
            {alerts.length ? (
              <table><thead><tr><th>{t('Giờ')}</th><th>{t('Sinh viên')}</th><th>{t('Loại')}</th><th>{t('Nguồn')}</th><th>{t('Phiên')}</th></tr></thead>
                <tbody>{alerts.map((e) => (
                  <tr key={e.id}><td>{fmtTime(e.ts)}</td><td>{e.student}</td><td className="bad">{e.type}</td><td>{e.source}</td><td><Link to={`/sessions/${e.session_id}`}>#{e.session_id}</Link></td></tr>
                ))}</tbody></table>
            ) : <Empty>{t('Chưa có cảnh báo.')}</Empty>}
          </Card>
        </div>
        <Card title={t('Thiết bị IoT / Edge')}>
          {devices.length ? (
            <table><thead><tr><th>{t('Trạng thái')}</th><th>{t('Thiết bị')}</th><th>{t('Phòng')}</th><th>{t('Liên lạc cuối')}</th></tr></thead>
              <tbody>{devices.map((d) => <tr key={d.id}><td><Dot on={isOnline(d.last_seen)} /></td><td>{d.name}</td><td>{d.room}</td><td>{fmt(d.last_seen) || '—'}</td></tr>)}</tbody></table>
          ) : <Empty>{t('Chưa đăng ký thiết bị.')}</Empty>}
        </Card>
      </div>
    </>
  );
}
