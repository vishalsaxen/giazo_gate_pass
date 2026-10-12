# GiaZo Gate Pass

Visitor approvals and resident KYC for **Banke Bihari Dham, Dayalbagh, Agra** (House No. 1–40, Phase 1 and Phase 2).

- **Security guard** takes the visitor's photo, enters name and mobile, picks the house and marks it Owner, Tenant or Vacant. All fields are required.
- **Owner / Tenant** gets a buzzer on their phone and approves or denies the visitor. Vacant houses go to the Super Admin.
- **Owner / Tenant KYC**: every resident uploads all required documents. Owners: Aadhaar, PAN, Sale Deed, Electricity Bill. Tenants: Aadhaar, Rent Agreement, Police Verification, Owner NOC.
- **Super Admin** verifies KYC, approves guard accounts and sees the full gate log.

Live app: https://vishalsaxen.github.io/giazo_gate_pass/

Built as a static web app (no build step) on Firebase Authentication, Cloud Firestore and Cloud Storage.

## One-time Firebase setup

1. **Web config.** Firebase console > Project settings > General > Your apps > Add app (Web). Copy the `firebaseConfig` values into `public/firebase-config.js`.
2. **Super Admin.** Put the Super Admin's Google email in `ADMIN_EMAILS` in `public/firebase-config.js`, and in lower case in `isAdmin()` in both `firestore.rules` and `storage.rules`. The Super Admin signs in with Google.
3. **Authentication.** Build > Authentication > Sign-in method: enable **Google** and **Email/Password**. Under Settings > Authorized domains add `vishalsaxen.github.io`.
4. **Firestore.** Build > Firestore Database > Create database (region `asia-south1`, Mumbai). Open the Rules tab, paste `firestore.rules`, Publish.
5. **Storage.** Build > Storage > Get started (needs the Blaze pay-as-you-go plan on new projects; the free usage tier still applies). Open the Rules tab, paste `storage.rules`, Publish.

With the Firebase CLI you can do steps 4 and 5 in one go: `firebase deploy --only firestore:rules,storage`.

## Hosting

- **GitHub Pages:** repo Settings > Pages > Source: **GitHub Actions**. Every push to `main` deploys `public/`.
- **Firebase Hosting (optional):** `firebase deploy --only hosting` serves the same files at `https://giazo-gate-pass.web.app`.

## How people get access

1. Everyone signs in (Google or email) and fills in their name, mobile and role.
2. Residents pick Owner or Tenant and their house, then upload every KYC document and send it for approval.
3. The Super Admin approves KYC in the **KYC requests** tab. Only verified residents receive visitor alerts.
4. Guards choose "Security guard" when signing up; the Super Admin approves them in the **People** tab.

## Buzzer

Residents tap **Turn on buzzer** once per visit to the app. While the app is open the phone rings and vibrates for each new visitor, and a system notification appears if the tab is in the background. Ringing stops after 5 minutes without an answer. Ringing a phone that has the app fully closed needs Firebase Cloud Messaging and a Cloud Function, which is the next step.

## Data

| Collection | What it holds |
| --- | --- |
| `users/{uid}` | name, phone, role (`resident` or `guard`), Owner/Tenant, phase, house, `kycStatus` (`none`, `pending`, `approved`, `rejected`), uploaded document paths |
| `visits/{id}` | visitor name, mobile, photo path, phase, house, Owner/Tenant/Vacant, status (`pending`, `approved`, `denied`), guard, who decided and when |

Files live in Storage under `visitors/` and `kyc/{uid}/`. KYC files are readable only by their owner and the Super Admin.
