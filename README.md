# 🛡️ SecureExam — Proctored Exam Desktop Application

A fully secure, lockdown-mode exam application built with Electron for Windows (Mac ready).

---

## 📁 Project Structure

```
examapp/
├── config/
│   └── config.js          ← 🔑 PASTE YOUR API KEYS HERE
├── src/
│   ├── main/
│   │   ├── main.js        ← Electron main process
│   │   ├── lockdown.js    ← All security/kiosk enforcement
│   │   └── apiHandler.js  ← All API calls (Gemini, Judge0, Power Automate)
│   ├── preload/
│   │   └── preload.js     ← Secure IPC bridge
│   └── renderer/
│       ├── styles/
│       │   └── global.css
│       └── pages/
│           ├── pin.html          ← PIN entry
│           ├── confirmation.html ← Student info + schedule
│           ├── waiting.html      ← Question generation + countdown
│           ├── mcq.html          ← MCQ exam
│           ├── coding.html       ← LeetCode-style coding exam
│           ├── interview.html    ← Live interview with AI proctoring
│           └── completed.html    ← Submission confirmation
├── assets/                ← Put icon.ico / icon.icns here
└── package.json
```

---

## 🚀 Setup & Run

### Step 1: Install Node.js
Download from https://nodejs.org (v18+ recommended)

### Step 2: Install Dependencies
```bash
cd examapp
npm install
```

### Step 3: Add API Keys
Open `config/config.js` and fill in:

```js
GEMINI_API_KEY: "your-key-from-aistudio.google.com",
JUDGE0_API_KEY: "your-key-from-rapidapi.com/judge0-ce",
```

### Step 4: Run
```bash
npm start
```

### Step 5: Build for Windows
```bash
npm run build
```
Produces installer in `dist/` folder.

---

## 🔑 API Keys You Need

| Key | Where to Get | Cost |
|-----|-------------|------|
| Gemini API | https://aistudio.google.com | Free |
| Judge0 (RapidAPI) | https://rapidapi.com/judge0-official/api/judge0-ce | Free tier |

---

## 🔗 Power Automate Integration (Later)

Open `config/config.js` → replace all `YOUR_POWER_AUTOMATE_*_URL` values with your actual HTTP trigger URLs.

### What each endpoint receives:

**VALIDATE_PIN** — POST `{ pin: "123456" }`
Returns: `{ success: true, student: { name, rollNumber, examType, difficulty, subject, questionCount, description } }`

**EXAM_SCHEDULE** — POST `{ pin: "123456" }`
Returns: `{ success: true, startTime: "ISO8601", endTime: "ISO8601", duration: 3600 }`

**SUBMIT_MCQ** — POST `{ studentId, pin, totalQuestions, correctAnswers, percentage, detailed[], timeTaken, submittedAt }`

**SUBMIT_CODE** — POST `{ studentId, pin, totalCases, passedCases, allPassed, results[], submittedAt }`

**SUBMIT_INTERVIEW** — POST `{ studentId, pin, responses[], evaluation{}, proctorLog[], submittedAt }`

---

## 🔒 Security Features

| Feature | Status |
|---------|--------|
| Kiosk / Full screen lock | ✅ |
| All keyboard shortcuts blocked | ✅ |
| Alt+Tab, Win key blocked | ✅ |
| Virtual desktop switching blocked | ✅ |
| AI tools shortcuts blocked (Copilot, ChatGPT) | ✅ |
| Right click disabled | ✅ |
| DevTools blocked | ✅ |
| Single instance lock | ✅ |
| Force focus on blur | ✅ |
| Context menu disabled | ✅ |
| External navigation blocked | ✅ |
| Power save blocker (no sleep) | ✅ |
| Window close disabled during exam | ✅ |
| Always on top during exam | ✅ |

---

## 🧪 Testing (Mock Mode)

Without Power Automate URLs set up, use PIN `123456` to test.
The app will use mock data so you can test all flows.

---

## 📋 Exam Types

| Type | Description |
|------|-------------|
| MCQ | AI-generated questions, single correct answer |
| CODING | LeetCode-style with live compiler (C, C++, Java, Python) |
| INTERVIEW | Speech + text answers, live camera proctoring, Gemini face analysis |

---

## 🔗 Student 360 Ecosystem & Demos

This Electron application is a core client component of the broader **Student 360** platform. For a complete understanding of the system's administration, backend integrations, and UI portals, please check the resources below:

* **🖥️ Main Web Application Repository:** [STUDENT-360 Web Portal](https://github.com/lokeshkodamanchili/STUDENT-360)  
  *Contains the student portal, admin dashboard, Firebase configurations, and API routes for exam submission.*

* **🎥 Platform Video Walkthroughs:** [Student 360 Video Demo Folder](https://github.com/lokeshkodamanchili/STUDENT-360/tree/main/Documentation%20%26%20Demo/Video%20Demo)  
  *Provides step-by-step video recordings showing the proctored exam client integration, results submission, and portal dashboards in action.*

---
