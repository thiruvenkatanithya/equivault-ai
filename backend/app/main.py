import os
import json
from fastapi import FastAPI, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.responses import StreamingResponse
from datetime import datetime, timedelta
import jwt
from passlib.context import CryptContext
from dotenv import load_dotenv

from app.schemas import ChatRequest
from app.core.rag_chain import WebSearchError, equivault_agent
from app.core.guardrails import EquiVaultGuardrails
from app.core.logger import logger

load_dotenv()

app = FastAPI(title="EquiVault AI API")

# CORS for React Frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth Configuration
SECRET_KEY = os.getenv("JWT_SECRET", "super_secret_key_123")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# Mock User Database (In production, use PostgreSQL/MongoDB)
users_db = {
    "admin_user": {"username": "admin_user", "password": pwd_context.hash("admin123"), "role": "Admin"},
    "premium_user": {"username": "premium_user", "password": pwd_context.hash("premium123"), "role": "Premium"},
    "basic_user": {"username": "basic_user", "password": pwd_context.hash("basic123"), "role": "Basic"},
}

# --- Auth Helpers ---
def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username not in users_db:
            raise HTTPException(status_code=401, detail="User not found")
        return users_db[username]
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

# --- Endpoints ---

@app.post("/token")
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user = users_db.get(form_data.username)
    if not user or not pwd_context.verify(form_data.password, user["password"]):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    
    access_token = create_access_token(data={"sub": user["username"], "role": user["role"]})
    return {"access_token": access_token, "token_type": "bearer"}

def _sse_event(payload: dict) -> str:
    return f"data: {json.dumps(jsonable_encoder(payload), ensure_ascii=False)}\n\n"


def _message_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            item.get("text", "")
            for item in content
            if isinstance(item, dict) and isinstance(item.get("text"), str)
        )
    return ""


@app.post("/chat")
async def chat(request: ChatRequest, current_user: dict = Depends(get_current_user)):
    # Use a session_id from the request to ensure a fresh state per session
    # If no session_id is provided, fallback to user_id
    session_id = request.user_id 
    
    config = {"configurable": {"thread_id": session_id}}
    
    # Initial state
    initial_state = {
        "messages": [],
        "user_id": current_user["username"],
        "query": request.message,
        "user_role": current_user["role"],
        "context": [],
        "sources": [],
        "search_used": False,
        "search_web": request.search_web,
        "needs_web_search": False,
        "next_step": "",
        "final_answer": "",
        "requires_human": False
    }
    
    def stream_chat():
        yield _sse_event({
            "type": "status",
            "message": "Searching the web…" if request.search_web else "Checking your authorized sources…",
        })
        final_state = {}
        pending_text = ""
        accumulated_text = ""
        output_blocked = False
        max_phrase_length = max(map(len, EquiVaultGuardrails.FORBIDDEN_PHRASES))

        try:
            for mode, chunk in equivault_agent.stream(
                initial_state,
                config=config,
                stream_mode=["messages", "updates"],
            ):
                if mode == "messages":
                    message, metadata = chunk
                    if metadata.get("langgraph_node") not in {"generate", "web_search"}:
                        continue
                    text = _message_text(getattr(message, "content", ""))
                    if not text or output_blocked:
                        continue

                    accumulated_text += text
                    is_safe, _ = EquiVaultGuardrails.check_output(accumulated_text)
                    if not is_safe:
                        output_blocked = True
                        pending_text = ""
                        continue

                    pending_text += text
                    safe_length = len(pending_text) - max_phrase_length + 1
                    if safe_length > 0:
                        yield _sse_event({
                            "type": "token",
                            "text": pending_text[:safe_length],
                        })
                        pending_text = pending_text[safe_length:]
                elif mode == "updates":
                    for node, update in chunk.items():
                        final_state.update(update)
                        if node == "web_search" and not update.get("final_answer"):
                            yield _sse_event({"type": "status", "message": "Summarizing web results…"})

            if final_state.get("requires_human"):
                answer = (
                    "Your query requires advanced research. A human expert has been "
                    "notified to verify the web search. We will update you shortly."
                )
                status = "pending_human"
            else:
                answer = final_state.get("final_answer", "I'm sorry, I couldn't find an answer.")
                status = "needs_web_search" if final_state.get("needs_web_search", False) else "success"

            yield _sse_event({
                "type": "done",
                "answer": answer,
                "sources": final_state.get("sources", []),
                "search_used": final_state.get("search_used", False),
                "needs_web_search": final_state.get("needs_web_search", False),
                "stock_data": final_state.get("stock_data"),
                "market_data_notice": final_state.get("market_data_notice"),
                "status": status,
            })
        except WebSearchError as exc:
            yield _sse_event({"type": "error", "detail": str(exc)})
        except Exception:
            logger.exception("Chat stream failed for user %s", current_user["username"])
            yield _sse_event({
                "type": "error",
                "detail": "The response stream was interrupted. Please try again.",
            })

    return StreamingResponse(
        stream_chat(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@app.get("/me")
async def read_users_me(current_user: dict = Depends(get_current_user)):
    return {"username": current_user["username"], "role": current_user["role"]}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
