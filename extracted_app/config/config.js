// config/config.js - PASTE YOUR KEYS HERE

module.exports = {
  // ─── Gemini API ───────────────────────────────────────────────
  GEMINI_API_KEY: "AIzaSyDoEVAtWmBv2Hq6RJNa5WejuMVZHJcjfzQ",
  GEMINI_MODEL: "gemini-2.5-flash",

  // ─── Firebase Web Config (paste from your Firebase console) ──
  FIREBASE: {
    apiKey: "AIzaSyBFACYAvfLRnTlqX4lUtMfCWnV05pEh8-s",
    authDomain: "student-360-ccb4e.firebaseapp.com",
    projectId: "student-360-ccb4e",
    storageBucket: "student-360-ccb4e.firebasestorage.app",
    messagingSenderId: "999131718001",
    appId: "1:999131718001:web:2f5806cbd70ef75e9f96d0",
    measurementId: "G-HXHW23T0FG"
  },

  // ─── Offline voice / speech config ────────────────────────────
  TTS_LANGUAGE: 'en',
  WHISPER_MODEL: 'Xenova/whisper-tiny.en',
  VOICE_TMP_DIR: 'tmp',

  // ─── Web App / Firebase API base (optional) ───────────────────
  WEB_APP_BASE_URL: "",

  // ─── Compiler endpoints (local/hosted compilers) ─────────────
  COMPILERS: {
    python: "https://python-compiler-600090606561.asia-south1.run.app",
    c: "https://c-compiler-600090606561.asia-south1.run.app"
  },

  // ─── Judge0 fallback (not used when COMPILERS provided) ───────
  JUDGE0_API_KEY: "",
  JUDGE0_HOST: "judge0-ce.p.rapidapi.com",
  JUDGE0_URL: "https://judge0-ce.p.rapidapi.com",

  // ─── Power Automate HTTP Endpoints (optional) ───────────────
  POWERAUTOMATE: {
    VALIDATE_PIN: "YOUR_POWER_AUTOMATE_VALIDATE_PIN_URL",
    FETCH_EXAM: "YOUR_POWER_AUTOMATE_FETCH_EXAM_URL",
    SUBMIT_MCQ: "YOUR_POWER_AUTOMATE_SUBMIT_MCQ_URL",
    SUBMIT_CODE: "YOUR_POWER_AUTOMATE_SUBMIT_CODE_URL",
    SUBMIT_INTERVIEW: "YOUR_POWER_AUTOMATE_SUBMIT_INTERVIEW_URL",
    EXAM_SCHEDULE: "YOUR_POWER_AUTOMATE_EXAM_SCHEDULE_URL"
  },

  // ─── Caching and collections ─────────────────────────────────
  CACHE_GENERATED_QUESTIONS: true,
  COLLECTIONS: {
    examInvites: 'examInvites',
    students: 'students',
    exams: 'exams',
    generatedQuestions: 'generated_questions',
    submissions: 'exam_submissions'
  },

  // ─── Language IDs (used for Judge0 compatibility) ─────────────
  LANGUAGE_IDS: {
    c: 50,
    cpp: 54,
    java: 62,
    python: 71
  }
};
