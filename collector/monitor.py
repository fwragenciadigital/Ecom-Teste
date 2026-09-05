"""Coleta diária gratuita com soccerdata/SofaScore e publica no Worker BotBet."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd
import requests
import soccerdata as sd

ROOT = Path(__file__).resolve().parent
CACHE_DIR = Path(os.getenv("SOCCERDATA_DIR", ROOT / ".cache"))
OUTPUT = Path(os.getenv("BOTBET_OUTPUT", ROOT / "latest_run.json"))
DEFAULT_LEAGUES = "ENG-Premier League,ESP-La Liga,ITA-Serie A,GER-Bundesliga,BRA-Serie A"
LEAGUES = [item.strip() for item in os.getenv("BOTBET_LEAGUES", DEFAULT_LEAGUES).split(",") if item.strip()]
CALENDAR_LEAGUES = {"BRA", "USA", "NOR", "SWE", "ICE"}
DISPLAY_TIMEZONE = ZoneInfo(os.getenv("BOTBET_TIMEZONE", "America/Sao_Paulo"))


def current_season(league: str, now: datetime) -> str:
    """Formato que o SofaScore usa: 2627 na Europa; 2026 em ligas de ano civil."""
    override = os.getenv("BOTBET_SEASON")
    if override:
        return override
    country = league.split("-", 1)[0]
    if country in CALENDAR_LEAGUES:
        return str(now.year)
    start = now.year if now.month >= 7 else now.year - 1
    return f"{start % 100:02d}{(start + 1) % 100:02d}"


def stamp(value: Any) -> datetime:
    value = pd.Timestamp(value)
    if value.tzinfo is None:
        return value.tz_localize(UTC).to_pydatetime()
    return value.tz_convert(UTC).to_pydatetime()


def form_text(form: dict[str, int]) -> str:
    return f"{form['wins']}V {form['draws']}E {form['losses']}D"


def completed_form(schedule: pd.DataFrame, team: str, venue: str, before: datetime) -> dict[str, int] | None:
    """Últimos cinco resultados do time exclusivamente no mesmo mando de campo."""
    rows = schedule.copy()
    rows["_date"] = rows["date"].map(stamp)
    rows = rows[(rows["_date"] < before) & rows["home_score"].notna() & rows["away_score"].notna()]
    if venue == "casa":
        rows = rows[rows["home_team"] == team]
        mine, theirs = "home_score", "away_score"
    else:
        rows = rows[rows["away_team"] == team]
        mine, theirs = "away_score", "home_score"
    rows = rows.sort_values("_date", ascending=False).head(5)
    if len(rows) < 5:
        return None
    outcomes = []
    for row in rows.itertuples(index=False):
        own, opponent = float(getattr(row, mine)), float(getattr(row, theirs))
        outcomes.append("W" if own > opponent else "D" if own == opponent else "L")
    return {"wins": outcomes.count("W"), "draws": outcomes.count("D"), "losses": outcomes.count("L")}


def standings(table: pd.DataFrame) -> dict[str, dict[str, int]]:
    rows = table.copy()
    for column in ("Pts", "GD", "GF"):
        rows[column] = pd.to_numeric(rows[column], errors="coerce").fillna(0)
    rows = rows.sort_values(["Pts", "GD", "GF"], ascending=False).reset_index(drop=True)
    return {str(row.team): {"rank": index + 1, "points": int(row.Pts)} for index, row in rows.iterrows()}


def candidate(game: Any, league: str, schedule: pd.DataFrame, table: dict[str, dict[str, int]]) -> dict[str, Any] | None:
    home, away = str(game.home_team), str(game.away_team)
    if home not in table or away not in table or table[home]["points"] == table[away]["points"]:
        return None
    favorite = home if table[home]["points"] > table[away]["points"] else away
    underdog = away if favorite == home else home
    side = "casa" if favorite == home else "fora"
    underdog_side = "fora" if side == "casa" else "casa"
    gap = table[favorite]["points"] - table[underdog]["points"]
    if gap < 6:
        return None
    kickoff = stamp(game.date)
    favorite_form = completed_form(schedule, favorite, side, kickoff)
    underdog_form = completed_form(schedule, underdog, underdog_side, kickoff)
    if not favorite_form or not underdog_form:
        return None
    if favorite_form["losses"] > 1 or favorite_form["draws"] > 1:
        return None
    if underdog_form["wins"] > 1 or underdog_form["losses"] < 3:
        return None
    local = kickoff.astimezone(DISPLAY_TIMEZONE).strftime("%d/%m %H:%M")
    return {
        "id": str(getattr(game, "game_id", f"{league}:{home}:{away}:{kickoff.isoformat()}")),
        "league": league.replace("-", " — ", 1),
        "home": home,
        "away": away,
        "time": local,
        "favorite": favorite,
        "side": side,
        "table": f"{table[favorite]['rank']}º ({table[favorite]['points']} pts) × {table[underdog]['rank']}º ({table[underdog]['points']} pts) | +{gap} pts",
        "favoriteForm": form_text(favorite_form),
        "underdogForm": form_text(underdog_form),
    }


def collect() -> dict[str, Any]:
    now = datetime.now(UTC)
    target_day = now.astimezone(DISPLAY_TIMEZONE).date()
    matches: list[dict[str, Any]] = []
    checked = 0
    failures: list[str] = []
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    for league in LEAGUES:
        try:
            reader = sd.Sofascore(leagues=league, seasons=current_season(league, now), data_dir=CACHE_DIR / "Sofascore")
            schedule = reader.read_schedule().reset_index()
            table = standings(reader.read_league_table().reset_index())
            today = schedule[schedule["date"].map(stamp).map(lambda value: value.date() == target_day)]
            checked += len(today)
            for game in today.itertuples(index=False):
                result = candidate(game, league, schedule, table)
                if result:
                    matches.append(result)
        except Exception as error:  # A falha de uma liga não impede as demais.
            failures.append(f"{league}: {type(error).__name__}")
    return {
        "date": target_day.isoformat(),
        "runAt": datetime.now(UTC).isoformat(),
        "source": "soccerdata/SofaScore",
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
