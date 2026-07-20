import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';

// --- INDEXEDDB WEB FALLBACK STORAGE ENGINE ---
const openIDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mtrax_filesystem_db', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const writeIDB = async (key: string, value: Blob): Promise<void> => {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

const readIDB = async (key: string): Promise<Blob | null> => {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly');
      const store = tx.objectStore('files');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('IndexedDB read error', e);
    return null;
  }
};

const deleteIDB = async (key: string): Promise<void> => {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

// Helper: Convert File/Blob to Base64 String
export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      // Extract only the raw base64 data portion
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
};

export const useFilesystem = () => {
  const isNative = Capacitor.isNativePlatform();

  /**
   * Save an incoming File/Blob to the platform's native storage
   * @param filename Unique identifier for the file (e.g. "receipt_123.pdf")
   * @param fileData Raw File or Blob object
   */
  const saveFile = async (filename: string, fileData: Blob): Promise<{ filePath: string; webUrl: string }> => {
    const safeKey = `mtrax_docs/${filename}`;

    if (isNative) {
      // 1. NATIVE HARDWARE ROUTE (iOS / Android)
      const base64Data = await blobToBase64(fileData);
      
      // Ensure private sandboxed folder exists and write the raw file
      await Filesystem.writeFile({
        path: safeKey,
        data: base64Data,
        directory: Directory.Documents,
        recursive: true
      });

      // Retrieve the local Webview URL representation of the native file
      const { uri } = await Filesystem.getUri({
        path: safeKey,
        directory: Directory.Documents
      });

      return {
        filePath: safeKey,
        webUrl: Capacitor.convertFileSrc(uri)
      };
    } else {
      // 2. WEB BROWSER FALLBACK ROUTE (IndexedDB Binary Blob storage)
      await writeIDB(safeKey, fileData);
      
      // Generate a temporary in-memory Object URL to preview in Lightbox/Iframes
      const webUrl = URL.createObjectURL(fileData);
      
      return {
        filePath: safeKey,
        webUrl
      };
    }
  };

  /**
   * Read file binary contents from platform storage
   * @param filePath The local filePath identifier
   */
  const readFile = async (filePath: string): Promise<{ blob: Blob; webUrl: string } | null> => {
    if (isNative) {
      // Native File reading
      try {
        const file = await Filesystem.readFile({
          path: filePath,
          directory: Directory.Documents
        });

        // Convert base64 back to binary Blob
        const base64Response = await fetch(`data:application/octet-stream;base64,${file.data}`);
        const blob = await base64Response.blob();
        
        const { uri } = await Filesystem.getUri({
          path: filePath,
          directory: Directory.Documents
        });

        return {
          blob,
          webUrl: Capacitor.convertFileSrc(uri)
        };
      } catch (e) {
        console.error('Failed to read native file', e);
        return null;
      }
    } else {
      // Browser IndexedDB reading
      const blob = await readIDB(filePath);
      if (!blob) return null;
      return {
        blob,
        webUrl: URL.createObjectURL(blob)
      };
    }
  };

  /**
   * Delete a file from platform storage to prevent orphan storage leakage
   */
  const deleteFile = async (filePath: string): Promise<void> => {
    try {
      if (isNative) {
        await Filesystem.deleteFile({
          path: filePath,
          directory: Directory.Documents
        });
      } else {
        await deleteIDB(filePath);
      }
    } catch (e) {
      console.warn('Silent delete mismatch or file not found', e);
    }
  };

  return {
    isNative,
    saveFile,
    readFile,
    deleteFile
  };
};
