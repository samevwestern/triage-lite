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
  "id": "mtrax-lite",
  "name": "MTRAx lite",
  "bundleId": "com.mdex.mtraxlite",
  "accentColor": "#DF5504",
  "apiEndpoint": "https://api.mtrax.mdex.com",
  "features": {
    "guestMode": true,
    "pomodoro": true,
    "haptics": true
  }
};
