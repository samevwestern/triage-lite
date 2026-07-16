import { useState, useEffect, useRef } from 'react';
import { useCapacitor } from './hooks/useCapacitor';
import { config } from './factory-config';
import { CapacitorCalendar } from '@ebarooni/capacitor-calendar';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Camera, CameraResultType } from '@capacitor/camera';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';


export interface ChecklistItem {
  id: string;
  text: string;
  isChecked: boolean;
  dueDate?: number | null;
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

interface PomodoroPreset {
  label: string;
  minutes: number;
}

const POMODORO_PRESETS: Record<
  'dnd' | 'work' | 'personal' | 'sleep' | 'driving' | 'study',
  [PomodoroPreset, PomodoroPreset, PomodoroPreset]
> = {
  study: [
    { label: "Study (25m)", minutes: 25 },
    { label: "Short (5m)", minutes: 5 },
    { label: "Long (15m)", minutes: 15 }
  ],
  work: [
    { label: "Work (25m)", minutes: 25 },
    { label: "Short (5m)", minutes: 5 },
    { label: "Long (15m)", minutes: 15 }
  ],
  dnd: [
    { label: "Deep Work (50m)", minutes: 50 },
    { label: "Short (10m)", minutes: 10 },
    { label: "Long (30m)", minutes: 30 }
  ],
  personal: [
    { label: "Tasks (15m)", minutes: 15 },
    { label: "Short (3m)", minutes: 3 },
    { label: "Long (10m)", minutes: 10 }
  ],
  sleep: [
    { label: "Core Sleep (6h)", minutes: 6 * 60 },
    { label: "Full Sleep (8h)", minutes: 8 * 60 },
    { label: "Quick Nap (20m)", minutes: 20 }
  ],
  driving: [
    { label: "Safe Drive (45m)", minutes: 45 },
    { label: "Long Haul (2h)", minutes: 120 },
    { label: "Quick Pit (10m)", minutes: 10 }
  ]
};

export default function App() {
  const { isNative, getStorage, setStorage, triggerHaptic } = useCapacitor();
  const recognitionRef = useRef<any>(null);

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

  const fetchUpcomingCalendarEvents = async (rangeDays: number, startDateStr?: string) => {
    setIsCalendarLoading(true);
    try {
      const permission = await CapacitorCalendar.requestReadOnlyCalendarAccess();
      if (permission.result !== 'granted') {
        showToast("⚠️ Calendar permission denied!");
        setCalendarEvents([]);
        return;
      }

      // Calculate start epoch
      const activeStartStr = startDateStr !== undefined ? startDateStr : calendarStartDate;
      const baseDate = activeStartStr ? new Date(activeStartStr + 'T00:00:00') : new Date();
      const fromTime = baseDate.getTime();

      let toTime = fromTime;
      if (rangeDays === 0) {
        // Today / Single Day mode (24h period)
        toTime = fromTime + 24 * 60 * 60 * 1000 - 1000;
      } else {
        toTime = fromTime + rangeDays * 24 * 60 * 60 * 1000;
      }

      const response = await CapacitorCalendar.listEventsInRange({
        from: fromTime,
        to: toTime
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

  const startDictation = async () => {
    if (isNative) {
      try {
        const permission = await SpeechRecognition.requestPermissions();
        if (permission.speechRecognition !== 'granted') {
          showToast("⚠️ Permission denied for speech recognition!");
          return;
        }

        const { available } = await SpeechRecognition.available();
        if (!available) {
          showToast("⚠️ iOS Speech recognition is not available!");
          return;
        }

        setIsRecording(true);
        // Start offline on-device iOS AI speech recognition
        const result = await SpeechRecognition.start({
          language: 'en-US',
          partialResults: false,
          popup: false
        });

        if (result.matches && result.matches.length > 0) {
          const transcript = result.matches[0];
          if (transcript && transcript.trim() !== '') {
            const newLog = {
              id: 'log-' + Date.now(),
              timestamp: Date.now(),
              text: transcript.trim()
            };
            setVoiceLogs(prev => [newLog, ...prev]);
            showToast("🎙️ Captured On-Device iOS Voice Reflection!");
          }
        }
      } catch (error) {
        console.error("[SpeechRecognition] iOS Native error", error);
        showToast("⚠️ Speech recognition failed!");
      } finally {
        setIsRecording(false);
      }
    } else {
      // Standard browser fallback
      const WebSpeech = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!WebSpeech) {
        showToast("⚠️ Speech recognition not supported on this browser!");
        return;
      }

      try {
        const recognition = new WebSpeech();
        recognitionRef.current = recognition;
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
          setIsRecording(true);
        };

        recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          if (transcript && transcript.trim() !== '') {
            const newLog = {
              id: 'log-' + Date.now(),
              timestamp: Date.now(),
              text: transcript.trim()
            };
            setVoiceLogs(prev => [newLog, ...prev]);
            showToast("🎙️ Captured Voice Reflection!");
          }
        };

        recognition.onerror = (e: any) => {
          console.error("[WebSpeech] Recognition error", e);
          showToast("⚠️ Speech recognition failed!");
        };

        recognition.onend = () => {
          setIsRecording(false);
          recognitionRef.current = null;
        };

        recognition.start();
      } catch (error) {
        console.error("[WebSpeech] Web initialization error", error);
        showToast("⚠️ Speech recognition failed!");
        setIsRecording(false);
      }
    }
  };

  const stopDictation = async () => {
    if (isNative) {
      try {
        await SpeechRecognition.stop();
      } catch (error) {
        console.error("[SpeechRecognition] stop error", error);
      }
    } else {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (error) {
          console.error("[WebSpeech] stop error", error);
        }
      }
    }
    setIsRecording(false);
  };

  const dispatchLogToCard = (logId: string, cardId: string) => {
    const log = voiceLogs.find(l => l.id === logId);
    if (!log) return;

    setCards(prevCards => prevCards.map(card => {
      if (card.id === cardId) {
        const timeStr = new Date(log.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const annotation = `🎙️ [Voice Log - ${timeStr}] ${log.text}`;
        return {
          ...card,
          description: card.description ? `${card.description}\n\n${annotation}` : annotation
        };
      }
      return card;
    }));

    // Mark as assigned/dispatched
    setVoiceLogs(prev => prev.map(l => l.id === logId ? { ...l, assignedCardId: cardId } : l));
    showToast("📤 Dispatched Voice Log to Card!");
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

  const scheduleChecklistItemAlarm = async (cardTitle: string, item: ChecklistItem) => {
    if (!item.dueDate) return;
    try {
      const perm = await LocalNotifications.requestPermissions();
      if (perm.display !== 'granted') return;

      // Extract a unique numeric id from the item id, or use random fallback
      const numericId = parseInt(item.id.replace(/\D/g, '')) || Math.floor(Math.random() * 1000000) + 1000000;

      await LocalNotifications.schedule({
        notifications: [
          {
            id: numericId,
            title: "⏰ Checklist Alarm!",
            body: `Subtask "${item.text}" from card "${cardTitle}" is due now!`,
            schedule: { at: new Date(item.dueDate) },
            sound: 'default'
          }
        ]
      });
      console.log("[LocalNotifications] Checklist item alarm scheduled.");
    } catch (e) {
      console.error("[LocalNotifications] Failed to schedule checklist alarm", e);
    }
  };

  const cancelChecklistItemAlarm = async (item: ChecklistItem) => {
    try {
      const numericId = parseInt(item.id.replace(/\D/g, '')) || 0;
      if (numericId > 0) {
        await LocalNotifications.cancel({
          notifications: [{ id: numericId }]
        });
        console.log("[LocalNotifications] Checklist item alarm cancelled.");
      }
    } catch (e) {
      console.error("[LocalNotifications] Failed to cancel checklist alarm", e);
    }
  };


  // Load accent color dynamically from App Factory configuration
  useEffect(() => {
    document.documentElement.style.setProperty('--accent-color', config.accentColor);
  }, []);

  // Application State
  const [lists, setLists] = useState<List[]>([]);

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
  const [isAddingList, setIsAddingList] = useState(false);
  const [newListVal, setNewListVal] = useState('');
  const [draggedOverCardId, setDraggedOverCardId] = useState<string | null>(null);
  const [isSessionLogOpen, setIsSessionLogOpen] = useState(false);
  
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isNotificationStudioOpen, setIsNotificationStudioOpen] = useState(false);
  const [isCalendarAgendaOpen, setIsCalendarAgendaOpen] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
  const [calendarRangeDays, setCalendarRangeDays] = useState<number>(30);
  const [calendarFilterType, setCalendarFilterType] = useState<'all' | 'triage' | 'diary' | 'receipts'>('all');
  const [calendarStartDate, setCalendarStartDate] = useState<string>(() => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });
  const [isCalendarLoading, setIsCalendarLoading] = useState<boolean>(false);

  // Verbal Diary States
  const [isDiaryOpen, setIsDiaryOpen] = useState(false);
  const [voiceLogs, setVoiceLogs] = useState<{
    id: string;
    timestamp: number;
    text: string;
    assignedCardId?: string;
  }[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [showDiaryHelp, setShowDiaryHelp] = useState(false);
  const [typedDiaryText, setTypedDiaryText] = useState('');

  // Receipts / Expenditures States
  const [isReceiptsOpen, setIsReceiptsOpen] = useState(false);
  const [receipts, setReceipts] = useState<{
    id: string;
    timestamp: number;
    imageUrl: string;
    merchant: string;
    amount: number;
    notes?: string;
  }[]>([]);
  const [isCapturingReceipt, setIsCapturingReceipt] = useState(false);
  const [showReceiptsHelp, setShowReceiptsHelp] = useState(false);
  const [showCalendarHelp, setShowCalendarHelp] = useState(false);
  const [isDashboardHelpOpen, setIsDashboardHelpOpen] = useState(false);
  const [isCardHelpOpen, setIsCardHelpOpen] = useState(false);
  const [isAlertsHelpOpen, setIsAlertsHelpOpen] = useState(false);
  const [isAlertStudioHelpOpen, setIsAlertStudioHelpOpen] = useState(false);
  const [isDocsHelpOpen, setIsDocsHelpOpen] = useState(false);
  const [isDocStudioOpen, setIsDocStudioOpen] = useState(false);
  const [isTimerModalOpen, setIsTimerModalOpen] = useState(false);
  const [showTimerHelp, setShowTimerHelp] = useState(false);
  const [pomodoroTimeLeft, setPomodoroTimeLeft] = useState(25 * 60); // 25 mins
  const [isPomodoroRunning, setIsPomodoroRunning] = useState(false);
  const [pomodoroSelectedFocusMode, setPomodoroSelectedFocusMode] = useState<'dnd' | 'work' | 'personal' | 'sleep' | 'driving' | 'study'>('study');
  const [pomodoroEnableNotifications, setPomodoroEnableNotifications] = useState(true);
  const [pomodoroEnableHaptics, setPomodoroEnableHaptics] = useState(true);
  const [pomodoroEnableTimeSensitive, setPomodoroEnableTimeSensitive] = useState(true);
  const [checklistItemAlarmEditingId, setChecklistItemAlarmEditingId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const formatPomodoroTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hrs > 0) {
      return (
        <>
          {hrs}
          <span className={isPomodoroRunning ? "animate-ping inline-block mx-0.5 text-inherit" : "mx-0.5"}>:</span>
          {String(mins).padStart(2, '0')}
          <span className={isPomodoroRunning ? "animate-ping inline-block mx-0.5 text-inherit" : "mx-0.5"}>:</span>
          {String(secs).padStart(2, '0')}
        </>
      );
    }
    return (
      <>
        {String(mins).padStart(2, '0')}
        <span className={isPomodoroRunning ? "animate-ping inline-block mx-0.5 text-inherit" : "mx-0.5"}>:</span>
        {String(secs).padStart(2, '0')}
      </>
    );
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
  const [showLabelHelp, setShowLabelHelp] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelFormText, setLabelFormText] = useState('');
  const [labelFormColor, setLabelFormColor] = useState('#DF5504');



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
      const savedCards = await getStorage(storageKeyCards);
      if (savedCards) setCards(JSON.parse(savedCards));

      const storageKeyLists = `factory_app_${config.id}_lists`;
      const savedLists = await getStorage(storageKeyLists);
      if (savedLists) {
        setLists(JSON.parse(savedLists));
      } else {
        const defaultLists = [
          { id: 'todo', name: 'To Do' },
          { id: 'progress', name: 'In Progress' },
          { id: 'done', name: 'Completed' }
        ];
        setLists(defaultLists);
        await syncData(storageKeyLists, defaultLists);
      }
    };
    loadSavedData();
  }, []);

  // Saving state on changes
  const saveCards = async (newCards: Card[]) => {
    setCards(newCards);
    await syncData(`factory_app_${config.id}_cards`, newCards);
  };

  const saveLists = async (newLists: List[]) => {
    setLists(newLists);
    await syncData(`factory_app_${config.id}_lists`, newLists);
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

  // Standalone Global Pomodoro Timer Thread (Fully Separated)
  useEffect(() => {
    let interval: any = null;
    if (isPomodoroRunning && pomodoroTimeLeft > 0) {
      interval = setInterval(() => {
        setPomodoroTimeLeft(prev => {
          if (prev <= 1) {
            setIsPomodoroRunning(false);
            if (pomodoroEnableHaptics) {
              triggerHaptic();
            }
            showToast("🍅 Pomodoro session finished!");
            
            // Native capacitor push notification
            if (isNative && pomodoroEnableNotifications) {
              const focusLabels: Record<string, string> = {
                dnd: "🔇 Do Not Disturb Focus",
                work: "💼 Work Focus",
                personal: "🏠 Personal Focus",
                sleep: "🛌 Sleep Focus",
                driving: "🚗 Driving Focus",
                study: "📚 Study Focus"
              };
              const label = focusLabels[pomodoroSelectedFocusMode] || "Pomodoro";

              LocalNotifications.schedule({
                notifications: [{
                  title: `🍅 ${label} Complete!`,
                  body: "Focus interval complete! Great work.",
                  id: 888,
                  schedule: { at: new Date(Date.now() + 100) },
                  interruptionLevel: pomodoroEnableTimeSensitive ? 'timeSensitive' : 'active'
                }]
              }).catch(err => console.error("Pomodoro notification error", err));
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPomodoroRunning, pomodoroTimeLeft, pomodoroEnableHaptics, pomodoroEnableNotifications, pomodoroEnableTimeSensitive, pomodoroSelectedFocusMode]);

  // Handlers

  const handleMoveCard = async (cardId: string, nextListId: string) => {
    await triggerHaptic();
    setCards(prevCards => {
      const targetCard = prevCards.find(c => c.id === cardId);
      if (!targetCard) return prevCards;

      const updatedCard = { 
        ...targetCard, 
        listId: nextListId,
        completedAt: nextListId === 'done' ? Date.now() : null
      };

      const withoutCard = prevCards.filter(c => c.id !== cardId);
      const updated = [...withoutCard, updatedCard];

      syncData(`factory_app_${config.id}_cards`, updated);
      return updated;
    });
  };

  const handleMovePosition = async (cardId: string, direction: 'up' | 'down') => {
    await triggerHaptic();
    setCards(prevCards => {
      const targetCard = prevCards.find(c => c.id === cardId);
      if (!targetCard) return prevCards;

      const listId = targetCard.listId;
      const listCards = prevCards.filter(c => c.listId === listId);
      const cardIdxInList = listCards.findIndex(c => c.id === cardId);

      if (direction === 'up' && cardIdxInList === 0) return prevCards;
      if (direction === 'down' && cardIdxInList === listCards.length - 1) return prevCards;

      const swapWithIdx = direction === 'up' ? cardIdxInList - 1 : cardIdxInList + 1;
      const swapWithCard = listCards[swapWithIdx];

      const targetAbsIdx = prevCards.findIndex(c => c.id === cardId);
      const swapWithAbsIdx = prevCards.findIndex(c => c.id === swapWithCard.id);

      const updated = [...prevCards];
      const temp = updated[targetAbsIdx];
      updated[targetAbsIdx] = updated[swapWithAbsIdx];
      updated[swapWithAbsIdx] = temp;

      syncData(`factory_app_${config.id}_cards`, updated);
      return updated;
    });
  };

  const handleReorderCard = async (draggedId: string, targetId: string) => {
    await triggerHaptic();
    setCards(prevCards => {
      const draggedCard = prevCards.find(c => c.id === draggedId);
      const targetCard = prevCards.find(c => c.id === targetId);
      if (!draggedCard || !targetCard) return prevCards;

      const updatedDragged = { 
        ...draggedCard, 
        listId: targetCard.listId,
        completedAt: targetCard.listId === 'done' ? Date.now() : null
      };

      const withoutDragged = prevCards.filter(c => c.id !== draggedId);
      const targetIndex = withoutDragged.findIndex(c => c.id === targetId);

      const reordered = [...withoutDragged];
      reordered.splice(targetIndex, 0, updatedDragged);

      syncData(`factory_app_${config.id}_cards`, reordered);
      return reordered;
    });
  };

  const handleToggleChecklistItem = async (cardId: string, checklistId: string, itemId: string) => {
    await triggerHaptic();
    setCards(prevCards => {
      const updated = prevCards.map(c => {
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
      syncData(`factory_app_${config.id}_cards`, updated);
      return updated;
    });
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
      <header className="flex flex-col gap-3.5 border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-4 mb-6">
        {/* Row 1: App Title & Tools Deck aligned side-by-side, plus the Runbook Help icon on the far right */}
        <div className="flex justify-between items-center w-full">
          <div className="flex items-center gap-3 sm:gap-4 overflow-x-auto no-scrollbar">
            <h1 className="text-xl sm:text-2xl font-black uppercase text-white tracking-wider flex-shrink-0">
              {config.name}
            </h1>

            {/* Global Action Icons Deck (Sitting directly to the right of the Triage Lite label) */}
            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              <button
                onClick={async () => {
                  await triggerHaptic();
                  setIsCalendarAgendaOpen(true);
                  await fetchUpcomingCalendarEvents(calendarRangeDays);
                }}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white flex items-center justify-center text-xs sm:text-sm font-black transition-colors"
                title="Calendar Agenda"
              >
                📅
              </button>

              <button
                onClick={async () => {
                  await triggerHaptic();
                  setIsDiaryOpen(true);
                }}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white flex items-center justify-center text-xs sm:text-sm font-black transition-colors"
                title="Verbal Diary"
              >
                📔
              </button>

              <button
                onClick={async () => {
                  await triggerHaptic();
                  setIsReceiptsOpen(true);
                }}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white flex items-center justify-center text-xs sm:text-sm font-black transition-colors"
                title="Business Receipts"
              >
                🧾
              </button>

              <button
                onClick={async () => {
                  await triggerHaptic();
                  setIsTimerModalOpen(true);
                }}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white flex items-center justify-center text-xs sm:text-sm font-black transition-colors"
                title="Pomodoro Study Timer"
              >
                🍅
              </button>

              <button
                onClick={async () => {
                  await triggerHaptic();
                  setIsSessionLogOpen(true);
                }}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white flex items-center justify-center text-xs sm:text-sm font-black transition-colors"
                title="Session Time Logs"
              >
                📊
              </button>

              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  document.getElementById('global-file-picker')?.click();
                }}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white flex items-center justify-center text-xs sm:text-sm font-black transition-colors cursor-pointer"
                title="Open File Picker"
              >
                📂
              </button>
            </div>
          </div>

          <button
            onClick={async () => {
              await triggerHaptic();
              setIsDashboardHelpOpen(true);
            }}
            className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white flex items-center justify-center text-[10px] font-black transition-colors cursor-pointer flex-shrink-0"
            title="Dashboard Runbook"
          >
            ❓
          </button>
        </div>

        {/* Row 2: Menu Toggle (Placed directly under the Triage Lite label on the left side) */}
        <div className="flex justify-start w-full">
          <button 
            onClick={async () => {
              await triggerHaptic();
              setIsMenuOpen(!isMenuOpen);
            }}
            className="text-[9px] sm:text-[10px] leading-none px-2 py-1.5 sm:px-2.5 bento-btn text-white uppercase font-black rounded-sm tracking-wide flex items-center gap-1 cursor-pointer"
          >
            {isMenuOpen ? '✕ Close' : '☰ Menu'}
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
        <div className="grid grid-cols-1 gap-6 flex-grow items-start">
        
        {/* COL 1 & 2: THE BRUTAL KANBAN BOARD */}
        <div className="w-full grid grid-cols-1 gap-4">
          
          {/* UNIVERSAL COLUMN NAVIGATION SUBHEADER */}
          <div className="flex justify-between items-center p-2.5 bento-box mb-4 font-mono text-xs gap-3 w-full">
            <div className="flex items-center gap-2">
              <button 
                onClick={async () => {
                  await triggerHaptic();
                  const newCard: Card = {
                    id: 'card-' + Date.now(),
                    listId: lists[activeColumnIndex]?.id || 'todo',
                    title: '',
                    description: '',
                    timeSpent: 0,
                    labelIds: [],
                    checklists: [
                      {
                        id: 'cl-' + Date.now(),
                        items: []
                      }
                    ],
                    dueDate: null,
                    completedAt: null
                  };
                  setSelectedCardForEdit(newCard);
                }}
                className="w-8 h-8 rounded-full bento-btn text-white flex items-center justify-center text-lg font-black transition-all"
                title="Quick-Add Card"
              >
                ＋
              </button>

              {isAddingList ? (
                <form 
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const val = newListVal.trim();
                    if (val) {
                      await triggerHaptic();
                      const newId = `list-${Date.now()}`;
                      const newList = { id: newId, name: val };
                      await saveLists([...lists, newList]);
                      setNewListVal('');
                      setIsAddingList(false);
                    }
                  }}
                  className="flex items-center gap-1 bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] p-0.5 rounded-full pr-1.5 transition-all"
                >
                  <input 
                    type="text"
                    placeholder="New list..."
                    value={newListVal}
                    onChange={(e) => setNewListVal(e.target.value)}
                    className="px-2.5 py-1 bg-transparent text-white text-[11px] font-mono outline-none w-24 sm:w-36"
                    autoFocus
                  />
                  <button 
                    type="submit" 
                    className="w-5 h-5 rounded-full bg-[var(--color-accent,#DF5504)] text-white font-bold flex items-center justify-center text-[10px] uppercase hover:opacity-90 active:scale-95 transition-all"
                  >
                    ✓
                  </button>
                  <button 
                    type="button" 
                    onClick={() => {
                      setNewListVal('');
                      setIsAddingList(false);
                    }}
                    className="w-5 h-5 rounded-full bg-transparent hover:bg-white/10 text-gray-400 hover:text-white flex items-center justify-center text-xs font-mono transition-colors"
                  >
                    ×
                  </button>
                </form>
              ) : (
                <button 
                  onClick={async () => {
                    await triggerHaptic();
                    setIsAddingList(true);
                  }}
                  className="h-8 px-2.5 rounded-full bento-btn text-white flex items-center justify-center gap-1 text-[11px] font-bold uppercase transition-all"
                  title="Add Custom List"
                >
                  📋＋
                </button>
              )}
            </div>

            {/* Custom Interactive Swipe Pagination Dots & Column Indicators */}
            <div className="flex items-center gap-2 pr-1.5">
              <div className="flex items-center gap-1.5">
                {lists.map((list, idx) => (
                  <button 
                    key={list.id} 
                    onClick={async () => {
                      await triggerHaptic();
                      setActiveColumnIndex(idx);
                      // Smooth scroll container to focus column if in horizontal layout
                      const container = document.getElementById('board-columns-container');
                      if (container) {
                        const isMobile = window.innerWidth < 640; // Tailwind 'sm' threshold
                        if (isMobile) {
                          const colWidth = container.clientWidth * 0.9;
                          container.scrollTo({ left: idx * colWidth, behavior: 'smooth' });
                        }
                      }
                    }}
                    className={`w-2.5 h-2.5 rounded-full transition-all duration-300 border-none outline-none cursor-pointer ${idx === activeColumnIndex ? 'bg-[var(--color-accent,#DF5504)] scale-125' : 'bg-gray-600 hover:bg-gray-400'}`}
                    title={`Focus ${list.name}`}
                  />
                ))}
              </div>
              <span className="text-[10px] font-black text-white uppercase tracking-wider pl-1 font-mono">
                {lists[activeColumnIndex]?.name}
              </span>
            </div>
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
             className="flex flex-row overflow-x-auto gap-4 pb-6 scroll-smooth snap-x snap-mandatory items-start w-full"
          >
            {lists.map((list) => {
              const isActive = lists[activeColumnIndex]?.id === list.id;
              return (
                <div 
                  key={list.id} 
                  onClick={async () => {
                    const idx = lists.findIndex(l => l.id === list.id);
                    if (idx !== activeColumnIndex) {
                      await triggerHaptic();
                      setActiveColumnIndex(idx);
                    }
                  }}
                  className={`flex-shrink-0 w-[85vw] sm:w-[320px] snap-center snap-always p-3 bento-box transition-all cursor-pointer ${
                    isActive 
                      ? 'border-[var(--color-accent,#DF5504)] shadow-[4px_4px_0px_0px_rgba(223,85,4,0.15)] bg-[var(--color-dark-secondary,#333333)]/70' 
                      : 'border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white/20'
                  }`}
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
                  <div className="flex justify-between items-center w-full">
                    <h3 className="font-black text-sm uppercase text-white tracking-wide">
                      {list.name}
                    </h3>
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await triggerHaptic();
                        setIsDashboardHelpOpen(true);
                      }}
                      className="w-5 h-5 rounded-full bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white flex items-center justify-center text-[8px] font-black transition-colors cursor-pointer"
                      title={`${list.name} Runbook`}
                    >
                      ❓
                    </button>
                  </div>
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
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (draggedOverCardId !== card.id) {
                          setDraggedOverCardId(card.id);
                        }
                      }}
                      onDragLeave={() => {
                        if (draggedOverCardId === card.id) {
                          setDraggedOverCardId(null);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDraggedOverCardId(null);
                        const draggedId = e.dataTransfer.getData('text/plain');
                        if (draggedId && draggedId !== card.id) {
                          handleReorderCard(draggedId, card.id);
                        }
                      }}
                      onDragEnd={() => {
                        setDraggedOverCardId(null);
                      }}
                      onClick={() => setSelectedCardForEdit(card)}
                      className={`p-3 bento-box bento-box-interactive flex flex-col justify-between cursor-move transition-all duration-150 active:opacity-50 ${
                        draggedOverCardId === card.id 
                          ? 'border-2 border-[var(--color-accent,#DF5504)] bg-black/40 scale-[1.01] shadow-[0_0_12px_rgba(223,85,4,0.3)]' 
                          : 'border-2 border-[#4C4C4C] hover:border-[var(--color-accent,#DF5504)]'
                      }`}
                    >
                      <div>
                        <h4 className="font-bold text-sm text-white">{card.title}</h4>
                        
                        {/* Labels Render (Under Title, Above Description) */}
                        {card.labelIds && card.labelIds.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 my-1.5">
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

                        <p className="text-xs text-[#8892b0] font-mono">{card.description}</p>
                        
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
                        <div 
                          className="relative" 
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          onDragStart={(e) => e.stopPropagation()}
                        >
                          <select
                            value=""
                            onChange={async (e) => {
                              const val = e.target.value;
                              if (val === 'move-up') {
                                await handleMovePosition(card.id, 'up');
                              } else if (val === 'move-down') {
                                await handleMovePosition(card.id, 'down');
                              } else if (val) {
                                console.log('Moving card', card.id, 'to list', val);
                                await triggerHaptic();
                                handleMoveCard(card.id, val);
                              }
                            }}
                            className="text-[10px] bento-btn bg-[var(--color-accent,#DF5504)] text-white px-2 py-1 font-bold uppercase rounded cursor-pointer border-2 border-[#E96213] shadow-[2px_2px_0px_0px_rgba(223,85,4,0.3)] hover:translate-y-[-0.5px] active:translate-y-[0.5px] transition-transform select-none outline-none font-sans appearance-none pr-5 relative"
                            style={{
                              backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 10 6'><path fill='white' d='M0 0l5 5 5-5z'/></svg>")`,
                              backgroundRepeat: 'no-repeat',
                              backgroundPosition: 'right 6px center',
                              backgroundSize: '8px 5px'
                            }}
                          >
                            <option value="" disabled hidden>
                              Move ▼
                            </option>
                            <option value="move-up" className="text-white bg-[#282828] font-bold font-mono text-[10px]">
                              ▲ MOVE UP
                            </option>
                            <option value="move-down" className="text-white bg-[#282828] font-bold font-mono text-[10px]">
                              ▼ MOVE DOWN
                            </option>
                            <option value="" disabled className="text-gray-500 bg-[#282828] font-bold font-mono text-[10px]">
                              ──────────────
                            </option>
                            {lists.map(l => (
                              <option key={l.id} value={l.id} className="text-white bg-[#282828] font-bold font-mono text-[10px]">
                                TO: {l.name.toUpperCase()}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}


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
              <h3 className="font-black text-sm uppercase tracking-wider text-[var(--color-accent,#DF5504)] flex items-center gap-1.5">
                🏷 Board Label Studio
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    setShowLabelHelp(!showLabelHelp);
                  }}
                  className={`w-6 h-6 rounded-full border flex items-center justify-center font-bold text-xs transition-all cursor-pointer ${
                    showLabelHelp
                      ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                      : 'bg-black/40 hover:bg-black/80 border-[var(--color-dark-tertiary,#3D3D3D)] text-gray-300'
                  }`}
                  title="Label Studio Guide"
                >
                  ❓
                </button>
                <button 
                  onClick={async () => {
                    await triggerHaptic();
                    setIsGlobalLabelModalOpen(false);
                    setShowLabelHelp(false);
                  }}
                  className="text-gray-400 hover:text-white font-black text-lg cursor-pointer"
                >
                  &times;
                </button>
              </div>
            </div>

            {/* ℹ️ Sliding Label Runbook Info Panel */}
            {showLabelHelp && (
              <div className="bg-black/80 border border-[var(--color-accent,#DF5504)]/40 p-3.5 rounded-lg flex flex-col gap-2 max-h-[30vh] overflow-y-auto animate-fadeIn text-[10px] text-gray-300 font-mono">
                <span className="font-black text-[10px] text-[var(--color-accent,#DF5504)] uppercase tracking-widest">💡 Board Classification Runbook</span>
                <p className="leading-relaxed font-bold text-gray-400">
                  Board labels allow you to categorize and instantly filter task cards on your Kanban list columns:
                </p>
                <ul className="list-disc pl-4 flex flex-col gap-1 leading-relaxed text-gray-400">
                  <li><span className="text-white">🏷️ Categories</span>: Create tags like `URGENT`, `WEEKLY`, or `PERSONAL` to isolate tasks.</li>
                  <li><span className="text-white">🎨 Palettes</span>: Assign highly distinct neon, primary, or monochrome colors for visual cues.</li>
                  <li><span className="text-white">✨ Assignment</span>: Choose labels inside any card detailed edit panel to flag active categories.</li>
                </ul>
              </div>
            )}

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
                            const filteredLabels = labels.filter(l => l.id !== lbl.id);
                            setLabels(filteredLabels);
                            syncData(`factory_app_${config.id}_labels`, filteredLabels);

                            setCards(prevCards => {
                              const updated = prevCards.map(c => ({
                                ...c,
                                labelIds: c.labelIds?.filter(id => id !== lbl.id) || []
                              }));
                              syncData(`factory_app_${config.id}_cards`, updated);
                              return updated;
                            });
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
              <div className="flex justify-between items-center">
                <h3 className="font-black text-xs font-mono uppercase tracking-wider text-gray-400">
                  Card details
                </h3>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={async () => {
                      await triggerHaptic();
                      setIsCardHelpOpen(!isCardHelpOpen);
                    }}
                    className={`w-6 h-6 rounded-full border flex items-center justify-center font-bold text-[9px] transition-all cursor-pointer ${
                      isCardHelpOpen
                        ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                        : 'bg-black/40 border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white'
                    }`}
                    title="Card Help Guide"
                  >
                    ❓
                  </button>

                  <button 
                    onClick={() => {
                      setSelectedCardForEdit(null);
                      setIsLabelManagerOpen(false);
                      setIsCardHelpOpen(false);
                    }}
                    className="text-gray-400 hover:text-white font-black text-lg p-1 border-none bg-transparent cursor-pointer"
                  >
                    &times;
                  </button>
                </div>
              </div>

              {/* Dynamic Interactive Card Help Panel */}
              {isCardHelpOpen && (
                <div className="mt-2.5 p-3 bento-box border-l-4 border-l-[var(--color-accent,#DF5504)] bg-black/40 font-mono text-[9px] leading-relaxed flex flex-col gap-2 animate-fadeIn text-left">
                  <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-1 w-full">
                    <span className="font-black uppercase tracking-wider text-[var(--color-accent,#DF5504)] text-[9px]">
                      📋 Card Edit Suite Runbook
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsCardHelpOpen(false)}
                      className="text-[8px] text-gray-400 hover:text-white uppercase font-black border-none bg-transparent cursor-pointer"
                    >
                      ✕ Close
                    </button>
                  </div>
                  
                  <div className="flex flex-col gap-1.5 text-gray-300">
                    <div className="flex gap-2 items-start">
                      <span className="select-none">🏷️</span>
                      <span><strong className="text-white">LABEL MANAGER</strong>: Classify card targets with neon tags from the board's Custom Label Studio.</span>
                    </div>
                    <div className="flex gap-2 items-start">
                      <span className="select-none">📝</span>
                      <span><strong className="text-white">TASK SUMMARY</strong>: Write main titles and context summaries. (Empty descriptions block edits with a toast alarm).</span>
                    </div>
                    <div className="flex gap-2 items-start">
                      <span className="select-none">⏱️</span>
                      <span><strong className="text-white">POMODORO TIMER</strong>: Track study hours and count seconds.</span>
                    </div>
                    <div className="flex gap-2 items-start">
                      <span className="select-none">📅</span>
                      <span><strong className="text-white">DEADLINE & TIME</strong>: Target milestones with clear uppercase deadline limits.</span>
                    </div>
                    <div className="flex gap-2 items-start">
                      <span className="select-none">📚</span>
                      <span><strong className="text-white">RESEARCH CITATIONS</strong>: Log academic bibliography sources. (URLs and descriptions require each other).</span>
                    </div>
                    <div className="flex gap-2 items-start">
                      <span className="select-none">🌐</span>
                      <span><strong className="text-white">CLOUD DRIVES</strong>: Connect iCloud/OneDrive/GDrive directories with full validation checks.</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Inputs */}
            <div className="flex flex-col gap-4">
              {/* Active Focus Session Widget */}
              <div className="p-2.5 bg-[var(--color-dark-bg,#282828)] border border-[var(--color-accent,#DF5504)] rounded flex justify-between items-center font-mono text-xs shadow-[2px_2px_0px_0px_var(--color-accent,#DF5504)] animate-pulse">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">⏱️ SESSION TIME</span>
                <div className="text-[11px] font-black text-[var(--color-accent,#DF5504)]">
                  {Math.floor((selectedCardForEdit.timeSpent || 0) / 3600)}h {Math.floor(((selectedCardForEdit.timeSpent || 0) % 3600) / 60)}m {((selectedCardForEdit.timeSpent || 0) % 60)}s
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  <label className="block text-xs font-mono font-bold uppercase text-gray-400 mb-1">List</label>
                  <select
                    value={selectedCardForEdit.listId}
                    onChange={(e) => setSelectedCardForEdit({ ...selectedCardForEdit, listId: e.target.value })}
                    className="w-full bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 text-sm font-mono text-white focus:border-[var(--color-accent,#DF5504)] rounded h-[38px] cursor-pointer"
                  >
                    {lists.map(l => (
                      <option key={l.id} value={l.id} className="text-white bg-[#282828] font-bold font-mono">
                        {l.name.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Active Labels List Display (Under Title, Above Description) */}
              {selectedCardForEdit.labelIds && selectedCardForEdit.labelIds.map(id => labels.find(l => l.id === id)).filter(Boolean).length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 min-h-[22px] -mt-1">
                  {selectedCardForEdit.labelIds.map(labelId => {
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
                </div>
              )}

              <div>
                <label className="block text-xs font-mono font-bold uppercase text-gray-400 mb-1">Description</label>
                <textarea 
                  value={selectedCardForEdit.description || ''}
                  onChange={(e) => setSelectedCardForEdit({ ...selectedCardForEdit, description: e.target.value })}
                  className="w-full h-20 bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 text-sm font-mono text-white focus:border-[var(--color-accent,#DF5504)] rounded"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <button
                    type="button"
                    onClick={async () => {
                      await triggerHaptic();
                      setIsNotificationStudioOpen(true);
                    }}
                    className="text-xs font-mono font-bold uppercase text-gray-400 hover:text-white flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer transition-colors"
                    title="Open Alerts & Tasks Alarm Studio"
                  >
                    <span>📋 Checklist & Tasks</span>
                    <span className="text-[10px] text-[var(--color-accent,#DF5504)] font-black">⚙️</span>
                  </button>
                </div>
                
                {/* Drag-resizable and scrollable checklist viewport container */}
                <div className="w-full resize-y overflow-auto min-h-[120px] h-36 bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 rounded flex flex-col focus-within:border-[var(--color-accent,#DF5504)] transition-all">
                  <div className="flex-grow flex flex-col gap-1.5 overflow-y-auto pr-1">
                    {/* Inline Task Creator Row (Dynamic '+' Row) - Now positioned at the very top */}
                    <div className="flex items-center gap-2 bg-black/10 border border-dashed border-[var(--color-dark-tertiary,#3D3D3D)]/40 p-1.5 rounded font-mono text-[11px] focus-within:border-[var(--color-accent,#DF5504)] focus-within:bg-black/20 transition-all mb-1.5">
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

                    {/* Render active tasks - Sorted so incomplete/active tasks come first */}
                    {(() => {
                      const sortedChecklistItems = selectedCardForEdit.checklists?.[0]?.items 
                        ? [...selectedCardForEdit.checklists[0].items].sort((a, b) => (a.isChecked ? 1 : 0) - (b.isChecked ? 1 : 0))
                        : [];
                      
                      return sortedChecklistItems.map(item => {
                        const isEditing = editingTaskId === item.id;
                        return (
                          <div key={item.id} className="flex flex-col gap-1.5 bg-black/20 hover:bg-black/35 border border-[var(--color-dark-tertiary,#3D3D3D)]/40 p-1.5 rounded font-mono text-[11px]">
                            <div className="flex justify-between items-center gap-2">
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
                              <div className="flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity flex-shrink-0">
                                {!isEditing && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await triggerHaptic();
                                      setEditingTaskId(item.id);
                                      setEditingTaskText(item.text);
                                    }}
                                    className="text-gray-400 hover:text-white font-mono text-[10px] transition-colors cursor-pointer"
                                    title="Rename subtask"
                                  >
                                    ✏️
                                  </button>
                                )}

                                {/* ⏰ Checklist Alarm Toggle Button */}
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await triggerHaptic();
                                    if (checklistItemAlarmEditingId === item.id) {
                                      setChecklistItemAlarmEditingId(null);
                                    } else {
                                      setChecklistItemAlarmEditingId(item.id);
                                    }
                                  }}
                                  className={`font-mono text-[10px] transition-colors cursor-pointer ${
                                    item.dueDate ? 'text-[var(--color-accent,#DF5504)] font-black' : 'text-gray-400 hover:text-white'
                                  }`}
                                  title={item.dueDate ? "Change checklist alarm" : "Schedule checklist alarm"}
                                >
                                  {item.dueDate ? '⏰' : '🔔'}
                                </button>

                                <button
                                  type="button"
                                  onClick={async () => {
                                    await triggerHaptic();
                                    if (item.dueDate) {
                                      await cancelChecklistItemAlarm(item);
                                    }
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
                                  className="text-red-500 hover:text-red-400 font-bold transition-colors cursor-pointer"
                                  title="Delete subtask"
                                >
                                  🗑️
                                </button>
                              </div>
                            </div>

                            {/* Render Scheduled Alarm Text Badge */}
                            {item.dueDate && (
                              <div className="flex items-center justify-between text-[9px] text-[var(--color-accent,#DF5504)] font-bold pl-5 font-mono select-none">
                                <span className="flex items-center gap-1">
                                  ⏰ Alarm: {new Date(item.dueDate).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                </span>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await triggerHaptic();
                                    await cancelChecklistItemAlarm(item);
                                    const updatedChecklists = selectedCardForEdit.checklists?.map((cl, idx) => {
                                      if (idx === 0) {
                                        return {
                                          ...cl,
                                          items: cl.items.map(it => it.id === item.id ? { ...it, dueDate: undefined } : it)
                                        };
                                      }
                                      return cl;
                                    }) || [];
                                    setSelectedCardForEdit({ ...selectedCardForEdit, checklists: updatedChecklists });
                                    showToast("🗑️ Checklist alarm removed!");
                                  }}
                                  className="text-gray-500 hover:text-white font-black pl-2 border-none bg-transparent cursor-pointer"
                                  title="Remove alarm"
                                >
                                  ✕
                                </button>
                              </div>
                            )}

                            {/* 📅 Inline Checklist Item Datetime Picker Drawer */}
                            {checklistItemAlarmEditingId === item.id && (
                              <div className="pl-5 mt-1 pb-1 flex flex-col gap-1.5 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/30 pt-1.5 animate-fadeIn text-left">
                                <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Configure Sub-Task Alarm</span>
                                <div className="flex items-center gap-1.5 w-full">
                                  <input
                                    type="datetime-local"
                                    value={formatTimestampToDatetimeLocal(item.dueDate)}
                                    onChange={async (e) => {
                                      const parsed = e.target.value ? Date.parse(e.target.value) : null;
                                      const updatedChecklists = selectedCardForEdit.checklists?.map((cl, idx) => {
                                        if (idx === 0) {
                                          return {
                                            ...cl,
                                            items: cl.items.map(it => it.id === item.id ? { ...it, dueDate: parsed } : it)
                                          };
                                        }
                                        return cl;
                                      }) || [];
                                      setSelectedCardForEdit({ ...selectedCardForEdit, checklists: updatedChecklists });
                                    }}
                                    className="flex-grow bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] px-1.5 py-1 text-[9px] text-white rounded font-mono focus:border-[var(--color-accent,#DF5504)]"
                                  />
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await triggerHaptic();
                                      if (item.dueDate) {
                                        await scheduleChecklistItemAlarm(selectedCardForEdit.title, item);
                                        showToast("⏰ Sub-task alarm scheduled!");
                                      }
                                      setChecklistItemAlarmEditingId(null);
                                    }}
                                    className="px-2 py-1 bento-btn text-white text-[9px] font-bold uppercase rounded cursor-pointer"
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>

              {/* Date Row (Datetime-Local upgrade) */}
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-xs font-mono font-bold uppercase text-gray-400 mb-1">Deadline & Time</label>
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
              <div className="flex gap-2 items-center mt-2.5 w-full">
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    setIsAlertsHelpOpen(!isAlertsHelpOpen);
                  }}
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer flex-shrink-0 bg-[#222222] border-2 border-[#2C2C2C] shadow-[3px_3px_0px_0px_#A2A2A2] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#A2A2A2] active:translate-y-[1px] active:shadow-[1px_1px_0px_0px_#A2A2A2]"
                  title="Alerts Guide"
                >
                  <span className="text-red-500 font-extrabold text-base">?</span>
                </button>

                <button 
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    setIsNotificationStudioOpen(true);
                  }}
                  className="flex-grow h-10 sm:h-11 text-xs font-mono font-black tracking-wider uppercase flex items-center justify-center gap-2 rounded-lg transition-all bg-[#DF5504] border-2 border-[#E96213] text-white shadow-[3px_3px_0px_0px_#A2A2A2] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#A2A2A2] active:translate-y-[1px] active:shadow-[1px_1px_0px_0px_#A2A2A2] cursor-pointer"
                >
                  <span>Configure Alerts & Notifications</span>
                </button>
              </div>

              {/* Expandable Notification Help Info Block */}
              {isAlertsHelpOpen && (
                <div className="mt-2.5 p-3.5 bento-box border-l-4 border-l-[var(--color-accent,#DF5504)] bg-black/40 font-mono text-[9px] leading-relaxed flex flex-col gap-2 text-left animate-fadeIn">
                  <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-1 w-full">
                    <span className="font-black uppercase tracking-wider text-[var(--color-accent,#DF5504)] text-[9px]">
                      ⏰ Alert Notifications Guide
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsAlertsHelpOpen(false)}
                      className="text-[8px] text-gray-400 hover:text-white uppercase font-black border-none bg-transparent cursor-pointer"
                    >
                      ✕ Close
                    </button>
                  </div>
                  
                  <div className="flex flex-col gap-1.5 text-gray-300">
                    <div className="flex gap-2 items-start">
                      <span className="select-none">📌</span>
                      <span><strong className="text-white">DUE DATE TRIGGER</strong>: Notifications are calculated and anchored directly based on your configured Due Date & Time. You must assign a Due Date first to unlock alert options.</span>
                    </div>
                    <div className="flex gap-2 items-start">
                      <span className="select-none">🔔</span>
                      <span><strong className="text-white">CAPACITOR LOCAL PUSH ALERTS</strong>: Uses native device push notification schedulers so that tactile alerts fire even when your screen is locked or the app is closed.</span>
                    </div>
                    <div className="flex gap-2 items-start">
                      <span className="select-none">⏳</span>
                      <span><strong className="text-white">CHOOSE REMINDER LEAD TIME</strong>: Configure the system to notify you exactly at the due time, 5 mins before, 15 mins before, 1 hour before, or 1 day before.</span>
                    </div>
                    <div className="flex gap-2 items-start">
                      <span className="select-none">⚡</span>
                      <span><strong className="text-white">HAPTIC CONFIRMATIONS</strong>: Tactile haptic hums confirm successful notification scheduling on compatible physical iPhone & mobile devices.</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Active Selected Labels Header (Repositioned below Alerts & Notifications) */}
              <div className="border-t border-[var(--color-dark-tertiary,#3D3D3D)] pt-4 mt-2">
                {/* Unified Labels Bar (Matches Alerts and Document layout format) */}
                <div className="flex gap-2 items-center w-full">
                  <button
                    type="button"
                    onClick={async () => {
                      await triggerHaptic();
                      setIsLabelManagerOpen(!isLabelManagerOpen);
                    }}
                    className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer flex-shrink-0 bg-[#222222] border-2 border-[#2C2C2C] shadow-[3px_3px_0px_0px_#A2A2A2] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#A2A2A2] active:translate-y-[1px] active:shadow-[1px_1px_0px_0px_#A2A2A2]"
                    title="Label Manager Guide"
                  >
                    <span className="text-red-500 font-extrabold text-base">?</span>
                  </button>

                  {/* Wide Orange Action Dropdown Trigger */}
                  <div className="relative flex-grow h-10 sm:h-11">
                    <select
                      value=""
                      onChange={async (e) => {
                        const val = e.target.value;
                        if (val === 'add-new') {
                          await triggerHaptic();
                          setEditingLabelId(null);
                          setLabelFormText('');
                          setLabelFormColor('#DF5504');
                          setIsGlobalLabelModalOpen(true);
                        } else if (val) {
                          await triggerHaptic();
                          const labelId = val;
                          const currentIds = selectedCardForEdit.labelIds || [];
                          const nextIds = currentIds.includes(labelId)
                            ? currentIds.filter(id => id !== labelId)
                            : [...currentIds, labelId];
                          setSelectedCardForEdit({ ...selectedCardForEdit, labelIds: nextIds });
                        }
                        e.target.value = ''; // Reset select box
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 font-mono text-[9px]"
                    >
                      <option value="">🏷️ Add Label</option>
                      {labels.map(lbl => {
                        const hasLabel = selectedCardForEdit.labelIds?.includes(lbl.id);
                        return (
                          <option key={lbl.id} value={lbl.id} className="text-white bg-[#282828]">
                            {lbl.text} {hasLabel ? '✓' : ''}
                          </option>
                        );
                      })}
                      <option value="add-new" className="text-[var(--color-accent,#DF5504)] font-bold font-mono bg-[#282828]">
                        ＋ ADD NEW LABEL...
                      </option>
                    </select>
                    <button
                      type="button"
                      className="w-full h-full text-xs font-mono font-black tracking-wider uppercase flex items-center justify-center gap-2 rounded-lg transition-all bg-[#DF5504] border-2 border-[#E96213] text-white shadow-[3px_3px_0px_0px_#A2A2A2] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#A2A2A2] active:translate-y-[1px] active:shadow-[1px_1px_0px_0px_#A2A2A2] cursor-pointer"
                    >
                      <span>{isLabelManagerOpen ? 'Close Label Editor' : 'Manage Card Labels ▼'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Collapsible Label Selector Dropdown (Adjacent Drawer) */}
              {isLabelManagerOpen && (
                <div className="bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2.5 rounded mt-2 animate-fadeIn flex flex-col gap-2 font-mono text-xs">
                  <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 pb-1">
                    <span className="font-bold text-[9px] uppercase text-gray-400">Toggle Card Labels (Active Only)</span>
                  </div>
                  
                  <div className="flex flex-wrap gap-1.5">
                    {labels.filter(lbl => selectedCardForEdit.labelIds?.includes(lbl.id)).map(lbl => {
                      return (
                        <button
                          key={lbl.id}
                          type="button"
                          onClick={async () => {
                            await triggerHaptic();
                            const currentIds = selectedCardForEdit.labelIds || [];
                            const nextIds = currentIds.filter(id => id !== lbl.id);
                            setSelectedCardForEdit({ ...selectedCardForEdit, labelIds: nextIds });
                          }}
                          className="text-[9px] font-black px-1.5 py-0.5 border border-white scale-105 shadow-[1px_1px_0px_0px_var(--color-shadow,#BCBCBC)] transition-all rounded flex items-center gap-1"
                          style={{ backgroundColor: lbl.color, color: 'white' }}
                        >
                          {lbl.text} ✓
                        </button>
                      );
                    })}
                    {(!selectedCardForEdit.labelIds || selectedCardForEdit.labelIds.filter(id => labels.some(l => l.id === id)).length === 0) && (
                      <span className="text-[9px] text-gray-500 italic">No active labels assigned. Use the dropdown above to add one.</span>
                    )}
                  </div>
                </div>
              )}

              {/* 📁 DOCUMENT & RESOURCE STUDIO */}
              <div className="border-t border-[var(--color-dark-tertiary,#3D3D3D)] pt-4 mt-2">
                <div className="flex gap-2 items-center w-full mb-2.5">
                  <button
                    type="button"
                    onClick={async () => {
                      await triggerHaptic();
                      setIsDocsHelpOpen(!isDocsHelpOpen);
                    }}
                    className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer flex-shrink-0 bg-[#222222] border-2 border-[#2C2C2C] shadow-[3px_3px_0px_0px_#A2A2A2] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#A2A2A2] active:translate-y-[1px] active:shadow-[1px_1px_0px_0px_#A2A2A2]"
                    title="Documents Guide"
                  >
                    <span className="text-red-500 font-extrabold text-base">?</span>
                  </button>

                  <button 
                    type="button"
                    onClick={async () => {
                      await triggerHaptic();
                      setIsDocStudioOpen(!isDocStudioOpen);
                    }}
                    className="flex-grow h-10 sm:h-11 text-xs font-mono font-black tracking-wider uppercase flex items-center justify-center gap-2 rounded-lg transition-all bg-[#DF5504] border-2 border-[#E96213] text-white shadow-[3px_3px_0px_0px_#A2A2A2] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#A2A2A2] active:translate-y-[1px] active:shadow-[1px_1px_0px_0px_#A2A2A2] cursor-pointer"
                  >
                    <span>Document & Resource Studio</span>
                    <span className="text-[10px] ml-1 transition-transform" style={{ transform: isDocStudioOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                  </button>
                </div>

                {/* Expandable Document Help Info Block */}
                {isDocsHelpOpen && (
                  <div className="mt-2.5 mb-2.5 p-3.5 bento-box border-l-4 border-l-[var(--color-accent,#DF5504)] bg-black/40 font-mono text-[9px] leading-relaxed flex flex-col gap-2 text-left animate-fadeIn">
                    <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-1 w-full">
                      <span className="font-black uppercase tracking-wider text-[var(--color-accent,#DF5504)] text-[9px]">
                        📁 Document & Resource Guide
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsDocsHelpOpen(false)}
                        className="text-[8px] text-gray-400 hover:text-white uppercase font-black border-none bg-transparent cursor-pointer"
                      >
                        ✕ Close
                      </button>
                    </div>
                    
                    <div className="flex flex-col gap-1.5 text-gray-300">
                      <div className="flex gap-2 items-start">
                        <span className="select-none">🏆</span>
                        <span><strong className="text-white">CENTRAL SUBMISSION PORTAL</strong>: Upload your final DOCX, slides, or PDF delivery bundle. Max file size is 1.5MB.</span>
                      </div>
                      <div className="flex gap-2 items-start">
                        <span className="select-none">🖇️</span>
                        <span><strong className="text-white">SUPPORTING FILE VAULT</strong>: Attach supplementary project files, design specs, images, or assets.</span>
                      </div>
                      <div className="flex gap-2 items-start">
                        <span className="select-none">📚</span>
                        <span><strong className="text-white">BIBLIOGRAPHY & CITATIONS</strong>: Search academic databases (Scholar, PubMed, Wiki) and compile citation reference files.</span>
                      </div>
                      <div className="flex gap-2 items-start">
                        <span className="select-none">🌐</span>
                        <span><strong className="text-white">CLOUD & DRIVES LINKS</strong>: Connect external shared cloud storage directories from Google Drive, iCloud, or OneDrive.</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Expandable Document Studio Content Box */}
                {isDocStudioOpen && (
                  <div className="flex flex-col gap-3 mt-1.5 pt-3 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40 animate-fadeIn">
                  
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
                      <div className="flex flex-col gap-1.5 font-mono">
                        <input 
                          type="text"
                          placeholder="Source Book/Author..."
                          value={newCitationTitle}
                          onChange={(e) => setNewCitationTitle(e.target.value)}
                          className="bg-black/30 border border-[var(--color-dark-tertiary,#3D3D3D)] px-2 py-1.5 text-white text-[10px] rounded font-mono w-full"
                        />
                        <div className="flex items-center gap-2 bg-black/10 border border-dashed border-[var(--color-dark-tertiary,#3D3D3D)]/40 p-2 rounded font-mono text-[11px] focus-within:border-[var(--color-accent,#DF5504)] focus-within:bg-black/20 transition-all">
                          <span className="text-[12px] font-black text-[var(--color-accent,#DF5504)] select-none pl-1">＋</span>
                          <input 
                            type="text"
                            placeholder="URL or Page reference... (Press Enter to Add)"
                            value={newCitationUrl}
                            onChange={(e) => setNewCitationUrl(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const title = newCitationTitle.trim();
                                const url = newCitationUrl.trim();

                                if (!title && !url) return;

                                if (title && !url) {
                                  await triggerHaptic();
                                  showToast("⚠️ Citation reference URL/Page is missing!");
                                  return;
                                }
                                if (!title && url) {
                                  await triggerHaptic();
                                  showToast("⚠️ Citation description is missing!");
                                  return;
                                }

                                // Both are filled
                                await triggerHaptic();
                                const nextCitations = [
                                  ...(selectedCardForEdit.resources || []),
                                  {
                                    id: 'cit-' + Date.now(),
                                    title: title,
                                    url: url,
                                    addedAt: Date.now()
                                  } as ResourceCitation
                                ];
                                setSelectedCardForEdit({ ...selectedCardForEdit, resources: nextCitations });
                                setNewCitationTitle('');
                                setNewCitationUrl('');
                              }
                            }}
                            className="bg-transparent text-white border-none focus:outline-none placeholder-gray-500 text-[10px] font-mono flex-grow w-full"
                          />
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
                      <div className="flex flex-col gap-1.5 font-mono">
                        <input 
                          type="text"
                          placeholder="Link Label (e.g. iCloud Folder)..."
                          value={newCloudLinkName}
                          onChange={(e) => setNewCloudLinkName(e.target.value)}
                          className="bg-black/30 border border-[var(--color-dark-tertiary,#3D3D3D)] px-2 py-1.5 text-white text-[10px] rounded font-mono w-full"
                        />
                        <div className="flex items-center gap-2 bg-black/10 border border-dashed border-[var(--color-dark-tertiary,#3D3D3D)]/40 p-2 rounded font-mono text-[11px] focus-within:border-[var(--color-accent,#DF5504)] focus-within:bg-black/20 transition-all">
                          <span className="text-[12px] font-black text-[var(--color-accent,#DF5504)] select-none pl-1">＋</span>
                          <input 
                            type="text"
                            placeholder="https://drive.google.com/... (Press Enter to Add)"
                            value={newCloudLinkUrl}
                            onChange={(e) => setNewCloudLinkUrl(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const label = newCloudLinkName.trim();
                                const url = newCloudLinkUrl.trim();

                                if (!label && !url) return;

                                if (label && !url) {
                                  await triggerHaptic();
                                  showToast("⚠️ Link URL is missing!");
                                  return;
                                }
                                if (!label && url) {
                                  await triggerHaptic();
                                  showToast("⚠️ Link description is missing!");
                                  return;
                                }

                                // Both are filled
                                await triggerHaptic();
                                let finalUrl = url;
                                if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
                                  finalUrl = 'https://' + finalUrl;
                                }
                                const nextAttachments = [
                                  ...(selectedCardForEdit.attachments || []),
                                  {
                                    id: 'attach-' + Date.now(),
                                    name: label,
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
                            className="bg-transparent text-white border-none focus:outline-none placeholder-gray-500 text-[10px] font-mono flex-grow w-full"
                          />
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
              )}
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
                  if (!selectedCardForEdit.title || !selectedCardForEdit.title.trim()) {
                    await triggerHaptic();
                    showToast("⚠️ Task title is required to save the card!");
                    return;
                  }
                  if (!selectedCardForEdit.description || !selectedCardForEdit.description.trim()) {
                    await triggerHaptic();
                    showToast("⚠️ Task description is empty! Please write a summary.");
                    return;
                  }
                  await triggerHaptic();
                  const exists = cards.some(c => c.id === selectedCardForEdit.id);
                  const updatedCards = exists 
                    ? cards.map(c => c.id === selectedCardForEdit.id ? selectedCardForEdit : c)
                    : [...cards, selectedCardForEdit];
                  await saveCards(updatedCards);

                  // Phase 5: Trigger Native iOS Integrations
                  if (isNative && selectedCardForEdit.dueDate) {
                    await scheduleLocalAlarm(selectedCardForEdit);
                    await syncToAppleCalendar(selectedCardForEdit);
                  }

                  setSelectedCardForEdit(null);
                  setIsLabelManagerOpen(false);
                }}
                className="px-4 py-1.5 bento-btn text-white hover:opacity-90 font-bold text-xs uppercase rounded cursor-pointer"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 📊 SESSIONS & TIME ANALYSIS LOG POPUP MODAL */}
      {isSessionLogOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-fadeIn">
          <div className="w-full max-w-lg bg-[var(--color-dark-secondary,#333333)] border-2 border-[var(--color-accent,#DF5504)] p-5 rounded-lg shadow-[8px_8px_0px_0px_#000] font-mono text-xs flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b-2 border-[var(--color-dark-tertiary,#3D3D3D)] pb-3">
              <span className="font-black text-sm text-[var(--color-accent,#DF5504)] uppercase tracking-wider flex items-center gap-2">
                📊 SESSION TIME LOGS
              </span>
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIsSessionLogOpen(false);
                }}
                className="w-6 h-6 rounded-full bg-black/40 hover:bg-black/80 text-white flex items-center justify-center font-bold text-sm transition-colors cursor-pointer"
              >
                ×
              </button>
            </div>

            {/* Total Summary Analytics Banner */}
            {(() => {
              const activeCardsWithTime = cards.filter(c => (c.timeSpent || 0) > 0);
              const totalSeconds = cards.reduce((sum, c) => sum + (c.timeSpent || 0), 0);
              const totalHours = Math.floor(totalSeconds / 3600);
              const totalMinutes = Math.floor((totalSeconds % 3600) / 60);
              const remainingSeconds = totalSeconds % 60;

              return (
                <div className="p-3 bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded flex flex-col gap-1 text-left">
                  <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">⏱️ TOTAL STUDY DURATION</div>
                  <div className="text-xl font-black text-[var(--color-accent,#DF5504)] flex items-baseline gap-1">
                    {totalHours}<span className="text-xs text-gray-400 font-normal uppercase">h</span>{' '}
                    {totalMinutes}<span className="text-xs text-gray-400 font-normal uppercase">m</span>{' '}
                    {remainingSeconds}<span className="text-xs text-gray-400 font-normal uppercase">s</span>
                  </div>
                  <div className="text-[9px] text-gray-400 uppercase mt-1">
                    Logged across <strong className="text-white">{activeCardsWithTime.length}</strong> active card focus targets
                  </div>
                </div>
              );
            })()}

            {/* Scrollable Logs Grid */}
            <div className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto pr-1">
              {(() => {
                const activeCardsWithTime = cards.filter(c => (c.timeSpent || 0) > 0);
                if (activeCardsWithTime.length === 0) {
                  return (
                    <div className="text-center py-8 text-gray-400 flex flex-col items-center gap-2">
                      <span className="text-3xl select-none">📋</span>
                      <span className="text-[10px] uppercase font-bold tracking-wider leading-relaxed max-w-[280px]">
                        No focus sessions recorded yet. Open any card details page to start accumulating focus time!
                      </span>
                    </div>
                  );
                }

                // Sort cards by timeSpent descending
                const sortedCards = [...activeCardsWithTime].sort((a, b) => (b.timeSpent || 0) - (a.timeSpent || 0));

                return (
                  <div className="flex flex-col gap-2.5">
                    {sortedCards.map(card => {
                      const cardList = lists.find(l => l.id === card.listId);
                      const hrs = Math.floor((card.timeSpent || 0) / 3600);
                      const mins = Math.floor(((card.timeSpent || 0) % 3600) / 60);
                      const secs = (card.timeSpent || 0) % 60;

                      return (
                        <div 
                          key={card.id}
                          className="p-3 bg-[var(--color-dark-bg,#282828)]/50 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-[var(--color-accent,#DF5504)] transition-all flex justify-between items-center text-left gap-4"
                        >
                          <div className="flex flex-col gap-1 min-w-0 flex-1">
                            <span className="font-bold text-white text-xs truncate uppercase tracking-wide">
                              {card.title || 'Untitled Card Target'}
                            </span>
                            <span className="text-[9px] font-bold text-[var(--color-accent,#DF5504)] uppercase">
                              List: {cardList ? cardList.name.toUpperCase() : 'UNKNOWN'}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <span className="font-bold text-white text-[11px]">
                              {hrs}h {mins}m {secs}s
                            </span>
                            <button
                              type="button"
                              onClick={async () => {
                                await triggerHaptic();
                                if (confirm(`Reset session time for "${card.title || 'this card'}"?`)) {
                                  const updated = cards.map(c => c.id === card.id ? { ...c, timeSpent: 0 } : c);
                                  await saveCards(updated);
                                }
                              }}
                              className="w-6 h-6 rounded bg-black/40 hover:bg-red-950 hover:text-red-400 border border-[var(--color-dark-tertiary,#3D3D3D)] flex items-center justify-center text-[10px] transition-colors cursor-pointer animate-fadeIn"
                              title="Reset Card Time"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Bottom Actions Row */}
            <div className="flex justify-between items-center border-t border-[var(--color-dark-tertiary,#3D3D3D)] pt-4 mt-2">
              <button
                type="button"
                onClick={async () => {
                  const activeCardsWithTime = cards.filter(c => (c.timeSpent || 0) > 0);
                  if (activeCardsWithTime.length === 0) return;
                  await triggerHaptic();
                  if (confirm("⚠️ Are you sure you want to RESET ALL study session times across all lists and cards? This action is permanent!")) {
                    const updated = cards.map(c => ({ ...c, timeSpent: 0 }));
                    await saveCards(updated);
                    showToast("🧹 All study session times reset successfully.");
                  }
                }}
                className={`px-3 py-1.5 border border-red-900/50 bg-red-950/20 hover:bg-red-950/40 text-red-400 font-bold uppercase text-[10px] rounded transition-all cursor-pointer ${
                  cards.some(c => (c.timeSpent || 0) > 0) ? 'opacity-100' : 'opacity-30 cursor-not-allowed'
                }`}
              >
                Reset All Times
              </button>
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIsSessionLogOpen(false);
                }}
                className="px-4 py-1.5 bento-btn text-white font-bold uppercase text-[10px] rounded cursor-pointer"
              >
                Close Logs
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
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    setIsAlertStudioHelpOpen(!isAlertStudioHelpOpen);
                  }}
                  className={`w-6 h-6 rounded-full border flex items-center justify-center font-bold text-xs transition-colors cursor-pointer ${
                    isAlertStudioHelpOpen
                      ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                      : 'bg-black/40 border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white'
                  }`}
                  title="Alert Studio Guide"
                >
                  ❓
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    setIsNotificationStudioOpen(false);
                    setIsAlertStudioHelpOpen(false);
                  }}
                  className="w-6 h-6 rounded-full bg-black/40 hover:bg-black/80 text-white flex items-center justify-center font-bold text-sm transition-colors cursor-pointer"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Dynamic Interactive Alert Studio Help Panel */}
            {isAlertStudioHelpOpen && (
              <div className="mt-1 p-3 bento-box border-l-4 border-l-[var(--color-accent,#DF5504)] bg-black/40 font-mono text-[9px] leading-relaxed flex flex-col gap-2 animate-fadeIn text-left">
                <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-1 w-full">
                  <span className="font-black uppercase tracking-wider text-[var(--color-accent,#DF5504)] text-[9px]">
                    🔔 Alert Studio Runbook
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsAlertStudioHelpOpen(false)}
                    className="text-[8px] text-gray-400 hover:text-white uppercase font-black border-none bg-transparent cursor-pointer"
                  >
                    ✕ Close
                  </button>
                </div>
                
                <div className="flex flex-col gap-1.5 text-gray-300">
                  <div className="flex gap-2 items-start">
                    <span className="select-none">⏰</span>
                    <span><strong className="text-white">DUE DATE</strong>: Set the main target milestone date and time for the card. Required to trigger automated schedules.</span>
                  </div>
                  <div className="flex gap-2 items-start">
                    <span className="select-none">📱</span>
                    <span><strong className="text-white">IN-APP TOAST</strong>: Displays rich local overlays in real-time while using the web application.</span>
                  </div>
                  <div className="flex gap-2 items-start">
                    <span className="select-none">🔔</span>
                    <span><strong className="text-white">SYSTEM LOCK-SCREEN</strong>: Schedules native push alerts using mobile background notification dispatchers.</span>
                  </div>
                  <div className="flex gap-2 items-start">
                    <span className="select-none">📅</span>
                    <span><strong className="text-white">CALENDAR SYNC</strong>: Pushes tasks directly into local calendar applications as alarms.</span>
                  </div>
                  <div className="flex gap-2 items-start">
                    <span className="select-none">📧</span>
                    <span><strong className="text-white">EMAIL COMPOSER</strong>: Opens the local mail composer pre-filled with specific card details and deadlines.</span>
                  </div>
                </div>
              </div>
            )}

            <div className="text-gray-400 text-[10px] leading-relaxed uppercase tracking-wider">
              Configure and test multi-channel reminders for: <span className="text-white font-bold">"{selectedCardForEdit.title}"</span>
            </div>

            {/* Primary Date Configuration */}
            <div className="p-3.5 bg-black/30 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded flex flex-col gap-2">
              <label className="block text-[10px] font-mono font-bold uppercase text-gray-400 tracking-wider">
                ⏰ Card Due Date & Time
              </label>
              <input 
                type="datetime-local"
                value={formatTimestampToDatetimeLocal(selectedCardForEdit.dueDate)}
                onChange={(e) => {
                  const parsed = e.target.value ? Date.parse(e.target.value) : null;
                  setSelectedCardForEdit({ ...selectedCardForEdit, dueDate: parsed });
                }}
                className="w-full bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 text-xs font-mono text-white rounded focus:border-[var(--color-accent,#DF5504)] transition-colors"
              />
              {!selectedCardForEdit.dueDate && (
                <span className="text-[8px] text-[var(--color-accent,#DF5504)] font-bold uppercase tracking-wider mt-0.5">
                  ⚠️ Configure a Due Date above to enable automated alarm schedules.
                </span>
              )}
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
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    setShowCalendarHelp(!showCalendarHelp);
                  }}
                  className={`w-6 h-6 rounded-full border flex items-center justify-center font-bold text-xs transition-all cursor-pointer ${
                    showCalendarHelp
                      ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                      : 'bg-black/40 hover:bg-black/80 border-[var(--color-dark-tertiary,#3D3D3D)] text-gray-300'
                  }`}
                  title="Show Help Guide"
                >
                  ❓
                </button>
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
            </div>

            {/* Toggleable Monospace Calendar Quick Help Panel */}
            {showCalendarHelp && (
              <div className="bg-black/50 border border-[var(--color-accent,#DF5504)]/40 p-3.5 rounded flex flex-col gap-2.5 animate-slideDown flex-shrink-0">
                <div className="flex items-center gap-1.5 border-b border-[var(--color-dark-tertiary,#3D3D3D)]/30 pb-1.5">
                  <span className="text-[10px] text-[var(--color-accent,#DF5504)] font-black uppercase tracking-wider">📅 Calendar Help Guide</span>
                </div>
                <ul className="list-none flex flex-col gap-1.5 text-[9px] text-gray-300 font-bold uppercase tracking-wide">
                  <li className="flex gap-2 items-start">
                    <span className="text-[var(--color-accent,#DF5504)] flex-shrink-0">•</span>
                    <span><strong>📅 Range Select</strong>: Toggle between single-day <strong>TODAY</strong> queries or 7, 30, and 90-day upcoming schedules.</span>
                  </li>
                  <li className="flex gap-2 items-start">
                    <span className="text-[var(--color-accent,#DF5504)] flex-shrink-0">•</span>
                    <span><strong>📅 Start Date Picker</strong>: Choose a custom date from the HTML5 calendar to query any starting day.</span>
                  </li>
                  <li className="flex gap-2 items-start">
                    <span className="text-[var(--color-accent,#DF5504)] flex-shrink-0">•</span>
                    <span><strong>📌 Triage Filters</strong>: Select 'Triage Only' to isolate and display only high-priority mobile board tasks.</span>
                  </li>
                  <li className="flex gap-2 items-start">
                    <span className="text-[var(--color-accent,#DF5504)] flex-shrink-0">•</span>
                    <span><strong>📔 Diary Logs</strong>: Select 'Diary' to project your verbal recordings directly onto your timeline schedule.</span>
                  </li>
                  <li className="flex gap-2 items-start">
                    <span className="text-[var(--color-accent,#DF5504)] flex-shrink-0">•</span>
                    <span><strong>🧾 Receipts Feed</strong>: Select 'Receipts' to view date-locked business claims with photo previews.</span>
                  </li>
                  <li className="flex gap-2 items-start">
                    <span className="text-[var(--color-accent,#DF5504)] flex-shrink-0">•</span>
                    <span><strong>📧 Email Claim</strong>: In receipts view, tap 'Email Employer' in the footer to compile and submit claims!</span>
                  </li>
                </ul>
              </div>
            )}

            {/* Range and Filters Row */}
            <div className="flex flex-col gap-2.5 border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-3 flex-shrink-0">
              <div className="flex justify-between items-center flex-wrap gap-2">
                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Select Range</span>
                <div className="flex gap-1 items-center flex-wrap">
                  <button
                    onClick={async () => {
                      await triggerHaptic();
                      setCalendarRangeDays(0);
                      await fetchUpcomingCalendarEvents(0);
                    }}
                    className={`px-2 py-1 rounded text-[9px] uppercase font-bold transition-all border ${
                      calendarRangeDays === 0
                        ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                        : 'bg-black/30 border-[var(--color-dark-tertiary,#3D3D3D)] text-gray-400 hover:text-white hover:border-gray-500'
                    }`}
                  >
                    Today
                  </button>
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
                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Start Date</span>
                <input
                  type="date"
                  value={calendarStartDate}
                  onChange={async (e) => {
                    const val = e.target.value;
                    setCalendarStartDate(val);
                    await fetchUpcomingCalendarEvents(calendarRangeDays, val);
                  }}
                  className="bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-gray-500 text-white font-mono text-[9px] uppercase font-bold px-2 py-1 rounded outline-none cursor-pointer"
                />
              </div>

              <div className="flex justify-between items-center">
                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Filters</span>
                <div className="flex gap-1 flex-wrap justify-end">
                  <button
                    onClick={async () => {
                      await triggerHaptic();
                      setCalendarFilterType('all');
                    }}
                    className={`px-2 py-1 rounded text-[9px] uppercase font-bold transition-all border ${
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
                    className={`px-2 py-1 rounded text-[9px] uppercase font-bold transition-all border ${
                      calendarFilterType === 'triage'
                        ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                        : 'bg-black/30 border-[var(--color-dark-tertiary,#3D3D3D)] text-gray-400 hover:text-white hover:border-gray-500'
                    }`}
                  >
                    Triage Only
                  </button>
                  <button
                    onClick={async () => {
                      await triggerHaptic();
                      setCalendarFilterType('diary');
                    }}
                    className={`px-2 py-1 rounded text-[9px] uppercase font-bold transition-all border ${
                      calendarFilterType === 'diary'
                        ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                        : 'bg-black/30 border-[var(--color-dark-tertiary,#3D3D3D)] text-gray-400 hover:text-white hover:border-gray-500'
                    }`}
                  >
                    Diary
                  </button>
                  <button
                    onClick={async () => {
                      await triggerHaptic();
                      setCalendarFilterType('receipts');
                    }}
                    className={`px-2 py-1 rounded text-[9px] uppercase font-bold transition-all border ${
                      calendarFilterType === 'receipts'
                        ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                        : 'bg-black/30 border-[var(--color-dark-tertiary,#3D3D3D)] text-gray-400 hover:text-white hover:border-gray-500'
                    }`}
                  >
                    Receipts
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
                  let filtered: any[] = [];
                  
                  if (calendarFilterType === 'diary') {
                    const baseDate = calendarStartDate ? new Date(calendarStartDate + 'T00:00:00') : new Date();
                    const startTime = baseDate.getTime();
                    const endTime = calendarRangeDays === 0
                      ? startTime + 24 * 60 * 60 * 1000 - 1000
                      : startTime + calendarRangeDays * 24 * 60 * 60 * 1000;

                    filtered = voiceLogs
                      .filter(l => l.timestamp >= startTime && l.timestamp <= endTime)
                      .map(l => ({
                        title: l.text,
                        startDate: l.timestamp,
                        endDate: l.timestamp,
                        location: l.assignedCardId ? `Sent to: "${cards.find(c => c.id === l.assignedCardId)?.title || ''}"` : undefined,
                        isDiaryLog: true
                      }));
                  } else if (calendarFilterType === 'receipts') {
                    const baseDate = calendarStartDate ? new Date(calendarStartDate + 'T00:00:00') : new Date();
                    const startTime = baseDate.getTime();
                    const endTime = calendarRangeDays === 0
                      ? startTime + 24 * 60 * 60 * 1000 - 1000
                      : startTime + calendarRangeDays * 24 * 60 * 60 * 1000;

                    filtered = receipts
                      .filter(r => r.timestamp >= startTime && r.timestamp <= endTime)
                      .map(r => ({
                        title: `Claim filed for: ${r.merchant}`,
                        startDate: r.timestamp,
                        endDate: r.timestamp,
                        location: r.notes ? `Purpose: "${r.notes}"` : undefined,
                        amount: r.amount,
                        imageUrl: r.imageUrl,
                        isReceiptLog: true
                      }));
                  } else {
                    filtered = calendarEvents.filter((evt) => {
                      if (calendarFilterType === 'triage') {
                        return evt.title && evt.title.includes('📌 [Triage Lite]');
                      }
                      return true;
                    });
                  }

                  if (filtered.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                        <span className="text-2xl">📅</span>
                        <span className="font-bold text-gray-400 uppercase tracking-wider text-[10px]">No events matching your filters.</span>
                        <span className="text-[9px] text-gray-500 uppercase">Stay Focused!</span>
                      </div>
                    );
                  }

                  return (
                    <div className="flex flex-col gap-3.5 py-2">
                      {filtered.map((evt, idx) => {
                        const isTriageEvent = evt.title && evt.title.includes('📌 [Triage Lite]');
                        const isDiaryLog = !!evt.isDiaryLog;
                        const isReceiptLog = !!evt.isReceiptLog;
                        const start = evt.startDate ? new Date(evt.startDate) : null;
                        const end = evt.endDate ? new Date(evt.endDate) : null;

                        return (
                          <div
                            key={idx}
                            className={`p-3 bg-black/20 rounded border transition-all ${
                              isTriageEvent
                                ? 'border-[var(--color-accent,#DF5504)]/40 border-l-4 border-l-[var(--color-accent,#DF5504)] shadow-[2px_2px_0px_0px_rgba(223,85,4,0.1)]'
                                : isDiaryLog
                                ? 'border-amber-500/40 border-l-4 border-l-amber-500 shadow-[2px_2px_0px_0px_rgba(245,158,11,0.1)]'
                                : isReceiptLog
                                ? 'border-[var(--color-accent,#DF5504)]/40 border-l-4 border-l-[var(--color-accent,#DF5504)] shadow-[2px_2px_0px_0px_rgba(223,85,4,0.15)]'
                                : 'border-[var(--color-dark-tertiary,#3D3D3D)]/50 hover:border-gray-500'
                            }`}
                          >
                            {/* Event Timeline Date/Time */}
                            <div className="flex justify-between items-center mb-1.5 pb-1 border-b border-[var(--color-dark-tertiary,#3D3D3D)]/20">
                              <span className={`text-[9px] font-black uppercase tracking-wider flex items-center gap-1 ${
                                isDiaryLog ? 'text-amber-500' : 'text-[var(--color-accent,#DF5504)]'
                              }`}>
                                <span>{isDiaryLog ? '📔' : isReceiptLog ? '🧾' : '📅'}</span>
                                {start ? start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'Date Unknown'}
                              </span>
                              <span className="text-[8px] text-gray-500 uppercase font-bold tracking-widest">
                                {start ? start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
                                {end && !isDiaryLog && !isReceiptLog ? ` - ${end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
                              </span>
                            </div>

                            {/* Event Details and Image Preview Grid */}
                            <div className="flex gap-3 items-center">
                              {isReceiptLog && evt.imageUrl && (
                                <div className="w-10 h-10 rounded border border-[var(--color-dark-tertiary,#3D3D3D)]/30 overflow-hidden bg-black flex-shrink-0">
                                  <img src={evt.imageUrl} alt="" className="w-full h-full object-cover" />
                                </div>
                              )}

                              <div className="flex-grow min-w-0">
                                <h4 className="font-bold text-white text-[11px] leading-snug flex justify-between gap-1 items-center">
                                  <span className="truncate">{evt.title || 'Untitled Event'}</span>
                                  {isReceiptLog && evt.amount !== undefined && (
                                    <span className="text-[var(--color-accent,#DF5504)] font-black flex-shrink-0">${evt.amount.toFixed(2)}</span>
                                  )}
                                </h4>

                                {evt.location && (
                                  <div className="text-[9px] text-gray-400 mt-0.5 flex items-center gap-1">
                                    <span>{isDiaryLog ? '📤' : isReceiptLog ? '💡' : '📍'}</span>
                                    <span className="truncate">{evt.location}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-between items-center mt-2 pt-3 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40 flex-shrink-0 gap-2">
              {calendarFilterType === 'receipts' && (
                (() => {
                  const baseDate = calendarStartDate ? new Date(calendarStartDate + 'T00:00:00') : new Date();
                  const startTime = baseDate.getTime();
                  const endTime = calendarRangeDays === 0
                    ? startTime + 24 * 60 * 60 * 1000 - 1000
                    : startTime + calendarRangeDays * 24 * 60 * 60 * 1000;

                  const filteredClaims = receipts.filter(r => r.timestamp >= startTime && r.timestamp <= endTime);

                  if (filteredClaims.length > 0) {
                    return (
                      <button
                        type="button"
                        onClick={async () => {
                          await triggerHaptic();
                          const formattedDate = baseDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                          const rangeLabel = calendarRangeDays === 0 ? `for ${formattedDate}` : `for period starting ${formattedDate}`;

                          // Assemble ASCII business claim table
                          let report = `TRIAGE LITE EXPENSE RECLAIM REPORT\n========================================\n\n`;
                          report += `CLAIM RANGE: ${rangeLabel.toUpperCase()}\n`;
                          report += `TOTAL RECLAIMABLE AMOUNT: $${filteredClaims.reduce((acc, r) => acc + r.amount, 0).toFixed(2)}\n\n`;
                          report += `ITEMIZED BUSINESS CLAIMS LIST:\n`;
                          report += `----------------------------------------\n`;

                          filteredClaims.forEach((claim, idx) => {
                            const cTime = new Date(claim.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                            const cDate = new Date(claim.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                            report += `${idx + 1}. [${cDate} at ${cTime}] Claim Merchant: ${claim.merchant}\n`;
                            report += `   Amount: $${claim.amount.toFixed(2)}\n`;
                            if (claim.notes) report += `   Purpose: "${claim.notes}"\n`;
                            report += `----------------------------------------\n`;
                          });

                          report += `\n\nCompiled on Triage Lite. Secure, date-stamped digital receipts are on file.`;

                          const subject = encodeURIComponent(`Triage Expense Claims: ${formattedDate}`);
                          const body = encodeURIComponent(report);
                          window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
                          showToast("📧 Compiling and opening Mail client...");
                        }}
                        className="px-3 py-2 bg-[var(--color-accent,#DF5504)] hover:bg-[var(--color-accent,#DF5504)]/90 border border-black shadow-[2px_2px_0px_0px_#000] text-white font-mono text-[9px] uppercase font-bold rounded flex items-center gap-1.5 cursor-pointer active:translate-y-0.5 active:shadow-[0px_0px_0px_0px_#000] transition-all"
                      >
                        📧 Email Employer
                      </button>
                    );
                  }
                  return null;
                })()
              )}
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIsCalendarAgendaOpen(false);
                }}
                className="px-4 py-2 bg-black border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white font-bold rounded ml-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🧾 RECEIPTS & BUSINESS EXPENSE MANAGER MODAL */}
      {isReceiptsOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[var(--color-dark-secondary,#333333)] border-2 border-[var(--color-accent,#DF5504)] p-5 rounded-lg shadow-[8px_8px_0px_0px_#000] font-mono text-xs flex flex-col gap-4 max-h-[90vh] overflow-hidden animate-fadeIn">
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b-2 border-[var(--color-dark-tertiary,#3D3D3D)] pb-3 flex-shrink-0">
              <span className="font-black text-sm text-[var(--color-accent,#DF5504)] uppercase tracking-wider flex items-center gap-2">
                🧾 Business Receipt Claims
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    setShowReceiptsHelp(!showReceiptsHelp);
                  }}
                  className={`w-6 h-6 rounded-full border flex items-center justify-center font-bold text-xs transition-all cursor-pointer ${
                    showReceiptsHelp
                      ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                      : 'bg-black/40 hover:bg-black/80 border-[var(--color-dark-tertiary,#3D3D3D)] text-gray-300'
                  }`}
                  title="Show Help Guide"
                >
                  ❓
                </button>
                <button
                  onClick={async () => {
                    await triggerHaptic();
                    setIsReceiptsOpen(false);
                  }}
                  className="w-6 h-6 rounded-full bg-black/40 hover:bg-black/80 text-white flex items-center justify-center font-bold text-sm transition-colors cursor-pointer"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Toggleable Monospace Quick Help Panel */}
            {showReceiptsHelp && (
              <div className="bg-black/50 border border-[var(--color-accent,#DF5504)]/40 p-3.5 rounded flex flex-col gap-2.5 animate-slideDown flex-shrink-0">
                <div className="flex items-center gap-1.5 border-b border-[var(--color-dark-tertiary,#3D3D3D)]/30 pb-1.5">
                  <span className="text-[10px] text-[var(--color-accent,#DF5504)] font-black uppercase tracking-wider">🧾 Receipts Help Guide</span>
                </div>
                <ul className="list-none flex flex-col gap-1.5 text-[9px] text-gray-300 font-bold uppercase tracking-wide">
                  <li className="flex gap-2 items-start">
                    <span className="text-[var(--color-accent,#DF5504)] flex-shrink-0">•</span>
                    <span><strong>📸 Photo Snap</strong>: Tap 'Snap Receipt Photo' to toggle the device camera or capture an image instantly.</span>
                  </li>
                  <li className="flex gap-2 items-start">
                    <span className="text-[var(--color-accent,#DF5504)] flex-shrink-0">•</span>
                    <span><strong>🔒 Tamper-Proof</strong>: Recording automatically logs the exact, verified date & time of the expenditure claim.</span>
                  </li>
                  <li className="flex gap-2 items-start">
                    <span className="text-[var(--color-accent,#DF5504)] flex-shrink-0">•</span>
                    <span><strong>💰 Claim Costs</strong>: Type in the Merchant name and Dollar Amount to record your financial claim.</span>
                  </li>
                  <li className="flex gap-2 items-start">
                    <span className="text-[var(--color-accent,#DF5504)] flex-shrink-0">•</span>
                    <span><strong>📅 Timeline Mapping</strong>: Open the Calendar modal and select the 'Receipts' filter to project all your claims.</span>
                  </li>
                  <li className="flex gap-2 items-start">
                    <span className="text-[var(--color-accent,#DF5504)] flex-shrink-0">•</span>
                    <span><strong>📧 Email Claim</strong>: In the Calendar receipts view, tap 'Email Employer' to compile and submit claim logs!</span>
                  </li>
                </ul>
              </div>
            )}

            {/* Hidden fallback file input picker for browser/non-native testing */}
            <input
              type="file"
              id="receipt-file-picker"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    const base64Url = reader.result as string;
                    const previewImg = document.getElementById('receipt-img-preview') as HTMLImageElement;
                    if (previewImg) {
                      previewImg.src = base64Url;
                      previewImg.style.display = 'block';
                    }
                    const indicator = document.getElementById('temp-receipt-photo-src') as HTMLInputElement;
                    if (indicator) indicator.value = base64Url;
                    showToast("📸 Receipt photo loaded successfully");
                  };
                  reader.readAsDataURL(file);
                }
              }}
            />

            {/* Receipt Capture Form */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await triggerHaptic();
                
                const merchantInput = document.getElementById('receipt-merchant-input') as HTMLInputElement;
                const amountInput = document.getElementById('receipt-amount-input') as HTMLInputElement;
                const notesInput = document.getElementById('receipt-notes-input') as HTMLInputElement;
                const photoSrcInput = document.getElementById('temp-receipt-photo-src') as HTMLInputElement;

                const merchant = merchantInput?.value.trim() || '';
                const amount = parseFloat(amountInput?.value || '0');
                const notes = notesInput?.value.trim() || '';
                const imageUrl = photoSrcInput?.value || '';

                if (!merchant) {
                  showToast("⚠️ Please enter a Merchant name!");
                  return;
                }
                if (amount <= 0 || isNaN(amount)) {
                  showToast("⚠️ Please enter a valid claim Amount!");
                  return;
                }
                if (!imageUrl) {
                  showToast("⚠️ Please capture or upload a receipt photograph!");
                  return;
                }

                const newReceipt = {
                  id: `receipt-${Date.now()}`,
                  timestamp: Date.now(),
                  imageUrl,
                  merchant,
                  amount,
                  notes: notes || undefined
                };

                setReceipts((prev) => [newReceipt, ...prev]);
                showToast(`🧾 Logged $${amount.toFixed(2)} claim for ${merchant}!`);

                // Reset inputs
                if (merchantInput) merchantInput.value = '';
                if (amountInput) amountInput.value = '';
                if (notesInput) notesInput.value = '';
                if (photoSrcInput) photoSrcInput.value = '';
                const previewImg = document.getElementById('receipt-img-preview') as HTMLImageElement;
                if (previewImg) {
                  previewImg.src = '';
                  previewImg.style.display = 'none';
                }
              }}
              className="bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)]/40 p-4 rounded flex flex-col gap-3 flex-shrink-0"
            >
              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-black block border-b border-[var(--color-dark-tertiary,#3D3D3D)]/20 pb-1.5">Record Business Expenditure</span>

              {/* Photo Snap and Display Grid */}
              <div className="flex gap-4 items-center">
                {/* Captured Image Box */}
                <div className="w-16 h-16 rounded border-2 border-dashed border-[var(--color-dark-tertiary,#3D3D3D)] bg-black/50 overflow-hidden flex items-center justify-center flex-shrink-0 relative">
                  <img
                    id="receipt-img-preview"
                    src=""
                    alt=""
                    className="w-full h-full object-cover hidden"
                  />
                  <span className="absolute text-xl pointer-events-none text-gray-600">📷</span>
                </div>

                <div className="flex flex-col gap-1.5 flex-grow">
                  <button
                    type="button"
                    onClick={async () => {
                      await triggerHaptic();
                      try {
                        setIsCapturingReceipt(true);
                        const image = await Camera.getPhoto({
                          quality: 80,
                          allowEditing: false,
                          resultType: CameraResultType.Uri
                        });
                        
                        if (image && image.webPath) {
                          const base64Url = image.webPath;
                          const previewImg = document.getElementById('receipt-img-preview') as HTMLImageElement;
                          if (previewImg) {
                            previewImg.src = base64Url;
                            previewImg.style.display = 'block';
                          }
                          const indicator = document.getElementById('temp-receipt-photo-src') as HTMLInputElement;
                          if (indicator) indicator.value = base64Url;
                          showToast("📸 Receipt photo captured!");
                        }
                      } catch (err) {
                        console.log("Capacitor camera failed or cancelled, trying hybrid file trigger", err);
                        // Trigger native device file capture fallback
                        document.getElementById('receipt-file-picker')?.click();
                      } finally {
                        setIsCapturingReceipt(false);
                      }
                    }}
                    disabled={isCapturingReceipt}
                    className="py-2 px-3 bg-[var(--color-accent,#DF5504)] hover:bg-[var(--color-accent,#DF5504)]/90 text-white font-bold rounded flex items-center justify-center gap-1.5 border border-black shadow-[2px_2px_0px_0px_#000] cursor-pointer"
                  >
                    <span>{isCapturingReceipt ? '📸 Camera Active...' : '📸 Snap Receipt Photo'}</span>
                  </button>
                  <span className="text-[8px] text-gray-500 uppercase tracking-widest font-black">Requires camera access permissions</span>
                  {/* Secret state container */}
                  <input type="hidden" id="temp-receipt-photo-src" />
                </div>
              </div>

              {/* Merchant and Amount Grid */}
              <div className="grid grid-cols-2 gap-3.5">
                <div className="flex flex-col gap-1">
                  <label htmlFor="receipt-merchant-input" className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Merchant Name</label>
                  <input
                    type="text"
                    id="receipt-merchant-input"
                    placeholder="e.g. Starbucks"
                    className="bg-black/60 border border-[var(--color-dark-tertiary,#3D3D3D)] text-white hover:border-gray-500 focus:border-[var(--color-accent,#DF5504)] outline-none rounded p-2 text-[10px] font-bold"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="receipt-amount-input" className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Claim Amount ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    id="receipt-amount-input"
                    placeholder="0.00"
                    className="bg-black/60 border border-[var(--color-dark-tertiary,#3D3D3D)] text-white hover:border-gray-500 focus:border-[var(--color-accent,#DF5504)] outline-none rounded p-2 text-[10px] font-bold"
                  />
                </div>
              </div>

              {/* Claims notes details */}
              <div className="flex flex-col gap-1">
                <label htmlFor="receipt-notes-input" className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Purpose / Notes</label>
                <input
                  type="text"
                  id="receipt-notes-input"
                  placeholder="e.g. Client coffee meeting"
                  className="bg-black/60 border border-[var(--color-dark-tertiary,#3D3D3D)] text-white hover:border-gray-500 focus:border-[var(--color-accent,#DF5504)] outline-none rounded p-2 text-[10px] font-bold"
                />
              </div>

              <button
                type="submit"
                className="py-2.5 bg-black border-2 border-[var(--color-accent,#DF5504)] hover:bg-[var(--color-accent,#DF5504)] text-white hover:text-white font-black uppercase rounded text-[10px] transition-all cursor-pointer shadow-[4px_4px_0px_0px_#000] active:translate-y-0.5 active:shadow-[2px_2px_0px_0px_#000] mt-1"
              >
                💾 Record Expenditure Claim
              </button>
            </form>

            {/* Scrollable Claims Feed */}
            <div className="flex-grow overflow-y-auto pr-1">
              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-black block mb-2 border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-1">Logged Receipts Feed</span>

              {receipts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                  <span className="text-2xl">🧾</span>
                  <span className="font-bold text-gray-400 uppercase tracking-wider text-[10px]">No receipt claims logged today.</span>
                  <span className="text-[9px] text-gray-500 uppercase">Snap your first photo receipt to file a claim!</span>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {receipts.map((log) => {
                    const timeStr = new Date(log.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                    const dateStr = new Date(log.timestamp).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

                    return (
                      <div
                        key={log.id}
                        className="p-3 bg-black/20 rounded border border-[var(--color-dark-tertiary,#3D3D3D)]/50 flex gap-3 items-center relative"
                      >
                        {/* Receipt Thumbnail */}
                        <div className="w-12 h-12 rounded border border-[var(--color-dark-tertiary,#3D3D3D)]/40 bg-black overflow-hidden flex-shrink-0">
                          <img src={log.imageUrl} alt="" className="w-full h-full object-cover" />
                        </div>

                        {/* Text summary details */}
                        <div className="flex-grow flex flex-col gap-0.5 min-w-0">
                          <div className="flex justify-between items-center gap-1">
                            <span className="font-black text-white text-[11px] truncate">{log.merchant}</span>
                            <span className="font-black text-[var(--color-accent,#DF5504)] text-[11px] flex-shrink-0">${log.amount.toFixed(2)}</span>
                          </div>
                          <span className="text-[8px] text-gray-400 font-bold uppercase tracking-wider">
                            📅 {dateStr} at {timeStr}
                          </span>
                          {log.notes && (
                            <p className="text-[9px] text-gray-300 italic truncate font-bold">
                              "{log.notes}"
                            </p>
                          )}
                        </div>

                        {/* Quick Delete claim */}
                        <button
                          onClick={async () => {
                            await triggerHaptic();
                            setReceipts((prev) => prev.filter(r => r.id !== log.id));
                            showToast(`🧾 Claim for ${log.merchant} removed`);
                          }}
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-950 border border-red-800 text-red-400 flex items-center justify-center font-bold text-[8px] hover:bg-red-900 hover:text-white transition-colors cursor-pointer"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end gap-2 mt-2 pt-3 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40 flex-shrink-0">
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIsReceiptsOpen(false);
                }}
                className="px-4 py-2 bg-black border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white font-bold rounded"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ❓ DASHBOARD HELP OVERLAY MODAL */}
      {isDashboardHelpOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[var(--color-dark-secondary,#333333)] border-2 border-[var(--color-accent,#DF5504)] p-5 rounded-lg shadow-[8px_8px_0px_0px_#000] font-mono text-xs flex flex-col gap-4 max-h-[90vh] overflow-hidden animate-fadeIn">
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b-2 border-[var(--color-dark-tertiary,#3D3D3D)] pb-3 flex-shrink-0">
              <span className="font-black text-sm text-[var(--color-accent,#DF5504)] uppercase tracking-wider flex items-center gap-2">
                ❓ Dashboard Quick Runbook
              </span>
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIsDashboardHelpOpen(false);
                }}
                className="text-gray-400 hover:text-white font-black text-sm p-1 border-none bg-transparent cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Scrollable Content */}
            <div className="overflow-y-auto pr-1 flex flex-col gap-4 leading-relaxed text-gray-300">
              <div className="border-l-2 border-[var(--color-accent,#DF5504)] pl-3 py-1 bg-black/20 text-[10px]">
                <p className="font-bold text-white mb-0.5">BOARD QUICK RUNBOOK</p>
                <p className="text-gray-400 font-bold">
                  A high-level guide to navigating the main board list interface. Detailed card edits are found within the Card's own help icon.
                </p>
              </div>

              <div className="flex flex-col gap-3 font-mono text-[10px]">
                {/* Section 1: Board Structure */}
                <div className="flex gap-2.5 items-start border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 pb-2">
                  <span className="text-sm select-none">🎛️</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-black text-white uppercase tracking-wide">Board Columns (Lists)</span>
                    <span className="font-bold text-gray-400">Your work is split into three lists: <strong className="text-white">TO DO</strong> (pending actions), <strong className="text-white">DOING</strong> (active focus), and <strong className="text-white">DONE</strong> (completed items). The count shows the active cards in each.</span>
                  </div>
                </div>

                {/* Section 2: Mobile Swiping */}
                <div className="flex gap-2.5 items-start border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 pb-2">
                  <span className="text-sm select-none">📱</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-black text-white uppercase tracking-wide">Mobile Column Navigation</span>
                    <span className="font-bold text-gray-400">On mobile, <strong className="text-white">swipe left or right</strong> on the screen to slide between columns, or tap the pagination dots at the top of the board to jump directly to a list.</span>
                  </div>
                </div>

                {/* Section 3: Card Selection & Creation */}
                <div className="flex gap-2.5 items-start border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 pb-2">
                  <span className="text-sm select-none">📄</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-black text-white uppercase tracking-wide">Card Interaction</span>
                    <ul className="list-disc pl-4 flex flex-col gap-0.5 text-gray-400 mt-1 font-bold">
                      <li><strong className="text-white">Select a Card</strong>: Tap any card's frame to open the Card Details modal (to edit checklist bullets, set alarms, or attach documents).</li>
                      <li><strong className="text-white">Create a Card</strong>: Tap the <strong className="text-[var(--color-accent,#DF5504)]">+</strong> icon in the header bar to create a card in the current column.</li>
                    </ul>
                  </div>
                </div>

                {/* Section 4: Changing Lists (Moving Cards) */}
                <div className="flex gap-2.5 items-start border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 pb-2">
                  <span className="text-sm select-none">🔄</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-black text-white uppercase tracking-wide">Moving Cards between columns</span>
                    <span className="font-bold text-gray-400">Tap the orange <strong className="text-[var(--color-accent,#DF5504)]">MOVE ▾</strong> button in the bottom-right of any card to instantly shift columns. On desktop, click and drag cards directly to any list column.</span>
                  </div>
                </div>

                {/* Section 5: Card Progress & Active Timers */}
                <div className="flex gap-2.5 items-start border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 pb-2">
                  <span className="text-sm select-none">⏱️</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-black text-white uppercase tracking-wide">Timers & Checklist Indicators</span>
                    <ul className="list-disc pl-4 flex flex-col gap-0.5 text-gray-400 mt-1 font-bold">
                      <li><strong className="text-white">Spent Timer (e.g. 15m spent)</strong>: Displays total time spent on this card, updated by active Pomodoro study sessions.</li>
                      <li><strong className="text-white">Task Progress</strong>: Shows percentage progress and next pending sub-checklist items directly on the card face.</li>
                    </ul>
                  </div>
                </div>

                {/* Section 6: Global Feature Icons */}
                <div className="flex gap-2.5 items-start">
                  <span className="text-sm select-none">🕹️</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-black text-white uppercase tracking-wide">Global Footer Icons</span>
                    <span className="font-bold text-gray-400">Tapping the icons in the bottom navigation bar launches primary utilities:</span>
                    <ul className="list-disc pl-4 flex flex-col gap-0.5 text-gray-400 mt-1 font-bold">
                      <li><strong className="text-white">📅 Calendar</strong>: Toggle the native agenda timetable overlay.</li>
                      <li><strong className="text-white">📔 Verbal Journal</strong>: Launch speech recording entries.</li>
                      <li><strong className="text-white">🧾 Receipts</strong>: Log claims and upload expense captures.</li>
                      <li><strong className="text-white">🍅 Pomodoro</strong>: Launch study timers mapped to iOS Focus Modes.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 📁 GLOBAL HIDDEN FILE PICKER */}
      <input 
        type="file" 
        id="global-file-picker" 
        className="hidden"
        style={{ display: 'none' }} 
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            const sizeKB = (file.size / 1024).toFixed(1);
            showToast(`📁 Selected: ${file.name} (${sizeKB} KB)`);
          }
        }} 
      />

      {/* 📔 VERBAL DIARY & CARD DISPATCH POPUP MODAL */}
      {isDiaryOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[var(--color-dark-secondary,#333333)] border-2 border-[var(--color-accent,#DF5504)] p-5 rounded-lg shadow-[8px_8px_0px_0px_#000] font-mono text-xs flex flex-col gap-4 max-h-[90vh] overflow-hidden animate-fadeIn">
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b-2 border-[var(--color-dark-tertiary,#3D3D3D)] pb-3 flex-shrink-0">
              <span className="font-black text-sm text-[var(--color-accent,#DF5504)] uppercase tracking-wider flex items-center gap-2">
                📔 Verbal Diary Journal
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    await triggerHaptic();
                    setShowDiaryHelp(!showDiaryHelp);
                  }}
                  className={`w-6 h-6 rounded-full border flex items-center justify-center font-bold text-xs transition-all cursor-pointer ${
                    showDiaryHelp
                      ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                      : 'bg-black/40 hover:bg-black/80 border-[var(--color-dark-tertiary,#3D3D3D)] text-gray-300'
                  }`}
                  title="Help Guide"
                >
                  ❓
                </button>
                <button
                  onClick={async () => {
                    await triggerHaptic();
                    setIsDiaryOpen(false);
                    setShowDiaryHelp(false);
                  }}
                  className="w-6 h-6 rounded-full bg-black/40 hover:bg-black/80 border border-[var(--color-dark-tertiary,#3D3D3D)] text-white flex items-center justify-center font-bold text-sm transition-colors cursor-pointer"
                >
                  ×
                </button>
              </div>
            </div>

            {/* ℹ️ Sliding Help Guide Box */}
            {showDiaryHelp && (
              <div className="bg-black/80 border border-[var(--color-accent,#DF5504)]/40 p-4 rounded-lg flex flex-col gap-2 max-h-[40vh] overflow-y-auto animate-fadeIn flex-shrink-0">
                <span className="font-black text-[10px] text-[var(--color-accent,#DF5504)] uppercase tracking-widest">💡 Quick Help Guide</span>
                <ul className="list-disc pl-4 text-[10px] text-gray-300 flex flex-col gap-1.5 leading-relaxed font-bold">
                  <li><span className="text-white">🎙️ Dictate Note</span>: Tap the red microphone button to start recording your thoughts. Speak clearly to transcribe your speech.</li>
                  <li><span className="text-white">🕒 Auto Timestamps</span>: Your recorded reflections are automatically date-and-time stamped to construct a chronological work timeline.</li>
                  <li><span className="text-white">📤 Card Dispatching</span>: Use the orange dispatch dropdown menu to instantly attach/prepend any note to your active task cards grouped by columns.</li>
                </ul>
              </div>
            )}

            {/* Microphone Dictation Action Panel */}
            <div className="bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)]/40 p-4 rounded flex flex-col items-center gap-3 flex-shrink-0">
              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-black">Daily Journal Log</span>
              
              <div className="flex flex-col items-center gap-2 w-full">
                <button
                  onClick={async () => {
                    await triggerHaptic();
                    if (isRecording) {
                      await stopDictation();
                    } else {
                      await startDictation();
                    }
                  }}
                  className={`w-14 h-14 rounded-full flex items-center justify-center text-xl shadow-[4px_4px_0px_0px_#000] active:translate-y-1 active:shadow-[0px_0px_0px_0px_#000] transition-all cursor-pointer ${
                    isRecording 
                      ? 'bg-red-600 text-white animate-pulse border-2 border-white' 
                      : 'bg-[var(--color-accent,#DF5504)] hover:bg-[var(--color-accent,#DF5504)]/90 text-white border border-black'
                  }`}
                  title={isRecording ? "Stop Recording" : "Start Voice Dictation"}
                >
                  🎙️
                </button>

                <span className={`text-[10px] font-bold uppercase tracking-wider ${isRecording ? 'text-red-500 animate-pulse' : 'text-gray-400'}`}>
                  {isRecording ? '🔴 Listening... Tap to Save' : '🎙️ Tap to Dictate Daily Note'}
                </span>
              </div>

              {/* Inline Keyboard Entry Fallback Container */}
              <div className="w-full flex flex-col gap-2 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/30 pt-3">
                <span className="text-[9px] text-gray-500 uppercase font-black font-mono self-start">✍️ Or Type Journal Reflection:</span>
                <div className="flex gap-2 w-full">
                  <input 
                    type="text"
                    placeholder="Type journal entry or reflection here..."
                    value={typedDiaryText}
                    onChange={(e) => setTypedDiaryText(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter' && typedDiaryText.trim()) {
                        e.preventDefault();
                        await triggerHaptic();
                        const newLog = {
                          id: 'log-' + Date.now(),
                          timestamp: Date.now(),
                          text: typedDiaryText.trim()
                        };
                        setVoiceLogs(prev => [newLog, ...prev]);
                        setTypedDiaryText('');
                        showToast("✍️ Added Typed Daily Reflection!");
                      }
                    }}
                    className="flex-grow bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] px-3 py-1.5 text-xs text-white rounded font-mono focus:border-[var(--color-accent,#DF5504)] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (typedDiaryText.trim()) {
                        await triggerHaptic();
                        const newLog = {
                          id: 'log-' + Date.now(),
                          timestamp: Date.now(),
                          text: typedDiaryText.trim()
                        };
                        setVoiceLogs(prev => [newLog, ...prev]);
                        setTypedDiaryText('');
                        showToast("✍️ Added Typed Daily Reflection!");
                      }
                    }}
                    className="px-3 py-1.5 bento-btn text-white text-[10px] font-black uppercase rounded cursor-pointer transition-all flex items-center justify-center gap-1"
                  >
                    <span>＋</span> Add
                  </button>
                </div>
              </div>
            </div>

            {/* Scrollable Diary Feed List */}
            <div className="flex-grow overflow-y-auto pr-1">
              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-black block mb-2 border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-1">Today's Verbal Timeline</span>

              {voiceLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                  <span className="text-2xl">✍️</span>
                  <span className="font-bold text-gray-400 uppercase tracking-wider text-[10px]">Your diary is completely empty.</span>
                  <span className="text-[9px] text-gray-500 uppercase">Tap the mic to record your thoughts!</span>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {voiceLogs.map((evt) => {
                    const start = new Date(evt.timestamp);
                    const isAssigned = !!evt.assignedCardId;
                    const assignedCard = cards.find(c => c.id === evt.assignedCardId);

                    return (
                      <div
                        key={evt.id}
                        className={`p-3 bg-black/20 rounded border transition-all ${
                          isAssigned
                            ? 'border-[var(--color-dark-tertiary,#3D3D3D)]/40 opacity-75'
                            : 'border-[var(--color-accent,#DF5504)]/40 border-l-4 border-l-[var(--color-accent,#DF5504)]'
                        }`}
                      >
                        {/* Header Details */}
                        <div className="flex justify-between items-center mb-1.5 pb-1 border-b border-[var(--color-dark-tertiary,#3D3D3D)]/20">
                          <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">
                            🕒 {start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          
                          {/* Dispatcher Dropdown Select box */}
                          <div className="flex items-center gap-1.5">
                            {isAssigned && assignedCard ? (
                              <span className="text-[8px] bg-green-950/60 border border-green-800 text-green-400 font-bold uppercase px-1.5 py-0.5 rounded tracking-wider">
                                📥 Dispatched
                              </span>
                            ) : (
                              <select
                                onChange={async (e) => {
                                  const cardId = e.target.value;
                                  if (cardId) {
                                    await triggerHaptic();
                                    dispatchLogToCard(evt.id, cardId);
                                    e.target.value = ''; // Reset select box index
                                  }
                                }}
                                className="bg-black/80 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-gray-500 text-white font-mono text-[8px] uppercase font-bold px-1.5 py-0.5 rounded cursor-pointer max-w-[100px] outline-none"
                              >
                                <option value="">📤 Dispatch</option>
                                {lists.map(list => {
                                  const listCards = cards.filter(c => c.listId === list.id);
                                  if (listCards.length === 0) return null;
                                  return (
                                    <optgroup key={list.id} label={list.name.toUpperCase()} className="bg-black text-gray-500 font-bold text-[8px]">
                                      {listCards.map(card => (
                                        <option key={card.id} value={card.id} className="text-white bg-black">
                                          {card.title.substring(0, 16)}{card.title.length > 16 ? '...' : ''}
                                        </option>
                                      ))}
                                    </optgroup>
                                  );
                                })}
                              </select>
                            )}
                          </div>
                        </div>

                        {/* Transcribed Text */}
                        <p className="text-white text-[10px] leading-relaxed font-bold">
                          "{evt.text}"
                        </p>

                        {/* Target task indicator */}
                        {isAssigned && assignedCard && (
                          <div className="text-[8px] text-green-400/80 mt-1 flex items-center gap-1 font-bold">
                            <span>↪️</span>
                            <span className="truncate">Sent to: "{assignedCard.title}"</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end gap-2 mt-2 pt-3 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40 flex-shrink-0">
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIsDiaryOpen(false);
                }}
                className="px-4 py-2 bg-black border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white font-bold rounded"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🍅 GLOBAL STANDALONE POMODORO TIMER POPUP MODAL */}
      {isTimerModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className={`w-full max-w-sm bg-[var(--color-dark-secondary,#333333)] border-2 p-5 rounded-lg shadow-[8px_8px_0px_0px_#000] font-mono text-xs flex flex-col gap-4 max-h-[90vh] overflow-hidden animate-fadeIn ${
            pomodoroSelectedFocusMode === 'dnd'
              ? 'border-red-500 shadow-[8px_8px_0px_0px_rgba(239,68,68,0.25)]'
              : pomodoroSelectedFocusMode === 'personal'
              ? 'border-emerald-500 shadow-[8px_8px_0px_0px_rgba(16,185,129,0.25)]'
              : pomodoroSelectedFocusMode === 'sleep'
              ? 'border-violet-500 shadow-[8px_8px_0px_0px_rgba(139,92,246,0.25)]'
              : pomodoroSelectedFocusMode === 'driving'
              ? 'border-cyan-500 shadow-[8px_8px_0px_0px_rgba(6,182,212,0.25)]'
              : pomodoroSelectedFocusMode === 'study'
              ? 'border-orange-500 shadow-[8px_8px_0px_0px_rgba(249,115,22,0.25)]'
              : 'border-[var(--color-accent,#DF5504)] shadow-[8px_8px_0px_0px_rgba(223,85,4,0.25)]'
          }`}>
            
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b-2 border-[var(--color-dark-tertiary,#3D3D3D)] pb-3 flex-shrink-0">
              <span className="font-black text-sm text-[var(--color-accent,#DF5504)] uppercase tracking-wider flex items-center gap-2">
                🍅 Standalone Study Timer
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    await triggerHaptic();
                    setShowTimerHelp(!showTimerHelp);
                  }}
                  className={`w-6 h-6 rounded-full border flex items-center justify-center font-bold text-xs transition-all cursor-pointer ${
                    showTimerHelp
                      ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                      : 'bg-black/40 hover:bg-black/80 border-[var(--color-dark-tertiary,#3D3D3D)] text-gray-300'
                  }`}
                  title="Help Guide"
                >
                  ❓
                </button>
                <button
                  onClick={async () => {
                    await triggerHaptic();
                    setIsTimerModalOpen(false);
                    setShowTimerHelp(false);
                  }}
                  className="w-6 h-6 rounded-full bg-black/40 hover:bg-black/80 border border-[var(--color-dark-tertiary,#3D3D3D)] text-white flex items-center justify-center font-bold text-sm transition-colors cursor-pointer"
                >
                  ×
                </button>
              </div>
            </div>

            {/* ℹ️ Sliding Help Guide Box */}
            {showTimerHelp && (
              <div className="bg-black/80 border border-[var(--color-accent,#DF5504)]/40 p-3.5 rounded-lg flex flex-col gap-2 max-h-[30vh] overflow-y-auto animate-fadeIn flex-shrink-0 text-[10px] text-gray-300">
                <span className="font-black text-[10px] text-[var(--color-accent,#DF5504)] uppercase tracking-widest">💡 Standalone Pomodoro Runbook</span>
                <p className="leading-relaxed font-bold">
                  This study session timer is completely separate from individual card timers and runs as its own high-precision stopwatch:
                </p>
                <ul className="list-disc pl-4 flex flex-col gap-1 leading-relaxed font-bold">
                  <li><span className="text-white">🍅 Work Session</span>: Focus intensely for 25 minutes.</li>
                  <li><span className="text-white">☕ Short Break</span>: Rest your eyes and relax for 5 minutes.</li>
                  <li><span className="text-white">🛌 Long Break</span>: Unwind or reset with a longer 15-minute break.</li>
                  <li><span className="text-white">🔔 Native Notifications</span>: Will fire push notifications and physical device vibrations when the timer completes.</li>
                </ul>
              </div>
            )}

            {/* Huge Glowing Clock Display */}
            <div className="bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)]/40 p-6 rounded flex flex-col items-center justify-center gap-1.5 flex-shrink-0 relative overflow-hidden">
              {/* Pulse effect if active */}
              {isPomodoroRunning && (
                <div className="absolute inset-0 bg-[var(--color-accent,#DF5504)]/5 animate-pulse pointer-events-none"></div>
              )}
              
              <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${
                pomodoroSelectedFocusMode === 'dnd'
                  ? 'bg-red-950/40 text-red-400 border-red-900/50'
                  : pomodoroSelectedFocusMode === 'personal'
                  ? 'bg-emerald-950/40 text-emerald-400 border-emerald-900/50'
                  : pomodoroSelectedFocusMode === 'sleep'
                  ? 'bg-violet-950/40 text-violet-400 border-violet-900/50'
                  : pomodoroSelectedFocusMode === 'driving'
                  ? 'bg-cyan-950/40 text-cyan-400 border-cyan-900/50'
                  : pomodoroSelectedFocusMode === 'study'
                  ? 'bg-orange-950/40 text-orange-400 border-orange-900/50'
                  : 'bg-amber-950/40 text-amber-400 border-amber-900/50'
              }`}>
                {pomodoroSelectedFocusMode === 'study' && '📚 Study Focus'}
                {pomodoroSelectedFocusMode === 'work' && '💼 Work Focus'}
                {pomodoroSelectedFocusMode === 'dnd' && '🔇 Do Not Disturb'}
                {pomodoroSelectedFocusMode === 'personal' && '🏠 Personal Focus'}
                {pomodoroSelectedFocusMode === 'sleep' && '🛌 Sleep Focus'}
                {pomodoroSelectedFocusMode === 'driving' && '🚗 Driving Focus'}
                {` — ${isPomodoroRunning ? 'Active' : 'Paused'}`}
              </span>

              <div className="text-5xl font-black font-mono tracking-widest text-white drop-shadow-[0_2px_10px_rgba(223,85,4,0.15)] my-2 flex items-center justify-center">
                {formatPomodoroTime(pomodoroTimeLeft)}
              </div>

              <span className="text-[9px] text-gray-500 font-bold uppercase tracking-widest">
                {isPomodoroRunning ? '⏳ Countdown Ticking...' : '⏹️ Session Paused'}
              </span>
            </div>

            {/* Target iOS Focus Mode Selector Grid */}
            <div className="flex flex-col gap-1.5 flex-shrink-0">
              <label className="text-[9px] font-mono font-bold uppercase text-gray-400">
                🎯 Target iOS Focus Mode
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { value: 'study', label: '📚 Study' },
                  { value: 'work', label: '💼 Work' },
                  { value: 'dnd', label: '🔇 DND' },
                  { value: 'personal', label: '🏠 Personal' },
                  { value: 'sleep', label: '🛌 Sleep' },
                  { value: 'driving', label: '🚗 Driving' },
                ].map((item) => {
                  const isActive = pomodoroSelectedFocusMode === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={async () => {
                        await triggerHaptic();
                        setIsPomodoroRunning(false);
                        const targetFocus = item.value as 'dnd' | 'work' | 'personal' | 'sleep' | 'driving' | 'study';
                        setPomodoroSelectedFocusMode(targetFocus);
                        
                        // Instantly switch timer to the primary preset of the chosen focus mode
                        const primaryPreset = POMODORO_PRESETS[targetFocus][0];
                        setPomodoroTimeLeft(primaryPreset.minutes * 60);
                      }}
                      className={`py-2 px-1 rounded font-mono text-[9px] font-black uppercase tracking-tight text-center transition-all border ${
                        isActive
                          ? item.value === 'dnd'
                            ? 'bg-red-500/20 text-red-400 border-red-500 shadow-[2px_2px_0px_0px_#ef4444]'
                            : item.value === 'personal'
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500 shadow-[2px_2px_0px_0px_#10b981]'
                            : item.value === 'sleep'
                            ? 'bg-violet-500/20 text-violet-400 border-violet-500 shadow-[2px_2px_0px_0px_#8b5cf6]'
                            : item.value === 'driving'
                            ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500 shadow-[2px_2px_0px_0px_#06b6d4]'
                            : item.value === 'study'
                            ? 'bg-orange-500/20 text-orange-400 border-orange-500 shadow-[2px_2px_0px_0px_#f97316]'
                            : 'bg-amber-500/20 text-amber-400 border-amber-500 shadow-[2px_2px_0px_0px_#f59e0b]'
                          : 'bg-black/30 text-gray-400 border-[var(--color-dark-tertiary,#3D3D3D)] hover:text-white hover:border-gray-500 active:translate-y-0.5'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Mode Selector Buttons */}
            <div className="grid grid-cols-3 gap-1.5 flex-shrink-0">
              {POMODORO_PRESETS[pomodoroSelectedFocusMode].map((preset, index) => {
                const isSelected = pomodoroTimeLeft === preset.minutes * 60;
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={async () => {
                      await triggerHaptic();
                      setIsPomodoroRunning(false);
                      setPomodoroTimeLeft(preset.minutes * 60);
                    }}
                    className={`py-1.5 rounded font-mono text-[9px] font-black uppercase tracking-wider transition-all border ${
                      isSelected
                        ? pomodoroSelectedFocusMode === 'dnd'
                          ? 'bg-red-600/20 text-red-400 border-red-500'
                          : pomodoroSelectedFocusMode === 'personal'
                          ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500'
                          : pomodoroSelectedFocusMode === 'sleep'
                          ? 'bg-violet-600/20 text-violet-400 border-violet-500'
                          : pomodoroSelectedFocusMode === 'driving'
                          ? 'bg-cyan-600/20 text-cyan-400 border-cyan-500'
                          : pomodoroSelectedFocusMode === 'study'
                          ? 'bg-orange-600/20 text-orange-400 border-orange-500'
                          : 'bg-amber-600/20 text-amber-400 border-amber-500'
                        : 'bg-black/30 text-gray-400 border-[var(--color-dark-tertiary,#3D3D3D)] hover:text-white'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {/* iOS System Integrations Preferences */}
            <div className="bg-black/20 border border-[var(--color-dark-tertiary,#3D3D3D)]/40 p-2.5 rounded flex flex-col gap-2 flex-shrink-0 font-mono text-[9px] text-gray-300">
              <span className="font-black text-[9px] text-gray-500 uppercase tracking-widest border-b border-[var(--color-dark-tertiary,#3D3D3D)]/25 pb-1 mb-1 block">📱 iOS SYSTEM INTEGRATIONS</span>
              
              <label className="flex items-center justify-between cursor-pointer py-0.5">
                <span className="font-bold flex items-center gap-1.5">
                  <span>🔔</span> Lock-Screen Alerts
                </span>
                <input 
                  type="checkbox"
                  checked={pomodoroEnableNotifications}
                  onChange={(e) => {
                    triggerHaptic();
                    setPomodoroEnableNotifications(e.target.checked);
                  }}
                  className="w-3.5 h-3.5 rounded border-[var(--color-dark-tertiary,#3D3D3D)] text-[var(--color-accent,#DF5504)] focus:ring-[var(--color-accent,#DF5504)] cursor-pointer accent-[var(--color-accent,#DF5504)] bg-black"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer py-0.5">
                <span className="font-bold flex items-center gap-1.5">
                  <span>⚡</span> Time-Sensitive (Bypass Focus)
                </span>
                <input 
                  type="checkbox"
                  checked={pomodoroEnableTimeSensitive}
                  disabled={!pomodoroEnableNotifications}
                  onChange={(e) => {
                    triggerHaptic();
                    setPomodoroEnableTimeSensitive(e.target.checked);
                  }}
                  className={`w-3.5 h-3.5 rounded border-[var(--color-dark-tertiary,#3D3D3D)] text-[var(--color-accent,#DF5504)] focus:ring-[var(--color-accent,#DF5504)] cursor-pointer accent-[var(--color-accent,#DF5504)] bg-black ${!pomodoroEnableNotifications ? 'opacity-40' : ''}`}
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer py-0.5">
                <span className="font-bold flex items-center gap-1.5">
                  <span>💓</span> Haptic Vibrations
                </span>
                <input 
                  type="checkbox"
                  checked={pomodoroEnableHaptics}
                  onChange={(e) => {
                    triggerHaptic();
                    setPomodoroEnableHaptics(e.target.checked);
                  }}
                  className="w-3.5 h-3.5 rounded border-[var(--color-dark-tertiary,#3D3D3D)] text-[var(--color-accent,#DF5504)] focus:ring-[var(--color-accent,#DF5504)] cursor-pointer accent-[var(--color-accent,#DF5504)] bg-black"
                />
              </label>
            </div>

            {/* Running Actions Controls */}
            <div className="grid grid-cols-2 gap-2 flex-shrink-0 mt-1">
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIsPomodoroRunning(!isPomodoroRunning);
                }}
                className={`py-2 text-[10px] font-mono font-black uppercase tracking-wider rounded transition-all shadow-[2px_2px_0px_0px_#000] active:translate-y-0.5 active:shadow-[0px_0px_0px_0px_#000] ${
                  isPomodoroRunning
                    ? 'bg-yellow-600 hover:bg-yellow-500 text-white border border-yellow-700'
                    : 'bg-[var(--color-accent,#DF5504)] hover:bg-[var(--color-accent,#DF5504)]/90 text-white border border-black'
                }`}
              >
                {isPomodoroRunning ? '⏸️ Pause' : '▶️ Start'}
              </button>
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIsPomodoroRunning(false);
                  const primaryPreset = POMODORO_PRESETS[pomodoroSelectedFocusMode][0];
                  setPomodoroTimeLeft(primaryPreset.minutes * 60);
                }}
                className="py-2 text-[10px] font-mono font-black uppercase tracking-wider bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] text-white hover:bg-black/30 rounded transition-all shadow-[2px_2px_0px_0px_#000] active:translate-y-0.5 active:shadow-[0px_0px_0px_0px_#000]"
              >
                🔄 Reset
              </button>
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end mt-1 pt-3 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40 flex-shrink-0">
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIsTimerModalOpen(false);
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
