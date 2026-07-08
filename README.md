#  Triage Lite - iOS & PC Multi-Platform Setup Runbook

Triage Lite is a streamlined, local-first, distraction-free Pomodoro Kanban planner optimized for student life and fast personal task execution. 

This standalone module is designed to compile as a native iOS App using **Ionic Capacitor** or run as a standalone browser app on **Windows / PC Web Browsers** with zero modifications.

---

## ✦ Developer Setup Requirements

### 1. Hardware & Tooling Matrix
*   **To Run on Windows / PC:**
    *   Node.js (v18+) or **Bun** runtime (Recommended).
    *   Any modern web browser (Chrome, Firefox, Edge).
*   **To Run on iOS (Simulator or Physical iPhone):**
    *   A macOS computer.
    *   Xcode (Installed via Mac App Store).
    *   Cocoapods installed (`sudo gem install cocoapods` or `brew install cocoapods`).
    *   A physical Apple iPhone + USB connector cable (Optional).

---

## ✦ How to Run & Test on a PC (Windows / Web)

On Windows/Web, the app runs as a high-performance Progressive Web App (PWA) using local storage to preserve guest sandboxes.

1.  **Open your terminal and navigate to the project subfolder:**
    ```bash
    cd triage-lite
    ```
2.  **Install all dependencies:**
    ```bash
    bun install
    # or 'npm install'
    ```
3.  **Boot up the Vite Local Development Server:**
    ```bash
    bun run dev
    ```
4.  **Open your browser and navigate to:**
    *   `http://localhost:8081`
5.  **Test Guest Features:**
    *   Create cards, lists, toggle daily habits, and start the distraction-free Pomodoro timers.
    *   Click **"Export CSV for Excel"** to verify data is compiled as a clean, structured spreadsheet.

---

## ✦ How to Run & Test on Apple iOS (macOS + Simulator/Device)

To pack, compile, and run Triage Lite as a native iOS app, Capacitor wraps the compiled bundle inside a standard native Xcode Project (`ios/`).

### Step 1: Compile the Web Build
Vite must compile the React assets into the `/dist` directory first:
```bash
cd triage-lite
bun run build
```

### Step 2: Initialize & Sync the iOS Project
Create the native Xcode structures and copy over the static resources:
```bash
# Add iOS platform targets (Required only on first initialization)
npx cap add ios

# Compile static assets and inject into the Xcode sandbox
npx cap sync ios
```

### Step 3: Run on iOS Simulator
You can boot up the native iOS simulator directly from your command line:
```bash
npx cap run ios
```
*Capacitor will compile the project and open a virtual iPhone on your Mac screen.*

### Step 4: Run on a Physical iPhone
To compile Triage Lite onto your actual phone:
1.  **Launch Xcode with the generated project:**
    ```bash
    npx cap open ios
    ```
2.  **Configure Team & Signing Certificates in Xcode:**
    *   In the left sidebar of Xcode, select the topmost project file (`App`).
    *   Go to **Signing & Capabilities**.
    *   Check **"Automatically manage signing"**.
    *   Select your Apple ID account in the **Team** dropdown (A free Apple personal developer profile works fine!).
3.  **Deploy to Device:**
    *   Plug your iPhone into your Mac via USB.
    *   Trust the computer on your iPhone screen.
    *   In Xcode's top toolbar, select your physical iPhone as the target device instead of a simulator.
    *   Click the **Play (Build)** button.
    *   *On your iPhone:* Go to **Settings > General > VPN & Device Management** and trust your Developer profile to allow the app to boot.

---

## ✦ 5-Judge Cost & Integration Matrix

Before pushing to production, review these key operational points verified by the five-judge panel:

### 1. App Store Guidelines & Guest Mode (Guideline 5.1.1)
*   **The Review Rule:** Apple rejects apps that enforce mandatory sign-up walls for basic services.
*   **Our Solution:** The app implements a standard **"Try as Guest"** launcher. All data is saved on device until the student decides to sync, ensuring instantaneous App Store compliance.

### 2. Sign In with Apple (Guideline 4.8)
*   **The Review Rule:** If your iOS app uses Google/Facebook Login, it **MUST** offer Sign in with Apple as an equal option.
*   **Our Solution:** The Sync Modal features Sign in with Apple. Setting this up in production requires an active Apple Developer Team Account.

### 3. Cost Analysis

| Item | Monthly Cost | Usage Threshold | Reason |
| :--- | :--- | :--- | :--- |
| **Apple Dev Membership** | **$99 / year** | Mandatory to compile for App Store | Required for push notifications and release certificates. |
| **Firebase SSO & Storage** | **$0 / month** | Free up to 50,000 active users | Spark Plan is completely free for standard user tiers. |
| **Hono Hosting (GCP)** | **$0 / month** | Free up to 2,000,000 monthly hits | Uses highly efficient Google Cloud Run serverless scale-down. |

---

## ✦ Key Troubleshooting Tips

*   **Vibration Blocked on Simulator:** Native Apple haptics (`triggerHaptic`) require a physical iOS device to vibrate. The simulator will run without crashing but will not vibrate.
*   **Network IP Blocks (Physical iPhone):** When testing on a physical iPhone, the API base URL in `.env` cannot be `localhost`. You must change `VITE_BACKEND_BASE_URL` to point to your Mac's local network IP address (e.g., `http://192.168.1.104:3000`).
*   **iOS Safe Margin Glitches:** If top-bar content overlaps the battery/wifi status bar, verify that the `viewport-fit=cover` meta is active in `index.html` and that your parent div uses the `ios-safe-top` padding utility.
