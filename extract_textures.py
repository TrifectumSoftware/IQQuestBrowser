"""Extract BQ theme textures + resolve item icons from mod JARs."""
import json, os, shutil, zipfile

INSTANCE = r"C:\Users\admin\AppData\Roaming\PrismLauncher\instances\1.7.10\minecraft"
MODS = os.path.join(INSTANCE, "mods")
BQ_RES = os.path.join(INSTANCE, "config", "betterquesting", "resources", "betterquesting", "textures")
OUT = r"C:\Users\admin\Penrose\IQQuestBrowser"

BQ_JAR = None
for fn in sorted(os.listdir(MODS), reverse=True):
    if fn.startswith("BetterQuesting") and fn.endswith(".jar"):
        BQ_JAR = os.path.join(MODS, fn)
        break

# Modid -> jar filename stem candidates (first component of the filename)
def mod_key(fn):
    return fn.split("-")[0].lower().replace(" ", "")

# ---------------------------------------------------------------- BQ theme
bq_assets = ["assets/betterquesting/textures/gui/simple_frames.png",
             "assets/betterquesting/textures/gui/quest_frames.png"]
os.makedirs(os.path.join(OUT, "textures", "bq"), exist_ok=True)
if BQ_JAR and os.path.exists(BQ_JAR):
    with zipfile.ZipFile(BQ_JAR) as z:
        for a in bq_assets:
            try:
                with z.open(a) as s, open(os.path.join(OUT, "textures/bq", os.path.basename(a)), "wb") as d:
                    shutil.copyfileobj(s, d)
                print("BQ texture:", os.path.basename(a))
            except KeyError:
                print("BQ texture MISSING in jar:", a)
else:
    print("No BQ jar found")

# ---------------------------------------------------------------- icons
with open(os.path.join(OUT, "quests.json"), encoding="utf-8") as f:
    data = json.load(f)

want = {}
def add(iid):
    if not iid or ":" not in iid:
        return
    m, n = iid.split(":", 1)
    want.setdefault(m, set()).add(n.strip().lower())

for q in data["quests"].values():
    if q.get("icon"):
        add(q["icon"].get("id:8", ""))
for l in data["linesById"].values():
    if l.get("icon"):
        add(l["icon"].get("id:8", ""))
for q in data["quests"].values():
    for t in q.get("tasks", []):
        for it in t.get("items", []):
            add(it.get("id", ""))

jars_by_mod = {}
for fn in os.listdir(MODS):
    if fn.endswith(".jar"):
        jars_by_mod.setdefault(mod_key(fn), []).append(os.path.join(MODS, fn))

# Vanilla client jar (fetched from Mojang's version manifest) provides minecraft:* icons.
VANILLA_JAR = os.path.join(OUT, ".work", "1.7.10.jar")
if os.path.exists(VANILLA_JAR):
    jars_by_mod["minecraft"] = [VANILLA_JAR]
    print("vanilla jar: found")

# A few vanilla ids whose texture name differs from the registry name (meta-based blocks).
OVERRIDES = {
    "minecraft:grass": "assets/minecraft/textures/blocks/grass_side.png",
    "minecraft:red_flower": "assets/minecraft/textures/blocks/flower_rose.png",
    "minecraft:fire": "assets/minecraft/textures/blocks/fire_layer_0.png",
    "minecraft:tallgrass": "assets/minecraft/textures/blocks/tallgrass.png",
    "minecraft:waterlily": "assets/minecraft/textures/blocks/waterlily.png",
    "minecraft:yellow_flower": "assets/minecraft/textures/blocks/flower_dandelion.png",
    "minecraft:deadbush": "assets/minecraft/textures/blocks/deadbush.png",
    "minecraft:sapling": "assets/minecraft/textures/blocks/sapling_oak.png",
    "minecraft:book": "assets/minecraft/textures/items/book_normal.png",
}

def index(path):
    idx = {}
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            if n.endswith(".png"):
                idx[n] = n
    return idx

def basenames(idx, modid):
    out = []
    for k, v in idx.items():
        if not k.startswith("assets/%s/textures/" % modid):
            continue
        if k.endswith(".mcmeta"):
            continue
        rel = k.split("/textures/", 1)[1]
        d, b = rel.rsplit("/", 1) if "/" in rel else ("", rel)
        out.append((d.lower(), b[:-4].lower()))
    return out

def resolve(idx, bnames, modid, name):
    """Return (entry, method). Exact first, then a confident token match on the same block."""
    cands = [name]
    for p in ("item.", "tile.", "block."):
        if name.startswith(p):
            cands.append(name[len(p):])
    for c in list(cands):
        if "." in c:
            cands.append(c.replace(".", "/"))
    if name.startswith(modid + "."):
        cands.append(name[len(modid) + 1:])
    # strip a leading modid-ish namespace from the suffix as well
    if "." in name:
        head, _tail = name.split(".", 1)
        if head in (modid, "item", "tile", "block"):
            cands.append(name.split(".", 1)[1])

    for sub in ("items", "blocks", "item", "block"):
        for c in cands:
            e = "assets/%s/textures/%s/%s.png" % (modid, sub, c)
            if e in idx:
                return e, "exact"

    # Token match: every significant query token must appear in the basename.
    base = cands[-1] if len(cands) > 1 else name
    qtoks = [t for t in base.replace(".", "_").split("_") if len(t) >= 3]
    if not qtoks:
        return None, None
    PREFER = {'': 0, 'side': 0, 'front': 0, 'base': 1, 'machine': 1,
        'top': 2, 'up': 2, 'outer': 3, 'bottom': 4, 'down': 4, 'inner': 5}
    scored = []
    for d, b in bnames:
        btoks = b.replace(".", "_").split("_")
        if all(t in btoks for t in qtoks):
            extra = len(btoks) - len(qtoks)
            tail = btoks[-1]
            score = (extra, PREFER.get(tail, 6), len(b))
            scored.append((score, d, b))
    if not scored:
        return None, None
    scored.sort()
    best = scored[0]
    # require the best to be clearly better than the runner-up
    # accept a close relative (up to two extra qualifier tokens, e.g.
    #   crate_iron -> crate_iron_side,  machine_shredder -> machine_shredder_front_alt)
    if best[0][0] > 2:
        return None, None
    for sub in ("items", "blocks", "item", "block"):
        e = "assets/%s/textures/%s/%s.png" % (modid, sub, best[2])
        if e in idx:
            return e, "token"
    return None, None

manifest = {"resolved": 0, "byMethod": {"exact": 0, "token": 0}, "missing": [], "lineTextures": {}}
for modid, names in sorted(want.items()):
    # icon ids are not consistently cased (ArchitectureCraft:, IronChest:, questbook:),
    # but jars and asset namespaces are lowercase - normalise once, use everywhere.
    mid = modid.lower()
    cands = jars_by_mod.get(mid) or []
    if not cands:
        for hint, js in jars_by_mod.items():
            if mid and mid in hint:
                cands.extend(js)
    idx, bnames, used = None, None, None
    for jar in cands:
        i = index(jar)
        if any(resolve(i, basenames(i, mid), mid, n)[0] for n in names):
            idx, used = i, jar
            bnames = basenames(i, mid)
            break
    if idx is None and cands:
        idx, used = index(cands[0]), cands[0]
        bnames = basenames(idx, mid)

    for n in sorted(names):
        entry, method = (None, None)
        full = mid + ":" + n
        if full in OVERRIDES and idx is not None and OVERRIDES[full] in idx:
            entry, method = OVERRIDES[full], "override"
        elif idx is not None:
            entry, method = resolve(idx, bnames, mid, n)
        if entry is None:
            manifest["missing"].append(mid + ":" + n)
            continue
        outdir = os.path.join(OUT, "textures", "icons", mid)
        os.makedirs(outdir, exist_ok=True)
        dest = os.path.join(outdir, n + ".png")
        try:
            with zipfile.ZipFile(used) as z:
                with z.open(entry) as s, open(dest, "wb") as d:
                    shutil.copyfileobj(s, d)
            manifest["resolved"] += 1
            manifest["byMethod"][method] = manifest["byMethod"].get(method, 0) + 1
        except Exception:
            manifest["missing"].append(modid + ":" + n)

# line background images from the BQ resources folder
if os.path.isdir(BQ_RES):
    for root, _d, files in os.walk(BQ_RES):
        for fn in files:
            if not fn.lower().endswith(".png"):
                continue
            src = os.path.join(root, fn)
            rel = os.path.relpath(src, BQ_RES).replace("\\", "/")
            dest = os.path.join(OUT, "textures", "lines", rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copyfile(src, dest)
            manifest["lineTextures"][fn] = "textures/lines/" + rel

with open(os.path.join(OUT, "texture_manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=1)

print("resolved:", manifest["resolved"], manifest["byMethod"])
print("missing :", len(manifest["missing"]))
print("line bgs:", len(manifest["lineTextures"]))
