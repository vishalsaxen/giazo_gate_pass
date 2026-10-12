// Firebase web app config for project "giazo-gate-pass".
// Get it from Firebase console > Project settings > General > Your apps > Web app > SDK setup and configuration.
// These values are not secrets; access is controlled by firestore.rules and storage.rules.
export const firebaseConfig = {
  apiKey: "",
  authDomain: "giazo-gate-pass.firebaseapp.com",
  projectId: "giazo-gate-pass",
  storageBucket: "giazo-gate-pass.firebasestorage.app",
  messagingSenderId: "",
  appId: ""
};

// Google accounts that get the Super Admin screens.
// Keep this list in sync with isAdmin() in firestore.rules and storage.rules.
export const ADMIN_EMAILS = [
  "REPLACE_WITH_ADMIN_EMAIL"
];
