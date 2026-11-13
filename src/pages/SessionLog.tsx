import { useParams } from 'react-router';
import { Card, Loading, Review } from '../components/ui';
import { downloadCsv } from '../lib/csv';
import { fmtTime, sessionStatus } from '../lib/format';
import { onForm, useLoad } from '../lib/hooks';
import { q, rpc, supabase } from '../lib/supabase';
import type { EventRow, SessionRow } from '../lib/types';
import { t } from '../lib/i18n';

export default function SessionLog() {
  const sid = Number(useParams().id);
  const { data, error, reload } = useLoad(() => Promise.all([
    q(supabase.from('session_overview').select('*').eq('id', sid).single()) as Promise<SessionRow>,
    q(supabase.from('event_log').select('*').eq('session_id', sid).order('seq')) as Promise<EventRow[]>,
    rpc<{ ok: boolean; broken_at?: number }>('verify_chain', { p_session: sid }),
  ]), [sid]);
  if (!data) return <Loading error={error} />;
  const [s, events, chain] = data;
  return (
    <>
      <h1>{t('Nhật ký phiên thi')}</h1>
      <Card title={t('Phiên #{0} — {1} · {2}', s.id, s.student, s.exam)}>
        <div className="row">
          <span>{t('Trạng thái:')} <span className="tag">{sessionStatus(s)}</span></span>·<span>{t('Điểm:')} <b>{s.score ?? '-'}</b></span>·
          <span>{t('Toàn vẹn chuỗi băm:')} <b className={chain.ok ? 'ok' : 'bad'}>{chain.ok ? t('HỢP LỆ') : t('BỊ SỬA (từ sự kiện #{0})', chain.broken_at)}</b></span>·
          <span>{t('Rà soát:')} <Review v={s.review} /></span>
          <span className="sp" /><button className="ghost" onClick={() => downloadCsv(`phien-${s.id}.csv`, events)}>{t('Xuất CSV')}</button>
        </div>
        <table>
          <thead><tr><th>#</th><th>{t('Giờ')}</th><th>{t('Nguồn')}</th><th>{t('Loại')}</th><th>{t('Chi tiết')}</th><th>{t('Trễ biên→cloud')}</th></tr></thead>
          <tbody>{events.map((e) => (
            <tr key={e.id} className={e.alert ? 'bad' : ''}><td>{e.seq}</td><td>{fmtTime(e.ts)}</td><td>{e.source}</td><td>{e.type}</td>
              <td className="pre">{JSON.stringify(e.detail)}</td><td>{e.latency_ms == null ? '' : `${e.latency_ms} ms`}</td></tr>
          ))}</tbody>
        </table>
        <form className="row form2" onSubmit={onForm((v) => rpc('review_session', { p_session: sid, p_verdict: v.verdict, p_note: v.note }), reload)}>
          {t('Kết luận rà soát')}
          <select name="verdict"><option value="valid">{t('Hợp lệ')}</option><option value="suspicious">{t('Nghi vấn')}</option><option value="invalid">{t('Không hợp lệ')}</option></select>
          <input name="note" placeholder={t('Ghi chú của cán bộ')} className="grow" /><button>{t('Lưu kết luận')}</button>
        </form>
        <p className="muted">{t('Cảnh báo chỉ để cán bộ rà soát — hệ thống không tự kết luận gian lận. Kết luận cũng được ghi vào chuỗi băm nên không thể sửa lặng lẽ.')}</p>
      </Card>
    </>
  );
}
