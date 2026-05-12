const api = require('./src/main/apiHandler');

(async () => {
  try {
    console.log('TEST: validatePin 123456');
    const r = await api.validatePin('123456');
    console.log(JSON.stringify(r, null, 2));

    console.log('\nTEST: runCode mock python');
    const s = await api.runCode({ code: 'print("hello")', language: 'python', stdin: '' });
    console.log(JSON.stringify(s, null, 2));
  } catch (e) {
    console.error('SMOKE_ERR', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
