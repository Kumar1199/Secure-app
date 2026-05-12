// src/main/speechService.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../../config/config');

const TMP_DIR = path.join(__dirname, '..', '..', config.VOICE_TMP_DIR || 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

let whisperPipeline = null;
async function initWhisper() {
  if (whisperPipeline) return whisperPipeline;

  let transformers;
  try {
    transformers = await import('@xenova/transformers');
  } catch (err) {
    throw new Error(`Unable to load @xenova/transformers: ${err.message}`);
  }

  const { pipeline } = transformers;
  if (typeof pipeline !== 'function') {
    throw new Error('The @xenova/transformers package did not export a pipeline function.');
  }

  whisperPipeline = await pipeline('automatic-speech-recognition', config.WHISPER_MODEL || 'Xenova/whisper-tiny.en');
  return whisperPipeline;
}

function textToSpeech_espeak(text, lang = config.TTS_LANGUAGE || 'en') {
  return new Promise((resolve, reject) => {
    const out = path.join(TMP_DIR, `tts_${Date.now()}.wav`);
    const args = ['-v', lang, '-w', out, text];
    const proc = spawn('espeak-ng', args, { shell: false });

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error('espeak-ng failed with code=' + code));
      }
      try {
        const buffer = fs.readFileSync(out);
        const base64 = buffer.toString('base64');
        fs.unlinkSync(out);
        resolve({ success: true, base64 });
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function speechToText_whisper(base64, mimeType = 'audio/webm') {
  const ext = mimeType.includes('wav') ? '.wav' : mimeType.includes('ogg') ? '.ogg' : '.webm';
  const filePath = path.join(TMP_DIR, `stt_${Date.now()}${ext}`);
  const buffer = Buffer.from(base64, 'base64');
  fs.writeFileSync(filePath, buffer);

  try {
    const whisper = await initWhisper();
    const result = await whisper(filePath);
    if (result && typeof result === 'object' && result.text) {
      return { success: true, text: result.text };
    }
    return { success: true, text: String(result || '') };
  } catch (err) {
    return { success: false, message: err.message || 'Whisper transcribe failed' };
  } finally {
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
}

module.exports = {
  textToSpeech_espeak,
  speechToText_whisper
};
