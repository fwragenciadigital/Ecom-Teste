"""Coleta gratuita com football-data.org e publicação segura no Worker BotBet."""

from __future__ import annotations

import json
import os
import time
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
OUTPUT = Path(os.getenv("BOTBET_OUTPUT", ROOT / "latest_run.json"))
API = "https://api.football-data.org/v4"
LEAGUES = [item.strip() for item in os.getenv("BOTBET_LEAGUES", "PL,PD,SA,BL1,BSA").split(",") if item.strip()]
LEAGUE_NAMES = {"PL": "Premier League", "PD": "La Liga", "SA": "Serie A", "BL1": "Bundesliga", "BSA": "Brasileirão Série A"}
DISPLAY_TIMEZONE = ZoneInfo(os.getenv("BOTBET_TIMEZONE", "America/Sao_Paulo"))
LAST_REQUEST_AT = 0.0


def selected_day(now: datetime) -> date:
    requested = os.getenv("BOTBET_TARGET_DATE", "").strip()
    if not requested:
        return now.astimezone(DISPLAY_TIMEZONE).date()
    try:
        return date.fromisoformat(requested)
    except ValueError as error:
        raise ValueError("BOTBET_TARGET_DATE deve usar o formato AAAA-MM-DD") from error


def season_year(league: str, target_day: date) -> int:
    if league == "BSA":
        return target_day.year
    return target_day.year if target_day.month >= 7 else target_day.year - 1


def kickoff(match: dict[str, Any]) -> datetime:
    return datetime.fromisoformat(match["utcDate"].replace("Z", "+00:00"))


def get_matches(token: str, league: str, season: int) -> list[dict[str, Any]]:
    global LAST_REQUEST_AT
    wait_for = 6.1 - (time.monotonic() - LAST_REQUEST_AT)
    if wait_for > 0:
        time.sleep(wait_for)
    request = Request(
        f"{API}/competitions/{league}/matches?{urlencode({'season': season})}",
        headers={"X-Auth-Token": token, "Accept": "application/json"},
    )
    try:
        with urlopen(request, timeout=30) as response:
            LAST_REQUEST_AT = time.monotonic()
            return json.load(response).get("matches", [])
    except HTTPError as error:
        raise RuntimeError(f"Football-Data {error.code}") from error


def finished(match: dict[str, Any]) -> bool:
    score = match.get("score", {}).get("fullTime", {})
    return match.get("status") == "FINISHED" and score.get("home") is not None and score.get("away") is not None


def table_before(matches: list[dict[str, Any]], before: datetime) -> dict[int, dict[str, int]]:
    table: dict[int, dict[str, int]] = {}
    for match in matches:
        if not finished(match) or kickoff(match) >= before:
            continue
        home, away = match["homeTeam"], match["awayTeam"]
        home_id, away_id = int(home["id"]), int(away["id"])
        home_row = table.setdefault(home_id, {"points": 0, "played": 0, "gf": 0, "ga": 0})
        away_row = table.setdefault(away_id, {"points": 0, "played": 0, "gf": 0, "ga": 0})
        home_goals, away_goals = int(match["score"]["fullTime"]["home"]), int(match["score"]["fullTime"]["away"])
        home_row["played"] += 1
        away_row["played"] += 1
        home_row["gf"] += home_goals
        home_row["ga"] += away_goals
        away_row["gf"] += away_goals
        away_row["ga"] += home_goals
        if home_goals > away_goals:
            home_row["points"] += 3
        elif away_goals > home_goals:
            away_row["points"] += 3
        else:
            home_row["points"] += 1
            away_row["points"] += 1
    ordered = sorted(table.items(), key=lambda item: (item[1]["points"], item[1]["gf"] - item[1]["ga"], item[1]["gf"]), reverse=True)
    return {team_id: {**row, "rank": position} for position, (team_id, row) in enumerate(ordered, start=1)}


def same_venue_form(matches: list[dict[str, Any]], team_id: int, venue: str, before: datetime) -> dict[str, int] | None:
    outcomes: list[str] = []
    for match in sorted(matches, key=kickoff, reverse=True):
        if not finished(match) or kickoff(match) >= before:
            continue
        is_home = int(match["homeTeam"]["id"]) == team_id
        is_away = int(match["awayTeam"]["id"]) == team_id
        if (venue == "casa" and not is_home) or (venue == "fora" and not is_away):
            continue
        home_goals, away_goals = int(match["score"]["fullTime"]["home"]), int(match["score"]["fullTime"]["away"])
        own, opponent = (home_goals, away_goals) if is_home else (away_goals, home_goals)
        outcomes.append("W" if own > opponent else "D" if own == opponent else "L")
        if len(outcomes) == 5:
            break
    if len(outcomes) < 5:
        return None
    return {"wins": outcomes.count("W"), "draws": outcomes.count("D"), "losses": outcomes.count("L")}


def form_text(form: dict[str, int]) -> str:
    return f"{form['wins']}V {form['draws']}E {form['losses']}D"


def candidate(match: dict[str, Any], league: str, current_season: list[dict[str, Any]], form_history: list[dict[str, Any]]) -> dict[str, Any] | None:
    match_kickoff = kickoff(match)
    home, away = match["homeTeam"], match["awayTeam"]
    home_id, away_id = int(home["id"]), int(away["id"])
    table = table_before(current_season, match_kickoff)
    if home_id not in table or away_id not in table or table[home_id]["points"] == table[away_id]["points"]:
        return None
    favorite, underdog = (home, away) if table[home_id]["points"] > table[away_id]["points"] else (away, home)
    favorite_id, underdog_id = int(favorite["id"]), int(underdog["id"])
    side = "casa" if favorite_id == home_id else "fora"
    underdog_side = "fora" if side == "casa" else "casa"
    gap = table[favorite_id]["points"] - table[underdog_id]["points"]
    if gap < 6:
        return None
    favorite_form = same_venue_form(form_history, favorite_id, side, match_kickoff)
    underdog_form = same_venue_form(form_history, underdog_id, underdog_side, match_kickoff)
    if not favorite_form or not underdog_form:
        return None
    if favorite_form["losses"] > 1 or favorite_form["draws"] > 1 or underdog_form["wins"] > 1 or underdog_form["losses"] < 3:
        return None
    return {
        "id": str(match["id"]),
        "league": LEAGUE_NAMES.get(league, league),
        "home": home["name"],
        "away": away["name"],
        "time": match_kickoff.astimezone(DISPLAY_TIMEZONE).strftime("%d/%m %H:%M"),
        "favorite": favorite["name"],
        "side": side,
        "table": f"{table[favorite_id]['rank']}º ({table[favorite_id]['points']} pts) × {table[underdog_id]['rank']}º ({table[underdog_id]['points']} pts) | +{gap} pts",
        "favoriteForm": form_text(favorite_form),
        "underdogForm": form_text(underdog_form),
    }


def collect() -> dict[str, Any]:
    token = os.getenv("FOOTBALL_DATA_TOKEN", "").strip()
    if not token:
        raise RuntimeError("FOOTBALL_DATA_TOKEN não configurado")
    now = datetime.now(UTC)
    target_day = selected_day(now)
    matches: list[dict[str, Any]] = []
    checked = 0
    failures: list[str] = []
    for league in LEAGUES:
        try:
            current_year = season_year(league, target_day)
            current = get_matches(token, league, current_year)
            previous = get_matches(token, league, current_year - 1)
            history = [*previous, *current]
            fixtures = [match for match in current if kickoff(match).astimezone(DISPLAY_TIMEZONE).date() == target_day and match.get("status") in {"SCHEDULED", "TIMED"}]
            checked += len(fixtures)
            for fixture in fixtures:
                result = candidate(fixture, league, current, history)
                if result:
                    matches.append(result)
        except Exception as error:
            failures.append(f"{LEAGUE_NAMES.get(league, league)}: {error}")
    return {
        "date": target_day.isoformat(),
        "runAt": datetime.now(UTC).isoformat(),
        "source": "Football-Data.org",
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
    request = Request(
        url,
        data=json.dumps(result).encode("utf-8"),
        method="POST",
        headers={
            "X-Ingest-Secret": secret,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "BotBet-Monitor/1.0 (+https://github.com/fwragenciadigital/Ecom-Teste)",
        },
    )
    with urlopen(request, timeout=30):
        pass


if __name__ == "__main__":
    result = collect()
    publish(result)
    print(json.dumps({key: result[key] for key in ("date", "checked", "approved", "failures")}, ensure_ascii=False))
