// Generated dynamically by the iOS App Factory generator script. Do not modify manually.
export interface AppConfig {
  id: string;
  name: string;
  bundleId: string;
  accentColor: string;
  apiEndpoint: string;
  features: {
    guestMode: boolean;
    pomodoro: boolean;
    haptics: boolean;
  };
}

export const config: AppConfig = {
  "id": "triage-lite",
  "name": "Triage Lite",
  "bundleId": "com.mdex.triagelite",
  "accentColor": "#DF5504",
  "apiEndpoint": "https://api.triage.mdex.com",
  "features": {
    "guestMode": true,
    "pomodoro": true,
    "haptics": true
  }
};
