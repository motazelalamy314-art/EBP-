import React, { useMemo, useRef, useState } from 'react';
import {
  FileUp,
  FileText,
  Sparkles,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
  ScanText,
  Square,
  Image as ImageIcon,
  BookOpen,
} from 'lucide-react';
import type {
  AppState,
  SourceAnalysisReport,
  SourceItem,
  SourceType,
  StudyContextPrefill,
  SubjectId,
} from '../types/study';
import {
  SOURCE_TYPE_LABELS,
  getSubjectDisplayName,
  isEnglishStemSubject,
} from '../utils/studyLogic';
import {
  extractTextFromPdfFile,
  fileToOcrImage,
  renderPdfPageRangeToImages,
  type PdfExtractionProgress,
} from '../utils/pdfExtractor';
import { extractCurriculumFromSources, performOcrOnImages } from '../utils/aiClient';

interface SourcesHubPageProps {
  state: AppState;
  onAddSource: (source: Omit<SourceItem, 'id' | 'createdAt'>) => void;
  onToggleSourceActive: (sourceId: string) => void;
  onDeleteSource: (sourceId: string) => void;
  onUpdateSubjectCurriculum: (
    subjectId: SubjectId,
    extractedBranches: Array<{ title: string; lessons: string[] }>
  ) => void;
  onToggleAutoSync: (enabled: boolean) => void;
  onLaunchStudyRoom?: (prefill: StudyContextPrefill) => void;
}

export const SourcesHubPage: React.FC<SourcesHubPageProps> = ({
  state,
  onAddSource,
  onToggleSourceActive,
  onDeleteSource,
  onUpdateSubjectCurriculum,
  onToggleAutoSync,
  onLaunchStudyRoom,
}) => {
  const [selectedSubjectId, setSelectedSubjectId] = useState<SubjectId>('arabic');
  const [sourceType, setSourceType] = useState<SourceType>('ministry_book');
  const [title, setTitle] = useState<string>('');
  const [rawText, setRawText] = useState<string>('');
  const [pageCount, setPageCount] = useState<number | undefined>(undefined);

  // PDF progress & warnings
  const [pdfProgress, setPdfProgress] = useState<PdfExtractionProgress | null>(null);
  const [isExtractingPdf, setIsExtractingPdf] = useState<boolean>(false);
  const [scannedWarning, setScannedWarning] = useState<boolean>(false);
  const [lastPdfFile, setLastPdfFile] = useState<File | null>(null);
  const [ocrStartPage, setOcrStartPage] = useState<number>(1);
  const [ocrEndPage, setOcrEndPage] = useState<number>(10);

  // OCR state
  const [isRunningOcr, setIsRunningOcr] = useState<boolean>(false);
  const [ocrProgress, setOcrProgress] = useState<{
    current: number;
    total: number;
    label: string;
  } | null>(null);
  const ocrCancelRef = useRef<boolean>(false);

  // Curriculum AI extraction state
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [analysisSummary, setAnalysisSummary] = useState<string>('');
  const [analysisReport, setAnalysisReport] = useState<SourceAnalysisReport | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const languageSchoolMode = state.settings.languageSchoolMode ?? true;

  const currentSubject = useMemo(
    () => state.subjects.find((s) => s.id === selectedSubjectId) || state.subjects[0],
    [state.subjects, selectedSubjectId]
  );

  const currentSubjectDisplay = getSubjectDisplayName(currentSubject, languageSchoolMode);
  const isCurrentEngStem = isEnglishStemSubject(currentSubject.id, languageSchoolMode);

  const subjectSources = useMemo(
    () => state.sources.filter((s) => s.subjectId === selectedSubjectId),
    [state.sources, selectedSubjectId]
  );

  const activeSubjectSources = useMemo(
    () => subjectSources.filter((s) => s.active),
    [subjectSources]
  );

  const runCurriculumAnalysis = async (sourcesToUse: SourceItem[]) => {
    if (sourcesToUse.length === 0) {
      setErrorMsg('يرجى إضافة وتفعيل مصدر واحد على الأقل لهذه المادة قبل التحليل.');
      return;
    }

    setErrorMsg('');
    setStatusMessage('');
    setAnalysisSummary('');
    setAnalysisReport(null);
    setIsAnalyzing(true);
    try {
      const combinedText = sourcesToUse
        .map((s) => `=== ${s.title} (${SOURCE_TYPE_LABELS[s.type]}) ===\n${s.content}`)
        .join('\n\n');

      const result = await extractCurriculumFromSources({
        settings: state.settings,
        subjectId: selectedSubjectId,
        subjectNameAr: currentSubjectDisplay,
        languageSchoolMode,
        sourcesText: combinedText,
      });

      if (result.branches.length === 0) {
        setErrorMsg('لم يتم العثور على فروع أو دروس واضحة داخل المصادر النشطة.');
        return;
      }

      onUpdateSubjectCurriculum(selectedSubjectId, result.branches);
      const totalLessons = result.branches.reduce((sum, b) => sum + b.lessons.length, 0);
      setStatusMessage(
        `تم التحليل العميق للمصادر بنجاح: استخراج ${result.branches.length} فروع و ${totalLessons} درس لمادة ${currentSubjectDisplay}.`
      );
      if (result.analysisSummary) {
        setAnalysisSummary(result.analysisSummary);
      }
      if (result.analysisReport) {
        setAnalysisReport(result.analysisReport);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'حدث خطأ أثناء تحليل المصادر بالذكاء الاصطناعي.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const runImageFilesOcr = async (imageFiles: File[]) => {
    setErrorMsg('');
    setIsRunningOcr(true);
    ocrCancelRef.current = false;
    setOcrProgress({ current: 0, total: imageFiles.length, label: 'جاري تجهيز الصور للـ OCR...' });

    const extractedParts: string[] = [];
    try {
      // Process 2 images per batch for speed and accuracy
      const batchSize = 2;
      for (let i = 0; i < imageFiles.length; i += batchSize) {
        if (ocrCancelRef.current) break;
        const batchFiles = imageFiles.slice(i, i + batchSize);
        const payloads = await Promise.all(batchFiles.map((f) => fileToOcrImage(f)));

        setOcrProgress({
          current: Math.min(i + batchFiles.length, imageFiles.length),
          total: imageFiles.length,
          label: `جاري استخراج النص بالـ OCR (${batchFiles.map((f) => f.name).join('، ')})`,
        });

        const text = await performOcrOnImages({
          settings: state.settings,
          subjectNameAr: currentSubjectDisplay,
          images: payloads,
        });

        if (text) {
          extractedParts.push(text);
          setRawText((prev) => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
        }
      }

      if (extractedParts.length > 0) {
        setStatusMessage(
          `تم استخراج النص بنجاح عبر OCR من ${imageFiles.length} ${
            imageFiles.length === 1 ? 'صورة' : 'صور'
          }. يمكنك مراجعته أو حفظه كمصدر.`
        );
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'حدث خطأ أثناء تشغيل خاصية OCR على الصور.'
      );
    } finally {
      setIsRunningOcr(false);
      setOcrProgress(null);
    }
  };

  const handleRunScannedPdfOcr = async () => {
    if (!lastPdfFile) return;

    const total = pageCount || 1;
    const safeStart = Math.max(1, Math.min(total, ocrStartPage));
    const safeEnd = Math.max(safeStart, Math.min(total, ocrEndPage));
    const rangeCount = safeEnd - safeStart + 1;

    setErrorMsg('');
    setStatusMessage('');
    setIsRunningOcr(true);
    ocrCancelRef.current = false;

    const extractedPages: string[] = [];
    const batchSize = 2;

    try {
      for (let page = safeStart; page <= safeEnd; page += batchSize) {
        if (ocrCancelRef.current) break;
        const batchEnd = Math.min(safeEnd, page + batchSize - 1);

        setOcrProgress({
          current: batchEnd - safeStart + 1,
          total: rangeCount,
          label: `جاري تحويل وقراءة OCR للصفحات ${page} إلى ${batchEnd} من أصل ${safeEnd}...`,
        });

        const pageImages = await renderPdfPageRangeToImages(lastPdfFile, {
          startPage: page,
          endPage: batchEnd,
          scale: 1.6,
        });

        if (ocrCancelRef.current) break;

        const text = await performOcrOnImages({
          settings: state.settings,
          subjectNameAr: currentSubjectDisplay,
          images: pageImages,
        });

        if (text) {
          extractedPages.push(text);
          setRawText((prev) => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
        }
      }

      if (extractedPages.length > 0) {
        setScannedWarning(false);
        setStatusMessage(
          `اكتمل استخراج النص بالـ OCR للصفحات (${safeStart}–${safeEnd}). اضغط "حفظ المصدر وتفعيله" ثم "تحليل المصادر".`
        );
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'تعذر إكمال OCR لملف PDF المصوّر.'
      );
    } finally {
      setIsRunningOcr(false);
      setOcrProgress(null);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setErrorMsg('');
    setStatusMessage('');
    setScannedWarning(false);
    setPageCount(undefined);
    setLastPdfFile(null);

    const imageExts = ['png', 'jpg', 'jpeg', 'webp'];
    const allImages = files.every((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase() || '';
      return imageExts.includes(ext);
    });

    if (allImages) {
      if (!title.trim()) {
        setTitle(
          files.length === 1
            ? files[0].name.replace(/\.[^/.]+$/, '')
            : `صور منهج ${currentSubjectDisplay} (${files.length})`
        );
      }
      await runImageFilesOcr(files);
      e.target.value = '';
      return;
    }

    const file = files[0];
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!title.trim()) {
      setTitle(file.name.replace(/\.[^/.]+$/, ''));
    }

    if (ext === 'pdf') {
      setIsExtractingPdf(true);
      setPdfProgress({ currentPage: 0, totalPages: 0, charCount: 0 });
      try {
        const result = await extractTextFromPdfFile(file, (progress) => {
          setPdfProgress(progress);
        });
        setRawText(result.text);
        setPageCount(result.pageCount);
        setLastPdfFile(file);
        setOcrStartPage(1);
        setOcrEndPage(Math.min(result.pageCount, 15));
        if (result.isLikelyScanned) {
          setScannedWarning(true);
        }
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? `تعذر قراءة ملف PDF: ${err.message}`
            : 'حدث خطأ أثناء استخراج النص من ملف PDF.'
        );
      } finally {
        setIsExtractingPdf(false);
      }
    } else if (['txt', 'md', 'csv', 'json'].includes(ext)) {
      try {
        const text = await file.text();
        setRawText(text);
      } catch {
        setErrorMsg('تعذر قراءة الملف النصي.');
      }
    } else {
      setErrorMsg(
        'صيغة الملف غير مدعومة. الصيغ المدعومة: PDF, PNG, JPG, JPEG, WEBP, TXT, MD, CSV, JSON.'
      );
    }

    e.target.value = '';
  };

  const handleSaveSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMessage('');

    const cleanTitle = title.trim();
    const cleanContent = rawText.trim();
    if (!cleanTitle) {
      setErrorMsg('من فضلك أدخل عنواناً للمصدر.');
      return;
    }
    if (!cleanContent) {
      setErrorMsg('محتوى المصدر فارغ. ارفع ملفاً أو صورة للـ OCR أو الصق النص أولاً.');
      return;
    }

    const newSourceDraft: Omit<SourceItem, 'id' | 'createdAt'> = {
      subjectId: selectedSubjectId,
      title: cleanTitle,
      type: sourceType,
      content: cleanContent,
      charCount: cleanContent.length,
      pageCount,
      active: true,
    };

    onAddSource(newSourceDraft);
    setTitle('');
    setRawText('');
    setPageCount(undefined);
    setPdfProgress(null);
    setScannedWarning(false);
    setLastPdfFile(null);
    setStatusMessage(`تمت إضافة "${cleanTitle}" وتفعيله كمصدر لمادة ${currentSubjectDisplay}.`);

    if (state.settings.autoSyncSources) {
      const syntheticList: SourceItem[] = [
        ...activeSubjectSources,
        {
          ...newSourceDraft,
          id: 'temp',
          createdAt: new Date().toISOString(),
        },
      ];
      await runCurriculumAnalysis(syntheticList);
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            مصادر المنهج والـ OCR الذكي
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            ارفع كتب الوزارة (PDF نصي أو مصوّر) أو صور الصفحات (OCR) ثم حللها لاستخراج الفروع والدروس بدقة
          </p>
        </div>

        {/* Auto-sync toggle */}
        <button
          type="button"
          onClick={() => onToggleAutoSync(!state.settings.autoSyncSources)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-indigo-500/50 transition-colors shrink-0"
        >
          {state.settings.autoSyncSources ? (
            <ToggleRight className="w-5 h-5 text-emerald-500" />
          ) : (
            <ToggleLeft className="w-5 h-5 text-slate-400" />
          )}
          <span>مزامنة تلقائية للفروع عند الإضافة</span>
        </button>
      </header>

      {/* Subject Filter Bar */}
      <section aria-label="اختيار المادة" className="flex flex-wrap gap-2">
        {state.subjects.map((sub) => {
          const count = state.sources.filter((s) => s.subjectId === sub.id).length;
          const active = selectedSubjectId === sub.id;
          const displayName = getSubjectDisplayName(sub, languageSchoolMode);
          const isEngStem = isEnglishStemSubject(sub.id, languageSchoolMode);
          return (
            <button
              key={sub.id}
              type="button"
              onClick={() => {
                setSelectedSubjectId(sub.id);
                setErrorMsg('');
                setStatusMessage('');
                setAnalysisSummary('');
                setAnalysisReport(null);
              }}
              className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold border transition-colors whitespace-nowrap ${
                active
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-indigo-500/50'
              }`}
            >
              <bdi dir={isEngStem ? 'ltr' : 'rtl'}>{displayName}</bdi>{' '}
              <span className="font-mono tabular-nums opacity-75">({count})</span>
            </button>
          );
        })}
      </section>

      {errorMsg && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs sm:text-sm text-red-600 dark:text-red-400 flex items-center gap-2.5"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Add Source Form + OCR Ingestion */}
        <form
          onSubmit={handleSaveSource}
          className="interactive-card lg:col-span-6 p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              إضافة مصدر لمادة:{' '}
              <bdi dir={isCurrentEngStem ? 'ltr' : 'rtl'}>{currentSubjectDisplay}</bdi>
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="source-title"
                className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
              >
                عنوان المصدر
              </label>
              <input
                id="source-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثال: كتاب الوزارة - الترم الأول"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label
                htmlFor="source-type"
                className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
              >
                نوع المصدر
              </label>
              <select
                id="source-type"
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value as SourceType)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="ministry_book">كتاب الوزارة</option>
                <option value="summary_sheet">ملزمة / تلخيص</option>
                <option value="video_article">رابط فيديو / مقال</option>
              </select>
            </div>
          </div>

          {/* Multi-format File & Image OCR Upload */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/60 hover:border-indigo-500 cursor-pointer transition-colors text-center">
              <FileUp className="w-6 h-6 text-indigo-500 mb-1.5" />
              <span className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200">
                رفع PDF أو ملف نصي
              </span>
              <span className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                PDF, TXT, MD, CSV, JSON
              </span>
              <input
                type="file"
                accept=".pdf,.txt,.md,.csv,.json"
                onChange={handleFileUpload}
                className="sr-only"
              />
            </label>

            <label className="flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed border-indigo-400/50 dark:border-indigo-500/40 bg-indigo-50/50 dark:bg-indigo-950/20 hover:border-indigo-500 cursor-pointer transition-colors text-center">
              <ImageIcon className="w-6 h-6 text-indigo-500 mb-1.5" />
              <span className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200">
                رفع صور لاستخراج OCR
              </span>
              <span className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                PNG, JPG, WEBP (صور متعددة)
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                multiple
                onChange={handleFileUpload}
                className="sr-only"
              />
            </label>
          </div>

          {/* Live PDF Progress Bar */}
          {pdfProgress && (isExtractingPdf || pdfProgress.totalPages > 0) && (
            <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-slate-700 dark:text-slate-200">
                  {isExtractingPdf ? 'جاري قراءة صفحات الـ PDF...' : 'اكتمل فحص ملف الـ PDF'}
                </span>
                <span className="font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
                  صفحة {pdfProgress.currentPage} من {pdfProgress.totalPages} ·{' '}
                  {pdfProgress.charCount.toLocaleString('en-US')} حرف
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-indigo-600 transition-all duration-150"
                  style={{
                    width: `${
                      pdfProgress.totalPages > 0
                        ? Math.round((pdfProgress.currentPage / pdfProgress.totalPages) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Scanned / Image-Only PDF Alert + Built-in Smart OCR Launcher */}
          {(scannedWarning || (lastPdfFile && !isExtractingPdf)) && (
            <div
              role={scannedWarning ? 'alert' : undefined}
              className={`p-4 rounded-xl border text-xs sm:text-sm space-y-3 ${
                scannedWarning
                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-800 dark:text-amber-200'
                  : 'bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              <div className="flex items-start gap-2.5">
                {scannedWarning ? (
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                ) : (
                  <ScanText className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-bold">
                    {scannedWarning
                      ? 'تنبيه: ملف PDF مصوّر (Scanned / Image-Only)'
                      : 'قراءة صفحات الـ PDF عبر OCR الذكي (اختياري للجداول والصور)'}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed opacity-90">
                    {scannedWarning
                      ? 'الملف لا يحتوي على نص قابل للتحديد مباشرة. يمكنك استخدام محرك الـ OCR الذكي لقراءة الصفحات واستخراج النصوص والمعادلات بدقة.'
                      : 'إذا كانت هناك صفحات تحتوي على معادلات أو صور لم تُقرأ جيداً، يمكنك تشغيل OCR على نطاق صفحات محدد.'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3 pt-1">
                <div>
                  <label
                    htmlFor="ocr-start-page"
                    className="block text-xs font-semibold mb-1"
                  >
                    من صفحة
                  </label>
                  <input
                    id="ocr-start-page"
                    type="number"
                    min={1}
                    max={pageCount || 999}
                    value={ocrStartPage}
                    onChange={(e) => setOcrStartPage(Math.max(1, Number(e.target.value) || 1))}
                    className="w-20 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label
                    htmlFor="ocr-end-page"
                    className="block text-xs font-semibold mb-1"
                  >
                    إلى صفحة
                  </label>
                  <input
                    id="ocr-end-page"
                    type="number"
                    min={ocrStartPage}
                    max={pageCount || 999}
                    value={ocrEndPage}
                    onChange={(e) =>
                      setOcrEndPage(Math.max(ocrStartPage, Number(e.target.value) || ocrStartPage))
                    }
                    className="w-20 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </div>
                <button
                  type="button"
                  disabled={isRunningOcr}
                  onClick={handleRunScannedPdfOcr}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-60 transition-colors"
                >
                  <ScanText className="w-4 h-4" />
                  <span>تشغيل OCR على الـ PDF</span>
                </button>
              </div>
            </div>
          )}

          {/* Live OCR Progress Indicator */}
          {isRunningOcr && ocrProgress && (
            <div className="p-4 rounded-xl bg-indigo-600/10 border border-indigo-500/30 space-y-2.5">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>{ocrProgress.label}</span>
                </span>
                <span className="font-mono tabular-nums shrink-0">
                  {ocrProgress.current}/{ocrProgress.total}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-indigo-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-indigo-600 transition-all duration-200"
                  style={{
                    width: `${
                      ocrProgress.total > 0
                        ? Math.round((ocrProgress.current / ocrProgress.total) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  ocrCancelRef.current = true;
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-500"
              >
                <Square className="w-3 h-3" />
                <span>إيقاف OCR والاحتفاظ بما تم استخراجه</span>
              </button>
            </div>
          )}

          {/* Raw Text / Link Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="source-content"
                className="text-xs font-semibold text-slate-600 dark:text-slate-300"
              >
                محتوى المصدر (نص مستخرج بالـ OCR أو PDF أو لصق يدوي)
              </label>
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {rawText.trim().length.toLocaleString('en-US')} حرف
              </span>
            </div>
            <textarea
              id="source-content"
              rows={6}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="ارفع صوراً أو PDF ليتم تفريغها هنا تلقائياً، أو الصق فهرس الكتاب ونص الدروس..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <button
            type="submit"
            disabled={isExtractingPdf || isRunningOcr}
            className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-60 transition-colors"
          >
            حفظ المصدر وتفعيله
          </button>
        </form>

        {/* Active Sources List + Deep AI Curriculum Extraction */}
        <div className="lg:col-span-6 space-y-5">
          {/* Primary AI Extraction Action Card */}
          <div className="interactive-card p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  التحليل العميق للمصادر وتحديث المنهج
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {activeSubjectSources.length} مصادر مفعّلة للمادة · {currentSubject.branches.length} فروع حالية
                </p>
              </div>
              <button
                type="button"
                disabled={isAnalyzing || activeSubjectSources.length === 0}
                onClick={() => runCurriculumAnalysis(activeSubjectSources)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>جاري التحليل العميق...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>تحليل المصادر وتحديث الفروع والدروس</span>
                  </>
                )}
              </button>
            </div>

            {isCurrentEngStem && (
              <p className="text-xs text-indigo-600 dark:text-indigo-400">
                نظام مدارس اللغات مفعّل: سيتم استخراج جميع الفروع والدروس لهذه المادة باللغة الإنجليزية الأكاديمية.
              </p>
            )}

            {statusMessage && (
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{statusMessage}</span>
              </div>
            )}

            {(analysisReport || analysisSummary) && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                    تقرير التحليل العميق للمصادر
                  </span>
                  {analysisReport && (
                    <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {analysisReport.branchesCount} فروع · {analysisReport.lessonsCount} درس · {analysisReport.chunksAnalyzed} أجزاء محللة
                    </span>
                  )}
                </div>

                {analysisReport?.coverageAssessment && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
                    نطاق التغطية: {analysisReport.coverageAssessment}
                  </p>
                )}

                {(analysisReport?.overview || analysisSummary) && (
                  <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                    {analysisReport?.overview || analysisSummary}
                  </p>
                )}

                {analysisReport && analysisReport.keyConcepts.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      أهم المفاهيم والمحاور المستخرجة
                    </div>
                    <p
                      dir={isCurrentEngStem ? 'ltr' : 'rtl'}
                      className={`text-xs text-slate-600 dark:text-slate-400 leading-relaxed ${
                        isCurrentEngStem ? 'text-right' : ''
                      }`}
                    >
                      {analysisReport.keyConcepts.join(' · ')}
                    </p>
                  </div>
                )}

                {analysisReport && analysisReport.studyRecommendations.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      توصيات ذكية لمذاكرة هذا المصدر
                    </div>
                    <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400 list-disc pr-4">
                      {analysisReport.studyRecommendations.map((rec, idx) => (
                        <li key={idx}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Instant Preview of Extracted Branches & Lessons */}
            {currentSubject.branches.length > 0 && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  الهيكل المستخرج ({currentSubject.branches.length} فروع)
                </div>
                <div className="max-h-56 overflow-y-auto space-y-2.5 pl-1">
                  {currentSubject.branches.map((branch) => (
                    <div
                      key={branch.id}
                      className="pb-2 border-b border-slate-100 dark:border-slate-800/70 last:border-b-0 space-y-1"
                    >
                      <div
                        dir={isCurrentEngStem ? 'ltr' : 'rtl'}
                        className={`text-xs font-bold text-indigo-600 dark:text-indigo-400 ${
                          isCurrentEngStem ? 'text-right' : ''
                        }`}
                      >
                        {branch.title} ({branch.lessons.length})
                      </div>
                      <ul className="space-y-1">
                        {branch.lessons.map((lesson) => (
                          <li
                            key={lesson.id}
                            className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300"
                          >
                            <span
                              dir={isCurrentEngStem ? 'ltr' : 'rtl'}
                              className={`truncate ${isCurrentEngStem ? 'text-right' : ''}`}
                            >
                              {lesson.title}
                            </span>
                            {onLaunchStudyRoom && (
                              <button
                                type="button"
                                onClick={() =>
                                  onLaunchStudyRoom({
                                    subjectId: currentSubject.id,
                                    branchTitle: branch.title,
                                    lessonTitle: lesson.title,
                                    modeId: 'detailed',
                                  })
                                }
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
                              >
                                <BookOpen className="w-3 h-3" />
                                <span>ذاكر</span>
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sources List */}
          <div className="interactive-card p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              مصادر <bdi dir={isCurrentEngStem ? 'ltr' : 'rtl'}>{currentSubjectDisplay}</bdi> ({subjectSources.length})
            </h3>

            {subjectSources.length === 0 ? (
              <div className="py-8 text-center text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                <FileText className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                <p>
                  لا توجد مصادر مرفوعة لمادة{' '}
                  <bdi dir={isCurrentEngStem ? 'ltr' : 'rtl'}>{currentSubjectDisplay}</bdi> حتى الآن.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {subjectSources.map((src) => (
                  <div
                    key={src.id}
                    className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                          {src.title}
                        </h4>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                          {SOURCE_TYPE_LABELS[src.type]} · {src.charCount.toLocaleString('en-US')} حرف
                          {src.pageCount ? ` · ${src.pageCount} صفحة` : ''}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onToggleSourceActive(src.id)}
                          aria-pressed={src.active}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                            src.active
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                              : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {src.active ? 'مفعّل كمرجع للـ AI' : 'غير مفعّل'}
                        </button>

                        <button
                          type="button"
                          onClick={() => onDeleteSource(src.id)}
                          aria-label={`حذف المصدر ${src.title}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed">
                      {src.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
