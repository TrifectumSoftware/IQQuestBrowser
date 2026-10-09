import json, os, sys

SRC = r"C:\Users\admin\AppData\Roaming\PrismLauncher\instances\1.7.10\minecraft\config\betterquesting\DefaultQuests"
OUT = r"C:\Users\admin\Penrose\IQQuestBrowser"

def uuid_from(hi, lo):
    return "-".join([
        "%08x%08x" % ((hi >> 32) & 0xffffffff, hi & 0xffffffff),
        "%08x%08x" % ((lo >> 32) & 0xffffffff, lo & 0xffffffff),
        "%04x" % ((hi >> 16) & 0xffff),
        "%04x" % (hi & 0xffff),
        "%012x" % (lo >> 48),
    ])

def read(p):
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

lines = {}
lines_dir = os.path.join(SRC, "QuestLines")
for d in os.listdir(lines_dir):
    qldir = os.path.join(lines_dir, d)
    if not os.path.isdir(qldir):
        continue
    lf = os.path.join(qldir, "QuestLine.json")
    if not os.path.exists(lf):
        continue
    data = read(lf)
    lid = uuid_from(data["questLineIDHigh:4"], data["questLineIDLow:4"])
    props = data.get("properties:10", {}).get("betterquesting:10", {})
    entries = []
    for fn in os.listdir(qldir):
        if fn == "QuestLine.json":
            continue
        e = read(os.path.join(qldir, fn))
        entries.append({
            "id": uuid_from(e["questIDHigh:4"], e["questIDLow:4"]),
            "x": int(e.get("x:3", 0)),
            "y": int(e.get("y:3", 0)),
            "sizeX": int(e.get("sizeX:3", 24)),
            "sizeY": int(e.get("sizeY:3", 24)),
        })
    entries.sort(key=lambda e: (e["y"], e["x"]))
    lines[lid] = {
        "id": lid,
        "name": props.get("name:8", d.split("-")[0]),
        "desc": props.get("desc:8", ""),
        "bg": props.get("bg_image:8", ""),
        "bgSize": int(props.get("bg_size:3", 256)),
        "icon": props.get("icon:10"),
        "isFolder": props.get("isFolder:1", 0),
        "visibility": props.get("visibility:8", "NORMAL"),
        "entries": entries,
    }

quests = {}
qroot = os.path.join(SRC, "Quests")
for ld in sorted(os.listdir(qroot)):
    qdir = os.path.join(qroot, ld)
    if not os.path.isdir(qdir):
        continue
    for fn in sorted(os.listdir(qdir)):
        data = read(os.path.join(qdir, fn))
        props = data.get("properties:10", {}).get("betterquesting:10", {})
        qid = uuid_from(data["questIDHigh:4"], data["questIDLow:4"])
        prereq_map = data.get("preRequisites:9", {}) or {}
        prereqs = []
        for v in prereq_map.values():
            prid = uuid_from(v["questIDHigh:4"], v["questIDLow:4"])
            prereqs.append(prid)
        tasks = []
        for t in (data.get("tasks:9", {}) or {}).values():
            items = []
            for i in (t.get("requiredItems:9", {}) or {}).values():
                items.append({
                    "id": i.get("id:8", ""),
                    "damage": int(i.get("Damage:2", 0)),
                    "ore": i.get("OreDict:8", ""),
                    "count": int(i.get("Count:3", 1)),
                })
            tasks.append({"id": t.get("taskID:8", ""), "items": items})
        quests[qid] = {
            "id": qid,
            "name": props.get("name:8", ""),
            "desc": props.get("desc:8", ""),
            "icon": props.get("icon:10"),
            "isMain": props.get("isMain:1", 0),
            "visibility": props.get("visibility:8", "NORMAL"),
            "questLogic": props.get("questLogic:8", "AND"),
            "prerequisites": prereqs,
            "tasks": tasks,
        }

order = []
op = os.path.join(SRC, "QuestLinesOrder.txt")
if os.path.exists(op):
    for raw in open(op, encoding="utf-8"):
        raw = raw.strip()
        if raw and ":" in raw:
            lid = raw.split(":", 1)[0]
            if lid in lines:
                order.append(lid)
for k in sorted(lines):
    if k not in order:
        order.append(k)

os.makedirs(OUT, exist_ok=True)
payload = {"lines": order, "linesById": lines, "quests": quests}
with open(os.path.join(OUT, "quests.json"), "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

nq = sum(len(l["entries"]) for l in lines.values())
print("chapters      :", len(lines))
print("placed quests :", nq)
print("total quests  :", len(quests))
print("quests.json   :", os.path.getsize(os.path.join(OUT, "quests.json")), "bytes")

# report what icons look like
icons = {}
for q in quests.values():
    ic = q.get("icon")
    if ic and ic.get("id:8"):
        icons.setdefault(ic["id:8"], []).append(q["name"])
for l in lines.values():
    ic = l.get("icon")
    if ic and ic.get("id:8"):
        icons.setdefault(ic["id:8"], []).append("[line] " + l["name"])
print("distinct icon ids:", len(icons))
for k in sorted(icons):
    print("   ", k, "->", len(icons[k]), "quests")
