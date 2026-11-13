import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { configured } from './lib/supabase';
import './styles.css';
import { t } from './lib/i18n';

const SetupNeeded = () => (
  <div className="login"><div className="card"><h3>{t('Chưa cấu hình Supabase')}</h3><div>
    <p>{t('Tạo file')} <code>.env</code> {t('ở thư mục gốc với:')}</p>
    <pre>VITE_SUPABASE_URL=https://&lt;project&gt;.supabase.co{'\n'}VITE_SUPABASE_ANON_KEY=&lt;anon / publishable key&gt;</pre>
    <p className="muted">{t('Sau đó chạy lại')} <code>npm run dev</code>.</p>
  </div></div></div>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>{configured ? <App /> : <SetupNeeded />}</StrictMode>,
);
