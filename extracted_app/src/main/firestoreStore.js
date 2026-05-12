// src/main/firestoreStore.js
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, collection, doc, getDoc, getDocs, query, where, setDoc, addDoc } = require('firebase/firestore');
const config = require('../../config/config');

let db = null;
function init() {
  if (db) return db;
  const apps = getApps();
  if (!apps.length) {
    initializeApp(config.FIREBASE);
  }
  db = getFirestore();
  return db;
}

async function getInviteByCode(code) {
  init();
  const col = collection(db, config.COLLECTIONS.examInvites);
  const q = query(col, where('examCode', '==', code));
  const snap = await getDocs(q);
  if (!snap.empty) {
    const docSnap = snap.docs[0];
    return { id: docSnap.id, ...docSnap.data() };
  }
  // also try document id fallback
  const docRef = doc(db, config.COLLECTIONS.examInvites, code);
  const ds = await getDoc(docRef);
  if (ds.exists()) return { id: ds.id, ...ds.data() };
  return null;
}

async function getStudentByRoll(rollNo) {
  init();
  const ref = doc(db, config.COLLECTIONS.students, rollNo);
  const snap = await getDoc(ref);
  if (snap.exists()) return { id: snap.id, ...snap.data() };
  // fallback: search by rollNo field
  const col = collection(db, config.COLLECTIONS.students);
  const q = query(col, where('rollNo', '==', rollNo));
  const snap2 = await getDocs(q);
  if (!snap2.empty) return { id: snap2.docs[0].id, ...snap2.docs[0].data() };
  return null;
}

async function getExamById(examId) {
  init();
  const ref = doc(db, config.COLLECTIONS.exams, examId);
  const snap = await getDoc(ref);
  if (snap.exists()) return { id: snap.id, ...snap.data() };
  return null;
}

async function getGeneratedQuestions(examId) {
  init();
  const ref = doc(db, config.COLLECTIONS.generatedQuestions, examId);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  return null;
}

async function saveGeneratedQuestions(examId, payload) {
  init();
  const ref = doc(db, config.COLLECTIONS.generatedQuestions, examId);
  await setDoc(ref, { examId, payload, createdAt: new Date().toISOString() });
  return true;
}

async function saveSubmission(payload) {
  init();
  const col = collection(db, config.COLLECTIONS.submissions);
  const res = await addDoc(col, { ...payload, createdAt: new Date().toISOString() });
  return { id: res.id };
}

async function checkExamSubmission(studentId, examId) {
  init();
  if (!studentId || !examId) return null;
  const col = collection(db, config.COLLECTIONS.submissions);
  const q = query(col, where('studentId', '==', studentId), where('examId', '==', examId));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  return snapshot.docs[0].data();
}

module.exports = {
  getInviteByCode,
  getStudentByRoll,
  getExamById,
  getGeneratedQuestions,
  saveGeneratedQuestions,
  saveSubmission,
  checkExamSubmission
};
