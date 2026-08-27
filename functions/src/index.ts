import { initializeApp } from 'firebase-admin/app'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

initializeApp()

export const getPreparationStatus = onCall({ region: 'europe-west1' }, (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'נדרשת כניסה למערכת')
  }
  return {
    status: 'preparation',
    liveDataConnected: false,
    edTrackDirectoryConnected: false,
    geminiConnected: false,
  }
})
