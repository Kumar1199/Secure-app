// src/main/speechService.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../../config/config');

const TMP_DIR = path.join(__dirname, '..', '..', config.VOICE_TMP_DIR || 'tmp');
if (!fs.existsSync(TMP_DIR)) {
  try {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  } catch (err) {
    console.error('SPEECH SERVICE: Failed to create temp directory:', err.message);
  }
}

let whisperPipeline = null;
let isWhisperInitializing = false;

async function initWhisper() {
  if (whisperPipeline) return whisperPipeline;
  if (isWhisperInitializing) {
    while (isWhisperInitializing) {
      await new Promise(r => setTimeout(r, 100));
      if (whisperPipeline) return whisperPipeline;
    }
  }

  isWhisperInitializing = true;
  console.log('SPEECH SERVICE: Initializing Whisper pipeline...');
  
  try {
    let transformers;
    try {
      transformers = await import('@xenova/transformers');
    } catch (err) {
      throw new Error(`Unable to load @xenova/transformers. Ensure it is installed. (${err.message})`);
    }

    const { pipeline } = transformers;
    if (typeof pipeline !== 'function') {
      throw new Error('The @xenova/transformers package did not export a pipeline function.');
    }

    const model = config.WHISPER_MODEL || 'Xenova/whisper-tiny.en';
    whisperPipeline = await pipeline('automatic-speech-recognition', model);
    console.log(`SPEECH SERVICE: Whisper pipeline (${model}) ready.`);
    return whisperPipeline;
  } catch (err) {
    console.error('SPEECH SERVICE: Whisper initialization failed:', err.message);
    throw err;
  } finally {
    isWhisperInitializing = false;
  }
}

function textToSpeech_espeak(text, lang = config.TTS_LANGUAGE || 'en') {
  return new Promise((resolve) => {
    const out = path.join(TMP_DIR, `tts_${Date.now()}.wav`);
    console.log(`SPEECH SERVICE: Starting TTS for text: "${text.substring(0, 30)}..."`);

    const args = ['-v', lang, '-w', out, text];
    const proc = spawn('espeak-ng', args, { shell: false });

    proc.on('error', (err) => {
      console.error('SPEECH SERVICE: TTS spawn error (is espeak-ng installed?):', err.message);
      resolve({ 
        success: false, 
        message: 'Local TTS engine (espeak-ng) is not available on this system. Falling back to browser TTS.' 
      });
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.warn(`SPEECH SERVICE: espeak-ng exited with code ${code}`);
        return resolve({ success: false, message: `espeak-ng failed with code ${code}` });
      }

      try {
        if (!fs.existsSync(out)) {
          throw new Error('TTS output file was not created.');
        }
        const buffer = fs.readFileSync(out);
        const base64 = buffer.toString('base64');
        
        // Clean up
        try { fs.unlinkSync(out); } catch (e) {}
        
        console.log('SPEECH SERVICE: TTS generation successful.');
        resolve({ success: true, base64 });
      } catch (err) {
        console.error('SPEECH SERVICE: TTS post-processing error:', err.message);
        resolve({ success: false, message: 'TTS processing failed: ' + err.message });
      }
    });
  });
}

async function speechToText_whisper(base64, mimeType = 'audio/webm') {
  let ext = '.webm';
  if (mimeType.includes('wav')) ext = '.wav';
  else if (mimeType.includes('ogg')) ext = '.ogg';
  else if (mimeType.includes('mp3')) ext = '.mp3';

  const filePath = path.join(TMP_DIR, `stt_${Date.now()}${ext}`);
  console.log(`SPEECH SERVICE: Starting STT processing (mime: ${mimeType})`);

  try {
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer || buffer.length === 0) {
      return { success: false, message: 'Received empty audio data' };
    }

    fs.writeFileSync(filePath, buffer);

    const whisper = await initWhisper();
    console.log('SPEECH SERVICE: Running transcription...');
    
    const result = await whisper(filePath);
    const text = (typeof result === 'object' && result.text) ? result.text : String(result || '');

    if (!text.trim()) {
      return { success: false, message: 'No speech detected in audio' };
    }

    console.log(`SPEECH SERVICE: Transcription complete: "${text.trim().substring(0, 50)}..."`);
    return { success: true, text: text.trim() };
  } catch (err) {
    console.error('SPEECH SERVICE: STT error:', err.message);
    return { 
      success: false, 
      message: 'Transcription failed: ' + (err.message || 'Unknown error')
    };
  } finally {
    try { 
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {}
  }
}

module.exports = {
  textToSpeech_espeak,
  speechToText_whisper
};
