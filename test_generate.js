const api = require('./src/main/apiHandler');

(async () => {
  try {
    console.log('GEN TEST: MCQ (2)');
    const res = await api.generateQuestions({ examType: 'MCQ', difficulty: 'easy', subject: 'Mathematics', questionCount: 2, title: 'Math Quiz', examId: 'TEST_GEN_001' });
    console.log(JSON.stringify(res, null, 2).slice(0,2000));
  } catch (e) {
    console.error('GEN_ERR', e && e.message ? e.message : e);
  }
})();
