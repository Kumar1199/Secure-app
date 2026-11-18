Camera proctoring
=================

MCQ, coding and interview exams share a local camera monitor. The student must accept the displayed rules, allow camera access, and pass a three-frame check with exactly one face and no detected phone before answering. Local face and object models are bundled with the installer; they do not download during an exam.

Policy
------

* A mobile phone with confidence at least 0.75, or two or more detected faces, is a potential incident. It must persist for at least 2.5 seconds and at least three samples before counting.
* Phone and multiple-face detections share one counter. Simultaneous detections count as one incident. Both warnings show the detected frame with highlighted regions. The third locks input immediately, displays the incident evidence for 60 seconds, then automatically submits the current answers.
* A continuing issue can count again after 20 seconds. The camera rules explain this before the exam. Confirmation is reset when the condition clears or the camera stops.
* Head direction is estimated from local face landmarks. Four sustained head-turn episodes within a minute create an advisory. This is not an eye-tracking, attention, emotion or cheating assessment, and never adds a phone/multiple-face strike.
* No visible face for eight seconds blocks exam input until a face returns. Camera/device/detector failure blocks input and offers retry. These conditions do not add strikes. The exam clock continues.
* Poor lighting, camera interruption and window focus changes are recorded as observations for review. No inferred emotion or identity is stored.

Submission and data
-------------------

The warning policy lives in the Electron main process. Each camera sample updates a current answer/code/interview draft before applying the policy. On the third incident, answers are locked and protected immediately. The detected frame is shown for 60 seconds with an automatic countdown, then submission proceeds without waiting for a compiler or interview grading service. This delay is enforced in the main process too. MCQs receive local grading; forced coding/interview submissions are marked evaluationPending for later review. No manual confirmation is required.

Repeated submit requests share one in-flight operation. The MongoDB API also preserves the first submission for a student/exam, so network retries do not duplicate or overwrite it. Up to three confirmed incidents appear under the web admin's Violations section, with timestamp, detected face count, phone confidence, warning/action and a human-review note. Each incident can include one JPEG snapshot from the exact analysed frame (maximum 640×480 and 180,000 data-URL characters), with normalized face/phone rectangles. No continuous video is stored. The snapshot is shown in the warning or final countdown; admins can open View evidence. Snapshots remain with the submitted exam and violation records until those records are removed. This is explained in the student's camera consent notice. The full incident report accompanies the submission.

Only the three confirmed incident snapshots are uploaded with the submission. Other frames remain transient on this computer; no continuous video, face landmarks or identity template is saved. The old interview cloud frame-analysis call has been removed from the renderer API. Existing interview speech/transcription features are separate from camera analysis. Incident photos are restricted to authenticated administrators and the owning student's permitted queries.

Before forced submission, the current answers and report are saved using Electron safeStorage in an encrypted pending-proctored-exam.bin under the app's userData directory. Windows protects this with the current user's storage protection. If upload fails, input stays locked and retry runs every 15 seconds; the app does not show successful completion or quit until the server confirms. If forcibly closed, reopening and entering the original exam PIN retries the protected submission before allowing a new exam. The recovery copy is removed after a successful save.

Local test setup
----------------

This build defaults to `http://127.0.0.1:5173/api/proxy`, matching the current localhost web setup. Start the web app first. For a hosted deployment, set `STUDENT360_API_BASE_URL` to the deployed `/api/proxy` URL when launching Electron and deploy the corresponding MongoDB API changes. Camera access can also be restricted by Windows Settings → Privacy & security → Camera; the app cannot override those restrictions.

Use a webcam facing the student, sufficient lighting, and an unobstructed face. Detection can miss phones outside the camera's view and can produce false positives. Validate thresholds with the intended webcam, room and student population before using automatic submission in a consequential exam. Keep advisory observations available to a human reviewer.

Checks and assets
-----------------

`npm run test:proctor` verifies confirmation windows, advisory handling, combined warnings, forced draft preservation, duplicate callbacks and retry behavior. `tests/proctor-runtime.cjs`, run with Electron, checks the real models using blank, single-portrait and two-portrait fixtures in a hidden window. `tests/proctor-ui.cjs` checks all three exam pages with synthetic camera/detector input, including the latest answer/code draft. These tests do not exercise a physical webcam or validate real-world phone-detection accuracy.

`npm run prepare:proctor` prepares assets; it also runs before the installer build. The asset manifest records model source URLs and SHA-256 hashes. MediaPipe's license is included under src/renderer/vendor/proctor.

Official references:
* https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
* https://developers.google.com/edge/mediapipe/solutions/vision/object_detector
