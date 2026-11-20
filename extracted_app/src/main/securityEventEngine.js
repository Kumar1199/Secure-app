const crypto = require('crypto');

const Severity = Object.freeze({ INFO: 'INFO', LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' });
const Action = Object.freeze({ IGNORE: 'IGNORE', LOG: 'LOG', ADVISORY: 'ADVISORY', WARNING: 'WARNING', HIGH_RISK: 'HIGH_RISK', LOCK: 'LOCK', AUTO_SUBMIT: 'AUTO_SUBMIT' });
const DEFAULT_POLICIES = Object.freeze({
  PHONE_DETECTED: { category: 'OBJECT', severity: Severity.HIGH, confidence: .32, persistenceMs: 1000, minFrames: 4, cooldownMs: 7000, group: 'major_presence' },
  MULTIPLE_FACES: { category: 'FACE', severity: Severity.HIGH, confidence: .8, persistenceMs: 800, minFrames: 3, cooldownMs: 7000, group: 'major_presence' },
  FACE_MISSING: { category: 'FACE', severity: Severity.HIGH, confidence: .8, persistenceMs: 800, minFrames: 3, cooldownMs: 7000, group: 'major_presence' },
  HEAD_ROTATION: { category: 'HEAD', severity: Severity.LOW, confidence: .7, persistenceMs: 2200, minFrames: 3, cooldownMs: 7000, action: Action.ADVISORY },
  GAZE_DEVIATION: { category: 'GAZE', severity: Severity.LOW, confidence: .7, persistenceMs: 1400, minFrames: 3, cooldownMs: 7000, action: Action.ADVISORY },
  CAMERA_DISCONNECTED: { category: 'CAMERA', severity: Severity.HIGH, confidence: 1, persistenceMs: 5000, minFrames: 1, cooldownMs: 30000, action: Action.HIGH_RISK },
  CAMERA_FROZEN: { category: 'CAMERA', severity: Severity.HIGH, confidence: 1, persistenceMs: 8000, minFrames: 1, cooldownMs: 30000, action: Action.HIGH_RISK },
  CAMERA_BLACK_FRAME: { category: 'CAMERA', severity: Severity.MEDIUM, confidence: .9, persistenceMs: 3000, minFrames: 2, cooldownMs: 30000, action: Action.WARNING },
  CAMERA_STALE_FRAME: { category: 'CAMERA', severity: Severity.MEDIUM, confidence: .9, persistenceMs: 5000, minFrames: 2, cooldownMs: 30000, action: Action.WARNING },
  FACE_OCCLUDED: { category: 'FACE', severity: Severity.MEDIUM, confidence: .75, persistenceMs: 2500, minFrames: 2, cooldownMs: 15000, action: Action.ADVISORY },
  CAMERA_LOW_QUALITY: { category: 'CAMERA', severity: Severity.LOW, confidence: .8, persistenceMs: 6000, minFrames: 2, cooldownMs: 60000, action: Action.ADVISORY },
  // Camera identity comparison remains a review signal. It must never be the
  // sole automatic termination reason because lighting and pose are uncertain.
  IDENTITY_MISMATCH: { category: 'IDENTITY', severity: Severity.HIGH, confidence: .9, persistenceMs: 2000, minFrames: 2, cooldownMs: 60000, action: Action.ADVISORY },
  APPLICATION_TAMPERING: { category: 'TAMPERING', severity: Severity.CRITICAL, confidence: 1, persistenceMs: 0, minFrames: 1, cooldownMs: 60000, action: Action.AUTO_SUBMIT },
  FULLSCREEN_EXIT: { category: 'APPLICATION', severity: Severity.MEDIUM, confidence: 1, persistenceMs: 0, minFrames: 1, cooldownMs: 5000, action: Action.ADVISORY },
  WINDOW_FOCUS_LOST: { category: 'NAVIGATION', severity: Severity.LOW, confidence: 1, persistenceMs: 0, minFrames: 1, cooldownMs: 3000, action: Action.LOG },
  WINDOW_MINIMIZED: { category: 'APPLICATION', severity: Severity.MEDIUM, confidence: 1, persistenceMs: 0, minFrames: 1, cooldownMs: 5000, action: Action.ADVISORY },
  WINDOW_CLOSE_ATTEMPT: { category: 'APPLICATION', severity: Severity.HIGH, confidence: 1, persistenceMs: 0, minFrames: 1, cooldownMs: 5000, action: Action.WARNING },
  DEVTOOLS_ATTEMPT: { category: 'TAMPERING', severity: Severity.CRITICAL, confidence: 1, persistenceMs: 0, minFrames: 1, cooldownMs: 60000, action: Action.AUTO_SUBMIT },
  NAVIGATION_BLOCKED: { category: 'NAVIGATION', severity: Severity.HIGH, confidence: 1, persistenceMs: 0, minFrames: 1, cooldownMs: 5000, action: Action.WARNING },
  RENDERER_CRASH: { category: 'APPLICATION', severity: Severity.HIGH, confidence: 1, persistenceMs: 0, minFrames: 1, cooldownMs: 30000, action: Action.HIGH_RISK },
  CLIPBOARD_ATTEMPT: { category: 'CLIPBOARD', severity: Severity.MEDIUM, confidence: 1, persistenceMs: 0, minFrames: 1, cooldownMs: 2500, action: Action.LOG },
  PROHIBITED_SHORTCUT: { category: 'KEYBOARD', severity: Severity.MEDIUM, confidence: 1, persistenceMs: 0, minFrames: 1, cooldownMs: 2500, action: Action.LOG },
  CODE_LARGE_INSERT: { category: 'CODING', severity: Severity.LOW, confidence: 1, persistenceMs: 0, minFrames: 1, cooldownMs: 5000, action: Action.LOG },
  CODE_RAPID_CHANGE: { category: 'CODING', severity: Severity.LOW, confidence: 1, persistenceMs: 0, minFrames: 1, cooldownMs: 5000, action: Action.LOG },
  CODE_RUN: { category: 'CODING', severity: Severity.INFO, confidence: 1, persistenceMs: 0, minFrames: 1, cooldownMs: 0, action: Action.LOG },
  NETWORK_OFFLINE: { category: 'NETWORK', severity: Severity.LOW, confidence: 1, persistenceMs: 0, minFrames: 1, cooldownMs: 10000, action: Action.LOG },
  NETWORK_RESTORED: { category: 'NETWORK', severity: Severity.INFO, confidence: 1, persistenceMs: 0, minFrames: 1, cooldownMs: 0, action: Action.LOG },
  SESSION_DUPLICATE: { category: 'SESSION', severity: Severity.HIGH, confidence: 1, persistenceMs: 0, minFrames: 1, cooldownMs: 30000, action: Action.HIGH_RISK },
});

class TemporalDetector {
  constructor() { this.states = new Map(); }
  observe(type, active, confidence, now, policy) {
    let state = this.states.get(type) || { firstSeen: null, lastSeen: null, consecutiveFrames: 0, occurrenceCount: 0, confidenceTotal: 0, lastConfirmed: -Infinity };
    if (!active) { state.firstSeen = null; state.consecutiveFrames = 0; state.confidenceTotal = 0; this.states.set(type, state); return null; }
    if (state.firstSeen === null || now - state.lastSeen > Math.max(1500, policy.persistenceMs + 1000)) { state.firstSeen = now; state.consecutiveFrames = 0; state.confidenceTotal = 0; }
    state.lastSeen = now; state.consecutiveFrames++; state.confidenceTotal += confidence;
    const duration = now - state.firstSeen, averageConfidence = state.confidenceTotal / state.consecutiveFrames;
    const ready = confidence >= policy.confidence && averageConfidence >= policy.confidence && duration >= policy.persistenceMs && state.consecutiveFrames >= policy.minFrames && now - state.lastConfirmed >= policy.cooldownMs;
    if (!ready) { this.states.set(type, state); return null; }
    state.lastConfirmed = now; state.occurrenceCount++; state.firstSeen = null; state.consecutiveFrames = 0; state.confidenceTotal = 0; this.states.set(type, state);
    return { duration, occurrenceCount: state.occurrenceCount, confidence: Number(averageConfidence.toFixed(3)) };
  }
}

class SecurityPolicyEngine {
  constructor({ now = Date.now, policies = DEFAULT_POLICIES, majorAutoSubmitAt = 3, riskDecayMs = 60000 } = {}) {
    this.now = now; this.policies = Object.fromEntries(Object.keys({ ...DEFAULT_POLICIES, ...policies }).map(key => [key, { ...(DEFAULT_POLICIES[key] || {}), ...(policies[key] || {}) }])); this.majorAutoSubmitAt = majorAutoSubmitAt; this.riskDecayMs = riskDecayMs;
    this.temporal = new TemporalDetector(); this.events = []; this.groupCounts = new Map(); this.riskScore = 0; this.lastRiskAt = now(); this.terminated = false;
  }
  decayRisk(now) { const elapsed = Math.max(0, now - this.lastRiskAt); this.riskScore = Math.max(0, this.riskScore - Math.floor(elapsed / this.riskDecayMs) * 5); this.lastRiskAt = now; }
  normalize({ type, confidence = 1, metadata = {}, source = 'proctor', evidenceId = null, timestamp }) {
    const policy = this.policies[type] || { category: 'SESSION', severity: Severity.INFO, confidence: 0, persistenceMs: 0, minFrames: 1, cooldownMs: 0, action: Action.LOG };
    return { eventId: crypto.randomUUID(), examSessionId: metadata.examSessionId || null, studentId: metadata.studentId || null, examId: metadata.examId || null, type, category: policy.category, severity: policy.severity, confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(3)), duration: metadata.duration || 0, metadata, timestamp: timestamp || new Date(this.now()).toISOString(), evidenceId, source, status: 'PENDING_REVIEW' };
  }
  ingest(candidate) {
    const now = this.now(); if (this.terminated) return { action: Action.AUTO_SUBMIT, event: null, snapshot: this.snapshot() };
    const policy = this.policies[candidate.type]; if (!policy) return { action: Action.IGNORE, event: null, snapshot: this.snapshot() };
    const temporal = this.temporal.observe(candidate.type, candidate.active !== false, candidate.confidence ?? 1, now, policy);
    if (!temporal) return { action: Action.IGNORE, event: null, snapshot: this.snapshot() };
    this.decayRisk(now);
    const event = this.normalize({ ...candidate, confidence: temporal.confidence, metadata: { ...(candidate.metadata || {}), ...temporal }, timestamp: new Date(now).toISOString() });
    const weights = { INFO: 0, LOW: 3, MEDIUM: 10, HIGH: 25, CRITICAL: 100 }; this.riskScore = Math.min(100, this.riskScore + weights[event.severity]);
    let action = policy.action || Action.WARNING;
    if (policy.group) { const count = (this.groupCounts.get(policy.group) || 0) + 1; this.groupCounts.set(policy.group, count); event.metadata.groupCount = count; if (count >= this.majorAutoSubmitAt) action = Action.AUTO_SUBMIT; }
    if (event.severity === Severity.CRITICAL) action = Action.AUTO_SUBMIT;
    if (action === Action.AUTO_SUBMIT) this.terminated = true;
    event.metadata.action = action; this.events.push(event); if (this.events.length > 1000) this.events.shift();
    return { action, event, snapshot: this.snapshot() };
  }
  log(type, metadata = {}, severity = Severity.INFO) { const event = this.normalize({ type, metadata, confidence: 1, source: 'application' }); event.severity = severity; event.status = 'LOGGED'; this.events.push(event); return event; }
  snapshot() { return { riskScore: this.riskScore, terminated: this.terminated, groupCounts: Object.fromEntries(this.groupCounts) }; }
}

class ObjectDetectionService { normalize(objects = []) { return objects.filter(item => item && Number.isFinite(item.score)).map(item => ({ type: ({ cell_phone: 'PHONE', phone: 'PHONE', person: 'PERSON', book: 'BOOK', paper: 'PAPER' }[String(item.label || item.type || '').toLowerCase()] || 'OTHER_RESTRICTED_OBJECT'), confidence: Math.max(0, Math.min(1, item.score)), box: item.box || null })); } }
module.exports = { SecurityPolicyEngine, TemporalDetector, ObjectDetectionService, DEFAULT_POLICIES, Severity, Action };
