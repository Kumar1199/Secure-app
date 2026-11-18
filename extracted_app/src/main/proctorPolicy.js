// Counts confirmed incidents, not individual camera frames. Kept in the main process.
class ProctorPolicy {
  constructor({ now = Date.now, confirmationMs = 800, repeatMs = 12000 } = {}) {
    this.now = now; this.confirmationMs = confirmationMs; this.repeatMs = repeatMs;
    this.strikes = 0; this.events = []; this.terminated = false;
    this.candidate = null; this.lastStrike = -Infinity; this.lastSample = null;
    this.noFaceSince = null; this.headSince = null; this.headEpisode = false;
    this.turns = []; this.lastHeadWarning = -Infinity; this.cameraState = 'starting';
    this.lastNoFaceWarning = -Infinity; this.lastLightWarning = -Infinity;
  }
  record(type, details = {}) {
    const event = { timestamp: new Date(this.now()).toISOString(), type, ...details };
    this.events.push(event); if (this.events.length > 1000) this.events.shift();
    return event;
  }
  observe(sample) {
    if (this.terminated) return { ...this.snapshot(), action: 'submit' };
    const now = this.now(); let action = null, event = null;
    const live = sample.cameraState === 'live' && sample.detectorReady === true;
    if (this.cameraState !== (live ? 'live' : 'unavailable')) {
      this.cameraState = live ? 'live' : 'unavailable';
      this.record(live ? 'camera_ready' : 'camera_unavailable');
    }
    if (!live) { this.candidate = null; this.lastSample = null; return { ...this.snapshot(), cameraBlocked: true }; }
    if (!Number.isInteger(sample.faceCount) || sample.faceCount < 0 || sample.faceCount > 10 || !Number.isFinite(sample.phoneConfidence) || sample.phoneConfidence < 0 || sample.phoneConfidence > 1) throw new Error('Invalid camera observation.');
    if (this.lastSample !== null && now - this.lastSample < 250) return this.snapshot();
    if (this.lastSample !== null && now - this.lastSample > 5000) this.candidate = null;
    this.lastSample = now;
    const reasons = [];
    if (sample.faceCount === 0) reasons.push('no_face');
    if (sample.faceCount >= 2) reasons.push('multiple_faces');
    if (sample.phoneConfidence >= 0.5) reasons.push('phone_detected');
    if (reasons.length) {
      if (!this.candidate) this.candidate = { since: now, samples: 0 };
      this.candidate.samples++;
      if (this.candidate.samples >= 3 && now - this.candidate.since >= this.confirmationMs && now - this.lastStrike >= this.repeatMs) {
        this.strikes++; this.lastStrike = now; this.candidate = null;
        this.terminated = this.strikes >= 3;
        event = this.record('confirmed_incident', { reasons, strike: this.strikes, faceCount: sample.faceCount, phoneConfidence: Number(sample.phoneConfidence.toFixed(3)), action: this.terminated ? 'auto_submit' : 'warning' });
        action = this.terminated ? 'submit' : 'warning';
      }
    } else this.candidate = null;
    if (sample.faceCount === 0) {
      if (this.noFaceSince === null) this.noFaceSince = now;
      if (now - this.noFaceSince >= 8000 && now - this.lastNoFaceWarning >= 60000) {
        this.record('face_not_visible', { advisory: false }); this.lastNoFaceWarning = now;
      }
    } else this.noFaceSince = null;
    const turned = sample.faceCount === 1 && ['left','right'].includes(sample.headDirection);
    if (turned) {
      if (this.headSince === null) this.headSince = now;
      if (!this.headEpisode && now - this.headSince >= 3000) {
        this.headEpisode = true; this.turns.push(now);
        this.turns = this.turns.filter(time => now - time <= 60000);
        this.record('head_turn', { direction: sample.headDirection, advisory: true });
        if (this.turns.length >= 4 && now - this.lastHeadWarning >= 60000) {
          event = this.record('frequent_head_turns', { advisory: true, episodes: this.turns.length });
          this.lastHeadWarning = now; if (!action) action = 'advisory';
        }
      }
    } else { this.headSince = null; this.headEpisode = false; }
    if (Number.isFinite(sample.brightness) && sample.brightness < 18 && now - this.lastLightWarning >= 60000) {
      this.record('poor_lighting', { advisory: true }); this.lastLightWarning = now;
    }
    return { ...this.snapshot(), action, event, cameraBlocked: this.noFaceSince !== null && now - this.noFaceSince >= 8000 };
  }
  snapshot() { return { strikes: this.strikes, warningLimit: 2, terminated: this.terminated }; }
  report() { return { ...this.snapshot(), policyVersion: 2, events: [...this.events], notes: 'Automated observations require human review. Up to three confirmed incident snapshots are included; no continuous video is recorded. Head movement is advisory.' }; }
}
module.exports = { ProctorPolicy };
