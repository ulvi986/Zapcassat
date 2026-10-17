"""Conversation loop: model ↔ tool registry, persisted conversations and confirmable actions."""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.ai.guards import apply_guards, ungrounded_amounts
from app.ai.prompts import system_prompt
from app.ai.providers.base import LLMProvider, ProviderError
from app.ai.providers.openai_compat import OpenAICompatibleProvider
from app.ai.providers.rule_based import RuleBasedProvider
from app.ai.tools import TOOLS, ToolContext, format_validation_error, tools_for
from app.core.config import Settings
from app.core.errors import AppError, Conflict, NotFound, RateLimited, ValidationFailed
from app.models import AIAction, Business, Conversation, Message, Profile
from app.services.common import iso, to_jsonable, utc_now

log = logging.getLogger("zapcastsat.ai")

HISTORY_MESSAGES = 16
MAX_TOOL_RESULT_CHARS = 6000


def get_provider(settings: Settings) -> LLMProvider:
    if settings.llm_enabled:
        return OpenAICompatibleProvider(base_url=settings.llm_base_url, api_key=settings.llm_api_key or "",
                                        model=settings.llm_model, timeout=settings.llm_timeout_seconds)
    return RuleBasedProvider()


def provider_status(settings: Settings) -> dict:
    if settings.llm_enabled:
        return {"mode": "llm", "provider": "openai_compatible", "model": settings.llm_model, "streaming": True}
    return {"mode": "offline", "provider": "offline_parser", "model": RuleBasedProvider.model, "streaming": True,
            "note": "LLM_API_KEY təyin edilməyib: köməkçi deterministik oflayn analizatorla işləyir."}


# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------
def get_conversation(db: Session, user_id: uuid.UUID, conversation_id: uuid.UUID) -> Conversation:
    conv = db.scalar(select(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user_id))
    if conv is None:
        raise NotFound("Söhbət tapılmadı")
    return conv


def serialize_action(a: AIAction) -> dict:
    return {"id": str(a.id), "tool": a.tool_name, "arguments": a.arguments, "preview": a.preview, "status": a.status,
            "result": a.result, "error": a.error, "created_at": iso(a.created_at), "decided_at": iso(a.decided_at)}


def _refresh_action_blocks(blocks: list[dict], actions: dict[str, AIAction]) -> list[dict]:
    out = []
    for b in blocks or []:
        if b.get("type") == "action" and b.get("action", {}).get("id") in actions:
            b = {**b, "action": serialize_action(actions[b["action"]["id"]])}
        out.append(b)
    return out


def serialize_messages(db: Session, conv: Conversation) -> list[dict]:
    msgs = db.scalars(select(Message).where(Message.conversation_id == conv.id, Message.role != "tool")
                      .order_by(Message.created_at, Message.id)).all()
    actions = {str(a.id): a for a in db.scalars(select(AIAction).where(AIAction.conversation_id == conv.id)).all()}
    return [{"id": str(m.id), "role": m.role, "content": m.content, "blocks": _refresh_action_blocks(m.blocks, actions),
             "created_at": iso(m.created_at)} for m in msgs]


def _clean(text: Any) -> str:
    return " ".join(str(text).replace(";", ",").replace("[", "(").replace("]", ")").split())


def _action_subject(action: dict) -> str | None:
    args = action.get("arguments") or {}
    if args.get("name"):
        return args["name"]
    for f in (action.get("preview") or {}).get("fields") or []:
        if f.get("key") == "product":
            return str(f.get("value", "")).rsplit(" (", 1)[0] or None
    return None


def _context_refs(blocks: list[dict]) -> list[str]:
    """Facts an assistant message showed, so follow-ups work in both modes:
    «birincisinə təklif göndər» (listing ids), «onun qiymətini 95 et» (product name)."""
    refs: list[str] = []
    for b in blocks or []:
        kind = b.get("type")
        if kind == "listings":
            refs += [f"listing_id={r['listing']['id']} title={_clean(r['listing']['title'])}" for r in b.get("results", [])[:5]]
            qty = (b.get("criteria") or {}).get("quantity")
            if qty:
                refs.append(f"quantity={qty}")
        elif kind == "comparison":
            refs += [f"listing_id={o['id']} title={_clean(o['title'])}" for o in b.get("offers", [])[:5]]
        elif kind == "inventory_table":
            refs += [f"product={_clean(i['name'])}" for i in b.get("items", [])[:3]]
        elif kind == "action":
            subject = _action_subject(b["action"])
            if subject and b["action"]["tool"] != "create_quote_request":
                refs.append(f"product={_clean(subject)}")
            refs.append(f"action {b['action']['tool']} status={b['action']['status']}")
    return refs


def _history(db: Session, conv: Conversation) -> list[dict[str, Any]]:
    msgs = db.scalars(select(Message).where(Message.conversation_id == conv.id, Message.role.in_(("user", "assistant")))
                      .order_by(Message.created_at.desc(), Message.id.desc()).limit(HISTORY_MESSAGES)).all()
    out = []
    for m in reversed(msgs):
        content = m.content
        refs = _context_refs(m.blocks) if m.role == "assistant" else []
        if refs:
            content += "\n[context: " + "; ".join(refs) + "]"
        if content:
            out.append({"role": m.role, "content": content})
    return out


def _listing_ids_in(blocks: list[dict]) -> set[str]:
    ids: set[str] = set()
    for b in blocks or []:
        if b.get("type") == "listings":
            ids |= {r["listing"]["id"] for r in b.get("results", [])} | {a["id"] for a in b.get("alternatives", [])}
        elif b.get("type") == "comparison":
            ids |= {o["id"] for o in b.get("offers", [])}
    return ids


def _shown_listing_ids(db: Session, conv: Conversation) -> set[str]:
    ids: set[str] = set()
    for blocks in db.scalars(select(Message.blocks).where(Message.conversation_id == conv.id, Message.role == "assistant")):
        ids |= _listing_ids_in(blocks)
    return ids


def _check_limits(db: Session, settings: Settings, user: Profile) -> None:
    since = utc_now() - timedelta(days=1)
    count = db.scalar(select(func.count()).select_from(Message).where(
        Message.user_id == user.id, Message.role == "user", Message.created_at >= since)) or 0
    if count >= settings.ai_daily_message_limit:
        raise RateLimited("Gündəlik AI mesaj limitinə çatdınız. Sabah yenidən cəhd edin.", code="ai_daily_limit")


def run_turn(db: Session, settings: Settings, *, user: Profile, conv: Conversation, text: str,
             provider: LLMProvider | None = None) -> Iterator[dict[str, Any]]:
    """Process one user message. Yields stream events; persists everything it yields."""
    text = text.strip()
    if not text:
        raise ValidationFailed("Mesaj boşdur")
    if len(text) > 4000:
        raise ValidationFailed("Mesaj çox uzundur (maksimum 4000 simvol)")
    _check_limits(db, settings, user)
    provider = provider or get_provider(settings)

    business = db.get(Business, conv.business_id) if conv.business_id else None
    if conv.mode == "supplier":
        from app.services.accounts import require_member

        if business is None:
            raise NotFound("Biznes tapılmadı")
        require_member(db, user.id, business.id)  # re-check membership on every turn
    ctx = ToolContext(db=db, settings=settings, user=user, business=business, conversation_id=conv.id,
                      shown_listing_ids=_shown_listing_ids(db, conv))

    history = _history(db, conv)
    user_msg = Message(conversation_id=conv.id, user_id=user.id, role="user", content=text)
    db.add(user_msg)
    if conv.title in ("Yeni söhbət", "") and not history:
        conv.title = text[:60] + ("…" if len(text) > 60 else "")
    conv.updated_at = utc_now()
    db.commit()
    yield {"type": "user_message", "message": {"id": str(user_msg.id), "role": "user", "content": text, "blocks": [],
                                               "created_at": iso(user_msg.created_at)}}

    system = system_prompt(conv.mode, business.name if business else None)
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}, *history, {"role": "user", "content": text}]
    specs = tools_for(conv.mode)
    schemas = [s.openai_schema() for s in specs]
    allowed = {s.name for s in specs}

    assistant_text = ""
    blocks: list[dict[str, Any]] = []
    action_ids: list[uuid.UUID] = []
    evidence: list[str] = [text, *(m["content"] for m in history)]  # where quoted money amounts may come from
    try:
        for _ in range(settings.ai_max_tool_iterations):
            calls = []
            for ev in provider.stream(messages, schemas):
                if ev.type == "text" and ev.text:
                    assistant_text += ev.text
                    yield {"type": "token", "text": ev.text}
                elif ev.type == "tool_calls":
                    calls = ev.tool_calls
            if not calls:
                break
            if assistant_text and not assistant_text.endswith("\n"):
                assistant_text += "\n\n"
                yield {"type": "token", "text": "\n\n"}
            messages.append({"role": "assistant", "content": None, "tool_calls": [
                {"id": c.id, "type": "function", "function": {"name": c.name, "arguments": c.arguments}} for c in calls]})
            for call in calls:
                yield {"type": "tool_start", "tool": call.name}
                result, block = _execute_call(ctx, call.name, call.arguments, allowed)
                if block is not None:
                    if block.get("type") == "action":
                        action_ids.append(uuid.UUID(block["action"]["id"]))
                    ctx.shown_listing_ids |= _listing_ids_in([block])
                    blocks.append(block)
                    yield {"type": "block", "block": block}
                yield {"type": "tool_end", "tool": call.name, "ok": "error" not in result}
                content = json.dumps(to_jsonable(result), ensure_ascii=False)
                evidence.append(content)
                if len(content) > MAX_TOOL_RESULT_CHARS:
                    content = content[:MAX_TOOL_RESULT_CHARS] + "…(truncated)"
                messages.append({"role": "tool", "tool_call_id": call.id, "name": call.name, "content": content})
    except ProviderError as exc:
        log.warning("LLM provider error: %s", exc)
        note = "AI xidmətinə qoşulmaq mümkün olmadı. Bir az sonra yenidən cəhd edin."
        assistant_text += ("\n\n" if assistant_text else "") + note
        yield {"type": "error", "message": note, "retryable": True}

    # assertion on the answer itself: every money amount must come from tools or the conversation
    invented = ungrounded_amounts(assistant_text, evidence)
    if invented:
        log.warning("ungrounded amounts in assistant text: %s", invented)
        notice = {"type": "notice", "level": "warning",
                  "text": f"Cavabdakı {', '.join(invented[:3])} məbləği sistem məlumatlarında təsdiqlənmədi. "
                          "Yalnız kartlardakı rəqəmlərə etibar edin."}
        blocks.append(notice)
        yield {"type": "block", "block": notice}

    msg = Message(conversation_id=conv.id, user_id=user.id, role="assistant", content=assistant_text.strip(),
                  blocks=to_jsonable(blocks))
    db.add(msg)
    db.flush()
    if action_ids:
        db.execute(update(AIAction).where(AIAction.id.in_(action_ids)).values(message_id=msg.id))
    db.commit()
    yield {"type": "done", "message": {"id": str(msg.id), "role": "assistant", "content": msg.content, "blocks": msg.blocks,
                                       "created_at": iso(msg.created_at)}}


def _execute_call(ctx: ToolContext, name: str, raw_args: str, allowed: set[str]) -> tuple[dict, dict | None]:
    spec = TOOLS.get(name)
    if spec is None or name not in allowed:
        return {"error": f"Tool '{name}' is not available"}, None
    try:
        parsed = json.loads(raw_args or "{}")
        if not isinstance(parsed, dict):
            raise ValueError("arguments must be an object")
        args = spec.validate(parsed)
    except (ValueError, ValidationError) as exc:
        msg = format_validation_error(exc) if isinstance(exc, ValidationError) else str(exc)
        return {"error": f"Invalid arguments: {msg}"}, None
    try:
        args, warnings, blocked = apply_guards(ctx, name, args, spec.validate)
        if blocked:
            return {"error": blocked, "code": "guard_blocked"}, {"type": "notice", "level": "warning", "text": blocked}
        if spec.kind == "read":
            result, block = spec.run(ctx, args)
            if warnings:
                result = {**result, "warnings": warnings}
            return result, block
        preview = spec.preview(ctx, args)
        preview["warnings"] = [*warnings, *(preview.get("warnings") or [])]
        action = AIAction(conversation_id=ctx.conversation_id, user_id=ctx.user.id,
                          business_id=ctx.business.id if ctx.business else None, tool_name=name,
                          arguments=to_jsonable(args.model_dump(exclude_none=True)), preview=to_jsonable(preview))
        ctx.db.add(action)
        ctx.db.commit()
        return ({"status": "pending_confirmation", "action_id": str(action.id), "summary": preview.get("summary"),
                 "warnings": preview.get("warnings"), "missing": preview.get("missing")},
                {"type": "action", "action": serialize_action(action)})
    except ValidationError as exc:
        return {"error": f"Invalid arguments: {format_validation_error(exc)}"}, None
    except AppError as exc:
        ctx.db.rollback()
        return {"error": exc.message, "code": exc.code}, {"type": "notice", "level": "warning", "text": exc.message}


# ---------------------------------------------------------------------------
# Confirmation
# ---------------------------------------------------------------------------
def _load_action(db: Session, user: Profile, action_id: uuid.UUID) -> AIAction:
    a = db.scalar(select(AIAction).where(AIAction.id == action_id, AIAction.user_id == user.id))
    if a is None:
        raise NotFound("Əməliyyat tapılmadı")
    return a


def confirm_action(db: Session, settings: Settings, *, user: Profile, action_id: uuid.UUID,
                   overrides: dict[str, Any] | None) -> AIAction:
    action = _load_action(db, user, action_id)
    if action.status == "executed":
        return action  # idempotent replay
    if action.status != "pending":
        raise Conflict("Bu əməliyyat artıq bağlanıb", code="action_closed")
    spec = TOOLS[action.tool_name]
    conv = db.get(Conversation, action.conversation_id)
    business = None
    if action.business_id:
        from app.services.accounts import require_member

        business = require_member(db, user.id, action.business_id).business  # tenant re-check at execution time
    merged = {**action.arguments, **{k: v for k, v in (overrides or {}).items() if k in (spec.args_model.model_fields)}}
    try:
        args = spec.validate(merged)
    except ValidationError as exc:
        raise ValidationFailed(f"Yanlış məlumat: {format_validation_error(exc)}") from exc

    # Atomically claim the action so concurrent confirmations cannot execute it twice.
    claimed = db.execute(update(AIAction).where(AIAction.id == action.id, AIAction.status == "pending")
                         .values(status="executed", decided_at=utc_now())).rowcount
    if not claimed:
        db.rollback()
        db.refresh(action)
        if action.status == "executed":
            return action
        raise Conflict("Bu əməliyyat artıq bağlanıb", code="action_closed")
    ctx = ToolContext(db=db, settings=settings, user=user, business=business, conversation_id=conv.id)
    try:
        result = spec.commit(ctx, args, action.id)
        action.arguments = to_jsonable(args.model_dump(exclude_none=True))
        action.result = to_jsonable(result)
        action.error = None
        db.commit()
    except AppError as exc:
        # user-fixable (e.g. insufficient stock): keep it pending so it can be edited and retried
        db.rollback()
        action = _load_action(db, user, action_id)
        action.error = exc.message
        db.commit()
        raise
    except Exception:
        db.rollback()
        action = _load_action(db, user, action_id)
        action.status = "failed"
        action.error = "Gözlənilməz xəta baş verdi"
        db.commit()
        raise
    db.refresh(action)
    return action


def reject_action(db: Session, *, user: Profile, action_id: uuid.UUID) -> AIAction:
    action = _load_action(db, user, action_id)
    if action.status == "rejected":
        return action
    if action.status != "pending":
        raise Conflict("Bu əməliyyat artıq bağlanıb", code="action_closed")
    action.status = "rejected"
    action.decided_at = utc_now()
    db.commit()
    return action
