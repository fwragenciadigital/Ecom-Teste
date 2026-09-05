"""Coleta gratuita pela ESPN pública e publicação segura no Worker BotBet."""

from __future__ import annotations

import json
import os
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parent
OUTPUT = Path(os.getenv("BOTBET_OUTPUT", ROOT / "latest_run.json"))
ESPN = "https://site.api.espn.com/apis"
DEFAULT_LEAGUES = "eng.1,esp.1,ita.1,ger.1,bra.1"
LEAGUE_NAMES = {
    "eng.1": "Premier League",
    "esp.1": "La Liga",
    "ita.1": "Serie A",
    "ger.1": "Bundesliga",
    "bra.1": "Brasileirão Série A",
}
LEAGUES = [item.strip() for item in os.getenv("BOTBET_LEAGUES", DEFAULT_LEAGUES).split(",") if item.strip()]
DISPLAY_TIMEZONE = ZoneInfo(os.getenv("BOTBET_TIMEZONE", "America/Sao_Paulo"))
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; BotBetMonitor/1.0; +https://botbet-monitor.botbetwill.workers.dev/)",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
})


def selected_day(now: datetime) -> date:
    requested = os.getenv("BOTBET_TARGET_DATE", "").strip()
    if not requested:
        return now.astimezone(DISPLAY_TIMEZONE).date()
    try:
        return date.fromisoformat(requested)
    except ValueError as error:
        raise ValueError("BOTBET_TARGET_DATE deve usar o formato AAAA-MM-DD") from error


def get_json(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    response = SESSION.get(f"{ESPN}{path}", params=params, timeout=30)
    if not response.ok:
        raise RuntimeError(f"ESPN {response.status_code}")
    return response.json()


def stat(entry: dict[str, Any], name: str) -> int | None:
    item = next((item for item in entry.get("stats", []) if item.get("name") == name), None)
    try:
        return int(float(item["value"])) if item else None
    except (KeyError, TypeError, ValueError):
        return None


def standings(slug: str, season: int) -> dict[str, dict[str, int]]:
    data = get_json(f"/v2/sports/soccer/{slug}/standings", {"season": season})
    entries = [entry for group in data.get("children", []) for entry in group.get("standings", {}).get("entries", [])]
    result: dict[str, dict[str, int]] = {}
    for entry in entries:
        team_id = str(entry.get("team", {}).get("id", ""))
        points, rank = stat(entry, "points"), stat(entry, "rank")
        if team_id and points is not None and rank is not None:
            result[team_id] = {"points": points, "rank": rank}
    return result


def scoreboard(slug: str, target_day: date) -> list[dict[str, Any]]:
    data = get_json(
        f"/site/v2/sports/soccer/{slug}/scoreboard",
        {"dates": target_day.strftime("%Y%m%d"), "limit": 1000},
    )
    return data.get("events", [])


def form_text(form: dict[str, int]) -> str:
    return f"{form['wins']}V {form['draws']}E {form['losses']}D"


def team_form(slug: str, team_id: str, venue: str, before: datetime) -> dict[str, int] | None:
    data = get_json(f"/site/v2/sports/soccer/{slug}/teams/{team_id}/schedule", {"limit": 100})
    outcomes: list[str] = []
    for event in sorted(data.get("events", []), key=lambda item: item.get("date", ""), reverse=True):
        competition = (event.get("competitions") or [{}])[0]
        status = competition.get("status", {}).get("type", {})
        if not status.get("completed"):
            continue
        try:
            kickoff = datetime.fromisoformat(event["date"].replace("Z", "+00:00"))
        except (KeyError, TypeError, ValueError):
            continue
        if kickoff >= before:
            continue
        mine = next((item for item in competition.get("competitors", []) if str(item.get("team", {}).get("id")) == team_id), None)
        opponent = next((item for item in competition.get("competitors", []) if str(item.get("team", {}).get("id")) != team_id), None)
        if not mine or not opponent or mine.get("homeAway") != venue:
            continue
        try:
            own, theirs = int(mine["score"]), int(opponent["score"])
        except (KeyError, TypeError, ValueError):
            continue
        outcomes.append("W" if own > theirs else "D" if own == theirs else "L")
        if len(outcomes) == 5:
            break
    if len(outcomes) < 5:
        return None
    return {"wins": outcomes.count("W"), "draws": outcomes.count("D"), "losses": outcomes.count("L")}


def candidate(event: dict[str, Any], slug: str, table: dict[str, dict[str, int]], form_cache: dict[tuple[str, str, str, str], dict[str, int] | None]) -> dict[str, Any] | None:
    competition = (event.get("competitions") or [{}])[0]
    if competition.get("status", {}).get("type", {}).get("state") != "pre":
        return None
    home = next((item for item in competition.get("competitors", []) if item.get("homeAway") == "home"), None)
    away = next((item for item in competition.get("competitors", []) if item.get("homeAway") == "away"), None)
    if not home or not away:
        return None
    home_id, away_id = str(home.get("team", {}).get("id", "")), str(away.get("team", {}).get("id", ""))
    if home_id not in table or away_id not in table or table[home_id]["points"] == table[away_id]["points"]:
        return None
    favorite = home if table[home_id]["points"] > table[away_id]["points"] else away
    underdog = away if favorite is home else home
    favorite_id, underdog_id = str(favorite["team"]["id"]), str(underdog["team"]["id"])
    side = "casa" if favorite is home else "fora"
    underdog_side = "fora" if side == "casa" else "casa"
    gap = table[favorite_id]["points"] - table[underdog_id]["points"]
    if gap < 6:
        return None
    try:
        kickoff = datetime.fromisoformat(event["date"].replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        return None

    def form(team_id: str, venue: str) -> dict[str, int] | None:
        key = (slug, team_id, venue, kickoff.isoformat())
        if key not in form_cache:
            form_cache[key] = team_form(slug, team_id, venue, kickoff)
        return form_cache[key]

    favorite_form, underdog_form = form(favorite_id, side), form(underdog_id, underdog_side)
    if not favorite_form or not underdog_form:
        return None
    if favorite_form["losses"] > 1 or favorite_form["draws"] > 1:
        return None
    if underdog_form["wins"] > 1 or underdog_form["losses"] < 3:
        return None
    home_name = home.get("team", {}).get("displayName", "Casa")
    away_name = away.get("team", {}).get("displayName", "Fora")
    favorite_name = favorite.get("team", {}).get("displayName", "Favorito")
    return {
        "id": str(event.get("id", f"{slug}:{home_id}:{away_id}:{kickoff.isoformat()}")),
        "league": LEAGUE_NAMES.get(slug, slug),
        "home": home_name,
        "away": away_name,
        "time": kickoff.astimezone(DISPLAY_TIMEZONE).strftime("%d/%m %H:%M"),
        "favorite": favorite_name,
        "side": side,
        "table": f"{table[favorite_id]['rank']}º ({table[favorite_id]['points']} pts) × {table[underdog_id]['rank']}º ({table[underdog_id]['points']} pts) | +{gap} pts",
        "favoriteForm": form_text(favorite_form),
        "underdogForm": form_text(underdog_form),
    }


def collect() -> dict[str, Any]:
    now = datetime.now(UTC)
    target_day = selected_day(now)
    matches: list[dict[str, Any]] = []
    checked = 0
    failures: list[str] = []
    form_cache: dict[tuple[str, str, str, str], dict[str, int] | None] = {}
    for slug in LEAGUES:
        try:
            events, table = scoreboard(slug, target_day), standings(slug, target_day.year)
            checked += len(events)
            for event in events:
                result = candidate(event, slug, table, form_cache)
                if result:
                    matches.append(result)
        except Exception as error:
            failures.append(f"{LEAGUE_NAMES.get(slug, slug)}: {error}")
    return {
        "date": target_day.isoformat(),
        "runAt": datetime.now(UTC).isoformat(),
        "source": "ESPN pública",
        "checked": checked,
        "totalToday": checked,
        "approved": len(matches),
        "matches": matches,
        "failures": len(failures),
        "failureReasons": failures[:5],
    }


def publish(result: dict[str, Any]) -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    url, secret = os.getenv("BOTBET_INGEST_URL"), os.getenv("BOTBET_INGEST_SECRET")
    if not url or not secret:
        return
    response = requests.post(url, json=result, headers={"X-Ingest-Secret": secret}, timeout=30)
    response.raise_for_status()


if __name__ == "__main__":
    result = collect()
    publish(result)
    print(json.dumps({key: result[key] for key in ("date", "checked", "approved", "failures")}, ensure_ascii=False))
