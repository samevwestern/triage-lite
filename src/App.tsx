import React, { useState, useEffect } from 'react';
import { useCapacitor } from './hooks/useCapacitor';
import { config } from './factory-config';

interface Card {
  id: string;
  listId: string;
  title: string;
  description?: string;
  isTimerRunning?: boolean;
  timeSpent?: number; // in seconds
}

interface List {
  id: string;
  name: string;
}

export default function App() {
  const { isNative, getStorage, setStorage, triggerHaptic } = useCapacitor();

  // Load accent color dynamically from App Factory configuration
  useEffect(() => {
    document.documentElement.style.setProperty('--accent-color', config.accentColor);
  }, []);

  // Application State
  const [lists] = useState<List[]>([
    { id: 'todo', name: 'To Do' },
    { id: 'progress', name: 'In Progress' },
    { id: 'done', name: 'Completed' }
  ]);

  const [cards, setCards] = useState<Card[]>([
    { id: 'card-1', listId: 'todo', title: 'Compile Rubrics and Documents', description: 'Due Friday afternoon', timeSpent: 0 },
    { id: 'card-2', listId: 'todo', title: 'Schedule App Factory testing', description: 'Test Xcode emulator build', timeSpent: 0 },
    { id: 'card-3', listId: 'progress', title: 'Review 5-Judge Infrastructure Map', description: 'Understand deployment metrics', timeSpent: 300 }
  ]);

  const [habits, setHabits] = useState<{ name: string; completed: boolean }[]>([
    { name: 'Drink 3L Water', completed: false },
    { name: 'Read 15 Pages', completed: true },
    { name: 'Study Core Topics (1 hr)', completed: false }
  ]);

  // UI state
  const [newCardTitle, setNewCardTitle] = useState('');
  const [selectedListId, setSelectedListId] = useState('todo');
  const [activeTimerCardId, setActiveTimerCardId] = useState<string | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(1500); // 25 Min default Pomodoro
  const [isTimerActive, setIsTimerActive] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);

  // Loading persisted state on start
  useEffect(() => {
    const loadSavedData = async () => {
      const storageKeyCards = `factory_app_${config.id}_cards`;
      const storageKeyHabits = `factory_app_${config.id}_habits`;
      const savedCards = await getStorage(storageKeyCards);
      const savedHabits = await getStorage(storageKeyHabits);
      if (savedCards) setCards(JSON.parse(savedCards));
      if (savedHabits) setHabits(JSON.parse(savedHabits));
    };
    loadSavedData();
  }, []);

  // Saving state on changes
  const saveCards = async (newCards: Card[]) => {
    setCards(newCards);
    await setStorage(`factory_app_${config.id}_cards`, JSON.stringify(newCards));
  };

  const saveHabits = async (newHabits: typeof habits) => {
    setHabits(newHabits);
    await setStorage(`factory_app_${config.id}_habits`, JSON.stringify(newHabits));
  };

  // Timer thread effect
  useEffect(() => {
    let interval: any = null;
    if (isTimerActive && timerSeconds > 0) {
      interval = setInterval(() => {
        setTimerSeconds((prev) => prev - 1);
        if (activeTimerCardId) {
          saveCards(cards.map(c => c.id === activeTimerCardId ? { ...c, timeSpent: (c.timeSpent || 0) + 1 } : c));
        }
      }, 1000);
    } else if (timerSeconds === 0 && isTimerActive) {
      setIsTimerActive(false);
      triggerHaptic(); // native haptic alarm on pomodoro finish!
      alert('Focus session completed! Take a break.');
    }
    return () => clearInterval(interval);
  }, [isTimerActive, timerSeconds, activeTimerCardId]);

  // Handlers
  const handleAddCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCardTitle.trim()) return;
    
    await triggerHaptic();
    const newCard: Card = {
      id: 'card-' + Date.now(),
      listId: selectedListId,
      title: newCardTitle,
      description: 'Created locally in guest mode',
      timeSpent: 0
    };

    const updated = [...cards, newCard];
    await saveCards(updated);
    setNewCardTitle('');
  };

  const handleToggleHabit = async (index: number) => {
    await triggerHaptic();
    const updated = habits.map((h, i) => i === index ? { ...h, completed: !h.completed } : h);
    await saveHabits(updated);
  };

  const handleStartTimer = async (cardId: string) => {
    await triggerHaptic();
    if (activeTimerCardId === cardId && isTimerActive) {
      // Pause
      setIsTimerActive(false);
    } else {
      // Start/Resume
      setActiveTimerCardId(cardId);
      setIsTimerActive(true);
    }
  };

  const handleMoveCard = async (cardId: string, nextListId: string) => {
    await triggerHaptic();
    const updated = cards.map(c => c.id === cardId ? { ...c, listId: nextListId } : c);
    await saveCards(updated);
  };

  const handleExportCSV = () => {
    const headers = 'Card ID,List,Title,Description,Time Spent (Seconds)\n';
    const rows = cards.map(c => `"${c.id}","${c.listId}","${c.title}","${c.description || ''}",${c.timeSpent || 0}`).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.id}_tasks_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen flex flex-col justify-between ios-safe-top ios-safe-bottom bg-[#0B0C10] px-4 py-6 select-none">
      
      {/* HEADER SECTION */}
      <header className="flex justify-between items-center border-b-4 border-black pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-black uppercase text-white tracking-wider flex items-center gap-2">
            <span>{config.name}</span>
            <span className="text-xs bg-[var(--accent-color,#DF5504)] px-2 py-0.5 border border-black shadow-[2px_2px_0px_rgba(0,0,0,1)] text-white uppercase font-bold">iOS Native</span>
          </h1>
          <p className="text-xs text-[#8892b0] font-mono mt-1">Platform: {isNative ? 'Apple App Wrapper' : 'Windows / PC Web browser'}</p>
        </div>
        <button 
          onClick={() => { triggerHaptic(); setShowSyncModal(true); }}
          className="px-4 py-2 border-2 border-black bg-[var(--accent-color,#DF5504)] hover:opacity-90 text-white text-xs font-bold uppercase tracking-wider shadow-[3px_3px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all"
        >
          Sync Cloud
        </button>
      </header>

      {/* SYSTEM SPLIT CONTENT */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-grow items-start">
        
        {/* COL 1 & 2: THE BRUTAL KANBAN BOARD */}
        <div className="md:col-span-2 grid grid-cols-1 gap-4">
          
          {/* Create Task Form */}
          <form onSubmit={handleAddCard} className="p-4 border-3 border-black bg-[#1F2833] shadow-[4px_4px_0px_rgba(0,0,0,1)] flex gap-2">
            <input 
              type="text" 
              placeholder="Create rapid card..."
              value={newCardTitle}
              onChange={(e) => setNewCardTitle(e.target.value)}
              className="flex-grow bg-[#0B0C10] border-2 border-black px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-[var(--accent-color,#DF5504)]"
            />
            <select 
              value={selectedListId} 
              onChange={(e) => setSelectedListId(e.target.value)}
              className="bg-[#0B0C10] border-2 border-black text-xs font-bold font-mono text-white px-2 py-2 focus:outline-none"
            >
              <option value="todo">To Do</option>
              <option value="progress">In Progress</option>
              <option value="done">Completed</option>
            </select>
            <button type="submit" className="px-4 py-2 border-2 border-black bg-white hover:bg-gray-100 text-black font-black uppercase text-xs shadow-[2px_2px_0px_rgba(0,0,0,1)]">
              +
            </button>
          </form>

          {/* Kanban Columns */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {lists.map(list => (
              <div key={list.id} className="p-3 border-3 border-black bg-[#0f131a] shadow-[4px_4px_0px_rgba(0,0,0,1)]">
                <h3 className="font-black text-sm uppercase text-white tracking-wide border-b-2 border-black pb-2 mb-3 flex justify-between items-center">
                  <span>{list.name}</span>
                  <span className="text-xs bg-black text-[#8892b0] px-2 py-0.5 rounded-full font-mono">
                    {cards.filter(c => c.listId === list.id).length}
                  </span>
                </h3>

                <div className="flex flex-col gap-3 min-h-[200px]">
                  {cards.filter(c => c.listId === list.id).map(card => (
                    <div key={card.id} className="p-3 border-2 border-black bg-[#1F2833] shadow-[3px_3px_0px_rgba(0,0,0,1)] flex flex-col justify-between">
                      <div>
                        <h4 className="font-bold text-sm text-white">{card.title}</h4>
                        <p className="text-xs text-[#8892b0] mt-1 font-mono">{card.description}</p>
                      </div>

                      {/* Timer details inside the card */}
                      <div className="border-t border-black mt-3 pt-2 flex justify-between items-center font-mono">
                        <span className="text-[10px] text-[var(--accent-color,#DF5504)]">⏱ {Math.floor((card.timeSpent || 0) / 60)}m spent</span>
                        <div className="flex gap-1.5">
                          {list.id !== 'todo' && (
                            <button 
                              onClick={() => handleMoveCard(card.id, list.id === 'done' ? 'progress' : 'todo')}
                              className="text-[10px] bg-black text-white px-1.5 py-0.5 border border-black font-bold"
                            >
                              ◀
                            </button>
                          )}
                          {config.features.pomodoro && (
                            <button 
                              onClick={() => handleStartTimer(card.id)}
                              className={`text-[10px] text-white px-2 py-0.5 border border-black font-bold uppercase ${activeTimerCardId === card.id && isTimerActive ? 'bg-[#ff3b30]' : 'bg-black'}`}
                            >
                              {activeTimerCardId === card.id && isTimerActive ? 'Pause' : 'Focus'}
                            </button>
                          )}
                          {list.id !== 'done' && (
                            <button 
                              onClick={() => handleMoveCard(card.id, list.id === 'todo' ? 'progress' : 'done')}
                              className="text-[10px] bg-black text-white px-1.5 py-0.5 border border-black font-bold"
                            >
                              ▶
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

        </div>

        {/* COL 3: HABITS & GLOBAL POMODORO TIMER PANEL */}
        <div className="flex flex-col gap-4">
          
          {/* Distraction-Free Pomodoro Widget */}
          {config.features.pomodoro && (
            <div className="p-4 border-3 border-black bg-[#121820] shadow-[4px_4px_0px_rgba(0,0,0,1)] text-center">
              <h3 className="font-black text-xs text-[var(--accent-color,#DF5504)] uppercase tracking-wider mb-2 font-mono">Pomodoro Active Timer</h3>
              <div className="text-4xl font-black text-white font-mono tracking-widest my-2">
                {formatTimer(timerSeconds)}
              </div>
              {activeTimerCardId && (
                <p className="text-[10px] text-[#8892b0] font-mono mb-3 truncate">
                  Focused Card: {cards.find(c => c.id === activeTimerCardId)?.title}
                </p>
              )}
              <div className="flex gap-2 justify-center mt-2">
                <button 
                  onClick={() => { triggerHaptic(); setIsTimerActive(!isTimerActive); }}
                  className="px-4 py-1 border border-black bg-[var(--accent-color,#DF5504)] text-white font-bold text-xs uppercase"
                >
                  {isTimerActive ? 'Pause' : 'Start'}
                </button>
                <button 
                  onClick={() => { triggerHaptic(); setIsTimerActive(false); setTimerSeconds(1500); }}
                  className="px-4 py-1 border border-black bg-black text-white font-bold text-xs uppercase"
                >
                  Reset
                </button>
              </div>
            </div>
          )}

          {/* Daily Habit Tracker streaks */}
          <div className="p-4 border-3 border-black bg-[#1F2833] shadow-[4px_4px_0px_rgba(0,0,0,1)]">
            <h3 className="font-black text-sm uppercase text-white tracking-wider border-b-2 border-black pb-2 mb-3">
              Daily Habits (Local)
            </h3>
            <div className="flex flex-col gap-2">
              {habits.map((habit, idx) => (
                <div 
                  key={idx} 
                  onClick={() => handleToggleHabit(idx)}
                  className="p-2 border border-black bg-[#0B0C10] flex justify-between items-center cursor-pointer transition-all active:translate-x-0.5"
                >
                  <span className={`text-xs font-mono ${habit.completed ? 'line-through text-gray-500' : 'text-white'}`}>
                    {habit.name}
                  </span>
                  <div className={`w-5 h-5 border-2 border-black flex items-center justify-center ${habit.completed ? 'bg-[var(--accent-color,#DF5504)]' : 'bg-black'}`}>
                    {habit.completed && <span className="text-white text-xs font-black">✓</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Windows / PC Export options */}
          <div className="p-4 border-3 border-black bg-[#0f131a] shadow-[4px_4px_0px_rgba(0,0,0,1)] font-mono text-xs">
            <h4 className="font-bold text-white uppercase mb-2">Export Data Backup</h4>
            <p className="text-[#8892b0] mb-3 text-[11px]">Save your offline guest sandbox work as a standardized, Excel-compatible CSV database.</p>
            <button 
              onClick={handleExportCSV}
              className="w-full py-2 border border-black bg-white text-black hover:bg-gray-100 font-bold uppercase text-[10px] shadow-[2px_2px_0px_rgba(0,0,0,1)]"
            >
              Export CSV for Excel
            </button>
          </div>

        </div>

      </div>

      {/* AUTHENTICATION SYNC OVERLAY MODAL */}
      {showSyncModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="p-6 border-4 border-black bg-[#1F2833] shadow-[8px_8px_0px_rgba(0,0,0,1)] max-width-md w-full max-w-md">
            <h3 className="text-lg font-black text-white uppercase border-b-2 border-black pb-3 mb-4">
              Sync Sandbox to Cloud
            </h3>
            <p className="text-xs text-[#8892b0] font-mono leading-relaxed mb-4">
              Apple iOS App Store guidelines require secure user sandboxes. Register an MDEx workspace account to seamlessly migrate your offline cards, lists, and habit records to your Cloud workspace.
            </p>

            <div className="flex flex-col gap-3">
              {/* Mandatory Sign In with Apple (Guideline 4.8) */}
              <button 
                onClick={async () => { await triggerHaptic(); alert('Signing in with Apple Credentials...'); setShowSyncModal(false); }}
                className="py-3 border-2 border-black bg-black text-white hover:bg-gray-900 font-bold uppercase text-xs shadow-[3px_3px_0px_rgba(0,0,0,1)] flex items-center justify-center gap-2"
              >
                <span></span>
                <span>Sign in with Apple</span>
              </button>

              <button 
                onClick={async () => { await triggerHaptic(); alert('Signing in with Google Account...'); setShowSyncModal(false); }}
                className="py-3 border-2 border-black bg-white text-black hover:bg-gray-100 font-bold uppercase text-xs shadow-[3px_3px_0px_rgba(0,0,0,1)] flex items-center justify-center gap-2"
              >
                <span>G</span>
                <span>Sign in with Google</span>
              </button>
            </div>

            <div className="border-t border-black mt-6 pt-4 flex justify-end">
              <button 
                onClick={() => { triggerHaptic(); setShowSyncModal(false); }}
                className="text-xs font-mono text-gray-400 underline"
              >
                Keep using Local Guest Mode
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER NOTCH GAP */}
      <footer className="text-center font-mono text-[9px] text-gray-600 border-t border-t-2 border-black mt-6 pt-4">
        {config.name} &bull; MDEx Workspace App Factory Engine &bull; Standard Multi-tenant Hybrid Sandbox
      </footer>

    </div>
  );
}
