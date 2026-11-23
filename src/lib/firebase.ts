import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

/**
 * Firebase (server-side) backend for Cricket Live Schedule & Watch.
 *
 * Admin auth and admin data live in Firebase Auth + Firestore, NOT in
 * browser localStorage. Clearing browser data therefore never resets the
 * admin account: the admin record lives in Firestore (admin/config) and the
 * password is verified by Firebase Auth on the server.
 *
 * The values below are the public client configuration for the Firebase
 * project (they are safe to ship in the client bundle; security is enforced
 * by Firestore security rules, not by hiding these keys). They can be
 * overridden with VITE_FIREBASE_* environment variables in Vercel.
 */

export const ADMIN_EMAIL = 'biswajitcopy3@gmail.com';

/** Secret admin URL path (28 random characters). The Admin Panel lives ONLY
 *  here; it is not linked from any public page. /admin returns a 404. */
export const SECRET_ADMIN_PATH = '/zX5Cii7E1kn9WHkAwytGqDhQYB6r';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCW_CWPL7LQFsBM1NgHfs3kuJRpaEm-Sxc',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'crypto-tranquility-jf6jr.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'crypto-tranquility-jf6jr',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'crypto-tranquility-jf6jr.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '504021111951',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:504021111951:web:9992abfb58867da32c0cfa',
};

/** Named Firestore database created for this app (see firebase-applet-config.json). */
export const FIRESTORE_DATABASE_ID =
  import.meta.env.VITE_FIREBASE_DATABASE_ID || 'ai-studio-30b42b8b-4b83-4f1f-9a76-fdb72f4fc7a5';

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!app) {
    app = initializeApp(firebaseConfig);
  }
  return app;
}

export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    authInstance = getAuth(getFirebaseApp());
  }
  return authInstance;
}

export function getFirestoreDb(): Firestore {
  if (!dbInstance) {
    dbInstance = getFirestore(getFirebaseApp(), FIRESTORE_DATABASE_ID);
  }
  return dbInstance;
}
