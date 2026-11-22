import React, { useCallback, useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import type {
  AppSettings,
  AppState,
  EnglishTrack,
  PageId,
  QuizAttempt,
  SavedNote,
  SourceItem,
  StudyContextPrefill,
  StudySchedule,
  SubjectId,
} from './types/study';
import {
  STORAGE_KEY,
  createInitialState,
  getTodayDateString,
  mergeExtractedCurriculum,
  validateAndParseBackup,
} from './utils/studyLogic';
import { Sidebar } from './components/Sidebar';
import { DashboardPage } from './pages/DashboardPage';
import { StudyRoomPage } from './pages/StudyRoomPage';
import { SourcesHubPage } from './pages/SourcesHubPage';
import { SchedulerPage } from './pages/SchedulerPage';
import { NotesLibraryPage } from './pages/NotesLibraryPage';
import { SettingsPage } from './pages/SettingsPage';
import { attachInteractiveCards } from './utils/cardInteractivity.js';

function loadPersistedState(): AppState {
  if (typeof window === 'undefined') {
    return createInitialState();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    return validateAndParseBackup(raw);
  } catch {
    return createInitialState();
  }
}

export default function App() {
  const [state, setState] = useState<AppState>(() => loadPersistedState());
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [studyPrefill, setStudyPrefill] = useState<StudyContextPrefill | null>(null);

  // Attach dedicated JavaScript interactive card border & hover controller
  useEffect(() => {
    return attachInteractiveCards(document.body, '.interactive-card');
  }, []);

  // Persist all state updates to localStorage
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore quota errors gracefully
    }
  }, [state]);

  // Sync dark/light class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (state.settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [state.settings.theme]);

  const handleToggleLesson = useCallback(
    (subjectId: SubjectId, branchId: string, lessonId: string) => {
      setState((prev) => ({
        ...prev,
        subjects: prev.subjects.map((sub) =>
          sub.id !== subjectId
            ? sub
            : {
                ...sub,
                branches: sub.branches.map((branch) =>
                  branch.id !== branchId
                    ? branch
                    : {
                        ...branch,
                        lessons: branch.lessons.map((lesson) =>
                          lesson.id !== lessonId
                            ? lesson
                            : { ...lesson, completed: !lesson.completed }
                        ),
                      }
                ),
              }
        ),
      }));
    },
    []
  );

  const handleChangeEnglishTrack = useCallback((track: EnglishTrack) => {
    setState((prev) => ({
      ...prev,
      englishTrack: track,
    }));
  }, []);

  const handleLogPomodoroMinutes = useCallback((minutes: number) => {
    const today = getTodayDateString();
    setState((prev) => {
      const hasToday = prev.studyDates.includes(today);
      return {
        ...prev,
        studyMinutes: prev.studyMinutes + Math.max(1, minutes),
        studyDates: hasToday ? prev.studyDates : [...prev.studyDates, today],
      };
    });
  }, []);

  const handleLaunchStudyRoom = useCallback((prefill: StudyContextPrefill) => {
    setStudyPrefill(prefill);
    setActivePage('study-room');
  }, []);

  const handleClearPrefill = useCallback(() => {
    setStudyPrefill(null);
  }, []);

  const handleAddSource = useCallback((source: Omit<SourceItem, 'id' | 'createdAt'>) => {
    const created: SourceItem = {
      ...source,
      id: `src_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
    };
    setState((prev) => ({
      ...prev,
      sources: [created, ...prev.sources],
    }));
  }, []);

  const handleToggleSourceActive = useCallback((sourceId: string) => {
    setState((prev) => ({
      ...prev,
      sources: prev.sources.map((s) =>
        s.id === sourceId ? { ...s, active: !s.active } : s
      ),
    }));
  }, []);

  const handleDeleteSource = useCallback((sourceId: string) => {
    setState((prev) => ({
      ...prev,
      sources: prev.sources.filter((s) => s.id !== sourceId),
    }));
  }, []);

  const handleUpdateSubjectCurriculum = useCallback(
    (subjectId: SubjectId, extractedBranches: Array<{ title: string; lessons: string[] }>) => {
      setState((prev) => ({
        ...prev,
        subjects: prev.subjects.map((sub) =>
          sub.id !== subjectId
            ? sub
            : {
                ...sub,
                branches: mergeExtractedCurriculum(sub.branches, extractedBranches),
              }
        ),
      }));
    },
    []
  );

  const handleSaveNote = useCallback((note: Omit<SavedNote, 'id' | 'createdAt'>) => {
    const created: SavedNote = {
      ...note,
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
    };
    setState((prev) => ({
      ...prev,
      notes: [created, ...prev.notes],
    }));
  }, []);

  const handleDeleteNote = useCallback((noteId: string) => {
    setState((prev) => ({
      ...prev,
      notes: prev.notes.filter((n) => n.id !== noteId),
    }));
  }, []);

  const handleRecordQuizAttempt = useCallback(
    (attempt: Omit<QuizAttempt, 'id' | 'createdAt'>) => {
      const created: QuizAttempt = {
        ...attempt,
        id: `quiz_${Date.now()}`,
        createdAt: new Date().toISOString(),
      };
      setState((prev) => ({
        ...prev,
        quizAttempts: [created, ...prev.quizAttempts],
      }));
    },
    []
  );

  const handleSaveSchedule = useCallback((schedule: StudySchedule | null) => {
    setState((prev) => ({
      ...prev,
      schedule,
    }));
  }, []);

  const handleToggleScheduleTask = useCallback((dayIndex: number, taskId: string) => {
    setState((prev) => {
      if (!prev.schedule) return prev;
      return {
        ...prev,
        schedule: {
          ...prev.schedule,
          days: prev.schedule.days.map((day) =>
            day.dayIndex !== dayIndex
              ? day
              : {
                  ...day,
                  tasks: day.tasks.map((task) =>
                    task.id !== taskId ? task : { ...task, completed: !task.completed }
                  ),
                }
          ),
        },
      };
    });
  }, []);

  const handleUpdateSettings = useCallback((partial: Partial<AppSettings>) => {
    setState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        ...partial,
      },
    }));
  }, []);

  const handleImportBackup = useCallback((restored: AppState) => {
    setState(restored);
  }, []);

  const handleResetAllData = useCallback(() => {
    const fresh = createInitialState();
    setState(fresh);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    } catch {
      // Ignore
    }
  }, []);

  const activeSourcesCount = state.sources.filter((s) => s.active).length;

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col lg:flex-row"
    >
      {/* Persistent Right-Aligned Sidebar */}
      <Sidebar
        activePage={activePage}
        onNavigate={setActivePage}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        activeSourcesCount={activeSourcesCount}
        notesCount={state.notes.length}
      />

      {/* Mobile Header Bar */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="فتح القائمة"
          className="p-2 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="text-sm font-bold text-slate-900 dark:text-white whitespace-nowrap">
          منصة البكالوريا الذكية
        </span>
        <div className="w-9" />
      </header>

      {/* Main Content Viewport */}
      <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="max-w-7xl mx-auto">
          {activePage === 'dashboard' && (
            <DashboardPage
              state={state}
              onToggleLesson={handleToggleLesson}
              onChangeEnglishTrack={handleChangeEnglishTrack}
              onLogPomodoroMinutes={handleLogPomodoroMinutes}
              onNavigate={setActivePage}
              onStudyLesson={handleLaunchStudyRoom}
            />
          )}

          {activePage === 'study-room' && (
            <StudyRoomPage
              state={state}
              prefill={studyPrefill}
              onClearPrefill={handleClearPrefill}
              onChangeEnglishTrack={handleChangeEnglishTrack}
              onSaveNote={handleSaveNote}
              onRecordQuizAttempt={handleRecordQuizAttempt}
            />
          )}

          {activePage === 'sources' && (
            <SourcesHubPage
              state={state}
              onAddSource={handleAddSource}
              onToggleSourceActive={handleToggleSourceActive}
              onDeleteSource={handleDeleteSource}
              onUpdateSubjectCurriculum={handleUpdateSubjectCurriculum}
              onToggleAutoSync={(enabled) => handleUpdateSettings({ autoSyncSources: enabled })}
              onLaunchStudyRoom={handleLaunchStudyRoom}
            />
          )}

          {activePage === 'scheduler' && (
            <SchedulerPage
              state={state}
              onSaveSchedule={handleSaveSchedule}
              onToggleTask={handleToggleScheduleTask}
              onLaunchStudyTask={handleLaunchStudyRoom}
            />
          )}

          {activePage === 'notes' && (
            <NotesLibraryPage state={state} onDeleteNote={handleDeleteNote} />
          )}

          {activePage === 'settings' && (
            <SettingsPage
              state={state}
              onUpdateSettings={handleUpdateSettings}
              onChangeEnglishTrack={handleChangeEnglishTrack}
              onImportBackup={handleImportBackup}
              onResetAllData={handleResetAllData}
            />
          )}
        </div>
      </main>
    </div>
  );
}
