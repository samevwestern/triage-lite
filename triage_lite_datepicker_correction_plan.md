# 📋 Timezone Correction Plan: Date Picker Alignments (Triage Lite)

During an in-depth empirical code-level review of the date picker inputs inside [App.tsx](file:///Users/samwestern/Documents/GitHub/triage-lite/src/App.tsx), we discovered a critical, silent **Timezone-Shift Bug** that causes selected dates to slip backward by exactly one day depending on the user's geographic location.

This document details the bug mechanics and outlines a robust **Local-Midnight Calibration Plan** to resolve it globally.

---

## 🔍 The Timezone-Shift Bug Explained

Currently, the date picker inputs parse and format dates using UTC-centric methods:
* **Formatting:** `value={selectedCardForEdit.dueDate ? new Date(selectedCardForEdit.dueDate).toISOString().split('T')[0] : ''}` (App.tsx: L752)
* **Parsing:** `const parsed = e.target.value ? Date.parse(e.target.value) : null;` (App.tsx: L754)

### 🚨 Why this causes a 1-day slipping bug:

```
Example Scenario:
A user in Sydney, Australia (GMT+10) marks a card as completed on July 9 at 8:00 AM local time.

1. App saves completedAt as Date.now() -> 1783615200000 (UTC: 2026-07-08T22:00:00Z)
2. Modal loads completedAt to format it.
3. new Date(1783615200000).toISOString() -> "2026-07-08T22:00:00.000Z"
4. .split('T')[0] -> "2026-07-08"
5. ERROR: Input box displays JULY 8, 2026! The completed date has slipped backward by a day!
```

Similarly, for users in western hemispheres (e.g., New York, GMT-4):
* `Date.parse("2026-07-09")` is parsed by Webkit/Chromium as UTC midnight (`2026-07-09T00:00:00Z`), which translates to **July 8 at 8:00 PM local New York time**.
* When formatting back via local-to-UTC transitions, the input box immediately flips and displays the incorrect day.

---

## 🛠️ The Local-Midnight Calibration Plan

To achieve 100% timezone-agnostic dates, we must abandon UTC ISO-string splitting and adopt **Local-Midnight Calibration**.

We will integrate two light, pure helper functions into `App.tsx` (or a utility file) to format and parse date strings utilizing local system offsets instead of UTC boundaries:

### 1. Centralized Date Helper Functions
```typescript
// Safe conversion: Epoch Number -> Local YYYY-MM-DD String
const formatLocalYYYYMMDD = (epoch: number | null | undefined): string => {
  if (!epoch) return '';
  const d = new Date(epoch);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Safe parsing: YYYY-MM-DD String -> Local Midnight Epoch Number
const parseLocalYYYYMMDD = (dateStr: string): number | null => {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  // Creates a date object at local midnight in the user's current timezone
  return new Date(year, month - 1, day).getTime();
};
```

### 2. Updating App.tsx Inputs (Proposed Diff)

We will modify the date inputs inside the `CardDetailModal` to use these helpers:

```diff
-value={selectedCardForEdit.dueDate ? new Date(selectedCardForEdit.dueDate).toISOString().split('T')[0] : ''}
-onChange={(e) => {
-  const parsed = e.target.value ? Date.parse(e.target.value) : null;
-  setSelectedCardForEdit({ ...selectedCardForEdit, dueDate: parsed });
-}}
+value={formatLocalYYYYMMDD(selectedCardForEdit.dueDate)}
+onChange={(e) => {
+  const parsed = parseLocalYYYYMMDD(e.target.value);
+  setSelectedCardForEdit({ ...selectedCardForEdit, dueDate: parsed });
+}}
```

And similarly for `completedAt`:

```diff
-value={selectedCardForEdit.completedAt ? new Date(selectedCardForEdit.completedAt).toISOString().split('T')[0] : ''}
-onChange={(e) => {
-  const parsed = e.target.value ? Date.parse(e.target.value) : null;
-  setSelectedCardForEdit({ ...selectedCardForEdit, completedAt: parsed });
-}}
+value={formatLocalYYYYMMDD(selectedCardForEdit.completedAt)}
+onChange={(e) => {
+  const parsed = parseLocalYYYYMMDD(e.target.value);
+  setSelectedCardForEdit({ ...selectedCardForEdit, completedAt: parsed });
+}}
```

---

## 📅 Verification Steps

1. **Simulated Sydney Test (Positive Offset):** Verify that local morning completions (e.g. `Sydney July 9, 8:00 AM`) display as `2026-07-09`.
2. **Simulated New York Test (Negative Offset):** Verify that selecting a date (e.g. `2026-07-09`) does not flip backward on save, remaining locked on the selected day.
