import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export const useCapacitor = () => {
  const isNative = Capacitor.isNativePlatform();

  // Unified persistent storage get
  const getStorage = async (key: string): Promise<string | null> => {
    if (isNative) {
      const { value } = await Preferences.get({ key });
      return value;
    } else {
      return localStorage.getItem(key);
    }
  };

  // Unified persistent storage set
  const setStorage = async (key: string, value: string): Promise<void> => {
    if (isNative) {
      await Preferences.set({ key, value });
    } else {
      localStorage.setItem(key, value);
    }
  };

  // Safe native physical vibration wrapper
  const triggerHaptic = async (): Promise<void> => {
    try {
      if (isNative) {
        await Haptics.impact({ style: ImpactStyle.Medium });
      } else if (navigator.vibrate) {
        // Fallback for HTML5 vibrations in Chrome/Android web
        navigator.vibrate(50);
      }
    } catch {
      // Catch exceptions silently if device hardware blocks vibration
    }
  };

  return {
    isNative,
    getStorage,
    setStorage,
    triggerHaptic
  };
};
