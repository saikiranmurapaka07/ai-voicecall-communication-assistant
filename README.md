# AI Accessible Communication Assistant V2

## Project name
AI Accessible Communication Assistant V2

## Problem statement
People with speech and communication disabilities often struggle to express themselves quickly and clearly in daily life. Standard keyboards, speech output, and assistive devices can be slow, poorly adapted to local languages, or difficult to use when the user is unable to type or speak normally.

## Solution
This project provides an accessible communication assistant that combines:
- AI-powered sentence improvement and translation
- eye-gaze interaction for selection and navigation
- keyboard-based phrase communication
- WebRTC voice calling for real-time communication
- TTS playback for spoken output
- multilingual support for English, Hindi, and Telugu

## Features
- AI sentence improvement and suggestion generation
- AI sentence completion
- Tone-based phrase refinement (Friendly, Calm, Polite, Urgent, Professional)
- Translation between English, Hindi, and Telugu
- Browser-based and server-based text-to-speech
- WebRTC peer-to-peer audio calling using PeerJS
- Gaze-based cursor control with long-blink selection
- Keyboard-based phrase entry and communication
- Local fallback responses when AI services are unavailable

## Technology stack
- Frontend: React + Vite
- UI: HTML, CSS, JavaScript, React components
- Backend: Python + FastAPI
- AI: OpenAI API (optional, configured through environment variables)
- Real-time communication: PeerJS + WebRTC
- Gaze support: MediaPipe Tasks Vision
- Audio: browser Speech Synthesis and server-side TTS audio generation
- Environment management: python-dotenv

## Frontend setup
From the project root:

```bash
npm install
npm run dev
```

The frontend is usually available at:

```text
http://localhost:5173
```

## Backend setup
Open a second terminal and run:

```bash
cd backend
python -m venv venv
```

On Windows:

```bash
venv\Scripts\activate
```

On macOS/Linux:

```bash
source venv/bin/activate
```

Then install dependencies:

```bash
pip install -r requirements.txt
```

Create your local environment file from the example:

```bash
copy .env.example .env
```

Or on Linux/macOS:

```bash
cp .env.example .env
```

Then start the API:

```bash
uvicorn main:app --reload --port 8000
```

## Environment variables
Required or optional variables are stored in `.env` files. Use placeholders and never commit real secrets.

```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_TEXT_MODEL=gpt-5.6-luna
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=alloy
DEV_HTTPS_CERT=
DEV_HTTPS_KEY=
```

Notes:
- `OPENAI_API_KEY` is required for cloud AI text and TTS features.
- `DEV_HTTPS_CERT` and `DEV_HTTPS_KEY` are optional local development certificate paths for Vite HTTPS mode.
- Never commit `.env` files to GitHub.

## How to run locally
1. Start the backend API from the `backend` folder.
2. Start the frontend from the project root with `npm run dev`.
3. Open the app in the browser.
4. For AI features, configure your OpenAI key in `backend/.env`.
5. For voice call testing, open the app in two browser tabs or on two devices and connect via PeerJS.

## WebRTC
This project uses PeerJS over WebRTC to establish direct peer-to-peer communication between clients. The app can generate a Peer ID, connect to a remote peer, and mix generated AI speech into the outgoing audio stream for the remote caller.

## AI features
The app supports:
- AI improvement of typed sentences
- AI completion of short phrases into fuller sentences
- smart suggestions based on context
- translation into multiple target languages
- AI-generated speech playback over live call audio

## TTS/STT
- Text-to-speech is provided through browser Speech Synthesis and, when configured, through the OpenAI TTS API.
- AI-generated audio can be injected into the WebRTC outgoing stream so the remote peer hears the spoken result.
- Microphone capture is used for real-time communication and audio streaming within the app flow.
- Speech-to-text functionality is not a primary standalone feature in this prototype and may rely on browser or backend integrations if extended later.

## Gaze communication
The app includes gaze tracking for user interaction using a webcam and MediaPipe face landmark detection. The system maps gaze direction to a keyboard or phrase panel and supports long-blink selection for a hands-free communication flow.

## Keyboard communication
The keyboard mode allows users to:
- type or compose messages
- use phrase chips for common needs
- apply AI improvements or translations
- trigger TTS or send speech over the call

## Translation
The app includes multilingual support with English, Hindi, and Telugu. Translation can be requested through the AI pipeline, and it falls back to a local demo translation map if the AI endpoint is unavailable.

## Notes for SIH deployment
This project is a working prototype designed for demonstration and accessibility research. It is not a production-grade telephony or security-hardened deployment and should be treated as a prototype architecture for public demo use, with proper environment configuration and deployment hardening before production release.

## Demo flow
1. Open the app on Laptop A and Laptop B (or two tabs).
2. Open the AI Voice Call screen.
3. Generate a Peer ID on each side.
4. Enter the remote ID on the caller side.
5. Start the call.
6. Type or select a phrase.
7. Trigger AI improvement or translation.
8. Use the speak or call audio flow to send the spoken result to the remote side.

Use headphones to avoid audio feedback during testing.
