import os, json, re, logging
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
app=FastAPI(title="AI Accessible Communication API")
# allow typical dev ports (5173/5174)
app.add_middleware(CORSMiddleware,allow_origins=["http://localhost:5173","http://127.0.0.1:5173","http://localhost:5174","http://127.0.0.1:5174"],allow_credentials=True,allow_methods=["*"],allow_headers=["*"])

class AIRequest(BaseModel):
    text:str
    action:str="improve"
    tone:str="Friendly"
    language:str="English"

class TTSRequest(BaseModel):
    text:str
    language: str = None

class TranslateRequest(BaseModel):
    text: str
    target_language: str

def translate_fallback(text, target):
    # Simple demo phrase map for Hindi and Telugu
    demos = {
        'I need some water.': {
            'Hindi': 'मुझे थोड़ा पानी चाहिए।',
            'Telugu': 'నాకు కొంచెం నీరు కావాలి.'
        },
        'I am hungry.': {
            'Hindi': 'मैं भूखा हूँ।',
            'Telugu': 'నేను ఆకలిగా ఉన్నాను.'
        },
        'I need help.': {
            'Hindi': 'मुझे मदद चाहिए।',
            'Telugu': 'నాకు సహాయం కావాలి.'
        },
        'Please wait.': {
            'Hindi': 'कृपया प्रतीक्षा करें।',
            'Telugu': 'దయచేసి వేచి ఉండండి.'
        },
        'Call my family.': {
            'Hindi': 'मेरे परिवार को बुलाओ।',
            'Telugu': 'నా కుటుంబాన్ని కాల్ చేయండి.'
        },
        'I need medical assistance.': {
            'Hindi': 'मुझे चिकित्सा सहायता की आवश्यकता है।',
            'Telugu': 'నాకు వైద్య సహాయం అవసరం.'
        },
        'Thank you.': {
            'Hindi': 'धन्यवाद।',
            'Telugu': 'ధన్యవాదాలు.'
        },
        'Good morning.': {
            'Hindi': 'सुप्रभात।',
            'Telugu': 'శుభోదయం.'
        },
        'Where are you going?': {
            'Hindi': 'तुम कहाँ जा रहे हो?',
            'Telugu': 'నువ్వు ఎక్కడికి వెళ్ళిపోతున్నావు?'
        },
        'I want to go home.': {
            'Hindi': 'मैं घर जाना चाहता/चाहती हूँ।',
            'Telugu': 'నేను ఇంటికి వెళ్లాలని కోరుకుంటున్నాను.'
        }
    }
    # Try exact match first, otherwise simple replaces/naive fallback
    if text.strip() in demos and target in demos[text.strip()]:
        return demos[text.strip()][target]
    # naive fallback: return original with marker
    return f"{text} ({target} translation demo)"


def run_openai_prompt(prompt):
    """Run the prompt using the modern OpenAI Python SDK.

    Behavior:
    - If the installed SDK exposes `client.responses`, use Responses API.
    - Otherwise, use `client.chat.completions.create` (modern chat completions).
    - On any API exception, raise so callers can fall back to local demo mapping.
    """
    key = os.getenv('OPENAI_API_KEY')
    if not key:
        raise RuntimeError('OPENAI_API_KEY not configured')
    model = os.getenv('OPENAI_TEXT_MODEL', 'gpt-5.6-luna')
    client = OpenAI(api_key=key)
    # Prefer Responses API when available
    try:
        if hasattr(client, 'responses'):
            r = client.responses.create(model=model, input=prompt)
            out = getattr(r, 'output_text', None)
            if out:
                return out.strip()
            # Try to extract from structured output if present
            try:
                # Some SDK versions expose r.output[0].content[0].text
                out2 = r.output[0].content[0].text
                if out2:
                    return out2.strip()
            except Exception:
                pass
            return str(r).strip()
        # Fallback to modern chat completions path
        if hasattr(client, 'chat') and hasattr(client.chat, 'completions'):
            r = client.chat.completions.create(model=model, messages=[{"role": "user", "content": prompt}])
            try:
                return r.choices[0].message.content.strip()
            except Exception:
                # some SDK variants return dict-like objects
                if isinstance(r, dict):
                    return r['choices'][0]['message']['content'].strip()
                return str(r).strip()
    except Exception:
        logging.exception('OpenAI API call failed')
        # Re-raise so callers can handle fallback behavior (do NOT expose API key)
        raise

def fallback(text, action, tone, language):
    base=text.strip()
    lang_code = "en"
    if language.lower().startswith("h") or language.lower().startswith("hin"): lang_code="hi"
    if language.lower().startswith("t") or language.lower().startswith("tel"): lang_code="te"
    translated = base if lang_code=="en" else base + f" ({language} translation demo)"
    if action=="complete":
        improved = base
        suggestions=[base+" Please help me.","Could you please wait?","I need more information."]
    elif action=="translate":
        improved = translated
        suggestions=[translated+"","Please translate this message.","I need translation help."]
    else:
        improved = translated if lang_code!="en" else base
        suggestions=[f"Could you please {base.lower()}?",f"I would like to say: {base}.",f"Please understand that {base.lower()}."]
    return {"original":base,"language":lang_code,"translated":translated,"improved":improved,"suggestions":suggestions}

@app.get("/api/health")
def health(): return {"ok":True}

@app.post("/api/ai")
def ai(req:AIRequest):
    key=os.getenv("OPENAI_API_KEY")
    if not key: return fallback(req.text,req.action,req.tone,req.language)
    client=OpenAI(api_key=key)
    # Build a structured prompt asking for JSON output including original, language, translated, improved, suggestions
    lang_code = "en"
    if req.language.lower().startswith("h") or req.language.lower().startswith("hin"): lang_code="hi"
    if req.language.lower().startswith("t") or req.language.lower().startswith("tel"): lang_code="te"
    prompt=f"""You are an assistive communication AI for a person who cannot speak normally.
Input sentence: {req.text}
Requested action: {req.action}
Tone: {req.tone}
Target language: {req.language} ({lang_code})

Return ONLY a single valid JSON object with these keys:
  - "original": the original input sentence (string)
  - "language": the two-letter language code to which translation applies ("en","hi","te")
  - "translated": the natural translation of the entire original sentence into the target language (if target is English, this may match original)
  - "improved": one natural final sentence in the target language that preserves the user's intent (for translate/improve actions)
  - "suggestions": an array of exactly 3 short alternative phrasings in the target language

Notes: Do NOT translate word-for-word. Translate the full sentence naturally preserving meaning. For action "complete", infer a likely intended full sentence. For "translate", produce only natural translation. For "improve", improve phrasing in the target language. Always return valid JSON only.
"""
    try:
        out = run_openai_prompt(prompt)
        # out should be JSON text per the prompt contract
        raw = re.sub(r"^```(?:json)?|```$","", out).strip()
        data = json.loads(raw)
        return {
            "original": data.get("original", req.text),
            "language": data.get("language", lang_code),
            "translated": data.get("translated", data.get("improved", req.text)),
            "improved": data.get("improved", req.text),
            "suggestions": (data.get("suggestions", []) or [])[:3]
        }
    except Exception:
        logging.exception('AI endpoint failed, using fallback')
        return fallback(req.text,req.action,req.tone,req.language)

@app.post("/api/tts")
def tts(req:TTSRequest):
    key=os.getenv("OPENAI_API_KEY")
    if not key: raise HTTPException(503,"OPENAI_API_KEY is not configured")
    client=OpenAI(api_key=key)
    try:
        audio=client.audio.speech.create(
            model=os.getenv("OPENAI_TTS_MODEL","gpt-4o-mini-tts"),
            voice=os.getenv("OPENAI_TTS_VOICE","alloy"),
            input=req.text,
            response_format="mp3")
        return Response(content=audio.content,media_type="audio/mpeg")
    except Exception as e:
        # Log full exception and traceback to the server terminal for debugging
        logging.exception("TTS generation failed")
        # Return a safe JSON error message to the client (do not expose details or API keys)
        return JSONResponse(status_code=500, content={"error":"TTS generation failed on server. Check server logs for details."})


@app.post('/api/translate')
def translate(req: TranslateRequest):
    # Prefer OpenAI if key present, otherwise use local demo fallback
    key=os.getenv('OPENAI_API_KEY')
    target=req.target_language or 'Hindi'
    text=req.text or ''
    # Normalize target string
    tnorm = target.strip().lower()
    if key:
        client=OpenAI(api_key=key)
        # instruct model to return only the translated sentence
        prompt=f"""Translate the following sentence into {target} naturally. Do NOT translate word-by-word. Return ONLY the translated sentence, no extra commentary.

Input: {text}
"""
        try:
            out = run_openai_prompt(prompt)
            out = re.sub(r"^```(?:\w+)?|```$","",out).strip()
            return { 'translated': out }
        except Exception:
            # fall through to local fallback
            logging.exception('Translation via OpenAI failed')
    # Local fallback mapping for demo phrases
    humanTarget = 'Hindi' if tnorm.startswith('h') else ('Telugu' if tnorm.startswith('t') else 'Hindi')
    translated = translate_fallback(text, humanTarget)
    return { 'translated': translated }