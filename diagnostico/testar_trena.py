import asyncio, struct, time
from bleak import BleakClient, BleakScanner
CHR = "00004301-0000-0041-5253-534f46540000"
T0 = time.time()
def log(*a): print(f"[{time.time()-T0:6.2f}s]", *a, flush=True)
def crc8(d, iv=0xAA, p=0xA6):
    v = iv
    for b in d:
        for i in range(8):
            x = (v >> 7) ^ ((b >> (7 - i)) & 1); v = (v << 1) & 0xFF
            if x: v ^= p
    return v
def f(*b): return bytes(b) + bytes([crc8(b)])
def on(_, d):
    note = ""
    if d[0] == 0 and d[1] == 4: note = f"  => {struct.unpack_from('<I', d, 2)[0]*0.05/1000:.4f} m"
    if d[0] == 0xC0 and len(d) >= 11: note = f"  => AUTOSYNC float@7 = {struct.unpack_from('<f', d, 7)[0]:.4f} m"
    log("<-", d.hex(" "), note, "| crc ok" if crc8(d[:-1]) == d[-1] else "| crc(sem status)?")
async def main():
    dev = await BleakScanner.find_device_by_filter(lambda d, a: (a.local_name or d.name or "").upper().startswith(("GLM","BOSCH")), timeout=20)
    async with BleakClient(dev, timeout=30) as c:
        await c.start_notify(CHR, on)
        for label, cmd in [("laser desliga", f(0xC0,0x42,0x00)), ("autosync", f(0xC0,0x55,0x02,0x01,0x00)),
                           ("medir (laser desligado)", f(0xC0,0x40,0x00)), ("medir de novo", f(0xC0,0x40,0x00)),
                           ("laser desliga", f(0xC0,0x42,0x00))]:
            log("->", label, cmd.hex(" ")); await c.write_gatt_char(CHR, cmd, response=True); await asyncio.sleep(3)
asyncio.run(main())
