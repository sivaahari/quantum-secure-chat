<div align="center">

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=28&pause=1000&color=00C2F0&center=true&vCenter=true&width=700&lines=Quantum-Secure+Chat;BB84+QKD+%2B+AES-256-GCM+%2B+WebRTC;JWT+Auth+%2B+Admin+Dashboard;End-to-End+Zero-Knowledge+Encryption" alt="Typing SVG" />

<br/>

# ⚛ Quantum-Secure Chat

### Real-time encrypted messaging built on quantum key distribution, peer-to-peer cryptography, and role-based access control

<p align="center">
  <img src="https://img.shields.io/badge/Quantum-Qiskit%202.3.1-6929C4?style=for-the-badge&logo=ibm&logoColor=white" />
  <img src="https://img.shields.io/badge/Encryption-AES--256--GCM-00C2F0?style=for-the-badge&logo=letsencrypt&logoColor=white" />
  <img src="https://img.shields.io/badge/P2P-WebRTC-F4A261?style=for-the-badge&logo=webrtc&logoColor=white" />
  <img src="https://img.shields.io/badge/Auth-JWT-black?style=for-the-badge&logo=jsonwebtokens&logoColor=white" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Backend-Flask%203.0-black?style=for-the-badge&logo=flask&logoColor=white" />
  <img src="https://img.shields.io/badge/Frontend-React%2018-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/Python-3.12-3776AB?style=for-the-badge&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Deployed-Vercel-black?style=for-the-badge&logo=vercel&logoColor=white" />
  <img src="https://img.shields.io/badge/Backend-Railway-7B2FBE?style=for-the-badge&logo=railway&logoColor=white" />
  <img src="https://img.shields.io/badge/Tests-86%20passing-22c55e?style=for-the-badge&logo=pytest&logoColor=white" />
</p>

<p align="center">
  <a href="https://quantum-secure-chat-blond.vercel.app">
    <img src="https://img.shields.io/badge/🚀%20Live%20Demo-quantum--secure--chat.vercel.app-00C2F0?style=for-the-badge" />
  </a>
</p>

<br/>

> **A full-stack cryptographic chat platform combining quantum physics, peer-to-peer key exchange, and enterprise-style access control.**
> Keys are born from the laws of quantum mechanics. Every message is locked with AES-256-GCM.
> The server is mathematically excluded from the P2P encryption chain.

<br/>

---

</div>

## ⚡ What Makes This Different

Most encrypted chat apps derive keys from math — math that quantum computers will eventually crack. This app generates keys using **quantum physics itself**: the BB84 protocol, where randomness comes from the fundamental act of measuring photons. No math to crack. The uncertainty is built into the universe.

On top of that, the **WebRTC P2P mode** eliminates the server entirely from the key agreement — even the backend has zero knowledge of what Alice and Bob are saying to each other.

```
Traditional Chat App              Quantum-Secure Chat
──────────────────────────        ─────────────────────────────────────────
Math-derived key                  Quantum-physics-derived key (BB84)
One encryption mode               Two modes: server-assisted + P2P zero-knowledge
Anyone can join with a name       JWT auth + admin-controlled room access
Key never refreshes               Key refreshes every 5 messages (PFS)
No tamper detection               AES-GCM 128-bit authentication tag
Server sees everything            Server sees only ciphertext + routing info
No admin control                  Full RBAC: admin approves users and rooms
```

---

## 🏗 Full System Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            BROWSER (React + TypeScript)                       │
│                                                                                │
│  ┌─────────────┐  ┌──────────────────┐  ┌────────────────────────────────┐  │
│  │ Auth System │  │  Admin Dashboard  │  │      Chat + P2P Key Panel      │  │
│  │  JWT/bcrypt │  │  User approvals   │  │  BB84 viz · Bloch sphere       │  │
│  │  Register   │  │  Room management  │  │  E2E demo · Reaction system    │  │
│  │  Login      │  │  Request control  │  │  Typing · Unread indicator     │  │
│  └─────────────┘  └──────────────────┘  └────────────────────────────────┘  │
│                                                                                │
│  Web Crypto API (AES-256-GCM) ← keys NEVER leave the browser                 │
│                                                                                │
│  ◄──────── WebRTC DataChannel (P2P BB84) ────────► [Peer Browser]            │
└────────────────────────────┬───────────────────────────────────────────────┘
                             │  REST + WebSocket (JWT verified)
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         FLASK SERVER (Railway)                                 │
│                                                                                │
│  ┌────────────────────────────┐  ┌────────────────────────────────────────┐  │
│  │     Auth & RBAC Layer      │  │           BB84 QKD Engine              │  │
│  │  JWT issue + verification  │  │  Alice: random bits + random bases     │  │
│  │  bcrypt password hashing   │  │  Qiskit QuantumCircuit (N qubits)     │  │
│  │  Admin: approve/reject     │  │  AerSimulator + Depolarizing Noise    │  │
│  │  Room membership control   │  │  Bob: measure + sifting               │  │
│  │  Join request workflow     │  │  QBER check (Shor-Preskill 11%)      │  │
│  └────────────────────────────┘  │  HKDF-SHA256 → 32-byte AES key       │  │
│                                  └────────────────────────────────────────┘  │
│  ┌────────────────────────────┐  ┌────────────────────────────────────────┐  │
│  │  Flask-SocketIO (gevent)   │  │     AES-256-GCM (Python side)          │  │
│  │  JWT auth on connect       │  │     Per-message random nonce           │  │
│  │  Room membership guard     │  │     128-bit authentication tag         │  │
│  │  WebRTC signaling relay    │  │     Auto-refresh every 5 messages      │  │
│  │  Key refresh automation    │  │     Key version history (5 keys)       │  │
│  └────────────────────────────┘  └────────────────────────────────────────┘  │
│                                                                                │
│  In-memory store: Users · Rooms · Messages · JoinRequests · KeyHistory        │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔬 The Science — BB84 Protocol

BB84 (Bennett & Brassard, 1984) is the world's first quantum cryptographic protocol. Under the Shor-Preskill security proof (2000), it is **information-theoretically secure** — guaranteed by the laws of quantum mechanics, not computational hardness assumptions.

```
STEP 1 — Alice prepares N qubits
  ┌─────┬───────┬───────────────────┐
  │ Bit │ Basis │ Quantum State     │
  ├─────┼───────┼───────────────────┤
  │  0  │   +   │ |0⟩  (north pole) │
  │  1  │   +   │ |1⟩  (south pole) │
  │  0  │   ×   │ |+⟩  (+X equator) │
  │  1  │   ×   │ |−⟩  (−X equator) │
  └─────┴───────┴───────────────────┘

STEP 2 — Qiskit simulates quantum channel with noise
  [H gate] [X gate] → AerSimulator + Depolarizing Noise → measurement

STEP 3 — Bob measures in random bases
  Matching basis  → correct bit  ✓
  Wrong basis     → random result (quantum indeterminacy) ✗

STEP 4 — Basis sifting (~50% retained)
  Alice: 1 0 1 1 0 0 1 0 1 1
  Bob:   1 0 ? 1 0 ? 1 ? ? 1   (? = wrong basis = discard)
  Kept:  1 0   1 0   1       1

STEP 5 — QBER estimation
  Sacrifice 20% of sifted bits for public comparison
  QBER > 11% → ABORT (Shor-Preskill bound — Eve detected)
  Eve intercept-resend → QBER ≈ 25% → detected automatically

STEP 6 — HKDF-SHA256 privacy amplification
  Reconciled bits → HKDF(SHA-256, salt="quantum-llm-chat-v1") → 32 bytes → AES-256 key
```

### P2P Mode — True Zero-Knowledge

In P2P mode, Alice and Bob run BB84 directly in their browsers over a **WebRTC DataChannel**. The server acts as a pure signaling relay (SDP/ICE only) and is mathematically excluded from the key.

```
Alice (browser)                              Bob (browser)
      │                                             │
      │── random bits + bases ──────────────────►  │
      │                                             │  measures in random bases
      │◄── Bob's bases ─────────────────────────── │
      │                                             │
      │── Alice's bases ────────────────────────►  │
      │         (both sift independently)           │
      │── QBER sample ──────────────────────────►  │
      │◄── QBER confirmation ─────────────────── │
      │                                             │
  HKDF(sifted bits)                         HKDF(sifted bits)
      │                                             │
      └──────── identical AES-256 keys ────────────┘

Server (Railway): SDP + ICE candidates only
Server NEVER sees: qubit states, bases, QBER, or key material
```

---

## 🔐 Authentication & Access Control

A full RBAC system built on JWT and bcrypt — no third-party auth service.

```
Registration Flow:
  User registers → pending status
  Admin reviews  → approves / rejects
  Approved user can log in → JWT issued (24hr expiry)

Room Access Flow:
  Admin creates rooms from dashboard
  User requests room access (with optional message)
  Admin reviews request → grants / rejects
  Approved user sees room in their list → clicks Enter

Socket Security:
  Every socket connection verified by JWT in on_connect
  Room join checks membership before allowing entry
  Admin bypasses membership check (can enter any room)
  Unauthorized connections refused at socket layer
```

### User Roles

| Role | Capabilities |
|---|---|
| **admin** | First registered user. Approve/reject accounts. Create rooms. Grant room access. Enter any room. View all activity. |
| **user** | Login after admin approval. Request room access. Enter approved rooms only. Chat with full E2E encryption. |

---

## ✨ Complete Feature List

### 🔑 Quantum Key Distribution
- Full BB84 protocol from scratch — Qiskit 2.x circuits + AerSimulator
- Configurable qubit count (64–512), depolarizing noise model (2% default)
- Eavesdropper simulation — Eve intercept-resend with QBER detection
- Shor-Preskill 11% QBER abort threshold
- HKDF-SHA256 privacy amplification → 256-bit AES key
- Automatic key refresh every 5 messages (perfect forward secrecy)
- Key version history — old messages decrypt correctly after refresh

### 🔗 WebRTC P2P Key Exchange
- Full BB84 runs in browser over RTCDataChannel
- Server mathematically excluded from key agreement (zero-knowledge)
- STUN-based NAT traversal (Google public STUN servers)
- Live protocol log — every step visible in real time
- Bloch sphere visualization of qubit states
- Auto role assignment: Alice (first peer) and Bob (second peer)

### 🔒 End-to-End Encryption
- AES-256-GCM on both sides: Python (server) and Web Crypto API (browser)
- 96-bit random nonce per message — nonce never reused
- 128-bit GCM authentication tag — tamper detection on every message
- Replay attack protection via 5-minute timestamp window
- Click-to-toggle: view any message as raw ciphertext or decrypted text

### 👑 Auth & Access Control
- JWT authentication (PyJWT, 24hr expiry, HS256)
- bcrypt password hashing
- Admin dashboard — user approvals, room creation, request management
- Room join request workflow with optional message
- Socket-layer JWT verification on every connection
- Pending approval screen for unverified users

### 💬 Real-Time Chat
- Flask-SocketIO + gevent WebSocket transport
- Multi-room architecture — admin creates, users request access
- Typing indicators, user join/leave notifications
- Emoji reactions (👍 ❤️ 😂 🔒 ⚡) — right-click any message
- Message history on rejoin (last 50 messages)
- Unread message counter in tab title and dot indicator

### 📊 Quantum Visualizations
- SVG isometric Bloch sphere — live qubit state display (|0⟩ |1⟩ |+⟩ |−⟩)
- QBER bar chart with safe/unsafe threshold markers
- Sifted bit comparison table — Alice vs Bob, bit by bit
- Key statistics panel — raw qubits, sift efficiency, simulation time, QBER

### 📱 Mobile & UX
- `100dvh` layout — no content hidden behind mobile keyboard
- `env(safe-area-inset-bottom)` — works on iPhone notch and home bar
- `font-size: 16px` on inputs — prevents iOS zoom on focus
- Railway sleep warning — detects reconnect gap, prompts key regeneration

---

## 🛠 Tech Stack

### Backend

| Technology | Version | Purpose |
|---|---|---|
| Python | 3.12.4 | Runtime |
| Flask | 3.0.3 | REST API framework |
| Flask-SocketIO | 5.3.6 | WebSocket real-time layer |
| Qiskit | 2.3.1 | Quantum circuit simulation |
| Qiskit-Aer | 0.17.2 | Noise model + AerSimulator |
| cryptography | 42.0.8 | AES-256-GCM (Python) |
| PyJWT | 2.8.0 | JWT creation + verification |
| bcrypt | 4.1.3 | Password hashing |
| gevent | 24.11.1 | Async I/O for production |
| gunicorn | 23.0.0 | Production WSGI server |

### Frontend

| Technology | Version | Purpose |
|---|---|---|
| React | 18 | UI framework |
| TypeScript | 5.0 | Type safety |
| Vite | 5.x | Build tool |
| Tailwind CSS | 3.4 | Styling |
| shadcn/ui | latest | Component library |
| Socket.IO Client | 4.8.1 | WebSocket client |
| Web Crypto API | native | Browser AES-256-GCM + HKDF |
| WebRTC API | native | P2P DataChannel for BB84 |

### Infrastructure

| Service | Purpose |
|---|---|
| Railway | Python backend — production deployment |
| Vercel | React frontend — CDN global distribution |
| GitHub | Version control + CI/CD (push-to-deploy) |

---

## 🚀 Quick Start (Local)

### Prerequisites
```
Python 3.12+    →  python.org
Node.js 18+     →  nodejs.org
Git             →  git-scm.com
```

### 1. Clone
```bash
git clone https://github.com/sivaahari/quantum-secure-chat.git
cd quantum-secure-chat
```

### 2. Backend
```bash
cd backend

# Windows PowerShell
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# macOS / Linux
python3 -m venv .venv
source .venv/bin/activate

# Install (Qiskit takes ~2 minutes)
pip install -r requirements.txt

# Run
python app.py
```

Backend starts at `http://localhost:5000`

### 3. Frontend
```bash
cd frontend
npm install
echo "VITE_BACKEND_URL=http://localhost:5000" > .env.development
npm run dev
```

Frontend starts at `http://localhost:5173`

### 4. First Run Flow
1. Open `http://localhost:5173` → Register → **first account becomes admin automatically**
2. Log in as admin → Admin Dashboard opens
3. Create a room (Rooms tab → Create)
4. Open incognito window → register a second user
5. Admin Dashboard → Users → approve the second user
6. Second user logs in → requests room access → admin approves
7. Both users enter the room → quantum key generated → start chatting

---

## 🌐 Deployment

### Live Instance

| Component | URL |
|---|---|
| Frontend | `https://quantum-secure-chat-blond.vercel.app` |
| Backend API | `https://web-production-cb878.up.railway.app` |
| Health Check | `https://web-production-cb878.up.railway.app/api/health` |

### Deploy Your Own

**Backend → Railway**
```
Root Directory:  backend
Start Command:   gunicorn --worker-class geventwebsocket.gunicorn.workers.GeventWebSocketWorker
                          --workers 1 --bind 0.0.0.0:$PORT --timeout 120 app:app

Environment Variables:
  FLASK_SECRET      = <random 32-char string>
  JWT_SECRET        = <random 32-char string>
  FLASK_DEBUG       = false
  BB84_NUM_QUBITS   = 128
  KEY_REFRESH_EVERY = 5
  ALLOWED_ORIGINS   = https://your-app.vercel.app
```

**Frontend → Vercel**
```
Root Directory:  frontend
Build Command:   npm run build
Output Dir:      dist

Environment Variables:
  VITE_BACKEND_URL = https://your-railway-app.railway.app
```

---

## 📁 Project Structure

```
quantum-secure-chat/
│
├── backend/
│   ├── app.py                      # Application factory + entry point
│   ├── config.py                   # Centralised configuration
│   ├── requirements.txt
│   │
│   ├── auth/                       # JWT authentication + user management
│   │   ├── models.py               # User, JoinRequest, UserStore (thread-safe)
│   │   ├── jwt_utils.py            # create_token, verify_token
│   │   └── routes.py               # /auth/register, /auth/login, /auth/me
│   │
│   ├── admin/
│   │   └── routes.py               # Admin RBAC + user-facing room endpoints
│   │
│   ├── quantum/                    # BB84 QKD engine
│   │   ├── bb84.py                 # Full protocol: circuit → sifting → amplification
│   │   ├── noise_model.py          # Qiskit Aer depolarizing + readout noise
│   │   └── key_utils.py            # Sifting, QBER, reconciliation, HKDF, Bloch
│   │
│   ├── crypto/
│   │   └── aes_gcm.py              # AES-256-GCM AEAD wrapper
│   │
│   ├── api/
│   │   ├── routes.py               # REST endpoints
│   │   ├── socket_events.py        # JWT-verified SocketIO handlers
│   │   └── store.py                # Thread-safe chat store
│   │
│   └── tests/                      # 86 unit + integration tests
│       ├── test_bb84.py            # 27 quantum protocol tests
│       ├── test_aes.py             # 22 encryption tests
│       └── test_routes.py          # 18 API tests
│
├── frontend/
│   └── src/
│       ├── App.tsx                 # Root — auth state machine + room orchestration
│       ├── types/index.ts          # Full TypeScript definitions
│       │
│       ├── hooks/
│       │   ├── useAuth.ts          # JWT auth state + localStorage persistence
│       │   ├── useSocket.ts        # Socket.IO lifecycle + JWT on connect
│       │   ├── useQuantumKey.ts    # BB84 key state + version history map
│       │   ├── useAES.ts           # Multi-version CryptoKey map + on-demand import
│       │   ├── useWebRTC.ts        # RTCPeerConnection lifecycle + role management
│       │   └── useP2PKey.ts        # Full BB84 protocol over DataChannel
│       │
│       ├── lib/
│       │   ├── bb84.ts             # BB84 in TypeScript (browser-native)
│       │   ├── webrtc.ts           # WebRTCManager — offer/answer/ICE/DataChannel
│       │   ├── aes.ts              # Web Crypto AES-256-GCM (Python-compatible)
│       │   ├── api.ts              # Typed REST client
│       │   └── utils.ts            # Formatting, hex/base64 helpers
│       │
│       └── components/
│           ├── AuthPage.tsx         # Register + Login
│           ├── AdminDashboard.tsx   # User approvals, room creation, request review
│           ├── RoomAccessPage.tsx   # User room list + access request form
│           ├── ChatWindow.tsx       # Real-time chat
│           ├── MessageBubble.tsx    # Decrypt on render + auto-retry on key import
│           ├── QuantumKeyPanel.tsx  # BB84 controls + BER chart + bit table
│           ├── BlochSphereViz.tsx   # SVG isometric Bloch sphere
│           ├── P2PKeyPanel.tsx      # WebRTC BB84 UI + live protocol log
│           └── EncryptionDemo.tsx   # Interactive encrypt → tamper → detect
│
├── Dockerfile                      # Container build
├── Procfile                        # Railway start command
├── vercel.json                     # Vercel build config
└── README.md
```

---

## 🧪 Testing

```bash
source backend/.venv/bin/activate   # macOS/Linux
# backend\.venv\Scripts\Activate.ps1  # Windows

pytest backend/tests/ -v
```

**Results:**
```
86 passed in ~50s
├── test_bb84.py    27/27 ✓   BB84, noise model, QBER, HKDF, Bloch vectors
├── test_aes.py     22/22 ✓   AES-GCM roundtrip, tamper detection, replay protection
└── test_routes.py  18/18 ✓   REST endpoints, key generation, E2E roundtrip
```

---

## 🔐 Security Architecture

### Threat Model

| Threat | Mitigation |
|---|---|
| Network eavesdropping | AES-256-GCM — ciphertext is opaque |
| Message tampering | GCM 128-bit auth tag — single bit change = rejection |
| Replay attacks | Timestamp window (5 min) in EncryptedPayload |
| Key compromise | Refresh every 5 messages — perfect forward secrecy |
| Quantum channel Eve | QBER monitoring — >25% error rate aborts exchange |
| Brute force | 2²⁵⁶ key space — infeasible for any computer |
| Unauthorized socket | JWT verified on every connect at socket layer |
| Unauthorized room entry | Server checks room membership before join_room |
| Stolen JWT | 24hr expiry + bcrypt-protected login |

### Known Limitations

- **Simulated quantum channel** — BB84 runs on Qiskit Aer (classical simulator). Real QKD requires physical single-photon sources and quantum repeaters.
- **In-memory store** — Users, rooms, and keys reset on server restart. Production use requires Redis/PostgreSQL.
- **P2P NAT traversal** — Uses Google's public STUN. Symmetric NAT environments may require a TURN server.

---

## 📊 Performance

| Metric | Value |
|---|---|
| BB84 simulation (128 qubits) | ~35ms |
| Key generation pipeline | < 200ms |
| AES-GCM encrypt/decrypt | < 1ms per message |
| P2P BB84 exchange (256 qubits) | < 500ms |
| JWT verification | < 1ms |
| Test suite | ~50 seconds |
| Frontend bundle | ~280KB gzipped |

---

## 🗺 Roadmap

- [x] BB84 QKD simulation (Qiskit 2.x)
- [x] AES-256-GCM server-side encryption
- [x] Flask-SocketIO real-time chat
- [x] WebRTC P2P zero-knowledge key exchange
- [x] Key version history (backward decryption)
- [x] JWT authentication + bcrypt
- [x] Admin dashboard — RBAC, room control, user approval
- [x] Emoji reactions, typing indicators, unread counter
- [x] Mobile responsive (safe-area, 100dvh)
- [ ] Redis persistent store — survive server restarts
- [ ] CRYSTALS-Kyber post-quantum hybrid mode
- [ ] TURN server — P2P behind symmetric NAT
- [ ] Real QKD hardware integration (IBM Quantum / IonQ)
- [ ] Progressive Web App — installable, push notifications

---

## 🙏 References

- Bennett & Brassard (1984) — [Quantum Cryptography: Public Key Distribution and Coin Tossing](https://arxiv.org/abs/2003.06557)
- Shor & Preskill (2000) — [Simple Proof of Security of the BB84 QKD Protocol](https://arxiv.org/abs/quant-ph/0003004)
- [Qiskit Documentation](https://docs.quantum.ibm.com/) — IBM Quantum SDK
- [NIST SP 800-38D](https://csrc.nist.gov/publications/detail/sp/800-38d/final) — GCM Mode Specification
- [RFC 5869](https://www.rfc-editor.org/rfc/rfc5869) — HKDF
- [RFC 7519](https://www.rfc-editor.org/rfc/rfc7519) — JSON Web Token
- [W3C Web Crypto API](https://www.w3.org/TR/WebCryptoAPI/) — Browser cryptography specification

---

## 👤 Author

**Sivaa S Hari Charan**

B.Tech Computer Science Engineering (Cybersecurity) — 2nd Year
Amrita Vishwa Vidyapeetham, Coimbatore

<p>
  <a href="https://github.com/sivaahari">
    <img src="https://img.shields.io/badge/GitHub-sivaahari-181717?style=for-the-badge&logo=github&logoColor=white" />
  </a>
  &nbsp;
  <a href="https://www.linkedin.com/in/sivaa-s-hari-charan/">
    <img src="https://img.shields.io/badge/LinkedIn-Sivaa%20S%20Hari%20Charan-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" />
  </a>
  &nbsp;
  <a href="mailto:cb.sc.u4cys24055@cb.students.amrita.edu">
    <img src="https://img.shields.io/badge/Email-cb.sc.u4cys24055-EA4335?style=for-the-badge&logo=gmail&logoColor=white" />
  </a>
</p>

---

<div align="center">

*Quantum Physics &times; Cryptography &times; Full-Stack Engineering &times; Access Control*

<br/>

⚛ &nbsp; If this project was useful or interesting, consider leaving a ⭐

<br/>

[![forthebadge](https://forthebadge.com/images/badges/built-with-science.svg)](https://forthebadge.com)
[![forthebadge](https://forthebadge.com/images/badges/made-with-python.svg)](https://forthebadge.com)
[![forthebadge](https://forthebadge.com/images/badges/check-it-out.svg)](https://quantum-secure-chat-blond.vercel.app)

</div>