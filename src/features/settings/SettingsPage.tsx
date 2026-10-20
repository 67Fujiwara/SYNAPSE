import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { useT } from '@/i18n';
import { useSettings } from './SettingsProvider';
import { api, getToken, setToken } from '@/lib/api/client';
import { WebSpeechSynthesizer } from '@/lib/speech/synthesis';
import type { Immersion, MicMode, SttEngine, TtsEngine, UiLang } from '@shared/types';
import { AURA_VOICES } from '@shared/voices';
import { makeSynthesizer } from '@/lib/speech/factory';
import { Volume2 } from 'lucide-react';

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
  const [sttNote, setSttNote] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const preview = async () => {
    setPreviewing(true);
    const synth = makeSynthesizer(settings.ttsEngine, settings.serverVoice);
    synth.unlock();
    await synth.speak("Hey! Good to see you. So, how's your week going so far?", {
      rate: settings.rate,
      voice: settings.ttsEngine === 'server' ? settings.serverVoice : settings.voice,
    });
    setPreviewing(false);
  };

  const checkStt = async (engine: SttEngine) => {
    update({ sttEngine: engine });
    if (engine !== 'server') return setSttNote(null);
    try {
      const h = await api.health();
      setSttNote(h.stt ? t('settings.sttEngine.ok') : t('settings.sttEngine.missing'));
    } catch {
      setSttNote(null);
    }
  };

  useEffect(() => {
    const synth = new WebSpeechSynthesizer();
    const load = () => setVoices(synth.voices());
    load();
    window.speechSynthesis?.addEventListener('voiceschanged', load);
    return () => {
      window.speechSynthesis?.removeEventListener('voiceschanged', load);
    };
  }, []);

  const testConnection = async () => {
    setToken(token.trim());
    setConn('…');
    try {
      const h = await api.health();
      if (h.keyStatus === 'ok') setConn(t('settings.token.ok'));
      else if (h.keyStatus === 'missing') setConn(t('settings.token.noKey'));
      else if (h.keyStatus === 'invalid') setConn(t('settings.token.keyInvalid', { hint: h.keyHint }));
      else if (h.keyStatus === 'workspace') setConn(t('settings.token.keyWorkspace'));
      else setConn(t('settings.token.keyError', { msg: h.keyMessage }));
      if (settings.sttEngine === 'server') setSttNote(h.stt ? t('settings.sttEngine.ok') : t('settings.sttEngine.missing'));
    } catch (e) {
      setConn(t('settings.token.bad', { msg: e instanceof Error ? e.message : String(e) }));
    }
  };

  const [dataNote, setDataNote] = useState<string | null>(null);
  const exportJson = async () => {
    const bundle = await api.exportAll(); // also stored under exports/ in R2 when a bucket is bound
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `synapse-export-${bundle.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setDataNote(t('settings.exported', { n: bundle.sessions.length }));
  };
  const importJson = async (file: File) => {
    try {
      const bundle = JSON.parse(await file.text());
      const r = await api.importAll(bundle);
      setDataNote(t('settings.imported', { s: r.sessions, i: r.items }));
    } catch (e) {
      setDataNote(e instanceof Error ? e.message : String(e));
    }
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
        <h2 className="pb-1 font-display text-base font-semibold">{t('settings.ttsSection')}</h2>
        <Row label={t('settings.ttsEngine')} help={t('settings.ttsEngine.help')}>
          <select value={settings.ttsEngine} onChange={(e) => update({ ttsEngine: e.target.value as TtsEngine })} className="max-w-[320px]">
            <option value="server">{t('settings.ttsEngine.server')}</option>
            <option value="browser">{t('settings.ttsEngine.browser')}</option>
          </select>
        </Row>
        {settings.ttsEngine === 'server' ? (
          <Row label={t('settings.serverVoice')} help={t('settings.serverVoice.help')}>
            <select value={settings.serverVoice} onChange={(e) => update({ serverVoice: e.target.value })} className="max-w-[320px]">
              <optgroup label={t('settings.voice.female')}>
                {AURA_VOICES.filter((v) => v.gender === 'f').map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id} · {v.accent} · {v.note}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t('settings.voice.male')}>
                {AURA_VOICES.filter((v) => v.gender === 'm').map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id} · {v.accent} · {v.note}
                  </option>
                ))}
              </optgroup>
            </select>
          </Row>
        ) : (
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
        )}
        <Row label={t('settings.preview')}>
          <Button size="sm" variant="outline" disabled={previewing} onClick={() => void preview()}>
            <Volume2 size={14} /> {previewing ? t('settings.previewing') : t('settings.preview.cta')}
          </Button>
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
        <h2 className="pb-1 font-display text-base font-semibold">{t('settings.speech')}</h2>
        <Row label={t('settings.micMode')}>
          <select value={settings.micMode} onChange={(e) => update({ micMode: e.target.value as MicMode })} className="max-w-[320px]">
            <option value="auto">{t('settings.micMode.auto')}</option>
            <option value="continuous">{t('settings.micMode.continuous')}</option>
            <option value="push">{t('settings.micMode.push')}</option>
          </select>
        </Row>
        <Row label={t('settings.sttEngine')} help={t('settings.sttEngine.help')}>
          <select value={settings.sttEngine} onChange={(e) => void checkStt(e.target.value as SttEngine)} className="max-w-[320px]">
            <option value="browser">{t('settings.sttEngine.browser')}</option>
            <option value="server">{t('settings.sttEngine.server')}</option>
          </select>
        </Row>
        {sttNote && <div className="pt-2 text-xs text-ink-2">{sttNote}</div>}
        <Row label={t('settings.debugClips')} help={t('settings.debugClips.help')}>
          <Switch checked={settings.debugClips} onChange={(v) => update({ debugClips: v })} label={t('settings.debugClips')} />
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
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm hover:bg-surface-2">
            {t('settings.import')}
            <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && void importJson(e.target.files[0])} />
          </label>
          <Button variant="danger" size="sm" onClick={wipe}>
            {t('settings.wipe')}
          </Button>
        </div>
        {dataNote && <div className="mt-2 text-xs text-ink-2">{dataNote}</div>}
      </Card>

      <Card className="divide-y divide-line/70">
        <h2 className="pb-1 font-display text-base font-semibold">{t('settings.recordings')}</h2>
        <Row label={t('settings.saveRecordings')} help={t('settings.saveRecordings.help')}>
          <Switch checked={settings.saveRecordings} onChange={(v) => update({ saveRecordings: v })} label={t('settings.saveRecordings')} />
        </Row>
        <Row label={t('settings.recordingDays')}>
          <input type="number" min={1} max={365} value={settings.recordingDays} onChange={(e) => update({ recordingDays: Math.max(1, Number(e.target.value) || 1) })} className="w-24" />
          <span className="text-sm text-ink-2">{t('settings.days')}</span>
        </Row>
      </Card>
    </div>
  );
}
