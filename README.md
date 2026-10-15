# GiaZo Gate Pass

Visitor approvals and resident KYC for **Banke Bihari Dham, Dayalbagh, Agra** (House No. 1–40, Phase 1 and Phase 2).

- **Security guard** takes the visitor's photo, enters name and mobile, picks the house and marks it Owner, Tenant or Vacant. All fields are required.
- **Owner / Tenant** gets a buzzer on their phone and approves or denies the visitor. Vacant houses go to the Super Admin.
- **Owner / Tenant KYC**: every resident uploads all required documents. Owners: Aadhaar, PAN, Sale Deed, Electricity Bill. Tenants: Aadhaar, Rent Agreement, Police Verification, Owner NOC.
- **Guard shift check-in**: Morning or Evening guards take a selfie when they start; the date and time come from their phone. The visitor form opens only after check-in.
- **Super Admin** verifies KYC, approves guard accounts, deletes any user (before or after KYC), sees the gate log and guard attendance, and downloads visitor entries and guard attendance as Excel or PDF for any date range.
- **Contacts** (residents and guards): one-tap Emergency 112, Police 100, Fire Brigade 101, Ambulance 108, the society security desk, and the Core Leadership (President, Vice President, Secretary, Joint Secretary, Treasurer) with mobile numbers. The Super Admin edits these under **Society info**.
- **Dues** (verified residents): society UPI ID, QR code and bank details, dues for all houses or one house, Pay by UPI app, and "I have paid" with a reference number and receipt. The Super Admin adds dues and confirms or rejects receipts.
- **Our Nest** (verified residents): verified owners list their salon, cloud kitchen, tuition and other home businesses with a photo and phone number. Owners remove their own; the Super Admin can remove any.
- **Guards see no member details**: the security rules block guards from KYC files, dues, payments, payment details and Our Nest. Guards only see the gate, their own check-ins and the Contacts screen.
- The login page has three tabs: **Resident** (rose), **Security Guard** (teal) and **Super Admin** (plum). The Super Admin tab only lets the Super Admin's Google account in.
- Guards upload an Aadhaar Card and police verification when they sign up. The Super Admin approves guards and resident KYC on one **Approvals** screen.

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

## Android app

`android/` wraps the live web app as an Android app (a Trusted Web Activity: the app opens the site full screen in Chrome, so Google sign-in, the camera and the buzzer work as they do in the browser). The **Build Android app** workflow builds an installable `.apk` and a Play Store `.aab` on every change under `android/` and publishes them as a GitHub release. Web app changes reach the Android app without a rebuild.

To sign for the Play Store, create an upload key once and add it as repository secrets (Settings > Secrets and variables > Actions):

```
keytool -genkeypair -v -keystore giazo-upload.jks -alias giazo -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 giazo-upload.jks   # value for ANDROID_KEYSTORE_BASE64
```

Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`giazo`), `ANDROID_KEY_PASSWORD`. Keep the `.jks` file and passwords safe; every Play Store update must be signed with the same key. Without the secrets the build is signed with a throwaway debug key.

To hide Chrome's address bar, publish `https://vishalsaxen.github.io/.well-known/assetlinks.json` (from a `vishalsaxen.github.io` repository) with package `com.giazo.gatepass` and the signing certificate SHA-256 shown on each release.

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
| `attendance/{id}` | guard, shift (Morning/Evening), selfie path, date, date and time from the guard's phone, server time |
| `settings/society` | emergency numbers, security desk, Core Leadership names and mobiles |
| `settings/payments` | UPI ID, account holder, bank, account number, IFSC, QR code path |
| `dues/{id}` | title, amount, due date, phase and house (0 means all houses) |
| `payments/{id}` | due, resident, house, reference number, receipt path, status (`submitted`, `confirmed`, `rejected`) |
| `nest/{id}` | owner, house, business name, category, description, phone, photo path |
| `visits/{id}` | visitor name, mobile, photo path, phase, house, Owner/Tenant/Vacant, status (`pending`, `approved`, `denied`), guard, who decided and when |

Files live in Storage under `visitors/`, `attendance/{uid}/` and `kyc/{uid}/`. Deleting a user removes their profile and KYC files; their sign-in account stays in Firebase Authentication until you delete it there too. Excel and PDF export libraries (SheetJS 0.18.5, jsPDF 2.5.1, jsPDF-AutoTable 3.8.2) are bundled in `public/vendor/`. KYC files are readable only by their owner and the Super Admin.
