import { Link, useParams } from 'react-router';
import { useMe } from '../auth';
import { Card, Empty, Loading, Review } from '../components/ui';
import { downloadCsv } from '../lib/csv';
import { fmt } from '../lib/format';
import { act, useLoad } from '../lib/hooks';
import { t } from '../lib/i18n';
import { first, q, rpc, supabase } from '../lib/supabase';

type Row = { user_id: string; student: string; email: string; session_id: number | null; status: 'absent' | 'running' | 'done' | 'late';
  score: number | null; started_at: string | null; submitted_at: string | null; alerts: number; review: string | null };

/** Kết quả một bài thi cho giảng viên / admin: cả lớp, kể cả sinh viên chưa làm. */
export default function ExamResults() {
  const id = Number(useParams().id);
  const { me } = useMe();
  const { data, error, reload } = useLoad(() => Promise.all([
    q(supabase.from('exams').select('*, courses(id, code, title, section, teacher_id)').eq('id', id).single()),
    rpc<Row[]>('exam_results', { p_exam: id }),
  ]), [id]);
  if (!data) return <Loading error={error} />;
  const [x, rows] = data;
  const course = first(x.courses) as { id: number; code: string; title: string; section: string; teacher_id: string };
  const closed = new Date(x.closes_at) < new Date();
  const status = (r: Row) => ({ absent: closed ? t('Vắng thi') : t('Chưa làm'), running: t('đang thi'), done: t('đã nộp'), late: t('nộp muộn') })[r.status];
  const scores = rows.filter((r) => r.score != null).map((r) => Number(r.score));
  const round = (n: number) => Math.round(n * 100) / 100;
  const stats: [string | number, string][] = [
    [`${rows.filter((r) => r.submitted_at).length}/${rows.length}`, t('Đã nộp')],
    [scores.length ? round(scores.reduce((a, b) => a + b, 0) / scores.length) : '-', t('Điểm TB')],
    [scores.length ? Math.max(...scores) : '-', t('Cao nhất')],
    [scores.length ? Math.min(...scores) : '-', t('Thấp nhất')],
    [rows.filter((r) => r.alerts > 0).length, t('Bài có cảnh báo')],
  ];
  const canPublish = course.teacher_id === me.id; // chỉ GV phụ trách đổi thiết lập (RLS exams_write)
  const toggle = () => act(() => q(supabase.from('exams').update({ show_score: !x.show_score }).eq('id', id)), reload);
  const csv = () => downloadCsv(`ket-qua-${course.code}-${course.section}-${id}.csv`, rows.map((r) => ({
    [t('Sinh viên')]: r.student, Email: r.email, [t('Trạng thái')]: status(r), [t('Điểm')]: r.score ?? '',
    [t('Nộp lúc')]: fmt(r.submitted_at), [t('Cảnh báo')]: r.alerts, [t('Rà soát')]: r.review ?? '',
  })));

  return (
    <>
      <p><Link to="/exams">{t('← Quay lại danh sách kỳ thi')}</Link></p>
      <h1>{t('Kết quả: {0}', x.title)}</h1>
      <p className="muted">{course.code} — {course.title} · {t('Nhóm')} {course.section} · {fmt(x.opens_at)} → {fmt(x.closes_at)} · {x.minutes} {t('phút')}</p>
      <div className="stats">{stats.map(([n, l]) => <div className="stat" key={l}><b>{n}</b><span>{l}</span></div>)}</div>
      <Card title={t('Điểm từng sinh viên')}>
        <div className="row filter">
          {x.show_score ? <span className="ok">{t('Sinh viên đang xem được điểm.')}</span> : <span className="amber">{t('Điểm đang ẩn với sinh viên.')}</span>}
          {canPublish && <button className={x.show_score ? 'ghost' : ''} onClick={toggle}>{x.show_score ? t('Ẩn điểm') : t('Công bố điểm')}</button>}
          <span className="grow" />
          <button className="ghost" onClick={csv} disabled={!rows.length}>{t('Xuất CSV')}</button>
        </div>
        {rows.length ? (
          <table>
            <thead><tr><th>#</th><th>{t('Sinh viên')}</th><th>Email</th><th>{t('Trạng thái')}</th><th>{t('Điểm')}</th><th>{t('Nộp lúc')}</th><th>{t('Cảnh báo')}</th><th>{t('Rà soát')}</th><th /></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={r.user_id}>
                <td>{i + 1}</td><td>{r.student}</td><td>{r.email}</td>
                <td><span className={r.status === 'absent' && closed ? 'bad' : 'tag'}>{status(r)}</span></td>
                <td>{r.score != null ? <b>{Number(r.score)}</b> : '-'}</td>
                <td>{fmt(r.submitted_at)}</td>
                <td className={r.alerts ? 'bad' : ''}>{r.alerts}</td>
                <td>{r.session_id && <Review v={r.review} />}</td>
                <td>{r.session_id && <Link className="btn ghost" to={`/sessions/${r.session_id}`}>{t('Nhật ký')}</Link>}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty>{t('Lớp chưa có sinh viên.')}</Empty>}
      </Card>
    </>
  );
}
