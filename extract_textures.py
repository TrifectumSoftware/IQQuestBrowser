"""Extract item icons (from mod jars + the vanilla client jar), BQ theme textures and
chapter background images.

Resolution order per icon id (modid:name):
  1. explicit ALIASES / OVERRIDES
  2. exact      assets/<ns>/textures/{items,blocks}/<name>.png   (item./tile./block. stripped)
  3. meta       assets/<ns>/textures/{items,blocks}/<name>_<meta>.png  etc.  (uses the icon's Damage)
  4. token      a close relative of the same block, e.g. crate_iron -> crate_iron_side
                machine_shredder -> machine_shredder_front_alt

Anything left over is recorded in texture_manifest.json and rendered as a placeholder.
"""
import json, os, shutil, zipfile

INSTANCE = r"C:\Users\admin\AppData\Roaming\PrismLauncher\instances\1.7.10\minecraft"
MODS = os.path.join(INSTANCE, "mods")
BQ_RES = os.path.join(INSTANCE, "config", "betterquesting", "resources", "betterquesting", "textures")
OUT = r"C:\Users\admin\Penrose\IQQuestBrowser"
VANILLA_JAR = os.path.join(OUT, ".work", "1.7.10.jar")

# id namespace -> asset namespace / jar hint (some mods register under a different namespace)
NS_ALIAS = {
    "questbook": "betterquesting",
}
# explicit texture basenames where the registry name and the file name simply differ
ALIASES = {
    "hbm:item.toolbox": "kit_toolbox",
    "hbm:item.floppy_disk": "floppy",
    "hbm:item.singularity_spark": "singularity_spark_alt",
    "hbm:item.template": "assembly_template",
    "minecraft:book": "book_normal",
}
# full asset paths (vanilla meta-based blocks whose file names differ)
OVERRIDES = {
    "minecraft:grass": "assets/minecraft/textures/blocks/grass_side.png",
    "minecraft:red_flower": "assets/minecraft/textures/blocks/flower_rose.png",
    "minecraft:yellow_flower": "assets/minecraft/textures/blocks/dandelion.png",
    "minecraft:fire": "assets/minecraft/textures/blocks/fire_layer_0.png",
    "minecraft:tallgrass": "assets/minecraft/textures/blocks/tallgrass.png",
    "minecraft:waterlily": "assets/minecraft/textures/blocks/waterlily.png",
    "minecraft:deadbush": "assets/minecraft/textures/blocks/deadbush.png",
    "minecraft:sapling": "assets/minecraft/textures/blocks/sapling_oak.png",
}


def mod_key(fn):
    return fn.split("-")[0].lower().replace(" ", "")


def index(path):
    idx = {}
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            if n.endswith(".png") and not n.endswith(".mcmeta"):
                idx[n] = n
    return idx


def basenames(idx, ns):
    out = []
    for k in idx:
        if not k.startswith("assets/%s/textures/" % ns):
            continue
        rel = k.split("/textures/", 1)[1]
        d, b = rel.rsplit("/", 1) if "/" in rel else ("", rel)
        out.append((d.lower(), b[:-4].lower()))
    return out


def name_candidates(ns, name):
    c = [name]
    for p in ("item.", "tile.", "block."):
        if name.startswith(p):
            c.append(name[len(p):])
    if "." in name:
        c.append(name.replace(".", "/"))
    if name.startswith(ns + "."):
        c.append(name[len(ns) + 1:])
    return list(dict.fromkeys(c))


def find_exact(idx, ns, cands):
    for sub in ("items", "blocks", "item", "block"):
        for c in cands:
            e = "assets/%s/textures/%s/%s.png" % (ns, sub, c)
            if e in idx:
                return e
    return None


def find_token(idx, bnames, ns, cands):
    base = cands[-1]
    qt = [t for t in base.replace(".", "_").split("_") if len(t) >= 3]
    if not qt:
        return None
    PREFER = {'': 0, 'side': 0, 'front': 0, 'base': 1, 'machine': 1,
              'top': 2, 'up': 2, 'outer': 3, 'bottom': 4, 'down': 4, 'inner': 5}
    scored = []
    for d, b in bnames:
        bt = b.replace(".", "_").split("_")
        if all(t in bt for t in qt):
            scored.append(((len(bt) - len(qt), PREFER.get(bt[-1], 6), len(b)), b))
    if not scored:
        return None
    scored.sort()
    if scored[0][0][0] > 2:
        return None
    for sub in ("items", "blocks", "item", "block"):
        e = "assets/%s/textures/%s/%s.png" % (ns, sub, scored[0][1])
        if e in idx:
            return e
    return None


def main():
    os.makedirs(os.path.join(OUT, "textures", "bq"), exist_ok=True)

    # ---- BQ theme textures ----
    bq_jar = None
    for fn in sorted(os.listdir(MODS), reverse=True):
        if fn.startswith("BetterQuesting") and fn.endswith(".jar"):
            bq_jar = os.path.join(MODS, fn)
            break
    if bq_jar:
        with zipfile.ZipFile(bq_jar) as z:
            for a in ("assets/betterquesting/textures/gui/simple_frames.png",
                      "assets/betterquesting/textures/gui/quest_frames.png"):
                with z.open(a) as s, open(os.path.join(OUT, "textures/bq", os.path.basename(a)), "wb") as d:
                    shutil.copyfileobj(s, d)

    # ---- collect wanted icons + their damage values ----
    with open(os.path.join(OUT, "quests.json"), encoding="utf-8") as f:
        data = json.load(f)

    want = {}

    def add(icon):
        if not icon:
            return
        iid = icon.get("id:8", "")
        if not iid or ":" not in iid:
            return
        m, n = iid.split(":", 1)
        want.setdefault(m.lower(), {}).setdefault(n.lower(), set()).add(int(icon.get("Damage:2", 0)))

    for q in data["quests"].values():
        add(q.get("icon"))
        for t in q.get("tasks", []):
            for it in t.get("items", []):
                if it.get("id"):
                    want.setdefault(it["id"].split(":", 1)[0].lower(), {}) \
                        .setdefault(it["id"].split(":", 1)[1].lower(), set()).add(int(it.get("damage", 0)))
    for l in data["linesById"].values():
        add(l.get("icon"))

    # ---- jar lookup ----
    jars_by_mod = {}
    for fn in os.listdir(MODS):
        if fn.endswith(".jar"):
            jars_by_mod.setdefault(mod_key(fn), []).append(os.path.join(MODS, fn))
    if os.path.exists(VANILLA_JAR):
        jars_by_mod["minecraft"] = [VANILLA_JAR]
        print("vanilla jar: found")

    manifest = {"resolved": 0, "byMethod": {}, "missing": [], "lineTextures": {}}

    for modid, names in sorted(want.items()):
        ns = NS_ALIAS.get(modid, modid)          # asset namespace
        cands_jars = jars_by_mod.get(modid) or jars_by_mod.get(ns) or []
        if not cands_jars:
            for hint, js in jars_by_mod.items():
                if modid and (modid in hint or hint in modid):
                    cands_jars.extend(js)
        idx, used = None, None
        for jar in cands_jars:
            i = index(jar)
            if any(find_exact(i, ns, name_candidates(ns, n)) for n in names):
                idx, used = i, jar
                break
        if idx is None and cands_jars:
            idx, used = index(cands_jars[0]), cands_jars[0]
        bnames = basenames(idx, ns) if idx else []

        for n in sorted(names):
            damage = sorted(names[n])[0] if names[n] else 0
            full = "%s:%s" % (modid, n)
            entry = method = None

            if idx is None:
                manifest["missing"].append(full)
                continue
            if full in OVERRIDES and OVERRIDES[full] in idx:
                entry, method = OVERRIDES[full], "override"
            if entry is None and full in ALIASES:
                c = name_candidates(ns, ALIASES[full])
                entry = find_exact(idx, ns, c)
                if entry:
                    method = "alias"
            if entry is None:
                c = name_candidates(ns, n)
                entry = find_exact(idx, ns, c)
                if entry:
                    method = "exact"
                else:
                    # meta-based: try <name>_<meta> / <name>.<meta> / <name><meta>
                    if damage > 0:
                        for suffix in ("_%d" % damage, ".%d" % damage, "%d" % damage, "_%d" % (damage & 15)):
                            e2 = find_exact(idx, ns, [p + suffix for p in c])
                            if e2:
                                entry, method = e2, "meta"
                                break
                    if entry is None:
                        entry = find_token(idx, bnames, ns, c)
                        if entry:
                            method = "token"

            if entry is None:
                manifest["missing"].append(full)
                continue

            outdir = os.path.join(OUT, "textures", "icons", modid)
            os.makedirs(outdir, exist_ok=True)
            try:
                with zipfile.ZipFile(used) as z:
                    with z.open(entry) as s, open(os.path.join(outdir, n + ".png"), "wb") as d:
                        shutil.copyfileobj(s, d)
                manifest["resolved"] += 1
                manifest["byMethod"][method] = manifest["byMethod"].get(method, 0) + 1
            except Exception:
                manifest["missing"].append(full)

    # ---- chapter background images ----
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


if __name__ == "__main__":
    main()
