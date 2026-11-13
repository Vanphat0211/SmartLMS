import { useMe } from '../auth';
import { Card, Empty, Loading, Review } from '../components/ui';
import { fmt } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { rpc } from '../lib/supabase';
import { t } from '../lib/i18n';

type Row = { course_id: number; code: string; course: string; item: string; kind: 'Bài tập' | 'Kỳ thi'; student: string;
  score: number | null; max_score: number; done_at: string | null; due: string; note: string | null };

function State({ r }: { r: Row }) {
  if (r.score != null) return <><b>{Number(r.score)}</b> / {Number(r.max_score)}</>;
  if (r.done_at) return <>{r.kind === 'Kỳ thi' ? t('Đã nộp — chờ công bố điểm') : t('Đã nộp — chờ chấm')}</>;
  const past = new Date(r.due) < new Date();
  return r.kind === 'Bài tập' ? (past ? <span className="bad">{t('Quá hạn')}</span> : <>{t('Chưa nộp')}</>) : (past ? <span className="bad">{t('Vắng thi')}</span> : <>{t('Chưa thi')}</>);
}

export default function Grades() {
  const { me } = useMe();
  const staff = me.role !== 'student';
  const { data, error } = useLoad(() => rpc<Row[]>('grade_book'));
  if (!data) return <Loading error={error} />;
  const groups = Object.entries(Object.groupBy(data, (r) => `${r.code} — ${r.course}`));
  return (
    <>
      <h1>{t('Kết quả học tập')}</h1>
      {groups.length ? groups.map(([course, list = []]) => {
        const graded = list.filter((r) => r.score != null);
        const got = graded.reduce((a, r) => a + Number(r.score), 0), max = graded.reduce((a, r) => a + Number(r.max_score), 0);
        return (
          <Card key={course} title={course}>
            <table>
              <thead><tr><th>{t('Mục')}</th><th>{t('Loại')}</th><th>{t('Hạn')}</th>{staff && <th>{t('Sinh viên')}</th>}<th>{t('Điểm / trạng thái')}</th><th>{t('Ghi chú')}</th></tr></thead>
              <tbody>{list.map((r, i) => (
                <tr key={i}><td>{r.item}</td><td>{t(r.kind)}</td><td>{fmt(r.due)}</td>{staff && <td>{r.student}</td>}<td><State r={r} /></td>
                  <td>{r.kind === 'Kỳ thi' ? r.note && <Review v={r.note} /> : r.note}</td></tr>
              ))}</tbody>
            </table>
            {!staff && max > 0 && <p className="more">{t('Tổng các mục đã chấm:')} <b>{+got.toFixed(2)} / {max}</b> ({Math.round((got / max) * 100)}%)</p>}
          </Card>
        );
      }) : <Empty>{t('Chưa có dữ liệu điểm.')}</Empty>}
    </>
  );
}
