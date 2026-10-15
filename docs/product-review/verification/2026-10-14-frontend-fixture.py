"""Seed fabricated records for the October 14 frontend before/after captures.

Uses only the disposable capture stack described in 2026-10-14-frontend.md:
an isolated PostgreSQL container and a loopback API whose outbound HTTP goes to
an unreachable proxy. Never reads the repository .env, never imports from a
venue and never touches the owner's database. Requires the private
/tmp/vessel-fe-review/config.json created for this task.
Use --supplement to add marked diagnostic evidence to an existing fixture.
The percentage-level scenario is exercised in the browser draft without saving.
"""

import datetime as dt
import hashlib
import json
import pathlib
import struct
import sys
import zlib
import subprocess
import urllib.request
import uuid

ROOT = pathlib.Path("/tmp/vessel-fe-review")
OUTPUT = ROOT / "fixture.json"
# Config is loaded only when invoked, never on import by focused fixture tests.
CONFIG = None
API = OWNER = NOW = None


def api(path, body=None, method=None):
    request = urllib.request.Request(
        API + path,
        data=None if body is None else json.dumps(body).encode(),
        method=method or ("GET" if body is None else "POST"),
        headers={"Authorization": "Bearer " + CONFIG["token"], "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        text = response.read()
        return json.loads(text) if text else None


def at(hours):
    return (NOW - dt.timedelta(hours=hours)).isoformat().replace("+00:00", "Z")


def literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    return "'" + str(value).replace("'", "''") + "'"


def insert(table, fields):
    columns = ", ".join('"' + key + '"' for key in fields)
    return f'INSERT INTO "{table}" ({columns}) VALUES ({", ".join(literal(v) for v in fields.values())});'


def sql(statements):
    subprocess.run(
        ["docker", "exec", "-i", CONFIG["container"], "psql", "-v", "ON_ERROR_STOP=1", "-U", CONFIG["user"], "-d", CONFIG["db"]],
        input="\n".join(["BEGIN;", *statements, "COMMIT;"]), text=True, check=True, stdout=subprocess.DEVNULL,
    )


def level(id, value, share="100", unit="price"):
    return {"id": id, "unit": unit, "value": value, "share": share}


def entry(id, name, color, share, price, stops, targets):
    return {"id": id, "name": name, "color": color, "share": share, "price": price, "stops": stops, "targets": targets}


def plan(direction, size, leverage, entries, thesis="", invalidation="", strategy="", evidence="", sizing="margin"):
    return {
        "direction": direction, "sizingMode": sizing, "size": size, "leverage": leverage, "budgetOverride": None,
        "entries": entries,
        "notes": {"thesis": thesis, "invalidation": invalidation, "strategy": strategy, "evidence": evidence},
    }


def create(account, title, document, instrument, source="manual", drawings=None, review=""):
    return api("/plays", {
        "accountId": account["id"], "instrument": instrument, "instrumentSource": source, "title": title,
        "plan": document, "drawings": drawings or {}, "review": review,
    })


def status(play, body):
    return api(f'/plays/{play["summary"]["id"]}/status', {"expectedVersion": play["summary"]["version"], **body})


def backdate(play, hours):
    play_id = literal(play["summary"]["id"])
    sql([
        f'UPDATE plays SET "CreatedAtUtc"={literal(at(hours + 1))}, "PlannedAtUtc"={literal(at(hours))} WHERE "Id"={play_id};',
        f'UPDATE play_plan_revisions SET "CreatedAtUtc"={literal(at(hours))} WHERE "PlayId"={play_id};',
        f'UPDATE play_status_changes SET "OccurredAtUtc"={literal(at(hours))} WHERE "PlayId"={play_id};',
    ])


def evidence_png():
    """A diagnostic image, not venue data. Standard-library PNG keeps the fixture dependency-free."""
    width, height = 640, 360
    rows = []
    for y in range(height):
        row = bytearray()
        for x in range(width):
            color = (28, 32, 39)
            if x % 80 == 0 or y % 60 == 0:
                color = (48, 54, 64)
            if abs(y - (270 - x // 3)) <= 2:
                color = (74, 222, 128)
            row.extend(color)
        rows.append(b"\0" + row)
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"".join(rows))) + chunk(b"IEND", b"")


def supplement(fixture):
    """Idempotent API-only addition. Reuses all retained fixture facts; never reseeds or deletes."""
    play_id = fixture["plays"]["btc"]
    note = "Synthetic visual verification image. Diagnostic line only, not financial or venue evidence."
    existing = [item for item in api(f"/plays/{play_id}/evidence") if item["note"] == note]
    assert len(existing) <= 1, "Duplicate synthetic evidence; inspect before retrying"
    markup = {"width": 640, "height": 360, "shapes": [
        {"id": "fixture-arrow", "kind": "arrow", "color": "#ffd23f", "width": 4, "from": {"x": 120, "y": 210}, "to": {"x": 340, "y": 140}},
        {"id": "fixture-text", "kind": "text", "color": "#ffffff", "size": 22, "at": {"x": 40, "y": 30}, "text": "SYNTHETIC CAPTURE FIXTURE"},
    ]}
    if existing:
        evidence = existing[0]
        # The API serializes unused union-shape properties as null. Compare all populated
        # properties, and verify the original bytes too; never replace changed evidence.
        observed = evidence["markup"]
        assert observed is not None, "Synthetic evidence has no marks"
        observed = {**observed, "shapes": [{key: value for key, value in shape.items() if value is not None} for shape in observed["shapes"]]}
        assert observed == markup, "Synthetic evidence markup changed; inspect, do not overwrite"
        assert evidence["sha256"] == hashlib.sha256(evidence_png()).hexdigest(), "Synthetic original changed; inspect before retrying"
    else:
        boundary = "vessel-visual-fixture-20261014"
        parts = []
        for key, value in {"note": note, "source": "upload", "markup": json.dumps(markup)}.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
        parts += [f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic-evidence.png"\r\nContent-Type: image/png\r\n\r\n'.encode(), evidence_png(), f'\r\n--{boundary}--\r\n'.encode()]
        request = urllib.request.Request(API + f"/plays/{play_id}/evidence", data=b"".join(parts),
            headers={"Authorization": "Bearer " + CONFIG["token"], "Content-Type": "multipart/form-data; boundary=" + boundary})
        with urllib.request.urlopen(request, timeout=30) as response:
            evidence = json.loads(response.read())
    fixture["visualScenarios"] = {
        "evidenceId": evidence["id"], "evidenceCreatedAtServerUtc": evidence["createdAtUtc"],
        "percentageLevel": {"setup": "browser draft only, no save", "entry": "e1", "target": "t2", "value": "26.645768", "unit": "percent"},
    }
    OUTPUT.write_text(json.dumps(fixture, indent=2))
    OUTPUT.chmod(0o600)
    print("Synthetic visual supplement ready; retained facts reused, no venue calls.")


def main():
    global CONFIG, API, OWNER, NOW
    CONFIG = json.loads((ROOT / "config.json").read_text())
    assert CONFIG["container"] == "vessel-fe-review-20261014"
    assert CONFIG["db"] == "vesselfe"
    API = f"http://127.0.0.1:{CONFIG['apiPort']}/api"
    OWNER = CONFIG["ownerId"]
    if sys.argv[1:] == ["--supplement"]:
        supplement(json.loads(OUTPUT.read_text()))
        return
    if sys.argv[1:]:
        raise SystemExit("Usage: fixture.py [--supplement]")
    if OUTPUT.exists():
        raise SystemExit("Fixture already exists. Reuse it; use --supplement for visual scenarios.")
    NOW = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    seed()
    supplement(json.loads(OUTPUT.read_text()))


def seed():
    # Portfolios and accounts.
    swing = api("/portfolios", {"name": "Swing book", "icon": "chart-candlestick"})
    intraday = api("/portfolios", {"name": "Intraday desk", "icon": "zap"})
    manual = api("/accounts", {"name": "Swing manual", "venueId": "manual", "portfolioId": swing["id"], "manualAccountValueUsd": "25000.50"})
    sandbox = api("/accounts", {"name": "Paper sandbox", "venueId": "manual", "portfolioId": None, "manualAccountValueUsd": "5000"})
    venue = api("/accounts", {"name": "HL synthetic", "venueId": "hyperliquid", "portfolioId": intraday["id"],
                              "address": "0x0000000000000000000000000000000000000001"})
    archived = api("/accounts", {"name": "Archived record", "venueId": "manual", "portfolioId": None, "manualAccountValueUsd": "1200"})
    api(f'/accounts/{archived["id"]}', {"name": "Archived record", "portfolioId": None, "isEnabled": False,
                                         "expectedRevision": archived["settingsRevision"]}, method="PUT")

    # Manual Plays: planned, draft, two closed through manual executions and one cancelled.
    # LINK records its fees in USD, which Review treats as incomplete, so it appears under exclusions.
    eth = create(manual, "ETH breakout retest", plan("long", "2000", "5", [
        entry("e1", "Entry 1", "#b9c9e4", "60", "3420", [level("s1", "3310")], [level("t1", "3600", "50"), level("t2", "3780", "50")]),
        entry("e2", "Entry 2", "#edd49e", "40", "3380", [level("s2", "3290")], [level("t3", "3650")]),
    ], thesis="Daily close above the range high with rising volume; retest of 3,400 holds.",
       invalidation="A 4h close back inside the range below 3,300.", strategy="Range breakout, retest entry."), "ETH")
    eth = status(eth, {"status": "planned"})
    sol = create(manual, "SOL range fade", plan("short", "800", "3", [
        entry("e1", "Entry 1", "#b9c9e4", "100", "172.5", [level("s1", "180")], [level("t1", "158")]),
    ], thesis="Third test of range resistance with fading momentum."), "SOL")


    def closed_manual(title, instrument, direction, entry_price, stop, target, exit_price, quantity, start, review, adherence, fee_currency):
        play = create(manual, title, plan(direction, quantity, "4", [
            entry("e1", "Entry 1", "#b9c9e4", "100", entry_price, [level("s1", stop)], [level("t1", target)]),
        ], thesis=f"{instrument} pullback to the rising average.", sizing="quantity"), instrument)
        play = status(play, {"status": "planned"})
        backdate(play, start)
        buy, sell = ("buy", "sell") if direction == "long" else ("sell", "buy")
        result = api(f'/plays/{play["summary"]["id"]}/manual-executions', {
            "requestId": str(uuid.uuid4()), "expectedVersion": play["summary"]["version"], "role": "entry", "entryId": "e1",
            "occurredAtUtc": at(start - 2), "side": buy, "quantity": quantity, "price": entry_price,
            "fee": "0.42", "feeCurrency": fee_currency, "source": "Synthetic broker statement",
        })
        version = result["play"]["summary"]["version"]
        result = api(f'/plays/{play["summary"]["id"]}/manual-executions', {
            "requestId": str(uuid.uuid4()), "expectedVersion": version, "role": "exit", "entryId": None,
            "occurredAtUtc": at(start - 20), "side": sell, "quantity": quantity, "price": exit_price,
            "fee": "0.41", "feeCurrency": fee_currency, "source": "Synthetic broker statement",
        })
        saved = result["play"]
        fields = {
            "accountId": manual["id"], "instrument": instrument, "instrumentSource": "manual", "title": title,
            "plan": saved["plan"], "drawings": {}, "review": review, "expectedVersion": saved["summary"]["version"],
            "structuredReview": {"adherence": adherence, "mistakeTag": None if adherence == "followed" else "Moved stop",
                                 "lesson": "Wait for the retest before adding.", "nextAction": "Keep the first stop."},
        }
        return api(f'/plays/{saved["summary"]["id"]}', fields, method="PUT")


    avax = closed_manual("AVAX trend pullback", "AVAX", "long", "31.2", "29.8", "34.5", "33.9", "40", 96,
                         "Entry at the average worked; exit early but inside plan.", "followed", "USDC")
    link = closed_manual("LINK failed breakout", "LINK", "long", "18.4", "17.6", "20.5", "17.75", "120", 72,
                         "Chased the breakout; the stop was moved once.", "deviated", "USD")
    doge = create(manual, "DOGE momentum", plan("long", "500", "2", [
        entry("e1", "Entry 1", "#b9c9e4", "100", "0.1425", [level("s1", "0.1350")], [level("t1", "0.1600")]),
    ], thesis="Momentum continuation after the weekly open."), "DOGE")
    doge = status(doge, {"status": "planned"})
    doge = status(doge, {"status": "cancelled", "reason": "invalidated", "note": "Weekly open lost before entry."})

    # Venue Plays on the Hyperliquid account. The chart reads synthetic candles in the capture script.
    btc = create(venue, "BTC trend continuation", plan("long", "1500", "5", [
        entry("e1", "Entry 1", "#b9c9e4", "50", "63800", [level("s1", "62600")], [level("t1", "65800", "50"), level("t2", "67200", "50")]),
        entry("e2", "Entry 2", "#edd49e", "50", "63200", [level("s2", "62600")], [level("t3", "66400")]),
    ], thesis="Higher low on the 4h after the weekly breakout; buying the pullback into prior resistance.",
       invalidation="4h close below 62,500.", strategy="Trend continuation, scaled entries."), "BTC", "venue",
        drawings={"hyperliquid:BTC": [
            {"id": "fixture-line", "schemaVersion": 1, "kind": "horizontal-line", "points": [{"time": int((NOW - dt.timedelta(hours=60)).timestamp() * 1000), "price": 64400}]},
        ]})
    btc = status(btc, {"status": "planned"})

    # Imported facts on the Hyperliquid account (no venue import is performed).
    statements = []
    fills = []


    def execution(order, contract, side, effect, price, size, hours, pnl):
        fill = str(uuid.uuid4())
        statements.append(insert("imported_orders", {
            "Id": str(uuid.uuid4()), "OwnerId": OWNER, "AccountId": venue["id"], "ContractId": contract, "VenueContractId": None,
            "OrderId": order, "Side": side, "OrderType": "limit", "LimitPrice": price, "TriggerPrice": None,
            "ReduceOnly": effect == "close", "IsPositionTpsl": False, "OriginalSize": size, "RemainingSize": "0",
            "PlacedAtUtc": at(hours), "Status": "filled", "VenueStatus": "filled", "StatusAtUtc": at(hours), "ObservedAtUtc": at(1),
        }))
        statements.append(insert("imported_fills", {
            "Id": fill, "OwnerId": OWNER, "AccountId": venue["id"], "ContractId": contract, "VenueContractId": None,
            "SourceFillId": "fixture-" + fill, "Side": side, "Direction": ("Open " if effect == "open" else "Close ") + ("Long" if (side == "buy") == (effect == "open") else "Short"),
            "PositionEffect": effect, "Price": price, "Quantity": size, "Fee": "0.25", "FeeToken": "USDC", "FeeBasis": "reported",
            "ClosedPnlUsd": pnl, "PnlBasis": "gross", "OccurredAtUtc": at(hours), "OrderId": order, "TransactionHash": "",
        }))
        fills.append({"id": fill, "orderId": order, "contract": contract})


    execution("fixture-btc-in", "BTC", "buy", "open", "62000", "0.1", 144, "0")
    execution("fixture-btc-out", "BTC", "sell", "close", "63500", "0.1", 120, "150")
    execution("fixture-eth-in", "ETH", "sell", "open", "3500", "1", 96, "0")
    execution("fixture-eth-out", "ETH", "buy", "close", "3550", "1", 72, "-50")
    execution("fixture-sol-in", "SOL", "buy", "open", "150", "10", 48, "0")
    execution("fixture-sol-out", "SOL", "sell", "close", "158", "10", 24, "80")
    execution("fixture-btc-open", "BTC", "buy", "open", "64250", "0.15", 6, "0")


    def closed_venue(title, contract, direction, entry_price, stop, target, orders, start, end):
        play = create(venue, title, plan(direction, "0.1" if contract == "BTC" else "1", "5", [
            entry("e1", "Entry 1", "#b9c9e4", "100", entry_price, [level("s1", stop)], [level("t1", target)]),
        ], thesis=f"{contract} setup recorded before entry.", sizing="quantity"), contract, "venue")
        play = status(play, {"status": "planned"})
        backdate(play, start)
        play_id = play["summary"]["id"]
        for order, role, entry_id in orders:
            statements.append(insert("play_order_links", {
                "Id": str(uuid.uuid4()), "OwnerId": OWNER, "PlayId": play_id, "AccountId": venue["id"], "OrderId": order,
                "Role": role, "EntryId": entry_id, "LevelId": None, "State": "Linked", "Source": "Owner",
                "CreatedAtUtc": at(end), "UpdatedAtUtc": at(end),
            }))
        statements.append(f'UPDATE plays SET "Status"=\'Closed\', "EndedAtUtc"={literal(at(end))} WHERE "Id"={literal(play_id)};')
        return play


    btc_closed = closed_venue("BTC breakout (closed)", "BTC", "long", "62000", "60800", "64000",
                              [("fixture-btc-in", "Entry", "e1"), ("fixture-btc-out", "Exit", None)], 150, 120)
    eth_closed = closed_venue("ETH fade (closed)", "ETH", "short", "3500", "3580", "3380",
                              [("fixture-eth-in", "Entry", "e1"), ("fixture-eth-out", "Exit", None)], 100, 72)

    statements += [
        insert("account_snapshots", {
            "OwnerId": OWNER, "AccountId": venue["id"], "ObservedAtUtc": at(1), "ValueScope": "primary-perpetuals",
            "AccountValueUsd": "12500.75", "WithdrawableUsd": "9800.25", "MarginUsedUsd": "2700.5", "AccountMode": "default",
            "StablecoinScope": "Supported HyperCore stablecoins", "StablecoinsObservedAtUtc": at(1), "AvailableMarginUsd": "9800.25",
        }),
        insert("account_positions", {
            "OwnerId": OWNER, "AccountId": venue["id"], "ContractId": "BTC", "SignedQuantity": "0.15", "EntryPrice": "64250",
            "UnrealizedPnlUsd": "312.4", "MarginUsedUsd": "1927.5", "Leverage": 5, "VenueContractId": None,
        }),
        insert("account_stablecoins", {
            "OwnerId": OWNER, "AccountId": venue["id"], "TokenId": "0x6d1e7cde53ba9467b783cb7c530ce054", "TokenIndex": 0,
            "Symbol": "USDC", "Total": "3200.5", "Held": "200", "Available": "3000.5",
        }),
        f'UPDATE accounts SET "SyncStatus"=\'synced\', "LastSyncedAtUtc"={literal(at(1))}, "HistoryNotice"='
        + literal("Synthetic fixture facts only. No venue import was performed.") + f' WHERE "Id"={literal(venue["id"])};',
    ]
    sql(statements)

    fixture = {
        "accounts": {"manual": manual["id"], "sandbox": sandbox["id"], "venue": venue["id"], "archived": archived["id"]},
        "portfolios": {"swing": swing["id"], "intraday": intraday["id"]},
        "plays": {"eth": eth["summary"]["id"], "sol": sol["summary"]["id"], "avax": avax["summary"]["id"], "link": link["summary"]["id"],
                  "doge": doge["summary"]["id"], "btc": btc["summary"]["id"], "btcClosed": btc_closed["summary"]["id"],
                  "ethClosed": eth_closed["summary"]["id"]},
        "fills": fills, "seededAt": NOW.isoformat(),
    }
    OUTPUT.write_text(json.dumps(fixture, indent=2))
    OUTPUT.chmod(0o600)
    print("Seeded synthetic portfolios, accounts, Plays and imported facts.")


if __name__ == "__main__":
    main()
