"""
Precleared — is it legal to cold-email this person? (https://precleared.dev)

Whether a cold email is allowed turns on facts the address doesn't show: a UK
recipient may be a limited company (fine under PECR) or a sole trader (needs
consent); Canada and Australia care how you got the address; the US wants an
opt-out and a postal address. Precleared looks those facts up live and answers
with one verdict per address, the rule it applied, what to do next and a signed
receipt id you can show later.

The sender asks once per **new** recipient, right before the first real email of a
campaign. Follow-ups, dry runs and ``off`` mode make no call. Settings
(``openleads config``, group ``sending``):

* ``precleared_mode``            ``hold`` (default) | ``warn`` | ``off``
* ``precleared_api_key``         optional; a free key raises the daily allowance
* ``precleared_sender_country``  ``GB`` (default) | ``US`` | ``AE``, where *you* send from

``hold`` sends only on ``ok_to_email`` and holds everything else, including a
check that couldn't run (no network, allowance used up, bad key): the hold line
says why, so nothing is skipped silently. ``warn`` records the verdict on the
contact's timeline and sends anyway.

Definite verdicts (ok_to_email, consent_needed, blocked) are kept in the ``kv``
table for CACHE_DAYS, keyed on the address and the facts sent with it, so a held
lead tried again, or emailed from another campaign, costs no new check;
``unknown`` is never kept. Without a key Precleared allows 10 checks a day per
network. When that runs out the sender asks for a free key with your sending
address, stores it in ``secrets.json`` and carries on. Stdlib only, like the rest
of the engine. Decision support, not legal advice.
"""
from __future__ import annotations

import hashlib
import http.client
import json
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

from openleads import settings

API_URL = "https://precleared.dev/api/v1/check?src=openleads"
GET_KEY_URL = "https://precleared.dev/get-key"
USER_AGENT = "openleads (+https://github.com/Samyrrrrrr990/openleads)"
CONNECT_TIMEOUT = 10
READ_TIMEOUT = 30
MAX_RETRY_WAIT = 60             # longest we wait on a per-minute rate limit
CACHE_DAYS = 30
KV_PREFIX = "precleared:"       # one kv row per address: precleared:<email>
PREFIX = "precleared: "         # every hold line starts with this
MODES = ("hold", "warn", "off")
SENDER_COUNTRIES = ("GB", "US", "AE")
DEFINITE = ("ok_to_email", "consent_needed", "blocked")
VERDICTS = DEFINITE + ("unknown",)
MAX_COMPANY_NAME, MAX_RECIPIENT_NAME, MAX_PITCH = 160, 120, 200

# Country names a lead record may carry, for the countries Precleared covers.
# Anything else (or a name we don't know) is left for Precleared to work out.
_COUNTRIES = {
    "gb": "GB", "uk": "GB", "united kingdom": "GB", "great britain": "GB", "england": "GB",
    "scotland": "GB", "wales": "GB", "northern ireland": "GB",
    "us": "US", "usa": "US", "united states": "US", "united states of america": "US",
    "ca": "CA", "canada": "CA", "de": "DE", "germany": "DE", "deutschland": "DE",
    "fr": "FR", "france": "FR", "au": "AU", "australia": "AU", "ie": "IE", "ireland": "IE",
    "nl": "NL", "netherlands": "NL", "the netherlands": "NL", "holland": "NL",
}


@dataclass
class Verdict:
    """Precleared's answer for one address, or why there isn't one."""

    email: str = ""
    verdict: str = ""       # ok_to_email | consent_needed | blocked | unknown | "" (no answer)
    reason: str = ""        # the rule that decided it, in plain words
    next_step: str = ""     # what to do about a held address
    receipt_id: str = ""    # Precleared's signed receipt, for showing the check later
    error: str = ""         # why the check couldn't run (verdict is "" then)
    pause: bool = False     # the error is about Precleared, not this address
    cached: bool = False

    @property
    def ok(self) -> bool:
        return self.verdict == "ok_to_email"

    def summary(self) -> str:
        """One line for the send result and the timeline, always starting with PREFIX."""
        if not self.verdict:
            return f"{PREFIX}not checked. {self.error}"
        parts = [f"{PREFIX}{self.verdict}."]
        if self.reason:
            parts.append(self.reason)
        if self.next_step:
            parts.append(f"Next step: {self.next_step}")
        if self.receipt_id:
            parts.append(f"Receipt {self.receipt_id}.")
        return " ".join(parts)


# --- settings ------------------------------------------------------------------ #
def current_mode() -> str:
    """``hold`` | ``warn`` | ``off`` from the settings; anything odd means hold."""
    value = str(settings.get("precleared_mode") or "hold").strip().lower()
    return value if value in MODES else "hold"


def held_verdict(detail: str) -> str:
    """The verdict named in a sender hold line (``"precleared: consent_needed. …"``),
    or "" for anything else, including a check that could not run."""
    if not (detail or "").startswith(PREFIX):
        return ""
    word = detail[len(PREFIX):].split(".", 1)[0]
    return word if word in VERDICTS else ""


# --- what we tell Precleared ---------------------------------------------------- #
def country_code(value) -> str:
    """A two-letter code from a lead's country field, or "" unless we're sure."""
    text = " ".join(str(value or "").split()).lower().strip(".")
    if text in _COUNTRIES:
        return _COUNTRIES[text]
    return text.upper() if len(text) == 2 and text.isascii() and text.isalpha() else ""


def address_source(lead: dict) -> str:
    """How OpenLeads got the address, in Precleared's words: an address harvested
    from a public page (``groundtruth_exact``) was scraped; one built from a pattern,
    guessed, or imported from a file is unknown. Precleared decides what counts as
    published; we never claim it."""
    data = lead.get("data")
    if isinstance(data, str):
        try:
            data = json.loads(data or "{}")
        except ValueError:
            data = {}
    signals = (data or {}).get("signals") if isinstance(data, dict) else None
    signals = signals or lead.get("signals") or {}
    return "scraped" if signals.get("groundtruth_exact") else "unknown"


def payload_for(email: str, lead: dict | None = None) -> dict:
    """The check request: the address, where you send from, how we got the address
    and, when we have them, the recipient's company, name and country. The names
    help Precleared find a UK company at Companies House; it doesn't store them."""
    lead = lead or {}
    body = {
        "recipient_email": email,
        "sender_country": str(settings.get("precleared_sender_country") or "GB").strip().upper(),
        "address_source": address_source(lead),
        "existing_customer": lead.get("stage") == "customer",
    }
    pitch = _text(settings.get("sender_context"), MAX_PITCH)
    if pitch:
        body["pitch"] = pitch
    company = _text(lead.get("organization"), MAX_COMPANY_NAME)
    if company:
        body["company_name"] = company
    name = _text(lead.get("name") or f"{lead.get('first_name') or ''} {lead.get('last_name') or ''}",
                 MAX_RECIPIENT_NAME)
    if name:
        body["recipient_name"] = name
    country = country_code(lead.get("country"))
    if country:
        body["recipient_country"] = country
    return body


def _fingerprint(payload: dict) -> str:
    facts = {k: v for k, v in payload.items() if k != "recipient_email"}
    return hashlib.sha1(json.dumps(facts, sort_keys=True).encode()).hexdigest()[:16]


# --- the 30-day cache (kv table) ------------------------------------------------ #
def cached(db, email: str, payload: dict) -> Verdict | None:
    """The stored verdict for this address and these facts, if still good."""
    row = db.kv_get(KV_PREFIX + email) if db is not None else None
    if not isinstance(row, dict) or row.get("inputs") != _fingerprint(payload):
        return None
    if row.get("verdict") not in DEFINITE:
        return None
    try:
        age = time.time() - float(row.get("checked") or 0)
    except (TypeError, ValueError):
        return None
    if not 0 <= age <= CACHE_DAYS * 86400:
        return None
    return Verdict(email, verdict=row["verdict"], reason=_text(row.get("reason")),
                   next_step=_text(row.get("next_step")), receipt_id=_text(row.get("receipt_id")),
                   cached=True)


def remember(db, v: Verdict, payload: dict) -> None:
    """Keep a definite verdict for CACHE_DAYS. ``unknown`` and failures are not kept."""
    if db is None or v.verdict not in DEFINITE:
        return
    db.kv_set(KV_PREFIX + v.email, {
        "verdict": v.verdict, "reason": v.reason, "next_step": v.next_step,
        "receipt_id": v.receipt_id, "checked": time.time(), "inputs": _fingerprint(payload),
    })


# --- the batch gate used by the sender ------------------------------------------ #
class Checker:
    """The check for one send batch.

    Remembers an answer that is about Precleared rather than an address (no
    connection, allowance used up, a bad key), so the rest of the batch is held
    with that reason instead of each address waiting on its own failed call.
    Stored verdicts are still used while that lasts.
    """

    def __init__(self, db, operator_email: str = "", mode: str | None = None):
        self.db = db
        self.operator_email = operator_email or ""
        self.mode = mode or current_mode()
        self.paused = ""        # why fresh checks stopped for this batch

    def gate(self, email: str) -> str:
        """Why the first email to ``email`` must wait, or "" to send it.

        Records anything other than ok_to_email on the contact's timeline with the
        reason, the next step and the receipt id. In warn mode that's all: the
        email goes. Off makes no call.
        """
        if self.mode == "off":
            return ""
        lead = self.db.get_lead(email) if self.db is not None else None
        payload = payload_for(email, lead)
        v = cached(self.db, email, payload)
        if v is None and self.paused:
            v = Verdict(email, error=self.paused)
        elif v is None:
            v = check(payload, self.operator_email)
            remember(self.db, v, payload)
            if v.pause:
                self.paused = v.error
        if v.ok:
            return ""
        record(self.db, v, held=self.mode == "hold")
        return v.summary() if self.mode == "hold" else ""


def record(db, v: Verdict, held: bool = True) -> None:
    """Put the verdict on the contact's timeline (dashboard record, ``people show``)."""
    if db is None:
        return
    from openleads.workspace import activity
    activity.log(db, "contact", v.email, "precleared",
                 ("held: " if held else "sent anyway (warn mode): ") + v.summary(),
                 {"verdict": v.verdict, "reason": v.reason, "next_step": v.next_step,
                  "receipt_id": v.receipt_id, "error": v.error, "held": held})


# --- talking to the API ---------------------------------------------------------- #
def check(payload: dict, operator_email: str = "") -> Verdict:
    """Ask Precleared now. One retry on a per-minute rate limit; when the keyless
    daily allowance is used up and we know the sender's address, get a free key
    with it, store it, and ask again once."""
    api_key = str(settings.get("precleared_api_key") or "").strip()
    status, body = _post(API_URL, payload, api_key)
    if status == 429 and body.get("error") == "rate_limited":
        time.sleep(_retry_after(body))
        status, body = _post(API_URL, payload, api_key)
    elif status == 429 and not api_key and isinstance(body.get("create_key"), dict):
        api_key = _create_key(body["create_key"], operator_email)
        if api_key:
            status, body = _post(API_URL, payload, api_key)
    return _verdict(payload["recipient_email"], status, body)


def _verdict(email: str, status: int, body: dict) -> Verdict:
    if status == 200:
        verdict = body.get("verdict")
        if verdict not in VERDICTS:
            return Verdict(email, error="Precleared answered without a verdict", pause=True)
        receipt = body.get("receipt")
        return Verdict(email, verdict=verdict, reason=_reason(body),
                       next_step=_text(body.get("next_step")),
                       receipt_id=_text(receipt.get("id")) if isinstance(receipt, dict) else "")
    # What Precleared wants the person running the tool to read, when it says.
    message = (_text(body.get("operator_message")) or _text(body.get("next_step"))
               or _text(body.get("message")))
    code = _text(body.get("error"), 80)
    if status == 0:
        return Verdict(email, pause=True, error=f"Precleared could not be reached ({code or 'no answer'})")
    if status == 400:
        return Verdict(email, error=f"Precleared rejected the request: {message or code or 'bad field'}")
    if status == 401:
        return Verdict(email, pause=True, error="Precleared rejected PRECLEARED_API_KEY (wrong or "
                       f"revoked); check it, or get a new free key at {GET_KEY_URL}")
    if status == 402:
        url = _text(body.get("buy_url"))
        extra = f" {url}" if url.startswith("https://") and url not in message else ""
        return Verdict(email, pause=True, error=(message or "your Precleared key has no checks "
                                                            "left for today") + extra)
    if status == 429 and code == "rate_limited":
        return Verdict(email, pause=True, error=message or "Precleared is limiting how fast we "
                       "can check; it will be tried again next run")
    if status == 429:
        return Verdict(email, pause=True, error=message or "Precleared's free daily allowance is "
                       f"used up; a free key gives more: {GET_KEY_URL}")
    return Verdict(email, pause=True, error=f"Precleared is unavailable (HTTP {status}); "
                   "it will be tried again next run")


def _reason(body: dict) -> str:
    """The first reason's text (or note), with its source title when there is one."""
    reasons = body.get("reasons")
    first = reasons[0] if isinstance(reasons, list) and reasons and isinstance(reasons[0], dict) else {}
    text = _text(first.get("text")) or _text(first.get("note"))
    source = _text(first.get("source_title"), 80)
    return f"{text} ({source})" if text and source else text


def _retry_after(body: dict) -> float:
    try:
        wait = float(body.get("retry_after") or 5)
    except (TypeError, ValueError):
        wait = 5.0
    return min(max(wait, 1.0), float(MAX_RETRY_WAIT))


def _create_key(spec: dict, operator_email: str) -> str:
    """Ask for a free key with the sender's address, the way the 429 answer says
    to, and store it. Returns the key, or "" when that isn't possible."""
    email = (operator_email or "").strip()
    url = _text(spec.get("url"), 300)
    if "@" not in email or not url.startswith("https://precleared.dev/"):
        return ""
    if _text(spec.get("method")).upper() not in ("", "POST"):
        return ""
    body = dict(spec["body"]) if isinstance(spec.get("body"), dict) else {}
    body["email"] = email
    status, answer = _post(url, body)
    key = _text(answer.get("api_key") or answer.get("key"), 200)
    if status not in (200, 201) or not re.fullmatch(r"[!-~]+", key):
        return ""
    try:
        settings.set("precleared_api_key", key)
    except (OSError, KeyError, ValueError):
        pass  # still good for this batch; the next keyless 429 asks again
    return key


class _Connection(http.client.HTTPSConnection):
    """Connect within CONNECT_TIMEOUT, then allow READ_TIMEOUT per read: urllib
    has one timeout for both, and a register lookup can take a while."""

    def connect(self):
        self.timeout = CONNECT_TIMEOUT
        super().connect()
        self.sock.settimeout(READ_TIMEOUT)


class _Handler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(_Connection, req, context=self._context)


_opener = urllib.request.build_opener(_Handler)


def _post(url: str, payload: dict, api_key: str = "") -> tuple:
    """POST JSON and return ``(status, body)``. Status 0 means no answer, with the
    reason in ``body["error"]``. Never raises."""
    headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers=headers, method="POST")
    try:
        with _opener.open(req, timeout=READ_TIMEOUT) as r:
            status, raw, retry = r.status, r.read(), r.headers.get("Retry-After")
    except urllib.error.HTTPError as e:
        status, raw, retry = e.code, e.read(), e.headers.get("Retry-After")
    except (OSError, http.client.HTTPException, ValueError) as e:
        return 0, {"error": str(getattr(e, "reason", None) or e)}
    try:
        body = json.loads(raw.decode("utf-8", "replace")) if raw else {}
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}
    if retry and "retry_after" not in body:
        body["retry_after"] = retry
    return status, body


def _text(value, limit: int = 300) -> str:
    """A string from the API or a record, on one line, printable, cut to ``limit``."""
    if not isinstance(value, str):
        return ""
    return "".join(ch if ch.isprintable() else " " for ch in " ".join(value.split()))[:limit].strip()
