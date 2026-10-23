import asyncio
import sys
from bleak import BleakScanner

SVC = "02a6c0d0-0451-4000-b000-fb3210111989"


async def main():
    secs = float(sys.argv[1]) if len(sys.argv) > 1 else 15
    found = await BleakScanner.discover(timeout=secs, return_adv=True)
    rows = []
    for addr, (dev, adv) in found.items():
        name = adv.local_name or dev.name or ""
        uuids = [u.lower() for u in adv.service_uuids]
        bosch = SVC in uuids or name.upper().startswith(("GLM", "PLR", "BOSCH"))
        rows.append((bosch, adv.rssi, addr, name, uuids, adv.manufacturer_data))
    rows.sort(key=lambda r: (not r[0], -r[1]))
    for bosch, rssi, addr, name, uuids, mfr in rows:
        flag = ">>> BOSCH" if bosch else "        "
        print(f"{flag} {addr} rssi={rssi:4} name={name!r} uuids={uuids} mfr={ {k: v.hex() for k, v in mfr.items()} }")
    print(f"total: {len(rows)} dispositivos")


asyncio.run(main())
