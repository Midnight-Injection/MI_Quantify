from fastapi import APIRouter, Body

from app.services.openclaw_service import build_diagnosis_context, diagnose_from_text

router = APIRouter()


@router.get("/diagnosis-context/{code}")
async def diagnosis_context(code: str):
    return {"data": build_diagnosis_context(code)}


@router.post("/diagnose")
async def diagnose(payload: dict = Body(default={})):
    text = str(payload.get("text", "") or "")
    code = payload.get("code")
    return diagnose_from_text(text=text, code=code)
