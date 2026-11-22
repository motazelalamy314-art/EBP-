import React, { useMemo, useState } from 'react';
import {
  Search,
  Copy,
  Check,
  Download,
  Trash2,
  BookmarkCheck,
} from 'lucide-react';
import type { AppState, SavedNote, StudyModeId, SubjectId } from '../types/study';
import { STUDY_MODES, getSubjectDisplayName } from '../utils/studyLogic';
import { MarkdownRenderer } from '../components/MarkdownRenderer';

interface NotesLibraryPageProps {
  state: AppState;
  onDeleteNote: (noteId: string) => void;
}

export const NotesLibraryPage: React.FC<NotesLibraryPageProps> = ({
  state,
  onDeleteNote,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [subjectFilter, setSubjectFilter] = useState<SubjectId | 'all'>('all');
  const [modeFilter, setModeFilter] = useState<StudyModeId | 'all'>('all');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    state.notes[0]?.id || null
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return state.notes.filter((note) => {
      if (subjectFilter !== 'all' && note.subjectId !== subjectFilter) return false;
      if (modeFilter !== 'all' && note.modeId !== modeFilter) return false;
      if (!q) return true;
      return (
        note.title.toLowerCase().includes(q) ||
        note.lessonTitle.toLowerCase().includes(q) ||
        note.branchTitle.toLowerCase().includes(q) ||
        note.content.toLowerCase().includes(q)
      );
    });
  }, [state.notes, searchQuery, subjectFilter, modeFilter]);

  const languageSchoolMode = state.settings.languageSchoolMode ?? true;

  const activeNote: SavedNote | null =
    filteredNotes.find((n) => n.id === selectedNoteId) || filteredNotes[0] || null;

  const getSubjectName = (id: SubjectId) => {
    const found = state.subjects.find((s) => s.id === id);
    return found ? getSubjectDisplayName(found, languageSchoolMode) : id;
  };
  const getModeLabel = (id: StudyModeId) =>
    STUDY_MODES.find((m) => m.id === id)?.label || id;

  const handleCopy = async (note: SavedNote) => {
    try {
      await navigator.clipboard.writeText(note.content);
      setCopiedId(note.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const handleDownloadMarkdown = (note: SavedNote) => {
    const blob = new Blob([`# ${note.title}\n\n${note.content}`], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${note.lessonTitle.replace(/[^a-zA-Z0-9\u0600-\u06FF_-]+/g, '_')}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
          مكتبة الملخصات المحفوظة
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          تصفح جميع الشروحات والاسكريبتات وبنوك الأسئلة المحفوظة وابحث فيها أو صدّرها بصيغة Markdown
        </p>
      </header>

      {/* Search & Filter Toolbar */}
      <section className="interactive-card p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-6 relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث في العناوين أو محتوى الملخصات..."
            aria-label="بحث في الملخصات"
            className="w-full pr-10 pl-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="md:col-span-3">
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value as SubjectId | 'all')}
            aria-label="تصفية حسب المادة"
            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">كل المواد</option>
            {state.subjects.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {getSubjectDisplayName(sub, languageSchoolMode)}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-3">
          <select
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value as StudyModeId | 'all')}
            aria-label="تصفية حسب وضع المذاكرة"
            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">كل الأوضاع</option>
            {STUDY_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      {filteredNotes.length === 0 ? (
        <div className="interactive-card p-10 rounded-2xl bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-800 text-center space-y-2">
          <BookmarkCheck className="w-9 h-9 text-indigo-500 mx-auto" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {state.notes.length === 0
              ? 'مكتبة الملخصات فارغة حالياً'
              : 'لا توجد نتائج مطابقة للبحث'}
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            {state.notes.length === 0
              ? 'احفظ أي شرح أو اسكريبت أو بنك أسئلة من غرفة المذاكرة ليظهر هنا فوراً.'
              : 'جرب تغيير كلمات البحث أو إزالة الفلاتر.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Notes List */}
          <div className="lg:col-span-4 space-y-2.5">
            {filteredNotes.map((note) => {
              const isSelected = activeNote?.id === note.id;
              return (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => setSelectedNoteId(note.id)}
                  className={`interactive-card w-full text-right p-4 rounded-xl border transition-colors ${
                    isSelected
                      ? 'bg-indigo-600/10 border-indigo-500 text-slate-900 dark:text-white'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:border-indigo-500/40'
                  }`}
                >
                  <div className="text-sm font-bold truncate">{note.title}</div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {getSubjectName(note.subjectId)} · {getModeLabel(note.modeId)}
                  </div>
                  <div className="mt-1 text-xs text-slate-400 dark:text-slate-500 font-mono tabular-nums">
                    {new Date(note.createdAt).toLocaleDateString('ar-EG')}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Note Reader */}
          {activeNote && (
            <article className="interactive-card lg:col-span-8 p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
                    {activeNote.title}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {getSubjectName(activeNote.subjectId)} · {activeNote.branchTitle} ·{' '}
                    {getModeLabel(activeNote.modeId)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(activeNote)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    {copiedId === activeNote.id ? (
                      <Check className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                    <span>{copiedId === activeNote.id ? 'تم النسخ' : 'نسخ'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDownloadMarkdown(activeNote)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    <span>تصدير Markdown</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onDeleteNote(activeNote.id)}
                    aria-label={`حذف ${activeNote.title}`}
                    className="p-2 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <MarkdownRenderer content={activeNote.content} />
            </article>
          )}
        </div>
      )}
    </div>
  );
};
