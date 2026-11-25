const { SecurityPolicyEngine, Action, Severity } = require('./securityEventEngine');

// Compatibility facade: renderer and IPC retain their existing simple observation contract.
class ProctorPolicy {
  constructor({ now = Date.now, confirmationMs = 800, repeatMs = 7000, policies } = {}) {
    this.now = now; this.cameraState = 'starting'; this.lastSample = null; this.noFaceSince = null; this.headWarnings = 0; this.eyeWarnings = 0; this.legacyEvents = [];
    this.pendingMovement = null;
    this.movementStates = new Map();
    this.engine = new SecurityPolicyEngine({ now, policies: { PHONE_DETECTED: { cooldownMs: repeatMs }, MULTIPLE_FACES: { cooldownMs: repeatMs }, FACE_MISSING: { persistenceMs: confirmationMs, cooldownMs: repeatMs }, ...(policies || {}) } });
  }
  get strikes() { return this.engine.snapshot().groupCounts.major_presence || 0; }
  get terminated() { return this.engine.terminated; }
  get events() { return [...this.engine.events, ...this.legacyEvents]; }
  record(type, details = {}) { return this.engine.log(type, details, details.advisory ? Severity.LOW : Severity.INFO); }
  securityEvent(type, metadata = {}) { const result = this.engine.ingest({ type, active: true, confidence: 1, metadata, source: 'electron-main' }); return { ...result, action: result.action === Action.AUTO_SUBMIT ? 'submit' : result.action === Action.WARNING ? 'warning' : result.action === Action.ADVISORY ? 'advisory' : result.action }; }
  dispatch(type, active, confidence, metadata) { return this.engine.ingest({ type, active, confidence, metadata, source: 'camera' }); }
  movement(type, direction, confidence) {
    const state = this.movementStates.get(type) || { latched: false, neutral: 0 };
    this.movementStates.set(type, state);
    if (direction === 'forward') {
      if (++state.neutral >= 2) state.latched = false;
    } else {
      state.neutral = 0;
    }
    const active = !state.latched && ['left', 'right'].includes(direction);
    const result = this.dispatch(type, active, confidence, { direction });
    if (!result.event) return null;
    state.latched = true;
    if (type === 'HEAD_ROTATION') this.headWarnings++;
    else this.eyeWarnings++;
    return result.event;
  }
  observe(sample) {
    if (this.terminated) return { ...this.snapshot(), action: 'submit' };
    const now = this.now(), live = sample.cameraState === 'live' && sample.detectorReady === true;
    if (this.cameraState !== (live ? 'live' : 'unavailable')) { this.cameraState = live ? 'live' : 'unavailable'; this.record(live ? 'CAMERA_RESTORED' : 'CAMERA_DISCONNECTED'); }
    if (!live) {
      for (const type of ['PHONE_DETECTED', 'MULTIPLE_FACES', 'FACE_MISSING', 'HEAD_ROTATION', 'GAZE_DEVIATION']) this.dispatch(type, false, 0, {});
      this.noFaceSince = null;
      this.dispatch('CAMERA_DISCONNECTED', true, 1, { cameraState: sample.cameraState });
      return { ...this.snapshot(), cameraBlocked: true };
    }
    this.dispatch('CAMERA_DISCONNECTED', false, 0, {});
    if (!Number.isInteger(sample.faceCount) || sample.faceCount < 0 || sample.faceCount > 10 || !Number.isFinite(sample.phoneConfidence) || sample.phoneConfidence < 0 || sample.phoneConfidence > 1) throw new Error('Invalid camera observation.');
    if (this.lastSample !== null && now - this.lastSample < 250) return this.snapshot(); this.lastSample = now;
    const reasons = []; if (sample.faceCount === 0) reasons.push('no_face'); if (sample.faceCount >= 2) reasons.push('multiple_faces'); if (sample.phoneConfidence >= .32) reasons.push('phone_detected');
    const majorType = sample.phoneConfidence >= .32 ? 'PHONE_DETECTED' : sample.faceCount >= 2 ? 'MULTIPLE_FACES' : sample.faceCount === 0 ? 'FACE_MISSING' : null;
    let result = { action: Action.IGNORE, event: null };
    for (const type of ['FACE_MISSING','MULTIPLE_FACES','PHONE_DETECTED']) {
      const active = type === majorType;
      const confidence = type === 'PHONE_DETECTED' ? sample.phoneConfidence : active ? .95 : 0;
      const current = this.dispatch(type, active, confidence, { faceCount: sample.faceCount, phoneConfidence: Number(sample.phoneConfidence.toFixed(3)), reasons, faceState: sample.faceCount === 0 ? 'FACE_MISSING' : sample.faceCount >= 2 ? 'MULTIPLE_FACES' : 'FACE_PRESENT' });
      if (current.event) result = current;
    }
    const movementEvents = [];
    if (!this.terminated) {
      // A phone or face incident owns its frame. Keep any previously earned half-pair.
      const head = this.movement('HEAD_ROTATION', majorType ? 'unknown' : sample.headDirection, .85);
      const gaze = this.movement('GAZE_DEVIATION', majorType ? 'unknown' : sample.eyeDirection, .8);
      for (const movement of [head, gaze].filter(Boolean)) {
        movementEvents.push(movement);
        const pendingIsCurrent = this.pendingMovement && this.now() - this.pendingMovement.timestamp <= 15000;
        if (pendingIsCurrent) {
          reasons.push('movement_pair');
          result = this.dispatch('MOVEMENT_PAIR', true, 1, { movements: [this.pendingMovement.type, movement.type], reasons });
          this.pendingMovement = null;
        } else {
          this.pendingMovement = { type: movement.type, timestamp: this.now() };
        }
      }
    }
    const light = this.dispatch('CAMERA_LOW_QUALITY', Number.isFinite(sample.brightness) && sample.brightness < 18, .9, { brightness: sample.brightness }); if (light.action === Action.ADVISORY && result.action === Action.IGNORE) result = light;
    const black = this.dispatch('CAMERA_BLACK_FRAME', Number.isFinite(sample.brightness) && sample.brightness < 5, .95, { brightness: sample.brightness }); if (black.event && !result.event) result = black;
    const stale = this.dispatch('CAMERA_STALE_FRAME', Number.isFinite(sample.frameAgeMs) && sample.frameAgeMs > 5000, .95, { frameAgeMs: sample.frameAgeMs }); if (stale.event && !result.event) result = stale;
    const occluded = this.dispatch('FACE_OCCLUDED', sample.faceCount === 1 && Number(sample.faceOcclusionConfidence) >= .75, Number(sample.faceOcclusionConfidence) || 0, { occlusionConfidence: sample.faceOcclusionConfidence }); if (occluded.action === Action.ADVISORY && result.action === Action.IGNORE) result = occluded;
    if (sample.faceCount === 0) { if (this.noFaceSince === null) this.noFaceSince = now; } else this.noFaceSince = null;
    const action = result.action === Action.AUTO_SUBMIT ? 'submit' : result.action === Action.WARNING ? 'warning' : result.action === Action.ADVISORY ? 'advisory' : null;
    const reason = { PHONE_DETECTED: 'phone_detected', MULTIPLE_FACES: 'multiple_faces', FACE_MISSING: 'no_face', MOVEMENT_PAIR: 'movement_pair' }[result.event?.type];
    const event = result.event ? { timestamp: result.event.timestamp, type: reason ? 'confirmed_incident' : result.event.type.toLowerCase(), reasons: reason ? reasons : [], strike: this.strikes, faceCount: sample.faceCount, phoneConfidence: Number(sample.phoneConfidence.toFixed(3)), action: action === 'submit' ? 'auto_submit' : action, securityEvent: result.event } : null;
    if (event?.type === 'confirmed_incident') this.legacyEvents.push(event);
    return { ...this.snapshot(), action, event, movementEvents, cameraBlocked: this.noFaceSince !== null && now - this.noFaceSince >= 8000 };
  }
  snapshot() { const state = this.engine.snapshot(); return { strikes: this.strikes, warningLimit: 2, headWarnings: this.headWarnings, eyeWarnings: this.eyeWarnings, pendingMovement: Boolean(this.pendingMovement && this.now() - this.pendingMovement.timestamp <= 15000), movementWarnings: Math.floor((this.headWarnings + this.eyeWarnings) / 2), riskScore: state.riskScore, terminated: state.terminated }; }
  report() { return { ...this.snapshot(), policyVersion: 4, events: this.legacyEvents, securityEvents: this.events, notes: 'Normalized automated observations require human review. No continuous video is recorded.' }; }
}
module.exports = { ProctorPolicy };
