import { getAuth } from 'firebase-admin/auth'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import type { PreferenceSubmission } from '../../src/domain/preferences'
import type { WorkflowState } from '../../src/domain/workflow'
import type { StudentRosterEntry } from '../../src/domain/studentRoster'
import { callableOptions, coreFirestore, nativFirestore } from './firebase'
import { actorFromRequest, inputRecord, requiredString } from './request'
import { studentAssignmentProfiles } from './workflowCallables'
import { organizationCollectionPath, workflowDocumentPath } from '../../server/firestore/paths'

export const getStudentRoster = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request, 'read')
  if (!actor.capabilities.includes('nativ.assignment.manage')) throw new HttpsError('permission-denied', 'רשימת הבחירות זמינה לרכזי השיבוץ בלבד')
  const cycleId = requiredString(inputRecord(request.data), 'cycleId')
  const base = `organizations/${actor.organizationId}`
  let ids: string[] = []
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    let pageToken: string | undefined
    do {
      const page = await getAuth().listUsers(1000, pageToken)
      ids.push(...page.users.filter((user) => user.customClaims?.organizationId === actor.organizationId && user.customClaims?.active !== false && user.customClaims?.roles?.includes('student')).map((user) => user.uid))
      pageToken = page.pageToken
    } while (pageToken)
  } else {
    const members = await coreFirestore.collection(`${base}/members`).where('role', '==', 'student').get()
    ids = members.docs.filter((entry) => entry.data().active === true).map((entry) => entry.id)
  }
  const [profiles, submissionsSnapshot, workflowSnapshot] = await Promise.all([
    studentAssignmentProfiles(actor.organizationId, ids),
    nativFirestore.collection(organizationCollectionPath(actor.organizationId, 'submissions')).where('cycleId', '==', cycleId).get(),
    nativFirestore.doc(workflowDocumentPath(actor.organizationId, cycleId)).get(),
  ])
  const submissions = submissionsSnapshot.docs.map((entry) => entry.data() as PreferenceSubmission).filter((entry) => entry.status === 'submitted')
  const workflow = workflowSnapshot.data() as WorkflowState | undefined
  const latest = new Map<string, PreferenceSubmission>()
  for (const submission of submissions) {
    if (submission.submissionVersion > (latest.get(submission.studentId)?.submissionVersion ?? -1)) latest.set(submission.studentId, submission)
  }
  const byStudent = new Map<string, StudentRosterEntry['assignments']>()
  for (const entry of workflow?.assignmentRun?.assignments ?? []) {
    const list = byStudent.get(entry.studentId) ?? []
    list.push({ clusterId: entry.clusterId, courseId: entry.courseId })
    byStudent.set(entry.studentId, list)
  }
  const students: StudentRosterEntry[] = ids.map((id) => {
    const profile = profiles.get(id)
    const submission = latest.get(id)
    const assignments = byStudent.get(id) ?? []
    return { id, name: profile?.displayLabel ?? 'תלמיד', classId: profile?.classId ?? '', classLabel: profile?.classLabel ?? 'ללא כיתת־אם',
      status: assignments.length ? 'assigned' : submission ? 'submitted' : 'not_submitted',
      choiceSource: submission?.source,
      choices: submission?.preferences.flatMap((entry) => entry.rankings.map((ranking) => ({ clusterId: entry.clusterId, ...ranking }))) ?? [], assignments }
  })
  return students.sort((a, b) => a.classLabel.localeCompare(b.classLabel, 'he') || a.name.localeCompare(b.name, 'he'))
})
