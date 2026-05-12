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
  // Determine file extension based on mimeType
  let ext = '.webm';
  if (mimeType.includes('wav')) ext = '.wav';
  else if (mimeType.includes('ogg')) ext = '.ogg';
  else if (mimeType.includes('mp3')) ext = '.mp3';
  else if (mimeType.includes('mpeg')) ext = '.mp3';

  const filePath = path.join(TMP_DIR, `stt_${Date.now()}${ext}`);

  try {
    // Decode base64 and write to file
    const buffer = Buffer.from(base64, 'base64');
    
    // Validate buffer is not empty
    if (!buffer || buffer.length === 0) {
      return { success: false, message: 'Received empty audio data' };
    }

    fs.writeFileSync(filePath, buffer);

    // Verify file was written
    if (!fs.existsSync(filePath)) {
      return { success: false, message: 'Failed to write audio file to disk' };
    }

    // Initialize and use Whisper
    const whisper = await initWhisper();
    
    // Call transcription with error handling
    let result;
    try {
      result = await whisper(filePath);
    } catch (transcribeErr) {
      // If Whisper fails, try to provide detailed error info
      console.error('Whisper transcription error:', transcribeErr);
      return { 
        success: false, 
        message: `Transcription failed: ${transcribeErr.message || 'Unknown error in Whisper pipeline'}` 
      };
    }

    // Process result
    if (result && typeof result === 'object' && result.text) {
      return { success: true, text: result.text.trim() };
    }

    const resultText = String(result || '').trim();
    if (!resultText) {
      return { success: false, message: 'Whisper returned empty transcription' };
    }

    return { success: true, text: resultText };
  } catch (err) {
    console.error('speechToText_whisper error:', err);
    return { 
      success: false, 
      message: err.message || 'Speech-to-text transcription failed' 
    };
  } finally {
    // Clean up temp file
    try { 
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      console.warn('Failed to delete temp audio file:', e.message);
    }
  }
}

module.exports = {
  textToSpeech_espeak,
  speechToText_whisper
};
