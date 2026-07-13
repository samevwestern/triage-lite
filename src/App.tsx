import { useState, useEffect } from 'react';
import { useCapacitor } from './hooks/useCapacitor';
import { config } from './factory-config';
import { CapacitorCalendar } from '@ebarooni/capacitor-calendar';
import { LocalNotifications } from '@capacitor/local-notifications';

export interface ChecklistItem {
  id: string;
  text: string;
  isChecked: boolean;
}

export interface CardChecklist {
  id: string;
  items: ChecklistItem[];
}

export interface Label {
  id: string;
  text: string;
  color: string;
}

export interface Card {
  id: string;
  listId: string;
  title: string;
  description?: string;
  isTimerRunning?: boolean;
  timeSpent?: number;
  labelIds?: string[];
  checklists?: CardChecklist[];
  dueDate?: number | null;
  completedAt?: number | null;
}

interface List {
  id: string;
  name: string;
}

export default function App() {
  const { isNative, getStorage, setStorage, triggerHaptic } = useCapacitor();

  // Native Integration Wrappers
  const syncToAppleCalendar = async (card: Card) => {
    if (!card.dueDate) return;
    try {
      const permission = await CapacitorCalendar.requestWriteOnlyCalendarAccess();
      if (permission.result !== 'granted') return;

      const startDate = new Date(card.dueDate);
      const endDate = new Date(card.dueDate + 60 * 60 * 1000); // 1 hour duration

      await CapacitorCalendar.createEvent({
        title: `📌 [Triage Lite] ${card.title}`,
        location: card.description || 'Synced from Triage Lite mobile app.',
        startDate: startDate.getTime(),
        endDate: endDate.getTime(),
      });
      console.log("[EventKit] Event created in Apple Calendar.");
    } catch (e) {
      console.error("[EventKit] Failed to sync to Apple Calendar", e);
    }
  };

  const scheduleLocalAlarm = async (card: Card) => {
    if (!card.dueDate) return;
    try {
      const perm = await LocalNotifications.requestPermissions();
      if (perm.display !== 'granted') return;

      // Extract numerical ID from string, fallback to timestamp
      const numericId = parseInt(card.id.replace(/\D/g, '')) || Date.now();

      await LocalNotifications.schedule({
        notifications: [
          {
            id: numericId,
            title: "⏰ Triage Task Due Now!",
            body: `"${card.title}" has reached its scheduled due date!`,
            schedule: { at: new Date(card.dueDate) },
            sound: 'default',
            actionTypeId: 'OPEN_CARD',
            extra: { cardId: card.id }
          }
        ]
      });
      console.log("[LocalNotifications] Native alarm scheduled.");
    } catch (e) {
      console.error("[LocalNotifications] Failed to schedule alarm", e);
    }
  };

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
    { 
      id: 'card-1', 
      listId: 'todo', 
      title: 'Research Assignment', 
      description: 'Due Friday afternoon', 
      timeSpent: 0,
      labelIds: ['label-red', 'label-blue'],
      checklists: [
        {
          id: 'cl-1',
          items: [
            { id: 'item-1', text: 'Draft overview', isChecked: true },
            { id: 'item-2', text: 'Review metrics', isChecked: false }
          ]
        }
      ]
    },
    { 
      id: 'card-2', 
      listId: 'todo', 
      title: 'Watch Lecture Notes', 
      description: 'Review course video content', 
      timeSpent: 0,
      labelIds: ['label-green'] 
    },
    { 
      id: 'card-3', 
      listId: 'progress', 
      title: 'Compile Report', 
      description: 'Generate final submission markdown', 
      timeSpent: 300,
      labelIds: ['label-purple', 'label-orange'],
      checklists: [
        {
          id: 'cl-2',
          items: [
            { id: 'item-3', text: 'Validate schemas', isChecked: false }
          ]
        }
      ]
    }
  ]);

  const [habits, setHabits] = useState<{ name: string; completed: boolean }[]>([
    { name: 'Drink 3L Water', completed: false },
    { name: 'Read 15 Pages', completed: true },
    { name: 'Study Core Topics (1 hr)', completed: false }
  ]);

  const [labels, setLabels] = useState<Label[]>([
    { id: 'label-red', text: 'URGENT', color: '#ff3b30' },
    { id: 'label-orange', text: 'IMPORTANT', color: '#DF5504' },
    { id: 'label-green', text: 'THIS WEEK', color: '#34c759' },
    { id: 'label-blue', text: 'NEXT WEEK', color: '#007aff' },
    { id: 'label-purple', text: 'NEXT SEMESTER', color: '#af52de' }
  ]);

  // UI state
  const [activeTimerCardId, setActiveTimerCardId] = useState<string | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(1500); // 25 Min default Pomodoro
  const [isTimerActive, setIsTimerActive] = useState(false);
  
  // Card Editing Modal State
  const [selectedCardForEdit, setSelectedCardForEdit] = useState<Card | null>(null);
  const [isLabelManagerOpen, setIsLabelManagerOpen] = useState(false);
  
  // Phase 2: Standalone Paid App Architecture (Remove Guest Walls)
  const [isConnected, setIsConnected] = useState(false);

  // Monetization Guard State
  const [hasValidReceipt, setHasValidReceipt] = useState<boolean | null>(null);

  // Column Navigation State
  const [activeColumnIndex, setActiveColumnIndex] = useState(0);

  // Dedicated Menu View State
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeMenuModal, setActiveMenuModal] = useState<'backup' | 'sync' | 'diagnostics' | null>(null);

  // Dedicated Global Label Manager Modal State
  const [isGlobalLabelModalOpen, setIsGlobalLabelModalOpen] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelFormText, setLabelFormText] = useState('');
  const [labelFormColor, setLabelFormColor] = useState('#DF5504');

  // Dedicated Card Creation Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newCardData, setNewCardData] = useState<Card>({
    id: '',
    listId: 'todo',
    title: '',
    description: '',
    timeSpent: 0,
    labelIds: [],
    checklists: [],
    dueDate: null,
    completedAt: null
  });

  // Simulated Native StoreKit Receipt Verification
  useEffect(() => {
    const verifyPurchase = async () => {
      console.log("[StoreKit] Requesting cryptographically signed receipt from iOS...");
      // Simulate network/OS verification delay
      setTimeout(() => {
        // For local web development, we default to false to show the paywall,
        // allowing the dev to manually bypass it. In production native builds, 
        // this validates against window.Capacitor.Plugins.StoreKit
        setHasValidReceipt(false); 
      }, 1200);
    };
    verifyPurchase();
  }, []);

  // Unified Storage & Sync Router (Phase 3 & Cloud Backup Plan)
  const syncData = async (key: string, data: any) => {
    // 1. Save locally to guarantee offline access
    await setStorage(key, JSON.stringify(data));

    // 2. Route to appropriate cloud backend
    if (isConnected) {
      // ENTERPRISE PATH: Sync directly with MySQL endpoints
      console.log(`[Enterprise Sync] Payload routed to api.triage.mdex.com for key: ${key}`);
      // Simulated REST Call: PUT /api/alphav1/cards/:id
    } else {
      // STANDALONE PATH: Sync with Apple iCloud
      try {
        if ((window as any).Capacitor && (window as any).Capacitor.isNativePlatform()) {
          console.log(`[iCloud Sync] Native CloudKit Sync triggered for key: ${key}`);
          // await window.Capacitor.Plugins.iCloudKV.set({ key, value: JSON.stringify(data) });
        } else {
          console.log(`[iCloud Sync - Web Sim] Payload backed up to virtual iCloud for key: ${key}`);
        }
      } catch (err) {
        console.error("iCloud synchronization error: ", err);
      }
    }
  };



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
    await syncData(`factory_app_${config.id}_cards`, newCards);
  };

  const saveHabits = async (newHabits: typeof habits) => {
    setHabits(newHabits);
    await syncData(`factory_app_${config.id}_habits`, newHabits);
  };

  // Timer thread effect
  useEffect(() => {
    let interval: any = null;
    
    const checkTimer = () => {
      if (isTimerActive && activeTimerCardId) {
        const startTimeStr = localStorage.getItem(`timer_start_${activeTimerCardId}`);
        if (startTimeStr) {
          const startTime = parseInt(startTimeStr, 10);
          const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
          const remaining = Math.max(0, 1500 - elapsedSeconds); // 25 minutes = 1500s
          
          setTimerSeconds(remaining);
          
          if (remaining === 0) {
            setIsTimerActive(false);
            localStorage.removeItem(`timer_start_${activeTimerCardId}`);
            triggerHaptic(); // native haptic alarm on pomodoro finish!
            
            // Add the full 25 mins (1500s) to the card's total time
            saveCards(cards.map(c => c.id === activeTimerCardId ? { ...c, timeSpent: (c.timeSpent || 0) + 1500 } : c));
            alert('Focus session completed! Take a break.');
          }
        }
      }
    };

    if (isTimerActive) {
      // Check immediately, then every second
      checkTimer();
      interval = setInterval(checkTimer, 1000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isTimerActive, activeTimerCardId]); // Removed timerSeconds dependency so it doesn't re-trigger constantly

  // Handlers

  const handleToggleHabit = async (index: number) => {
    await triggerHaptic();
    const updated = habits.map((h, i) => i === index ? { ...h, completed: !h.completed } : h);
    await saveHabits(updated);
  };

  const handleStartTimer = async (cardId: string) => {
    await triggerHaptic();
    const now = Date.now();
    
    if (activeTimerCardId === cardId && isTimerActive) {
      // Stop: Calculate partial elapsed time and add to card's total
      setIsTimerActive(false);
      const startTimeStr = localStorage.getItem(`timer_start_${cardId}`);
      if (startTimeStr) {
         const elapsed = Math.floor((now - parseInt(startTimeStr, 10)) / 1000);
         saveCards(cards.map(c => c.id === cardId ? { ...c, timeSpent: (c.timeSpent || 0) + elapsed } : c));
         localStorage.removeItem(`timer_start_${cardId}`);
      }
    } else {
      // Start: Record immutable start epoch
      const startTimeKey = `timer_start_${cardId}`;
      localStorage.setItem(startTimeKey, now.toString());
      setActiveTimerCardId(cardId);
      setIsTimerActive(true);
    }
  };

  const handleMoveCard = async (cardId: string, nextListId: string) => {
    await triggerHaptic();
    const updated = cards.map(c => {
      if (c.id === cardId) {
        return { 
          ...c, 
          listId: nextListId,
          completedAt: nextListId === 'done' ? Date.now() : null
        };
      }
      return c;
    });
    await saveCards(updated);
  };

  const handleToggleChecklistItem = async (cardId: string, checklistId: string, itemId: string) => {
    await triggerHaptic();
    const updated = cards.map(c => {
      if (c.id !== cardId) return c;
      const updatedChecklists = c.checklists?.map(cl => {
        if (cl.id !== checklistId) return cl;
        return {
          ...cl,
          items: cl.items.map(item => item.id === itemId ? { ...item, isChecked: !item.isChecked } : item)
        };
      });
      return { ...c, checklists: updatedChecklists };
    });
    await saveCards(updated);
  };

  const handleExportCSV = () => {
    const headers = 'Card ID,List,Title,Description,Time Spent (Seconds),Due Date,Completion Date\n';
    const rows = cards.map(c => {
      const dueDateStr = c.dueDate ? new Date(c.dueDate).toISOString().split('T')[0] : '';
      const completedAtStr = c.completedAt ? new Date(c.completedAt).toISOString().split('T')[0] : '';
      return `"${c.id}","${c.listId}","${c.title}","${c.description || ''}",${c.timeSpent || 0},"${dueDateStr}","${completedAtStr}"`;
    }).join('\n');
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

  // MONETIZATION GUARDS: Block app rendering if not purchased
  if (hasValidReceipt === null) {
    return (
      <div className="min-h-screen bg-[var(--color-dark-bg,#282828)] flex flex-col items-center justify-center font-mono text-[var(--color-accent,#DF5504)] uppercase font-black text-sm tracking-widest gap-4">
        <div className="w-8 h-8 border-4 border-t-[var(--color-accent,#DF5504)] border-r-[var(--color-accent,#DF5504)] border-b-transparent border-l-transparent rounded-full animate-spin"></div>
        <span>Verifying App Store Receipt...</span>
      </div>
    );
  }

  if (hasValidReceipt === false) {
    return (
      <div className="min-h-screen bg-[var(--color-dark-bg,#282828)] flex items-center justify-center p-4 font-mono text-center">
        <div className="bento-box border-2 border-[var(--color-accent,#DF5504)] p-8 max-w-md">
          <h2 className="text-2xl font-black text-white uppercase mb-4 tracking-wider">Triage Lite Premium</h2>
          <p className="text-[#8892b0] text-xs mb-6 leading-relaxed">
            No valid App Store receipt found. Triage Lite is a premium standalone application with no free tier. Please purchase the app to securely sync your data.
          </p>
          <button className="w-full py-4 bento-btn text-white font-black uppercase text-sm">
            Purchase for $9.99
          </button>
          <button 
            onClick={() => {
              triggerHaptic();
              setHasValidReceipt(true);
            }} 
            className="mt-6 text-[10px] text-gray-500 hover:text-white uppercase font-bold transition-colors"
          >
            [Dev Bypass: Simulate Purchase]
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col justify-between ios-safe-top ios-safe-bottom bg-[var(--color-dark-bg,#282828)] px-4 py-6 select-none">
      
      {/* HEADER SECTION */}
      <header className="flex justify-between items-start border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-black uppercase text-white tracking-wider">
            {config.name}
          </h1>
          <p className="text-xs text-[#8892b0] font-mono mt-1">Platform: {isNative ? 'Apple App Wrapper' : 'Windows / PC Web browser'}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <button 
            onClick={async () => {
              await triggerHaptic();
              setIsMenuOpen(!isMenuOpen);
            }}
            className="text-[10px] leading-none px-2.5 py-1.5 bento-btn text-white uppercase font-black rounded-sm tracking-wide flex items-center gap-1"
          >
            {isMenuOpen ? '✕ Close Menu' : '☰ Menu'}
          </button>
        </div>
      </header>

      {/* MAIN VIEWPORT SWITCHER */}
      {isMenuOpen ? (
        <div className="flex-grow flex flex-col justify-start animate-fadeIn gap-6">
          {/* MENU PAGE */}
          <div className="bento-box p-6 flex flex-col gap-6 text-white max-w-2xl mx-auto w-full">
            <div className="border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-3 flex justify-between items-center">
              <h2 className="text-sm font-black uppercase tracking-wider text-[var(--color-accent,#DF5504)]">
                Triage Board Menu
              </h2>
              <button 
                onClick={async () => {
                  await triggerHaptic();
                  setIsMenuOpen(false);
                }}
                className="text-xs uppercase font-mono font-bold text-gray-400 hover:text-white"
              >
                ✕ Close
              </button>
            </div>

            {/* Menu Settings Index List */}
            <div className="flex flex-col gap-3 font-mono text-xs">
              
              {/* Row 1: Export Data */}
              <button 
                onClick={async () => {
                  await triggerHaptic();
                  setActiveMenuModal('backup');
                }}
                className="w-full p-4 bento-box bg-[var(--color-dark-bg,#282828)]/50 hover:bg-[var(--color-dark-tertiary,#3D3D3D)] flex justify-between items-center text-left transition-all active:translate-y-0.5 group"
              >
                <div className="flex flex-col gap-1 pr-4">
                  <span className="font-black text-xs text-white uppercase tracking-wider group-hover:text-[var(--color-accent,#DF5504)] transition-colors">
                    💾 Export Data Backup
                  </span>
                  <span className="text-[10px] text-gray-400 leading-relaxed">
                    Download offline work as standard Excel-compatible CSV database.
                  </span>
                </div>
                <span className="text-gray-400 group-hover:text-white font-black text-sm pl-2 transition-colors">❯</span>
              </button>

              {/* Row 2: iCloud Sync */}
              <button 
                onClick={async () => {
                  await triggerHaptic();
                  setActiveMenuModal('sync');
                }}
                className="w-full p-4 bento-box bg-[var(--color-dark-bg,#282828)]/50 hover:bg-[var(--color-dark-tertiary,#3D3D3D)] flex justify-between items-center text-left transition-all active:translate-y-0.5 group"
              >
                <div className="flex flex-col gap-1 pr-4">
                  <span className="font-black text-xs text-white uppercase tracking-wider group-hover:text-[var(--color-accent,#DF5504)] transition-colors">
                    🍏 Apple iCloud Synchronization
                  </span>
                  <span className="text-[10px] text-gray-400 leading-relaxed">
                    Check connection, link Enterprise SQL database, or sync devices.
                  </span>
                </div>
                <span className="text-gray-400 group-hover:text-white font-black text-sm pl-2 transition-colors">❯</span>
              </button>

              {/* Row 3: Label Studio */}
              <button 
                onClick={async () => {
                  await triggerHaptic();
                  setEditingLabelId(null);
                  setLabelFormText('');
                  setLabelFormColor('#DF5504');
                  setIsGlobalLabelModalOpen(true);
                }}
                className="w-full p-4 bento-box bg-[var(--color-dark-bg,#282828)]/50 hover:bg-[var(--color-dark-tertiary,#3D3D3D)] flex justify-between items-center text-left transition-all active:translate-y-0.5 group"
              >
                <div className="flex flex-col gap-1 pr-4">
                  <span className="font-black text-xs text-white uppercase tracking-wider group-hover:text-[var(--color-accent,#DF5504)] transition-colors">
                    🏷 Board Label Studio
                  </span>
                  <span className="text-[10px] text-gray-400 leading-relaxed">
                    Create classification tags, change label text name, or preset colors.
                  </span>
                </div>
                <span className="text-gray-400 group-hover:text-white font-black text-sm pl-2 transition-colors">❯</span>
              </button>

              {/* Row 4: Diagnostics */}
              <button 
                onClick={async () => {
                  await triggerHaptic();
                  setActiveMenuModal('diagnostics');
                }}
                className="w-full p-4 bento-box bg-[var(--color-dark-bg,#282828)]/50 hover:bg-[var(--color-dark-tertiary,#3D3D3D)] flex justify-between items-center text-left transition-all active:translate-y-0.5 group"
              >
                <div className="flex flex-col gap-1 pr-4">
                  <span className="font-black text-xs text-white uppercase tracking-wider group-hover:text-[var(--color-accent,#DF5504)] transition-colors">
                    ⚡ Native Feature Diagnostics
                  </span>
                  <span className="text-[10px] text-gray-400 leading-relaxed">
                    Inspect active runtime platform, local storage, calendar state, and audio API.
                  </span>
                </div>
                <span className="text-gray-400 group-hover:text-white font-black text-sm pl-2 transition-colors">❯</span>
              </button>

            </div>

            {/* Close back action */}
            <div className="mt-4 border-t border-[var(--color-dark-tertiary,#3D3D3D)] pt-4 flex justify-end">
              <button 
                onClick={async () => {
                  await triggerHaptic();
                  setIsMenuOpen(false);
                }}
                className="px-6 py-2 bento-btn text-white font-black text-xs uppercase"
              >
                Back To Dashboard
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-grow items-start">
        
        {/* COL 1 & 2: THE BRUTAL KANBAN BOARD */}
        <div className="md:col-span-2 grid grid-cols-1 gap-4">
          
          {/* Create Task Button */}
          <div className="hidden sm:flex justify-start">
            <button 
              onClick={async () => {
                await triggerHaptic();
                setNewCardData({
                  id: 'card-' + Date.now(),
                  listId: 'todo',
                  title: '',
                  description: '',
                  timeSpent: 0,
                  labelIds: [],
                  checklists: [],
                  dueDate: null,
                  completedAt: null
                });
                setIsCreateModalOpen(true);
              }}
              className="px-5 py-2.5 bento-btn text-white font-black uppercase text-xs tracking-wider flex items-center gap-2"
            >
              <span>+ Create Card</span>
            </button>
          </div>

          {/* COLUMN NAVIGATION HEADER (Mobile Only) */}
          <div className="flex sm:hidden justify-between items-center p-3 bento-box mb-4 font-mono text-xs gap-2">
            <button 
              onClick={async () => {
                await triggerHaptic();
                setNewCardData({
                  id: 'card-' + Date.now(),
                  listId: lists[activeColumnIndex]?.id || 'todo',
                  title: '',
                  description: '',
                  timeSpent: 0,
                  labelIds: [],
                  checklists: [],
                  dueDate: null,
                  completedAt: null
                });
                setIsCreateModalOpen(true);
              }}
              className="px-2.5 py-1.5 bento-btn text-white text-[9px] font-black uppercase tracking-wider flex items-center gap-1"
            >
              + Create Card
            </button>
            <span className="flex flex-col items-center text-center">
              <span className="font-black text-sm uppercase text-white tracking-wider">
                {lists[activeColumnIndex]?.name}
              </span>
              <span className="text-[9px] text-gray-400 font-mono uppercase tracking-wide mt-0.5">
                # of cards: {cards.filter(c => c.listId === lists[activeColumnIndex]?.id).length}
              </span>
            </span>
            <div className="w-[85px]" />
          </div>

          {/* HORIZONTAL SWIPE BOARD CONTAINER */}
          <div 
            id="board-columns-container"
            onScroll={(e) => {
              const container = e.currentTarget;
              const scrollLeft = container.scrollLeft;
              const colWidth = container.clientWidth * 0.9;
              const index = Math.round(scrollLeft / colWidth);
              if (index !== activeColumnIndex && index >= 0 && index < lists.length) {
                setActiveColumnIndex(index);
              }
            }}
            className="flex flex-row overflow-x-auto gap-4 pb-6 scroll-smooth snap-x snap-mandatory sm:grid sm:grid-cols-3 sm:overflow-x-visible"
          >
            {lists.map((list) => (
              <div 
                key={list.id} 
                className="flex-shrink-0 w-[88vw] sm:w-auto snap-center snap-always p-3 bento-box transition-colors"
                onDragOver={(e) => {
                  e.preventDefault(); // Necessary to allow dropping
                  e.currentTarget.style.backgroundColor = 'var(--color-dark-tertiary)'; // Highlight drop zone
                }}
                onDragLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-dark-secondary)'; // Revert background
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.style.backgroundColor = 'var(--color-dark-secondary)'; // Revert background
                  const cardId = e.dataTransfer.getData('text/plain');
                  if (cardId) {
                    handleMoveCard(cardId, list.id);
                  }
                }}
              >
                <div className="border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-2 mb-3 flex flex-col items-start gap-0.5 font-mono">
                  <h3 className="font-black text-sm uppercase text-white tracking-wide flex items-center gap-1">
                    <span>{list.name}</span>
                  </h3>
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">
                    # of cards: {cards.filter(c => c.listId === list.id).length}
                  </span>
                </div>

                <div className="flex flex-col gap-3 min-h-[200px]">
                  {cards.filter(c => c.listId === list.id).map(card => (
                    <div 
                      key={card.id} 
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', card.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onClick={() => setSelectedCardForEdit(card)}
                      className="p-3 bento-box bento-box-interactive flex flex-col justify-between cursor-move hover:border-[var(--color-accent,#DF5504)] transition-colors active:opacity-50"
                    >
                      <div>
                        {/* Labels Render */}
                        {card.labelIds && card.labelIds.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {card.labelIds.map(labelId => {
                              const labelObj = labels.find(l => l.id === labelId);
                              if (!labelObj) return null;
                              return (
                                <span 
                                  key={labelId}
                                  className="text-[9px] font-bold text-white uppercase px-1.5 py-0.5 rounded border border-white/10 shadow-[1px_1px_0px_0px_var(--color-shadow,#BCBCBC)]"
                                  style={{ backgroundColor: labelObj.color }}
                                >
                                  {labelObj.text}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        <h4 className="font-bold text-sm text-white">{card.title}</h4>
                        <p className="text-xs text-[#8892b0] mt-1 font-mono">{card.description}</p>
                        
                        {/* Checklists Render */}
                        {card.checklists && card.checklists.length > 0 && (
                          <div className="mt-3 flex flex-col gap-2">
                            {card.checklists.map(checklist => (
                              <div key={checklist.id} className="bg-[var(--color-dark-bg,#282828)] p-2 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded">
                                {checklist.items.map(item => (
                                  <label key={item.id} className="flex items-center gap-2 cursor-pointer mb-1 last:mb-0 group">
                                    <input 
                                      type="checkbox"
                                      checked={item.isChecked}
                                      onChange={() => handleToggleChecklistItem(card.id, checklist.id, item.id)}
                                      className="appearance-none w-3.5 h-3.5 border border-[var(--color-dark-tertiary,#3D3D3D)] bg-white checked:bg-[var(--color-accent,#DF5504)] rounded transition-colors relative checked:after:content-['✓'] checked:after:text-white checked:after:text-[10px] checked:after:font-black checked:after:absolute checked:after:top-[-2px] checked:after:left-[1px]"
                                    />
                                    <span className={`text-[11px] font-mono select-none transition-colors ${item.isChecked ? 'line-through text-gray-500' : 'text-gray-300 group-hover:text-white'}`}>
                                      {item.text}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Timer details inside the card */}
                      <div className="border-t border-[var(--color-dark-tertiary,#3D3D3D)] mt-3 pt-2 flex justify-between items-center font-mono">
                        <span className="text-[10px] text-[var(--color-accent,#DF5504)]">⏱ {Math.floor((card.timeSpent || 0) / 60)}m spent</span>
                        <div className="flex gap-2 items-center">
                          {config.features.pomodoro && (
                            <button 
                              onClick={() => handleStartTimer(card.id)}
                              className={`text-[10px] bento-btn px-2 py-1 text-white font-bold uppercase transition-all ${activeTimerCardId === card.id && isTimerActive ? 'bg-[#ff3b30]' : 'bg-[var(--color-accent,#DF5504)]'}`}
                            >
                              {activeTimerCardId === card.id && isTimerActive ? 'Pause Timer' : 'Start Timer'}
                            </button>
                          )}
                          
                          {/* Card Move Dropdown Box */}
                          <div className="relative">
                            <select
                              value={list.id}
                              onChange={async (e) => {
                                await triggerHaptic();
                                handleMoveCard(card.id, e.target.value);
                              }}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            >
                              {lists.map(l => (
                                <option key={l.id} value={l.id}>
                                  {l.name}
                                </option>
                              ))}
                            </select>
                            <button className="text-[10px] bento-btn bg-[var(--color-accent,#DF5504)] text-white px-2 py-1 font-bold uppercase flex items-center gap-1">
                              Move ▼
                            </button>
                          </div>
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
            <div className="p-4 bento-box text-center">
              <h3 className="font-black text-xs text-[var(--color-accent,#DF5504)] uppercase tracking-wider mb-2 font-mono">Pomodoro Active Timer</h3>
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
                  className="px-4 py-1 bento-btn text-white font-bold text-xs uppercase"
                >
                  {isTimerActive ? 'Pause' : 'Start'}
                </button>
                <button 
                  onClick={() => { triggerHaptic(); setIsTimerActive(false); setTimerSeconds(1500); }}
                  className="px-4 py-1 border border-[var(--color-dark-tertiary,#3D3D3D)] bg-[var(--color-dark-bg,#282828)] rounded hover:bg-[var(--color-dark-tertiary)] text-white font-bold text-xs uppercase"
                >
                  Reset
                </button>
              </div>
            </div>
          )}

          {/* Daily Habit Tracker streaks */}
          <div className="p-4 bento-box">
            <h3 className="font-black text-sm uppercase text-white tracking-wider border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-2 mb-3">
              Daily Habits (Local)
            </h3>
            <div className="flex flex-col gap-2">
              {habits.map((habit, idx) => (
                <div 
                  key={idx} 
                  onClick={() => handleToggleHabit(idx)}
                  className="p-2 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded bg-[var(--color-dark-bg,#282828)] flex justify-between items-center cursor-pointer transition-all active:translate-x-0.5"
                >
                  <span className={`text-xs font-mono ${habit.completed ? 'line-through text-gray-500' : 'text-white'}`}>
                    {habit.name}
                  </span>
                  <div className={`w-5 h-5 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded flex items-center justify-center ${habit.completed ? 'bg-[var(--color-accent,#DF5504)]' : 'bg-[var(--color-dark-bg,#282828)]'}`}>
                    {habit.completed && <span className="text-white text-xs font-black">✓</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>



        </div>

      </div>

      )}

      {/* FOOTER NOTCH GAP */}
      <footer className="text-center font-mono text-[9px] text-gray-600 border-t border-[var(--color-dark-tertiary,#3D3D3D)] mt-6 pt-4">
        {config.name} &bull; MDEx Workspace App Factory Engine &bull; Standard Multi-tenant Hybrid Sandbox
      </footer>

      {/* MENU ITEM SUB-MODALS */}
      {activeMenuModal === 'backup' && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="w-full max-w-md bento-box p-6 text-white flex flex-col gap-4 font-mono text-xs">
            <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-3">
              <h3 className="font-black text-sm uppercase tracking-wider text-[var(--color-accent,#DF5504)]">
                💾 Export Data Backup
              </h3>
              <button 
                onClick={async () => {
                  await triggerHaptic();
                  setActiveMenuModal(null);
                }}
                className="text-gray-400 hover:text-white font-black text-lg"
              >
                &times;
              </button>
            </div>

            <p className="text-gray-300 leading-relaxed text-[11px]">
              Save your offline guest sandbox work as a standardized, Excel-compatible CSV database. This allows you to back up and view all card parameters locally at any time.
            </p>

            <div className="flex flex-col gap-2 mt-2">
              <button 
                onClick={async () => {
                  await triggerHaptic();
                  handleExportCSV();
                }}
                className="w-full py-2.5 bento-btn bg-white text-black hover:bg-gray-100 font-bold uppercase text-[10px] rounded transition-colors"
              >
                Export CSV for Excel
              </button>
              
              <button 
                onClick={async () => {
                  await triggerHaptic();
                  if (window.confirm('Reset all card data to default? This cannot be undone.')) {
                    await syncData('cards', []);
                    window.location.reload();
                  }
                }}
                className="w-full py-2.5 border border-red-500/30 bg-[var(--color-dark-bg,#282828)] text-red-400 hover:bg-red-900/10 font-bold text-[10px] uppercase rounded transition-all"
              >
                Reset App Database
              </button>
            </div>
          </div>
        </div>
      )}

      {activeMenuModal === 'sync' && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="w-full max-w-md bento-box p-6 text-white flex flex-col gap-4 font-mono text-xs">
            <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-3">
              <h3 className="font-black text-sm uppercase tracking-wider text-[var(--color-accent,#DF5504)]">
                ☁️ Synchronization Console
              </h3>
              <button 
                onClick={async () => {
                  await triggerHaptic();
                  setActiveMenuModal(null);
                }}
                className="text-gray-400 hover:text-white font-black text-lg"
              >
                &times;
              </button>
            </div>

            <div>
              <h4 className="font-bold text-white uppercase text-xs mb-2 flex items-center gap-1.5 border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-2">
                {isConnected ? '☁️ Triage Enterprise SQL Sync' : '🍏 Apple iCloud Backup & Sync'}
              </h4>
              {isConnected ? (
                <div className="space-y-3 mt-3">
                  <p className="text-gray-400 text-[10px] leading-relaxed">
                    Connected to <strong className="text-white">Triage MySQL Database</strong>. You are viewing a simplified, action-focused board reference.
                  </p>
                  <div className="p-2 bg-green-950/30 border border-green-500/30 text-green-400 text-[9px] font-bold shadow-[2px_2px_0px_0px_var(--color-shadow,#BCBCBC)]">
                    ✓ REAL-TIME ENTERPRISE SYNC ACTIVE
                  </div>
                </div>
              ) : (
                <div className="space-y-3 mt-3">
                  <p className="text-gray-400 text-[10px] leading-relaxed">
                    Your standalone boards, checklists, and focus habits are automatically backed up and synchronized across your Apple devices using <strong className="text-white">iCloud</strong>.
                  </p>
                  <div className="p-2 bg-blue-950/30 border border-blue-500/30 text-blue-400 text-[9px] font-bold shadow-[2px_2px_0px_0px_var(--color-shadow,#BCBCBC)]">
                    ✓ APPLE CLOUD SYNC ACTIVE
                  </div>
                </div>
              )}
            </div>

            <button 
              onClick={async () => { 
                await triggerHaptic(); 
                if (isConnected) {
                  setIsConnected(false);
                } else {
                  const connect = window.confirm('Link Triage Enterprise Account? (Mock action)');
                  if (connect) setIsConnected(true);
                }
              }}
              className={`w-full py-2.5 mt-2 rounded border border-[var(--color-dark-tertiary,#3D3D3D)] ${isConnected ? 'bg-[var(--color-dark-bg,#282828)] text-green-400 border-green-500/30' : 'bento-btn text-white'} text-[10px] font-bold uppercase tracking-wider transition-all`}
            >
              {isConnected ? '✓ Linked Triage Account' : 'Link Triage Account'}
            </button>
          </div>
        </div>
      )}

      {activeMenuModal === 'diagnostics' && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="w-full max-w-md bento-box p-6 text-white flex flex-col gap-4 font-mono text-xs">
            <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-3">
              <h3 className="font-black text-sm uppercase tracking-wider text-[var(--color-accent,#DF5504)]">
                ⚡ Native Feature Diagnostics
              </h3>
              <button 
                onClick={async () => {
                  await triggerHaptic();
                  setActiveMenuModal(null);
                }}
                className="text-gray-400 hover:text-white font-black text-lg"
              >
                &times;
              </button>
            </div>

            <p className="text-gray-300 leading-relaxed text-[11px]">
              Review system-level parameters checking direct wrapping container environments, database pipelines, hardware haptic engines, and background schedulers.
            </p>

            <div className="grid grid-cols-2 gap-2 text-[9px] text-[#8892b0]">
              <div className="p-3 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded bg-[var(--color-dark-bg,#282828)] flex flex-col gap-1">
                <span className="font-bold text-white uppercase text-[8px] tracking-wider text-[var(--color-accent,#DF5504)]">Platform</span>
                <span>💻 Web Environment</span>
              </div>
              <div className="p-3 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded bg-[var(--color-dark-bg,#282828)] flex flex-col gap-1">
                <span className="font-bold text-white uppercase text-[8px] tracking-wider text-[var(--color-accent,#DF5504)]">Local Sync</span>
                <span>Active (LocalStorage)</span>
              </div>
              <div className="p-3 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded bg-[var(--color-dark-bg,#282828)] flex flex-col gap-1">
                <span className="font-bold text-white uppercase text-[8px] tracking-wider text-[var(--color-accent,#DF5504)]">Apple Calendar</span>
                <span>Offline Mode</span>
              </div>
              <div className="p-3 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded bg-[var(--color-dark-bg,#282828)] flex flex-col gap-1">
                <span className="font-bold text-white uppercase text-[8px] tracking-wider text-[var(--color-accent,#DF5504)]">Haptic Engine</span>
                <span>Web Audio API</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GLOBAL BRUTALIST LABEL STUDIO MODAL */}
      {isGlobalLabelModalOpen && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="w-full max-w-md bento-box p-6 text-white flex flex-col gap-5">
            {/* Header */}
            <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-3">
              <h3 className="font-black text-sm uppercase tracking-wider text-[var(--color-accent,#DF5504)]">
                🏷 Board Label Studio
              </h3>
              <button 
                onClick={async () => {
                  await triggerHaptic();
                  setIsGlobalLabelModalOpen(false);
                }}
                className="text-gray-400 hover:text-white font-black text-lg"
              >
                &times;
              </button>
            </div>

            {/* Label Form */}
            <div className="border border-[var(--color-dark-tertiary,#3D3D3D)] bg-[var(--color-dark-bg,#282828)] rounded p-4 font-mono text-xs">
              <h4 className="font-bold text-white uppercase text-[10px] mb-3 pb-1 border-b border-[var(--color-dark-tertiary,#3D3D3D)] flex justify-between items-center">
                <span>{editingLabelId ? 'Edit Label Details' : 'Create New Label'}</span>
                {editingLabelId && (
                  <button 
                    onClick={() => {
                      setEditingLabelId(null);
                      setLabelFormText('');
                      setLabelFormColor('#DF5504');
                    }}
                    className="text-[9px] text-[var(--color-accent,#DF5504)] hover:underline"
                  >
                    Reset Form
                  </button>
                )}
              </h4>

              <div className="flex flex-col gap-3">
                {/* Input Text */}
                <div>
                  <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Label Name</label>
                  <input 
                    type="text"
                    value={labelFormText}
                    onChange={(e) => setLabelFormText(e.target.value.toUpperCase())}
                    placeholder="e.g. MARKETING, PRIORITY..."
                    className="w-full bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] px-3 py-1.5 text-white text-[11px] rounded"
                  />
                </div>

                {/* Grid color preset selections */}
                <div>
                  <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1.5">Label Color</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      '#DF5504', // Brand Orange
                      '#ff3b30', // Cherry Red
                      '#34c759', // Mint Green
                      '#007aff', // Cobalt Blue
                      '#af52de', // Orchid Purple
                      '#ffcc00', // Lemon Yellow
                      '#1c1c1e', // Charcoal Black
                      '#8e8e93'  // Silver Gray
                    ].map((col) => (
                      <button
                        key={col}
                        type="button"
                        onClick={async () => {
                          await triggerHaptic();
                          setLabelFormColor(col);
                        }}
                        className={`w-6 h-6 rounded-full border transition-all ${labelFormColor === col ? 'border-white scale-110 shadow-[0_0_8px_rgba(255,255,255,0.4)]' : 'border-transparent hover:scale-105'}`}
                        style={{ backgroundColor: col }}
                        title={col}
                      />
                    ))}
                  </div>
                </div>

                {/* Form Action Buttons */}
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await triggerHaptic();
                      const trimmedText = labelFormText.trim().toUpperCase();
                      if (!trimmedText) {
                        alert('Label name cannot be empty!');
                        return;
                      }

                      if (editingLabelId) {
                        // Edit existing label
                        const updatedLabels = labels.map(l => 
                          l.id === editingLabelId ? { ...l, text: trimmedText, color: labelFormColor } : l
                        );
                        setLabels(updatedLabels);
                        setEditingLabelId(null);
                        setLabelFormText('');
                      } else {
                        // Create brand new label
                        const newLabel = {
                          id: 'label-' + Date.now(),
                          text: trimmedText,
                          color: labelFormColor
                        };
                        setLabels([...labels, newLabel]);
                        setLabelFormText('');
                      }
                    }}
                    className="w-full py-2 bento-btn bg-[var(--color-accent,#DF5504)] text-white hover:bg-[var(--color-accent-hover,#B63F00)] text-[10px] font-bold uppercase transition-all"
                  >
                    {editingLabelId ? '✓ Save Changes' : '+ Add Label'}
                  </button>
                </div>
              </div>
            </div>

            {/* Current Labels List */}
            <div className="font-mono text-xs flex-grow flex flex-col min-h-0">
              <h4 className="font-bold text-white uppercase text-[10px] mb-2 pb-1 border-b border-[var(--color-dark-tertiary,#3D3D3D)]">
                Current Board Labels ({labels.length})
              </h4>
              <div className="max-h-48 overflow-y-auto flex flex-col gap-1.5 pr-1">
                {labels.map(lbl => (
                  <div key={lbl.id} className="flex justify-between items-center p-2 border border-[var(--color-dark-tertiary,#3D3D3D)] bg-[var(--color-dark-bg,#282828)] rounded">
                    <span 
                      className="text-[10px] text-white font-black px-2 py-0.5 rounded shadow-[1px_1px_0px_0px_rgba(0,0,0,0.3)]" 
                      style={{ backgroundColor: lbl.color }}
                    >
                      {lbl.text}
                    </span>
                    <div className="flex gap-2">
                      <button 
                        type="button"
                        onClick={async () => {
                          await triggerHaptic();
                          setEditingLabelId(lbl.id);
                          setLabelFormText(lbl.text);
                          setLabelFormColor(lbl.color);
                        }}
                        className="text-gray-400 hover:text-white font-bold text-xs p-1"
                        title="Edit Label"
                      >
                        ✏️
                      </button>
                      <button 
                        type="button"
                        onClick={async () => {
                          await triggerHaptic();
                          if (window.confirm(`Delete label "${lbl.text}"? This will clear it from all cards.`)) {
                            setLabels(labels.filter(l => l.id !== lbl.id));
                            setCards(cards.map(c => ({
                              ...c,
                              labelIds: c.labelIds?.filter(id => id !== lbl.id) || []
                            })));
                            if (editingLabelId === lbl.id) {
                              setEditingLabelId(null);
                              setLabelFormText('');
                              setLabelFormColor('#DF5504');
                            }
                          }
                        }}
                        className="text-red-500 hover:text-red-400 font-bold text-xs p-1"
                        title="Delete Label"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM BRUTALIST DETAIL MODAL */}
      {selectedCardForEdit && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="w-full max-w-md bento-box p-6 text-white">
            {/* Header */}
            <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-3 mb-4">
              <h3 className="font-black text-sm uppercase tracking-wider text-[var(--color-accent,#DF5504)]">
                Edit Card Details
              </h3>
              <button 
                onClick={() => {
                  setSelectedCardForEdit(null);
                  setIsLabelManagerOpen(false);
                }}
                className="text-gray-400 hover:text-white font-black text-lg"
              >
                &times;
              </button>
            </div>

            {/* Inputs */}
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-mono font-bold uppercase text-gray-400 mb-1">Title</label>
                <input 
                  type="text"
                  value={selectedCardForEdit.title}
                  onChange={(e) => setSelectedCardForEdit({ ...selectedCardForEdit, title: e.target.value })}
                  className="w-full bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 text-sm font-mono text-white focus:border-[var(--color-accent,#DF5504)] rounded"
                />
              </div>

              <div>
                <label className="block text-xs font-mono font-bold uppercase text-gray-400 mb-1">Description</label>
                <textarea 
                  value={selectedCardForEdit.description || ''}
                  onChange={(e) => setSelectedCardForEdit({ ...selectedCardForEdit, description: e.target.value })}
                  className="w-full h-20 bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 text-sm font-mono text-white focus:border-[var(--color-accent,#DF5504)] rounded"
                />
              </div>

              {/* Date Row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono font-bold uppercase text-gray-400 mb-1">Due Date</label>
                  <input 
                    type="date"
                    value={selectedCardForEdit.dueDate ? new Date(selectedCardForEdit.dueDate).toISOString().split('T')[0] : ''}
                    onChange={(e) => {
                      const parsed = e.target.value ? Date.parse(e.target.value) : null;
                      setSelectedCardForEdit({ ...selectedCardForEdit, dueDate: parsed });
                    }}
                    className="w-full bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 text-xs font-mono text-white rounded"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono font-bold uppercase text-gray-400 mb-1">Completion Date</label>
                  <input 
                    type="date"
                    value={selectedCardForEdit.completedAt ? new Date(selectedCardForEdit.completedAt).toISOString().split('T')[0] : ''}
                    onChange={(e) => {
                      const parsed = e.target.value ? Date.parse(e.target.value) : null;
                      setSelectedCardForEdit({ ...selectedCardForEdit, completedAt: parsed });
                    }}
                    className="w-full bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 text-xs font-mono text-white rounded"
                  />
                </div>
              </div>

              {/* Label Mapping Section */}
              <div>
                <label className="block text-xs font-mono font-bold uppercase text-gray-400 mb-2">Labels</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {labels.map(lbl => {
                    const hasLabel = selectedCardForEdit.labelIds?.includes(lbl.id);
                    return (
                      <button
                        key={lbl.id}
                        type="button"
                        onClick={() => {
                          const currentIds = selectedCardForEdit.labelIds || [];
                          const nextIds = currentIds.includes(lbl.id)
                            ? currentIds.filter(id => id !== lbl.id)
                            : [...currentIds, lbl.id];
                          setSelectedCardForEdit({ ...selectedCardForEdit, labelIds: nextIds });
                        }}
                        className={`text-[10px] font-bold px-2 py-1 border transition-all rounded ${hasLabel ? 'border-white scale-105 shadow-[2px_2px_0px_0px_var(--color-shadow,#BCBCBC)]' : 'border-[var(--color-dark-tertiary)]/50 opacity-60'}`}
                        style={{ backgroundColor: lbl.color, color: 'white' }}
                      >
                        {lbl.text} {hasLabel ? '✓' : ''}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setIsLabelManagerOpen(!isLabelManagerOpen)}
                  className="text-[10px] uppercase font-mono font-bold text-[var(--color-accent,#DF5504)] hover:underline"
                >
                  {isLabelManagerOpen ? 'Close Label Manager' : '⚙️ Manage Board Labels'}
                </button>
              </div>

              {/* Label Management Sub-Panel */}
              {isLabelManagerOpen && (
                <div className="border border-[var(--color-dark-tertiary,#3D3D3D)] bg-[var(--color-dark-bg,#282828)] rounded p-3 mt-1 font-mono text-xs">
                  <h4 className="font-bold text-white uppercase text-[10px] mb-2 border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-1">Create Label</h4>
                  {/* Quick Create form */}
                  <div className="flex gap-1 mb-2">
                    <input 
                      id="quick-label-text"
                      type="text"
                      placeholder="Name..."
                      className="bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] px-2 py-1 text-white text-[10px] flex-grow rounded"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const input = e.currentTarget;
                          if (input.value.trim()) {
                            const newLabel = {
                              id: 'label-' + Date.now(),
                              text: input.value.trim().toUpperCase(),
                              color: ['#ff3b30', '#DF5504', '#34c759', '#007aff', '#ffcc00'][Math.floor(Math.random() * 5)]
                            };
                            setLabels([...labels, newLabel]);
                            input.value = '';
                          }
                        }
                      }}
                    />
                    <span className="text-[9px] text-[#8892b0] self-center">Press Enter to add</span>
                  </div>
                  {/* List labels with delete button */}
                  <div className="max-h-24 overflow-y-auto flex flex-col gap-1">
                    {labels.map(lbl => (
                      <div key={lbl.id} className="flex justify-between items-center p-1 border border-[var(--color-dark-tertiary,#3D3D3D)] bg-[var(--color-dark-bg,#282828)] rounded">
                        <span className="text-[10px] text-white font-bold px-1.5 py-0.5" style={{ backgroundColor: lbl.color }}>{lbl.text}</span>
                        <button 
                          type="button"
                          onClick={() => {
                            // Delete label locally
                            setLabels(labels.filter(l => l.id !== lbl.id));
                            // Remove references
                            setCards(cards.map(c => ({
                              ...c,
                              labelIds: c.labelIds?.filter(id => id !== lbl.id) || []
                            })));
                            if (selectedCardForEdit.labelIds?.includes(lbl.id)) {
                              setSelectedCardForEdit({
                                ...selectedCardForEdit,
                                labelIds: selectedCardForEdit.labelIds.filter(id => id !== lbl.id)
                              });
                            }
                          }}
                          className="text-red-500 hover:text-red-400 font-bold px-1"
                        >
                          🗑
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end mt-6 pt-4 border-t border-[var(--color-dark-tertiary,#3D3D3D)]">
              <button 
                onClick={() => {
                  setSelectedCardForEdit(null);
                  setIsLabelManagerOpen(false);
                }}
                className="px-4 py-1.5 border border-[var(--color-dark-tertiary,#3D3D3D)] bg-[var(--color-dark-bg,#282828)] hover:bg-[var(--color-dark-tertiary)] text-white font-bold text-xs uppercase rounded"
              >
                Cancel
              </button>
              <button 
                onClick={async () => {
                  await triggerHaptic();
                  const updatedCards = cards.map(c => c.id === selectedCardForEdit.id ? selectedCardForEdit : c);
                  await saveCards(updatedCards);

                  // Phase 5: Trigger Native iOS Integrations
                  if (isNative && selectedCardForEdit.dueDate) {
                    await scheduleLocalAlarm(selectedCardForEdit);
                    await syncToAppleCalendar(selectedCardForEdit);
                  }

                  setSelectedCardForEdit(null);
                  setIsLabelManagerOpen(false);
                }}
                className="px-4 py-1.5 bento-btn text-white hover:opacity-90 font-bold text-xs uppercase rounded"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM BRUTALIST CREATION MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="w-full max-w-md bento-box p-6 text-white">
            {/* Header */}
            <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-3 mb-4">
              <h3 className="font-black text-sm uppercase tracking-wider text-[var(--color-accent,#DF5504)]">
                Create New Card
              </h3>
              <button 
                onClick={() => {
                  setIsCreateModalOpen(false);
                }}
                className="text-gray-400 hover:text-white font-black text-lg"
              >
                &times;
              </button>
            </div>

            {/* Inputs */}
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-mono font-bold uppercase text-gray-400 mb-1">Title</label>
                <input 
                  type="text"
                  placeholder="Task title..."
                  value={newCardData.title}
                  onChange={(e) => setNewCardData({ ...newCardData, title: e.target.value })}
                  className="w-full bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 text-sm font-mono text-white focus:border-[var(--color-accent,#DF5504)] rounded"
                />
              </div>

              <div>
                <label className="block text-xs font-mono font-bold uppercase text-gray-400 mb-1">Description</label>
                <textarea 
                  placeholder="Describe this task..."
                  value={newCardData.description || ''}
                  onChange={(e) => setNewCardData({ ...newCardData, description: e.target.value })}
                  className="w-full h-20 bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 text-sm font-mono text-white focus:border-[var(--color-accent,#DF5504)] rounded"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-mono font-bold uppercase text-gray-400 mb-1">Board Column</label>
                  <select 
                    value={newCardData.listId}
                    onChange={(e) => setNewCardData({ ...newCardData, listId: e.target.value })}
                    className="w-full bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 text-xs font-mono text-white rounded"
                  >
                    <option value="todo">To Do</option>
                    <option value="progress">In Progress</option>
                    <option value="done">Completed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono font-bold uppercase text-gray-400 mb-1">Due Date</label>
                  <input 
                    type="date"
                    value={newCardData.dueDate ? new Date(newCardData.dueDate).toISOString().split('T')[0] : ''}
                    onChange={(e) => {
                      const parsed = e.target.value ? Date.parse(e.target.value) : null;
                      setNewCardData({ ...newCardData, dueDate: parsed });
                    }}
                    className="w-full bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 text-xs font-mono text-white rounded"
                  />
                </div>
              </div>

              {/* Label Mapping Section */}
              <div>
                <label className="block text-xs font-mono font-bold uppercase text-gray-400 mb-2">Labels</label>
                <div className="flex flex-wrap gap-1.5">
                  {labels.map(lbl => {
                    const hasLabel = newCardData.labelIds?.includes(lbl.id);
                    return (
                      <button
                        key={lbl.id}
                        type="button"
                        onClick={() => {
                          const currentIds = newCardData.labelIds || [];
                          const nextIds = currentIds.includes(lbl.id)
                            ? currentIds.filter(id => id !== lbl.id)
                            : [...currentIds, lbl.id];
                          setNewCardData({ ...newCardData, labelIds: nextIds });
                        }}
                        className={`text-[10px] font-bold px-2 py-1 border transition-all rounded ${hasLabel ? 'border-white scale-105 shadow-[2px_2px_0px_0px_var(--color-shadow,#BCBCBC)]' : 'border-[var(--color-dark-tertiary)]/50 opacity-60'}`}
                        style={{ backgroundColor: lbl.color, color: 'white' }}
                      >
                        {lbl.text} {hasLabel ? '✓' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end mt-6 pt-4 border-t border-[var(--color-dark-tertiary,#3D3D3D)]">
              <button 
                onClick={() => {
                  setIsCreateModalOpen(false);
                }}
                className="px-4 py-1.5 border border-[var(--color-dark-tertiary,#3D3D3D)] bg-[var(--color-dark-bg,#282828)] hover:bg-[var(--color-dark-tertiary)] text-white font-bold text-xs uppercase rounded"
              >
                Cancel
              </button>
              <button 
                onClick={async () => {
                  if (!newCardData.title.trim()) {
                    alert('Title is required');
                    return;
                  }
                  await triggerHaptic();
                  const finalCard: Card = {
                    ...newCardData,
                    title: newCardData.title.trim()
                  };
                  await saveCards([...cards, finalCard]);

                  // Phase 5: Trigger Native iOS Integrations
                  if (isNative && finalCard.dueDate) {
                    await scheduleLocalAlarm(finalCard);
                    await syncToAppleCalendar(finalCard);
                  }

                  setIsCreateModalOpen(false);
                }}
                className="px-4 py-1.5 bento-btn text-white hover:opacity-90 font-bold text-xs uppercase rounded"
              >
                Create Card
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
