import { useState, useEffect, useRef } from 'react';
import { useCapacitor } from './hooks/useCapacitor';
import { useFilesystem } from './hooks/useFilesystem';
import { config } from './factory-config';
import { CapacitorCalendar } from '@ebarooni/capacitor-calendar';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Camera, CameraResultType } from '@capacitor/camera';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { Ocr } from '@capacitor-community/image-to-text';
import { App as CapApp } from '@capacitor/app';


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
  filePath?: string; // Physical sandbox filesystem path (if saved locally)
  addedAt: number;
}

export interface ResourceCitation {
  id: string;
  title: string;
  url: string;
  notes?: string;
  addedAt: number;
}

export interface StudySession {
  id: string;
  duration: number; // in seconds
  timestamp: number; // epoch timestamp
}

export interface Card {
  id: string;
  listId: string;
  title: string;
  description?: string;
  isTimerRunning?: boolean;
  timeSpent?: number;
  studySessions?: StudySession[];
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
  isArchived?: boolean;
  updatedAt?: number;
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
  const { saveFile, readFile, deleteFile } = useFilesystem();
  const recognitionRef = useRef<any>(null);

  // Native Integration Wrappers
  const syncToAppleCalendar = async (card: Card) => {
    if (!card.dueDate) return;
    try {
      const permission = await CapacitorCalendar.requestWriteOnlyCalendarAccess();
      if (permission.result !== 'granted') {
        showToast("⚠️ Calendar write permission denied! Please enable in Settings.");
        return;
      }

      const startDate = new Date(card.dueDate);
      const endDate = new Date(card.dueDate + 60 * 60 * 1000); // 1 hour duration

      await CapacitorCalendar.createEvent({
        title: `📌 [MTRAx lite] ${card.title}`,
        location: card.description || 'Synced from MTRAx lite mobile app.',
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
          showToast("⚠️ Speech Recognition denied! Please enable Speech Recognition inside iPhone Settings.");
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
            const updatedLogs = [newLog, ...voiceLogs];
            await saveVoiceLogs(updatedLogs);
            showToast("🎙️ Captured On-Device iOS Voice Reflection!");

            // Auto dispatch on creation if selected
            const creationSelect = document.getElementById('creation-auto-dispatch-select') as HTMLSelectElement;
            const targetCardId = creationSelect?.value;
            if (targetCardId) {
              await dispatchLogToCard(newLog.id, targetCardId);
            }
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

        recognition.onresult = async (event: any) => {
          const transcript = event.results[0][0].transcript;
          if (transcript && transcript.trim() !== '') {
            const newLog = {
              id: 'log-' + Date.now(),
              timestamp: Date.now(),
              text: transcript.trim()
            };
            const updatedLogs = [newLog, ...voiceLogs];
            await saveVoiceLogs(updatedLogs);
            showToast("🎙️ Captured Voice Reflection!");

            // Auto dispatch on creation if selected
            const creationSelect = document.getElementById('creation-auto-dispatch-select') as HTMLSelectElement;
            const targetCardId = creationSelect?.value;
            if (targetCardId) {
              await dispatchLogToCard(newLog.id, targetCardId);
            }
          }
        };

        recognition.onerror = (e: any) => {
          console.error("[WebSpeech] Recognition error", e);
          if (e?.error === 'not-allowed') {
            showToast("⚠️ Microphone permission denied! Enable microphone access in browser settings.");
          } else {
            showToast("⚠️ Speech recognition failed!");
          }
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

  const dispatchLogToCard = async (logId: string, cardId: string) => {
    const log = voiceLogs.find(l => l.id === logId);
    if (!log) return;

    const updatedCards = cards.map(card => {
      if (card.id === cardId) {
        const timeStr = new Date(log.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const annotation = `🎙️ [Voice Log - ${timeStr}] ${log.text}`;
        return {
          ...card,
          description: card.description ? `${card.description}\n\n${annotation}` : annotation
        };
      }
      return card;
    });
    await saveCards(updatedCards);

    // Mark as assigned/dispatched
    const updatedLogs = voiceLogs.map(l => l.id === logId ? { ...l, assignedCardId: cardId } : l);
    await saveVoiceLogs(updatedLogs);
    showToast("📤 Dispatched Voice Log to Card!");
  };

  const scheduleLocalAlarm = async (card: Card) => {
    if (!card.dueDate) return;
    try {
      const perm = await LocalNotifications.requestPermissions();
      if (perm.display !== 'granted') {
        showToast("⚠️ Alarms disabled! Grant Notification permissions in iPhone Settings.");
        return;
      }

      // Extract numerical ID from string, fallback to timestamp
      const numericId = parseInt(card.id.replace(/\D/g, '')) || Date.now();

      await LocalNotifications.schedule({
        notifications: [
          {
            id: numericId,
            title: "⏰ MTRAx Task Due Now!",
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
      if (perm.display !== 'granted') {
        showToast("⚠️ Checklist alarms disabled! Grant Notification permissions in iPhone Settings.");
        return;
      }

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
  const [currentLanguage, setCurrentLanguage] = useState<'en' | 'es' | 'fr' | 'de'>(() => {
    return (localStorage.getItem('mtrax_language') as 'en' | 'es' | 'fr' | 'de') || 'en';
  });

  useEffect(() => {
    localStorage.setItem('mtrax_language', currentLanguage);
  }, [currentLanguage]);

  const translations = {
    en: {
      menuTitle: "MTRAx Board Menu",
      close: "Close",
      runbookTitle: "MTRAx Settings Runbook",
      exportBackup: "Export Data Backup",
      exportBackupDesc: "Download offline work as standard Excel-compatible CSV database.",
      icloudSync: "Apple iCloud Synchronization",
      icloudSyncDesc: "Check connection, link Enterprise SQL database, or sync devices.",
      labelStudio: "Board Label Studio",
      labelStudioDesc: "Create classification tags, change label text name, or preset colors.",
      diagnostics: "Native Feature Diagnostics",
      diagnosticsDesc: "Inspect active runtime platform, local storage, calendar state, and audio API.",
      langSelection: "Language Selection",
      langSelectionDesc: "Select your preferred language for the user interface.",
      backToDashboard: "Back To Dashboard",
      exportTitle: "Export Data Backup",
      exportTitleDesc: "Save your work to a safe backup file on your computer. Downloads an Excel-compatible spreadsheet showing all of your active task card lists, timesheet focus hours, and checklist progress notes.",
      icloudSyncTitle: "Apple iCloud Synchronization",
      icloudSyncTitleDesc: "Keep your boards perfectly synced across your iPhone, iPad, and Mac. Dynamically saves and matches your lists, checklists, categories, and focus timer logs across all of your Apple devices.",
      labelStudioTitle: "Board Label Studio",
      labelStudioTitleDesc: "Your custom category tag workshop. Create custom labels, choose neon highlight colors, or rename existing categories to instantly prioritize and color-code your cards.",
      diagnosticsTitle: "Feature Diagnostics",
      diagnosticsTitleDesc: "System compatibility test sweeps. Quickly verifies your device compatibility with core features, including tap vibrations, microphone recordings, in-app sounds, local notifications, and system calendar alarms.",
      
      // New Settings keys
      settings: "App Settings",
      settingsDesc: "Configure theme, text sizes, language, storage sources, and admin options.",
      theme: "Theme Mode",
      themeDark: "Dark Mode (Neon Orange)",
      themeLight: "Light Mode (Contrast Black)",
      textSize: "Font Scale",
      sizeStandard: "Standard Size",
      sizeLarge: "Large Size",
      sizeXlarge: "Extra Large Size",
      showLangHeader: "Show Language Selector in Header",
      premiumLocked: "💎 Premium Locked",
      upgradeTitle: "MTRAx Premium Upgrade",
      upgradeDesc: "Unlock cross-device cloud synchronization, offline spreadsheet backup exporting, secure business receipts tracking, and vocal diary entries for a one-time lifetime license.",
      purchaseBtn: "Purchase for $9.99",
      simulatePurchase: "[Simulate App Store Purchase]",
      advancedAdmin: "Advanced Administration",
      appearanceTitle: "🎨 Appearance Settings",
      langTitle: "🌐 Language Settings",
      syncTitle: "☁️ Sync & Data Settings",
      adminTitle: "🛠️ Admin Tools",
    },
    es: {
      menuTitle: "Menú de MTRAx",
      close: "Cerrar",
      runbookTitle: "Guía de Configuración",
      exportBackup: "Copia de Seguridad",
      exportBackupDesc: "Descargue el trabajo sin conexión como base de datos CSV compatible con Excel.",
      icloudSync: "Sincronización con Apple iCloud",
      icloudSyncDesc: "Verifique la conexión, enlace la base de datos SQL o sincronice dispositivos.",
      labelStudio: "Estudio de Etiquetas",
      labelStudioDesc: "Cree etiquetas de classificação, cambie de nombre o preestablezca colores.",
      diagnostics: "Diagnósticos de Funciones Nativas",
      diagnosticsDesc: "Inspeccione la plataforma, el almacenamiento, el calendario y la API de audio.",
      langSelection: "Selección de Idioma",
      langSelectionDesc: "Seleccione su idioma preferido para la interfaz de usuario.",
      backToDashboard: "Volver al Tablero",
      exportTitle: "Copia de Seguridad de Datos",
      exportTitleDesc: "Guarde su trabajo en un archivo de copia de seguridad seguro en su computadora. Descarga una hoja de cálculo compatible con Excel.",
      icloudSyncTitle: "Sincronización con Apple iCloud",
      icloudSyncTitleDesc: "Mantenga sus tableros perfectamente sincronizados en todos sus dispositivos Apple.",
      labelStudioTitle: "Estudio de Etiquetas de Tablero",
      labelStudioTitleDesc: "Su taller de etiquetas de categorías personalizadas. Cree etiquetas personalizadas, elija colores o cambie el nombre.",
      diagnosticsTitle: "Diagnóstico de Funciones",
      diagnosticsTitleDesc: "Barridos de prueba de compatibilidad del sistema. Verifica rápidamente la compatibilidad de su dispositivo.",
      
      // New Settings keys
      settings: "Ajustes de App",
      settingsDesc: "Configure el tema, el tamaño del texto, el idioma, el almacenamiento y las opciones de administración.",
      theme: "Modo de Tema",
      themeDark: "Modo Oscuro (Naranja Neón)",
      themeLight: "Modo Claro (Negro de Contraste)",
      textSize: "Escala de Fuente",
      sizeStandard: "Tamaño Estándar",
      sizeLarge: "Tamaño Grande",
      sizeXlarge: "Tamaño Muy Grande",
      showLangHeader: "Mostrar Selector de Idioma en el Encabezado",
      premiumLocked: "💎 Premium Bloqueado",
      upgradeTitle: "Actualización a MTRAx Premium",
      upgradeDesc: "Desbloquee la sincronización en la nube entre dispositivos, la exportación de copias de seguridad sin conexión, el seguimiento de recibos comerciales y las entradas de voz del diario para obtener una licencia de por vida única.",
      purchaseBtn: "Comprar por $9.99",
      simulatePurchase: "[Simular Compra de App Store]",
      advancedAdmin: "Administración Avanzada",
      appearanceTitle: "🎨 Configuración de Apariencia",
      langTitle: "🌐 Configuración de Idioma",
      syncTitle: "☁️ Sincronización y Datos",
      adminTitle: "🛠️ Herramientas de Administración",
    },
    fr: {
      menuTitle: "Menu de MTRAx",
      close: "Fermer",
      runbookTitle: "Guide de Configuration",
      exportBackup: "Sauvegarde des Données",
      exportBackupDesc: "Téléchargez votre travail hors ligne sous forme de base de données CSV.",
      icloudSync: "Synchronisation Apple iCloud",
      icloudSyncDesc: "Vérifiez la connexion, liez la base de données SQL ou synchronisez.",
      labelStudio: "Studio d'Étiquettes",
      labelStudioDesc: "Créez des étiquettes, modifiez le nom ou prédéfinissez des couleurs.",
      diagnostics: "Diagnostics des Fonctions",
      diagnosticsDesc: "Inspectez la plateforme active, le stockage local et l'état de l'API audio.",
      langSelection: "Sélection de la Langue",
      langSelectionDesc: "Sélectionnez votre langue préférée pour l'interface.",
      backToDashboard: "Retour au Tableau",
      exportTitle: "Sauvegarde des Données",
      exportTitleDesc: "Enregistrez votre travail dans un fichier de sauvegarde sécurisé sur votre ordinateur.",
      icloudSyncTitle: "Synchronisation Apple iCloud",
      icloudSyncTitleDesc: "Gardez vos tableaux parfaitement synchronisés sur votre iPhone, iPad et Mac.",
      labelStudioTitle: "Studio d'Étiquettes de Tableau",
      labelStudioTitleDesc: "Votre atelier de balises de catégories personnalisées. Créez des étiquettes personnalisées.",
      diagnosticsTitle: "Diagnostics des Fonctionnalités",
      diagnosticsTitleDesc: "Balayages de tests de compatibilité système. Vérifie rapidement la compatibilité.",
      
      // New Settings keys
      settings: "Paramètres de l'App",
      settingsDesc: "Configurez le thème, la taille du texte, la langue, le stockage et les options d'administration.",
      theme: "Mode Thème",
      themeDark: "Mode Sombre (Orange Néon)",
      themeLight: "Mode Clair (Noir Contraste)",
      textSize: "Échelle de Police",
      sizeStandard: "Taille Standard",
      sizeLarge: "Grande Taille",
      sizeXlarge: "Très Grande Taille",
      showLangHeader: "Afficher le Sélecteur de Langue dans l'En-tête",
      premiumLocked: "💎 Premium Verrouillé",
      upgradeTitle: "Mise à Niveau MTRAx Premium",
      upgradeDesc: "Déverrouillez la synchronisation cloud multi-appareils, l'exportation de sauvegarde CSV hors ligne, le suivi des reçus commerciaux et le journal vocal pour une licence unique à vie.",
      purchaseBtn: "Acheter pour 9,99 $",
      simulatePurchase: "[Simuler l'Achat sur l'App Store]",
      advancedAdmin: "Administration Avancée",
      appearanceTitle: "🎨 Paramètres d'Apparence",
      langTitle: "🌐 Paramètres de Langue",
      syncTitle: "☁️ Synchronisation et Données",
      adminTitle: "🛠️ Outils d'Administration",
    },
    de: {
      menuTitle: "MTRAx-Board-Menü",
      close: "Schließen",
      runbookTitle: "Konfigurationshandbuch",
      exportBackup: "Datenexport-Backup",
      exportBackupDesc: "Offline-Arbeiten als standardmäßige Excel-kompatible CSV-Datenbank herunterladen.",
      icloudSync: "Apple iCloud-Synchronisierung",
      icloudSyncDesc: "Verbindung prüfen, SQL-Datenbank verknüpfen oder Geräte synchronisieren.",
      labelStudio: "Board-Label-Studio",
      labelStudioDesc: "Klassifizierungs-Tags erstellen, Label-Textnamen ändern oder Farben voreinstellen.",
      diagnostics: "Native Feature-Diagnose",
      diagnosticsDesc: "Aktive Plattform, lokalen Speicher, Kalenderstatus und Audio-API prüfen.",
      langSelection: "Sprachauswahl",
      langSelectionDesc: "Wählen Sie Ihre bevorzugte Sprache für die Benutzeroberfläche.",
      backToDashboard: "Zurück zum Dashboard",
      exportTitle: "Datenexport-Backup",
      exportTitleDesc: "Speichern Sie Ihre Arbeit in einer sicheren Backup-Datei auf Ihrem Computer.",
      icloudSyncTitle: "Apple iCloud-Synchronisierung",
      icloudSyncTitleDesc: "Halten Sie Ihre Boards auf Ihrem iPhone, iPad und Mac perfekt synchronisiert.",
      labelStudioTitle: "Board-Label-Studio",
      labelStudioTitleDesc: "Ihr Workshop für benutzerdefinierte Kategorie-Tags. Erstellen Sie benutzerdefinierte Labels.",
      diagnosticsTitle: "Feature-Diagnose",
      diagnosticsTitleDesc: "Systemkompatibilitätsprüfungen. Überprüft schnell die Kompatibilität.",
      
      // New Settings keys
      settings: "App-Einstellungen",
      settingsDesc: "Konfigurieren Sie Thema, Textgrößen, Sprache, Speicherquellen und Admin-Optionen.",
      theme: "Themen-Modus",
      themeDark: "Dunkler Modus (Neon-Orange)",
      themeLight: "Heller Modus (Kontrast-Schwarz)",
      textSize: "Schriftskalierung",
      sizeStandard: "Standardgröße",
      sizeLarge: "Große Größe",
      sizeXlarge: "Extra Große Größe",
      showLangHeader: "Sprachauswahl im Header anzeigen",
      premiumLocked: "💎 Premium Gesperrt",
      upgradeTitle: "MTRAx Premium-Upgrade",
      upgradeDesc: "Schalten Sie die cloudübergreifende Gerätesynchronisierung, den offline CSV-Datenexport, die geschäftliche Belegverwaltung und das Sprach-Tagebuch für eine einmalige lebenslange Lizenz frei.",
      purchaseBtn: "Kaufen für $9.99",
      simulatePurchase: "[App Store Kauf simulieren]",
      advancedAdmin: "Erweiterte Verwaltung",
      appearanceTitle: "🎨 Darstellungseinstellungen",
      langTitle: "🌐 Spracheinstellungen",
      syncTitle: "☁️ Synchronisierung & Daten",
      adminTitle: "🛠️ Admin-Werkzeuge",
    }
  };

  const t = (key: keyof typeof translations['en']) => {
    return translations[currentLanguage][key] || translations['en'][key];
  };

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
  const [incomingSharedCard, setIncomingSharedCard] = useState<Card | null>(null);
  const [isShareAcknowledgementChecked, setIsShareAcknowledgementChecked] = useState(false);
  const [pendingNavigationAction, setPendingNavigationAction] = useState<(() => void) | null>(null);

  // Helper to determine if the Card Edit Modal has unsaved changes compared to state
  const hasUnsavedCardChanges = (): boolean => {
    if (!selectedCardForEdit) return false;
    
    // Find the original card in our active board state
    const originalCard = cards.find(c => c.id === selectedCardForEdit.id);
    if (!originalCard) {
      // It's a new card. It has changes if either Title or Description are not empty
      return !!selectedCardForEdit.title?.trim() || !!selectedCardForEdit.description?.trim();
    }
    
    // Check basic properties
    if (selectedCardForEdit.title !== originalCard.title) return true;
    if ((selectedCardForEdit.description || '') !== (originalCard.description || '')) return true;
    if (selectedCardForEdit.listId !== originalCard.listId) return true;
    if (selectedCardForEdit.dueDate !== originalCard.dueDate) return true;
    if (selectedCardForEdit.notifyInApp !== originalCard.notifyInApp) return true;
    if (selectedCardForEdit.notifyLocalPanel !== originalCard.notifyLocalPanel) return true;
    if (selectedCardForEdit.notifyCalendarAlarm !== originalCard.notifyCalendarAlarm) return true;
    if (selectedCardForEdit.notifyEmailReminder !== originalCard.notifyEmailReminder) return true;
    
    // Check categories/labels
    const originalLabels = originalCard.labelIds || [];
    const currentLabels = selectedCardForEdit.labelIds || [];
    if (originalLabels.length !== currentLabels.length) return true;
    if (originalLabels.some(id => !currentLabels.includes(id))) return true;
    
    // Check checklists
    const originalChecklists = originalCard.checklists || [];
    const currentChecklists = selectedCardForEdit.checklists || [];
    if (originalChecklists.length !== currentChecklists.length) return true;
    
    for (let i = 0; i < originalChecklists.length; i++) {
      const origCl = originalChecklists[i];
      const currCl = currentChecklists[i];
      if (origCl.items.length !== currCl.items.length) return true;
      for (let j = 0; j < origCl.items.length; j++) {
        const origItem = origCl.items[j];
        const currItem = currCl.items[j];
        if (origItem.text !== currItem.text) return true;
        if (origItem.isChecked !== currItem.isChecked) return true;
        if (origItem.dueDate !== currItem.dueDate) return true;
      }
    }
    
    return false;
  };

  // Guardian function to intercept navigation if card is dirty
  const navigateWithCheck = (action: () => void) => {
    if (hasUnsavedCardChanges()) {
      setPendingNavigationAction(() => action);
    } else {
      action();
    }
  };

  const isReadOnly = selectedCardForEdit ? (selectedCardForEdit.isArchived || selectedCardForEdit.listId === 'done') : false;
  const [isLabelManagerOpen, setIsLabelManagerOpen] = useState(false);
  const [lightboxFile, setLightboxFile] = useState<FileAttachment | null>(null);
  
  // Local temporary modal form inputs
  const [newCitationTitle, setNewCitationTitle] = useState('');
  const [newCitationUrl, setNewCitationUrl] = useState('');
  const [newCloudLinkName, setNewCloudLinkName] = useState('');
  const [newCloudLinkUrl, setNewCloudLinkUrl] = useState('');
  const [academicSearchQuery, setAcademicSearchQuery] = useState('');
  const [academicEngine, setAcademicEngine] = useState('scholar');
  const [subTaskModalItem, setSubTaskModalItem] = useState<ChecklistItem | null>(null);
  const [subTaskModalText, setSubTaskModalText] = useState('');
  const [subTaskModalDueDate, setSubTaskModalDueDate] = useState<number | null>(null);
  const [focusedChecklistItemId, setFocusedChecklistItemId] = useState<string | null>(null);
  const [isAddingList, setIsAddingList] = useState(false);
  const [newListVal, setNewListVal] = useState('');
  const [draggedOverCardId, setDraggedOverCardId] = useState<string | null>(null);
  const [isSessionLogOpen, setIsSessionLogOpen] = useState(false);
  const [uncheckedLogCardIds, setUncheckedLogCardIds] = useState<string[]>([]);
  const [isLogHelpOpen, setIsLogHelpOpen] = useState(false);
  const [isCardSessionLogExpanded, setIsCardSessionLogExpanded] = useState(false);
  const [currentSessionStartTime, setCurrentSessionStartTime] = useState<number | null>(null);
  const [currentSessionDuration, setCurrentSessionDuration] = useState<number>(0);
  
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isNotificationStudioOpen, setIsNotificationStudioOpen] = useState(false);
  const [isCalendarAgendaOpen, setIsCalendarAgendaOpen] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
  const [calendarRangeDays, setCalendarRangeDays] = useState<number>(30);
  const [calendarFilterType, setCalendarFilterType] = useState<'all' | 'mtrax' | 'diary' | 'receipts'>('all');
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
    isEmailed?: boolean;
    emailedAt?: number;
    emailedTo?: string;
    cardId?: string;
  }[]>([]);
  const [employerEmail, setEmployerEmail] = useState('');
  const [isCapturingReceipt, setIsCapturingReceipt] = useState(false);
  const [showReceiptsHelp, setShowReceiptsHelp] = useState(false);
  const [showCalendarHelp, setShowCalendarHelp] = useState(false);
  const [isDashboardHelpOpen, setIsDashboardHelpOpen] = useState(false);
  const [isCardHelpOpen, setIsCardHelpOpen] = useState(false);
  const [isSessionHistoryGuideOpen, setIsSessionHistoryGuideOpen] = useState(false);
  const [isChecklistHelpOpen, setIsChecklistHelpOpen] = useState(false);
  const [isChecklistModalOpen, setIsChecklistModalOpen] = useState(false);
  const [isLabelHelpOpen, setIsLabelHelpOpen] = useState(false);
  const [isListDropdownOpen, setIsListDropdownOpen] = useState(false);
  const [isCreatingListInline, setIsCreatingListInline] = useState(false);
  const [inlineNewListName, setInlineNewListName] = useState('');
  const [isAlertsHelpOpen, setIsAlertsHelpOpen] = useState(false);
  const [isAlertStudioHelpOpen, setIsAlertStudioHelpOpen] = useState(false);
  const [isDocsHelpOpen, setIsDocsHelpOpen] = useState(false);
  const [isDocStudioOpen, setIsDocStudioOpen] = useState(false);
  const [isReceiptStudioOpen, setIsReceiptStudioOpen] = useState(false);
  const [isArchiveStudioOpen, setIsArchiveStudioOpen] = useState(false);
  const [isArchiveStudioHelpOpen, setIsArchiveStudioHelpOpen] = useState(false);
  const [archiveSearchQuery, setArchiveSearchQuery] = useState('');
  const [archiveFilterTab, setArchiveFilterTab] = useState<'all' | 'active' | 'completed' | 'archived'>('all');
  const [isReceiptsLinkHelpOpen, setIsReceiptsLinkHelpOpen] = useState(false);
  const [showBackupHelp, setShowBackupHelp] = useState(false);
  const [showSyncHelp, setShowSyncHelp] = useState(false);
  const [showDiagnosticsHelp, setShowDiagnosticsHelp] = useState(false);
  const [openAssignDropdownId, setOpenAssignDropdownId] = useState<string | null>(null);
  const [selectedCalendarItemIds, setSelectedCalendarItemIds] = useState<string[]>([]);
  const [isTimerModalOpen, setIsTimerModalOpen] = useState(false);
  const [showTimerHelp, setShowTimerHelp] = useState(false);
  const [pomodoroTimeLeft, setPomodoroTimeLeft] = useState(25 * 60); // 25 mins
  const [isPomodoroRunning, setIsPomodoroRunning] = useState(false);
  const [pomodoroSelectedFocusMode, setPomodoroSelectedFocusMode] = useState<'dnd' | 'work' | 'personal' | 'sleep' | 'driving' | 'study'>('study');
  const [pomodoroEnableNotifications, setPomodoroEnableNotifications] = useState(true);
  const [pomodoroEnableHaptics, setPomodoroEnableHaptics] = useState(true);
  const [pomodoroEnableTimeSensitive, setPomodoroEnableTimeSensitive] = useState(true);


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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeMenuModal, setActiveMenuModal] = useState<'backup' | 'sync' | 'diagnostics' | null>(null);

  // Unified Settings and Accessibility States
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'appearance' | 'sync' | 'admin'>('appearance');
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('mtrax_theme_mode') as 'dark' | 'light') || 'dark';
  });
  const [textScale, setTextScale] = useState<'standard' | 'large' | 'xlarge'>(() => {
    return (localStorage.getItem('mtrax_text_scale') as 'standard' | 'large' | 'xlarge') || 'standard';
  });

  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);

  // Apply Theme effects
  useEffect(() => {
    localStorage.setItem('mtrax_theme_mode', themeMode);
    if (themeMode === 'light') {
      document.body.classList.add('theme-light');
    } else {
      document.body.classList.remove('theme-light');
    }
  }, [themeMode]);

  // Apply Font Scaling effects
  useEffect(() => {
    localStorage.setItem('mtrax_text_scale', textScale);
    document.body.classList.remove('font-scale-large', 'font-scale-xlarge');
    if (textScale === 'large') {
      document.body.classList.add('font-scale-large');
    } else if (textScale === 'xlarge') {
      document.body.classList.add('font-scale-xlarge');
    }
  }, [textScale]);



  // Automatically scroll containers to top on navigation/state changes
  useEffect(() => {
    window.scrollTo(0, 0);

    const resetScroll = () => {
      const scrollableElements = document.querySelectorAll('.overflow-y-auto, .overflow-y-scroll, [class*="overflow-y-"]');
      scrollableElements.forEach(el => {
        el.scrollTop = 0;
      });
    };

    resetScroll();
    const timer = setTimeout(resetScroll, 50);
    return () => clearTimeout(timer);
  }, [
    isArchiveStudioOpen,
    isDocStudioOpen,
    isReceiptStudioOpen,
    isCalendarAgendaOpen,
    isNotificationStudioOpen,
    isSettingsOpen,
    isDiaryOpen,
    isReceiptsOpen,
    isTimerModalOpen,
    isSessionLogOpen,
    isChecklistModalOpen,
    archiveFilterTab,
    archiveSearchQuery,
    selectedCardForEdit ? selectedCardForEdit.id : null
  ]);

  // Premium feature guard helper
  const handlePremiumAction = (action: () => void) => {
    const hasOfflineCert = localStorage.getItem('mtrax_offline_certificate') === 'true';
    if (hasValidReceipt || receipts.length > 0 || hasOfflineCert) {
      action();
    } else {
      setIsUpgradeModalOpen(true);
    }
  };

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
      
      const storageKeyReceipts = `factory_app_${config.id}_receipts`;
      const savedReceipts = await getStorage(storageKeyReceipts);
      const parsedReceipts = savedReceipts ? JSON.parse(savedReceipts) : [];

      // DEV BYPASS: Auto-grant premium certificate if running on localhost, 127.0.0.1, or local subnet sub-domains
      const isDevHost = window.location.hostname === 'localhost' || 
                        window.location.hostname === '127.0.0.1' || 
                        window.location.hostname.startsWith('192.168.') || 
                        window.location.hostname.startsWith('172.20.');
      const isDevMode = isDevHost;

      if (isDevMode && localStorage.getItem('mtrax_offline_certificate') !== 'true') {
        localStorage.setItem('mtrax_offline_certificate', 'true');
        console.log("[MTRAx Dev Bypass] Local network detected. Pre-authorizing Premium Offline Certificate!");
      }

      const hasOfflineCert = localStorage.getItem('mtrax_offline_certificate') === 'true';

      // Simulate network/OS verification delay
      setTimeout(() => {
        if (hasOfflineCert || parsedReceipts.length > 0) {
          console.log("[StoreKit] Offline certificate validated successfully. Premium features active.");
          setHasValidReceipt(true);
        } else {
          setHasValidReceipt(false); 
        }
      }, 400); // Shorter load duration for developers
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
      console.log(`[Enterprise Sync] Payload routed to api.mtrax.mdex.com for key: ${key}`);
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



  // File rehydration for native and indexedDB previews
  useEffect(() => {
    if (lightboxFile && typeof lightboxFile.filePath === 'string') {
      const path = lightboxFile.filePath;
      // Rehydrate the web url on opening the lightbox if we saved a physical file
      (async () => {
        try {
          const resolved = await readFile(path);
          if (resolved) {
            setLightboxFile({
              ...lightboxFile,
              dataUrl: resolved.webUrl
            });
          }
        } catch (e) {
          console.error("Failed to rehydrate lightbox file preview URL", e);
        }
      })();
    }
  }, [lightboxFile?.id]);

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

      const storageKeyReceipts = `factory_app_${config.id}_receipts`;
      const savedReceipts = await getStorage(storageKeyReceipts);
      if (savedReceipts) {
        const parsed = JSON.parse(savedReceipts);
        setReceipts(parsed);
        if (parsed.length > 0) {
          localStorage.setItem('mtrax_offline_certificate', 'true');
          setHasValidReceipt(true);
        }
      }

      const storageKeyVoiceLogs = `factory_app_${config.id}_voice_logs`;
      const savedVoiceLogs = await getStorage(storageKeyVoiceLogs);
      if (savedVoiceLogs) setVoiceLogs(JSON.parse(savedVoiceLogs));

      const storageKeyEmployerEmail = `factory_app_${config.id}_employer_email`;
      const savedEmployerEmail = await getStorage(storageKeyEmployerEmail);
      if (savedEmployerEmail) setEmployerEmail(savedEmployerEmail);
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

  const saveReceipts = async (newReceipts: typeof receipts) => {
    setReceipts(newReceipts);
    await syncData(`factory_app_${config.id}_receipts`, newReceipts);
    if (newReceipts.length > 0) {
      localStorage.setItem('mtrax_offline_certificate', 'true');
      setHasValidReceipt(true);
    }
  };

  const saveVoiceLogs = async (newLogs: typeof voiceLogs) => {
    setVoiceLogs(newLogs);
    await syncData(`factory_app_${config.id}_voice_logs`, newLogs);
  };

  // 🧾 INTEGRATED APPLE VISION / SIMULATED OCR PARSER ENGINE
  const runReceiptOcrAndPopulate = async (imagePath: string, isNativePlatform: boolean, fileName?: string) => {
    showToast("🤖 Initiating Apple Vision OCR scan...");
    
    // Create subtle golden/orange visual scan animations on the form inputs
    const merchantInput = document.getElementById('receipt-merchant-input') as HTMLInputElement;
    const amountInput = document.getElementById('receipt-amount-input') as HTMLInputElement;
    const notesInput = document.getElementById('receipt-notes-input') as HTMLInputElement;

    if (merchantInput) {
      merchantInput.placeholder = "🤖 Scanning receipt...";
      merchantInput.style.transition = "all 0.5s ease-in-out";
      merchantInput.style.borderColor = "var(--color-accent,#DF5504)";
      merchantInput.style.boxShadow = "0 0 10px var(--color-accent,#DF5504)";
    }
    if (amountInput) {
      amountInput.placeholder = "🤖 Analyzing...";
      amountInput.style.transition = "all 0.5s ease-in-out";
      amountInput.style.borderColor = "var(--color-accent,#DF5504)";
      amountInput.style.boxShadow = "0 0 10px var(--color-accent,#DF5504)";
    }

    try {
      let extractedMerchant = "";
      let extractedAmount = 0.0;
      let extractedNotes = "";

      if (isNativePlatform) {
        // NATIVE IOS: Invoke Apple Vision Framework OCR via Capacitor
        console.log("[Apple Vision OCR] Analyzing image at path: " + imagePath);
        const data = await Ocr.detectText({ filename: imagePath });
        
        if (data && data.textDetections && data.textDetections.length > 0) {
          // Rule 1: Find largest floating-point decimal (likely the Receipt Total)
          const allLines = data.textDetections.map(d => d.text.trim());
          const prices: number[] = [];
          
          allLines.forEach(line => {
            const priceMatches = line.match(/\d+\.\d{2}/g);
            if (priceMatches) {
              priceMatches.forEach(p => prices.push(parseFloat(p)));
            }
          });

          if (prices.length > 0) {
            extractedAmount = Math.max(...prices);
          }

          // Rule 2: Merchant name is usually on the first or second printed line
          extractedMerchant = allLines[0] || "Office Depot";
          extractedNotes = "Neural scan of " + (allLines.slice(0, 3).join(", ").substring(0, 40)) + "...";
        }
      } else {
        // WEB/CHROME SIMULATOR: Intelligent Mock Text Extraction after delay
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const fName = (fileName || "").toLowerCase();
        if (fName.includes("starbuck")) {
          extractedMerchant = "Starbucks Coffee #42";
          extractedAmount = 14.50;
          extractedNotes = "Client coffee consultation meeting";
        } else if (fName.includes("uber") || fName.includes("taxi")) {
          extractedMerchant = "Uber Trip Inc.";
          extractedAmount = 28.30;
          extractedNotes = "Airport transit travel fare claim";
        } else if (fName.includes("amazon") || fName.includes("aws")) {
          extractedMerchant = "Amazon Web Services";
          extractedAmount = 99.00;
          extractedNotes = "Dev server cloud monthly subscription";
        } else if (fName.includes("apple") || fName.includes("mac")) {
          extractedMerchant = "Apple Store Sydney";
          extractedAmount = 149.00;
          extractedNotes = "USB-C adapter cables and accessories";
        } else {
          // Default fallbacks with high-fidelity values
          const merchants = ["Staples Corp", "Office Depot", "Chevron Gas", "FedEx Office", "Zoom Video Corp"];
          const notesList = ["Office stationeries and documents copy", "Photocopier printing papers", "Travel fleet gasoline fuel fill", "Express client documents mail delivery", "Team communication online monthly subscription"];
          const randIdx = Math.floor(Math.random() * merchants.length);
          extractedMerchant = merchants[randIdx];
          extractedAmount = parseFloat((Math.random() * 80 + 15).toFixed(2));
          extractedNotes = notesList[randIdx];
        }
      }

      // 4. Auto-populate inputs while keeping them 100% editable
      if (merchantInput) {
        merchantInput.value = extractedMerchant;
        merchantInput.placeholder = "e.g. Starbucks";
        merchantInput.style.borderColor = "#22c55e"; // Success green border
        merchantInput.style.boxShadow = "0 0 10px #22c55e";
        merchantInput.style.backgroundColor = "rgba(34, 197, 94, 0.05)";
      }
      if (amountInput) {
        amountInput.value = extractedAmount > 0 ? extractedAmount.toFixed(2) : "";
        amountInput.placeholder = "0.00";
        amountInput.style.borderColor = "#22c55e";
        amountInput.style.boxShadow = "0 0 10px #22c55e";
        amountInput.style.backgroundColor = "rgba(34, 197, 94, 0.05)";
      }
      if (notesInput && extractedNotes) {
        notesInput.value = extractedNotes;
        notesInput.style.borderColor = "#22c55e";
        notesInput.style.boxShadow = "0 0 10px #22c55e";
        notesInput.style.backgroundColor = "rgba(34, 197, 94, 0.05)";
      }

      showToast(`🤖 Apple Vision extracted: ${extractedMerchant} ($${extractedAmount.toFixed(2)})! Feel free to edit values.`);

      // 5. Setup clear trigger on first interaction
      const clearGlow = (e: Event) => {
        const target = e.target as HTMLInputElement;
        target.style.borderColor = "";
        target.style.boxShadow = "";
        target.style.backgroundColor = "";
      };

      merchantInput?.addEventListener('input', clearGlow, { once: true });
      amountInput?.addEventListener('input', clearGlow, { once: true });
      notesInput?.addEventListener('input', clearGlow, { once: true });

    } catch (ocrErr) {
      console.error("[Ocr Error]", ocrErr);
      showToast("⚠️ Neural text recognition scan was cancelled or skipped.");
      if (merchantInput) {
        merchantInput.placeholder = "e.g. Starbucks";
        merchantInput.style.borderColor = "";
        merchantInput.style.boxShadow = "";
      }
      if (amountInput) {
        amountInput.placeholder = "0.00";
        amountInput.style.borderColor = "";
        amountInput.style.boxShadow = "";
      }
    }
  };



  // Session Ref Trackers (Bypasses state stale-closure rules in useEffect cleanup handlers)
  const sessionStartTimeRef = useRef<number | null>(null);
  const sessionDurationRef = useRef<number>(0);
  const selectedCardIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionStartTimeRef.current = currentSessionStartTime;
  }, [currentSessionStartTime]);

  useEffect(() => {
    sessionDurationRef.current = currentSessionDuration;
  }, [currentSessionDuration]);

  useEffect(() => {
    selectedCardIdRef.current = selectedCardForEdit ? selectedCardForEdit.id : null;
  }, [selectedCardForEdit?.id]);

  // Native iOS Custom URL Protocol Listener (mtrax://import?card=<base64>)
  useEffect(() => {
    const setupDeepLinkListener = async () => {
      const handleAppUrlOpen = (event: any) => {
        try {
          const urlStr = event.url;
          if (!urlStr) return;
          
          // Parse the incoming URL
          const parsedUrl = new URL(urlStr);
          if (parsedUrl.protocol === 'mtrax:' && parsedUrl.host === 'import') {
            const cardData = parsedUrl.searchParams.get('card');
            if (cardData) {
              // Decode base64 to standard JSON string securely (handles emojis perfectly)
              const decodedStr = decodeURIComponent(escape(window.atob(cardData)));
              const cardObj = JSON.parse(decodedStr);
              if (cardObj && cardObj.id && cardObj.title) {
                setIncomingSharedCard(cardObj);
                setIsShareAcknowledgementChecked(false);
              }
            }
          }
        } catch (error) {
          console.error('Failed to parse incoming deep-link card payload:', error);
        }
      };

      // Add the listener
      const listener = await CapApp.addListener('appUrlOpen', handleAppUrlOpen);

      // Check if the app was launched by a deep link initially
      const launchUrlObj = await CapApp.getLaunchUrl();
      if (launchUrlObj && launchUrlObj.url) {
        handleAppUrlOpen({ url: launchUrlObj.url });
      }

      return () => {
        listener.remove();
      };
    };

    const cleanupPromise = setupDeepLinkListener();
    return () => {
      cleanupPromise.then(cleanup => {
        if (typeof cleanup === 'function') cleanup();
      });
    };
  }, []);

  // Automatic Screen-Open Card Focus Timer Thread
  useEffect(() => {
    let interval: any = null;
    if (selectedCardForEdit) {
      // Initialize active session metrics
      setCurrentSessionStartTime(Date.now());
      setCurrentSessionDuration(0);

      interval = setInterval(() => {
        // Increment session stopwatch counters
        setCurrentSessionDuration(d => d + 1);

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

    // Modal Exit Cleanup Handler: Compile and save the active session
    return () => {
      if (interval) clearInterval(interval);

      const closedCardId = selectedCardIdRef.current;
      const duration = sessionDurationRef.current;
      const startTime = sessionStartTimeRef.current;

      if (closedCardId && duration > 0 && startTime !== null) {
        const sessionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
        const newSession: StudySession = {
          id: sessionId,
          duration: duration,
          timestamp: startTime
        };

        setCards(prevCards => {
          const updated = prevCards.map(c => {
            if (c.id === closedCardId) {
              const sessions = c.studySessions ? [...c.studySessions, newSession] : [newSession];
              return { ...c, studySessions: sessions };
            }
            return c;
          });
          // Persist the session history update automatically to localStorage/DB
          syncData(`factory_app_${config.id}_cards`, updated).catch(err => {
            console.error("Failed to sync session history:", err);
          });
          return updated;
        });
      }
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

  const handleExportCSV = async () => {
    const headers = 'Card ID,List Name,Title,Description,Time Spent (Seconds),Due Date,Completion Date,Category Labels,Sub-Task Checklists,Active Alarms,Archived\n';
    
    const rows = cards.map(c => {
      // 1. Resolve board column name
      const listObj = lists.find(l => l.id === c.listId);
      const listName = listObj ? listObj.name : 'Unknown';
      
      // 2. Resolve Category Labels
      const labelNames = (c.labelIds || [])
        .map(id => {
          const found = labels.find(l => l.id === id);
          return found ? found.text : '';
        })
        .filter(Boolean)
        .join(', ');
        
      // 3. Resolve Sub-Task Checklists
      const checklistStrings: string[] = [];
      let taskIndex = 1;
      (c.checklists || []).forEach(cl => {
        cl.items.forEach(item => {
          const checkbox = item.isChecked ? '[✔]' : '[ ]';
          checklistStrings.push(`${taskIndex}. ${checkbox} ${item.text}`);
          taskIndex++;
        });
      });
      const checklistSerialized = checklistStrings.join(', ');

      // 4. Resolve Active Alarms
      const alarmStrings: string[] = [];
      if (c.dueDate) {
        alarmStrings.push(`Card Due: ${new Date(c.dueDate).toLocaleString()}`);
      }
      (c.checklists || []).forEach(cl => {
        cl.items.forEach(item => {
          if (item.dueDate) {
            alarmStrings.push(`Sub-task '${item.text}' Alarm: ${new Date(item.dueDate).toLocaleString()}`);
          }
        });
      });
      const alarmsSerialized = alarmStrings.join(' | ');

      // 5. Format dates
      const dueDateStr = c.dueDate ? new Date(c.dueDate).toISOString().split('T')[0] : '';
      const completedAtStr = c.completedAt ? new Date(c.completedAt).toISOString().split('T')[0] : '';

      // Escape fields to prevent CSV injection or formatting breakage
      const escapeCsv = (str: string) => `"${str.replace(/"/g, '""').replace(/\n/g, ' ')}"`;

      return `${escapeCsv(c.id)},${escapeCsv(listName)},${escapeCsv(c.title)},${escapeCsv(c.description || '')},${c.timeSpent || 0},${escapeCsv(dueDateStr)},${escapeCsv(completedAtStr)},${escapeCsv(labelNames)},${escapeCsv(checklistSerialized)},${escapeCsv(alarmsSerialized)},"${c.isArchived ? 'Yes' : 'No'}"`;
    }).join('\n');
    
    const csvContent = headers + rows;
    const filename = `${config.id}_tasks_export.csv`;
    
    try {
      const file = new File([csvContent], filename, { type: 'text/csv' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'MTRAx Tasks Export',
          text: 'Here is your rich CSV backup export from MTRAx lt.'
        });
        showToast("📤 Share sheet opened successfully!");
        return;
      }
    } catch (e) {
      console.warn("Web Share API files sharing not supported/failed:", e);
    }

    // Web Fallback
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportFullBackup = async () => {
    const backupPackage = {
      backupVersion: 1,
      timestamp: Date.now(),
      appId: "mtrax-lite",
      data: {
        cards,
        lists,
        receipts,
        voiceLogs,
        labels,
        employerEmail
      }
    };
    const jsonString = JSON.stringify(backupPackage, null, 2);
    const filename = `mtrax_full_backup_${Date.now()}.json`;

    try {
      const file = new File([jsonString], filename, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'MTRAx Full Backup',
          text: 'Lossless JSON backup for full-state database restoration.'
        });
        showToast("📤 Backup share sheet opened!");
        return;
      }
    } catch (e) {
      console.warn("Share API not supported/failed:", e);
    }

    // Web Fallback
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRestoreFullBackup = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const jsonText = evt.target?.result as string;
          const backup = JSON.parse(jsonText);

          // Schema validation check
          if (!backup || (backup.appId !== 'mtrax-lite' && backup.appId !== 'triage-lite') || !backup.data) {
            alert('Invalid backup file structure! Ensure this is a valid MTRAx backup JSON file.');
            return;
          }

          const confirmRestore = window.confirm(
            '⚠️ WARNING: This will overwrite your current board, categories, tax receipts, settings, and verbal diaries with the backup data. This action cannot be undone.\n\nDo you want to proceed?'
          );
          if (!confirmRestore) return;

          await triggerHaptic();

          const data = backup.data;
          
          // Save and overwrite all states permanently
          if (Array.isArray(data.cards)) {
            setCards(data.cards);
            await syncData(`factory_app_${config.id}_cards`, data.cards);
          }
          if (Array.isArray(data.lists)) {
            setLists(data.lists);
            await syncData(`factory_app_${config.id}_lists`, data.lists);
          }
          if (Array.isArray(data.receipts)) {
            setReceipts(data.receipts);
            await syncData(`factory_app_${config.id}_receipts`, data.receipts);
          }
          if (Array.isArray(data.voiceLogs)) {
            setVoiceLogs(data.voiceLogs);
            await syncData(`factory_app_${config.id}_voice_logs`, data.voiceLogs);
          }
          if (Array.isArray(data.labels)) {
            setLabels(data.labels);
            await syncData(`factory_app_${config.id}_labels`, data.labels);
          }
          if (typeof data.employerEmail === 'string') {
            setEmployerEmail(data.employerEmail);
            await syncData(`factory_app_${config.id}_employer_email`, data.employerEmail);
          }

          showToast("⚡ Full memory restore complete!");
          alert("✔ Backup restored successfully! The application will now reload.");
          window.location.reload();
        } catch (err) {
          console.error(err);
          alert('Failed to parse backup file! Error: ' + (err as Error).message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleArchiveCard = async (cardId: string, archive: boolean) => {
    await triggerHaptic();
    const updated = cards.map(c => c.id === cardId ? { ...c, isArchived: archive } : c);
    await saveCards(updated);
    showToast(archive ? "📦 Card successfully archived!" : "📥 Card restored to board!");
  };

  const handleRecallCard = async (cardId: string) => {
    await triggerHaptic();
    const updated = cards.map(c => c.id === cardId ? { ...c, listId: 'todo', completedAt: null, isArchived: false } : c);
    await saveCards(updated);
    showToast("↩️ Card recalled and moved to To Do!");
  };

  const handleDeleteCard = async (cardId: string) => {
    await triggerHaptic();
    if (window.confirm("⚠️ Are you sure you want to permanently delete this card? This cannot be undone!")) {
      const updated = cards.filter(c => c.id !== cardId);
      await saveCards(updated);
      showToast("🗑️ Card permanently deleted!");
      return true;
    }
    return false;
  };
  // MONETIZATION GUARDS: Wait for receipt check at startup, but don't block layout
  if (hasValidReceipt === null) {
    return (
      <div className="min-h-screen bg-[var(--color-dark-bg,#282828)] flex flex-col items-center justify-center font-mono text-[var(--color-accent,#DF5504)] uppercase font-black text-sm tracking-widest gap-4">
        <div className="w-8 h-8 border-4 border-t-[var(--color-accent,#DF5504)] border-r-[var(--color-accent,#DF5504)] border-b-transparent border-l-transparent rounded-full animate-spin"></div>
        <span>Verifying App Store Receipt...</span>
      </div>
    );
  }

  return (
    <div className="h-screen max-h-screen flex flex-col justify-between overflow-hidden ios-safe-top ios-safe-bottom bg-[var(--color-dark-bg,#282828)] px-4 py-6 select-none">
      
      {/* COLLAPSIBLE LEFT UNIFIED SIDEBAR (DRAWER) */}
      <div 
        className={`fixed top-0 left-0 h-full w-72 bg-[var(--color-dark-bg,#282828)] border-r border-[var(--color-dark-tertiary,#3D3D3D)] shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col justify-between p-5 overflow-y-auto no-scrollbar ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col gap-5">
          {/* Sidebar Header */}
          <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-3">
            <span className="font-black text-xs text-white uppercase tracking-wider flex items-center gap-1.5 font-mono">
              ☰ {config.name} Menu
            </span>
            <button 
              onClick={async () => {
                await triggerHaptic();
                setIsSidebarOpen(false);
              }}
              className="text-xs uppercase font-mono font-bold text-gray-400 hover:text-white cursor-pointer"
            >
              ✕ {t('close')}
            </button>
          </div>

          {/* Section 1: Settings */}
          <div className="flex flex-col gap-2 font-mono">
            <span className="text-[10px] text-[var(--color-accent,#DF5504)] font-black uppercase tracking-wider mb-0.5">
              ⚙️ Preferences
            </span>
            
            <button 
              onClick={async () => {
                await triggerHaptic();
                setIsSettingsOpen(true);
                setIsSidebarOpen(false);
              }}
              className="w-full p-3 bento-box bg-black/40 hover:bg-[var(--color-dark-tertiary,#3D3D3D)] flex justify-between items-center text-left transition-all active:translate-y-0.5 group cursor-pointer"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-bold text-[11px] text-white group-hover:text-[var(--color-accent,#DF5504)] transition-colors">
                  ⚙️ {t('settings')}
                </span>
                <span className="text-[9px] text-gray-400">
                  {t('settingsDesc')}
                </span>
              </div>
              <span className="text-gray-500 group-hover:text-white text-xs pl-1 font-sans">❯</span>
            </button>
            {/* Language Selector bento box */}
            <div className="w-full p-2.5 bento-box bg-black/40 flex flex-col gap-2 font-mono">
              <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">🌐 App Language</span>
              <select
                value={currentLanguage}
                onChange={async (e) => {
                  await triggerHaptic();
                  setCurrentLanguage(e.target.value as any);
                }}
                className="w-full bg-black/60 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded text-[11px] text-white py-1.5 px-2 font-mono focus:outline-none focus:border-[var(--color-accent,#DF5504)] transition-colors cursor-pointer"
              >
                <option value="en" style={{ backgroundColor: '#282828', color: '#FFFFFF' }}>🇺🇸 English (EN)</option>
                <option value="es" style={{ backgroundColor: '#282828', color: '#FFFFFF' }}>🇪🇸 Español (ES)</option>
                <option value="fr" style={{ backgroundColor: '#282828', color: '#FFFFFF' }}>🇫🇷 Français (FR)</option>
                <option value="de" style={{ backgroundColor: '#282828', color: '#FFFFFF' }}>🇩🇪 Deutsch (DE)</option>
              </select>
            </div>
          </div>

          {/* Section 2: Interactive Quick Tools */}
          <div className="flex flex-col gap-2 font-mono">
            <span className="text-[10px] text-[var(--color-accent,#DF5504)] font-black uppercase tracking-wider mb-0.5">
              🛠️ Quick Tools
            </span>
            
            {/* Button 1: Calendar */}
            <button
              onClick={async () => {
                await triggerHaptic();
                setIsCalendarAgendaOpen(true);
                await fetchUpcomingCalendarEvents(calendarRangeDays);
                setIsSidebarOpen(false);
              }}
              className="w-full p-2.5 bento-box bg-black/40 hover:bg-[var(--color-dark-tertiary,#3D3D3D)] flex items-center gap-3 text-left transition-all active:translate-y-0.5 group cursor-pointer"
            >
              <span className="text-base">📅</span>
              <div className="flex flex-col">
                <span className="font-bold text-[11px] text-white group-hover:text-[var(--color-accent,#DF5504)] transition-colors">Calendar Agenda</span>
                <span className="text-[9px] text-gray-400">View upcoming times.</span>
              </div>
            </button>

            {/* Button 2: Verbal Diary (GATED) */}
            <button
              onClick={async () => {
                await triggerHaptic();
                setIsSidebarOpen(false);
                handlePremiumAction(() => {
                  setIsDiaryOpen(true);
                });
              }}
              className="w-full p-2.5 bento-box bg-black/40 hover:bg-[var(--color-dark-tertiary,#3D3D3D)] flex items-center gap-3 text-left transition-all active:translate-y-0.5 group cursor-pointer relative"
            >
              <span className="text-base">📔</span>
              <div className="flex flex-col">
                <span className="font-bold text-[11px] text-white group-hover:text-[var(--color-accent,#DF5504)] transition-colors flex items-center gap-1">
                  Verbal Diary {!hasValidReceipt && <span className="text-[8px] px-1 bg-amber-500/20 text-amber-400 rounded-sm font-normal">PRO</span>}
                </span>
                <span className="text-[9px] text-gray-400">Record audio notes.</span>
              </div>
            </button>

            {/* Button 3: Receipts (GATED) */}
            <button
              onClick={async () => {
                await triggerHaptic();
                setIsSidebarOpen(false);
                handlePremiumAction(() => {
                  setIsReceiptsOpen(true);
                });
              }}
              className="w-full p-2.5 bento-box bg-black/40 hover:bg-[var(--color-dark-tertiary,#3D3D3D)] flex items-center gap-3 text-left transition-all active:translate-y-0.5 group cursor-pointer"
            >
              <span className="text-base">🧾</span>
              <div className="flex flex-col">
                <span className="font-bold text-[11px] text-white group-hover:text-[var(--color-accent,#DF5504)] transition-colors flex items-center gap-1">
                  Business Receipts {!hasValidReceipt && <span className="text-[8px] px-1 bg-amber-500/20 text-amber-400 rounded-sm font-normal">PRO</span>}
                </span>
                <span className="text-[9px] text-gray-400">Manage tax expenses.</span>
              </div>
            </button>

            {/* Button 4: Pomodoro */}
            <button
              onClick={async () => {
                await triggerHaptic();
                setIsTimerModalOpen(true);
                setIsSidebarOpen(false);
              }}
              className="w-full p-2.5 bento-box bg-black/40 hover:bg-[var(--color-dark-tertiary,#3D3D3D)] flex items-center gap-3 text-left transition-all active:translate-y-0.5 group cursor-pointer"
            >
              <span className="text-base">🍅</span>
              <div className="flex flex-col">
                <span className="font-bold text-[11px] text-white group-hover:text-[var(--color-accent,#DF5504)] transition-colors">Study Pomodoro</span>
                <span className="text-[9px] text-gray-400">Start focus cycles.</span>
              </div>
            </button>

            {/* Button 5: Time Logs */}
            <button
              onClick={async () => {
                await triggerHaptic();
                setIsSessionLogOpen(true);
                setIsSidebarOpen(false);
              }}
              className="w-full p-2.5 bento-box bg-black/40 hover:bg-[var(--color-dark-tertiary,#3D3D3D)] flex items-center gap-3 text-left transition-all active:translate-y-0.5 group cursor-pointer"
            >
              <span className="text-base">📊</span>
              <div className="flex flex-col">
                <span className="font-bold text-[11px] text-white group-hover:text-[var(--color-accent,#DF5504)] transition-colors">Session Time Logs</span>
                <span className="text-[9px] text-gray-400">Check study logs.</span>
              </div>
            </button>

            {/* Button 6: File Picker */}
            <button
              onClick={async () => {
                await triggerHaptic();
                document.getElementById('global-file-picker')?.click();
                setIsSidebarOpen(false);
              }}
              className="w-full p-2.5 bento-box bg-black/40 hover:bg-[var(--color-dark-tertiary,#3D3D3D)] flex items-center gap-3 text-left transition-all active:translate-y-0.5 group cursor-pointer"
            >
              <span className="text-base">📂</span>
              <div className="flex flex-col">
                <span className="font-bold text-[11px] text-white group-hover:text-[var(--color-accent,#DF5504)] transition-colors">Open File Picker</span>
                <span className="text-[9px] text-gray-400">Import attachments.</span>
              </div>
            </button>

            {/* Button 7: Archive Studio */}
            <button
              onClick={async () => {
                await triggerHaptic();
                setIsArchiveStudioOpen(true);
                setIsSidebarOpen(false);
              }}
              className="w-full p-2.5 bento-box bg-black/40 hover:bg-[var(--color-dark-tertiary,#3D3D3D)] flex items-center gap-3 text-left transition-all active:translate-y-0.5 group cursor-pointer"
            >
              <span className="text-base">📦</span>
              <div className="flex flex-col">
                <span className="font-bold text-[11px] text-white group-hover:text-[var(--color-accent,#DF5504)] transition-colors">Archive Studio</span>
                <span className="text-[9px] text-gray-400">Recall completed/archived cards.</span>
              </div>
            </button>
          </div>
          {/* Section 3: Premium Access */}
          {!hasValidReceipt && (
            <div className="flex flex-col gap-2 font-mono animate-fadeIn">
              <span className="text-[10px] text-amber-400 font-black uppercase tracking-wider mb-0.5">
                💎 Premium Access
              </span>
              
              <button
                onClick={async () => {
                  await triggerHaptic();
                  setIsUpgradeModalOpen(true);
                  setIsSidebarOpen(false);
                }}
                className="w-full p-3 rounded-md border border-amber-500/40 bg-gradient-to-br from-amber-950/30 to-black/50 hover:from-amber-950/50 hover:to-amber-900/30 text-left transition-all active:translate-y-0.5 group cursor-pointer flex flex-col gap-1 shadow-[0_0_15px_rgba(245,158,11,0.05)] hover:shadow-[0_0_15px_rgba(245,158,11,0.15)]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-amber-400 group-hover:text-amber-300 transition-colors uppercase tracking-wider">
                    Upgrade to Premium
                  </span>
                  <span className="text-amber-500 group-hover:text-amber-300 text-[10px] pl-1 transition-colors font-sans">❯</span>
                </div>
                <span className="text-[9px] text-gray-400 leading-normal">
                  Unlock multi-device cloud backup and premium workspace expansions.
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="border-t border-[var(--color-dark-tertiary,#3D3D3D)] pt-4 flex flex-col gap-2 font-mono text-[9px] text-gray-400 text-center">
          <span>{config.name} v1.0.0</span>
          <span>MDEx Workspace App Factory</span>
        </div>
      </div>

      {/* Sidebar Backdrop overlay when open */}
      {isSidebarOpen && (
        <div 
          onClick={async () => {
            await triggerHaptic();
            setIsSidebarOpen(false);
          }}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 animate-fadeIn"
        />
      )}
      
      {/* 🏷️ STATE-OF-THE-ART MTRAX APP TITLE HEADER */}
      <div className="flex items-center justify-start px-1 mb-3.5 gap-3 select-none flex-shrink-0">
        {/* Beautifully Embedded Triage SVG Logo on the Far Left */}
        <svg id="a" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140.05 129.41" className="w-8 h-8 sm:w-9 sm:h-9 hover:scale-105 transition-transform cursor-pointer">
          <title>Triage Workspace Logo</title>
          <path d="M11.9,73.79v41.65h38.55v-41.65H11.9ZM43.8,86.4c-3.4,2.4-6.4,5.3-9.1,8.6-2.4,3-4.5,6.4-6.2,9.9l-1.7,3.5-9.8-11.2,3.8-3.4,4.8,5.5c1.4-2.5,3-5,4.8-7.2l.2-.3c2.9-3.7,6.3-6.9,10.1-9.6l.8-.6h.1l3,4.2-.8.6Z" fill="#df5504" />
          <polygon points="83.05 116.21 77.75 113.61 77.85 128.71 106.35 129 106.35 127.71 83.05 116.21 83.05 116.21" fill="#df5504" />
          <path d="M106.35,121.51v-13.2c5.1,1.1,11.1,2.4,11.1,2.4l-18.2-8.9h0c0,.1-21.5-10.4-21.5-10.4v16.2l-8.5-4.3v2.1l5.6,2.8v1.9l17.2,8.5,18.7,9.2h0l3.3,1.6v-1.9l-17.2-8.7h0l-.4-.2v-2l9.9,5v-.1Z" fill="#df5504" />
          <polygon points="140.05 50.23 140.05 48.33 134.35 45.43 134.35 35.83 100.05 35.83 86.75 29.13 86.75 31.23 95.95 35.83 95.85 35.83 101.95 38.93 101.95 38.83 117.15 46.53 117.15 46.53 134.35 55.03 134.35 49.43 120.65 42.63 120.65 40.53 122.85 41.63 122.85 41.73 140.05 50.23" fill="#df5504" />
          <rect x="59.84" y="85.16" width="13.33" height="3.14" fill="#df5504" stroke="#df5504" strokeMiterlimit="10" />
          <polygon points="102.9 17 102.9 20.1 120.6 20.1 120.6 28.6 123.7 28.6 123.7 17 102.9 17" fill="#df5504" stroke="#df5504" strokeMiterlimit="10" />
          <rect x="86.75" y="17" width="17.68" height="3.1" fill="#df5504" stroke="#df5504" strokeMiterlimit="10" />
          <polygon points="121.55 70.16 121.55 85.2 110.85 85.2 110.85 88.3 124.65 88.3 124.65 70.16 121.55 70.16" fill="#df5504" stroke="#df5504" strokeMiterlimit="10" />
          <rect x="2.89" y="1.58" width="83.86" height="7.61" fill="#df5504" stroke="#df5504" strokeMiterlimit="10" />
          <polygon points="41.6 122.98 41.5 122.98 36.54 122.98 3.7 122.98 3.7 89.71 3.7 85.18 3.7 82.08 .5 82.08 .5 126.18 44.6 126.18 44.6 122.98 41.6 122.98" fill="#df5504" stroke="#df5504" strokeMiterlimit="10" />
          <rect x="3.3" y="79.29" width="3.1" height="8.7" transform="translate(88.48, 78.79) rotate(90)" fill="#df5504" stroke="#df5504" strokeMiterlimit="10" />
          <rect x="41.5" y="116.11" width="3.1" height="8.7" transform="translate(86.1, 240.92) rotate(180)" fill="#df5504" stroke="#df5504" strokeMiterlimit="10" />
          <polygon points="4.85 7.8 4.04 7.8 4.04 3.7 4.85 3.7 4.85 .5 .94 .5 .94 64.3 4.14 64.3 4.14 61.2 4.14 58.5 4.14 10.9 4.85 10.9 4.85 7.8" fill="#df5504" stroke="#df5504" strokeMiterlimit="10" />
          <path d="M11.9.5v3.2h73.3v4.1H11.9v3.1h73.4v6.1H26v44.2h-14.1v3.1h14v8.1H8.7v9.8h.1v34.3h44v-28.2h11.8v-3.1h-11.8v-12.8h-23.8V20.1h59.4V.5H11.9ZM49.7,75.5v37.8H11.9v-37.8h37.8Z" fill="#df5504" stroke="#df5504" strokeMiterlimit="10" />
          <rect x="1.78" y="61.23" width="11.92" height="3.07" fill="#df5504" stroke="#df5504" strokeMiterlimit="10" />
          <rect x="1.78" y="7.8" width="13.96" height="3.04" fill="#df5504" stroke="#df5504" strokeMiterlimit="10" />
          <rect x="1.78" y=".5" width="16.51" height="3.2" fill="#df5504" stroke="#df5504" strokeMiterlimit="10" />
          <polygon points="119.35 49.43 119.15 49.43 101.95 40.93 91.65 35.73 50.45 35.73 50.45 65.13 76 65.13 78.15 65.13 106.85 65.13 108.63 65.13 134.55 65.13 134.55 57.13 119.35 49.43" fill="#df5504" />
          <path d="M77.85,65.13v8.87c-1-.2-13-2.8-13-2.8l13.1,6.1,16.2,8,.7,2.4-16.9-8.3v1.9l28.6,13.9v-30.07h-28.7Z" fill="#df5504" />
        </svg>

        {/* Brand Badge in Orange on the Right of Logo (Case Sensitive MTRAx lite) */}
        <span className="text-[11px] sm:text-xs font-black tracking-wider bg-[#DF5504]/10 border border-[#DF5504]/25 text-[var(--color-accent,#DF5504)] px-2.5 py-1 rounded-sm font-mono select-none">
          MTRAx lite
        </span>
      </div>

      {/* HEADER SECTION (CONTROL ICON BAR) */}
      <header className="flex items-center justify-start gap-3 border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-4 mb-6 flex-shrink-0">
        {/* Suited Minimalist Hamburger Menu Button */}
        <button
          onClick={async () => {
            await triggerHaptic();
            setIsSidebarOpen(!isSidebarOpen);
          }}
          className="w-9 h-9 rounded-full bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-[var(--color-accent,#DF5504)] text-white flex items-center justify-center text-sm font-black transition-all hover:scale-105 active:scale-95 cursor-pointer flex-shrink-0 hover:text-[var(--color-accent,#DF5504)] hover:shadow-[0_0_10px_rgba(223,85,4,0.3)]"
          title="Open Menu"
        >
          ☰
        </button>

        {/* Minimalist Dashboard Help/Runbook icon */}
        <button
          onClick={async () => {
            await triggerHaptic();
            setIsDashboardHelpOpen(true);
          }}
          className="w-9 h-9 rounded-full bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-[var(--color-accent,#DF5504)] text-white flex items-center justify-center text-sm font-black transition-all hover:scale-105 active:scale-95 cursor-pointer flex-shrink-0 hover:text-[var(--color-accent,#DF5504)] hover:shadow-[0_0_10px_rgba(223,85,4,0.3)]"
          title="Dashboard Runbook"
        >
          ❓
        </button>
      </header>
      <main className="flex-grow overflow-y-auto no-scrollbar pr-0.5">
        <div className="grid grid-cols-1 gap-6 items-start">
        
        {/* COL 1 & 2: THE BRUTAL KANBAN BOARD */}
        <div className="w-full grid grid-cols-1 gap-4">
          
          {/* UNIVERSAL COLUMN NAVIGATION SUBHEADER */}
          <div className="flex justify-start items-center p-2.5 bento-box mb-4 font-mono text-xs gap-4 w-full">
            <div className="flex items-center gap-2 flex-shrink-0">
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
                className="w-8 h-8 rounded-full bento-btn text-white flex items-center justify-center text-lg font-black transition-all cursor-pointer"
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
                    className="w-5 h-5 rounded-full bg-[var(--color-accent,#DF5504)] text-white font-bold flex items-center justify-center text-[10px] uppercase hover:opacity-90 active:scale-95 transition-all cursor-pointer"
                  >
                    ✓
                  </button>
                  <button 
                    type="button" 
                    onClick={() => {
                      setNewListVal('');
                      setIsAddingList(false);
                    }}
                    className="w-5 h-5 rounded-full bg-transparent hover:bg-white/10 text-gray-400 hover:text-white flex items-center justify-center text-xs font-mono transition-colors cursor-pointer"
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
                  className="h-8 px-2.5 rounded-full bento-btn text-white flex items-center justify-center gap-1 text-[11px] font-bold uppercase transition-all cursor-pointer"
                  title="Add Custom List"
                >
                  📋＋
                </button>
              )}
            </div>

            {/* Custom Interactive Swipe Pagination Dots & Column Indicators Aligned on Left */}
            <div className="flex items-center gap-3.5">
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
                        const isMobile = window.innerWidth < 640;
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
              <span className="text-[10px] font-black text-white uppercase tracking-wider pl-0.5 font-mono">
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
                    # of cards: {cards.filter(c => c.listId === list.id && !c.isArchived).length}
                  </span>
                </div>

                <div className="flex flex-col gap-3 min-h-[200px]">
                  {cards.filter(c => c.listId === list.id && !c.isArchived).map(card => (
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
                      <div className="border-t border-[var(--color-dark-tertiary,#3D3D3D)] mt-3 pt-2 flex items-center font-mono">
                        <span className="text-[10px] text-[var(--color-accent,#DF5504)]">⏱ {Math.floor((card.timeSpent || 0) / 60)}m spent</span>
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

    </main>

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

      {/* ⚙️ UNIFIED SETTINGS MODAL */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="w-full max-w-lg bento-box p-6 bg-[var(--color-dark-bg,#282828)] text-white flex flex-col gap-4 font-mono text-xs max-h-[90vh] overflow-y-auto no-scrollbar">
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-3 flex-shrink-0">
              <h3 className="font-black text-sm uppercase tracking-wider text-[var(--color-accent,#DF5504)] flex items-center gap-1.5">
                ⚙️ {t('settings')}
              </h3>
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIsSettingsOpen(false);
                }}
                className="w-6 h-6 rounded-full border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white flex items-center justify-center font-bold text-xs transition-all cursor-pointer text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Brutalist Tab Bar */}
            <div className="grid grid-cols-3 gap-1 border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-3 flex-shrink-0">
              {(['appearance', 'sync', 'admin'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    setActiveSettingsTab(tab);
                  }}
                  className={`py-2 px-1 text-[9px] font-black uppercase text-center border transition-all cursor-pointer truncate ${
                    activeSettingsTab === tab
                      ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white shadow-sm'
                      : 'bg-black/30 border-[var(--color-dark-tertiary,#3D3D3D)] text-gray-400 hover:text-white hover:border-gray-500'
                  }`}
                >
                  {tab === 'appearance' && '🎨 Style'}
                  {tab === 'sync' && '☁️ Sync'}
                  {tab === 'admin' && '🛠️ Admin'}
                </button>
              ))}
            </div>

            {/* Tab Contents */}
            <div className="flex-grow flex flex-col gap-4 py-2 min-h-[220px]">
              {/* STYLE TAB */}
              {activeSettingsTab === 'appearance' && (
                <div className="flex flex-col gap-4 animate-fadeIn">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] text-gray-400 uppercase font-black">{t('theme')}</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          await triggerHaptic();
                          setThemeMode('dark');
                        }}
                        className={`p-3 border text-left flex flex-col gap-1 rounded-sm transition-all cursor-pointer ${
                          themeMode === 'dark'
                            ? 'border-[var(--color-accent,#DF5504)] bg-black/40 text-white'
                            : 'border-[var(--color-dark-tertiary,#3D3D3D)] bg-black/10 text-gray-500 hover:border-gray-600'
                        }`}
                      >
                        <span className="font-bold text-[10px] uppercase">🌙 Dark Mode</span>
                        <span className="text-[8px] text-gray-500">Classic high-contrast brutalist design</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await triggerHaptic();
                          setThemeMode('light');
                        }}
                        className={`p-3 border text-left flex flex-col gap-1 rounded-sm transition-all cursor-pointer ${
                          themeMode === 'light'
                            ? 'border-[var(--color-accent,#DF5504)] bg-white/10 text-white'
                            : 'border-[var(--color-dark-tertiary,#3D3D3D)] bg-black/10 text-gray-500 hover:border-gray-600'
                        }`}
                      >
                        <span className="font-bold text-[10px] uppercase">☀️ Light Mode</span>
                        <span className="text-[8px] text-gray-500">Premium contrast white theme</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] text-gray-400 uppercase font-black">{t('textSize')}</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['standard', 'large', 'xlarge'] as const).map((scale) => (
                        <button
                          key={scale}
                          type="button"
                          onClick={async () => {
                            await triggerHaptic();
                            setTextScale(scale);
                          }}
                          className={`py-2 px-1 text-center border rounded-sm font-bold text-[10px] uppercase transition-all cursor-pointer ${
                            textScale === scale
                              ? 'border-[var(--color-accent,#DF5504)] bg-black/40 text-[var(--color-accent,#DF5504)]'
                              : 'border-[var(--color-dark-tertiary,#3D3D3D)] bg-black/10 text-gray-400 hover:border-gray-600'
                          }`}
                        >
                          {scale === 'standard' && 'Standard'}
                          {scale === 'large' && 'Large'}
                          {scale === 'xlarge' && 'X-Large'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}


              {/* SYNC TAB */}
              {activeSettingsTab === 'sync' && (
                <div className="flex flex-col gap-3 animate-fadeIn">
                  <div className="p-3 bg-black/20 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded-sm flex flex-col gap-1">
                    <span className="text-gray-400 text-[10px] uppercase font-black">💾 Storage Engine</span>
                    <span className="text-white font-bold text-[10px]">Capacitor Preferences & LocalStorage</span>
                    <p className="text-[8px] text-gray-500 leading-relaxed mt-1">
                      MTRAx lite is private-by-design. All your board cards, focus sessions, and receipts remain completely offline inside your native platform secure storage.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 mt-1">
                    <label className="text-[10px] text-gray-400 uppercase font-black">Sync & Export Operations</label>
                    <div className="grid grid-cols-2 gap-2">
                      {/* Export Data Button */}
                      <button
                        type="button"
                        onClick={async () => {
                          await triggerHaptic();
                          handlePremiumAction(() => {
                            setActiveMenuModal('backup');
                            setIsSettingsOpen(false);
                          });
                        }}
                        className="p-3 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-gray-500 bg-black/40 text-left flex flex-col gap-1 rounded-sm transition-all cursor-pointer group"
                      >
                        <span className="font-bold text-[10px] text-white group-hover:text-[var(--color-accent,#DF5504)]">💾 Export Backup</span>
                        <span className="text-[8px] text-gray-500">Download Excel-compatible spreadsheet</span>
                      </button>

                      {/* iCloud Sync Button */}
                      <button
                        type="button"
                        onClick={async () => {
                          await triggerHaptic();
                          handlePremiumAction(() => {
                            setActiveMenuModal('sync');
                            setIsSettingsOpen(false);
                          });
                        }}
                        className="p-3 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-gray-500 bg-black/40 text-left flex flex-col gap-1 rounded-sm transition-all cursor-pointer group"
                      >
                        <span className="font-bold text-[10px] text-white group-hover:text-[var(--color-accent,#DF5504)]">☁️ iCloud Sync</span>
                        <span className="text-[8px] text-gray-500">Enable Apple Cloud sync services</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ADMIN TAB */}
              {activeSettingsTab === 'admin' && (
                <div className="flex flex-col gap-3 animate-fadeIn">
                  <div className="p-3 bg-red-950/20 border border-red-900/30 rounded-sm">
                    <span className="text-red-400 font-black text-[10px] uppercase">🛠️ {t('advancedAdmin')}</span>
                    <p className="text-[8px] text-gray-500 leading-relaxed mt-1">
                      Developer and diagnostic tools for verifying native Capacitor capabilities and haptics.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await triggerHaptic();
                        setActiveMenuModal('diagnostics');
                        setIsSettingsOpen(false);
                      }}
                      className="p-3 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-gray-500 bg-black/40 text-left flex flex-col gap-1 rounded-sm transition-all cursor-pointer group w-full"
                    >
                      <span className="font-bold text-[10px] text-white group-hover:text-[var(--color-accent,#DF5504)]">⚡ Diagnostics</span>
                      <span className="text-[8px] text-gray-500">Run native API platform tests</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="border-t border-[var(--color-dark-tertiary,#3D3D3D)] pt-3 flex justify-end flex-shrink-0">
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIsSettingsOpen(false);
                }}
                className="px-4 py-2 bg-[var(--color-accent,#DF5504)] hover:opacity-90 active:translate-y-0.5 text-white text-[10px] font-black uppercase rounded-sm transition-all shadow-sm cursor-pointer"
              >
                ✓ Apply Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 💎 PREMIUM UPGRADE MODAL */}
      {isUpgradeModalOpen && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-[60] animate-fadeIn">
          <div className="w-full max-w-md bento-box p-6 bg-[var(--color-dark-bg,#282828)] border-2 border-amber-500 text-white flex flex-col gap-5 font-mono text-xs">
            <div className="flex justify-between items-center border-b border-amber-500/20 pb-3">
              <h3 className="font-black text-sm uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                👑 MTRAx Premium
              </h3>
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIsUpgradeModalOpen(false);
                }}
                className="w-6 h-6 rounded-full border border-amber-500/30 hover:border-amber-400 flex items-center justify-center font-bold text-xs transition-all cursor-pointer text-amber-500 hover:text-amber-400"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <div className="w-12 h-12 rounded-full bg-amber-500/20 border border-amber-500/50 flex items-center justify-center text-2xl self-center mb-1 animate-pulse">
                👑
              </div>
              <p className="text-gray-200 text-center font-bold text-xs">
                Unlock Lifetime Professional Access
              </p>
              <p className="text-gray-400 text-center text-[10px] leading-relaxed">
                {t('upgradeDesc')}
              </p>
            </div>

            <div className="flex flex-col gap-2.5 mt-2">
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  alert("Thank you for purchasing MTRAx Premium! [Simulated Purchase Successful]");
                  setHasValidReceipt(true);
                  setIsUpgradeModalOpen(false);
                }}
                className="w-full py-3.5 bg-gradient-to-r from-amber-600 to-amber-400 hover:from-amber-500 hover:to-amber-300 text-white font-black uppercase text-[11px] tracking-wider transition-all rounded-sm shadow-md cursor-pointer active:translate-y-0.5 text-center"
              >
                🛒 Purchase Lifetime - $9.99
              </button>

              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setHasValidReceipt(true);
                  setIsUpgradeModalOpen(false);
                }}
                className="text-center text-[9px] text-gray-500 hover:text-amber-400 uppercase font-black tracking-widest transition-colors py-1 mt-1 cursor-pointer"
              >
                [Dev Bypass: Simulate App Store Receipt]
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MENU ITEM SUB-MODALS */}
      {activeMenuModal === 'backup' && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="w-full max-w-md bento-box p-6 text-white flex flex-col gap-4 font-mono text-xs">
            <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-3 flex-shrink-0">
              <h3 className="font-black text-sm uppercase tracking-wider text-[var(--color-accent,#DF5504)] flex items-center gap-1.5">
                💾 Export Data Backup
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    setShowBackupHelp(!showBackupHelp);
                  }}
                  className={`w-6 h-6 rounded-full border flex items-center justify-center font-bold text-xs transition-all cursor-pointer ${
                    showBackupHelp
                      ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                      : 'bg-black/40 border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white'
                  }`}
                  title="Export Backup Guide"
                >
                  ❓
                </button>
                <button 
                  onClick={async () => {
                    await triggerHaptic();
                    setActiveMenuModal(null);
                    setShowBackupHelp(false);
                  }}
                  className="text-gray-400 hover:text-white font-black text-lg transition-colors cursor-pointer bg-transparent border-none"
                >
                  &times;
                </button>
              </div>
            </div>

            {showBackupHelp && (
              <div className="p-3.5 bg-blue-950/70 border border-blue-800/50 text-blue-300 rounded flex flex-col gap-2.5 text-[10px] leading-relaxed animate-fadeIn text-left w-full flex-shrink-0">
                <div className="font-bold text-[10px] uppercase text-blue-400 border-b border-blue-900/30 pb-1 flex justify-between items-center font-mono w-full">
                  <span>💾 Export Backup Guide</span>
                  <button
                    type="button"
                    onClick={() => setShowBackupHelp(false)}
                    className="text-[9px] hover:text-white cursor-pointer uppercase font-black"
                  >
                    Hide ×
                  </button>
                </div>
                
                <div className="flex flex-col gap-2 font-sans">
                  <p>
                    📊 <strong className="text-white font-mono">EXCEL COMPATIBILITY:</strong> Export tasks, descriptions, checklist entries, and session time tracking into standard spreadsheet CSV formats.
                  </p>
                  <p>
                    💾 <strong className="text-white font-mono">LOCAL DATA COPIES:</strong> Instantly compile and download exact snapshots of card databases straight onto your computer storage.
                  </p>
                  <p>
                    ⚠️ <strong className="text-white font-mono">DATABASE RESET:</strong> Securely wipe active local boards and checklists clean to start fresh on a new blank workspace at any time.
                  </p>
                </div>
              </div>
            )}

            <p className="text-gray-300 leading-relaxed text-[11px]">
              Save your offline guest sandbox work as a standardized, Excel-compatible CSV database. This allows you to back up and view all card parameters locally at any time.
            </p>

            <div className="flex flex-col gap-2 mt-2">
              <button 
                onClick={async () => {
                  await triggerHaptic();
                  handleExportCSV();
                }}
                className="w-full py-2.5 bento-btn bg-black/40 border border-gray-600/30 text-white hover:border-[var(--color-accent,#DF5504)] font-bold uppercase text-[10px] rounded transition-all flex items-center justify-center gap-1.5"
              >
                📊 Export CSV for Excel
              </button>

              <button 
                onClick={async () => {
                  await triggerHaptic();
                  handleExportFullBackup();
                }}
                className="w-full py-2.5 bento-btn bg-[var(--color-accent,#DF5504)] text-white hover:opacity-90 font-bold uppercase text-[10px] rounded transition-all flex items-center justify-center gap-1.5 shadow-md"
              >
                👑 Export Full JSON Backup (Lossless)
              </button>



              <button 
                onClick={async () => {
                  await triggerHaptic();
                  handleRestoreFullBackup();
                }}
                className="w-full py-2.5 border border-[var(--color-accent,#DF5504)] bg-transparent text-[var(--color-accent,#DF5504)] hover:bg-[var(--color-accent,#DF5504)]/10 font-bold text-[10px] uppercase rounded transition-all flex items-center justify-center gap-1.5"
              >
                📥 Import JSON Backup (Restore)
              </button>
              
              <button 
                onClick={async () => {
                  await triggerHaptic();
                  if (window.confirm('Reset all card data to default? This cannot be undone.')) {
                    await syncData('cards', []);
                    window.location.reload();
                  }
                }}
                className="w-full py-2 py-2 border border-red-500/30 bg-[var(--color-dark-bg,#282828)] text-red-400 hover:bg-red-900/10 font-bold text-[9px] uppercase rounded transition-all flex items-center justify-center gap-1.5 mt-2"
              >
                ⚠️ Reset App Database
              </button>
            </div>
          </div>
        </div>
      )}



      {activeMenuModal === 'sync' && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="w-full max-w-md bento-box p-6 text-white flex flex-col gap-4 font-mono text-xs">
            <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-3 flex-shrink-0">
              <h3 className="font-black text-sm uppercase tracking-wider text-[var(--color-accent,#DF5504)] flex items-center gap-1.5">
                ☁️ Synchronization Console
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    setShowSyncHelp(!showSyncHelp);
                  }}
                  className={`w-6 h-6 rounded-full border flex items-center justify-center font-bold text-xs transition-all cursor-pointer ${
                    showSyncHelp
                      ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                      : 'bg-black/40 border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white'
                  }`}
                  title="Cloud Sync Guide"
                >
                  ❓
                </button>
                <button 
                  onClick={async () => {
                    await triggerHaptic();
                    setActiveMenuModal(null);
                    setShowSyncHelp(false);
                  }}
                  className="text-gray-400 hover:text-white font-black text-lg transition-colors cursor-pointer bg-transparent border-none"
                >
                  &times;
                </button>
              </div>
            </div>

            {showSyncHelp && (
              <div className="p-3.5 bg-blue-950/70 border border-blue-800/50 text-blue-300 rounded flex flex-col gap-2.5 text-[10px] leading-relaxed animate-fadeIn text-left w-full flex-shrink-0">
                <div className="font-bold text-[10px] uppercase text-blue-400 border-b border-blue-900/30 pb-1 flex justify-between items-center font-mono w-full">
                  <span>☁️ Cloud Synchronization Guide</span>
                  <button
                    type="button"
                    onClick={() => setShowSyncHelp(false)}
                    className="text-[9px] hover:text-white cursor-pointer uppercase font-black"
                  >
                    Hide ×
                  </button>
                </div>
                
                <div className="flex flex-col gap-2 font-sans">
                  <p>
                    🍏 <strong className="text-white font-mono">ICLOUD BACKUP:</strong> Automate data backup by uploading workspaces and focus logs securely to your personal iCloud account.
                  </p>
                  <p>
                    💻 <strong className="text-white font-mono">MULTI-DEVICE SYNC:</strong> Sync active boards instantly to seamlessly slide across iPad, iPhone, and Mac platforms.
                  </p>
                  <p>
                    🔒 <strong className="text-white font-mono">ENTERPRISE LINKS:</strong> Easily link secure, enterprise-grade cloud databases to synchronize live tasks across workspace teams.
                  </p>
                </div>
              </div>
            )}

            <div>
              <h4 className="font-bold text-white uppercase text-xs mb-2 flex items-center gap-1.5 border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-2">
                {isConnected ? '☁️ MTRAx Enterprise SQL Sync' : '🍏 Apple iCloud Backup & Sync'}
              </h4>
              {isConnected ? (
                <div className="space-y-3 mt-3">
                  <p className="text-gray-400 text-[10px] leading-relaxed">
                    Connected to <strong className="text-white">MTRAx MySQL Database</strong>. You are viewing a simplified, action-focused board reference.
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
                  const connect = window.confirm('Link MTRAx Enterprise Account? (Mock action)');
                  if (connect) setIsConnected(true);
                }
              }}
              className={`w-full py-2.5 mt-2 rounded border border-[var(--color-dark-tertiary,#3D3D3D)] ${isConnected ? 'bg-[var(--color-dark-bg,#282828)] text-green-400 border-green-500/30' : 'bento-btn text-white'} text-[10px] font-bold uppercase tracking-wider transition-all`}
            >
              {isConnected ? '✓ Linked MTRAx Account' : 'Link MTRAx Account'}
            </button>
          </div>
        </div>
      )}

      {activeMenuModal === 'diagnostics' && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="w-full max-w-md bento-box p-6 text-white flex flex-col gap-4 font-mono text-xs">
            <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-3 flex-shrink-0">
              <h3 className="font-black text-sm uppercase tracking-wider text-[var(--color-accent,#DF5504)] flex items-center gap-1.5">
                ⚡ Native Feature Diagnostics
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    setShowDiagnosticsHelp(!showDiagnosticsHelp);
                  }}
                  className={`w-6 h-6 rounded-full border flex items-center justify-center font-bold text-xs transition-all cursor-pointer ${
                    showDiagnosticsHelp
                      ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                      : 'bg-black/40 border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white'
                  }`}
                  title="Diagnostics Guide"
                >
                  ❓
                </button>
                <button 
                  onClick={async () => {
                    await triggerHaptic();
                    setActiveMenuModal(null);
                    setShowDiagnosticsHelp(false);
                  }}
                  className="text-gray-400 hover:text-white font-black text-lg transition-colors cursor-pointer bg-transparent border-none"
                >
                  &times;
                </button>
              </div>
            </div>

            {showDiagnosticsHelp && (
              <div className="p-3.5 bg-blue-950/70 border border-blue-800/50 text-blue-300 rounded flex flex-col gap-2.5 text-[10px] leading-relaxed animate-fadeIn text-left w-full flex-shrink-0">
                <div className="font-bold text-[10px] uppercase text-blue-400 border-b border-blue-900/30 pb-1 flex justify-between items-center font-mono w-full">
                  <span>⚡ System Diagnostics Guide</span>
                  <button
                    type="button"
                    onClick={() => setShowDiagnosticsHelp(false)}
                    className="text-[9px] hover:text-white cursor-pointer uppercase font-black"
                  >
                    Hide ×
                  </button>
                </div>
                
                <div className="flex flex-col gap-2 font-sans">
                  <p>
                    🖥️ <strong className="text-white font-mono">PLATFORM WRAPPING:</strong> Review parameters checking whether the app runs inside a native Apple container or a standard browser.
                  </p>
                  <p>
                    📅 <strong className="text-white font-mono">CALENDAR PIPELINE:</strong> Verify calendar status and sync connectivity to device timetable planners.
                  </p>
                  <p>
                    🔊 <strong className="text-white font-mono">TACTILE CONTROLLER:</strong> Diagnose phone vibration triggers, switching dynamically to Web Audio synthesis fallbacks.
                  </p>
                </div>
              </div>
            )}

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
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-[150] animate-fadeIn">
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
              <div className="p-3.5 bg-blue-950/70 border border-blue-800/50 text-blue-300 rounded flex flex-col gap-2.5 text-[10px] leading-relaxed animate-fadeIn text-left w-full flex-shrink-0">
                <div className="font-bold text-[10px] uppercase text-blue-400 border-b border-blue-900/30 pb-1 flex justify-between items-center font-mono w-full">
                  <span>🏷️ Category Labels Guide</span>
                  <button
                    type="button"
                    onClick={() => setShowLabelHelp(false)}
                    className="text-[9px] hover:text-white cursor-pointer uppercase font-black"
                  >
                    Hide ×
                  </button>
                </div>
                
                <div className="flex flex-col gap-2 font-sans">
                  <p>
                    🏷️ <strong className="text-white font-mono">CUSTOM CATEGORIES:</strong> Create descriptors like URGENT, STUDY, or WORK to color-code your Kanban tasks visually.
                  </p>
                  <p>
                    🎨 <strong className="text-white font-mono">GLOW HIGHLIGHTS:</strong> Assign vibrant neon colors to categories so your cards stand out instantly on the list.
                  </p>
                  <p>
                    ✨ <strong className="text-white font-mono">CARD ASSIGNMENT:</strong> Inside any card detailed editor, check the label boxes to apply those highlights instantly.
                  </p>
                </div>
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
            <div className={`w-full max-w-md bento-box p-4 sm:p-5.5 text-white max-h-[90vh] overflow-y-auto ${isReadOnly ? 'border-amber-600/50' : ''}`}>
              {isReadOnly && (
                <div className="mb-4 p-2.5 bg-amber-950/40 border border-amber-800/50 rounded flex items-center gap-2 text-amber-300 font-mono text-[9px] uppercase tracking-wider leading-none animate-pulse">
                  <span>🔒 READ-ONLY MODE. Recall this card to active board to edit!</span>
                </div>
              )}
              <div 
                className={isReadOnly ? "pointer-events-none opacity-85 select-none" : ""}
                onClickCapture={async (e) => {
                  if (isReadOnly) {
                    e.preventDefault();
                    e.stopPropagation();
                    await triggerHaptic();
                    showToast("⚠️ This card is read-only. Recall to active board to edit!");
                  }
                }}
              >
            {/* Header */}
            <div className="flex flex-col gap-1.5 border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-2 mb-2.5">
              <div className="flex justify-between items-center">
                <h3 className="font-black text-xs font-mono uppercase tracking-wider text-gray-400">
                  Card Title
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
                    onClick={async () => {
                      await triggerHaptic();
                      navigateWithCheck(() => {
                        setSelectedCardForEdit(null);
                        setIsLabelManagerOpen(false);
                        setIsCardHelpOpen(false);
                      });
                    }}
                    className="text-gray-400 hover:text-white font-black text-lg p-1 border-none bg-transparent cursor-pointer"
                  >
                    &times;
                  </button>
                </div>
              </div>

              {/* Title input field directly under the Card Title label header */}
              <div className="mt-1">
                <input 
                  type="text"
                  value={selectedCardForEdit.title}
                  onChange={(e) => setSelectedCardForEdit({ ...selectedCardForEdit, title: e.target.value })}
                  className="w-full bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 text-sm font-mono text-white focus:border-[var(--color-accent,#DF5504)] rounded shadow-[inset_1px_1px_3px_rgba(0,0,0,0.5)]"
                  placeholder="Enter task title..."
                />
              </div>

              {/* Dynamic Interactive Card Help Panel */}
              {isCardHelpOpen && (
                <div className="mt-2.5 p-3.5 bg-blue-950/70 border border-blue-800/50 text-blue-300 rounded flex flex-col gap-2.5 text-[10px] leading-relaxed animate-fadeIn text-left">
                  <div className="font-bold text-[10px] uppercase text-blue-400 border-b border-blue-900/30 pb-1 flex justify-between items-center font-mono w-full">
                    <span>📋 Card Edit Suite Runbook</span>
                    <button
                      type="button"
                      onClick={() => setIsCardHelpOpen(false)}
                      className="text-[9px] hover:text-white cursor-pointer uppercase font-black"
                    >
                      Hide ×
                    </button>
                  </div>
                  
                  <div className="flex flex-col gap-2 font-sans">
                    <p>
                      🏷️ <strong className="text-white font-mono">LABEL MANAGER:</strong> Assign custom category tags to color-code your cards and organize your board visually.
                    </p>
                    <p>
                      📝 <strong className="text-white font-mono">TASK SUMMARY:</strong> Write the task name and details. Deleting descriptions completely is blocked to protect your task context.
                    </p>
                    <p>
                      ⏱️ <strong className="text-white font-mono">STUDY TIMER:</strong> Start a focused study stopwatch to track exactly how many hours and seconds you focus on this task.
                    </p>
                    <p>
                      📅 <strong className="text-white font-mono">DUE DATE & TIME:</strong> Set a clear target milestone deadline, which acts as the anchor point for all reminder alerts.
                    </p>
                    <p>
                      📚 <strong className="text-white font-mono">RESEARCH CITATIONS:</strong> Log academic resources or bibliography details. Links and reference titles require each other.
                    </p>
                    <p>
                      🌐 <strong className="text-white font-mono">CLOUD STORAGE LINKS:</strong> Paste external folder links from Google Drive, Apple iCloud, or OneDrive for instant access.
                    </p>
                    <div className="border-t border-blue-900/30 pt-2 mt-1.5 flex flex-col gap-1.5">
                      <span className="font-extrabold text-blue-400 font-mono text-[9px] uppercase tracking-wide">📦 Archiving vs. 🗑️ Deletion Lifecycles</span>
                      <p>
                        • <strong className="text-white font-mono">ARCHIVE:</strong> Sets <code className="text-blue-200">isArchived: true</code>. The card is hidden from active columns but remains 100% intact on-device. All linked files, labels, checklist items, and OS alarms are preserved. Viewable/restorable in Archive Studio.
                      </p>
                      <p>
                        • <strong className="text-white font-mono">DELETE:</strong> Permanently purges the card. Large document & image attachments (Base64) stored on the card are instantly erased from disk to save space. Scheduled OS checklist alarms are cancelled, while independent Verbal Diaries & Receipts remain preserved with their card links safely reverted to Unassigned.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Inputs */}
            <div className="flex flex-col gap-2.5">
              {/* ⏱️ Session History Section */}
              <div className="flex flex-col gap-0.5 border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 pb-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-gray-400">Session History</span>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {/* Stopwatch Toggle button */}
                    <button
                      type="button"
                      onClick={async () => {
                        await triggerHaptic();
                        setIsCardSessionLogExpanded(prev => !prev);
                      }}
                      className={`w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer border-2 bg-transparent hover:scale-105 ${
                        isCardSessionLogExpanded 
                          ? 'border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[0_0_10px_rgba(223,85,4,0.2)]' 
                          : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500/30'
                      }`}
                      title="Toggle Session Log View"
                    >
                      <span className="text-sm">⏱️</span>
                    </button>

                    {/* Guide button */}
                    <button
                      type="button"
                      onClick={async () => {
                        await triggerHaptic();
                        setIsSessionHistoryGuideOpen(prev => !prev);
                      }}
                      className={`w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer border-2 bg-transparent hover:scale-105 ${
                        isSessionHistoryGuideOpen 
                          ? 'border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[0_0_10px_rgba(223,85,4,0.2)]' 
                          : 'border-transparent text-red-500 hover:border-gray-500/30'
                      }`}
                      title="Session History Guide"
                    >
                      <span className="text-red-500 font-extrabold text-base">?</span>
                    </button>
                  </div>

                  {/* Total Focus Time Badge Button */}
                  <button
                    type="button"
                    onClick={async () => {
                      await triggerHaptic();
                      setIsCardSessionLogExpanded(prev => !prev);
                    }}
                    className={`px-3.5 py-1.5 border-2 rounded-lg font-black font-mono text-xs flex items-center gap-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.4)] transition-all active:translate-y-0.5 cursor-pointer ${
                      isCardSessionLogExpanded
                        ? 'bg-[var(--color-accent,#DF5504)]/20 border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[0_0_10px_rgba(223,85,4,0.15)]'
                        : 'bg-[#DF5504]/10 border-[var(--color-accent,#DF5504)]/40 hover:border-[var(--color-accent,#DF5504)]/80 text-[var(--color-accent,#DF5504)]'
                    }`}
                    title="Toggle Session Log View"
                  >
                    <span className="text-[10px] uppercase font-bold tracking-wider opacity-85">Focus Time:</span>
                    <span>
                      {Math.floor((selectedCardForEdit.timeSpent || 0) / 3600)}h {Math.floor(((selectedCardForEdit.timeSpent || 0) % 3600) / 60)}m {((selectedCardForEdit.timeSpent || 0) % 60)}s
                    </span>
                  </button>
                </div>

                {/* Inline sliding ⏱️ Session History Guide panel */}
                {isSessionHistoryGuideOpen && (
                  <div className="mt-2.5 p-3.5 bg-indigo-950/70 border border-indigo-800/50 text-indigo-300 rounded flex flex-col gap-2.5 text-[10px] leading-relaxed animate-fadeIn text-left">
                    <div className="font-bold text-[10px] uppercase text-indigo-400 border-b border-indigo-900/30 pb-1 flex justify-between items-center font-mono w-full">
                      <span>⏱️ Focus Session Log Guide</span>
                      <button
                        type="button"
                        onClick={() => setIsSessionHistoryGuideOpen(false)}
                        className="text-[9px] hover:text-white cursor-pointer uppercase font-black"
                      >
                        Hide ×
                      </button>
                    </div>
                    <div className="flex flex-col gap-1.5 font-sans">
                      <p>
                        📈 <strong className="text-white font-mono">AUTOMATIC RECORDING:</strong> Starts recording study durations seamlessly whenever you hit the stopwatch icon on the board.
                      </p>
                      <p>
                        📝 <strong className="text-white font-mono">INDIVIDUAL SESSIONS:</strong> Click the stopwatch button above to expand the history log where you can audit or prune individual study runs.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Expandable High-Fidelity Session Log List matching global popup style */}
              {isCardSessionLogExpanded && (
                <div className="animate-fadeIn p-3.5 bento-box border border-[var(--color-accent,#DF5504)] bg-black/25 font-mono text-xs flex flex-col gap-3">
                  <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)] pb-1.5">
                    <span className="font-black uppercase tracking-wider text-[var(--color-accent,#DF5504)] text-[9px] flex items-center gap-1.5">
                      <span>📋</span> Individual Sessions ({(selectedCardForEdit.studySessions || []).length})
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsCardSessionLogExpanded(false)}
                      className="text-[9px] text-gray-400 hover:text-white uppercase font-black border-none bg-transparent cursor-pointer"
                    >
                      ✕ Close
                    </button>
                  </div>

                  <div className="flex flex-col gap-2 max-h-[160px] overflow-y-auto pr-1">
                    {!(selectedCardForEdit.studySessions && selectedCardForEdit.studySessions.length > 0) ? (
                      <div className="text-center py-4 text-gray-500 text-[10px] uppercase font-bold tracking-wider">
                        No individual focus sessions logged yet.
                      </div>
                    ) : (
                      [...selectedCardForEdit.studySessions].reverse().map(session => {
                        const dateStr = new Date(session.timestamp).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit'
                        });
                        const hrs = Math.floor(session.duration / 3600);
                        const mins = Math.floor((session.duration % 3600) / 60);
                        const secs = session.duration % 60;
                        const durationStr = `${hrs > 0 ? hrs + 'h ' : ''}${mins > 0 ? mins + 'm ' : ''}${secs}s`;

                        return (
                          <div key={session.id} className="flex justify-between items-center bg-black/30 p-2 border border-[var(--color-dark-tertiary,#3D3D3D)]/40 rounded hover:bg-black/55 transition-all">
                            <div className="flex flex-col gap-0.5 text-left">
                              <span className="text-[10px] text-gray-400 font-bold">{dateStr}</span>
                              <span className="text-[11px] text-[var(--color-accent,#DF5504)] font-black uppercase">Duration: {durationStr}</span>
                            </div>
                            <button
                              type="button"
                              onClick={async () => {
                                await triggerHaptic();
                                if (confirm("Delete this individual study focus session? This will subtract its duration from the card's total time.")) {
                                  const sessions = selectedCardForEdit.studySessions || [];
                                  const updatedSessions = sessions.filter(s => s.id !== session.id);
                                  const newTimeSpent = Math.max(0, (selectedCardForEdit.timeSpent || 0) - session.duration);
                                  
                                  setSelectedCardForEdit({
                                    ...selectedCardForEdit,
                                    studySessions: updatedSessions,
                                    timeSpent: newTimeSpent
                                  });

                                  const updatedCards = cards.map(c => 
                                    c.id === selectedCardForEdit.id 
                                      ? { ...c, studySessions: updatedSessions, timeSpent: newTimeSpent } 
                                      : c
                                  );
                                  await saveCards(updatedCards);
                                  showToast("🗑️ Individual session deleted successfully!");
                                }
                              }}
                              className="w-6 h-6 rounded bg-black/40 hover:bg-red-950 hover:text-red-400 border border-[var(--color-dark-tertiary,#3D3D3D)] flex items-center justify-center text-[10px] transition-colors cursor-pointer"
                              title="Delete Session"
                            >
                              🗑️
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
              {/* Description Section */}
              <div className="border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 pb-2">
                <label className="block text-[10px] font-mono font-bold uppercase text-gray-400 mb-0.5">Description</label>
                <textarea 
                  value={selectedCardForEdit.description || ''}
                  onChange={(e) => setSelectedCardForEdit({ ...selectedCardForEdit, description: e.target.value })}
                  className="w-full h-14 bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 text-xs font-mono text-white focus:border-[var(--color-accent,#DF5504)] rounded shadow-[inset_1px_1px_3px_rgba(0,0,0,0.5)]"
                />
              </div>

              {/* Redesigned Compact Labels Section */}
              <div className="flex flex-col gap-0.5 border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 pb-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-gray-400">Labels</span>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {/* Open Board Label Studio Modal */}
                    <button
                      type="button"
                      onClick={async () => {
                        await triggerHaptic();
                        setEditingLabelId(null);
                        setLabelFormText('');
                        setLabelFormColor('#DF5504');
                        setIsGlobalLabelModalOpen(true);
                      }}
                      className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer border-2 border-transparent text-gray-400 hover:text-white hover:border-gray-500/30 hover:scale-105"
                      title="Open Board Label Studio"
                    >
                      <span className="text-sm">🏷️</span>
                    </button>

                    {/* Labels Guide Toggle */}
                    <button
                      type="button"
                      onClick={async () => {
                        await triggerHaptic();
                        setIsLabelHelpOpen(prev => !prev);
                      }}
                      className={`w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer border-2 bg-transparent hover:scale-105 ${
                        isLabelHelpOpen 
                          ? 'border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[0_0_10px_rgba(223,85,4,0.2)]' 
                          : 'border-transparent text-red-500 hover:border-gray-500/30'
                      }`}
                      title="Labels Guide"
                    >
                      <span className="text-red-500 font-extrabold text-base">❓</span>
                    </button>

                    {/* Toggle tag board drawer to select existing labels */}
                    <button
                      type="button"
                      onClick={async () => {
                        await triggerHaptic();
                        setIsLabelManagerOpen(prev => !prev);
                      }}
                      className={`w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer border-2 bg-transparent hover:scale-105 ${
                        isLabelManagerOpen 
                          ? 'border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[0_0_10px_rgba(223,85,4,0.2)]' 
                          : 'border-transparent text-green-500 hover:border-gray-500/30'
                      }`}
                      title="Add/Allocate Labels"
                    >
                      <span className="text-sm font-bold text-green-500">＋</span>
                    </button>
                  </div>

                  {/* Active Labels Tally Badge Button */}
                  {(() => {
                    const labelsCount = selectedCardForEdit.labelIds?.length || 0;
                    return (
                      <button
                        type="button"
                        onClick={async () => {
                          await triggerHaptic();
                          setIsLabelManagerOpen(prev => !prev);
                        }}
                        className={`px-3 py-1.5 border rounded-lg font-black font-mono text-xs flex items-center gap-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.4)] transition-all active:translate-y-0.5 cursor-pointer ${
                          isLabelManagerOpen
                            ? 'bg-[var(--color-accent,#DF5504)]/20 border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[0_0_10px_rgba(223,85,4,0.15)]'
                            : 'bg-[#DF5504]/10 border-[var(--color-accent,#DF5504)]/40 hover:border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)]'
                        }`}
                        title="Toggle Label Manager"
                      >
                        <span className="text-[10px] uppercase font-bold tracking-wider opacity-85">Tags:</span>
                        <span>{labelsCount}</span>
                      </button>
                    );
                  })()}
                </div>

                {/* Active Labels Badges List */}
                {selectedCardForEdit.labelIds && selectedCardForEdit.labelIds.map(id => labels.find(l => l.id === id)).filter(Boolean).length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {selectedCardForEdit.labelIds.map(labelId => {
                      const labelObj = labels.find(l => l.id === labelId);
                      if (!labelObj) return null;
                      return (
                        <span 
                          key={labelId}
                          className="text-[9px] font-black text-white uppercase px-1.5 py-0.5 rounded border border-white/10 shadow-[1px_1px_0px_0px_rgba(0,0,0,0.3)] animate-fadeIn"
                          style={{ backgroundColor: labelObj.color }}
                        >
                          {labelObj.text}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Labels Guide Panel */}
                {isLabelHelpOpen && (
                  <div className="mt-2.5 p-3.5 bg-violet-950/70 border border-violet-800/50 text-violet-300 rounded flex flex-col gap-2.5 text-[10px] leading-relaxed animate-fadeIn text-left font-sans">
                    <div className="font-bold text-[10px] uppercase text-violet-400 border-b border-violet-900/30 pb-1 flex justify-between items-center font-mono w-full">
                      <span>🏷️ Labels & Tags Guide</span>
                      <button
                        type="button"
                        onClick={() => setIsLabelHelpOpen(false)}
                        className="text-[9px] hover:text-white cursor-pointer uppercase font-black font-mono"
                      >
                        Hide ×
                      </button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <p>
                        🏷️ <strong className="text-white font-mono">TAG ALLOCATIONS:</strong> Assign label tags to filter, group, and track tasks on your board. Clicking labels on the main board filters viewports.
                      </p>
                      <p>
                        ＋ <strong className="text-white font-mono">CUSTOM LABELS:</strong> Select "Create New Label..." from the dropdown to design custom colors and names for your labels globally.
                      </p>
                    </div>
                  </div>
                )}

                {/* Collapsible Label Selector Dropdown (Interactive Tag Board) */}
                {isLabelManagerOpen && (
                  <div className="bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2.5 rounded mt-2.5 animate-fadeIn flex flex-col gap-2 font-mono text-xs text-left shadow-[inset_1px_1px_3px_rgba(0,0,0,0.5)]">
                    <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 pb-1">
                      <span className="font-bold text-[9px] uppercase text-gray-400">Board Labels Dashboard</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await triggerHaptic();
                          setIsLabelManagerOpen(false);
                        }}
                        className="text-[9px] text-gray-400 hover:text-white cursor-pointer"
                      >
                        Close ×
                      </button>
                    </div>
                    
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {labels.map(lbl => {
                        const isAssigned = selectedCardForEdit.labelIds?.includes(lbl.id);
                        return (
                          <button
                            key={lbl.id}
                            type="button"
                            onClick={async () => {
                              await triggerHaptic();
                              const currentIds = selectedCardForEdit.labelIds || [];
                              const nextIds = isAssigned 
                                ? currentIds.filter(id => id !== lbl.id) 
                                : [...currentIds, lbl.id];
                              setSelectedCardForEdit({ ...selectedCardForEdit, labelIds: nextIds });
                            }}
                            className={`text-[9px] font-black px-2 py-1 rounded border transition-all flex items-center gap-1 cursor-pointer ${
                              isAssigned 
                                ? 'border-white scale-105 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.4)]' 
                                : 'border-transparent opacity-50 hover:opacity-100'
                            }`}
                            style={{ backgroundColor: lbl.color, color: 'white' }}
                          >
                            {lbl.text} {isAssigned ? '✓' : '＋'}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex justify-start mt-1 pt-1.5 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/30">
                      <button
                        type="button"
                        onClick={async () => {
                          await triggerHaptic();
                          setEditingLabelId(null);
                          setLabelFormText('');
                          setLabelFormColor('#DF5504');
                          setIsGlobalLabelModalOpen(true);
                        }}
                        className="text-[9px] text-[var(--color-accent,#DF5504)] font-bold uppercase hover:underline cursor-pointer"
                      >
                        ＋ Create New Custom Label Type
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* List Column Selection Dropdown */}
              <div className="relative border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 pb-2">
                <span className="block text-[10px] font-mono font-bold uppercase text-gray-400 mb-0.5">List</span>
                <div className="flex items-center gap-1">
                  <div className="flex items-center gap-1 p-0.5 bg-black/25 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded min-h-[32px] flex-grow">
                    {(() => {
                      const activeList = lists.find(l => l.id === selectedCardForEdit.listId);
                      return (
                        <div className="flex items-center justify-between w-full px-2">
                          <span className="text-[11px] font-black font-mono uppercase tracking-wider text-[var(--color-accent,#DF5504)] flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent,#DF5504)] animate-pulse" />
                            {activeList?.name || 'Unassigned'}
                          </span>
                          <button
                            type="button"
                            onClick={async () => {
                              await triggerHaptic();
                              setIsListDropdownOpen(prev => !prev);
                              setIsCreatingListInline(false);
                              setInlineNewListName('');
                            }}
                            className={`w-7 h-7 rounded flex items-center justify-center font-black transition-all cursor-pointer border bg-[#222222] ${
                              isListDropdownOpen 
                                ? 'border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[inset_1px_1px_3px_rgba(0,0,0,0.5)]' 
                                : 'border-[#2C2C2C] shadow-[2px_2px_0px_0px_#A2A2A2] hover:translate-y-[-1px] hover:shadow-[3px_3px_0px_0px_#A2A2A2] active:translate-y-[1px] active:shadow-[1px_1px_0px_0px_#A2A2A2] text-gray-400'
                            }`}
                            title="Choose list column"
                          >
                            <span className="text-[10px] transform transition-transform duration-200" style={{ transform: isListDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Absolute-positioned Dropdown Menu with high z-index */}
                {isListDropdownOpen && (
                  <div className="absolute right-0 left-0 mt-1 bg-[var(--color-dark-secondary,#333333)] border-2 border-[var(--color-dark-tertiary,#3D3D3D)] rounded-lg shadow-[4px_4px_0px_0px_#000] z-[150] overflow-hidden max-h-60 overflow-y-auto animate-fadeIn font-mono text-xs text-left p-1.5 flex flex-col gap-1">
                    <span className="text-[9px] uppercase font-bold text-gray-400 px-2 py-1 border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 mb-1">Move to Column:</span>
                    {lists.filter(l => l.id !== selectedCardForEdit.listId).map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={async () => {
                          await triggerHaptic();
                          setSelectedCardForEdit({ ...selectedCardForEdit, listId: l.id });
                          setIsListDropdownOpen(false);
                        }}
                        className="w-full text-left px-2.5 py-1.5 rounded hover:bg-black/30 text-white font-bold text-[10px] uppercase transition-all flex items-center gap-2 border-none bg-transparent cursor-pointer"
                      >
                        <span className="w-1 h-1 rounded-full bg-gray-500" />
                        {l.name}
                      </button>
                    ))}

                    {lists.filter(l => l.id !== selectedCardForEdit.listId).length === 0 && (
                      <span className="text-[9px] text-gray-500 italic px-2.5 py-1">No other columns.</span>
                    )}

                    <div className="border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40 mt-1 pt-1">
                      {isCreatingListInline ? (
                        <div className="flex items-center gap-1.5 p-1 bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded-lg">
                          <input
                            type="text"
                            placeholder="New Column Name..."
                            value={inlineNewListName}
                            onChange={(e) => setInlineNewListName(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const trimmed = inlineNewListName.trim();
                                if (trimmed) {
                                  await triggerHaptic();
                                  const newId = `list-${Date.now()}`;
                                  const newList = { id: newId, name: trimmed };
                                  const updatedLists = [...lists, newList];
                                  await saveLists(updatedLists);
                                  setSelectedCardForEdit({ ...selectedCardForEdit, listId: newId });
                                  setInlineNewListName('');
                                  setIsCreatingListInline(false);
                                  setIsListDropdownOpen(false);
                                  showToast(`🚀 Column "${trimmed}" created & assigned!`);
                                }
                              }
                            }}
                            className="flex-grow bg-transparent text-white border-none focus:outline-none placeholder-gray-500 text-[10px] font-mono px-1 py-1"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              await triggerHaptic();
                              const trimmed = inlineNewListName.trim();
                              if (trimmed) {
                                const newId = `list-${Date.now()}`;
                                const newList = { id: newId, name: trimmed };
                                const updatedLists = [...lists, newList];
                                await saveLists(updatedLists);
                                setSelectedCardForEdit({ ...selectedCardForEdit, listId: newId });
                                setInlineNewListName('');
                                setIsCreatingListInline(false);
                                setIsListDropdownOpen(false);
                                showToast(`🚀 Column "${trimmed}" created & assigned!`);
                              } else {
                                setIsCreatingListInline(false);
                              }
                            }}
                            className="px-2 py-1 bg-[var(--color-accent,#DF5504)] text-white text-[9px] font-bold rounded uppercase cursor-pointer border-none"
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={async () => {
                            await triggerHaptic();
                            setIsCreatingListInline(true);
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded hover:bg-black/30 text-[var(--color-accent,#DF5504)] font-black text-[9px] uppercase tracking-wider transition-all flex items-center gap-1 border-none bg-transparent cursor-pointer"
                        >
                          ＋ Add New List Column
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Checklist & Tasks Section */}
              <div className="flex flex-col gap-0.5 border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 pb-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-gray-400">Checklist & Tasks</span>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {/* Open roomy checklist sub-modal */}
                    <button
                      type="button"
                      onClick={async () => {
                        await triggerHaptic();
                        setIsChecklistModalOpen(true);
                      }}
                      className={`w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer border-2 bg-transparent hover:scale-105 ${
                        isChecklistModalOpen 
                          ? 'border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[0_0_10px_rgba(223,85,4,0.2)]' 
                          : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500/30'
                      }`}
                      title="Open Checklist Manager"
                    >
                      <span className="text-sm">📋</span>
                    </button>

                    {/* Checklist help guide */}
                    <button
                      type="button"
                      onClick={async () => {
                        await triggerHaptic();
                        setIsChecklistHelpOpen(prev => !prev);
                      }}
                      className={`w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer border-2 bg-transparent hover:scale-105 ${
                        isChecklistHelpOpen 
                          ? 'border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[0_0_10px_rgba(223,85,4,0.2)]' 
                          : 'border-transparent text-red-500 hover:border-gray-500/30'
                      }`}
                      title="Checklist Guide"
                    >
                      <span className="text-red-500 font-extrabold text-base">❓</span>
                    </button>
                  </div>

                  {/* Tasks Complete Tally Badge Button */}
                  {(() => {
                    const totalTasks = selectedCardForEdit.checklists?.[0]?.items?.length || 0;
                    const completedTasks = selectedCardForEdit.checklists?.[0]?.items?.filter(it => it.isChecked).length || 0;
                    return (
                      <button
                        type="button"
                        onClick={async () => {
                          await triggerHaptic();
                          setIsChecklistModalOpen(prev => !prev);
                        }}
                        className={`px-3 py-1.5 border rounded-lg font-black font-mono text-xs flex items-center gap-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.4)] transition-all active:translate-y-0.5 cursor-pointer ${
                          isChecklistModalOpen
                            ? 'bg-[var(--color-accent,#DF5504)]/20 border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[0_0_10px_rgba(223,85,4,0.15)]'
                            : 'bg-[#DF5504]/10 border-[var(--color-accent,#DF5504)]/40 hover:border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)]'
                        }`}
                        title="Toggle Checklist Manager"
                      >
                        <span className="text-[10px] uppercase font-bold tracking-wider opacity-85">Tasks:</span>
                        <span>{completedTasks}/{totalTasks}</span>
                      </button>
                    );
                  })()}
                </div>

                {/* Sliding Checklist Help Guide Panel */}
                {isChecklistHelpOpen && (
                  <div className="mt-2.5 p-3.5 bg-indigo-950/70 border border-indigo-800/50 text-indigo-300 rounded flex flex-col gap-2.5 text-[10px] leading-relaxed animate-fadeIn text-left font-sans">
                    <div className="font-bold text-[10px] uppercase text-indigo-400 border-b border-indigo-900/30 pb-1 flex justify-between items-center font-mono w-full">
                      <span>📋 Checklist & Tasks Guide</span>
                      <button
                        type="button"
                        onClick={() => setIsChecklistHelpOpen(false)}
                        className="text-[9px] hover:text-white cursor-pointer uppercase font-black font-mono"
                      >
                        Hide ×
                      </button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <p>
                        📋 <strong className="text-white font-mono">ROOMY SUB-TASKS:</strong> Click the clipboard button to open a roomy sub-task editor overlay containing a streamlined add-new bar, sub-task list, inline checkbox toggles, edits, and deletions.
                      </p>
                      <p>
                        ⏰ <strong className="text-white font-mono">ALARMS & REMINDERS:</strong> Tap the pencil icon next to any sub-task inside the manager to schedule a custom lead-time reminder alert.
                      </p>
                    </div>
                  </div>
                )}
              </div>


              {/* Notifications & Alert Studio Row */}
              <div className="flex flex-col gap-0.5 border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 pb-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-gray-400">Notifications</span>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {/* Trigger alarm studio modal */}
                    <button
                      type="button"
                      onClick={async () => {
                        await triggerHaptic();
                        setIsNotificationStudioOpen(true);
                      }}
                      className={`w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer border-2 bg-transparent hover:scale-105 ${
                        isNotificationStudioOpen 
                          ? 'border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[0_0_10px_rgba(223,85,4,0.2)]' 
                          : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500/30'
                      }`}
                      title="Open Notification & Alert Studio"
                    >
                      <span className="text-sm">🔔</span>
                    </button>

                    {/* Sliding alerts help guide toggle */}
                    <button
                      type="button"
                      onClick={async () => {
                        await triggerHaptic();
                        setIsAlertsHelpOpen(prev => !prev);
                      }}
                      className={`w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer border-2 bg-transparent hover:scale-105 ${
                        isAlertsHelpOpen 
                          ? 'border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[0_0_10px_rgba(223,85,4,0.2)]' 
                          : 'border-transparent text-red-500 hover:border-gray-500/30'
                      }`}
                      title="Alerts Guide"
                    >
                      <span className="text-red-500 font-extrabold text-base">❓</span>
                    </button>
                  </div>

                  {/* Active Alarms Tally Badge Button */}
                  {(() => {
                    const primaryAlertCount = selectedCardForEdit.dueDate ? 1 : 0;
                    const subtaskAlertCount = selectedCardForEdit.checklists?.[0]?.items?.filter(it => it.dueDate).length || 0;
                    const totalAlarms = primaryAlertCount + subtaskAlertCount;
                    return (
                      <button
                        type="button"
                        onClick={async () => {
                          await triggerHaptic();
                          setIsNotificationStudioOpen(prev => !prev);
                        }}
                        className={`px-3 py-1.5 border rounded-lg font-black font-mono text-xs flex items-center gap-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.4)] transition-all active:translate-y-0.5 cursor-pointer ${
                          isNotificationStudioOpen
                            ? 'bg-[var(--color-accent,#DF5504)]/20 border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[0_0_10px_rgba(223,85,4,0.15)]'
                            : 'bg-[#DF5504]/10 border-[var(--color-accent,#DF5504)]/40 hover:border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)]'
                        }`}
                        title="Toggle Alert Studio"
                      >
                        <span className="text-[10px] uppercase font-bold tracking-wider opacity-85">Alarms:</span>
                        <span>{totalAlarms}</span>
                      </button>
                    );
                  })()}
                </div>
              </div>

              {/* Expandable Notification Help Info Block */}
              {isAlertsHelpOpen && (
                <div className="mt-2.5 p-3.5 bg-blue-950/70 border border-blue-800/50 text-blue-300 rounded flex flex-col gap-2.5 text-[10px] leading-relaxed animate-fadeIn text-left">
                  <div className="font-bold text-[10px] uppercase text-blue-400 border-b border-blue-900/30 pb-1 flex justify-between items-center font-mono w-full">
                    <span>⏰ Alert Notifications Guide</span>
                    <button
                      type="button"
                      onClick={() => setIsAlertsHelpOpen(false)}
                      className="text-[9px] hover:text-white cursor-pointer uppercase font-black"
                    >
                      Hide ×
                    </button>
                  </div>
                  
                  <div className="flex flex-col gap-2 font-sans">
                    <p>
                      📌 <strong className="text-white font-mono">DUE DATE ANCHOR:</strong> All reminders are calculated directly from your task's Due Date & Time. You must assign a Due Date first before you can schedule reminder alerts.
                    </p>
                    <p>
                      🔔 <strong className="text-white font-mono">LOCK-SCREEN ALARMS:</strong> Uses your phone's built-in alert manager so that notifications pop up and play sound even when your screen is locked or the app is closed.
                    </p>
                    <p>
                      ⏳ <strong className="text-white font-mono">REMINDER LEAD TIME:</strong> Choose how early you want to be alerted (e.g. exactly on time, 5 or 15 minutes early, 1 hour early, or 1 day early).
                    </p>
                    <p>
                      ⚡ <strong className="text-white font-mono">TACTILE BUZZES:</strong> Your phone will vibrate briefly with a gentle hum to confirm when a reminder is successfully scheduled.
                    </p>
                  </div>
                </div>
              )}



              {/* 📁 DOCUMENT & RESOURCE STUDIO */}
              <div className="flex flex-col gap-0.5 border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 pb-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-gray-400">Document & Resource Studio</span>
                <div className="flex items-center justify-between gap-2 mb-2.5 mt-1">
                  <div className="flex items-center gap-1.5">
                    {/* Toggle Document Studio Panel expansion */}
                    <button
                      type="button"
                      onClick={async () => {
                        await triggerHaptic();
                        setIsDocStudioOpen(prev => !prev);
                      }}
                      className={`w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer border-2 bg-transparent hover:scale-105 ${
                        isDocStudioOpen 
                          ? 'border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[0_0_10px_rgba(223,85,4,0.2)]' 
                          : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500/30'
                      }`}
                      title="Toggle Document Studio Vault"
                    >
                      <span className="text-sm">📁</span>
                    </button>

                    {/* Toggle Document Studio Guide */}
                    <button
                      type="button"
                      onClick={async () => {
                        await triggerHaptic();
                        setIsDocsHelpOpen(prev => !prev);
                      }}
                      className={`w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer border-2 bg-transparent hover:scale-105 ${
                        isDocsHelpOpen 
                          ? 'border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[0_0_10px_rgba(223,85,4,0.2)]' 
                          : 'border-transparent text-red-500 hover:border-gray-500/30'
                      }`}
                      title="Documents Guide"
                    >
                      <span className="text-red-500 font-extrabold text-base">❓</span>
                    </button>
                  </div>

                  {/* Document Count Tally Badge Button */}
                  {(() => {
                    const docCount = (selectedCardForEdit.attachments?.length || 0) + (selectedCardForEdit.resources?.length || 0);
                    return (
                      <button
                        type="button"
                        onClick={async () => {
                          await triggerHaptic();
                          setIsDocStudioOpen(prev => !prev);
                        }}
                        className={`px-3 py-1.5 border rounded-lg font-black font-mono text-xs flex items-center gap-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.4)] transition-all active:translate-y-0.5 cursor-pointer ${
                          isDocStudioOpen
                            ? 'bg-[var(--color-accent,#DF5504)]/20 border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[0_0_10px_rgba(223,85,4,0.15)]'
                            : 'bg-[#DF5504]/10 border-[var(--color-accent,#DF5504)]/40 hover:border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)]'
                        }`}
                        title="Toggle Document Studio"
                      >
                        <span className="text-[10px] uppercase font-bold tracking-wider opacity-85">Docs:</span>
                        <span>{docCount}</span>
                      </button>
                    );
                  })()}
                </div>

                {/* Expandable Document Help Info Block */}
                {isDocsHelpOpen && (
                  <div className="mt-2.5 mb-2.5 p-3.5 bg-blue-950/70 border border-blue-800/50 text-blue-300 rounded flex flex-col gap-2.5 text-[10px] leading-relaxed animate-fadeIn text-left">
                    <div className="font-bold text-[10px] uppercase text-blue-400 border-b border-blue-900/30 pb-1 flex justify-between items-center font-mono w-full">
                      <span>📁 Document & Resource Guide</span>
                      <button
                        type="button"
                        onClick={() => setIsDocsHelpOpen(false)}
                        className="text-[9px] hover:text-white cursor-pointer uppercase font-black"
                      >
                        Hide ×
                      </button>
                    </div>
                    
                    <div className="flex flex-col gap-2 font-sans">
                      <p>
                        🏆 <strong className="text-white font-mono">CENTRAL SUBMISSION PORTAL:</strong> Upload final PDF, Word, or presentation slides for this task (size limit of 1.5MB to keep things running fast).
                      </p>
                      <p>
                        🖇️ <strong className="text-white font-mono">SUPPORTING FILE VAULT:</strong> Attach helper project files, images, or reference sheets directly to the task.
                      </p>
                      <p>
                        📚 <strong className="text-white font-mono">BIBLIOGRAPHY & CITATIONS:</strong> Search academic databases and compile an interactive citations list for quick research lookups.
                      </p>
                      <p>
                        🌐 <strong className="text-white font-mono">CLOUD & DRIVES LINKS:</strong> Paste folder links from Google Drive, Apple iCloud, or Microsoft OneDrive to access shared folders instantly.
                      </p>
                    </div>
                  </div>
                )}

                {/* Expandable Document Studio Content Box */}
                {isDocStudioOpen && (
                  <div className="flex flex-col gap-3 mt-1.5 pt-3 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40 animate-fadeIn">
                  
                  {/* 📁 Unified Document & Resource Index (Only visible if attachments exist) */}
                  {(() => {
                    const submissionAttachments = selectedCardForEdit.attachments?.filter(a => a.type === 'submission') || [];
                    const supportingAttachments = selectedCardForEdit.attachments?.filter(a => a.type === 'supporting') || [];
                    const citations = selectedCardForEdit.resources || [];
                    const cloudLinks = selectedCardForEdit.attachments?.filter(a => a.type === 'cloud_link') || [];
                    const totalItems = submissionAttachments.length + supportingAttachments.length + citations.length + cloudLinks.length;

                    if (totalItems === 0) return null;

                    return (
                      <div className="p-3 bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded flex flex-col gap-2.5 text-left animate-fadeIn">
                        <div className="flex justify-between items-center pb-1.5 border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40">
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--color-accent,#DF5504)] flex items-center gap-1.5">
                            <span>📁 Unified Document & Resource Index</span>
                          </span>
                          <span className="px-1.5 py-0.5 bg-[var(--color-accent,#DF5504)]/20 border border-[var(--color-accent,#DF5504)]/40 rounded-full text-[var(--color-accent,#DF5504)] text-[8px] font-mono font-bold">
                            {totalItems} Item{totalItems > 1 ? 's' : ''}
                          </span>
                        </div>

                        {/* Tidy List of launchable links */}
                        <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-0.5 no-scrollbar">
                          {/* Submissions */}
                          {submissionAttachments.map(file => (
                            <button
                              key={file.id}
                              type="button"
                              onClick={async () => {
                                await triggerHaptic();
                                setLightboxFile(file);
                              }}
                              className="w-full text-left p-1.5 bg-[#1F1610] hover:bg-[#2C1D15] border border-orange-950/40 rounded flex justify-between items-center gap-2 font-mono text-[9px] transition-colors cursor-pointer group"
                            >
                              <span className="truncate text-white font-bold group-hover:text-[var(--color-accent,#DF5504)]">
                                🏆 [Submission] {file.name}
                              </span>
                              <span className="text-gray-500 text-[8px] flex-shrink-0">
                                {Math.round((file.size || 0) / 1024)} KB ↗
                              </span>
                            </button>
                          ))}

                          {/* Supporting Files */}
                          {supportingAttachments.map(file => (
                            <button
                              key={file.id}
                              type="button"
                              onClick={async () => {
                                await triggerHaptic();
                                setLightboxFile(file);
                              }}
                              className="w-full text-left p-1.5 bg-[#12191F] hover:bg-[#1A2631] border border-blue-950/40 rounded flex justify-between items-center gap-2 font-mono text-[9px] transition-colors cursor-pointer group"
                            >
                              <span className="truncate text-white font-bold group-hover:text-blue-400">
                                🖇️ [Supporting] {file.name}
                              </span>
                              <span className="text-gray-500 text-[8px] flex-shrink-0">
                                {Math.round((file.size || 0) / 1024)} KB ↗
                              </span>
                            </button>
                          ))}

                          {/* Citations */}
                          {citations.map(cit => (
                            <button
                              key={cit.id}
                              type="button"
                              onClick={async () => {
                                await triggerHaptic();
                                window.open(cit.url, '_blank');
                              }}
                              className="w-full text-left p-1.5 bg-[#18111F] hover:bg-[#241A2E] border border-purple-950/40 rounded flex justify-between items-center gap-2 font-mono text-[9px] transition-colors cursor-pointer group"
                            >
                              <span className="truncate text-white font-bold group-hover:text-purple-400">
                                📚 [Citation] {cit.title}
                              </span>
                              <span className="text-gray-500 text-[7px] truncate max-w-[100px] flex-shrink-0">
                                {cit.url} ↗
                              </span>
                            </button>
                          ))}

                          {/* Cloud Links */}
                          {cloudLinks.map(link => (
                            <button
                              key={link.id}
                              type="button"
                              onClick={async () => {
                                await triggerHaptic();
                                window.open(link.dataUrl, '_blank');
                              }}
                              className="w-full text-left p-1.5 bg-[#111F16] hover:bg-[#1B2F22] border border-green-950/40 rounded flex justify-between items-center gap-2 font-mono text-[9px] transition-colors cursor-pointer group"
                            >
                              <span className="truncate text-white font-bold group-hover:text-green-400">
                                🌐 [Cloud Link] {link.name}
                              </span>
                              <span className="text-gray-500 text-[7px] truncate max-w-[100px] flex-shrink-0">
                                {link.dataUrl} ↗
                              </span>
                            </button>
                          ))}
                        </div>

                        {/* Email Export Button */}
                        <a
                          href={`mailto:?subject=${encodeURIComponent(`Document Index Export: ${selectedCardForEdit.title}`)}&body=${encodeURIComponent(
                            (() => {
                              const bodyLines = [
                                `Document and Resource Index for Task: "${selectedCardForEdit.title}"`,
                                `========================================================\n`,
                                `Total items: ${totalItems}\n`
                              ];

                              if (submissionAttachments.length > 0) {
                                bodyLines.push(`🏆 CENTRAL SUBMISSIONS:`);
                                submissionAttachments.forEach(a => {
                                  bodyLines.push(`- ${a.name} (${Math.round((a.size || 0)/1024)} KB)`);
                                });
                                bodyLines.push('');
                              }

                              if (supportingAttachments.length > 0) {
                                bodyLines.push(`🖇️ SUPPORTING DOCUMENTS:`);
                                supportingAttachments.forEach(a => {
                                  bodyLines.push(`- ${a.name} (${Math.round((a.size || 0)/1024)} KB)`);
                                });
                                bodyLines.push('');
                              }

                              if (citations.length > 0) {
                                bodyLines.push(`📚 BIBLIOGRAPHY & CITATIONS:`);
                                citations.forEach(c => {
                                  bodyLines.push(`- ${c.title} : ${c.url}`);
                                });
                                bodyLines.push('');
                              }

                              if (cloudLinks.length > 0) {
                                bodyLines.push(`🌐 CLOUD & DRIVE SHARED LINKS:`);
                                cloudLinks.forEach(l => {
                                  bodyLines.push(`- ${l.name} : ${l.dataUrl}`);
                                });
                                bodyLines.push('');
                              }

                              bodyLines.push(`----------------------------------------`);
                              bodyLines.push(`Generated via MTRAx lite.`);
                              return bodyLines.join('\n');
                            })()
                          )}`}
                          onClick={async () => {
                            await triggerHaptic();
                            showToast("📧 Preparing index export email...");
                          }}
                          className="w-full text-center py-2 bg-[var(--color-accent,#DF5504)] text-white hover:opacity-90 font-bold uppercase text-[9px] tracking-wider rounded transition-all cursor-pointer block flex items-center justify-center gap-1.5"
                        >
                          <span>📬</span> Export Document Index via Email
                        </a>
                      </div>
                    );
                  })()}
                  
                  {/* 1. CENTRAL SUBMISSION PORTAL */}
                  <details className="group border border-[var(--color-dark-tertiary,#3D3D3D)] bg-[var(--color-dark-bg,#282828)] rounded p-2 overflow-hidden transition-all">
                    <summary className="font-bold font-mono text-[10px] uppercase tracking-wider text-white cursor-pointer list-none flex justify-between items-center select-none">
                      <span className="flex items-center gap-1.5">🏆 Central Submission Portal</span>
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 bg-[#DF5504]/10 border border-[var(--color-accent,#DF5504)]/30 rounded-md text-[var(--color-accent,#DF5504)] text-[8px] font-mono font-bold shadow-[1px_1px_0px_0px_rgba(0,0,0,0.3)]">
                          {selectedCardForEdit.attachments?.filter(a => a.type === 'submission').length || 0}
                        </span>
                        <span className="text-gray-500 transition-transform group-open:rotate-180">▼</span>
                      </div>
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
                                    if (subFile.filePath) {
                                      await deleteFile(subFile.filePath);
                                    }
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
                                  if (file.size > 50 * 1024 * 1024) {
                                    alert('File size exceeds 50MB. Please attach a smaller compressed file.');
                                    return;
                                  }
                                  try {
                                    showToast("💾 Saving to native high-capacity filesystem...");
                                    const { filePath, webUrl } = await saveFile(`${Date.now()}_${file.name}`, file);
                                    const nextAttachments = [
                                      ...(selectedCardForEdit.attachments || []),
                                      {
                                        id: 'attach-' + Date.now(),
                                        name: file.name,
                                        type: 'submission',
                                        size: file.size,
                                        mimeType: file.type,
                                        filePath,
                                        dataUrl: webUrl,
                                        addedAt: Date.now()
                                      } as FileAttachment
                                    ];
                                    setSelectedCardForEdit({ ...selectedCardForEdit, attachments: nextAttachments });
                                    showToast("✓ Stored natively in app sandbox!");
                                  } catch (error) {
                                    console.error('File storage error:', error);
                                    alert('Failed to store document in local sandbox.');
                                  }
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
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 bg-[#DF5504]/10 border border-[var(--color-accent,#DF5504)]/30 rounded-md text-[var(--color-accent,#DF5504)] text-[8px] font-mono font-bold shadow-[1px_1px_0px_0px_rgba(0,0,0,0.3)]">
                          {selectedCardForEdit.attachments?.filter(a => a.type === 'supporting').length || 0}
                        </span>
                        <span className="text-gray-500 transition-transform group-open:rotate-180">▼</span>
                      </div>
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
                                    if (file.filePath) {
                                      await deleteFile(file.filePath);
                                    }
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
                              if (file.size > 50 * 1024 * 1024) {
                                alert('File size exceeds 50MB. Please attach a smaller compressed file.');
                                return;
                              }
                              try {
                                showToast("💾 Saving to native high-capacity filesystem...");
                                const { filePath, webUrl } = await saveFile(`${Date.now()}_${file.name}`, file);
                                const nextAttachments = [
                                  ...(selectedCardForEdit.attachments || []),
                                  {
                                    id: 'attach-' + Date.now(),
                                    name: file.name,
                                    type: 'supporting',
                                    size: file.size,
                                    mimeType: file.type,
                                    filePath,
                                    dataUrl: webUrl,
                                    addedAt: Date.now()
                                  } as FileAttachment
                                ];
                                setSelectedCardForEdit({ ...selectedCardForEdit, attachments: nextAttachments });
                                showToast("✓ Stored natively in app sandbox!");
                              } catch (error) {
                                console.error('File storage error:', error);
                                alert('Failed to store document in local sandbox.');
                              }
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
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 bg-[#DF5504]/10 border border-[var(--color-accent,#DF5504)]/30 rounded-md text-[var(--color-accent,#DF5504)] text-[8px] font-mono font-bold shadow-[1px_1px_0px_0px_rgba(0,0,0,0.3)]">
                          {selectedCardForEdit.resources?.length || 0}
                        </span>
                        <span className="text-gray-500 transition-transform group-open:rotate-180">▼</span>
                      </div>
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
                              
                              const csvContent = headers + rows;
                              const filename = `citations_${selectedCardForEdit.id}.csv`;

                              try {
                                const file = new File([csvContent], filename, { type: 'text/csv' });
                                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                                  await navigator.share({
                                    files: [file],
                                    title: 'Citations Export',
                                    text: `Resource citations for card ${selectedCardForEdit.title}`
                                  });
                                  showToast("📤 Share sheet opened successfully!");
                                  return;
                                }
                              } catch (e) {
                                console.warn("Web Share API files sharing not supported/failed:", e);
                              }

                              const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = filename;
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
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 bg-[#DF5504]/10 border border-[var(--color-accent,#DF5504)]/30 rounded-md text-[var(--color-accent,#DF5504)] text-[8px] font-mono font-bold shadow-[1px_1px_0px_0px_rgba(0,0,0,0.3)]">
                          {selectedCardForEdit.attachments?.filter(a => a.type === 'cloud_link').length || 0}
                        </span>
                        <span className="text-gray-500 transition-transform group-open:rotate-180">▼</span>
                      </div>
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

              {/* 🧾 ASSOCIATED BUSINESS CLAIMS & RECEIPTS STUDIO */}
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-gray-400">Receipts</span>
                <div className="flex items-center justify-between gap-2 mb-2.5 mt-1">
                  <div className="flex items-center gap-1.5">
                    {/* Launch global Receipts modal */}
                    <button
                      type="button"
                      onClick={async () => {
                        await triggerHaptic();
                        setIsReceiptsOpen(true);
                      }}
                      className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer border-2 bg-transparent border-transparent text-gray-400 hover:text-white hover:border-gray-500/30 hover:scale-105"
                      title="Launch Global Receipts Tracker"
                    >
                      <span className="text-sm">🧾</span>
                    </button>

                    {/* Toggle Receipts Guide */}
                    <button
                      type="button"
                      onClick={async () => {
                        await triggerHaptic();
                        setIsReceiptsLinkHelpOpen(prev => !prev);
                      }}
                      className={`w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer border-2 bg-transparent hover:scale-105 ${
                        isReceiptsLinkHelpOpen 
                          ? 'border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[0_0_10px_rgba(223,85,4,0.2)]' 
                          : 'border-transparent text-red-500 hover:border-gray-500/30'
                      }`}
                      title="Receipts Guide"
                    >
                      <span className="text-red-500 font-extrabold text-base">❓</span>
                    </button>

                    {/* Toggle Local Linking Panel */}
                    <button
                      type="button"
                      onClick={async () => {
                        await triggerHaptic();
                        setIsReceiptStudioOpen(prev => !prev);
                      }}
                      className={`w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer border-2 bg-transparent hover:scale-105 ${
                        isReceiptStudioOpen 
                          ? 'border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[0_0_10px_rgba(223,85,4,0.2)]' 
                          : 'border-transparent text-green-500 hover:border-gray-500/30'
                      }`}
                      title="Toggle Local Linker Panel"
                    >
                      <span className="text-sm">＋</span>
                    </button>
                  </div>

                  {/* Claims Tally Badge Button */}
                  {(() => {
                    const claimCount = receipts.filter(r => r.cardId === selectedCardForEdit.id).length;
                    return (
                      <button
                        type="button"
                        onClick={async () => {
                          await triggerHaptic();
                          setIsReceiptStudioOpen(prev => !prev);
                        }}
                        className={`px-3 py-1.5 border rounded-lg font-black font-mono text-xs flex items-center gap-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.4)] transition-all active:translate-y-0.5 cursor-pointer ${
                          isReceiptStudioOpen
                            ? 'bg-[var(--color-accent,#DF5504)]/20 border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)] shadow-[0_0_10px_rgba(223,85,4,0.15)]'
                            : 'bg-[#DF5504]/10 border-[var(--color-accent,#DF5504)]/40 hover:border-[var(--color-accent,#DF5504)] text-[var(--color-accent,#DF5504)]'
                        }`}
                        title="Toggle Claims Linker"
                      >
                        <span className="text-[10px] uppercase font-bold tracking-wider opacity-85">Claims:</span>
                        <span>{claimCount}</span>
                      </button>
                    );
                  })()}
                </div>

                {isReceiptsLinkHelpOpen && (
                  <div className="mt-2.5 mb-2.5 p-3.5 bg-blue-950/70 border border-blue-800/50 text-blue-300 rounded flex flex-col gap-2.5 text-[10px] leading-relaxed animate-fadeIn text-left">
                    <div className="font-bold text-[10px] uppercase text-blue-400 border-b border-blue-900/30 pb-1 flex justify-between items-center font-mono w-full">
                      <span>🧾 Receipts Association Guide</span>
                      <button
                        type="button"
                        onClick={() => setIsReceiptsLinkHelpOpen(false)}
                        className="text-[9px] hover:text-white cursor-pointer uppercase font-black"
                      >
                        Hide ×
                      </button>
                    </div>
                    
                    <div className="flex flex-col gap-2 font-sans">
                      <p>
                        📸 <strong className="text-white font-mono">EXPENSE CAPTURE:</strong> Link captured business expense claims and snapped photos directly to this task to tally up total budgets.
                      </p>
                      <p>
                        🔗 <strong className="text-white font-mono">DATABASE ASSOCIATIONS:</strong> Link or detach expenses at any time; your mappings are saved securely in your local database.
                      </p>
                    </div>
                  </div>
                )}

                {isReceiptStudioOpen && (
                  <div className="flex flex-col gap-3 mt-1.5 pt-3 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40 animate-fadeIn text-left font-mono">
                    {/* Link dropdown */}
                    <div className="flex gap-2 items-center">
                      <select
                        id="card-receipt-link-select"
                        className="flex-grow bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] text-white hover:border-gray-500 focus:border-[var(--color-accent,#DF5504)] outline-none rounded p-1.5 text-[10px] font-bold cursor-pointer"
                      >
                        <option value="">-- Link an Existing Claim --</option>
                        {receipts.filter(r => r.cardId !== selectedCardForEdit.id).map(r => (
                          <option key={r.id} value={r.id}>
                            [{new Date(r.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}] {r.merchant} - ${r.amount.toFixed(2)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={async () => {
                          await triggerHaptic();
                          const selectEl = document.getElementById('card-receipt-link-select') as HTMLSelectElement;
                          const selectedReceiptId = selectEl?.value;
                          if (selectedReceiptId) {
                            const updated = receipts.map(r => r.id === selectedReceiptId ? { ...r, cardId: selectedCardForEdit.id } : r);
                            await saveReceipts(updated);
                            showToast("🔗 Linked receipt to this card!");
                            selectEl.value = "";
                          } else {
                            showToast("⚠️ Please select a receipt claim to link!");
                          }
                        }}
                        className="px-3 py-1.5 bg-[var(--color-accent,#DF5504)] hover:bg-[var(--color-accent,#DF5504)]/90 border border-black shadow-[2px_2px_0px_0px_#000] text-white font-mono text-[9px] font-bold uppercase rounded flex items-center justify-center cursor-pointer active:translate-y-0.5"
                      >
                        Link Claim
                      </button>
                    </div>

                    {/* Associated Receipts List */}
                    <div className="flex flex-col gap-2 mt-1">
                      {receipts.filter(r => r.cardId === selectedCardForEdit.id).length === 0 ? (
                        <div className="text-center py-4 bg-black/10 border border-dashed border-[var(--color-dark-tertiary,#3D3D3D)]/30 rounded">
                          <span className="text-[10px] text-gray-500 italic block">No receipts linked to this card.</span>
                        </div>
                      ) : (
                        receipts.filter(r => r.cardId === selectedCardForEdit.id).map(log => {
                          const dateStr = new Date(log.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                          return (
                            <div key={log.id} className="p-2 bg-black/20 rounded border border-[var(--color-dark-tertiary,#3D3D3D)]/40 flex items-center gap-3">
                              <div className="w-10 h-10 rounded overflow-hidden border border-[var(--color-dark-tertiary,#3D3D3D)]/30 bg-black flex-shrink-0">
                                <img src={log.imageUrl} alt="" className="w-full h-full object-cover" />
                              </div>
                              <div className="flex-grow min-w-0 flex flex-col gap-0.5">
                                <div className="flex justify-between items-center gap-1">
                                  <span className="font-bold text-white text-[10px] truncate">{log.merchant}</span>
                                  <span className="font-extrabold text-[var(--color-accent,#DF5504)] text-[10px]">${log.amount.toFixed(2)}</span>
                                </div>
                                <span className="text-[8px] text-gray-500 font-bold uppercase">📅 {dateStr}</span>
                              </div>
                              <button
                                type="button"
                                onClick={async () => {
                                  await triggerHaptic();
                                  const updated = receipts.map(r => r.id === log.id ? { ...r, cardId: undefined } : r);
                                  await saveReceipts(updated);
                                  showToast(`🗑️ Unlinked receipt from card`);
                                }}
                                className="px-2 py-1 bg-red-950/20 hover:bg-red-900/40 text-red-400 font-bold border border-red-900/30 rounded text-[8px] uppercase transition-colors"
                              >
                                Unlink
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

              </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3 justify-between mt-4 pt-3 border-t border-[var(--color-dark-tertiary,#3D3D3D)]">
              {/* Left Actions: Delete, Archive, and Share */}
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={async () => {
                    const deleted = await handleDeleteCard(selectedCardForEdit.id);
                    if (deleted) {
                      setSelectedCardForEdit(null);
                      setIsLabelManagerOpen(false);
                      setIsCardSessionLogExpanded(false);
                    }
                  }}
                  className="px-3 py-1.5 border-2 border-red-900 bg-red-950/40 hover:bg-red-900/60 text-red-300 font-bold text-xs uppercase rounded transition-colors cursor-pointer"
                  title="Permanently delete task card"
                >
                  🗑️ Delete
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const currentlyArchived = !!selectedCardForEdit.isArchived;
                    await handleArchiveCard(selectedCardForEdit.id, !currentlyArchived);
                    setSelectedCardForEdit(null);
                    setIsLabelManagerOpen(false);
                    setIsCardSessionLogExpanded(false);
                  }}
                  className="px-3 py-1.5 border-2 border-amber-900 bg-amber-950/20 hover:bg-amber-900/40 text-amber-300 font-bold text-xs uppercase rounded transition-colors cursor-pointer"
                >
                  {selectedCardForEdit.isArchived ? "📥 Restore" : "📦 Archive"}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    try {
                      // Compact the card object to keep the URL extremely short and clean
                      const compactCard = {
                        id: selectedCardForEdit.id,
                        title: selectedCardForEdit.title,
                        description: selectedCardForEdit.description || '',
                        checklists: selectedCardForEdit.checklists || [],
                        labelIds: selectedCardForEdit.labelIds || []
                      };
                      
                      // Base64 encode securely (supports UTF-8 emojis/characters perfectly)
                      const jsonStr = JSON.stringify(compactCard);
                      const base64Payload = window.btoa(unescape(encodeURIComponent(jsonStr)));
                      const shareUrl = `mtrax://import?card=${base64Payload}`;
                      
                      // Trigger native Share Sheet
                      const shareData = {
                        title: `Share Card: ${selectedCardForEdit.title}`,
                        text: `Import this task card directly into your MTRAx lite board:`,
                        url: shareUrl
                      };
                      
                      // If web client fallback, copy to clipboard
                      if (navigator.share) {
                        await navigator.share(shareData);
                      } else {
                        await navigator.clipboard.writeText(shareUrl);
                        showToast("📋 Copied custom import link to clipboard!");
                      }
                    } catch (err) {
                      console.error("Failed to share card deep link:", err);
                      showToast("⚠️ Failed to generate card share link");
                    }
                  }}
                  className="px-3 py-1.5 border-2 border-indigo-900 bg-indigo-950/20 hover:bg-indigo-900/40 text-indigo-300 font-bold text-xs uppercase rounded transition-colors cursor-pointer"
                  title="Share card as custom link via Messages"
                >
                  📤 Share Link
                </button>
              </div>

              {/* Right Actions: Cancel & Save */}
              <div className="flex gap-2 justify-end">
                {isReadOnly ? (
                  <button 
                    onClick={async () => {
                      await triggerHaptic();
                      navigateWithCheck(() => {
                        setSelectedCardForEdit(null);
                        setIsLabelManagerOpen(false);
                        setIsCardSessionLogExpanded(false);
                      });
                    }}
                    className="px-5 py-2 bg-gray-600 hover:bg-gray-500 text-white font-bold text-xs uppercase rounded cursor-pointer transition-colors"
                  >
                    Close Viewer
                  </button>
                ) : (
                  <>
                    <button 
                      onClick={async () => {
                        await triggerHaptic();
                        navigateWithCheck(() => {
                          setSelectedCardForEdit(null);
                          setIsLabelManagerOpen(false);
                          setIsCardSessionLogExpanded(false);
                        });
                      }}
                      className="px-4 py-1.5 border border-[var(--color-dark-tertiary,#3D3D3D)] bg-[var(--color-dark-bg,#282828)] hover:bg-[var(--color-dark-tertiary)] text-white font-bold text-xs uppercase rounded cursor-pointer"
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
                        setIsCardSessionLogExpanded(false);
                      }}
                      className="px-4 py-1.5 bento-btn text-white hover:opacity-90 font-bold text-xs uppercase rounded cursor-pointer"
                    >
                      Save Changes
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ⚠️ UNSAVED CHANGES CONTROLLER OVERLAY MODAL */}
      {pendingNavigationAction && selectedCardForEdit && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[260] flex items-center justify-center p-4 animate-fadeIn">
          <div className="w-full max-w-sm bg-[#181818] border-2 border-[var(--color-accent,#DF5504)] p-5 rounded-lg shadow-[8px_8px_0px_0px_#000] font-mono text-xs flex flex-col gap-4 text-left">
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 pb-2.5">
              <span className="text-amber-500 font-black uppercase flex items-center gap-1.5 text-[11px] tracking-wider animate-pulse">
                ⚠️ UNSAVED CHANGES DETECTED
              </span>
            </div>

            {/* Warning Body */}
            <div className="text-gray-300 leading-relaxed text-[11px] flex flex-col gap-2">
              <span>You have modified <strong>"{selectedCardForEdit.title || 'this task card'}"</strong> but have not saved your changes yet.</span>
              <span className="text-gray-400 font-bold uppercase text-[9px]">Would you like to save or discard these modifications before switching screens?</span>
            </div>

            {/* Actions Footer */}
            <div className="flex flex-col gap-2 mt-2 pt-3 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40">
              {/* Option A: Save & Proceed */}
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  if (!selectedCardForEdit.title || !selectedCardForEdit.title.trim()) {
                    showToast("⚠️ Task title is required to save the card!");
                    return;
                  }
                  
                  // Save the current card state
                  const exists = cards.some(c => c.id === selectedCardForEdit.id);
                  const updatedCards = exists 
                    ? cards.map(c => c.id === selectedCardForEdit.id ? selectedCardForEdit : c)
                    : [...cards, selectedCardForEdit];
                  await saveCards(updatedCards);
                  showToast("💾 Saved changes successfully!");
                  
                  // Reset modal states
                  setSelectedCardForEdit(null);
                  setIsLabelManagerOpen(false);
                  setIsCardHelpOpen(false);
                  setIsCardSessionLogExpanded(false);

                  // Execute the delayed navigation callback
                  const action = pendingNavigationAction;
                  setPendingNavigationAction(null);
                  action();
                }}
                className="w-full px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white font-black uppercase text-[10px] tracking-wider rounded transition-colors cursor-pointer text-center shadow-[2px_2px_0px_0px_#000] active:translate-y-0.5"
              >
                💾 Save Changes & Proceed
              </button>

              {/* Option B: Discard & Proceed */}
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  // Reset modal states without saving
                  setSelectedCardForEdit(null);
                  setIsLabelManagerOpen(false);
                  setIsCardHelpOpen(false);
                  setIsCardSessionLogExpanded(false);

                  // Execute the delayed navigation callback
                  const action = pendingNavigationAction;
                  setPendingNavigationAction(null);
                  action();
                }}
                className="w-full px-3 py-2 bg-red-950/40 hover:bg-red-900/60 text-red-400 border border-red-900/30 font-bold uppercase text-[10px] tracking-wider rounded transition-colors cursor-pointer text-center active:translate-y-0.5"
              >
                🗑️ Discard Changes
              </button>

              {/* Option C: Keep Editing (Cancel Navigation) */}
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  // Simply cancel navigation
                  setPendingNavigationAction(null);
                }}
                className="w-full py-1.5 bg-transparent hover:bg-white/5 border border-dashed border-[var(--color-dark-tertiary,#3D3D3D)] text-gray-400 font-mono text-[9px] uppercase rounded transition-colors cursor-pointer text-center"
              >
                ✕ Keep Editing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 📥 DEEP-LINK CARD IMPORT & VERSIONING OVERLAY MODAL */}
      {incomingSharedCard && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[300] flex items-center justify-center p-4 animate-fadeIn">
          <div className="w-full max-w-md bg-[#181818] border-2 border-amber-600/80 p-5 rounded-lg shadow-[8px_8px_0px_0px_#000] font-mono text-xs flex flex-col gap-4 text-left">
            
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b border-amber-600/40 pb-2.5">
              <span className="text-amber-500 font-black uppercase flex items-center gap-1.5 text-[11px] tracking-wider animate-pulse">
                ⚠️ MANDATORY PRIVACY DISCLAIMER
              </span>
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIncomingSharedCard(null);
                  setIsShareAcknowledgementChecked(false);
                }}
                className="text-gray-400 hover:text-white transition-colors border-none bg-transparent cursor-pointer font-bold text-xs"
              >
                ✕
              </button>
            </div>

            {/* Alert/Warning Body */}
            <div className="flex flex-col gap-3 text-gray-300 leading-relaxed text-[11px]">
              <div className="p-2.5 bg-amber-950/20 border border-amber-800/40 rounded flex flex-col gap-1.5 text-amber-300">
                <span className="font-extrabold uppercase tracking-wide text-xs">🔒 PRIVATE-BY-DESIGN OFFLINE MODE</span>
                <span>MTRAx lite has <strong>NO server</strong> infrastructure. We do not track, capture, store, or intercept your data. Any card you share or receive is processed locally on-device.</span>
              </div>

              <div className="p-2.5 bg-indigo-950/20 border border-indigo-800/40 rounded flex flex-col gap-1.5 text-indigo-300">
                <span className="font-extrabold uppercase tracking-wide text-xs">📝 STATIC SNAPSHOT, NOT A LIVE SHARE</span>
                <span>This is a <strong>one-time static clone</strong> of the card at the exact moment it was sent. Your edits will <strong>not</strong> affect the sender, and future changes they make will not sync to your device.</span>
              </div>

              {/* Version Control Logic */}
              {(() => {
                const existingCard = cards.find(c => c.id === incomingSharedCard.id);
                if (existingCard) {
                  return (
                    <div className="p-3 bg-red-950/30 border border-red-800/50 rounded flex flex-col gap-2 text-red-300">
                      <span className="font-extrabold uppercase tracking-wide text-xs">🔄 CARD VERSION DETECTED</span>
                      <span>You already have a version of <strong>"{existingCard.title}"</strong> on your board (currently in column: <em>{lists.find(l => l.id === existingCard.listId)?.name || 'Unassigned'}</em>).</span>
                      <span className="text-gray-400 text-[10px]">Tapping <strong>"Overwrite / Update"</strong> will safely replace your local copy with the incoming one, preserving its current board list column position.</span>
                    </div>
                  );
                } else {
                  return (
                    <div className="p-3 bg-green-950/20 border border-green-800/40 rounded flex flex-col gap-1.5 text-green-300">
                      <span className="font-extrabold uppercase tracking-wide text-xs">🆕 NEW CARD IMPORT DETECTED</span>
                      <span>Card title: <strong>"{incomingSharedCard.title}"</strong> will be added as a brand new task under your <strong>"{lists[0]?.name || 'To Do'}"</strong> column list.</span>
                    </div>
                  );
                }
              })()}

              {/* Mandatory Checklist Acknowledge */}
              <label className="flex items-start gap-2.5 mt-2 p-2 bg-black/30 border border-[var(--color-dark-tertiary,#3D3D3D)]/40 rounded cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isShareAcknowledgementChecked}
                  onChange={(e) => setIsShareAcknowledgementChecked(e.target.checked)}
                  className="mt-0.5 rounded border-[var(--color-dark-tertiary,#3D3D3D)] text-[var(--color-accent,#DF5504)] focus:ring-[var(--color-accent,#DF5504)] cursor-pointer"
                />
                <span className="text-gray-400 font-bold text-[10px] uppercase leading-snug">
                  I acknowledge this is an offline snapshot, not a live sync, and that MTRAx lite does not host or sync my data.
                </span>
              </label>
            </div>

            {/* Modal Actions */}
            <div className="flex flex-col gap-2 mt-2 pt-3 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40">
              {(() => {
                const existingCard = cards.find(c => c.id === incomingSharedCard.id);
                if (existingCard) {
                  return (
                    <div className="flex gap-2 w-full justify-between">
                      <button
                        type="button"
                        disabled={!isShareAcknowledgementChecked}
                        onClick={async () => {
                          await triggerHaptic();
                          // Overwrite existing card, preserving current listId
                          const updatedCards = cards.map(c => 
                            c.id === incomingSharedCard.id 
                              ? { ...incomingSharedCard, listId: c.listId } // Keep current local column
                              : c
                          );
                          await saveCards(updatedCards);
                          showToast("🔄 Successfully updated existing card!");
                          setIncomingSharedCard(null);
                          setIsShareAcknowledgementChecked(false);
                        }}
                        className={`flex-grow px-3 py-2 border-2 border-red-900 bg-red-950/40 text-red-300 font-black uppercase text-[10px] tracking-wider rounded transition-opacity cursor-pointer ${!isShareAcknowledgementChecked ? 'opacity-30 cursor-not-allowed' : 'hover:bg-red-900/60 active:translate-y-0.5'}`}
                      >
                        🔄 Overwrite / Update
                      </button>
                      <button
                        type="button"
                        disabled={!isShareAcknowledgementChecked}
                        onClick={async () => {
                          await triggerHaptic();
                          // Duplicate with a brand new random UUID
                          const duplicateCard = {
                            ...incomingSharedCard,
                            id: `card_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                            listId: lists[0]?.id || 'todo'
                          };
                          await saveCards([...cards, duplicateCard]);
                          showToast("👯 Imported as separate duplicate card!");
                          setIncomingSharedCard(null);
                          setIsShareAcknowledgementChecked(false);
                        }}
                        className={`flex-grow px-3 py-2 border-2 border-indigo-900 bg-indigo-950/20 text-indigo-300 font-black uppercase text-[10px] tracking-wider rounded transition-opacity cursor-pointer ${!isShareAcknowledgementChecked ? 'opacity-30 cursor-not-allowed' : 'hover:bg-indigo-900/40 active:translate-y-0.5'}`}
                      >
                        👯 Import as Duplicate
                      </button>
                    </div>
                  );
                } else {
                  return (
                    <button
                      type="button"
                      disabled={!isShareAcknowledgementChecked}
                      onClick={async () => {
                        await triggerHaptic();
                        // Import new card, place in first list column
                        const newCard = {
                          ...incomingSharedCard,
                          listId: lists[0]?.id || 'todo'
                        };
                        await saveCards([...cards, newCard]);
                        showToast("📥 Successfully imported new task card!");
                        setIncomingSharedCard(null);
                        setIsShareAcknowledgementChecked(false);
                      }}
                      className={`w-full px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-black uppercase text-xs tracking-wider rounded transition-opacity cursor-pointer flex justify-center items-center gap-1.5 shadow-[4px_4px_0px_0px_#000] active:translate-y-0.5 ${!isShareAcknowledgementChecked ? 'opacity-30 cursor-not-allowed' : ''}`}
                    >
                      📥 Acknowledge & Import Card
                    </button>
                  );
                }
              })()}
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIncomingSharedCard(null);
                  setIsShareAcknowledgementChecked(false);
                }}
                className="w-full py-1.5 bg-transparent hover:bg-white/5 border border-dashed border-[var(--color-dark-tertiary,#3D3D3D)] text-gray-400 font-mono text-[10px] uppercase rounded transition-colors cursor-pointer text-center"
              >
                Cancel / Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 📋 ROOMY SLEEK CHECKLIST OVERLAY MODAL */}
      {isChecklistModalOpen && selectedCardForEdit && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[220] flex items-center justify-center p-4 animate-fadeIn">
          <div className="w-full max-w-md bg-[#181818] border-2 border-[var(--color-accent,#DF5504)] p-5 rounded-lg shadow-[8px_8px_0px_0px_#000] font-mono text-xs flex flex-col gap-4 text-left">
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 pb-2.5">
              <span className="text-white font-black uppercase flex items-center gap-1.5 text-[11px] tracking-wider">
                📋 Sub-Task Checklist
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsChecklistModalOpen(false);
                  setFocusedChecklistItemId(null);
                }}
                className="text-gray-400 hover:text-white font-black text-sm cursor-pointer select-none"
              >
                ✕
              </button>
            </div>

            {/* Sleek Add Task Input Bar at the top */}
            <div className="flex items-center gap-2 bg-black/35 border border-dashed border-[var(--color-dark-tertiary,#3D3D3D)]/40 p-2 rounded focus-within:border-[var(--color-accent,#DF5504)] focus-within:bg-black/50 transition-all">
              <span className="text-[14px] font-black text-[var(--color-accent,#DF5504)] select-none pl-1">＋</span>
              <input 
                type="text"
                placeholder="Add new sub-task... (Press Enter)"
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    const input = e.target as HTMLInputElement;
                    const text = input.value.trim();
                    if (!text) return;
                    await triggerHaptic();

                    const checklistId = selectedCardForEdit.checklists?.[0]?.id || `cl-${Date.now()}`;
                    const newItem = {
                      id: `item-${Date.now()}`,
                      text,
                      isChecked: false,
                      dueDate: null
                    };

                    const updatedChecklists = selectedCardForEdit.checklists?.map((cl, idx) => {
                      if (idx === 0) {
                        return {
                          ...cl,
                          items: [...(cl.items || []), newItem]
                        };
                      }
                      return cl;
                    }) || [{
                      id: checklistId,
                      title: "Default",
                      items: [newItem]
                    }];

                    setSelectedCardForEdit({
                      ...selectedCardForEdit,
                      checklists: updatedChecklists
                    });
                    input.value = '';
                  }
                }}
                className="flex-grow bg-transparent border-none p-0 text-[11px] text-white placeholder-gray-500 focus:ring-0 focus:outline-none font-mono"
              />
            </div>

            {/* Roomy scrollable Checklist items list */}
            <div className="flex flex-col gap-2 max-h-[350px] overflow-y-auto pr-1">
              {(() => {
                const items = selectedCardForEdit.checklists?.[0]?.items || [];
                if (items.length === 0) {
                  return (
                    <div className="text-center py-8 bg-black/15 border border-dashed border-[var(--color-dark-tertiary,#3D3D3D)]/30 rounded text-gray-500 italic">
                      No sub-tasks. Type above to add your first task!
                    </div>
                  );
                }

                // Sort checklist items so active ones come first
                const sortedItems = [...items].sort((a, b) => (a.isChecked ? 1 : 0) - (b.isChecked ? 1 : 0));

                return sortedItems.map(item => {
                  const isFocused = focusedChecklistItemId === item.id;
                  return (
                    <div 
                      key={item.id}
                      onClick={async () => {
                        await triggerHaptic();
                        setFocusedChecklistItemId(isFocused ? null : item.id);
                      }}
                      className={`flex justify-between items-center gap-2 border p-2.5 rounded font-mono text-[11px] transition-all cursor-pointer ${
                        isFocused 
                          ? 'border-[var(--color-accent,#DF5504)] bg-black/60 shadow-[0_0_8px_rgba(223,85,4,0.3)]' 
                          : 'border-[var(--color-dark-tertiary,#3D3D3D)]/40 bg-black/25 hover:bg-black/40'
                      }`}
                    >
                      {/* Checkbox and Text */}
                      <div className="flex items-center gap-2.5 flex-grow select-none overflow-hidden">
                        <input 
                          type="checkbox"
                          checked={item.isChecked}
                          onClick={(e) => e.stopPropagation()}
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
                          className="rounded border-[var(--color-dark-tertiary,#3D3D3D)] text-[var(--color-accent,#DF5504)] focus:ring-[var(--color-accent,#DF5504)] bg-black/40 w-4 h-4 cursor-pointer flex-shrink-0"
                        />
                        <span className={`text-white transition-all text-[11px] ${
                          isFocused 
                            ? 'whitespace-normal break-words overflow-visible' 
                            : 'truncate'
                        } ${item.isChecked ? 'line-through text-gray-500' : ''}`}>
                          {item.text}
                        </span>
                      </div>

                      {/* Actions: Edit / Notification / Delete */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {item.dueDate && (
                          <span className="text-[8px] text-[var(--color-accent,#DF5504)] font-bold px-1.5 py-0.5 bg-[#DF5504]/10 rounded border border-[#DF5504]/25 flex items-center gap-0.5">
                            ⏰ {new Date(item.dueDate).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        )}

                        {/* Bell Button (Assign alarm / notifications) */}
                        <button
                          type="button"
                          onClick={async () => {
                            await triggerHaptic();
                            setSubTaskModalItem(item);
                            setSubTaskModalText(item.text);
                            setSubTaskModalDueDate(item.dueDate || null);
                          }}
                          className="p-1 text-gray-400 hover:text-yellow-400 hover:bg-yellow-500/10 rounded transition-colors text-[10px] cursor-pointer"
                          title="Assign Date & Time Alarm"
                        >
                          🔔
                        </button>

                        {/* Pencil Edit Button (Edit task text name) */}
                        <button
                          type="button"
                          onClick={async () => {
                            await triggerHaptic();
                            setSubTaskModalItem(item);
                            setSubTaskModalText(item.text);
                            setSubTaskModalDueDate(item.dueDate || null);
                          }}
                          className="p-1 text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors text-[10px] cursor-pointer"
                          title="Edit Task Name"
                        >
                          ✏️
                        </button>

                        {/* Delete sub-task item */}
                        <button
                          type="button"
                          onClick={async () => {
                            await triggerHaptic();
                            if (confirm(`Delete sub-task "${item.text}"?`)) {
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
                            }
                          }}
                          className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors text-[10px] cursor-pointer"
                          title="Delete Subtask"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Close button at the bottom */}
            <button
              type="button"
              onClick={() => {
                setIsChecklistModalOpen(false);
                setFocusedChecklistItemId(null);
              }}
              className="w-full mt-2 py-2 bg-[var(--color-dark-tertiary,#3D3D3D)] hover:bg-[var(--color-dark-tertiary)]/80 text-white font-bold uppercase rounded text-[10px] tracking-wide cursor-pointer transition-colors"
            >
              Close Checklist
            </button>
          </div>
        </div>
      )}

      {/* 📝 ROOMY SUB-TASK POPUP EDITOR MODAL */}
      {subTaskModalItem && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[250] flex items-center justify-center p-4 animate-fadeIn">
          <div className="w-full max-w-sm bg-[#1E1E1E] border-2 border-[var(--color-accent,#DF5504)] p-5 rounded-lg shadow-[8px_8px_0px_0px_#000] font-mono text-xs flex flex-col gap-4 text-left animate-fadeIn">
            
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40 pb-2.5">
              <span className="text-white font-black uppercase flex items-center gap-1.5 text-[11px] tracking-wider">
                📝 Manage Sub-Task
              </span>
              <button
                type="button"
                onClick={() => setSubTaskModalItem(null)}
                className="text-gray-400 hover:text-white font-black text-xs cursor-pointer select-none"
              >
                ✕
              </button>
            </div>

            {/* Task Description Field */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wide">Task Name</label>
              <input 
                type="text"
                value={subTaskModalText}
                onChange={(e) => setSubTaskModalText(e.target.value)}
                placeholder="Enter sub-task description..."
                className="w-full bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded p-2 text-white font-mono text-xs focus:border-[var(--color-accent,#DF5504)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent,#DF5504)]"
              />
            </div>

            {/* Alarm/Reminder Section */}
            <div className="flex flex-col gap-2 bg-black/25 border border-[var(--color-dark-tertiary,#3D3D3D)]/50 p-3 rounded">
              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wide flex items-center gap-1">
                ⏰ Sub-Task Alarm
              </span>
              
              <div className="flex flex-col gap-1.5 mt-1">
                <input
                  type="datetime-local"
                  value={formatTimestampToDatetimeLocal(subTaskModalDueDate)}
                  onChange={(e) => {
                    const parsed = e.target.value ? Date.parse(e.target.value) : null;
                    setSubTaskModalDueDate(parsed);
                  }}
                  className="w-full bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded p-1.5 text-white font-mono text-[11px] focus:border-[var(--color-accent,#DF5504)] focus:outline-none"
                />
              </div>

              {/* Alarm Helper Presets for Premium UX */}
              <div className="flex flex-wrap gap-1 mt-1">
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    setSubTaskModalDueDate(Date.now() + 15 * 60 * 1000); // 15 mins
                  }}
                  className="px-2 py-1 bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-gray-400 rounded text-[9px] text-gray-300 font-bold cursor-pointer"
                >
                  +15m
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    setSubTaskModalDueDate(Date.now() + 60 * 60 * 1000); // 1 hr
                  }}
                  className="px-2 py-1 bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-gray-400 rounded text-[9px] text-gray-300 font-bold cursor-pointer"
                >
                  +1h
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    tomorrow.setHours(9, 0, 0, 0);
                    setSubTaskModalDueDate(tomorrow.getTime());
                  }}
                  className="px-2 py-1 bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-gray-400 rounded text-[9px] text-gray-300 font-bold cursor-pointer"
                >
                  Tomorrow (9 AM)
                </button>
              </div>

              {subTaskModalDueDate && (
                <div className="flex justify-between items-center text-[10px] text-[var(--color-accent,#DF5504)] font-bold mt-1 bg-[#DF5504]/5 p-1 rounded border border-[#DF5504]/20">
                  <span>⏰ Scheduled Alarm</span>
                  <button
                    type="button"
                    onClick={async () => {
                      await triggerHaptic();
                      setSubTaskModalDueDate(null);
                      showToast("🗑️ Sub-task alarm cleared!");
                    }}
                    className="text-red-500 hover:text-red-400 uppercase text-[9px] font-black cursor-pointer"
                  >
                    Clear ×
                  </button>
                </div>
              )}
            </div>

            {/* Modal Bottom Actions */}
            <div className="flex justify-between items-center gap-2 border-t border-[var(--color-dark-tertiary,#3D3D3D)] pt-3 mt-1">
              {/* Delete task button */}
              <button
                type="button"
                onClick={async () => {
                  if (!selectedCardForEdit) return;
                  await triggerHaptic();
                  if (subTaskModalItem.dueDate) {
                    await cancelChecklistItemAlarm(subTaskModalItem);
                  }
                  const updatedChecklists = selectedCardForEdit.checklists?.map((cl, idx) => {
                    if (idx === 0) {
                      return {
                        ...cl,
                        items: cl.items.filter(it => it.id !== subTaskModalItem.id)
                      };
                    }
                    return cl;
                  }) || [];
                  setSelectedCardForEdit({ ...selectedCardForEdit, checklists: updatedChecklists } as Card);
                  setSubTaskModalItem(null);
                  showToast("🗑️ Sub-task deleted successfully");
                }}
                className="px-2.5 py-1.5 border border-red-900 bg-red-950/20 hover:bg-red-900/40 text-red-400 font-bold uppercase rounded text-[10px] cursor-pointer"
                title="Delete this sub-task item"
              >
                🗑️ Delete
              </button>

              <div className="flex gap-1.5">
                {/* Cancel button */}
                <button
                  type="button"
                  onClick={() => setSubTaskModalItem(null)}
                  className="px-3 py-1.5 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:bg-white/5 text-white font-bold uppercase rounded text-[10px] cursor-pointer"
                >
                  Cancel
                </button>
                {/* Save Changes button */}
                <button
                  type="button"
                  onClick={async () => {
                    if (!selectedCardForEdit) return;
                    if (!subTaskModalText || !subTaskModalText.trim()) {
                      await triggerHaptic();
                      showToast("⚠️ Sub-task description cannot be empty!");
                      return;
                    }
                    await triggerHaptic();

                    // If alarm is defined, cancel previous and set up the new one!
                    const updatedItem = {
                      ...subTaskModalItem,
                      text: subTaskModalText.trim(),
                      dueDate: subTaskModalDueDate
                    };

                    // Handle LocalNotification scheduling/cancelling
                    if (subTaskModalDueDate) {
                      await scheduleChecklistItemAlarm(selectedCardForEdit.title || '', updatedItem);
                    } else if (subTaskModalItem.dueDate) {
                      await cancelChecklistItemAlarm(subTaskModalItem);
                    }

                    const updatedChecklists = selectedCardForEdit.checklists?.map((cl, idx) => {
                      if (idx === 0) {
                        return {
                          ...cl,
                          items: cl.items.map(it => it.id === subTaskModalItem.id ? updatedItem : it)
                        };
                      }
                      return cl;
                    }) || [];

                    setSelectedCardForEdit({ ...selectedCardForEdit, checklists: updatedChecklists } as Card);
                    setSubTaskModalItem(null);
                    showToast("💾 Sub-task changes saved!");
                  }}
                  className="px-3 py-1.5 bento-btn text-white font-bold uppercase rounded text-[10px] cursor-pointer"
                >
                  Save
                </button>
              </div>
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
              <div className="flex items-center gap-2">
                <span className="font-black text-sm text-[var(--color-accent,#DF5504)] uppercase tracking-wider">
                  📊 SESSION TIME LOGS
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    setIsLogHelpOpen(prev => !prev);
                  }}
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all cursor-pointer border ${
                    isLogHelpOpen 
                      ? 'bg-blue-900 border-blue-400 text-white shadow-[0_0_8px_rgba(59,130,246,0.5)]' 
                      : 'bg-black/40 border-gray-600 text-gray-400 hover:text-white hover:border-white'
                  }`}
                  title="Toggle Help Guide"
                >
                  ❓
                </button>
              </div>
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

            {/* Interactive Help Guide Section */}
            {isLogHelpOpen && (
              <div className="p-3.5 bg-blue-950/70 border border-blue-800/50 text-blue-300 rounded flex flex-col gap-2.5 text-[10px] leading-relaxed animate-fadeIn text-left">
                <div className="font-bold text-[10px] uppercase text-blue-400 border-b border-blue-900/30 pb-1 flex justify-between items-center font-mono">
                  <span>ℹ️ HOW LOGS WORK GUIDE</span>
                  <button 
                    type="button" 
                    onClick={async () => {
                      await triggerHaptic();
                      setIsLogHelpOpen(false);
                    }}
                    className="text-[9px] hover:text-white cursor-pointer uppercase font-black"
                  >
                    Hide ×
                  </button>
                </div>
                <div className="flex flex-col gap-2 font-sans">
                  <p>
                    ⏱️ <strong className="text-white font-mono">Active Focus Ranking:</strong> Displays your tasks ranked from most-focused to least-focused based on active stopwatch hours.
                  </p>
                  <p>
                    🗹 <strong className="text-white font-mono">Selectable Focus Recalculator:</strong> Check or uncheck tasks to instantly update your grand total study duration in real time.
                  </p>
                  <p>
                    📥 <strong className="text-white font-mono">Spreadsheet CSV Export:</strong> Creates and downloads an Excel-compatible spreadsheet file compiling only your checked tasks.
                  </p>
                  <p>
                    ✉️ <strong className="text-white font-mono">Email & Clipboard Backup:</strong> Automatically copies your full timesheet report to your device's clipboard and opens a pre-filled email draft to easily share your logs. If your mail app doesn't open, just paste (Cmd+V) anywhere!
                  </p>
                  <p>
                    🗑️ <strong className="text-white font-mono">Resetting Study Clocks:</strong> Tap any card's trash can icon to reset its logged focus timer back to zero.
                  </p>
                </div>
              </div>
            )}

            {/* Total Summary Analytics Banner */}
            {(() => {
              const activeCardsWithTime = cards.filter(c => (c.timeSpent || 0) > 0);
              const includedCards = activeCardsWithTime.filter(c => !uncheckedLogCardIds.includes(c.id));
              const totalSeconds = cards.reduce((sum, c) => {
                const isChecked = !uncheckedLogCardIds.includes(c.id);
                return isChecked ? sum + (c.timeSpent || 0) : sum;
              }, 0);
              const totalHours = Math.floor(totalSeconds / 3600);
              const totalMinutes = Math.floor((totalSeconds % 3600) / 60);
              const remainingSeconds = totalSeconds % 60;

              return (
                <div className="p-3 bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded flex flex-col gap-1 text-left animate-fadeIn">
                  <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">⏱️ TOTAL STUDY DURATION</div>
                  <div className="text-xl font-black text-[var(--color-accent,#DF5504)] flex items-baseline gap-1">
                    {totalHours}<span className="text-xs text-gray-400 font-normal uppercase">h</span>{' '}
                    {totalMinutes}<span className="text-xs text-gray-400 font-normal uppercase">m</span>{' '}
                    {remainingSeconds}<span className="text-xs text-gray-400 font-normal uppercase">s</span>
                  </div>
                  <div className="text-[9px] text-gray-400 uppercase mt-1">
                    Summing <strong className="text-white">{includedCards.length}</strong> of <strong className="text-gray-400">{activeCardsWithTime.length}</strong> active card focus targets
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
                      const isChecked = !uncheckedLogCardIds.includes(card.id);

                      return (
                        <div key={card.id} className="flex flex-col border border-[var(--color-dark-tertiary,#3D3D3D)] bg-[var(--color-dark-bg,#282828)]/30 rounded overflow-hidden">
                          {/* Main Row */}
                          <div 
                            className={`p-3 transition-all flex justify-between items-center text-left gap-4 ${
                              isChecked 
                                ? 'bg-[var(--color-dark-bg,#282828)]/50' 
                                : 'bg-black/10 opacity-60'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              {/* Styled custom checkbox */}
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={async () => {
                                  await triggerHaptic();
                                  setUncheckedLogCardIds(prev => 
                                    isChecked 
                                      ? [...prev, card.id] 
                                      : prev.filter(id => id !== card.id)
                                  );
                                }}
                                className="w-4 h-4 rounded border border-[var(--color-dark-tertiary,#3D3D3D)] text-[var(--color-accent,#DF5504)] bg-black/40 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-[var(--color-accent,#DF5504)] flex-shrink-0"
                              />
                              <div className="flex flex-col gap-1 min-w-0 flex-1">
                                <span className={`font-bold text-xs truncate uppercase tracking-wide transition-all ${
                                  isChecked ? 'text-white' : 'text-gray-500 line-through'
                                }`}>
                                  {card.title || 'Untitled Card Target'}
                                </span>
                                <span className={`text-[9px] font-bold uppercase transition-all ${
                                  isChecked ? 'text-[var(--color-accent,#DF5504)]' : 'text-gray-600'
                                }`}>
                                  List: {cardList ? cardList.name.toUpperCase() : 'UNKNOWN'}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <span className={`font-bold text-[11px] transition-all ${isChecked ? 'text-white' : 'text-gray-500'}`}>
                                {hrs}h {mins}m {secs}s
                              </span>
                              <button
                                type="button"
                                onClick={async () => {
                                  await triggerHaptic();
                                  if (confirm(`Reset session time and clear focus logs for "${card.title || 'this card'}"?`)) {
                                    const updated = cards.map(c => c.id === card.id ? { ...c, timeSpent: 0, studySessions: [] } : c);
                                    await saveCards(updated);
                                    showToast("🗑️ Log history cleared!");
                                  }
                                }}
                                className="w-6 h-6 rounded bg-black/40 hover:bg-red-950 hover:text-red-400 border border-[var(--color-dark-tertiary,#3D3D3D)] flex items-center justify-center text-[10px] transition-colors cursor-pointer animate-fadeIn"
                                title="Reset Card Time"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>

                          {/* Sessions Sub-List (Nested Collapsible Panel) */}
                          {card.studySessions && card.studySessions.length > 0 && (
                            <details className="group border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40 bg-black/15 font-mono text-[9px]">
                              <summary className="p-2 px-3 flex justify-between items-center cursor-pointer select-none text-gray-500 hover:text-white uppercase font-bold tracking-wider">
                                <span>📋 Individual Sessions ({card.studySessions.length})</span>
                                <span className="transition-transform group-open:rotate-180">▼</span>
                              </summary>
                              <div className="px-3 pb-2.5 flex flex-col gap-1.5 max-h-[120px] overflow-y-auto">
                                {[...card.studySessions].reverse().map(session => {
                                  const dateStr = new Date(session.timestamp).toLocaleString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  });
                                  const sHrs = Math.floor(session.duration / 3600);
                                  const sMins = Math.floor((session.duration % 3600) / 60);
                                  const sSecs = session.duration % 60;
                                  const sDurationStr = `${sHrs > 0 ? sHrs + 'h ' : ''}${sMins > 0 ? sMins + 'm ' : ''}${sSecs}s`;

                                  return (
                                    <div key={session.id} className="flex justify-between items-center bg-black/30 p-1.5 border border-[#222] rounded">
                                      <span className="text-gray-400 font-bold">{dateStr}</span>
                                      <span className="text-[var(--color-accent,#DF5504)] font-black uppercase font-mono text-[8px] sm:text-[9px]">Duration: {sDurationStr}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </details>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Bottom Actions Row */}
            <div className="flex justify-between items-center border-t border-[var(--color-dark-tertiary,#3D3D3D)] pt-4 mt-2 gap-2 flex-wrap sm:flex-nowrap">
              <div className="flex gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    const activeCardsWithTime = cards.filter(c => (c.timeSpent || 0) > 0);
                    const includedCards = activeCardsWithTime.filter(card => !uncheckedLogCardIds.includes(card.id));
                    if (includedCards.length === 0) {
                      showToast("⚠️ No checked study logs to export!");
                      return;
                    }
                    const csvRows = [
                      ["Card ID", "Card Title", "List Column", "Time Spent (Seconds)", "Formatted Duration", "Session Log Date", "Session Duration"]
                    ];
                    includedCards.forEach(card => {
                      const listObj = lists.find(l => l.id === card.listId);
                      const hrs = Math.floor((card.timeSpent || 0) / 3600);
                      const mins = Math.floor(((card.timeSpent || 0) % 3600) / 60);
                      const secs = (card.timeSpent || 0) % 60;
                      csvRows.push([
                        card.id,
                        card.title || 'Untitled',
                        listObj ? listObj.name : 'Unknown',
                        String(card.timeSpent || 0),
                        `${hrs}h ${mins}m ${secs}s`,
                        "TOTAL ACCUMULATED FOCUS TIME",
                        ""
                      ]);

                      if (card.studySessions && card.studySessions.length > 0) {
                        card.studySessions.forEach((session, sIdx) => {
                          const dateStr = new Date(session.timestamp).toLocaleString();
                          const sHrs = Math.floor(session.duration / 3600);
                          const sMins = Math.floor((session.duration % 3600) / 60);
                          const sSecs = session.duration % 60;
                          const sDurationStr = `${sHrs > 0 ? sHrs + 'h ' : ''}${sMins > 0 ? sMins + 'm ' : ''}${sSecs}s`;
                          
                          csvRows.push([
                            "",
                            `  Session #${sIdx + 1}`,
                            "",
                            String(session.duration),
                            "",
                            dateStr,
                            sDurationStr
                          ]);
                        });
                      }
                    });
                    const csvContent = csvRows.map(row => row.map(val => `"${val.replace(/"/g, '""')}"`).join(",")).join("\n");
                    const filename = `mtrax_focus_session_logs_${Date.now()}.csv`;

                    try {
                      const file = new File([csvContent], filename, { type: 'text/csv' });
                      if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        await navigator.share({
                          files: [file],
                          title: 'Focus Session Logs Export',
                          text: 'Here is your exported focus session logs CSV from MTRAx lite.'
                        });
                        showToast("📤 Share sheet opened successfully!");
                        return;
                      }
                    } catch (e) {
                      console.warn("Web Share API files sharing not supported/failed:", e);
                    }

                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.setAttribute("href", url);
                    link.setAttribute("download", filename);
                    link.click();
                    showToast("📥 CSV Export downloaded successfully!");
                  }}
                  className={`px-2.5 py-1.5 border border-[var(--color-dark-tertiary,#3D3D3D)] bg-black/40 hover:bg-black/80 hover:border-white text-white font-bold uppercase text-[9px] sm:text-[10px] rounded transition-all cursor-pointer ${
                    cards.some(c => (c.timeSpent || 0) > 0) ? 'opacity-100' : 'opacity-40 cursor-not-allowed'
                  }`}
                  title="Export Logs as CSV file"
                >
                  📥 Export CSV
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    const activeCardsWithTime = cards.filter(c => (c.timeSpent || 0) > 0);
                    const includedCards = activeCardsWithTime.filter(card => !uncheckedLogCardIds.includes(card.id));
                    if (includedCards.length === 0) {
                      showToast("⚠️ No checked study logs to share!");
                      return;
                    }
                    let emailBody = "MTRAX LITE - STUDY FOCUS SESSIONS SUMMARY\n";
                    emailBody += "=========================================\n\n";
                    const totalSeconds = includedCards.reduce((sum, c) => sum + (c.timeSpent || 0), 0);
                    const totalHours = Math.floor(totalSeconds / 3600);
                    const totalMinutes = Math.floor((totalSeconds % 3600) / 60);
                    const remainingSeconds = totalSeconds % 60;
                    emailBody += `Total Active Study Duration: ${totalHours}h ${totalMinutes}m ${remainingSeconds}s\n`;
                    emailBody += `Summed across ${includedCards.length} active target focus sessions.\n\n`;
                    emailBody += "SESSIONS LIST:\n";
                    emailBody += "-------------\n";
                    
                    includedCards.forEach((card, idx) => {
                      const listObj = lists.find(l => l.id === card.listId);
                      const hrs = Math.floor((card.timeSpent || 0) / 3600);
                      const mins = Math.floor(((card.timeSpent || 0) % 3600) / 60);
                      const secs = (card.timeSpent || 0) % 60;
                      emailBody += `${idx + 1}. ${card.title || 'Untitled'} (${listObj ? listObj.name.toUpperCase() : 'UNKNOWN'}) - ${hrs}h ${mins}m ${secs}s\n`;
                      
                      if (card.studySessions && card.studySessions.length > 0) {
                        card.studySessions.forEach((session, sIdx) => {
                          const dateStr = new Date(session.timestamp).toLocaleString();
                          const sHrs = Math.floor(session.duration / 3600);
                          const sMins = Math.floor((session.duration % 3600) / 60);
                          const sSecs = session.duration % 60;
                          const sDurationStr = `${sHrs > 0 ? sHrs + 'h ' : ''}${sMins > 0 ? sMins + 'm ' : ''}${sSecs}s`;
                          emailBody += `   ├─ Session #${sIdx + 1}: ${dateStr} for ${sDurationStr}\n`;
                        });
                      }
                    });
                    
                    emailBody += "\n\nGenerated via MTRAx lite Board on " + new Date().toLocaleString() + "\n";
                    
                    const mailtoUrl = `mailto:?subject=${encodeURIComponent("MTRAx lite - Study Focus Session Logs")}&body=${encodeURIComponent(emailBody)}`;
                    
                    // Copy to clipboard as a powerful cross-platform backup!
                    let copied = false;
                    try {
                      await navigator.clipboard.writeText(emailBody);
                      copied = true;
                    } catch (e) {}

                    try {
                      const mailLink = document.createElement("a");
                      mailLink.href = mailtoUrl;
                      mailLink.target = "_self";
                      document.body.appendChild(mailLink);
                      mailLink.click();
                      document.body.removeChild(mailLink);
                    } catch (err) {
                      window.open(mailtoUrl, '_self');
                    }

                    if (copied) {
                      showToast("📋 Copied to clipboard & Mail app triggered!");
                    } else {
                      showToast("✉️ Email summary drafted!");
                    }
                  }}
                  className={`px-2.5 py-1.5 border border-[var(--color-dark-tertiary,#3D3D3D)] bg-black/40 hover:bg-black/80 hover:border-white text-white font-bold uppercase text-[9px] sm:text-[10px] rounded transition-all cursor-pointer ${
                    cards.some(c => (c.timeSpent || 0) > 0) ? 'opacity-100' : 'opacity-40 cursor-not-allowed'
                  }`}
                  title="Share Logs via Email"
                >
                  ✉️ Email Summary
                </button>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIsSessionLogOpen(false);
                }}
                className="px-4 py-1.5 bento-btn text-white font-bold uppercase text-[9px] sm:text-[10px] rounded cursor-pointer flex-shrink-0"
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
              <div className="mt-1 p-3.5 bg-blue-950/70 border border-blue-800/50 text-blue-300 rounded flex flex-col gap-2.5 text-[10px] leading-relaxed animate-fadeIn text-left">
                <div className="font-bold text-[10px] uppercase text-blue-400 border-b border-blue-900/30 pb-1 flex justify-between items-center font-mono w-full">
                  <span>🔔 Alert Studio Runbook</span>
                  <button
                    type="button"
                    onClick={() => setIsAlertStudioHelpOpen(false)}
                    className="text-[9px] hover:text-white cursor-pointer uppercase font-black"
                  >
                    Hide ×
                  </button>
                </div>
                
                <div className="flex flex-col gap-2 font-sans">
                  <p>
                    ⏰ <strong className="text-white font-mono">DUE DATE:</strong> Set the main target deadline for the card, which is required before scheduling alerts.
                  </p>
                  <p>
                    📱 <strong className="text-white font-mono">ON-SCREEN BANNER:</strong> Displays a helpful alert banner inside the app in real time while you are actively working.
                  </p>
                  <p>
                    🔔 <strong className="text-white font-mono">SYSTEM LOCK-SCREEN:</strong> Sends an alarm to your phone's main lock screen, which will pop up even if the app is closed.
                  </p>
                  <p>
                    📅 <strong className="text-white font-mono">CALENDAR SYNC:</strong> Automatically adds this task as an event in your phone or computer's native Calendar app.
                  </p>
                  <p>
                    📧 <strong className="text-white font-mono">EMAIL COMPOSER:</strong> Automatically opens your default email client with a pre-formatted message detailing the task.
                  </p>
                </div>
              </div>
            )}

            <div className="text-gray-400 text-[10px] leading-relaxed uppercase tracking-wider">
              Configure and test multi-channel reminders for: <span className="text-white font-bold">"{selectedCardForEdit.title}"</span>
            </div>

            {/* Primary Date Configuration */}
            <div className="p-3.5 bg-black/30 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded flex flex-col gap-2 text-left">
              <label className="block text-[10px] font-mono font-bold uppercase text-gray-400 tracking-wider">
                ⏰ Deadline & Time
              </label>
              <div className="flex gap-2 w-full">
                <input 
                  type="datetime-local"
                  id="main-card-due-date-input"
                  value={formatTimestampToDatetimeLocal(selectedCardForEdit.dueDate)}
                  onChange={(e) => {
                    const parsed = e.target.value ? Date.parse(e.target.value) : null;
                    setSelectedCardForEdit({ ...selectedCardForEdit, dueDate: parsed });
                  }}
                  className="flex-grow bg-[var(--color-dark-bg,#282828)] border border-[var(--color-dark-tertiary,#3D3D3D)] p-2 text-xs font-mono text-white rounded focus:border-[var(--color-accent,#DF5504)] transition-colors min-w-0"
                />
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    const el = document.getElementById('main-card-due-date-input');
                    if (el) (el as HTMLInputElement).blur();
                  }}
                  className="px-3 bg-black hover:bg-black/80 border border-[var(--color-dark-tertiary,#3D3D3D)] text-white hover:text-white font-black uppercase rounded text-[9px] transition-colors cursor-pointer flex-shrink-0"
                  title="Close Calendar Popup"
                >
                  Dismiss
                </button>
              </div>

              {/* Quick Preset Bento Buttons */}
              <div className="grid grid-cols-4 gap-2 mt-1">
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    const now = new Date();
                    setSelectedCardForEdit({ ...selectedCardForEdit, dueDate: now.getTime() });
                    showToast("📅 Deadline set to Today!");
                  }}
                  className="py-1.5 bg-black/40 hover:bg-[var(--color-accent,#DF5504)] text-white font-bold uppercase rounded text-[8px] border border-[var(--color-dark-tertiary,#3D3D3D)] transition-colors cursor-pointer text-center"
                >
                  📅 Today
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    setSelectedCardForEdit({ ...selectedCardForEdit, dueDate: tomorrow.getTime() });
                    showToast("📅 Deadline set to Tomorrow!");
                  }}
                  className="py-1.5 bg-black/40 hover:bg-[var(--color-accent,#DF5504)] text-white font-bold uppercase rounded text-[8px] border border-[var(--color-dark-tertiary,#3D3D3D)] transition-colors cursor-pointer text-center"
                >
                  🌅 Tomorrow
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    const plusHour = new Date(Date.now() + 60 * 60 * 1000);
                    setSelectedCardForEdit({ ...selectedCardForEdit, dueDate: plusHour.getTime() });
                    showToast("⚡ Deadline set to +1 Hour!");
                  }}
                  className="py-1.5 bg-black/40 hover:bg-[var(--color-accent,#DF5504)] text-white font-bold uppercase rounded text-[8px] border border-[var(--color-dark-tertiary,#3D3D3D)] transition-colors cursor-pointer text-center"
                >
                  ⚡ +1 Hour
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    setSelectedCardForEdit({ ...selectedCardForEdit, dueDate: null });
                    showToast("🗑️ Deadline cleared!");
                  }}
                  className="py-1.5 bg-red-950/20 hover:bg-red-900/60 text-red-400 font-bold uppercase rounded text-[8px] border border-red-900/30 transition-colors cursor-pointer text-center"
                >
                  🗑️ Clear
                </button>
              </div>

              <span className="text-[7.5px] text-gray-500 font-bold uppercase tracking-wide mt-1 block">
                💡 Browser popups require clicking outside to dismiss. Use bento presets above to set and close instantly!
              </span>

              {!selectedCardForEdit.dueDate && (
                <span className="text-[8px] text-[var(--color-accent,#DF5504)] font-bold uppercase tracking-wider mt-0.5">
                  ⚠️ Configure a Deadline above to enable automated alarm schedules.
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
                href={`mailto:?subject=MTRAx%20Task%3A%20${encodeURIComponent(selectedCardForEdit.title)}&body=Task%20Details%3A%0A%0A-%20Title%3A%20${encodeURIComponent(selectedCardForEdit.title)}%0A-%20Description%3A%20${encodeURIComponent(selectedCardForEdit.description || 'No description provided')}%0A-%20Due%20Date%3A%20${selectedCardForEdit.dueDate ? encodeURIComponent(new Date(selectedCardForEdit.dueDate).toLocaleString()) : 'Not set'}%0A%0AStay%20Focused!`}
                onClick={async () => {
                  await triggerHaptic();
                  showToast("📧 Opening native mail app...");
                }}
                className="text-center bento-btn bg-[var(--color-accent,#DF5504)] text-white hover:opacity-90 px-3 py-2.5 font-bold uppercase flex items-center justify-center gap-1.5 block"
              >
                <span>📧</span> Send Email Reminder
              </a>
            </div>

            {/* 🗓️ Card Alarms Agenda Timeline (Calendar List) */}
            <div className="p-3 bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] rounded flex flex-col gap-2.5 text-left mt-1.5">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-500 flex justify-between items-center w-full">
                <span>🗓️ Card Alarms Agenda Timeline</span>
                <span className="text-gray-500 text-[8px]">Chronological</span>
              </span>

              {(() => {
                // Gather all alarm entries
                const agendaItems: Array<{
                  type: 'primary' | 'subtask';
                  title: string;
                  dueDate: number;
                  originalItem?: ChecklistItem;
                }> = [];

                if (selectedCardForEdit.dueDate) {
                  agendaItems.push({
                    type: 'primary',
                    title: '🚨 Main Card Deadline alert',
                    dueDate: selectedCardForEdit.dueDate
                  });
                }

                selectedCardForEdit.checklists?.[0]?.items?.forEach(it => {
                  if (it.dueDate) {
                    agendaItems.push({
                      type: 'subtask',
                      title: `⏰ Sub-task: "${it.text}"`,
                      dueDate: it.dueDate,
                      originalItem: it
                    });
                  }
                });

                // Sort chronologically by due date
                agendaItems.sort((a, b) => a.dueDate - b.dueDate);

                if (agendaItems.length === 0) {
                  return (
                    <div className="py-4 text-center text-gray-500 text-[9px] font-mono border border-dashed border-[var(--color-dark-tertiary,#3D3D3D)]/40 rounded bg-black/20">
                      🔕 No alarms currently scheduled.
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-0.5 no-scrollbar">
                    {agendaItems.map((item, index) => {
                      const dateObj = new Date(item.dueDate);
                      const isExpired = item.dueDate < Date.now();
                      return (
                        <div 
                          key={index}
                          className={`p-2 bg-[#1A1A1A] border rounded flex justify-between items-center gap-1.5 transition-colors ${
                            isExpired 
                              ? 'border-gray-800 opacity-60' 
                              : item.type === 'primary' 
                                ? 'border-red-900/40 hover:border-red-900/80 bg-red-950/5' 
                                : 'border-amber-900/40 hover:border-amber-900/80 bg-amber-950/5'
                          }`}
                        >
                          {/* Left contents */}
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="text-[10px] text-white font-bold truncate tracking-tight">
                              {item.title}
                            </span>
                            <span className="text-[8px] font-mono text-gray-400">
                              🗓️ {dateObj.toLocaleDateString()} at {dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              {isExpired && <span className="text-red-500 font-bold uppercase ml-1.5">[Expired]</span>}
                            </span>
                          </div>

                          {/* Action triggers */}
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {item.type === 'primary' ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  await triggerHaptic();
                                  // Clear main card due date
                                  setSelectedCardForEdit({ ...selectedCardForEdit, dueDate: null });
                                  showToast("🗑️ Main Card alert cleared!");
                                }}
                                className="w-5 h-5 rounded bg-black hover:bg-red-950 hover:text-red-400 border border-gray-800 hover:border-red-900/50 flex items-center justify-center font-bold text-[9px] transition-all cursor-pointer"
                                title="Clear Main Card Alarm"
                              >
                                🗑️
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await triggerHaptic();
                                    // Open subtask editor directly on top
                                    setSubTaskModalItem(item.originalItem!);
                                  }}
                                  className="px-1.5 py-0.5 rounded bg-black hover:bg-amber-950 hover:text-amber-400 border border-gray-800 hover:border-amber-900/50 text-[8px] font-bold uppercase transition-all cursor-pointer"
                                  title="Edit Sub-Task Alarm"
                                >
                                  ✏️ Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await triggerHaptic();
                                    // Cancel notification
                                    await cancelChecklistItemAlarm(item.originalItem!);
                                    // Clear due date
                                    const updatedItem = { ...item.originalItem!, dueDate: undefined };
                                    const updatedItems = selectedCardForEdit.checklists?.[0]?.items?.map(it => 
                                      it.id === item.originalItem!.id ? updatedItem : it
                                    ) || [];
                                    setSelectedCardForEdit({
                                      ...selectedCardForEdit,
                                      checklists: selectedCardForEdit.checklists?.map((cl, i) => 
                                        i === 0 ? { ...cl, items: updatedItems } : cl
                                      )
                                    });
                                    showToast("🗑️ Sub-task alarm cleared!");
                                  }}
                                  className="w-5 h-5 rounded bg-black hover:bg-red-950 hover:text-red-400 border border-gray-800 hover:border-red-900/50 flex items-center justify-center font-bold text-[9px] transition-all cursor-pointer"
                                  title="Clear Sub-Task Alarm"
                                >
                                  🗑️
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
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
              <div className="p-3.5 bg-blue-950/70 border border-blue-800/50 text-blue-300 rounded flex flex-col gap-2.5 text-[10px] leading-relaxed animate-fadeIn text-left w-full flex-shrink-0">
                <div className="font-bold text-[10px] uppercase text-blue-400 border-b border-blue-900/30 pb-1 flex justify-between items-center font-mono w-full">
                  <span>📅 Calendar Agenda Guide</span>
                  <button
                    type="button"
                    onClick={() => setShowCalendarHelp(false)}
                    className="text-[9px] hover:text-white cursor-pointer uppercase font-black"
                  >
                    Hide ×
                  </button>
                </div>
                
                <div className="flex flex-col gap-2 font-sans">
                  <p>
                    📅 <strong className="text-white font-mono">TIMELINE FILTER:</strong> View scheduled tasks filtered specifically for TODAY, or forecast your schedule across 7, 30, or 90 days.
                  </p>
                  <p>
                    📌 <strong className="text-white font-mono">PRIORITY TASKS:</strong> Toggle the high-priority filter checkbox to instantly isolate critical targets on your agenda.
                  </p>
                  <p>
                    📔 <strong className="text-white font-mono">SPOKEN DIARY TIME:</strong> Switch calendar tabs to map your time-stamped verbal diary notes chronologically.
                  </p>
                  <p>
                    🧾 <strong className="text-white font-mono">EXPENSE CLAIMS:</strong> Isolate expense claim receipts and photograph uploads by date of purchase.
                  </p>
                  <p>
                    📧 <strong className="text-white font-mono">SHARE REPORTS:</strong> Select multiple receipts and compile structured spreadsheets directly to your employer's email.
                  </p>
                </div>
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
                      setSelectedCalendarItemIds([]);
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
                      setCalendarFilterType('mtrax');
                      setSelectedCalendarItemIds([]);
                    }}
                    className={`px-2 py-1 rounded text-[9px] uppercase font-bold transition-all border ${
                      calendarFilterType === 'mtrax'
                        ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                        : 'bg-black/30 border-[var(--color-dark-tertiary,#3D3D3D)] text-gray-400 hover:text-white hover:border-gray-500'
                    }`}
                  >
                    MTRAx Only
                  </button>
                  <button
                    onClick={async () => {
                      await triggerHaptic();
                      setCalendarFilterType('diary');
                      setSelectedCalendarItemIds([]);
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
                      setSelectedCalendarItemIds([]);
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
                        id: l.id,
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
                        id: r.id,
                        title: `Claim filed for: ${r.merchant}`,
                        startDate: r.timestamp,
                        endDate: r.timestamp,
                        location: r.notes ? `Purpose: "${r.notes}"` : undefined,
                        amount: r.amount,
                        imageUrl: r.imageUrl,
                        isReceiptLog: true,
                        cardId: r.cardId
                      }));
                  } else {
                    filtered = calendarEvents.filter((evt) => {
                      if (calendarFilterType === 'mtrax') {
                        return evt.title && evt.title.includes('📌 [MTRAx lite]');
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
                      {/* Batch Actions Header Bar */}
                      {selectedCalendarItemIds.length > 0 && (
                        <div className="mb-2 p-2.5 bg-black/40 border border-[var(--color-accent,#DF5504)]/30 rounded flex flex-col gap-2 text-left animate-slideDown flex-shrink-0 font-mono">
                          <div className="flex justify-between items-center pb-1.5 border-b border-[var(--color-dark-tertiary,#3D3D3D)]/40">
                            <span className="text-[10px] text-[var(--color-accent,#DF5504)] font-black uppercase tracking-wider flex items-center gap-1.5">
                              <span>⚡</span> Batch Operations ({selectedCalendarItemIds.length} Selected)
                            </span>
                            <button
                              type="button"
                              onClick={() => setSelectedCalendarItemIds([])}
                              className="text-[8px] text-gray-400 hover:text-white uppercase font-black cursor-pointer bg-transparent border-0 outline-none"
                            >
                              Clear Select
                            </button>
                          </div>

                          {calendarFilterType === 'receipts' && (
                            <div className="flex flex-col gap-2">
                              {/* Action buttons */}
                              <div className="flex gap-2 flex-wrap items-center">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await triggerHaptic();
                                    if (!employerEmail) {
                                      showToast("⚠️ Please specify an Employer's Email first in settings or the Receipts form!");
                                      return;
                                    }
                                    const selectedReceipts = receipts.filter(r => selectedCalendarItemIds.includes(r.id));
                                    if (selectedReceipts.length === 0) return;

                                    let report = `MTRAX LITE EXPENSE RECLAIM REPORT\n========================================\n\n`;
                                    report += `BATCH CLAIM REPORT: ${selectedReceipts.length} SELECTED CLAIMS\n`;
                                    report += `TOTAL RECLAIMABLE AMOUNT: $${selectedReceipts.reduce((acc, r) => acc + r.amount, 0).toFixed(2)}\n\n`;
                                    report += `ITEMIZED BUSINESS CLAIMS LIST:\n`;
                                    report += `----------------------------------------\n`;

                                    selectedReceipts.forEach((claim, idx) => {
                                      const cTime = new Date(claim.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                                      const cDate = new Date(claim.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                                      report += `${idx + 1}. [${cDate} at ${cTime}] Claim Merchant: ${claim.merchant}\n`;
                                      report += `   Amount: $${claim.amount.toFixed(2)}\n`;
                                      if (claim.notes) report += `   Purpose: "${claim.notes}"\n`;
                                      const linkedCard = cards.find(c => c.id === claim.cardId);
                                      if (linkedCard) report += `   Assigned Card: ${linkedCard.title}\n`;
                                      report += `----------------------------------------\n`;
                                    });

                                    report += `\n\nCompiled on MTRAx lite. Secure, date-stamped digital receipts are on file.`;

                                    const subject = encodeURIComponent(`MTRAx Expense Claims: ${selectedReceipts.length} Selected Items`);
                                    const body = encodeURIComponent(report);
                                    window.open(`mailto:${employerEmail}?subject=${subject}&body=${body}`, '_self');
                                    showToast("📧 Opening Mail client with compiled claims...");
                                  }}
                                  className="px-2.5 py-1 text-[9px] uppercase font-black rounded bg-[var(--color-accent,#DF5504)] hover:bg-[var(--color-accent,#DF5504)]/90 border border-black shadow-[1.5px_1.5px_0px_0px_#000] text-white cursor-pointer active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_#000]"
                                >
                                  📧 Email Selected
                                </button>

                                <div className="flex items-center gap-1.5">
                                  <select
                                    onChange={async (e) => {
                                      const targetCardId = e.target.value || undefined;
                                      await triggerHaptic();
                                      const updatedReceipts = receipts.map(r => 
                                        selectedCalendarItemIds.includes(r.id) ? { ...r, cardId: targetCardId } : r
                                      );
                                      await saveReceipts(updatedReceipts);
                                      showToast(`🔗 Linked ${selectedCalendarItemIds.length} receipts to card!`);
                                      setSelectedCalendarItemIds([]);
                                      e.target.value = '';
                                    }}
                                    className="bg-black border border-gray-700 text-white text-[9px] font-bold rounded p-1 outline-none font-mono cursor-pointer"
                                  >
                                    <option value="">-- Assign Selected to Card --</option>
                                    {cards.map(c => (
                                      <option key={c.id} value={c.id}>{c.title}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            </div>
                          )}

                          {calendarFilterType === 'diary' && (
                            <div className="flex flex-col gap-2 text-left">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <select
                                  onChange={async (e) => {
                                    const targetCardId = e.target.value;
                                    if (!targetCardId) return;
                                    await triggerHaptic();

                                    const selectedLogs = voiceLogs.filter(l => selectedCalendarItemIds.includes(l.id));
                                    
                                    const updatedCards = cards.map(card => {
                                      if (card.id === targetCardId) {
                                        let desc = card.description || '';
                                        selectedLogs.forEach(log => {
                                          const timeStr = new Date(log.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                                          const annotation = `🎙️ [Voice Log - ${timeStr}] ${log.text}`;
                                          desc = desc ? `${desc}\n\n${annotation}` : annotation;
                                        });
                                        return { ...card, description: desc };
                                      }
                                      return card;
                                    });
                                    await saveCards(updatedCards);

                                    const updatedLogs = voiceLogs.map(l => 
                                      selectedCalendarItemIds.includes(l.id) ? { ...l, assignedCardId: targetCardId } : l
                                    );
                                    await saveVoiceLogs(updatedLogs);

                                    showToast(`📤 Dispatched ${selectedCalendarItemIds.length} notes to Card!`);
                                    setSelectedCalendarItemIds([]);
                                    e.target.value = '';
                                  }}
                                  className="bg-black border border-gray-700 text-white text-[9px] font-bold rounded p-1 outline-none font-mono cursor-pointer"
                                >
                                  <option value="">-- Assign Selected to Card --</option>
                                  {cards.map(c => (
                                    <option key={c.id} value={c.id}>{c.title}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {filtered.map((evt, idx) => {
                        const isTriageEvent = evt.title && evt.title.includes('📌 [MTRAx lite]');
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
                            {/* Event Timeline Date/Time with Select Checkbox */}
                            <div className="flex justify-between items-center mb-1.5 pb-1 border-b border-[var(--color-dark-tertiary,#3D3D3D)]/20">
                              <div className="flex items-center gap-2">
                                {(isReceiptLog || isDiaryLog) && (
                                  <input
                                    type="checkbox"
                                    checked={selectedCalendarItemIds.includes(evt.id)}
                                    onChange={async (e) => {
                                      await triggerHaptic();
                                      if (e.target.checked) {
                                        setSelectedCalendarItemIds(prev => [...prev, evt.id]);
                                      } else {
                                        setSelectedCalendarItemIds(prev => prev.filter(id => id !== evt.id));
                                      }
                                    }}
                                    className="w-3.5 h-3.5 accent-[var(--color-accent,#DF5504)] cursor-pointer rounded bg-black border border-gray-700"
                                  />
                                )}
                                <span className={`text-[9px] font-black uppercase tracking-wider flex items-center gap-1 ${
                                  isDiaryLog ? 'text-amber-500' : 'text-[var(--color-accent,#DF5504)]'
                                }`}>
                                  <span>{isDiaryLog ? '📔' : isReceiptLog ? '🧾' : '📅'}</span>
                                  {start ? start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'Date Unknown'}
                                </span>
                              </div>
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

                                {isReceiptLog && evt.cardId && (
                                  (() => {
                                    const linked = cards.find(c => c.id === evt.cardId);
                                    if (linked) {
                                      return (
                                        <div className="text-[9px] text-[var(--color-accent,#DF5504)] mt-1 flex items-center gap-1 font-bold font-mono">
                                          <span>📋</span>
                                          <span className="truncate">Assigned Card: {linked.title}</span>
                                        </div>
                                      );
                                    }
                                    return null;
                                  })()
                                )}

                                {isDiaryLog && evt.assignedCardId && (
                                  (() => {
                                    const linked = cards.find(c => c.id === evt.assignedCardId);
                                    if (linked) {
                                      return (
                                        <div className="text-[9px] text-amber-500 mt-1 flex items-center gap-1 font-bold font-mono">
                                          <span>📥</span>
                                          <span className="truncate">Sent to Card: {linked.title}</span>
                                        </div>
                                      );
                                    }
                                    return null;
                                  })()
                                )}
                              </div>
                            </div>

                            {/* Inline Actions (Fallback) for Receipts and Diary items */}
                            {(isReceiptLog || isDiaryLog) && (
                              <div className="mt-2.5 pt-2 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/20 flex flex-col gap-2">
                                <div className="flex gap-2 justify-end">
                                  {/* Quick Assign Card Button */}
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await triggerHaptic();
                                      setOpenAssignDropdownId(openAssignDropdownId === evt.id ? null : evt.id);
                                    }}
                                    className="px-2.5 py-1 text-[8px] sm:text-[9px] uppercase font-bold font-mono rounded bg-black/40 border border-gray-600 hover:border-white text-gray-300 transition-colors flex items-center gap-1 cursor-pointer"
                                  >
                                    <span>📋</span> Assign Card
                                  </button>

                                  {/* Individual Email Claim Button (Receipts only) */}
                                  {isReceiptLog && (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        await triggerHaptic();
                                        if (!employerEmail) {
                                        showToast("⚠️ Please specify an Employer's Email first in settings or the Receipts form!");
                                          return;
                                        }
                                        const cTime = start ? start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
                                        const cDate = start ? start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
                                        
                                        let report = `MTRAx lite EXPENSE RECLAIM REPORT\n========================================\n\n`;
                                        report += `INDIVIDUAL CLAIM DETAIL:\n`;
                                        report += `----------------------------------------\n`;
                                        if (cDate) report += `Date: ${cDate} (${cTime})\n`;
                                        report += `Merchant: ${evt.title.replace('Claim filed for: ', '')}\n`;
                                        report += `Amount: $${evt.amount !== undefined ? evt.amount.toFixed(2) : '0.00'}\n`;
                                        if (evt.location) report += `Purpose: "${evt.location}"\n`;
                                        
                                        const linkedCard = cards.find(c => c.id === evt.cardId);
                                        if (linkedCard) {
                                          report += `Assigned Kanban Card: ${linkedCard.title}\n`;
                                        }
                                        report += `----------------------------------------\n`;
                                        report += `\n\nCompiled on MTRAx lite. Secure, date-stamped digital receipt is on file.`;

                                        const subject = encodeURIComponent(`MTRAx Expense Claim: ${evt.title.replace('Claim filed for: ', '')} ($${evt.amount !== undefined ? evt.amount.toFixed(2) : '0.00'})`);
                                        const body = encodeURIComponent(report);
                                        window.open(`mailto:${employerEmail}?subject=${subject}&body=${body}`, '_self');
                                        showToast("📧 Opening Mail client for this claim...");
                                      }}
                                      className="px-2.5 py-1 text-[8px] sm:text-[9px] uppercase font-bold font-mono rounded bg-[var(--color-accent,#DF5504)] hover:bg-[var(--color-accent,#DF5504)]/90 border border-black shadow-[1.5px_1.5px_0px_0px_#000] text-white transition-colors flex items-center gap-1 cursor-pointer active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_#000]"
                                    >
                                      <span>📧</span> Email Employer
                                    </button>
                                  )}
                                </div>

                                {/* Inline Dropdown for selection of cards */}
                                {openAssignDropdownId === evt.id && (
                                  <div className="flex gap-2 items-center bg-black/30 p-1.5 rounded border border-[var(--color-dark-tertiary,#3D3D3D)]/40 animate-slideDown">
                                    <select
                                      value={(isReceiptLog ? evt.cardId : evt.assignedCardId) || ''}
                                      onChange={async (e) => {
                                        const updatedVal = e.target.value || undefined;
                                        await triggerHaptic();
                                        if (isReceiptLog) {
                                          const updatedReceipts = receipts.map(r => r.id === evt.id ? { ...r, cardId: updatedVal } : r);
                                          await saveReceipts(updatedReceipts);
                                          showToast(updatedVal ? "🔗 Receipt linked to card!" : "🗑️ Receipt unassigned!");
                                        } else {
                                          if (updatedVal) {
                                            await dispatchLogToCard(evt.id, updatedVal);
                                          } else {
                                            const updatedLogs = voiceLogs.map(l => l.id === evt.id ? { ...l, assignedCardId: undefined } : l);
                                            await saveVoiceLogs(updatedLogs);
                                            showToast("🗑️ Note unassigned!");
                                          }
                                        }
                                        setOpenAssignDropdownId(null);
                                      }}
                                      className="flex-grow bg-black border border-gray-700 text-white text-[9px] font-bold rounded p-1 outline-none font-mono cursor-pointer"
                                    >
                                      <option value="">-- No Linked Card --</option>
                                      {cards.map(c => (
                                        <option key={c.id} value={c.id}>{c.title}</option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      onClick={() => setOpenAssignDropdownId(null)}
                                      className="px-2 py-1 text-[8px] bg-gray-800 hover:bg-gray-700 text-white rounded font-bold"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                )}
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
                          let report = `MTRAX LITE EXPENSE RECLAIM REPORT\n========================================\n\n`;
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

                          report += `\n\nCompiled on MTRAx lite. Secure, date-stamped digital receipts are on file.`;

                          const subject = encodeURIComponent(`MTRAx Expense Claims: ${formattedDate}`);
                          const body = encodeURIComponent(report);
                          window.open(`mailto:${employerEmail}?subject=${subject}&body=${body}`, '_self');
                          showToast("📧 Compiling and opening Mail client...");

                          // Track metadata: Mark compiled receipt claims as emailed with timestamps
                          const emailedIds = filteredClaims.map(fc => fc.id);
                          const updatedReceipts = receipts.map(r => {
                            if (emailedIds.includes(r.id)) {
                              return {
                                ...r,
                                isEmailed: true,
                                emailedAt: Date.now(),
                                emailedTo: employerEmail || 'Specified Recipient'
                              };
                            }
                            return r;
                          });
                          await saveReceipts(updatedReceipts);
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
              <div className="p-3.5 bg-blue-950/70 border border-blue-800/50 text-blue-300 rounded flex flex-col gap-2.5 text-[10px] leading-relaxed animate-fadeIn text-left w-full flex-shrink-0">
                <div className="font-bold text-[10px] uppercase text-blue-400 border-b border-blue-900/30 pb-1 flex justify-between items-center font-mono w-full">
                  <span>🧾 Expense Claims Guide</span>
                  <button
                    type="button"
                    onClick={() => setShowReceiptsHelp(false)}
                    className="text-[9px] hover:text-white cursor-pointer uppercase font-black"
                  >
                    Hide ×
                  </button>
                </div>
                
                <div className="flex flex-col gap-2 font-sans">
                  <p>
                    📸 <strong className="text-white font-mono">SNAP PHOTOS:</strong> Click snap to activate your mobile camera and photograph expense receipts instantly.
                  </p>
                  <p>
                    💰 <strong className="text-white font-mono">RECORD CLAIMS:</strong> Log exact costs and merchant names to build a clear timesheet of company-reimbursable claims.
                  </p>
                  <p>
                    📅 <strong className="text-white font-mono">CALENDAR SCHEDULE:</strong> Mapped receipts automatically load by date in your agenda log for rapid lookup.
                  </p>
                  <p>
                    📧 <strong className="text-white font-mono">EMAIL EXPORTS:</strong> Compile multi-receipt lists into structured items ready to email directly to your supervisor.
                  </p>
                </div>
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
                    runReceiptOcrAndPopulate(base64Url, false, file.name);
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
                const cardSelect = document.getElementById('receipt-card-select') as HTMLSelectElement;

                const merchant = merchantInput?.value.trim() || '';
                const amount = parseFloat(amountInput?.value || '0');
                const notes = notesInput?.value.trim() || '';
                const imageUrl = photoSrcInput?.value || '';
                const cardId = cardSelect?.value || undefined;

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
                  notes: notes || undefined,
                  cardId
                };
                
                await saveReceipts([newReceipt, ...receipts]);
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
                          runReceiptOcrAndPopulate(image.path || image.webPath, isNative, image.path || "");
                        }
                      } catch (err: any) {
                        console.log("Capacitor camera failed or cancelled, trying hybrid file trigger", err);
                        const errMsg = err?.message || "";
                        if (errMsg.toLowerCase().includes("permission") || errMsg.toLowerCase().includes("denied")) {
                          showToast("⚠️ Camera permission denied! Please enable Camera in iPhone Settings.");
                        } else {
                          showToast("⚠️ Camera access cancelled. Using manual photo picker fallback.");
                        }
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

              {/* Link Card association */}
              <div className="flex flex-col gap-1">
                <label htmlFor="receipt-card-select" className="text-[9px] text-gray-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span>📋</span> Link to Board Card (Optional)
                </label>
                <select
                  id="receipt-card-select"
                  className="bg-black/60 border border-[var(--color-dark-tertiary,#3D3D3D)] text-white hover:border-gray-500 focus:border-[var(--color-accent,#DF5504)] outline-none rounded p-2 text-[10px] font-bold cursor-pointer"
                >
                  <option value="">-- No Card (General Claim) --</option>
                  {cards.map(c => (
                    <option key={c.id} value={c.id}>{c.title || 'Untitled'}</option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                onClick={() => {
                  // Explicitly clear card dropdown on submit click if inputs reset
                  setTimeout(() => {
                    const sel = document.getElementById('receipt-card-select') as HTMLSelectElement;
                    if (sel) sel.value = '';
                  }, 50);
                }}
                className="py-2.5 bg-black border-2 border-[var(--color-accent,#DF5504)] hover:bg-[var(--color-accent,#DF5504)] text-white hover:text-white font-black uppercase rounded text-[10px] transition-all cursor-pointer shadow-[4px_4px_0px_0px_#000] active:translate-y-0.5 active:shadow-[2px_2px_0px_0px_#000] mt-1"
              >
                💾 Record Expenditure Claim
              </button>
            </form>

            {/* Employer Recipient Pre-fill Configuration */}
            <div className="bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)]/40 p-3 rounded flex flex-col gap-1.5 flex-shrink-0 text-left">
              <label htmlFor="employer-email-prefill" className="text-[9px] text-gray-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <span>📧</span> Employer's Email (Pre-fill Recipient)
              </label>
              <input
                type="email"
                id="employer-email-prefill"
                value={employerEmail}
                onChange={async (e) => {
                  setEmployerEmail(e.target.value);
                  await setStorage(`factory_app_${config.id}_employer_email`, e.target.value);
                }}
                placeholder="employer@company.com"
                className="bg-black/60 border border-[var(--color-dark-tertiary,#3D3D3D)] text-white hover:border-gray-500 focus:border-[var(--color-accent,#DF5504)] outline-none rounded p-2 text-[10px] font-bold"
              />
              <span className="text-[8px] text-gray-500 uppercase tracking-widest font-black">Pre-fills the recipient address when compiling & emailing claim reports</span>
            </div>

            {/* Scrollable Claims Feed */}
            <div className="flex-grow overflow-y-auto pr-1 text-left">
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
                          {log.isEmailed && (
                            <div className="mt-1 flex items-center gap-1.5 text-[8px] text-green-400 font-bold uppercase tracking-wider bg-green-950/30 p-1 border border-green-900/30 rounded w-fit">
                              <span>✔️ Emailed to {log.emailedTo} on {new Date(log.emailedAt!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                            </div>
                          )}
                          {log.cardId && (
                            (() => {
                              const linked = cards.find(c => c.id === log.cardId);
                              if (linked) {
                                return (
                                  <span className="mt-1 inline-flex items-center gap-1 text-[8px] text-[var(--color-accent,#DF5504)] font-mono font-bold uppercase tracking-wider bg-[var(--color-accent,#DF5504)]/10 px-1.5 py-0.5 border border-[var(--color-accent,#DF5504)]/20 rounded w-fit">
                                    📋 Assigned Card: {linked.title}
                                  </span>
                                );
                              }
                              return null;
                            })()
                          )}
                        </div>

                        {/* Quick Delete claim */}
                        <button
                          onClick={async () => {
                            await triggerHaptic();
                            if (confirm(`Are you sure you want to permanently delete this receipt claim for ${log.merchant}? This will completely remove the image reference and claim database record.`)) {
                              await saveReceipts(receipts.filter(r => r.id !== log.id));
                              showToast(`🗑️ Claim for ${log.merchant} permanently deleted`);
                            }
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
            <div className="flex justify-between items-center mt-2 pt-3 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/40 flex-shrink-0">
              {receipts.length > 0 ? (
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    if (!employerEmail) {
                      showToast("⚠️ Please specify an Employer's Email first!");
                      document.getElementById('employer-email-prefill')?.focus();
                      return;
                    }

                    // Assemble ASCII business claim table for all receipts
                    let report = `MTRAX LITE EXPENSE RECLAIM REPORT\n========================================\n\n`;
                    report += `TOTAL RECLAIMABLE AMOUNT: $${receipts.reduce((acc, r) => acc + r.amount, 0).toFixed(2)}\n\n`;
                    report += `ITEMIZED BUSINESS CLAIMS LIST:\n`;
                    report += `----------------------------------------\n`;

                    receipts.forEach((claim, idx) => {
                      const cTime = new Date(claim.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                      const cDate = new Date(claim.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                      report += `${idx + 1}. [${cDate} at ${cTime}] Claim Merchant: ${claim.merchant}\n`;
                      report += `   Amount: $${claim.amount.toFixed(2)}\n`;
                      if (claim.notes) report += `   Purpose: "${claim.notes}"\n`;
                      if (claim.isEmailed) report += `   Status: PREVIOUSLY SENT to ${claim.emailedTo}\n`;
                      report += `----------------------------------------\n`;
                    });

                    report += `\n\nCompiled on MTRAx lite. Secure, date-stamped digital receipts are on file.`;

                    const subject = encodeURIComponent(`MTRAx Expense Claims: Summary Report`);
                    const body = encodeURIComponent(report);
                    window.open(`mailto:${employerEmail}?subject=${subject}&body=${body}`, '_self');
                    showToast("📧 Compiling and opening Mail client...");

                    // Track metadata: Mark compiled receipt claims as emailed with timestamps
                    const emailedIds = receipts.map(fc => fc.id);
                    const updatedReceipts = receipts.map(r => {
                      if (emailedIds.includes(r.id)) {
                        return {
                          ...r,
                          isEmailed: true,
                          emailedAt: Date.now(),
                          emailedTo: employerEmail || 'Specified Recipient'
                        };
                      }
                      return r;
                    });
                    await saveReceipts(updatedReceipts);
                  }}
                  className="px-3 py-2 bg-[var(--color-accent,#DF5504)] hover:bg-[var(--color-accent,#DF5504)]/90 border border-black shadow-[2px_2px_0px_0px_#000] text-white font-mono text-[9px] uppercase font-bold rounded flex items-center gap-1.5 cursor-pointer active:translate-y-0.5 active:shadow-[2px_2px_0px_0px_#000] transition-all"
                >
                  📧 Email Claims Report
                </button>
              ) : (
                <div />
              )}
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIsReceiptsOpen(false);
                }}
                className="px-4 py-2 bg-black border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white font-bold rounded ml-auto"
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
          <div className="w-full max-w-lg bg-[#080f24] border border-blue-900/50 p-5 rounded-lg shadow-[8px_8px_0px_0px_#000] font-mono text-xs flex flex-col gap-4 max-h-[90vh] overflow-hidden animate-fadeIn">
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b border-blue-900/30 pb-3 flex-shrink-0">
              <span className="font-bold text-xs text-blue-400 uppercase tracking-wider flex items-center gap-2">
                ❓ Dashboard Quick Runbook
              </span>
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic();
                  setIsDashboardHelpOpen(false);
                }}
                className="text-[10px] text-blue-400 hover:text-white uppercase font-black cursor-pointer bg-transparent border-none"
              >
                Hide ×
              </button>
            </div>

            {/* Modal Scrollable Content */}
            <div className="overflow-y-auto pr-1 flex flex-col gap-4 leading-relaxed text-blue-300 font-sans text-[11px] text-left">
              <div className="p-3 bg-blue-950/40 border border-blue-900/30 rounded">
                <p className="font-bold text-white mb-0.5">BOARD QUICK RUNBOOK</p>
                <p className="text-blue-400">
                  A high-level guide to navigating the main board list interface. Detailed card edits are found within the Card's own help icon.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <p>
                  🎛️ <strong className="text-white font-mono">BOARD COLUMNS (LISTS):</strong> Your work is split into three lists: TO DO (pending actions), DOING (active focus), and DONE (completed items). The count shows the active cards in each.
                </p>
                <p>
                  📱 <strong className="text-white font-mono">MOBILE NAVIGATION:</strong> On mobile, swipe left or right on the screen to slide between columns, or tap the pagination dots at the top of the board to jump directly to a list.
                </p>
                <p>
                  📄 <strong className="text-white font-mono">CARD INTERACTION:</strong> Tap any card's frame to open Card Details (to edit checklist bullets, set alarms, or attach documents). Tap the <strong className="text-[var(--color-accent,#DF5504)]">+</strong> icon in the header bar to create a card in the current column.
                </p>
                <p>
                  🔄 <strong className="text-white font-mono">MOVING CARDS:</strong> Tap any card to open Card Details and change its column list location, or use click-and-drag directly on desktop browsers.
                </p>
                <p>
                  ⏱️ <strong className="text-white font-mono">TIMERS & INDICATORS:</strong> Spent Timer displays total time spent on this card, updated by active focused study sessions. Task Progress shows percentage progress and next sub-checklist items.
                </p>
                <p>
                  🕹️ <strong className="text-white font-mono">GLOBAL TOOLS:</strong> Launch quick tools such as Calendar (agenda timetables), Verbal Journals (audio diaries), Receipts (business claims), and Pomodoro (study timers) directly from the left sidebar drawer.
                </p>
              </div>

              <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded flex flex-col gap-1.5 text-amber-200">
                <p className="font-extrabold text-amber-400 font-mono text-[10px] uppercase tracking-wide">📦 ARCHIVING VS. 🗑️ DELETION LIFECYCLE</p>
                <p className="leading-relaxed">
                  • <strong className="text-white font-mono">ARCHIVING CARDS:</strong> Hides cards from active Kanban views but preserves them completely on-device. All checklists, files, categories, and notifications remain active and restorable anytime within the **Archive Studio**.
                </p>
                <p className="leading-relaxed">
                  • <strong className="text-white font-mono">DELETING CARDS:</strong> Permanently purges the card. Large documents/images (Base64) are erased from disk immediately to save space. Scheduled OS checklist alarms are cancelled, while independent **Verbal Diaries** & **Receipts** logs are preserved for tax/records history with their card links safely reverted to unassigned.
                </p>
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
              <div className="p-3.5 bg-blue-950/70 border border-blue-800/50 text-blue-300 rounded flex flex-col gap-2.5 text-[10px] leading-relaxed animate-fadeIn text-left w-full flex-shrink-0">
                <div className="font-bold text-[10px] uppercase text-blue-400 border-b border-blue-900/30 pb-1 flex justify-between items-center font-mono w-full">
                  <span>📔 Spoken Diary Guide</span>
                  <button
                    type="button"
                    onClick={() => setShowDiaryHelp(false)}
                    className="text-[9px] hover:text-white cursor-pointer uppercase font-black"
                  >
                    Hide ×
                  </button>
                </div>
                
                <div className="flex flex-col gap-2 font-sans">
                  <p>
                    🎙️ <strong className="text-white font-mono">SPEECH TRANSCRIPTION:</strong> Tap the red microphone button to speak. Your thoughts are transcribed to plain text instantly.
                  </p>
                  <p>
                    🕒 <strong className="text-white font-mono">TIMESTAMPS:</strong> Every spoken reflection is automatically date-and-time stamped to track exact workday records.
                  </p>
                  <p>
                    📤 <strong className="text-white font-mono">TASK DISPATCH:</strong> Connect any spoken note directly to task cards to build out clear sub-checklists and descriptions.
                  </p>
                </div>
              </div>
            )}

            <div className="bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)]/40 p-4 rounded flex flex-col items-center gap-3 flex-shrink-0">
              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-black">Daily Journal Log</span>

              {/* Auto-Dispatch on Creation Dropdown */}
              <div className="flex flex-col gap-1 w-full text-left">
                <label htmlFor="creation-auto-dispatch-select" className="text-[9px] text-gray-400 font-bold uppercase tracking-wider flex items-center gap-1.5 self-start">
                  <span>📋</span> Auto-Dispatch to Card (Optional)
                </label>
                <select
                  id="creation-auto-dispatch-select"
                  className="bg-black/60 border border-[var(--color-dark-tertiary,#3D3D3D)] text-white hover:border-gray-500 focus:border-[var(--color-accent,#DF5504)] outline-none rounded p-2 text-[10px] font-bold cursor-pointer font-mono"
                >
                  <option value="">-- No Auto-Dispatch (Unassigned Note) --</option>
                  {cards.map(c => (
                    <option key={c.id} value={c.id}>{c.title || 'Untitled Card'}</option>
                  ))}
                </select>
              </div>
              
              <div className="flex flex-col items-center gap-2 w-full mt-1">
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
                        const updatedLogs = [newLog, ...voiceLogs];
                        await saveVoiceLogs(updatedLogs);
                        setTypedDiaryText('');
                        showToast("✍️ Added Typed Daily Reflection!");

                        // Auto dispatch on creation if selected
                        const creationSelect = document.getElementById('creation-auto-dispatch-select') as HTMLSelectElement;
                        const targetCardId = creationSelect?.value;
                        if (targetCardId) {
                          await dispatchLogToCard(newLog.id, targetCardId);
                        }
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
                        const updatedLogs = [newLog, ...voiceLogs];
                        await saveVoiceLogs(updatedLogs);
                        setTypedDiaryText('');
                        showToast("✍️ Added Typed Daily Reflection!");

                        // Auto dispatch on creation if selected
                        const creationSelect = document.getElementById('creation-auto-dispatch-select') as HTMLSelectElement;
                        const targetCardId = creationSelect?.value;
                        if (targetCardId) {
                          await dispatchLogToCard(newLog.id, targetCardId);
                        }
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
              <div className="p-3.5 bg-blue-950/70 border border-blue-800/50 text-blue-300 rounded flex flex-col gap-2.5 text-[10px] leading-relaxed animate-fadeIn text-left w-full flex-shrink-0">
                <div className="font-bold text-[10px] uppercase text-blue-400 border-b border-blue-900/30 pb-1 flex justify-between items-center font-mono w-full">
                  <span>🍅 Focus Timer Guide</span>
                  <button
                    type="button"
                    onClick={() => setShowTimerHelp(false)}
                    className="text-[9px] hover:text-white cursor-pointer uppercase font-black"
                  >
                    Hide ×
                  </button>
                </div>
                
                <div className="flex flex-col gap-2 font-sans">
                  <p>
                    ⏱️ <strong className="text-white font-mono">ACTIVE WORK FOCUS:</strong> Standard study block with zero interruptions running for 25 minutes of core focus.
                  </p>
                  <p>
                    ☕ <strong className="text-white font-mono">REFRESH BREAK:</strong> Quick 5-minute break to stretch, stand up, and recharge your focus block.
                  </p>
                  <p>
                    🛌 <strong className="text-white font-mono">LONG REST CYCLE:</strong> Take an extended 15-minute break to fully wind down after completing 4 cycles.
                  </p>
                  <p>
                    🔔 <strong className="text-white font-mono">LOCK-SCREEN REMINDERS:</strong> Real-time sounds and vibrations alert you the instant focus or rest targets elapse.
                  </p>
                </div>
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

      {/* 📦 BOARD ARCHIVE & RECALL STUDIO OVERLAY */}
      {isArchiveStudioOpen && (() => {
        const filteredCards = cards.filter(c => {
          const query = archiveSearchQuery.trim().toLowerCase();
          const matchesSearch = c.title.toLowerCase().includes(query) || (c.description || '').toLowerCase().includes(query);
          
          if (!matchesSearch) return false;
          if (archiveFilterTab === 'active') return !c.isArchived && c.listId !== 'done';
          if (archiveFilterTab === 'completed') return c.listId === 'done' && !c.isArchived;
          if (archiveFilterTab === 'archived') return !!c.isArchived;
          return true; // 'all'
        });

        return (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[190] flex items-center justify-center p-4 animate-fadeIn">
            <div className="w-full max-w-2xl bg-[var(--color-dark-secondary,#333333)] border-2 border-[var(--color-accent,#DF5504)] p-6 rounded-lg shadow-[12px_12px_0px_0px_#000] font-mono text-xs flex flex-col gap-4 max-h-[85vh]">
              {/* Header */}
              <div className="flex justify-between items-center border-b-2 border-[var(--color-dark-tertiary,#3D3D3D)] pb-4 flex-shrink-0">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">📦</span>
                  <div className="flex flex-col">
                    <span className="font-black text-sm text-[var(--color-accent,#DF5504)] uppercase tracking-wider">
                      ARCHIVE & RECALL STUDIO
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">
                      Query, manage, and recall completed or archived items
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await triggerHaptic();
                      setIsArchiveStudioHelpOpen(!isArchiveStudioHelpOpen);
                    }}
                    className={`w-8 h-8 rounded-full border flex items-center justify-center font-bold text-xs transition-all cursor-pointer ${
                      isArchiveStudioHelpOpen
                        ? 'bg-[var(--color-accent,#DF5504)] border-[var(--color-accent,#DF5504)] text-white'
                        : 'bg-black/40 border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white'
                    }`}
                    title="Archive Studio Runbook Guide"
                  >
                    ❓
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await triggerHaptic();
                      setIsArchiveStudioOpen(false);
                      setIsArchiveStudioHelpOpen(false);
                      setArchiveSearchQuery('');
                    }}
                    className="w-8 h-8 rounded-full bg-black/40 border border-[var(--color-dark-tertiary,#3D3D3D)] hover:border-white text-white flex items-center justify-center text-sm font-black transition-colors cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Dynamic Interactive Archive Help Panel */}
              {isArchiveStudioHelpOpen && (
                <div className="mt-1 p-3.5 bg-blue-950/70 border border-blue-800/50 text-blue-300 rounded flex flex-col gap-2.5 text-[10px] leading-relaxed animate-fadeIn text-left flex-shrink-0">
                  <div className="font-bold text-[10px] uppercase text-blue-400 border-b border-blue-900/30 pb-1 flex justify-between items-center font-mono w-full">
                    <span>🗳️ Archive & Recall Studio Guide</span>
                    <button
                      type="button"
                      onClick={() => setIsArchiveStudioHelpOpen(false)}
                      className="text-[9px] hover:text-white cursor-pointer uppercase font-black"
                    >
                      Hide ×
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-[9px]">
                    <div className="flex flex-col gap-1">
                      <span className="font-black text-blue-200">📦 ARCHIVE / RESTORE</span>
                      <span>Hides active cards from primary Kanban boards while fully preserving study stats, logs, and checklists. Tap <b>Restore</b> to return to view.</span>
                    </div>
                    <div className="flex flex-col gap-1 border-t sm:border-t-0 sm:border-l border-blue-900/30 pt-2 sm:pt-0 sm:pl-3">
                      <span className="font-black text-blue-200">↩️ RECALL TO BOARD</span>
                      <span>Quickly moves any completed or archived task card back into the <b>To Do</b> column, clearing its completion date for immediate re-use.</span>
                    </div>
                    <div className="flex flex-col gap-1 border-t sm:border-t-0 sm:border-l border-blue-900/30 pt-2 sm:pt-0 sm:pl-3">
                      <span className="font-black text-blue-200">🗑️ PERMANENT DELETE</span>
                      <span>Completely clears the card from device storage. This is irreversible and resets associated study focus history. Requires confirmation.</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Search & Filter Controls */}
              <div className="flex flex-col gap-3 flex-shrink-0">
                <input
                  type="text"
                  placeholder="🔎 Search card titles or summaries..."
                  value={archiveSearchQuery}
                  onChange={(e) => setArchiveSearchQuery(e.target.value)}
                  className="w-full bg-black/55 border border-[var(--color-dark-tertiary,#3D3D3D)] text-white p-3 rounded text-xs font-mono focus:outline-none focus:border-[var(--color-accent,#DF5504)] placeholder-gray-500"
                />

                {/* Filter Chips */}
                <div className="flex gap-2 flex-wrap">
                  {(['all', 'active', 'completed', 'archived'] as const).map(tab => {
                    const count = cards.filter(c => {
                      if (tab === 'active') return !c.isArchived && c.listId !== 'done';
                      if (tab === 'completed') return c.listId === 'done' && !c.isArchived;
                      if (tab === 'archived') return !!c.isArchived;
                      return true;
                    }).length;

                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={async () => {
                          await triggerHaptic();
                          setArchiveFilterTab(tab);
                        }}
                        className={`px-3 py-1.5 rounded font-bold uppercase text-[9px] border transition-colors cursor-pointer ${
                          archiveFilterTab === tab
                            ? 'bg-[var(--color-accent,#DF5504)] border-transparent text-white'
                            : 'bg-black/35 border-[var(--color-dark-tertiary,#3D3D3D)] text-gray-400 hover:text-white'
                        }`}
                      >
                        {tab === 'all' && `🌐 All (${count})`}
                        {tab === 'active' && `⚡ Active (${count})`}
                        {tab === 'completed' && `✅ Completed (${count})`}
                        {tab === 'archived' && `📦 Archived (${count})`}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Scrollable List Area */}
              <div className="flex-grow overflow-y-auto no-scrollbar flex flex-col gap-2 pr-1 py-1">
                {filteredCards.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center text-gray-500 gap-2 border border-dashed border-[var(--color-dark-tertiary,#3D3D3D)]/60 rounded-md bg-black/10">
                    <span className="text-3xl">🗳️</span>
                    <span className="font-bold uppercase tracking-wider text-[10px]">No cards found</span>
                    <span className="text-[9px] text-gray-600 max-w-[280px]">
                      Try resetting filters or searching with a different keyword.
                    </span>
                  </div>
                ) : (
                  filteredCards.map(card => {
                    const checklist = card.checklists?.[0];
                    const completedTasks = checklist?.items.filter(i => i.isChecked).length || 0;
                    const totalTasks = checklist?.items.length || 0;
                    const listObj = lists.find(l => l.id === card.listId);

                    return (
                      <div 
                        key={card.id}
                        onClick={async () => {
                          await triggerHaptic();
                          setSelectedCardForEdit(card);
                        }}
                        className="p-2.5 bg-black/40 border border-[#3D3D3D] rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-[var(--color-accent,#DF5504)] hover:bg-black/55 transition-all cursor-pointer"
                      >
                        <div className="flex items-center gap-2 max-w-[65%] truncate">
                          <span className="font-bold text-xs text-white truncate">{card.title}</span>
                          {totalTasks > 0 && (
                            <span className="text-[10px] text-[var(--color-accent,#DF5504)] font-mono font-bold flex-shrink-0">
                              ({Math.round((completedTasks/totalTasks)*100)}%)
                            </span>
                          )}
                          
                          {/* Badges */}
                          <span className={`text-[7px] font-black uppercase px-1.5 py-0.5 rounded border border-white/5 flex-shrink-0 ${
                            card.listId === 'done' 
                              ? 'bg-emerald-950/40 text-emerald-400 border-emerald-900/30' 
                              : 'bg-blue-950/40 text-blue-400 border-blue-900/30'
                          }`}>
                            {listObj?.name || card.listId}
                          </span>

                          {card.isArchived && (
                            <span className="text-[7px] font-black uppercase px-1.5 py-0.5 rounded border border-amber-900/30 bg-amber-950/40 text-amber-400 flex-shrink-0 animate-pulse">
                              ARCHIVED
                            </span>
                          )}
                        </div>

                        {/* Quick action buttons row */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {/* Recall Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRecallCard(card.id);
                            }}
                            className="px-2 py-1 bg-blue-950/30 border border-blue-900/40 hover:bg-blue-900/60 text-blue-300 font-bold text-[8px] uppercase rounded transition-colors cursor-pointer"
                            title="Recall and send card back to 'To Do' column"
                          >
                            ↩️ Recall
                          </button>

                          {/* Archive/Restore Toggle */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleArchiveCard(card.id, !card.isArchived);
                            }}
                            className="px-2 py-1 bg-amber-950/30 border border-amber-900/40 hover:bg-amber-900/60 text-amber-300 font-bold text-[8px] uppercase rounded transition-colors cursor-pointer"
                            title={card.isArchived ? "Restore to active Kanban boards" : "Archive and hide from active Kanban boards"}
                          >
                            {card.isArchived ? "📥 Restore" : "📦 Archive"}
                          </button>

                          {/* Complete Delete button */}
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              await handleDeleteCard(card.id);
                            }}
                            className="w-5 h-5 bg-red-950/30 border border-red-900/40 hover:bg-red-900/60 text-red-300 font-bold text-[8px] uppercase rounded flex items-center justify-center transition-colors cursor-pointer"
                            title="Delete card permanently from storage"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Footer */}
              <div className="flex justify-end pt-3 border-t border-[var(--color-dark-tertiary,#3D3D3D)]/50 flex-shrink-0">
                <button
                  type="button"
                  onClick={async () => {
                    await triggerHaptic();
                    setIsArchiveStudioOpen(false);
                    setArchiveSearchQuery('');
                  }}
                  className="px-4 py-2 border border-[var(--color-dark-tertiary,#3D3D3D)] bg-[var(--color-dark-bg,#282828)] hover:bg-[var(--color-dark-tertiary)] text-white hover:border-white font-bold rounded transition-colors text-xs uppercase cursor-pointer"
                >
                  Close Studio
                </button>
              </div>

            </div>
          </div>
        );
      })()}

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
