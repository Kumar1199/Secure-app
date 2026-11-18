// Copy this file to config/config.js and supply only your local credentials.
module.exports = {
  GEMINI_API_KEY: '',
  GEMINI_MODEL: 'gemini-2.5-flash',
  TTS_LANGUAGE: 'en',
  WHISPER_MODEL: 'Xenova/whisper-tiny.en',
  VOICE_TMP_DIR: 'tmp',
  WEB_APP_BASE_URL: process.env.STUDENT360_API_BASE_URL || 'http://127.0.0.1:5173/api/proxy',
  COMPILERS: { python: '', c: '' },
  JUDGE0_API_KEY: '',
  JUDGE0_HOST: '',
  JUDGE0_URL: '',
  POWERAUTOMATE: {
    VALIDATE_PIN: '', FETCH_EXAM: '', SUBMIT_MCQ: '', SUBMIT_CODE: '', SUBMIT_INTERVIEW: '', EXAM_SCHEDULE: ''
  },
  CACHE_GENERATED_QUESTIONS: true,
  COLLECTIONS: { examInvites: 'examInvites', students: 'students', exams: 'exams', generatedQuestions: 'generated_questions', submissions: 'exam_submissions' },
  LANGUAGE_IDS: { c: 50, cpp: 54, java: 62, python: 71 }
};
