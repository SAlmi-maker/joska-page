# JOSKA — Setup & Deployment Guide

## Project File Structure

```
joska/
├── index.html            ← Smart entry point (redirect)
├── login.html            ← Authentication page
├── dashboard.html        ← Main dashboard
├── settings.html         ← Company settings
├── reset-password.html   ← ✨ Branded password reset page (NEW)
├── css/
│   ├── style.css         ← Global styles, variables, components
│   └── dashboard.css     ← App shell, sidebar, stats, tables
└── js/
    ├── firebase.js       ← Firebase init (⚠️ edit this first)
    ├── i18n.js           ← Translations: EN / FR / AR + RTL
    ├── auth.js           ← Login, logout, route protection, reset flow
    ├── dashboard.js      ← Revenue stats, invoice feed
    └── settings.js       ← Company profile, logo/seal upload
```

---

## Step 1 — Create a Firebase Project

1. Go to https://console.firebase.google.com
2. Click **Add project** → Name it (e.g. `joska-app`) → Continue
3. Disable Google Analytics if not needed → **Create project**

---

## Step 2 — Enable Authentication

1. In Firebase Console → **Authentication** → **Get started**
2. Under **Sign-in method** → Enable **Email/Password**
3. Go to **Users** tab → **Add user**
4. Enter admin email + password (no public registration — admin only)

---

## Step 3 — Create Firestore Database

1. Firebase Console → **Firestore Database** → **Create database**
2. Choose **Production mode** → Select your region → **Enable**
3. Go to **Rules** tab → Replace with:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Each user can only access their own data
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

4. Click **Publish**

---

## Step 4 — Enable Firebase Storage

1. Firebase Console → **Storage** → **Get started**
2. Choose **Production mode** → Select region → **Done**
3. Go to **Rules** tab → Replace with:

```js
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

4. Click **Publish**

---

## Step 5 — Get Your Firebase Config

1. Firebase Console → ⚙️ **Project Settings** → **Your apps**
2. Click **</>** (Web) → Register app → Name it `JOSKA Web`
3. Copy the `firebaseConfig` object

---

## Step 6 — Update `js/firebase.js`

Open `js/firebase.js` and replace the placeholder config:

```js
const firebaseConfig = {
  apiKey:            "AIzaSy...",          // ← Your value
  authDomain:        "your-project.firebaseapp.com",
  projectId:         "your-project-id",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc123"
};
```

---

## Step 7 — Deploy to GitHub Pages

### Option A — Drag & Drop (easiest)

1. Create a new GitHub repository (e.g. `joska-app`)
2. Make it **Public**
3. Upload all project files maintaining the folder structure
4. Go to **Settings** → **Pages**
5. Source: **Deploy from a branch** → Branch: `main` → Folder: `/ (root)`
6. Click **Save** → Your app will be live at `https://yourusername.github.io/joska-app/`

### Option B — Git CLI

```bash
git init
git add .
git commit -m "Initial JOSKA deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/joska-app.git
git push -u origin main
```

Then enable GitHub Pages in repository Settings as above.

---

## Step 8 — Add Authorized Domains for Firebase Auth

> ⚠️ **Required for the branded password reset page to work.**

1. Firebase Console → **Authentication** → **Settings** → **Authorized domains**
2. Click **Add domain**
3. Add your GitHub Pages domain: `yourusername.github.io`
4. If using a custom domain, add that too (e.g. `app.yourcompany.com`)

Firebase will only redirect to domains listed here. Without this step, the
reset email link will be blocked and the user will land on the default Firebase
error page instead of `reset-password.html`.

---

## Password Reset Flow (Branded)

The full end-to-end flow after setup:

```
User clicks "Forgot password?" on login.html
        ↓
Enters email → auth.js calls sendPasswordReset()
with actionCodeSettings pointing to reset-password.html
        ↓
Firebase sends email with link:
  https://your-domain/reset-password.html?mode=resetPassword&oobCode=XXXX
        ↓
User clicks link → reset-password.html loads
        ↓
Page reads oobCode from URL, calls verifyPasswordResetCode()
  ✅ Valid   → shows "Set New Password" form
  ❌ Expired → shows branded "Link Expired" error panel
        ↓
User enters + confirms new password
  • 8-character minimum enforced client-side
  • Password strength indicator (Weak / Fair / Good / Strong)
  • Show/hide toggle on both fields
  • Passwords-must-match validation
        ↓
confirmPasswordReset(oobCode, newPassword) called
  ✅ Success → branded success screen → auto-redirect to login.html (5s)
  ❌ Error   → inline error message (expired / invalid / weak password)
```

---

## Firestore Data Structure

```
users/
  {uid}/
    settings/
      company           ← Company profile document
        companyName: string
        address: string
        phone: string
        email: string
        website: string
        logoUrl: string   (Firebase Storage URL)
        sealUrl: string   (Firebase Storage URL)
        updatedAt: timestamp
    invoices/
      {invoiceId}         ← Invoice documents (future)
        invoiceNumber: string
        clientName: string
        total: number
        status: 'draft' | 'pending' | 'paid' | 'overdue'
        createdAt: timestamp
        paidAt: string (ISO date)
```

---

## Multi-Language Support

| Language | Code | Direction |
|----------|------|-----------|
| English  | `en` | LTR       |
| French   | `fr` | LTR       |
| Arabic   | `ar` | **RTL**   |

Language preference is saved in `localStorage` and persists across sessions.
The reset-password page is fully translated in all three languages, including
password strength labels, error messages, and the countdown redirect text.

---

## Creating Admin Users

Since public registration is disabled, all users must be created manually:

1. Firebase Console → **Authentication** → **Users**
2. Click **Add user**
3. Enter email and temporary password
4. Share credentials securely with the user
5. User can reset password from the login page

---

## Dark Mode

Dark mode is toggled via the moon/sun button in the topbar and login page.
Preference is saved in `localStorage` under `joska_theme`.
The reset-password page respects the same dark mode preference.

---

## Browser Support

Chrome 90+, Firefox 88+, Safari 14+, Edge 90+

---

*JOSKA © 2025 — Lightweight Invoice & Revenue Management for Car Rental Agencies*
