(function () {
  let controller;
  class CameraProctor {
    constructor(options) {
      this.options = options; this.monitoring = false; this.busy = false; this.forced = false; this.finished = false;
      this.lastFrame = -1; this.lastHealthy = Date.now(); this.validFrames = 0;
      this.ui();
    }
    ui() {
      const style = document.createElement('style');
      style.textContent = '#s360-camera{position:fixed;right:18px;bottom:18px;width:185px;background:#111827;color:white;border:1px solid #475569;border-radius:12px;padding:10px;z-index:900}#s360-camera video{width:100%;border-radius:8px;transform:scaleX(-1)}#s360-gate{position:fixed;inset:0;background:rgba(5,10,20,.96);color:white;z-index:100000;display:flex;align-items:center;justify-content:center;font:16px system-ui}#s360-gate[hidden],#s360-warning[hidden]{display:none}#s360-gate section{max-width:600px;padding:30px;border:1px solid #64748b;border-radius:15px}#s360-gate button{padding:12px 18px;margin-top:16px;background:#2563eb;color:white;border:0;border-radius:8px;cursor:pointer}#s360-gate button:disabled{opacity:.5}#s360-warning{position:fixed;top:12px;left:50%;transform:translateX(-50%);max-width:650px;background:#7c2d12;color:white;padding:16px 24px;border:2px solid #fb923c;border-radius:10px;z-index:99999;font:16px system-ui}#s360-badge{position:fixed;right:18px;top:65px;background:#111827;color:white;border:1px solid #64748b;padding:8px 12px;border-radius:8px;z-index:950;font:13px system-ui}';
      document.head.appendChild(style);
      const positionStyle=document.createElement('style');positionStyle.textContent='#s360-badge{top:auto!important;bottom:230px!important;pointer-events:none}';document.head.appendChild(positionStyle);
      const evidenceStyle=document.createElement('style');evidenceStyle.textContent='#s360-gate section{max-height:90vh;overflow:auto}.s360-evidence{margin:12px auto;max-width:100%;color:#fff}.s360-evidence-image{position:relative;max-width:100%;margin:auto}.s360-evidence-image img{display:block;width:100%;height:auto;border-radius:8px}.s360-evidence-image svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.s360-evidence figcaption{font-size:12px;margin-top:7px;line-height:1.5}#s360-warning{max-height:80vh;overflow:auto}';document.head.appendChild(evidenceStyle);
      this.video = document.getElementById('camFeed');
      if (!this.video) {
        const panel = document.createElement('details'); panel.id = 's360-camera'; panel.open = true;
        panel.innerHTML = '<summary>Exam camera</summary><video autoplay muted playsinline></video>';
        document.body.appendChild(panel); this.video = panel.querySelector('video');
      }
      this.gate = document.createElement('div'); this.gate.id = 's360-gate'; this.gate.setAttribute('role', 'dialog'); this.gate.setAttribute('aria-modal', 'true');
      this.gate.innerHTML = '<section><h2>Camera check and exam rules</h2><p id="s360-status" role="status">Keep exactly one face visible and keep mobile phones away. Phone detection, no face, or more than one face each receive two confirmed warnings. The third incident submits your exam, then shows the incident image for two minutes before closing.</p><p id="s360-image-disclosure">Frames are analysed on this computer. A snapshot of each confirmed phone, no-face, or multiple-face incident is shown to you and saved with your answers for administrator review (up to three images). No continuous video is recorded. Head turns, lighting and camera interruptions are logged as observations.</p><label id="s360-consent"><input type="checkbox" id="s360-consent-box"> I understand the camera, incident-image and automatic submission policy.</label><br><button id="s360-camera-button" disabled>Enable camera and check</button></section>';
      document.body.appendChild(this.gate); this.status = this.gate.querySelector('#s360-status'); this.button = this.gate.querySelector('button');
      this.gate.querySelector('input').addEventListener('change', event => { this.button.disabled = !event.target.checked; });
      this.warning = document.createElement('div'); this.warning.id = 's360-warning'; this.warning.hidden = true; this.warning.setAttribute('role','alert'); document.body.appendChild(this.warning);
      this.badge = document.createElement('div'); this.badge.id = 's360-badge'; this.badge.textContent = 'Warnings: 0/2'; document.body.appendChild(this.badge);
      this.keyGuard = event => { if (!this.gate.hidden && !this.gate.contains(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); } };
      document.addEventListener('keydown', this.keyGuard, true);
    }
    async start() {
      this.pin = await window.examAPI.getSession('pin');
      const state = await window.examAPI.proctorState();
      if (state.terminated) { this.force(); return; }
      this.unsubscribe = window.examAPI.onProctorSubmitted(result => this.result(result));
      this.focus = () => { if (this.monitoring) window.examAPI.proctorFocus(document.hasFocus()); };
      window.addEventListener('blur', this.focus); window.addEventListener('focus', this.focus);
      const started = new Promise(resolve => { this.ready = resolve; });
      this.button.onclick = () => this.prepare();
      this.health = setInterval(() => {
        if (this.forced || this.preparing || !this.stream) return;
        const track = this.stream.getVideoTracks()[0];
        if (track?.readyState !== 'live' || track.muted || Date.now() - this.lastHealthy > 8000) this.unavailable('Camera or detector stopped. Restore the camera, then retry.');
      }, 1000);
      return started;
    }
    async prepare() {
      if (this.preparing || this.forced) return;
      this.preparing = true; this.button.disabled = true; this.status.textContent = 'Loading local detectors and requesting camera permission…';
      this.release(); this.validFrames = 0; this.lastFrame = -1;
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15, max: 20 } }, audio: false });
        this.video.srcObject = this.stream; await this.video.play(); this.lastHealthy = Date.now();
        this.worker = new Worker('../scripts/proctor-worker.js');
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Local detectors did not start.')), 45000);
          this.worker.onerror = () => { clearTimeout(timeout); reject(new Error('Local camera detector could not load.')); };
          this.worker.onmessage = event => { if (event.data.type === 'ready') { clearTimeout(timeout); resolve(); } else if (event.data.type === 'error') { clearTimeout(timeout); reject(new Error('Local model initialization failed.')); } };
          this.worker.postMessage({ type: 'init' });
        });
        this.worker.onmessage = event => {
          this.busy = false;
          if (event.data.type === 'sample') this.sample(event.data).catch(() => this.unavailable('Camera policy connection failed. Retry the camera check.'));
          else this.unavailable('Camera detector failed. Retry the camera check.');
        };
        this.worker.onerror = () => this.unavailable('Camera detector stopped. Retry the camera check.');
        this.status.textContent = 'Keep exactly one face visible and remove phones. Checking the camera…';
        this.button.hidden = true; this.gate.querySelector('#s360-consent').hidden = true;
        this.capture();
      } catch (error) {
        this.release(); this.gate.hidden = false; this.status.textContent = 'Camera check failed. Allow camera access in Windows Settings, close other camera apps, and retry. ' + error.message;
        this.button.hidden = false; this.button.disabled = false; this.button.textContent = 'Retry camera check';
      } finally { this.preparing = false; }
    }
    async capture() {
      if (!this.worker || this.forced || this.stopped || this.busy) return;
      try {
        if (this.video.readyState < 2 || this.video.currentTime === this.lastFrame) { this.next = setTimeout(() => this.capture(), 900); return; }
        this.lastFrame = this.video.currentTime; this.busy = true;
        const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(this.video, 0, 0, 64, 48);
        const pixels = ctx.getImageData(0,0,64,48).data; let brightness = 0;
        for (let i = 0; i < pixels.length; i += 4) brightness += (pixels[i] + pixels[i+1] + pixels[i+2]) / 3;
        this.brightness = brightness / (64*48);
        // Preserve enough detail for a phone that is only partly in frame.
        const scale=Math.min(1,960/this.video.videoWidth,720/this.video.videoHeight);
        const frame=document.createElement('canvas');frame.width=Math.max(1,Math.round(this.video.videoWidth*scale));frame.height=Math.max(1,Math.round(this.video.videoHeight*scale));
        frame.getContext('2d').drawImage(this.video,0,0,frame.width,frame.height);
        this.frameCanvas=frame;this.frameCapturedAt=new Date().toISOString();
        const bitmap = await createImageBitmap(frame);
        if (!this.worker || this.forced) { bitmap.close(); return; }
        this.worker.postMessage({ type: 'frame', bitmap, timestamp: performance.now() }, [bitmap]);
      } catch { this.busy = false; this.unavailable('Camera frames are unavailable. Retry the camera check.'); }
    }
    async sample(sample) {
      const detectedFrame=this.frameCanvas,capturedAt=this.frameCapturedAt;
      this.lastHealthy = Date.now();
      if (!this.monitoring) {
        this.validFrames = sample.faceCount === 1 && sample.phoneConfidence < 0.32 ? this.validFrames + 1 : 0;
        if (this.validFrames < 3) { this.status.textContent = 'Camera check: keep exactly one face in view and remove any phone.'; this.next = setTimeout(() => this.capture(),450); return; }
        this.monitoring = true; this.gate.hidden = true; this.ready?.(); this.ready = null;
      }
      const payload = await this.options.getPayload();
      await window.examAPI.proctorDraft(this.options.type, { ...payload, pin: this.pin });
      let evidence;
      if((sample.faceCount===0 || sample.faceCount>=2 || sample.phoneConfidence>=0.32) && detectedFrame){
        // Detection uses the high-resolution frame; evidence is independently
        // constrained to the IPC validator's 640×480 JPEG limit.
        const scale=Math.min(1,640/detectedFrame.width,480/detectedFrame.height);
        const evidenceCanvas=document.createElement('canvas');
        evidenceCanvas.width=Math.max(1,Math.round(detectedFrame.width*scale));
        evidenceCanvas.height=Math.max(1,Math.round(detectedFrame.height*scale));
        evidenceCanvas.getContext('2d').drawImage(detectedFrame,0,0,evidenceCanvas.width,evidenceCanvas.height);
        let image=evidenceCanvas.toDataURL('image/jpeg',0.62);
        if(image.length>180000)image=evidenceCanvas.toDataURL('image/jpeg',0.42);
        if(image.length<=180000)evidence={image,width:evidenceCanvas.width,height:evidenceCanvas.height,capturedAt,regions:sample.regions||[]};
      }
      const result = await window.examAPI.proctorObserve({ ...sample, evidence, cameraState: 'live', detectorReady: true, brightness: this.brightness });
      if (result.inactive) { this.stop(); return; }
      this.badge.textContent = `Warnings: ${Math.min(result.strikes, 2)}/2 · Soft: head ${result.headWarnings||0}, eyes ${result.eyeWarnings||0} · Review ${result.softReviewCount||0}`;
      // Immediate UI notice for one qualified phone frame. It is an alert and
      // evidence signal, not an independent automated academic decision.
      if (sample.phoneConfidence >= 0.32 && !result.action) this.showWarning('Camera alert: a possible mobile phone was detected. Remove it from view.');
      if (result.action === 'submit') { this.force(result.event, result.reviewUntil); return; }
      if (result.action === 'warning') {
        this.showWarning(`Warning ${result.strikes} of 2`);
      }
      if (result.action === 'advisory') {
        const gaze = result.event?.type === 'gaze_deviation';
        this.showWarning(gaze ? `Eyes appear focused away from the screen. Please return your attention to the examination. Soft observations: ${result.headWarnings||0} head, ${result.eyeWarnings||0} eyes.` : `Unusual head rotation detected. Keep your face directed towards the screen. Soft observations: ${result.headWarnings||0} head, ${result.eyeWarnings||0} eyes.`);
      }
      if (result.cameraBlocked) { this.gate.hidden = false; this.status.textContent = 'Your face is not visible. Return to the camera to continue. The exam timer continues.'; this.button.hidden = true; }
      else this.gate.hidden = true;
      this.options.onSample?.(sample);
      this.next = setTimeout(() => this.capture(),450);
    }
    showWarning(message) {
      this.options.onWarning?.(message);
      this.warning.textContent = message; this.warning.hidden = false;
      clearTimeout(this.warningTimer); this.warningTimer = setTimeout(() => { this.warning.hidden = true; },10000);
    }
    addEvidence(parent,event,maxWidth=480){
      const evidence=event?.evidence;
      const figure=document.createElement('figure');figure.className='s360-evidence';
      if(evidence?.image?.startsWith('data:image/jpeg;base64,')){
        const wrap=document.createElement('div');wrap.className='s360-evidence-image';wrap.style.width=Math.min(maxWidth,evidence.width)+'px';
        const image=document.createElement('img');image.src=evidence.image;image.alt=`Incident ${event.strike} camera snapshot`;wrap.appendChild(image);
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`0 0 ${evidence.width} ${evidence.height}`);
        for(const region of evidence.regions||[]){
          const x=region.x*evidence.width,y=region.y*evidence.height;
          const rect=document.createElementNS(svg.namespaceURI,'rect');
          for(const [key,value]of Object.entries({x,y,width:region.width*evidence.width,height:region.height*evidence.height,fill:'none',stroke:region.type==='phone'?'#ffb020':'#22d3ee','stroke-width':3}))rect.setAttribute(key,value);
          svg.appendChild(rect);const label=document.createElementNS(svg.namespaceURI,'text');label.setAttribute('x',Math.max(2,x));label.setAttribute('y',Math.max(18,y-4));label.setAttribute('fill','#fff');label.setAttribute('stroke','#000');label.setAttribute('paint-order','stroke');label.setAttribute('stroke-width','3');label.setAttribute('font-size','17');label.textContent=region.type==='phone'?`Phone ${Math.round((region.score||0)*100)}%`:'Face';svg.appendChild(label);
        }
        wrap.appendChild(svg);figure.appendChild(wrap);
      }
      const caption=document.createElement('figcaption');caption.textContent=evidence?`Incident ${event.strike} · ${new Date(evidence.capturedAt).toLocaleTimeString()} · ${(event.reasons||[]).join(', ')}. Automated detection is subject to review.`:'A snapshot was unavailable for this incident. Detection details will still be saved.';figure.appendChild(caption);parent.appendChild(figure);
    }
    unavailable(message) {
      if (this.forced || this.stopped) return;
      this.gate.hidden = false; this.status.textContent = message; this.badge.textContent = 'Camera unavailable · exam input blocked';
      this.button.hidden = false; this.button.disabled = false; this.button.textContent = 'Retry camera check';
      this.release(); this.monitoring = false;
      window.examAPI.proctorObserve({ cameraState: 'unavailable', detectorReady: false }).catch(() => {});
    }
    async force(event,reviewUntil) {
      if (this.forced) return;
      this.forced = true; this.release(); clearInterval(this.health);
      this.options.onAutoSubmit?.();
      this.warning.hidden = true; this.gate.hidden = false; this.button.hidden = true;
      this.gate.querySelector('h2').textContent='Third incident: evidence review';
      this.gate.querySelector('#s360-image-disclosure').hidden=true;
      const evidenceHost=document.createElement('div');this.status.after(evidenceHost);this.addEvidence(evidenceHost,event);
      this.status.textContent='Your answers are locked. Review the detected incident image below.';
      this.reviewUntil=Math.max(Date.now(),Number(reviewUntil)||Date.now()+60000);
      const footer=document.createElement('div');footer.id='s360-close-countdown';footer.setAttribute('role','timer');footer.style.cssText='position:sticky;bottom:0;margin-top:16px;padding:14px;background:#111827;border-top:1px solid #64748b;text-align:center;color:#fff';
      const value=document.createElement('strong');value.style.display='block';value.style.fontSize='20px';footer.appendChild(value);
      const note=document.createElement('small');note.textContent='Your answers are being submitted. The evidence screen stays open for two minutes, then the app closes.';footer.appendChild(note);this.gate.querySelector('section').appendChild(footer);
      const closeNow=document.createElement('button');closeNow.type='button';closeNow.disabled=true;closeNow.textContent='Close after submission';closeNow.style.cssText='display:block;margin:14px auto 0;padding:10px 18px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer;opacity:.55';
      closeNow.addEventListener('click',async()=>{if(closeNow.disabled||this.finished)return;this.finished=true;clearTimeout(this.retry);clearInterval(this.countdown);await window.examAPI.endExam();await window.examAPI.exitApp();});footer.appendChild(closeNow);this.closeNow=closeNow;
      const countdown=()=>{const seconds=Math.max(0,Math.ceil((this.reviewUntil-Date.now())/1000));value.textContent=seconds?`Exam will close in ${seconds} seconds`:'Saving your answers before closing…';};countdown();
      this.countdown=setInterval(countdown,1000);
      this.badge.textContent = 'Automatic submission';
      await this.attemptForce();
    }
    async attemptForce() {
      if (this.finished || this.forceBusy) return;
      this.forceBusy = true;
      try { await this.result(await window.examAPI.proctorForceSubmit()); }
      catch { await this.result({ success: false }); }
      finally { this.forceBusy = false; }
    }
    async result(result) {
      if (!this.forced || this.finished) return;
      if (result?.success) {
        if(this.closeNow){this.closeNow.disabled=false;this.closeNow.textContent='Close exam now';this.closeNow.style.opacity='1';this.status.textContent='Your answers were submitted. You may close the exam now or review the evidence until the timer ends.';}
        if(this.reviewUntil>Date.now())await new Promise(resolve=>setTimeout(resolve,this.reviewUntil-Date.now()));
        if(this.finished)return;
        this.finished = true; clearTimeout(this.retry);
        this.status.textContent = 'Your exam was automatically submitted. Closing the exam session…';
        await window.examAPI.endExam(); await window.examAPI.exitApp();
      } else {
        const footer=this.gate.querySelector('#s360-close-countdown strong');if(footer)footer.textContent='Submission pending — closing after saving';
        this.status.textContent = 'Automatic submission is pending. Your answers remain locked. Keep the app open; submission will retry when the connection returns.';
        clearTimeout(this.retry); this.retry = setTimeout(() => this.attemptForce(),15000);
      }
    }
    release() {
      clearTimeout(this.next); this.worker?.terminate(); this.worker = null; this.busy = false;
      this.stream?.getTracks().forEach(track => track.stop()); this.stream = null; this.video.srcObject = null;
    }
    stop() { this.stopped = true; this.release(); clearInterval(this.health); clearInterval(this.countdown); clearTimeout(this.retry); this.unsubscribe?.(); window.removeEventListener('blur',this.focus); window.removeEventListener('focus',this.focus); document.removeEventListener('keydown',this.keyGuard,true); }
  }
  window.ExamProctor = {
    start: async options => { controller = new CameraProctor(options); return controller.start(); },
    stop: () => controller?.stop(), retry: () => controller?.prepare(),
  };
  window.addEventListener('beforeunload', () => controller?.stop());
})();
