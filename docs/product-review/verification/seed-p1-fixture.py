"""Seed fabricated browser-check records in the parent-owned disposable QA stack.

Never imports a venue or reads the repository .env. Requires the private
/tmp/vessel-p1-qa/config.json created for this task. This is a QA fixture,
not a supported application importer or live-data repair command.
"""

import datetime as dt
import json
import pathlib
import subprocess
import urllib.request
import uuid


ROOT = pathlib.Path("/tmp/vessel-p1-qa")
CONFIG = json.loads((ROOT / "config.json").read_text())
assert CONFIG["db"] == "vesselp1"
assert CONFIG["apiPort"] == 5098
assert "Port=55613" in CONFIG["connection"]
assert "Database=vesselp1" in CONFIG["connection"]
OUTPUT = ROOT / "fixture.json"
if OUTPUT.exists():
    raise SystemExit("Fixture already exists. Reuse it; do not duplicate seeded facts.")


def api(path, body=None):
    request = urllib.request.Request(
        f"http://127.0.0.1:5098/api{path}",
        data=None if body is None else json.dumps(body).encode(),
        headers={
            "Authorization": "Bearer " + CONFIG["token"],
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request) as response:
        return json.load(response)


def sql_literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    return "'" + str(value).replace("'", "''") + "'"


def insert(table, fields):
    columns = ", ".join('"' + key + '"' for key in fields)
    values = ", ".join(sql_literal(value) for value in fields.values())
    return f'INSERT INTO "{table}" ({columns}) VALUES ({values});'


def plan(entries=None):
    return {
        "direction": "long", "sizingMode": "quantity", "size": "10",
        "leverage": "5", "budgetOverride": "10000",
        "entries": entries or [{
            "id": "entry-a", "name": "First entry", "color": "#60a5fa",
            "share": "100", "price": "100",
            "stops": [{"id": "stop-a", "unit": "price", "value": "95", "share": "100"}],
            "targets": [{"id": "target-a", "unit": "price", "value": "110", "share": "100"}],
        }],
        "notes": {"thesis": "", "invalidation": "", "strategy": "", "evidence": ""},
    }


def create_play(account, title, document=None, source="manual"):
    play = api("/plays", {
        "accountId": account["id"], "instrument": "DEMO", "instrumentSource": source,
        "title": title, "plan": document or plan(), "drawings": {}, "review": "",
    })
    return api(f'/plays/{play["summary"]["id"]}/status', {
        "expectedVersion": play["summary"]["version"], "status": "planned",
    })


manual = api("/accounts", {
    "name": "Synthetic manual account", "venueId": "manual",
    "portfolioId": None, "manualAccountValueUsd": "10000",
})
imported = api("/accounts", {
    "name": "Synthetic imported facts", "venueId": "hyperliquid",
    "portfolioId": None, "address": "0x0000000000000000000000000000000000000001",
})
manual_play = create_play(manual, "Manual partial-exit walkthrough")
entries = plan()["entries"]
entries[0]["share"] = "50"
entries.append({
    "id": "entry-b", "name": "Second entry", "color": "#a78bfa",
    "share": "50", "price": "110",
    "stops": [{"id": "stop-b", "unit": "price", "value": "104.5", "share": "100"}],
    "targets": [{"id": "target-b", "unit": "price", "value": "121", "share": "100"}],
})
summary_play = create_play(manual, "Two-entry money summary", plan(entries))
legacy_play = create_play(imported, "Excluded legacy record: missing execution", source="venue")
owner = CONFIG["ownerId"]
account_id = imported["id"]
now = dt.datetime.now(dt.timezone.utc)
timestamp = lambda minutes: (now - dt.timedelta(minutes=minutes)).isoformat()
statements = ["BEGIN;"]
rows = []


def imported_execution(order_id, contract, side, effect, price, size, minutes, pnl, original_size=None):
    at = timestamp(minutes)
    fill_id = str(uuid.uuid4())
    statements.append(insert("imported_orders", {
        "Id": str(uuid.uuid4()), "OwnerId": owner, "AccountId": account_id,
        "ContractId": contract, "VenueContractId": None, "OrderId": order_id,
        "Side": side, "OrderType": "limit", "LimitPrice": price, "TriggerPrice": None,
        "ReduceOnly": effect == "close", "IsPositionTpsl": False,
        "OriginalSize": original_size or size, "RemainingSize": "0",
        "PlacedAtUtc": at, "Status": "filled", "VenueStatus": "filled",
        "StatusAtUtc": at, "ObservedAtUtc": timestamp(0),
    }))
    statements.append(insert("imported_fills", {
        "Id": fill_id, "OwnerId": owner, "AccountId": account_id,
        "ContractId": contract, "VenueContractId": None,
        "SourceFillId": "qa-" + fill_id, "Side": side,
        "Direction": "Synthetic " + effect, "PositionEffect": effect,
        "Price": price, "Quantity": size, "Fee": "0.1", "FeeToken": "USDC",
        "FeeBasis": "reported", "ClosedPnlUsd": pnl, "PnlBasis": "gross",
        "OccurredAtUtc": at, "OrderId": order_id, "TransactionHash": "",
    }))
    rows.append({"id": fill_id, "orderId": order_id, "contract": contract})


# Full-order, unassigned, no-flip round trip eligible for owner confirmation.
imported_execution("qa-retro-in", "RETRO", "buy", "open", "100", "2", 90, "0")
imported_execution("qa-retro-out", "RETRO", "sell", "close", "106", "2", 60, "12")
# Legacy record is intentionally inconsistent to exercise exclusions, not to
# claim the current API allows this state.
imported_execution("qa-missing-in", "DEMO", "buy", "open", "100", "1", 50, "0", "2")
imported_execution("qa-missing-out", "DEMO", "sell", "close", "103", "1", 40, "3")
play_id = legacy_play["summary"]["id"]
for order_id, role, entry_id in [
    ("qa-missing-in", "Entry", "entry-a"), ("qa-missing-out", "Exit", None),
]:
    statements.append(insert("play_order_links", {
        "Id": str(uuid.uuid4()), "OwnerId": owner, "PlayId": play_id,
        "AccountId": account_id, "OrderId": order_id, "Role": role,
        "EntryId": entry_id, "LevelId": None, "State": "Linked", "Source": "Owner",
        "CreatedAtUtc": timestamp(0), "UpdatedAtUtc": timestamp(0),
    }))
statements.append(
    'UPDATE plays SET "Status"=\'Closed\', "EndedAtUtc"=' +
    sql_literal(timestamp(40)) + ' WHERE "Id"=' + sql_literal(play_id) + ";"
)
statements.append(insert("account_snapshots", {
    "OwnerId": owner, "AccountId": account_id, "ObservedAtUtc": timestamp(0),
    "ValueScope": "primary-perpetuals", "AccountValueUsd": "10000",
    "WithdrawableUsd": "10000", "AvailableMarginUsd": "10000", "MarginUsedUsd": "0",
}))
statements.append(
    'UPDATE accounts SET "SyncStatus"=\'synced\', "LastSyncedAtUtc"=' +
    sql_literal(timestamp(0)) + ', "HistoryNotice"=' +
    sql_literal("Fabricated QA facts only. No venue import was performed.") +
    ' WHERE "Id"=' + sql_literal(account_id) + ";"
)
statements.append("COMMIT;")
subprocess.run([
    "docker", "exec", "-i", "vessel-opus-verify-20261013",
    "psql", "-v", "ON_ERROR_STOP=1", "-U", "vesselverify", "-d", "vesselp1",
], input="\n".join(statements), text=True, check=True, stdout=subprocess.DEVNULL)
fixture = {
    "manualAccount": manual, "importedAccount": imported,
    "manualPlay": manual_play, "summaryPlay": summary_play,
    "excludedPlay": legacy_play, "importedFills": rows,
}
OUTPUT.write_text(json.dumps(fixture, indent=2))
OUTPUT.chmod(0o600)
print("Created synthetic manual, money-summary, retrospective and exclusion fixtures.")
