// Firebase web app config for project "giazo-gate-pass".
// Get it from Firebase console > Project settings > General > Your apps > Web app > SDK setup and configuration.
// These values are not secrets; access is controlled by firestore.rules and storage.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyC5jF8vf0sas5jdCs1uQ6BeH799xDzXVJc",
  authDomain: "giazo-gate-pass.firebaseapp.com",
  projectId: "giazo-gate-pass",
  storageBucket: "giazo-gate-pass.firebasestorage.app",
  messagingSenderId: "702280136929",
  appId: "1:702280136929:web:549713b90df65f4c9edfa0",
  measurementId: "G-1GF2LQVK61"
};

// Google accounts that get the Super Admin screens.
// Keep this list in sync with isAdmin() in firestore.rules and storage.rules.
export const ADMIN_EMAILS = [
  "vishalsaxen@gmail.com"
];
