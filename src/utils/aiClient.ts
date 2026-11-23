import type {
  AppSettings,
  QuizQuestion,
  ScheduleDay,
  SourceAnalysisReport,
  StudyModeId,
  SubjectId,
} from '../types/study';
import type { OcrImagePayload } from './pdfExtractor';
import {
  OFFICIAL_SUBJECTS,
  STUDY_MODES,
  isEnglishStemSubject,
  sanitizeSpokenScript,
} from './studyLogic';
import {
  buildDeepCurriculumPrompt,
  extractTableOfContentsSnippet,
  mergeBranchExtractions,
  safeParseAiJson,
} from './sourceAnalysis';
import { normalizeGeminiModelId, parseSafeJsonResponse } from './aiResilience';

function buildProviderPayload(settings: AppSettings) {
  const rawModel = settings.customModelId.trim() || settings.modelId;
  const effectiveModel =
    settings.provider === 'gemini' ? normalizeGeminiModelId(rawModel) : rawModel;
  return {
    provider: settings.provider,
    modelId: effectiveModel,
    openAiBaseUrl: settings.openAiBaseUrl,
    openAiApiKey: settings.openAiApiKey,
  };
}

async function callOllamaChat(
  settings: AppSettings,
  systemInstruction: string,
  userPrompt: string,
  jsonMode = false,
  imagesBase64?: string[]
): Promise<string> {
  const base = (settings.ollamaBaseUrl || 'http://localhost:11434').replace(/\/+$/, '');
  const model = settings.customModelId.trim() || settings.modelId || 'llama3.2';

  const userMsg: Record<string, unknown> = {
    role: 'user',
    content: userPrompt,
  };
  if (imagesBase64 && imagesBase64.length > 0) {
    userMsg.images = imagesBase64;
  }

  const resp = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: jsonMode ? 'json' : undefined,
      messages: [
        { role: 'system', content: systemInstruction },
        userMsg,
      ],
    }),
  });

  const data = await parseSafeJsonResponse<{ message?: { content?: string }; error?: string }>(
    resp,
    'تعذر الاتصال بـ Ollama. تأكد من تشغيل Ollama محلياً وتفعيل CORS'
  );
  return (data?.message?.content || '').trim();
}

export async function testAiConnection(
  settings: AppSettings
): Promise<{ ok: boolean; message: string }> {
  if (settings.provider === 'ollama') {
    const base = (settings.ollamaBaseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    try {
      const resp = await fetch(`${base}/api/tags`);
      const data = await parseSafeJsonResponse<{ models?: Array<{ name: string }> }>(
        resp,
        'تعذر قراءة قائمة النماذج من خادم Ollama'
      );
      const names = (data.models || []).map((m) => m.name).slice(0, 4).join('، ');
      return {
        ok: true,
        message: names
          ? `تم الاتصال بخادم Ollama المحلي بنجاح. النماذج المتاحة: ${names}`
          : 'تم الاتصال بخادم Ollama المحلي بنجاح.',
      };
    } catch (err) {
      return {
        ok: false,
        message:
          err instanceof Error
            ? err.message
            : 'تعذر الوصول إلى Ollama على http://localhost:11434. تأكد من تشغيله محلياً.',
      };
    }
  }

  try {
    const resp = await fetch('/api/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: buildProviderPayload(settings) }),
    });

    const data = await parseSafeJsonResponse<{
      ok?: boolean;
      message?: string;
      error?: string;
    }>(resp, 'فشل اختبار الاتصال بمزود الذكاء الاصطناعي');

    if (!data.ok) {
      return {
        ok: false,
        message: data.message || data.error || 'فشل اختبار الاتصال بمزود الذكاء الاصطناعي.',
      };
    }
    return { ok: true, message: data.message || 'تم الاتصال بنجاح!' };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : 'فشل اختبار الاتصال بمزود الذكاء الاصطناعي.',
    };
  }
}

export async function performOcrOnImages(params: {
  settings: AppSettings;
  subjectNameAr: string;
  images: OcrImagePayload[];
}): Promise<string> {
  const { settings, subjectNameAr, images } = params;
  if (images.length === 0) return '';

  if (settings.provider === 'ollama') {
    return callOllamaChat(
      settings,
      `أنت محرك OCR أكاديمي دقيق لطلاب البكالوريا المصرية (${subjectNameAr}). استخرج كل النصوص العربية والإنجليزية والألمانية والعناوين والجداول والمعادلات (بصيغة LaTeX) بدقة كاملة دون تلخيص أو حذف.`,
      `استخرج النص الكامل من الصور المرفقة (${images.map((i) => i.label).join('، ')}).`,
      false,
      images.map((i) => i.base64Data)
    );
  }

  const resp = await fetch('/api/ai/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: buildProviderPayload(settings),
      subjectNameAr,
      images,
    }),
  });

  const data = await parseSafeJsonResponse<{ text?: string; error?: string }>(
    resp,
    'تعذر قراءة النص من الصور باستخدام OCR'
  );
  return (data.text || '').trim();
}

export async function generateStudyContent(params: {
  settings: AppSettings;
  modeId: StudyModeId;
  systemInstruction: string;
  userPrompt: string;
}): Promise<{ text: string; questions?: QuizQuestion[] }> {
  const { settings, modeId, systemInstruction, userPrompt } = params;

  if (settings.provider === 'ollama') {
    if (modeId === 'question_bank') {
      const raw = await callOllamaChat(
        settings,
        systemInstruction,
        `${userPrompt}\n\nأعد JSON فقط على الشكل: {"questions":[{"question":"...","options":["...","...","...","..."],"correctIndex":0,"difficulty":"easy","explanation":"..."}]} يحتوي على 100 سؤال.`,
        true
      );
      const parsed = safeParseAiJson<{ questions?: Omit<QuizQuestion, 'id'>[] }>(raw, {
        questions: [],
      });
      if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
        throw new Error('لم يتمكن النموذج من إرجاع بنك أسئلة صالح بصيغة JSON.');
      }
      const questions: QuizQuestion[] = parsed.questions.map((q, idx) => ({
        id: idx + 1,
        question: q.question,
        options: Array.isArray(q.options) ? q.options.slice(0, 4) : [],
        correctIndex: typeof q.correctIndex === 'number' ? q.correctIndex : 0,
        difficulty: q.difficulty === 'medium' || q.difficulty === 'hard' ? q.difficulty : 'easy',
        explanation: q.explanation || '',
      }));
      return { text: '', questions };
    }

    let text = await callOllamaChat(settings, systemInstruction, userPrompt, false);
    if (modeId === 'script') {
      text = sanitizeSpokenScript(text);
    }
    return { text };
  }

  const resp = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: buildProviderPayload(settings),
      modeId,
      systemInstruction,
      userPrompt,
    }),
  });

  const data = await parseSafeJsonResponse<{
    text?: string;
    questions?: QuizQuestion[];
    error?: string;
  }>(resp, 'تعذر توليد المحتوى من الذكاء الاصطناعي');

  return {
    text: data.text || '',
    questions: data.questions,
  };
}

export async function extractCurriculumFromSources(params: {
  settings: AppSettings;
  subjectId?: SubjectId;
  subjectNameAr: string;
  languageSchoolMode?: boolean;
  sourcesText: string;
}): Promise<{
  branches: Array<{ title: string; lessons: string[] }>;
  analysisSummary: string;
  analysisReport?: SourceAnalysisReport;
}> {
  const {
    settings,
    subjectId,
    subjectNameAr,
    languageSchoolMode = true,
    sourcesText,
  } = params;

  if (settings.provider === 'ollama') {
    const requireEnglishTitles = Boolean(
      subjectId && isEnglishStemSubject(subjectId, languageSchoolMode)
    );
    const tocOutline = extractTableOfContentsSnippet(sourcesText);
    const prompt = buildDeepCurriculumPrompt({
      subjectNameAr,
      subjectId,
      languageSchoolMode,
      chunkText: sourcesText.slice(0, 28000),
      chunkIndex: 0,
      totalChunks: 1,
      tocOutline,
    });
    const raw = await callOllamaChat(
      settings,
      `أعد JSON فقط بهذا الشكل: {"summary":"ملخص تحليلي موجز للمصدر","coverageAssessment":"تقييم التغطية","keyConcepts":["مفهوم 1"],"studyRecommendations":["توصية 1"],"branches":[{"title":"اسم الفرع","lessons":["درس 1","درس 2"]}]}. ${requireEnglishTitles ? 'All branch titles and lesson names MUST be in academic English only.' : ''}`,
      prompt,
      true
    );
    const parsed = safeParseAiJson<{
      summary?: string;
      coverageAssessment?: string;
      keyConcepts?: string[];
      studyRecommendations?: string[];
      branches?: Array<{ title: string; lessons: string[] }>;
    }>(raw, { branches: [] });
    const cleanedBranches = mergeBranchExtractions([parsed.branches || []]);
    const totalLessons = cleanedBranches.reduce((sum, b) => sum + b.lessons.length, 0);
    return {
      branches: cleanedBranches,
      analysisSummary: parsed.summary || '',
      analysisReport: {
        overview: parsed.summary || '',
        coverageAssessment: parsed.coverageAssessment || '',
        keyConcepts: parsed.keyConcepts || [],
        studyRecommendations: parsed.studyRecommendations || [],
        branchesCount: cleanedBranches.length,
        lessonsCount: totalLessons,
        chunksAnalyzed: 1,
      },
    };
  }

  const resp = await fetch('/api/ai/extract-curriculum', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: buildProviderPayload(settings),
      subjectId,
      subjectNameAr,
      languageSchoolMode,
      sourcesText,
    }),
  });

  const data = await parseSafeJsonResponse<{
    branches?: Array<{ title: string; lessons: string[] }>;
    analysisSummary?: string;
    analysisReport?: SourceAnalysisReport;
    error?: string;
  }>(resp, 'فشل تحليل المصادر واستخراج الفروع والدروس');

  return {
    branches: data.branches || [],
    analysisSummary: data.analysisSummary || '',
    analysisReport: data.analysisReport,
  };
}

export async function generateSmartSchedule(params: {
  settings: AppSettings;
  examDate: string;
  dailyHours: number;
  languageSchoolMode?: boolean;
  subjectsSummary: Array<{
    id: SubjectId;
    nameAr: string;
    branches: Array<{ title: string; lessons: string[] }>;
  }>;
}): Promise<ScheduleDay[]> {
  const {
    settings,
    examDate,
    dailyHours,
    languageSchoolMode = true,
    subjectsSummary,
  } = params;

  let rawDays: Array<{
    dayIndex?: number;
    dateLabel?: string;
    focusTheme?: string;
    tasks?: Array<{
      subjectId?: string;
      branchTitle?: string;
      lessonTitle?: string;
      modeId?: string;
      durationMinutes?: number;
      notes?: string;
    }>;
  }> = [];

  if (settings.provider === 'ollama') {
    const validSubs = OFFICIAL_SUBJECTS.map((s) => s.id).join(', ');
    const validModes = STUDY_MODES.map((m) => m.id).join(', ');
    const stemNote = languageSchoolMode
      ? 'For math, science, and programming subjects, write branchTitle and lessonTitle strictly in English.'
      : '';
    const raw = await callOllamaChat(
      settings,
      `أعد JSON فقط: {"days":[{"dayIndex":1,"dateLabel":"اليوم 1","focusTheme":"...","tasks":[{"subjectId":"...","branchTitle":"...","lessonTitle":"...","modeId":"...","durationMinutes":45,"notes":"..."}]}]}. subjectId من: ${validSubs}. modeId من: ${validModes}. ${stemNote}`,
      `تاريخ الامتحان: ${examDate} | الساعات اليومية: ${dailyHours}\nالمواد: ${JSON.stringify(subjectsSummary)}`,
      true
    );
    const parsed = safeParseAiJson<{ days?: typeof rawDays }>(raw, { days: [] });
    rawDays = parsed.days || [];
  } else {
    const resp = await fetch('/api/ai/generate-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: buildProviderPayload(settings),
        examDate,
        dailyHours,
        languageSchoolMode,
        subjectsSummary,
      }),
    });

    const data = await parseSafeJsonResponse<{ days?: typeof rawDays; error?: string }>(
      resp,
      'تعذر إنشاء الجدول الزمني الذكي'
    );
    rawDays = data.days || [];
  }

  const validSubjectIds = new Set<string>(OFFICIAL_SUBJECTS.map((s) => s.id));
  const validModeIds = new Set<string>(STUDY_MODES.map((m) => m.id));

  return rawDays.map((day, dIdx) => ({
    dayIndex: day.dayIndex || dIdx + 1,
    dateLabel: day.dateLabel || `اليوم ${dIdx + 1}`,
    focusTheme: day.focusTheme || 'مذاكرة وتطبيق',
    tasks: (day.tasks || []).map((task, tIdx) => ({
      id: `task_${Date.now()}_${dIdx}_${tIdx}`,
      subjectId: (validSubjectIds.has(task.subjectId || '')
        ? task.subjectId
        : subjectsSummary[0]?.id || 'arabic') as SubjectId,
      branchTitle: task.branchTitle || 'عام',
      lessonTitle: task.lessonTitle || 'مراجعة عامة',
      modeId: (validModeIds.has(task.modeId || '') ? task.modeId : 'detailed') as StudyModeId,
      durationMinutes: typeof task.durationMinutes === 'number' ? task.durationMinutes : 45,
      completed: false,
      notes: task.notes || '',
    })),
  }));
}
