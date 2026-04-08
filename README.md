# Quantum Secure Chat

A full-stack secure chat application combining:
- **BB84 Quantum Key Distribution** (Qiskit + noise model)
- **AES-256-GCM end-to-end encryption** with quantum-derived keys
- **Real-time messaging** via Flask-SocketIO
- **React + Tailwind + shadcn/ui** frontend

## Screenshots
![Chat UI](docs/screenshots/chat_ui.png)
![Bloch Sphere](docs/screenshots/bloch_sphere.png)
![Key Visualization](docs/screenshots/key_viz.png)

## Quick Start
\\\powershell
# Backend
cd backend
.\.venv\Scripts\Activate.ps1
python app.py

# Frontend
cd frontend
npm run dev
\\\

## Architecture
- Backend: Python Flask + Flask-SocketIO (port 5000)
- Frontend: React + Vite (port 5173)
- Quantum: Qiskit Aer simulator (in-process)

## Requirements
See BATCH 1 of the build guide for full specs.
