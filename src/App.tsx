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

export interface FileAttachment {
  id: string;
  name: string;
  type: 'supporting' | 'submission' | 'cloud_link';
  size?: number; // Size in bytes
  mimeType?: string;
  dataUrl?: string; // Standard base64 representation or absolute cloud/drive URL string!
  addedAt: number;
}

export interface ResourceCitation {
  id: string;
  title: string;
  url: string;
  notes?: string;
  addedAt: number;
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
  attachments?: FileAttachment[];
  resources?: ResourceCitation[];
  notifyInApp?: boolean;
  notifyLocalPanel?: boolean;
  notifyCalendarAlarm?: boolean;
  notifyEmailReminder?: boolean;
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

  const fetchUpcomingCalendarEvents = async (rangeDays: number) => {
    setIsCalendarLoading(true);
    try {
      const permission = await CapacitorCalendar.requestReadOnlyCalendarAccess();
      if (permission.result !== 'granted') {
        showToast("⚠️ Calendar permission denied!");
        setCalendarEvents([]);
        return;
      }

      const now = Date.now();
      const futureOffset = now + rangeDays * 24 * 60 * 60 * 1000;

      const response = await CapacitorCalendar.listEventsInRange({
        from: now,
        to: futureOffset
      });

      if (response && response.result) {
        // Sort events chronologically
        const sorted = [...response.result].sort((a, b) => {
          const aTime = a.startDate || 0;
          const bTime = b.startDate || 0;
          return aTime - bTime;
        });
        setCalendarEvents(sorted);
      } else {
        setCalendarEvents([]);
      }
    } catch (error) {
      console.error("[CapacitorCalendar] Error listing events", error);
      showToast("⚠️ Failed to load calendar events");
      setCalendarEvents([]);
    } finally {
      setIsCalendarLoading(false);
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
  
  // Card Editing Modal State
  const [selectedCardForEdit, setSelectedCardForEdit] = useState<Card | null>(null);
  const [isLabelManagerOpen, setIsLabelManagerOpen] = useState(false);
  const [lightboxFile, setLightboxFile] = useState<FileAttachment | null>(null);
  
  // Local temporary modal form inputs
  const [newCitationTitle, setNewCitationTitle] = useState('');
  const [newCitationUrl, setNewCitationUrl] = useState('');
  const [newCloudLinkName, setNewCloudLinkName] = useState('');
  const [newCloudLinkUrl, setNewCloudLinkUrl] = useState('');
  const [academicSearchQuery, setAcademicSearchQuery] = useState('');
  const [academicEngine, setAcademicEngine] = useState('scholar');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskText, setEditingTaskText] = useState('');
  const [inlineNewTaskText, setInlineNewTaskText] = useState('');
  
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isNotificationStudioOpen, setIsNotificationStudioOpen] = useState(false);
  const [isCalendarAgendaOpen, setIsCalendarAgendaOpen] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
  const [calendarRangeDays, setCalendarRangeDays] = useState<number>(30);
  const [calendarFilterType, setCalendarFilterType] = useState<'all' | 'triage'>('all');
  const [isCalendarLoading, setIsCalendarLoading] = useState<boolean>(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const formatTimestampToDatetimeLocal = (timestamp: number | null | undefined) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const tzOffset = date.getTimezoneOffset() * 60000;
    return (new Date(date.getTime() - tzOffset)).toISOString().slice(0, 16);
  };
  
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

  // Automatic Screen-Open Card Focus Timer Thread
  useEffect(() => {
    let interval: any = null;
    if (selectedCardForEdit) {
      interval = setInterval(() => {
        // Increment timeSpent on the selected card in real-time
        setSelectedCardForEdit(prev => {
          if (!prev) return null;
          return {
            ...prev,
            timeSpent: (prev.timeSpent || 0) + 1
          };
        });

        // Also update the card in the main cards state list dynamically
        setCards(prevCards => 
          prevCards.map(c => 
            c.id === selectedCardForEdit.id 
              ? { ...c, timeSpent: (c.timeSpent || 0) + 1 } 
              : c
          )
        );
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [selectedCardForEdit?.id]);

  // Handlers

  const handleToggleHabit = async (index: number) => {
    await triggerHaptic();
    const updated = habits.map((h, i) => i === index ? { ...h, completed: !h.completed } : h);
    await saveHabits(updated);
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
              className="w-9 h-9 rounded-full bento-btn text-white flex items-center justify-center text-lg font-black"
              title="Create Card"
            >
              ＋
            </button>

            <button
              onClick={async () => {
                await triggerHaptic();
                setIsCalendarAgendaOpen(true);
                await fetchUpcomingCalendarEvents(calendarRangeDays);
              }}
              className="w-9 h-9 rounded-full bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white flex items-center justify-center text-sm font-black transition-colors"
              title="Calendar Agenda"
            >
              📅
            </button>
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
                        
                        {/* Task Completion Bar & Next Task Display */}
                        {card.checklists && card.checklists.length > 0 && card.checklists[0].items.length > 0 && (() => {
                          const checklist = card.checklists[0];
                          const totalTasks = checklist.items.length;
                          const checkedTasks = checklist.items.filter(it => it.isChecked).length;
                          const percentComplete = Math.round((checkedTasks / totalTasks) * 100);
                          const nextTask = checklist.items.find(it => !it.isChecked);

                          return (
                            <div className="mt-3 flex flex-col gap-2 font-mono" onClick={(e) => e.stopPropagation()}>
                              {/* Percentage Label */}
                              <div className="flex justify-between items-center text-[10px] text-gray-400 font-bold">
                                <span className="uppercase text-[9px] tracking-wider text-[var(--color-accent,#DF5504)]">
                                  Task progress
                                </span>
                                <span>
                                  {percentComplete}% ({checkedTasks}/{totalTasks})
                                </span>
                              </div>

                              {/* Progress Track */}
                              <div className="w-full h-2 bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-[var(--color-accent,#DF5504)] transition-all duration-300 rounded-full"
                                  style={{ width: `${percentComplete}%` }}
                                />
                              </div>

                              {/* Next Incomplete Task Display */}
                              <div className="bg-[var(--color-dark-bg,#282828)] p-2 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded mt-1">
                                {nextTask ? (
                                  <label className="flex items-center gap-2 cursor-pointer group">
                                    <input 
                                      type="checkbox"
                                      checked={nextTask.isChecked}
                                      onChange={async () => {
                                        await triggerHaptic();
                                        handleToggleChecklistItem(card.id, checklist.id, nextTask.id);
                                      }}
                                      className="appearance-none w-3.5 h-3.5 border border-[var(--color-dark-tertiary,#3D3D3D)] bg-white checked:bg-[var(--color-accent,#DF5504)] rounded transition-colors relative checked:after:content-['✓'] checked:after:text-white checked:after:text-[10px] checked:after:font-black checked:after:absolute checked:after:top-[-2px] checked:after:left-[1px] cursor-pointer"
                                    />
                                    <span className="text-[10px] uppercase font-black text-gray-500 select-none">
                                      Next:
                                    </span>
                                    <span className="text-[11px] text-gray-200 select-none group-hover:text-white transition-colors truncate flex-grow">
                                      {nextTask.text}
                                    </span>
                                  </label>
                                ) : (
                                  <div className="flex items-center gap-1.5 text-[10px] text-green-400 font-bold justify-center select-none py-0.5">
                                    <span>🎉 All tasks completed!</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      {/* Timer details inside the card */}
                      <div className="border-t border-[var(--color-dark-tertiary,#3D3D3D)] mt-3 pt-2 flex justify-between items-center font-mono">
                        <span className="text-[10px] text-[var(--color-accent,#DF5504)]">⏱ {Math.floor((card.timeSpent || 0) / 60)}m spent</span>
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
                  ))}
                </div>
              </div>
            ))}
          </div>

        </div>

        {/* COL 3: DAILY HABIT STREAKS */}
        <div className="flex flex-col gap-4">

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

      {/* 🖼️ IN-APP DOCUMENT LIGHTBOX PREVIEW OVERLAY */}
      {lightboxFile && (
        <div className="fixed inset-0 bg-black/90 flex flex-col items-center justify-center p-4 z-[60] animate-fadeIn">
          <div className="w-full max-w-2xl bg-[var(--color-dark-bg,#282828)] border-2 border-[var(--color-accent,#DF5504)] p-4 text-white rounded flex flex-col gap-4 max-h-[90vh]">
            <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-2">
              <span className="font-bold font-mono text-xs uppercase text-[var(--color-accent,#DF5504)] truncate max-w-[400px]">
                🔍 Previewing: {lightboxFile.name}
              </span>
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setLightboxFile(null);
                }}
                className="text-gray-400 hover:text-white font-black text-lg p-1"
              >
                &times;
              </button>
            </div>

            {/* Document Render Body */}
            <div className="flex-grow flex items-center justify-center overflow-auto bg-black/40 rounded p-2 min-h-[300px]">
              {lightboxFile.dataUrl?.startsWith('data:image/') ? (
                <img 
                  src={lightboxFile.dataUrl} 
                  alt={lightboxFile.name} 
                  className="max-w-full max-h-[60vh] object-contain border border-[var(--color-dark-tertiary,#3D3D3D)] rounded"
                />
              ) : lightboxFile.dataUrl?.startsWith('data:application/pdf') || lightboxFile.mimeType === 'application/pdf' ? (
                <iframe 
                  src={lightboxFile.dataUrl} 
                  title={lightboxFile.name} 
                  className="w-full h-[60vh] rounded border border-[var(--color-dark-tertiary,#3D3D3D)] bg-white"
                />
              ) : lightboxFile.dataUrl?.startsWith('data:text/') ? (
                (() => {
                  try {
                    const rawBase64 = lightboxFile.dataUrl.split(',')[1];
                    const decodedText = atob(rawBase64);
                    return (
                      <pre className="w-full h-[60vh] p-4 bg-black/70 text-green-400 font-mono text-[10px] overflow-auto rounded text-left whitespace-pre-wrap">
                        {decodedText}
                      </pre>
                    );
                  } catch (err) {
                    return <span className="text-xs text-red-400">Failed to render text content preview.</span>;
                  }
                })()
              ) : (
                <div className="text-center flex flex-col gap-3 max-w-sm p-4">
                  <span className="text-2xl">📦</span>
                  <span className="font-mono text-xs text-gray-400">
                    No inline preview renderer is available for this format. You can export or view it natively on your device:
                  </span>
                  <div className="flex gap-2 justify-center mt-2">
                    <a
                      href={lightboxFile.dataUrl}
                      download={lightboxFile.name}
                      onClick={async () => {
                        await triggerHaptic();
                      }}
                      className="px-4 py-1.5 bg-[var(--color-accent,#DF5504)] text-white font-black font-mono text-[10px] uppercase rounded hover:opacity-90"
                    >
                      📥 Download File
                    </a>
                  </div>
                </div>
              )}
            </div>
            
            <div className="flex justify-end pt-2 border-t border-[var(--color-dark-tertiary,#3D3D3D)]">
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setLightboxFile(null);
                }}
                className="px-4 py-1 bg-[var(--color-dark-tertiary,#3D3D3D)] text-white text-[10px] font-bold font-mono uppercase rounded hover:bg-opacity-80"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

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
                className="w-full py-2.5 bento-btn bg-[var(--color-accent,#DF5504)] text-white hover:opacity-90 font-bold uppercase text-[10px] rounded transition-all"
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
          <div className="w-full max-w-md bento-box p-6 text-white max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex flex-col gap-2 border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-3 mb-4">
              <div className="flex justify-between items-start">
                <h3 className="font-black text-xs font-mono uppercase tracking-wider text-gray-400">
                  Card details
                </h3>
                <button 
                  onClick={() => {
                    setSelectedCardForEdit(null);
                    setIsLabelManagerOpen(false);
                  }}
                  className="text-gray-400 hover:text-white font-black text-lg p-1"
                >
                  &times;
                </button>
              </div>

              {/* Active Selected Labels Header */}
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                {/* Render Selected Labels only */}
                {selectedCardForEdit.labelIds && selectedCardForEdit.labelIds.map(labelId => {
                  const labelObj = labels.find(l => l.id === labelId);
                  if (!labelObj) return null;
                  return (
                    <span 
                      key={labelId}
                      className="text-[9px] font-black text-white uppercase px-1.5 py-0.5 rounded border border-white/10 shadow-[1px_1px_0px_0px_var(--color-shadow,#BCBCBC)]"
                      style={{ backgroundColor: labelObj.color }}
                    >
                      {labelObj.text}
                    </span>
                  );
                })}

                {/* Adjacent Select Label Button */}
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    setIsLabelManagerOpen(!isLabelManagerOpen);
                  }}
                  className={`text-[9px] font-black font-mono uppercase px-1.5 py-0.5 border rounded transition-all flex items-center gap-1 ${
                    isLabelManagerOpen 
                      ? 'border-white bg-white text-black' 
                      : 'border-[var(--color-accent,#DF5504)] bg-transparent text-[var(--color-accent,#DF5504)] hover:bg-[var(--color-accent,#DF5504)] hover:text-white'
                  }`}
                >
                  🏷️ {isLabelManagerOpen ? 'Close' : 'Select'}
                </button>
              </div>

              {/* Collapsible Label Selector Dropdown (Adjacent Drawer) */}
              {isLabelManagerOpen && (
                <div className="bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2.5 rounded mt-2 animate-fadeIn flex flex-col gap-2 font-mono text-xs">
                  <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 pb-1">
                    <span className="font-bold text-[9px] uppercase text-gray-400">Toggle Card Labels</span>
                  </div>
                  
                  <div className="flex flex-wrap gap-1.5">
                    {labels.map(lbl => {
                      const hasLabel = selectedCardForEdit.labelIds?.includes(lbl.id);
                      return (
                        <button
                          key={lbl.id}
                          type="button"
                          onClick={async () => {
                            await triggerHaptic();
                            const currentIds = selectedCardForEdit.labelIds || [];
                            const nextIds = currentIds.includes(lbl.id)
                              ? currentIds.filter(id => id !== lbl.id)
                              : [...currentIds, lbl.id];
                            setSelectedCardForEdit({ ...selectedCardForEdit, labelIds: nextIds });
                          }}
                          className={`text-[9px] font-black px-1.5 py-0.5 border transition-all rounded flex items-center gap-1 ${
                            hasLabel 
                              ? 'border-white scale-105 shadow-[1px_1px_0px_0px_var(--color-shadow,#BCBCBC)]' 
                              : 'border-[var(--color-dark-tertiary)]/50 opacity-40'
                          }`}
                          style={{ backgroundColor: lbl.color, color: 'white' }}
                        >
                          {lbl.text} {hasLabel ? '✓' : ''}
                        </button>
                      );
                    })}
                  </div>

                  {/* Add New Quick Label In-Place */}
                  <div className="border-t border-[var(--color-dark-tertiary,#3D3D3D)]/30 pt-2 mt-1">
                    <input 
                      type="text"
                      placeholder="＋ Create new label... (Press Enter)"
                      className="w-full bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] px-2 py-1 text-white text-[9px] rounded font-mono"
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const input = e.currentTarget;
                          const text = input.value.trim().toUpperCase();
                          if (text) {
                            await triggerHaptic();
                            const colors = ['#ff3b30', '#DF5504', '#34c759', '#007aff', '#ffcc00', '#a2845e', '#5856d6'];
                            const randomColor = colors[Math.floor(Math.random() * colors.length)];
                            const newLabel = {
                              id: 'label-' + Date.now(),
                              text,
                              color: randomColor
                            };
                            setLabels([...labels, newLabel]);
                            input.value = '';
                          }
                        }
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Inputs */}
            <div className="flex flex-col gap-4">
              {/* Active Focus Session Widget */}
              <div className="p-3 bg-[var(--color-dark-bg,#282828)] border border-[var(--color-accent,#DF5504)] rounded flex justify-between items-center font-mono text-xs shadow-[2px_2px_0px_0px_var(--color-accent,#DF5504)] animate-pulse">
                <div className="flex flex-col">
                  <span className="text-[9px] text-[#8892b0] font-bold uppercase tracking-wider">🎯 FOCUS SESSION ACTIVE</span>
                  <span className="text-[10px] text-white">Keep this screen open to study</span>
                </div>
                <div className="text-[12px] font-black text-[var(--color-accent,#DF5504)]">
                  {Math.floor((selectedCardForEdit.timeSpent || 0) / 3600)}h {Math.floor(((selectedCardForEdit.timeSpent || 0) % 3600) / 60)}m {((selectedCardForEdit.timeSpent || 0) % 60)}s
                </div>
              </div>
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

              <div>
                <label className="block text-xs font-mono font-bold uppercase text-gray-400 mb-1">
                  📋 Checklist & Tasks
                </label>
                
                {/* Drag-resizable and scrollable checklist viewport container */}
                <div className="w-full resize-y overflow-auto min-h-[120px] h-36 bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 rounded flex flex-col focus-within:border-[var(--color-accent,#DF5504)] transition-all">
                  <div className="flex-grow flex flex-col gap-1.5 overflow-y-auto pr-1">
                    {/* Render active tasks */}
                    {selectedCardForEdit.checklists?.[0]?.items.map(item => {
                      const isEditing = editingTaskId === item.id;
                      return (
                        <div key={item.id} className="flex justify-between items-center bg-black/20 hover:bg-black/35 border border-[var(--color-dark-tertiary,#3D3D3D)]/40 p-1.5 rounded font-mono text-[11px] gap-2">
                          {isEditing ? (
                            /* Inline Edit Input Field */
                            <div className="flex items-center gap-1.5 flex-grow">
                              <span className="text-gray-500">✏️</span>
                              <input 
                                type="text"
                                value={editingTaskText}
                                onChange={(e) => setEditingTaskText(e.target.value)}
                                onKeyDown={async (e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (editingTaskText.trim()) {
                                      await triggerHaptic();
                                      const updatedChecklists = selectedCardForEdit.checklists?.map((cl, idx) => {
                                        if (idx === 0) {
                                          return {
                                            ...cl,
                                            items: cl.items.map(it => it.id === item.id ? { ...it, text: editingTaskText.trim() } : it)
                                          };
                                        }
                                        return cl;
                                      }) || [];
                                      setSelectedCardForEdit({ ...selectedCardForEdit, checklists: updatedChecklists });
                                      setEditingTaskId(null);
                                    }
                                  } else if (e.key === 'Escape') {
                                    setEditingTaskId(null);
                                  }
                                }}
                                onBlur={async () => {
                                  if (editingTaskText.trim()) {
                                    const updatedChecklists = selectedCardForEdit.checklists?.map((cl, idx) => {
                                      if (idx === 0) {
                                        return {
                                          ...cl,
                                          items: cl.items.map(it => it.id === item.id ? { ...it, text: editingTaskText.trim() } : it)
                                        };
                                      }
                                      return cl;
                                    }) || [];
                                    setSelectedCardForEdit({ ...selectedCardForEdit, checklists: updatedChecklists });
                                  }
                                  setEditingTaskId(null);
                                }}
                                className="bg-black/40 border border-[var(--color-accent,#DF5504)] px-1.5 py-0.5 text-[11px] text-white rounded font-mono flex-grow focus:outline-none"
                                autoFocus
                              />
                            </div>
                          ) : (
                            /* Read-only Checklist Row */
                            <label className="flex items-center gap-2 cursor-pointer flex-grow select-none overflow-hidden">
                              <input 
                                type="checkbox"
                                checked={item.isChecked}
                                onChange={async () => {
                                  await triggerHaptic();
                                  const updatedChecklists = selectedCardForEdit.checklists?.map((cl, idx) => {
                                    if (idx === 0) {
                                      return {
                                        ...cl,
                                        items: cl.items.map(it => it.id === item.id ? { ...it, isChecked: !it.isChecked } : it)
                                      };
                                    }
                                    return cl;
                                  }) || [];
                                  setSelectedCardForEdit({ ...selectedCardForEdit, checklists: updatedChecklists });
                                }}
                                className="rounded border-[var(--color-dark-tertiary,#3D3D3D)] text-[var(--color-accent,#DF5504)] focus:ring-[var(--color-accent,#DF5504)] bg-black/40 w-3.5 h-3.5 cursor-pointer"
                              />
                              <span className={`text-white transition-all truncate ${item.isChecked ? 'line-through text-gray-500' : ''}`}>
                                {item.text}
                              </span>
                            </label>
                          )}
                          
                          {/* Row Actions Drawer */}
                          <div className="flex items-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity">
                            {!isEditing && (
                              <button
                                type="button"
                                onClick={async () => {
                                  await triggerHaptic();
                                  setEditingTaskId(item.id);
                                  setEditingTaskText(item.text);
                                }}
                                className="text-gray-400 hover:text-white font-mono text-[10px] transition-colors"
                              >
                                ✏️
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={async () => {
                                await triggerHaptic();
                                const updatedChecklists = selectedCardForEdit.checklists?.map((cl, idx) => {
                                  if (idx === 0) {
                                    return {
                                      ...cl,
                                      items: cl.items.filter(it => it.id !== item.id)
                                    };
                                  }
                                  return cl;
                                }) || [];
                                setSelectedCardForEdit({ ...selectedCardForEdit, checklists: updatedChecklists });
                              }}
                              className="text-red-500 hover:text-red-400 font-bold transition-colors"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {/* Inline Task Creator Row (Dynamic '+' Row) */}
                    <div className="flex items-center gap-2 bg-black/10 border border-dashed border-[var(--color-dark-tertiary,#3D3D3D)]/40 p-1.5 rounded font-mono text-[11px] focus-within:border-[var(--color-accent,#DF5504)] focus-within:bg-black/20 transition-all mt-1">
                      <span className="text-[12px] font-black text-[var(--color-accent,#DF5504)] select-none pl-1">＋</span>
                      <input 
                        type="text"
                        placeholder="New task... (Press Enter)"
                        value={inlineNewTaskText}
                        onChange={(e) => setInlineNewTaskText(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (inlineNewTaskText.trim()) {
                              await triggerHaptic();
                              const newItem = {
                                id: 'item-' + Date.now(),
                                text: inlineNewTaskText.trim(),
                                isChecked: false
                              };
                              const currentChecklists = selectedCardForEdit.checklists || [];
                              let updatedChecklists = [];
                              if (currentChecklists.length === 0) {
                                updatedChecklists = [{
                                  id: 'cl-' + Date.now(),
                                  items: [newItem]
                                }];
                              } else {
                                updatedChecklists = currentChecklists.map((cl, idx) => {
                                  if (idx === 0) {
                                    return {
                                      ...cl,
                                      items: [...cl.items, newItem]
                                    };
                                  }
                                  return cl;
                                });
                              }
                              setSelectedCardForEdit({ ...selectedCardForEdit, checklists: updatedChecklists });
                              setInlineNewTaskText('');
                            }
                          }
                        }}
                        className="bg-transparent text-white border-none focus:outline-none placeholder-gray-500 text-[11px] font-mono flex-grow"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Date Row (Datetime-Local upgrade) */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono font-bold uppercase text-gray-400 mb-1">Due Date & Time</label>
                  <input 
                    type="datetime-local"
                    value={formatTimestampToDatetimeLocal(selectedCardForEdit.dueDate)}
                    onChange={(e) => {
                      const parsed = e.target.value ? Date.parse(e.target.value) : null;
                      setSelectedCardForEdit({ ...selectedCardForEdit, dueDate: parsed });
                    }}
                    className="w-full bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 text-xs font-mono text-white rounded focus:border-[var(--color-accent,#DF5504)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono font-bold uppercase text-gray-400 mb-1">Completion Date & Time</label>
                  <input 
                    type="datetime-local"
                    value={formatTimestampToDatetimeLocal(selectedCardForEdit.completedAt)}
                    onChange={(e) => {
                      const parsed = e.target.value ? Date.parse(e.target.value) : null;
                      setSelectedCardForEdit({ ...selectedCardForEdit, completedAt: parsed });
                    }}
                    className="w-full bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 text-xs font-mono text-white rounded focus:border-[var(--color-accent,#DF5504)]"
                  />
                </div>
              </div>

              {/* 🔔 NOTIFICATION & ALERT STUDIO POPUP TRIGGER */}
              <button 
                type="button"
                disabled={!selectedCardForEdit.dueDate}
                onClick={async () => {
                  await triggerHaptic();
                  setIsNotificationStudioOpen(true);
                }}
                className={`w-full mt-2.5 px-4 py-2.5 text-xs font-mono font-bold tracking-wide uppercase flex items-center justify-center gap-1.5 rounded transition-all ${
                  selectedCardForEdit.dueDate 
                    ? 'bento-btn text-white' 
                    : 'bg-[var(--color-dark-tertiary,#3D3D3D)] text-gray-500 border border-[var(--color-dark-tertiary,#3D3D3D)] cursor-not-allowed opacity-60'
                }`}
              >
                <span>🔔</span>
                <span>{selectedCardForEdit.dueDate ? 'Configure Alerts & Notifications' : 'Set Due Date to Enable Alerts'}</span>
              </button>

              {/* 📁 DOCUMENT & RESOURCE STUDIO */}
              <div className="border-t border-[var(--color-dark-tertiary,#3D3D3D)] pt-4 mt-2">
                <h4 className="font-mono font-black text-xs uppercase text-[var(--color-accent,#DF5504)] tracking-wider mb-3 flex items-center gap-1.5">
                  📁 Document & Resource Studio
                </h4>
                
                <div className="flex flex-col gap-3">
                  
                  {/* 1. CENTRAL SUBMISSION PORTAL */}
                  <details className="group border border-[var(--color-dark-tertiary,#3D3D3D)] bg-[var(--color-dark-bg,#282828)] rounded p-2 overflow-hidden transition-all">
                    <summary className="font-bold font-mono text-[10px] uppercase tracking-wider text-white cursor-pointer list-none flex justify-between items-center select-none">
                      <span className="flex items-center gap-1.5">🏆 Central Submission Portal</span>
                      <span className="text-gray-500 transition-transform group-open:rotate-180">▼</span>
                    </summary>
                    <div className="mt-2.5 pt-2 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40 text-xs flex flex-col gap-2">
                      {selectedCardForEdit.attachments?.find(a => a.type === 'submission') ? (
                        (() => {
                          const subFile = selectedCardForEdit.attachments.find(a => a.type === 'submission')!;
                          return (
                            <div className="flex flex-col gap-2 p-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded font-mono">
                              <div className="flex justify-between items-center">
                                <span className="text-yellow-400 font-bold text-[10px] truncate max-w-[200px]" title={subFile.name}>
                                  📄 {subFile.name}
                                </span>
                                <span className="text-[9px] text-gray-500">
                                  {Math.round((subFile.size || 0) / 1024)} KB
                                </span>
                              </div>
                              <div className="flex gap-1.5 mt-1.5">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await triggerHaptic();
                                    setLightboxFile(subFile);
                                  }}
                                  className="px-2 py-1 bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 rounded text-[9px] font-bold uppercase hover:bg-yellow-500/35"
                                >
                                  Open File
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await triggerHaptic();
                                    const nextAttachments = selectedCardForEdit.attachments?.filter(a => a.id !== subFile.id) || [];
                                    setSelectedCardForEdit({ ...selectedCardForEdit, attachments: nextAttachments });
                                  }}
                                  className="px-2 py-1 bg-red-900/20 text-red-400 border border-red-500/30 rounded text-[9px] font-bold uppercase hover:bg-red-900/40"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          );
                        })()
                      ) : (
                        <div className="flex flex-col gap-2 p-2 bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] border-dashed rounded text-center text-gray-500 text-[10px]">
                          <span>No submission document attached yet (e.g. final DOCX or Slides)</span>
                          <label className="mx-auto cursor-pointer bento-btn bg-white text-black text-[9px] px-2.5 py-1 font-bold uppercase rounded">
                            Attach Submission
                            <input 
                              type="file" 
                              accept=".docx,.pptx,.pdf,.doc,.txt"
                              className="hidden" 
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  await triggerHaptic();
                                  if (file.size > 1.5 * 1024 * 1024) {
                                    alert('File size exceeds 1.5MB limit. Please attach a smaller compressed file.');
                                    return;
                                  }
                                  const reader = new FileReader();
                                  reader.onload = (event) => {
                                    const nextAttachments = [
                                      ...(selectedCardForEdit.attachments || []),
                                      {
                                        id: 'attach-' + Date.now(),
                                        name: file.name,
                                        type: 'submission',
                                        size: file.size,
                                        mimeType: file.type,
                                        dataUrl: event.target?.result as string,
                                        addedAt: Date.now()
                                      } as FileAttachment
                                    ];
                                    setSelectedCardForEdit({ ...selectedCardForEdit, attachments: nextAttachments });
                                  };
                                  reader.readAsDataURL(file);
                                }
                              }}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </details>

                  {/* 2. SUPPORTING FILE VAULT */}
                  <details className="group border border-[var(--color-dark-tertiary,#3D3D3D)] bg-[var(--color-dark-bg,#282828)] rounded p-2 overflow-hidden transition-all">
                    <summary className="font-bold font-mono text-[10px] uppercase tracking-wider text-white cursor-pointer list-none flex justify-between items-center select-none">
                      <span className="flex items-center gap-1.5">🖇️ Supporting File Vault</span>
                      <span className="text-gray-500 transition-transform group-open:rotate-180">▼</span>
                    </summary>
                    <div className="mt-2.5 pt-2 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40 text-xs flex flex-col gap-2">
                      <div className="max-h-32 overflow-y-auto flex flex-col gap-1.5 pr-1">
                        {(selectedCardForEdit.attachments?.filter(a => a.type === 'supporting') || []).length === 0 ? (
                          <span className="text-[10px] text-gray-500 font-mono italic text-center py-2">No supporting documents attached yet</span>
                        ) : (
                          (selectedCardForEdit.attachments?.filter(a => a.type === 'supporting') || []).map(file => (
                            <div key={file.id} className="flex justify-between items-center p-1.5 bg-black/30 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded font-mono text-[10px]">
                              <button
                                type="button"
                                onClick={async () => {
                                  await triggerHaptic();
                                  setLightboxFile(file);
                                }}
                                className="text-blue-400 font-bold hover:underline truncate max-w-[200px]"
                                title="Open File Preview"
                              >
                                📎 {file.name}
                              </button>
                              <div className="flex items-center gap-2">
                                <span className="text-gray-500 text-[9px]">{Math.round((file.size || 0) / 1024)} KB</span>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await triggerHaptic();
                                    const nextAttachments = selectedCardForEdit.attachments?.filter(a => a.id !== file.id) || [];
                                    setSelectedCardForEdit({ ...selectedCardForEdit, attachments: nextAttachments });
                                  }}
                                  className="text-red-500 hover:text-red-400 font-bold"
                                >
                                  🗑
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                      
                      <label className="w-full text-center cursor-pointer py-1.5 border border-dashed border-[var(--color-dark-tertiary,#3D3D3D)] bg-[var(--color-dark-bg,#282828)] rounded text-gray-400 text-[9px] font-mono font-bold uppercase hover:bg-black/30 transition-all flex justify-center items-center gap-1 mt-1">
                        <span>＋ Attach Supporting Document</span>
                        <input 
                          type="file" 
                          className="hidden" 
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              await triggerHaptic();
                              if (file.size > 1.5 * 1024 * 1024) {
                                alert('File size exceeds 1.5MB limit. Please attach a smaller compressed file.');
                                return;
                              }
                              const reader = new FileReader();
                              reader.onload = (event) => {
                                const nextAttachments = [
                                  ...(selectedCardForEdit.attachments || []),
                                  {
                                    id: 'attach-' + Date.now(),
                                    name: file.name,
                                    type: 'supporting',
                                    size: file.size,
                                    mimeType: file.type,
                                    dataUrl: event.target?.result as string,
                                    addedAt: Date.now()
                                  } as FileAttachment
                                ];
                                setSelectedCardForEdit({ ...selectedCardForEdit, attachments: nextAttachments });
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                      </label>
                    </div>
                  </details>

                  {/* 3. BIBLIOGRAPHY & CITATION COMPILER */}
                  <details className="group border border-[var(--color-dark-tertiary,#3D3D3D)] bg-[var(--color-dark-bg,#282828)] rounded p-2 overflow-hidden transition-all">
                    <summary className="font-bold font-mono text-[10px] uppercase tracking-wider text-white cursor-pointer list-none flex justify-between items-center select-none">
                      <span className="flex items-center gap-1.5">📚 Bibliography & Citations</span>
                      <span className="text-gray-500 transition-transform group-open:rotate-180">▼</span>
                    </summary>
                    <div className="mt-2.5 pt-2 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40 text-xs flex flex-col gap-2">
                      {/* 🔍 RESEARCH & SEARCH ENGINE PORTAL */}
                      <div className="bg-black/30 border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 rounded mb-1 flex flex-col gap-1.5 font-mono">
                        <div className="flex justify-between items-center pb-1 border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40">
                          <span className="text-[9px] uppercase font-bold text-gray-400">🔍 Web Research Engines</span>
                          <span className="text-[8px] text-[var(--color-accent,#DF5504)] font-bold">SAFARI PORTAL</span>
                        </div>
                        
                        <div className="flex gap-1">
                          <input 
                            type="text"
                            placeholder="Search topics or authors..."
                            value={academicSearchQuery}
                            onChange={(e) => setAcademicSearchQuery(e.target.value)}
                            className="bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] px-2 py-1 text-white text-[10px] flex-grow rounded font-mono focus:border-[var(--color-accent,#DF5504)]"
                          />
                          <select
                            value={academicEngine}
                            onChange={(e) => setAcademicEngine(e.target.value)}
                            className="bg-black/50 border border-[var(--color-dark-tertiary,#3D3D3D)] text-white text-[9px] px-1 rounded font-mono"
                          >
                            <option value="scholar">🎓 Scholar</option>
                            <option value="pubmed">🧬 PubMed</option>
                            <option value="wikipedia">📚 Wiki</option>
                            <option value="google">🌐 Google</option>
                          </select>
                          <button
                            type="button"
                            onClick={async () => {
                              if (academicSearchQuery.trim()) {
                                await triggerHaptic();
                                const encodedQuery = encodeURIComponent(academicSearchQuery.trim());
                                let searchUrl = '';
                                switch (academicEngine) {
                                  case 'scholar':
                                    searchUrl = `https://scholar.google.com/scholar?q=${encodedQuery}`;
                                    break;
                                  case 'pubmed':
                                    searchUrl = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodedQuery}`;
                                    break;
                                  case 'wikipedia':
                                    searchUrl = `https://en.wikipedia.org/wiki/Special:Search?search=${encodedQuery}`;
                                    break;
                                  case 'google':
                                    searchUrl = `https://www.google.com/search?q=${encodedQuery}`;
                                    break;
                                }
                                window.open(searchUrl, '_blank');
                              }
                            }}
                            className="bg-[var(--color-accent,#DF5504)] text-white font-bold text-[10px] px-2.5 rounded hover:opacity-90 flex items-center justify-center font-mono uppercase"
                          >
                            Search ↗
                          </button>
                        </div>
                      </div>

                      {/* Citation inputs */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <input 
                          type="text"
                          placeholder="Source Book/Author..."
                          value={newCitationTitle}
                          onChange={(e) => setNewCitationTitle(e.target.value)}
                          className="bg-black/30 border border-[var(--color-dark-tertiary,#3D3D3D)] px-2 py-1 text-white text-[10px] rounded font-mono"
                        />
                        <div className="flex gap-1">
                          <input 
                            type="text"
                            placeholder="URL or Page Reference..."
                            value={newCitationUrl}
                            onChange={(e) => setNewCitationUrl(e.target.value)}
                            className="bg-black/30 border border-[var(--color-dark-tertiary,#3D3D3D)] px-2 py-1 text-white text-[10px] flex-grow rounded font-mono"
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              if (newCitationTitle.trim() && newCitationUrl.trim()) {
                                await triggerHaptic();
                                const nextCitations = [
                                  ...(selectedCardForEdit.resources || []),
                                  {
                                    id: 'cit-' + Date.now(),
                                    title: newCitationTitle.trim(),
                                    url: newCitationUrl.trim(),
                                    addedAt: Date.now()
                                  } as ResourceCitation
                                ];
                                setSelectedCardForEdit({ ...selectedCardForEdit, resources: nextCitations });
                                setNewCitationTitle('');
                                setNewCitationUrl('');
                              }
                            }}
                            className="bg-[var(--color-accent,#DF5504)] text-white font-bold text-[10px] px-2 rounded hover:opacity-90"
                          >
                            Add
                          </button>
                        </div>
                      </div>

                      {/* Citations List */}
                      <div className="max-h-32 overflow-y-auto flex flex-col gap-1.5 mt-2">
                        {(selectedCardForEdit.resources || []).length === 0 ? (
                          <span className="text-[10px] text-gray-500 font-mono italic text-center py-2">No citations compiled yet</span>
                        ) : (
                          (selectedCardForEdit.resources || []).map(cit => (
                            <div key={cit.id} className="flex justify-between items-center p-1.5 bg-black/20 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded font-mono text-[9px]">
                              <div className="flex flex-col gap-0.5 truncate max-w-[210px]">
                                <span className="font-bold text-white text-[10px]">{cit.title}</span>
                                <span className="text-gray-500 text-[8px] truncate">{cit.url}</span>
                              </div>
                              <button
                                type="button"
                                onClick={async () => {
                                  await triggerHaptic();
                                  const nextCitations = selectedCardForEdit.resources?.filter(r => r.id !== cit.id) || [];
                                  setSelectedCardForEdit({ ...selectedCardForEdit, resources: nextCitations });
                                }}
                                className="text-red-500 hover:text-red-400 font-bold ml-1.5"
                              >
                                🗑
                              </button>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Export Citation Tools */}
                      {(selectedCardForEdit.resources || []).length > 0 && (
                        <div className="grid grid-cols-2 gap-1.5 mt-2 pt-2 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/30">
                          <button
                            type="button"
                            onClick={async () => {
                              await triggerHaptic();
                              // Build CSV
                              const headers = `"Title","Reference/URL"\n`;
                              const rows = (selectedCardForEdit.resources || [])
                                .map(r => `"${r.title.replace(/"/g, '""')}","${r.url.replace(/"/g, '""')}"`)
                                .join('\n');
                              await navigator.clipboard.writeText(headers + rows);
                              alert('Citations copied to clipboard as standard CSV!');
                            }}
                            className="py-1 bg-white text-black font-bold uppercase text-[8px] tracking-wider rounded text-center"
                          >
                            📋 Copy as CSV
                          </button>
                          
                          <button
                            type="button"
                            onClick={async () => {
                              await triggerHaptic();
                              // Create CSV Download file
                              const headers = `"Title","Reference/URL"\n`;
                              const rows = (selectedCardForEdit.resources || [])
                                .map(r => `"${r.title.replace(/"/g, '""')}","${r.url.replace(/"/g, '""')}"`)
                                .join('\n');
                              const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `citations_${selectedCardForEdit.id}.csv`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                            className="py-1 bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] text-white font-bold uppercase text-[8px] tracking-wider rounded text-center hover:bg-black/30"
                          >
                            📥 Download CSV
                          </button>
                        </div>
                      )}
                    </div>
                  </details>

                  {/* 4. CLOUD & DRIVES LINKS */}
                  <details className="group border border-[var(--color-dark-tertiary,#3D3D3D)] bg-[var(--color-dark-bg,#282828)] rounded p-2 overflow-hidden transition-all">
                    <summary className="font-bold font-mono text-[10px] uppercase tracking-wider text-white cursor-pointer list-none flex justify-between items-center select-none">
                      <span className="flex items-center gap-1.5">🌐 Cloud & Drives Links</span>
                      <span className="text-gray-500 transition-transform group-open:rotate-180">▼</span>
                    </summary>
                    <div className="mt-2.5 pt-2 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40 text-xs flex flex-col gap-2">
                      <div className="grid grid-cols-2 gap-1.5">
                        <input 
                          type="text"
                          placeholder="Link Label (e.g. iCloud Folder)..."
                          value={newCloudLinkName}
                          onChange={(e) => setNewCloudLinkName(e.target.value)}
                          className="bg-black/30 border border-[var(--color-dark-tertiary,#3D3D3D)] px-2 py-1 text-white text-[10px] rounded font-mono"
                        />
                        <div className="flex gap-1">
                          <input 
                            type="text"
                            placeholder="https://drive.google.com/..."
                            value={newCloudLinkUrl}
                            onChange={(e) => setNewCloudLinkUrl(e.target.value)}
                            className="bg-black/30 border border-[var(--color-dark-tertiary,#3D3D3D)] px-2 py-1 text-white text-[10px] flex-grow rounded font-mono"
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              if (newCloudLinkName.trim() && newCloudLinkUrl.trim()) {
                                await triggerHaptic();
                                // Normalize link
                                let finalUrl = newCloudLinkUrl.trim();
                                if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
                                  finalUrl = 'https://' + finalUrl;
                                }
                                const nextAttachments = [
                                  ...(selectedCardForEdit.attachments || []),
                                  {
                                    id: 'attach-' + Date.now(),
                                    name: newCloudLinkName.trim(),
                                    type: 'cloud_link',
                                    dataUrl: finalUrl,
                                    addedAt: Date.now()
                                  } as FileAttachment
                                ];
                                setSelectedCardForEdit({ ...selectedCardForEdit, attachments: nextAttachments });
                                setNewCloudLinkName('');
                                setNewCloudLinkUrl('');
                              }
                            }}
                            className="bg-[var(--color-accent,#DF5504)] text-white font-bold text-[10px] px-2 rounded hover:opacity-90"
                          >
                            Add
                          </button>
                        </div>
                      </div>

                      {/* Display Cloud links */}
                      <div className="max-h-32 overflow-y-auto flex flex-col gap-1.5 mt-2">
                        {(selectedCardForEdit.attachments?.filter(a => a.type === 'cloud_link') || []).length === 0 ? (
                          <span className="text-[10px] text-gray-500 font-mono italic text-center py-2">No cloud or drives links saved</span>
                        ) : (
                          (selectedCardForEdit.attachments?.filter(a => a.type === 'cloud_link') || []).map(link => {
                            const isGoogle = link.dataUrl?.includes('drive.google.com') || link.dataUrl?.includes('google.com');
                            const isApple = link.dataUrl?.includes('icloud.com');
                            
                            return (
                              <div key={link.id} className="flex justify-between items-center p-1.5 bg-black/30 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded font-mono text-[9px]">
                                <a
                                  href={link.dataUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-white hover:underline truncate max-w-[210px] flex items-center gap-1 font-bold"
                                >
                                  {isApple ? '🍏' : isGoogle ? '🤖' : '🌐'} {link.name} 
                                  <span className="text-[7px] text-gray-500 font-normal">({link.dataUrl})</span>
                                </a>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await triggerHaptic();
                                    const nextAttachments = selectedCardForEdit.attachments?.filter(a => a.id !== link.id) || [];
                                    setSelectedCardForEdit({ ...selectedCardForEdit, attachments: nextAttachments });
                                  }}
                                  className="text-red-500 hover:text-red-400 font-bold ml-1.5"
                                >
                                  🗑
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </details>

                </div>
              </div>
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

      {/* 🔔 NOTIFICATION & ALERT STUDIO POPUP MODAL */}
      {isNotificationStudioOpen && selectedCardForEdit && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[var(--color-dark-secondary,#333333)] border-2 border-[var(--color-accent,#DF5504)] p-5 rounded-lg shadow-[8px_8px_0px_0px_#000] font-mono text-xs flex flex-col gap-4 max-h-[90vh] overflow-y-auto animate-fadeIn">
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b-2 border-[var(--color-dark-tertiary,#3D3D3D)] pb-3">
              <span className="font-black text-sm text-[var(--color-accent,#DF5504)] uppercase tracking-wider flex items-center gap-2">
                🔔 Alert Studio
              </span>
              <button
                onClick={async () => {
                  await triggerHaptic();
                  setIsNotificationStudioOpen(false);
                }}
                className="w-6 h-6 rounded-full bg-black/40 hover:bg-black/80 text-white flex items-center justify-center font-bold text-sm transition-colors cursor-pointer"
              >
                ×
              </button>
            </div>

            <div className="text-gray-400 text-[10px] leading-relaxed uppercase tracking-wider">
              Configure and test multi-channel reminders for: <span className="text-white font-bold">"{selectedCardForEdit.title}"</span>
            </div>

            {/* Preference Toggles */}
            <div className="flex flex-col gap-2.5">
              <span className="font-bold text-[10px] text-gray-500 uppercase tracking-widest">Toggle Channels</span>
              
              <div className="grid grid-cols-1 gap-2">
                <label className="flex items-center justify-between cursor-pointer p-2.5 rounded bg-black/20 border border-[var(--color-dark-tertiary,#3D3D3D)]/40 hover:bg-black/40">
                  <span className="text-[10px] text-white font-bold flex items-center gap-1.5">
                    <span>📱</span> IN-APP TOAST NOTIFICATION
                  </span>
                  <input 
                    type="checkbox"
                    checked={selectedCardForEdit.notifyInApp !== false}
                    onChange={() => setSelectedCardForEdit({ ...selectedCardForEdit, notifyInApp: selectedCardForEdit.notifyInApp === false })}
                    className="rounded border-[var(--color-dark-tertiary,#3D3D3D)] text-[var(--color-accent,#DF5504)] focus:ring-[var(--color-accent,#DF5504)] bg-black/40 w-4 h-4 cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer p-2.5 rounded bg-black/20 border border-[var(--color-dark-tertiary,#3D3D3D)]/40 hover:bg-black/40">
                  <span className="text-[10px] text-white font-bold flex items-center gap-1.5">
                    <span>🔔</span> LOCAL SYSTEM LOCK-SCREEN
                  </span>
                  <input 
                    type="checkbox"
                    checked={selectedCardForEdit.notifyLocalPanel !== false}
                    onChange={() => setSelectedCardForEdit({ ...selectedCardForEdit, notifyLocalPanel: selectedCardForEdit.notifyLocalPanel === false })}
                    className="rounded border-[var(--color-dark-tertiary,#3D3D3D)] text-[var(--color-accent,#DF5504)] focus:ring-[var(--color-accent,#DF5504)] bg-black/40 w-4 h-4 cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer p-2.5 rounded bg-black/20 border border-[var(--color-dark-tertiary,#3D3D3D)]/40 hover:bg-black/40">
                  <span className="text-[10px] text-white font-bold flex items-center gap-1.5">
                    <span>📅</span> SYNC APPLE CALENDAR ALARM
                  </span>
                  <input 
                    type="checkbox"
                    checked={selectedCardForEdit.notifyCalendarAlarm !== false}
                    onChange={() => setSelectedCardForEdit({ ...selectedCardForEdit, notifyCalendarAlarm: selectedCardForEdit.notifyCalendarAlarm === false })}
                    className="rounded border-[var(--color-dark-tertiary,#3D3D3D)] text-[var(--color-accent,#DF5504)] focus:ring-[var(--color-accent,#DF5504)] bg-black/40 w-4 h-4 cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer p-2.5 rounded bg-black/20 border border-[var(--color-dark-tertiary,#3D3D3D)]/40 hover:bg-black/40">
                  <span className="text-[10px] text-white font-bold flex items-center gap-1.5">
                    <span>📧</span> NATIVE EMAIL COMPOSER REMINDER
                  </span>
                  <input 
                    type="checkbox"
                    checked={selectedCardForEdit.notifyEmailReminder !== false}
                    onChange={() => setSelectedCardForEdit({ ...selectedCardForEdit, notifyEmailReminder: selectedCardForEdit.notifyEmailReminder === false })}
                    className="rounded border-[var(--color-dark-tertiary,#3D3D3D)] text-[var(--color-accent,#DF5504)] focus:ring-[var(--color-accent,#DF5504)] bg-black/40 w-4 h-4 cursor-pointer"
                  />
                </label>
              </div>
            </div>

            {/* Instant Actions Row */}
            <div className="flex flex-col gap-2 pt-3 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40">
              <span className="font-bold text-[10px] text-gray-500 uppercase tracking-widest">Instant Actions</span>
              
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    if (!selectedCardForEdit.dueDate) {
                      showToast("⚠️ Set a due date first!");
                      return;
                    }
                    if (selectedCardForEdit.notifyCalendarAlarm !== false) {
                      await syncToAppleCalendar(selectedCardForEdit);
                      showToast("📅 Synced to iOS Calendar!");
                    } else {
                      showToast("⚠️ Calendar Alert is disabled!");
                    }
                  }}
                  className="bento-btn text-white px-3 py-2.5 font-bold uppercase flex items-center justify-center gap-1.5"
                >
                  <span>📅</span> Sync Calendar
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    if (!selectedCardForEdit.dueDate) {
                      showToast("⚠️ Set a due date first!");
                      return;
                    }
                    if (selectedCardForEdit.notifyLocalPanel !== false) {
                      await scheduleLocalAlarm(selectedCardForEdit);
                      showToast("🔔 Scheduled System Alarm!");
                    } else {
                      showToast("⚠️ Notification Panel is disabled!");
                    }
                  }}
                  className="bento-btn text-white px-3 py-2.5 font-bold uppercase flex items-center justify-center gap-1.5"
                >
                  <span>🔔</span> Schedule Alarm
                </button>
              </div>

              <a
                href={`mailto:?subject=Triage%20Task%3A%20${encodeURIComponent(selectedCardForEdit.title)}&body=Task%20Details%3A%0A%0A-%20Title%3A%20${encodeURIComponent(selectedCardForEdit.title)}%0A-%20Description%3A%20${encodeURIComponent(selectedCardForEdit.description || 'No description provided')}%0A-%20Due%20Date%3A%20${selectedCardForEdit.dueDate ? encodeURIComponent(new Date(selectedCardForEdit.dueDate).toLocaleString()) : 'Not set'}%0A%0AStay%20Focused!`}
                onClick={async () => {
                  await triggerHaptic();
                  showToast("📧 Opening native mail app...");
                }}
                className="text-center bento-btn bg-[var(--color-accent,#DF5504)] text-white hover:opacity-90 px-3 py-2.5 font-bold uppercase flex items-center justify-center gap-1.5 block"
              >
                <span>📧</span> Send Email Reminder
              </a>
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end gap-2 mt-2 pt-3 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40">
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIsNotificationStudioOpen(false);
                }}
                className="px-4 py-2 bg-black border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white font-bold rounded"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 📅 NATIVE CALENDAR AGENDA POPUP MODAL */}
      {isCalendarAgendaOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[var(--color-dark-secondary,#333333)] border-2 border-[var(--color-accent,#DF5504)] p-5 rounded-lg shadow-[8px_8px_0px_0px_#000] font-mono text-xs flex flex-col gap-4 max-h-[90vh] overflow-hidden animate-fadeIn">
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b-2 border-[var(--color-dark-tertiary,#3D3D3D)] pb-3 flex-shrink-0">
              <span className="font-black text-sm text-[var(--color-accent,#DF5504)] uppercase tracking-wider flex items-center gap-2">
                📅 Native Calendar Agenda
              </span>
              <button
                onClick={async () => {
                  await triggerHaptic();
                  setIsCalendarAgendaOpen(false);
                }}
                className="w-6 h-6 rounded-full bg-black/40 hover:bg-black/80 text-white flex items-center justify-center font-bold text-sm transition-colors cursor-pointer"
              >
                ×
              </button>
            </div>

            {/* Range and Filters Row */}
            <div className="flex flex-col gap-2.5 border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-3 flex-shrink-0">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Select Range</span>
                <div className="flex gap-1">
                  {[7, 30, 90].map((days) => (
                    <button
                      key={days}
                      onClick={async () => {
                        await triggerHaptic();
                        setCalendarRangeDays(days);
                        await fetchUpcomingCalendarEvents(days);
                      }}
                      className={`px-2 py-1 rounded text-[9px] uppercase font-bold transition-all border ${
                        calendarRangeDays === days
                          ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                          : 'bg-black/30 border-[var(--color-dark-tertiary,#3D3D3D)] text-gray-400 hover:text-white hover:border-gray-500'
                      }`}
                    >
                      {days} Days
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Filters</span>
                <div className="flex gap-1">
                  <button
                    onClick={async () => {
                      await triggerHaptic();
                      setCalendarFilterType('all');
                    }}
                    className={`px-2.5 py-1 rounded text-[9px] uppercase font-bold transition-all border ${
                      calendarFilterType === 'all'
                        ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                        : 'bg-black/30 border-[var(--color-dark-tertiary,#3D3D3D)] text-gray-400 hover:text-white hover:border-gray-500'
                    }`}
                  >
                    All Events
                  </button>
                  <button
                    onClick={async () => {
                      await triggerHaptic();
                      setCalendarFilterType('triage');
                    }}
                    className={`px-2.5 py-1 rounded text-[9px] uppercase font-bold transition-all border ${
                      calendarFilterType === 'triage'
                        ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                        : 'bg-black/30 border-[var(--color-dark-tertiary,#3D3D3D)] text-gray-400 hover:text-white hover:border-gray-500'
                    }`}
                  >
                    Triage Only
                  </button>
                </div>
              </div>
            </div>

            {/* Scrollable Event List View */}
            <div className="flex-grow overflow-y-auto pr-1">
              {isCalendarLoading ? (
                /* Loading Skeleton */
                <div className="flex flex-col gap-3 py-4 animate-pulse">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="p-3 bg-black/20 rounded border border-[var(--color-dark-tertiary,#3D3D3D)]/40 flex flex-col gap-2">
                      <div className="h-2.5 bg-gray-600 rounded w-1/4"></div>
                      <div className="h-3.5 bg-gray-500 rounded w-3/4"></div>
                      <div className="h-2.5 bg-gray-600 rounded w-1/2"></div>
                    </div>
                  ))}
                </div>
              ) : (
                (() => {
                  // Filter events
                  const filtered = calendarEvents.filter((evt) => {
                    if (calendarFilterType === 'triage') {
                      return evt.title && evt.title.includes('📌 [Triage Lite]');
                    }
                    return true;
                  });

                  if (filtered.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                        <span className="text-2xl">📅</span>
                        <span className="font-bold text-gray-400 uppercase tracking-wider text-[10px]">No upcoming events inside this range.</span>
                        <span className="text-[9px] text-gray-500 uppercase">Stay Focused!</span>
                      </div>
                    );
                  }

                  return (
                    <div className="flex flex-col gap-3.5 py-2">
                      {filtered.map((evt, idx) => {
                        const isTriageEvent = evt.title && evt.title.includes('📌 [Triage Lite]');
                        const start = evt.startDate ? new Date(evt.startDate) : null;
                        const end = evt.endDate ? new Date(evt.endDate) : null;

                        return (
                          <div
                            key={idx}
                            className={`p-3 bg-black/20 rounded border transition-all ${
                              isTriageEvent
                                ? 'border-[var(--color-accent,#DF5504)]/40 border-l-4 border-l-[var(--color-accent,#DF5504)] shadow-[2px_2px_0px_0px_rgba(223,85,4,0.1)]'
                                : 'border-[var(--color-dark-tertiary,#3D3D3D)]/50 hover:border-gray-500'
                            }`}
                          >
                            {/* Event Timeline Date/Time */}
                            <div className="flex justify-between items-center mb-1.5 pb-1 border-b border-[var(--color-dark-tertiary,#3D3D3D)]/20">
                              <span className="text-[9px] text-[var(--color-accent,#DF5504)] font-black uppercase tracking-wider flex items-center gap-1">
                                <span>📅</span>
                                {start ? start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'Date Unknown'}
                              </span>
                              <span className="text-[8px] text-gray-500 uppercase font-bold tracking-widest">
                                {start ? start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
                                {end ? ` - ${end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
                              </span>
                            </div>

                            {/* Event Title */}
                            <h4 className="font-bold text-white text-[11px] mb-1 leading-snug">
                              {evt.title || 'Untitled Event'}
                            </h4>

                            {/* Location & Details */}
                            {evt.location && (
                              <div className="text-[9px] text-gray-400 mt-1 flex items-center gap-1">
                                <span>📍</span>
                                <span className="truncate">{evt.location}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end gap-2 mt-2 pt-3 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40 flex-shrink-0">
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIsCalendarAgendaOpen(false);
                }}
                className="px-4 py-2 bg-black border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white font-bold rounded"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Elegant Brutalist Bottom-Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-black border-2 border-[var(--color-accent,#DF5504)] px-4 py-3 text-white font-mono text-xs shadow-[4px_4px_0px_0px_#BCBCBC] z-[9999] flex items-center gap-3 animate-slideUp select-none">
          <span className="text-[14px]">🔔</span>
          <span className="font-bold tracking-wide">{toastMessage}</span>
          <button 
            onClick={async () => {
              await triggerHaptic();
              setToastMessage(null);
            }} 
            className="font-black hover:text-[var(--color-accent,#DF5504)] text-gray-400 pl-2 transition-colors cursor-pointer text-sm"
          >
            ×
          </button>
        </div>
      )}

    </div>
  );
}
