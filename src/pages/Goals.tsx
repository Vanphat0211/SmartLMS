import { useMe } from '../auth';
import { Card, Empty, Loading, Meter } from '../components/ui';
import { onForm, useLoad } from '../lib/hooks';
import { q, rpc, supabase } from '../lib/supabase';
import { t } from '../lib/i18n';

type Perf = { outcome_id: number; course_code: string; course: string; code: string; description: string; questions: number; attempts: number; pct: number | null };

/** Chuẩn đầu ra học phần (CLO) — tương đương "Goals". */
export function Goals() {
  const { me } = useMe();
  const teacher = me.role === 'teacher';
  const { data, error, reload } = useLoad(() => Promise.all([
    rpc<Perf[]>('outcome_performance'),
    teacher ? q(supabase.from('courses').select('id, code').eq('teacher_id', me.id).order('code')) : Promise.resolve([]),
  ]));
  if (!data) return <Loading error={error} />;
  const [goals, courses] = data;
  return (
    <>
      <h1>{t('Chuẩn đầu ra (CLO)')}</h1>
      {teacher && (
        <form className="bar" onSubmit={onForm((v) => q(supabase.from('outcomes').insert({ course_id: Number(v.course), code: v.code, description: v.description })), reload)}>
          <b>{t('Thêm CLO')}</b><select name="course">{courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select>
          <input name="code" placeholder="CLO3" className="w80" required /><input name="description" placeholder={t('Mô tả chuẩn đầu ra')} className="grow" required /><button>{t('Thêm')}</button>
        </form>
      )}
      <p className="muted">{t('Giảng viên gắn câu hỏi thi với CLO để đo mức đạt chuẩn của người học.')}</p>
      <Card>
        {goals.length ? <table><thead><tr><th>{t('Khóa học')}</th><th>{t('Mã')}</th><th>{t('Mô tả')}</th><th>{t('Số câu hỏi gắn')}</th></tr></thead>
          <tbody>{goals.map((g) => <tr key={g.outcome_id}><td>{g.course_code}</td><td><b>{g.code}</b></td><td>{g.description}</td><td>{g.questions}</td></tr>)}</tbody></table>
          : <Empty>{t('Chưa có chuẩn đầu ra.')}</Empty>}
      </Card>
    </>
  );
}

/** Mức đạt chuẩn đầu ra — tương đương "Goal Performance". */
export function GoalPerformance() {
  const { me } = useMe();
  const { data, error } = useLoad(() => rpc<Perf[]>('outcome_performance'));
  if (!data) return <Loading error={error} />;
  return (
    <>
      <h1>{t('Kết quả chuẩn đầu ra')}</h1>
      <p className="muted">{me.role === 'student' ? t('Tỉ lệ trả lời đúng của bạn') : t('Tỉ lệ trả lời đúng của cả lớp')} {t('trên các câu hỏi gắn với từng CLO. Ngưỡng đạt: 50%.')}</p>
      <Card>
        {data.length ? <table><thead><tr><th>{t('Khóa học')}</th><th>CLO</th><th>{t('Mô tả')}</th><th>{t('Lượt trả lời')}</th><th>{t('Tỉ lệ đúng')}</th><th>{t('Đánh giá')}</th></tr></thead>
          <tbody>{data.map((g) => (
            <tr key={g.outcome_id}><td>{g.course_code}</td><td><b>{g.code}</b></td><td>{g.description}</td><td>{g.attempts}</td>
              <td>{g.pct == null ? '—' : <Meter pct={g.pct} />}</td>
              <td>{g.pct == null ? <span className="muted">{t('Chưa có dữ liệu')}</span> : g.pct >= 50 ? <span className="ok">{t('Đạt')}</span> : <span className="bad">{t('Chưa đạt')}</span>}</td></tr>
          ))}</tbody></table> : <Empty>{t('Chưa có chuẩn đầu ra.')}</Empty>}
      </Card>
    </>
  );
}
