import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { useT } from '@/i18n';
import { useSettings } from './SettingsProvider';
import { api, getToken, setToken } from '@/lib/api/client';
import { WebSpeechSynthesizer } from '@/lib/speech/synthesis';
import type { Immersion, UiLang } from '@shared/types';

const CHAT_MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'];
const REVIEW_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];

function Row({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {help && <div className="text-xs text-ink-3">{help}</div>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const { t } = useT();
  const { settings, update, theme, setTheme } = useSettings();
  const [token, setTok] = useState(getToken());
  const [conn, setConn] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const synth = new WebSpeechSynthesizer();
    const load = () => setVoices(synth.voices());
    load();
    if ('speechSynthesis' in window) window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.removeEventListener('voiceschanged', load);
    };
  }, []);

  const testConnection = async () => {
    setToken(token.trim());
    setConn('…');
    try {
      const h = await api.health();
      setConn(h.hasKey ? t('settings.token.ok') : t('settings.token.noKey'));
    } catch (e) {
      setConn(t('settings.token.bad', { msg: e instanceof Error ? e.message : String(e) }));
    }
  };

  const exportJson = async () => {
    const [stats, sessions] = await Promise.all([api.stats(400), fetch('/api/sessions?limit=100', { headers: { Authorization: `Bearer ${getToken()}` } }).then((r) => r.json())]);
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), settings, stats, sessions }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `synapse-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const wipe = async () => {
    if (!window.confirm(t('settings.wipe.confirm'))) return;
    await api.deleteAll();
    window.location.href = '/';
  };

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl font-semibold">{t('settings.title')}</h1>

      <Card>
        <h2 className="mb-1 font-display text-base font-semibold">{t('settings.connection')}</h2>
        <Row label={t('settings.token')} help={t('settings.token.help')}>
          <input
            type="password"
            value={token}
            onChange={(e) => setTok(e.target.value)}
            onBlur={() => setToken(token.trim())}
            className="w-56"
            autoComplete="off"
          />
          <Button size="sm" variant="outline" onClick={testConnection}>
            {t('settings.token.check')}
          </Button>
        </Row>
        {conn && <div className="text-xs text-ink-2">{conn}</div>}
      </Card>

      <Card className="divide-y divide-line/70">
        <Row label={t('settings.language')}>
          <select value={settings.uiLang} onChange={(e) => update({ uiLang: e.target.value as UiLang })}>
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </select>
        </Row>
        <Row label={t('settings.theme')}>
          <select value={theme} onChange={(e) => setTheme(e.target.value as 'dark' | 'light')}>
            <option value="dark">{t('settings.theme.dark')}</option>
            <option value="light">{t('settings.theme.light')}</option>
          </select>
        </Row>
        <Row label={t('settings.immersion')}>
          <select value={settings.immersion} onChange={(e) => update({ immersion: e.target.value as Immersion })} className="max-w-[320px]">
            <option value="high">{t('settings.immersion.high')}</option>
            <option value="medium">{t('settings.immersion.medium')}</option>
            <option value="low">{t('settings.immersion.low')}</option>
          </select>
        </Row>
        <Row label={t('settings.goal')}>
          <input
            type="number"
            min={1}
            max={120}
            value={settings.dailyGoalMin}
            onChange={(e) => update({ dailyGoalMin: Math.max(1, Number(e.target.value) || 1) })}
            className="w-24"
          />
          <span className="text-sm text-ink-2">{t('settings.minutes')}</span>
        </Row>
      </Card>

      <Card className="divide-y divide-line/70">
        <Row label={t('settings.voice')}>
          <select value={settings.voice} onChange={(e) => update({ voice: e.target.value })} className="max-w-[320px]">
            <option value="">{t('settings.voice.auto')}</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </Row>
        <Row label={`${t('settings.rate')}: ${settings.rate.toFixed(2)}x`}>
          <input type="range" min={0.7} max={1.3} step={0.05} value={settings.rate} onChange={(e) => update({ rate: Number(e.target.value) })} />
        </Row>
        <Row label={`${t('settings.silence')}: ${settings.silenceSec.toFixed(1)}s`}>
          <input type="range" min={0.6} max={3} step={0.1} value={settings.silenceSec} onChange={(e) => update({ silenceSec: Number(e.target.value) })} />
        </Row>
        <Row label={t('settings.manual')}>
          <Switch checked={settings.manualSend} onChange={(v) => update({ manualSend: v })} label={t('settings.manual')} />
        </Row>
      </Card>

      <Card className="divide-y divide-line/70">
        <h2 className="pb-1 font-display text-base font-semibold">{t('settings.models')}</h2>
        <Row label={t('settings.model.chat')}>
          <select value={settings.chatModel} onChange={(e) => update({ chatModel: e.target.value })}>
            {CHAT_MODELS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Row>
        <Row label={t('settings.model.review')}>
          <select value={settings.reviewModel} onChange={(e) => update({ reviewModel: e.target.value })}>
            {REVIEW_MODELS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Row>
      </Card>

      <Card>
        <h2 className="mb-3 font-display text-base font-semibold">{t('settings.data')}</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportJson}>
            {t('settings.export')}
          </Button>
          <Button variant="danger" size="sm" onClick={wipe}>
            {t('settings.wipe')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
