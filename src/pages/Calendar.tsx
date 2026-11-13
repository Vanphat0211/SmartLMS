import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useShell } from '../components/Layout';
import { Card, Loading } from '../components/ui';
import { agendaDay, agendaLink, KIND } from '../lib/agenda';
import { courseColor, ymd } from '../lib/format';
import { onForm, useLoad } from '../lib/hooks';
import { q, supabase } from '../lib/supabase';
import { locale, t } from '../lib/i18n';

export default function Calendar() {
  const { agenda, reloadAgenda } = useShell();
  const nav = useNavigate();
  const [month, setMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const { data: courses, error } = useLoad(() => q(supabase.from('courses').select('id, code, title').order('code')));
  if (!courses) return <Loading error={error} />;

  const { y, m } = month, today = ymd();
  const calendars: [number, string][] = [[0, t('Cá nhân')], ...courses.map((c) => [c.id, `${c.code} — ${c.title}`] as [number, string])];
  const items = agenda.filter((x) => !hidden.has(x.course_id ?? 0));
  const first = 1 - new Date(y, m, 1).getDay(); // ô đầu tiên = Chủ nhật trước ngày 1
  const move = (d: number) => { const x = new Date(y, m + d, 1); setMonth({ y: x.getFullYear(), m: x.getMonth() }); };
  const toggle = (id: number) => setHidden((h) => { const n = new Set(h); if (!n.delete(id)) n.add(id); return n; });

  return (
    <>
      <h1>{t('Lịch')}</h1>
      <div className="calwrap">
        <Card title={t('Lịch của tôi')}><div>
          <form className="row" onSubmit={onForm((v) => q(supabase.from('calendar_events').insert({ title: v.title, day: v.day })), reloadAgenda)}>
            <input name="day" type="date" defaultValue={today} required /><input name="title" placeholder={t('Sự kiện cá nhân')} className="grow" required /><button>{t('Thêm')}</button>
          </form>
          <p className="muted caption">{t('CÁC LỊCH')}</p>
          {calendars.map(([id, name]) => (
            <label className="calsel" key={id}><input type="checkbox" checked={!hidden.has(id)} onChange={() => toggle(id)} /><i style={{ background: courseColor(id) }} />{name}</label>
          ))}
          <p className="muted">{t('✓ = đã nộp / đã hoàn thành')}</p>
        </div></Card>
        <div>
          <div className="bar">
            <button onClick={() => move(-1)}>◀</button><button onClick={() => move(1)}>▶</button>
            <button onClick={() => { const d = new Date(); setMonth({ y: d.getFullYear(), m: d.getMonth() }); }}>{t('Hôm nay')}</button>
            <b className="big">{t('Tháng')} {m + 1} / {y}</b>
          </div>
          <div className="cal">
            {['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].map((d) => <div className="h" key={d}>{t(d)}</div>)}
            {Array.from({ length: 42 }, (_, i) => {
              const d = new Date(y, m, first + i), key = ymd(d);
              return (
                <div key={key} className={`${d.getMonth() !== m ? 'dim' : ''} ${key === today ? 'today' : ''}`}>
                  <b>{d.getDate()}</b>
                  {items.filter((x) => agendaDay(x) === key).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '')).map((x) => (
                    <button key={x.kind + x.ref_id} className="ev" style={{ background: courseColor(x.course_id) }} title={`${KIND[x.kind]}: ${x.title}`} onClick={() => nav(agendaLink(x))}>
                      {x.at && <i>{new Date(x.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</i>}{x.title}{x.done && ' ✓'}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
