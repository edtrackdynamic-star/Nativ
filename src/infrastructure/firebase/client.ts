import { getApp, getApps, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'

const localHost = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
const emulatorMode = localHost || import.meta.env.DEV || import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || (emulatorMode ? 'demo-nativ-local' : '')
const apiKey = import.meta.env.VITE_FIREBASE_API_KEY || (emulatorMode ? 'demo-api-key' : '')

export const firebaseConfigured = Boolean(projectId && apiKey)

const app = firebaseConfigured
  ? (getApps().length ? getApp() : initializeApp({ projectId, apiKey, authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`, appId: import.meta.env.VITE_FIREBASE_APP_ID || 'demo-nativ-local-app' }))
  : null

export const nativAuth = app ? getAuth(app) : null
export const nativFunctions = app ? getFunctions(app, 'europe-west1') : null

const connectionFlag = '__nativFirebaseEmulatorsConnected'
const globalState = globalThis as typeof globalThis & { [connectionFlag]?: boolean }
if (emulatorMode && nativAuth && nativFunctions && !globalState[connectionFlag]) {
  connectAuthEmulator(nativAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFunctionsEmulator(nativFunctions, '127.0.0.1', 5001)
  globalState[connectionFlag] = true
}
