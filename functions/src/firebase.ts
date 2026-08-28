import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

export const adminApp = getApps()[0] ?? initializeApp()

// The emulator supports the default database only in the local test suite. In
// production Nativ owns a named database while EdTrack remains the authority
// for organizations, memberships and product subscriptions.
export const coreFirestore = getFirestore(adminApp)
export const nativFirestore = process.env.FUNCTIONS_EMULATOR === 'true'
  ? coreFirestore
  : getFirestore(adminApp, 'nativ')

export const callableOptions = {
  region: 'europe-west1' as const,
  enforceAppCheck: process.env.NATIV_ENFORCE_APP_CHECK === 'true',
}
