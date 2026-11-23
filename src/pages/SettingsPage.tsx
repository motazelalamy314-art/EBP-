import React, { useState } from 'react';
import {
  Cpu,
  MessageSquareText,
  Timer,
  Database,
  Palette,
  RotateCcw,
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Moon,
  Sun,
} from 'lucide-react';
import type {
  AiProvider,
  AppSettings,
  AppState,
  EnglishTrack,
  OpenAiPreset,
} from '../types/study';
import {
  DEFAULT_SYSTEM_INSTRUCTION,
  GEMINI_MODELS,
  OPENAI_PRESETS,
  validateAndParseBackup,
} from '../utils/studyLogic';
import { testAiConnection } from '../utils/aiClient';

interface SettingsPageProps {
  state: AppState;
  onUpdateSettings: (partial: Partial<AppSettings>) => void;
  onChangeEnglishTrack: (track: EnglishTrack) => void;
  onImportBackup: (restoredState: AppState) => void;
  onResetAllData: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  state,
  onUpdateSettings,
  onChangeEnglishTrack,
  onImportBackup,
  onResetAllData,
}) => {
  const { settings } = state;

  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [backupNotice, setBackupNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirmResetOpen, setConfirmResetOpen] = useState<boolean>(false);

  const handleProviderChange = (provider: AiProvider) => {
    setTestResult(null);
    if (provider === 'gemini') {
      onUpdateSettings({
        provider,
        modelId: 'gemini-3.1-flash-lite',
      });
    } else if (provider === 'openai_compatible') {
      const preset = OPENAI_PRESETS[settings.openAiPreset];
      onUpdateSettings({
        provider,
        openAiBaseUrl: preset.baseUrl,
        modelId: preset.defaultModel,
      });
    } else {
      onUpdateSettings({
        provider,
        modelId: 'llama3.2',
      });
    }
  };

  const handlePresetChange = (presetKey: OpenAiPreset) => {
    const preset = OPENAI_PRESETS[presetKey];
    onUpdateSettings({
      openAiPreset: presetKey,
      openAiBaseUrl: preset.baseUrl,
      modelId: preset.defaultModel,
    });
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testAiConnection(settings);
      setTestResult(res);
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'فشل اختبار الاتصال.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleExportBackup = () => {
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bacc-ai-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setBackupNotice({ ok: true, message: 'تم تصدير النسخة الاحتياطية بنجاح.' });
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupNotice(null);
    try {
      const text = await file.text();
      const restored = validateAndParseBackup(text);
      onImportBackup(restored);
      setBackupNotice({ ok: true, message: 'تم استيراد النسخة الاحتياطية واستعادة بياناتك بنجاح.' });
    } catch (err) {
      setBackupNotice({
        ok: false,
        message: err instanceof Error ? err.message : 'ملف النسخة الاحتياطية غير صالح.',
      });
    }
    e.target.value = '';
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
          الإعدادات العامة للمنصة
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          تخصيص مزود الذكاء الاصطناعي، شخصية المعلم، مؤقت المذاكرة، المظهر، والنسخ الاحتياطي
        </p>
      </header>

      {/* Card 1: AI Provider & Model Configuration */}
      <section className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-200 dark:border-slate-800">
          <Cpu className="w-5 h-5 text-indigo-500" />
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            إعدادات الذكاء الاصطناعي والـ API
          </h2>
        </div>

        {/* Provider Switcher */}
        <div>
          <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
            مزود الذكاء الاصطناعي
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {(
              [
                { id: 'gemini', label: 'Google Gemini API' },
                { id: 'openai_compatible', label: 'OpenAI-Compatible (Groq / OpenRouter / Mistral)' },
                { id: 'ollama', label: 'Local Ollama (محلي)' },
              ] as Array<{ id: AiProvider; label: string }>
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleProviderChange(item.id)}
                className={`px-4 py-3 rounded-xl text-xs sm:text-sm font-semibold border transition-colors text-center ${
                  settings.provider === item.id
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-indigo-500/50'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Provider-specific fields */}
        {settings.provider === 'gemini' && (
          <div>
            <label
              htmlFor="gemini-model-select"
              className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
            >
              اختر نموذج Gemini
            </label>
            <select
              id="gemini-model-select"
              value={
                GEMINI_MODELS.some((m) => m.id === settings.modelId)
                  ? settings.modelId
                  : GEMINI_MODELS[0].id
              }
              onChange={(e) => onUpdateSettings({ modelId: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {GEMINI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {settings.provider === 'openai_compatible' && (
          <div className="space-y-4">
            <div>
              <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
                إعداد سريع للمزود (Presets)
              </span>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(OPENAI_PRESETS) as OpenAiPreset[]).map((presetKey) => (
                  <button
                    key={presetKey}
                    type="button"
                    onClick={() => handlePresetChange(presetKey)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                      settings.openAiPreset === presetKey
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {OPENAI_PRESETS[presetKey].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="openai-base-url"
                  className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
                >
                  Base URL
                </label>
                <input
                  id="openai-base-url"
                  type="url"
                  dir="ltr"
                  value={settings.openAiBaseUrl}
                  onChange={(e) => onUpdateSettings({ openAiBaseUrl: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label
                  htmlFor="openai-api-key"
                  className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
                >
                  API Key
                </label>
                <input
                  id="openai-api-key"
                  type="password"
                  dir="ltr"
                  value={settings.openAiApiKey}
                  onChange={(e) => onUpdateSettings({ openAiApiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>
        )}

        {settings.provider === 'ollama' && (
          <div>
            <label
              htmlFor="ollama-url"
              className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
            >
              عنوان خادم Ollama المحلي
            </label>
            <input
              id="ollama-url"
              type="url"
              dir="ltr"
              value={settings.ollamaBaseUrl}
              onChange={(e) => onUpdateSettings({ ollamaBaseUrl: e.target.value })}
              placeholder="http://localhost:11434"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}

        {/* Custom Model ID + Test Connection */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-8">
            <label
              htmlFor="custom-model-id"
              className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
            >
              معرف نموذج مخصص (Custom Model ID — يتجاوز القائمة إذا كُتب)
            </label>
            <input
              id="custom-model-id"
              type="text"
              dir="ltr"
              value={settings.customModelId}
              onChange={(e) => onUpdateSettings({ customModelId: e.target.value })}
              placeholder={settings.modelId}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="md:col-span-4">
            <button
              type="button"
              disabled={isTesting}
              onClick={handleTestConnection}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              {isTesting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>جاري الاختبار...</span>
                </>
              ) : (
                <span>اختبار الاتصال</span>
              )}
            </button>
          </div>
        </div>

        {testResult && (
          <div
            role="status"
            className={`p-3.5 rounded-xl border text-xs sm:text-sm flex items-start gap-2.5 ${
              testResult.ok
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
            }`}
          >
            {testResult.ok ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}
      </section>

      {/* Card 2: Tutor Persona & System Prompt Customization */}
      <section className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <MessageSquareText className="w-5 h-5 text-indigo-500" />
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              تخصيص شخصية المعلم والـ System Prompt
            </h2>
          </div>

          <button
            type="button"
            onClick={() => onUpdateSettings({ systemInstruction: DEFAULT_SYSTEM_INSTRUCTION })}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>استعادة الافتراضي</span>
          </button>
        </div>

        <div>
          <label
            htmlFor="system-prompt-textarea"
            className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
          >
            التعليمات العامة للمعلم الذكي
          </label>
          <textarea
            id="system-prompt-textarea"
            rows={5}
            value={settings.systemInstruction}
            onChange={(e) => onUpdateSettings({ systemInstruction: e.target.value })}
            className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm leading-relaxed text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </section>

      {/* Card 3: Pomodoro & Study Preferences */}
      <section className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-200 dark:border-slate-800">
          <Timer className="w-5 h-5 text-indigo-500" />
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            إعدادات المذاكرة والمؤقت
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label
              htmlFor="focus-duration"
              className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
            >
              مدة التركيز (بالدقائق)
            </label>
            <input
              id="focus-duration"
              type="number"
              min={5}
              max={120}
              value={settings.pomodoroFocusMinutes}
              onChange={(e) =>
                onUpdateSettings({
                  pomodoroFocusMinutes: Math.max(5, Math.min(120, Number(e.target.value) || 25)),
                })
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm font-mono tabular-nums text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label
              htmlFor="break-duration"
              className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
            >
              مدة الراحة (بالدقائق)
            </label>
            <input
              id="break-duration"
              type="number"
              min={1}
              max={60}
              value={settings.pomodoroBreakMinutes}
              onChange={(e) =>
                onUpdateSettings({
                  pomodoroBreakMinutes: Math.max(1, Math.min(60, Number(e.target.value) || 5)),
                })
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm font-mono tabular-nums text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
              مسار اللغة الإنجليزية الافتراضي
            </span>
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              {(['O-Level', 'A-Level'] as EnglishTrack[]).map((track) => (
                <button
                  key={track}
                  type="button"
                  onClick={() => {
                    onUpdateSettings({ defaultEnglishTrack: track });
                    onChangeEnglishTrack(track);
                  }}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    state.englishTrack === track
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {track}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
              نظام التعليم (STEM)
            </span>
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => onUpdateSettings({ languageSchoolMode: true })}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  settings.languageSchoolMode !== false
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                مدارس لغات
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ languageSchoolMode: false })}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  settings.languageSchoolMode === false
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                مدارس عربي
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Card 4: User Interface Theme */}
      <section className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-200 dark:border-slate-800">
          <Palette className="w-5 h-5 text-indigo-500" />
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            واجهة المستخدم والمظهر (UI)
          </h2>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              مظهر المنصة
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              الوضع الداكن مريح للمذاكرة الليلية مع دعم كامل للوضع الفاتح وتوافق تام مع الجوال.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => onUpdateSettings({ theme: 'dark' })}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                settings.theme === 'dark'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              <span>داكن</span>
            </button>
            <button
              type="button"
              onClick={() => onUpdateSettings({ theme: 'light' })}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                settings.theme === 'light'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              <span>فاتح</span>
            </button>
          </div>
        </div>
      </section>

      {/* Card 5: Backup & Data Management + Danger Zone */}
      <section className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-200 dark:border-slate-800">
          <Database className="w-5 h-5 text-indigo-500" />
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            النسخ الاحتياطي وإدارة البيانات
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleExportBackup}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>تصدير نسخة احتياطية (.json)</span>
          </button>

          <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer transition-colors">
            <Upload className="w-4 h-4" />
            <span>استيراد نسخة احتياطية (.json)</span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleImportBackup}
              className="sr-only"
            />
          </label>
        </div>

        {backupNotice && (
          <div
            role="status"
            className={`p-3 rounded-xl border text-xs ${
              backupNotice.ok
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
            }`}
          >
            {backupNotice.message}
          </div>
        )}

        {/* Danger Zone */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
          <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/30 space-y-3">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-red-600 dark:text-red-400">
                    منطقة الخطر — تصفير البيانات
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    سيؤدي هذا الإجراء لمسح كافة المصادر والفروع المستخرجة والملخصات والإحصائيات والعودة لنقطة الصفر.
                  </p>
                </div>
              </div>

              {!confirmResetOpen && (
                <button
                  type="button"
                  onClick={() => setConfirmResetOpen(true)}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 text-white hover:bg-red-500 transition-colors whitespace-nowrap"
                >
                  تصفير جميع البيانات
                </button>
              )}
            </div>

            {confirmResetOpen && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-red-500/20">
                <span className="text-xs font-bold text-red-600 dark:text-red-400">
                  هل أنت متأكد تماماً؟ لا يمكن التراجع عن مسح البيانات.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmResetOpen(false)}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onResetAllData();
                      setConfirmResetOpen(false);
                      setBackupNotice({
                        ok: true,
                        message: 'تم تصفير جميع البيانات والعودة إلى الحالة الصفرية النظيفة.',
                      });
                    }}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold bg-red-600 text-white hover:bg-red-500"
                  >
                    تأكيد التصفير النهائي
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
