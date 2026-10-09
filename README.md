# IQ Quest Browser

A static, browser-based reproduction of **BetterQuesting's quest-line view** for the
**IQ Edition** pack (HBM's Nuclear Tech / GTNH-flavour 1.7.10).

It is a 1:1 re-implementation of the in-game screen: the panel background, the chapter
tray, the quest canvas with pan/zoom, the quest frames, the item icons and the
dependency arrows are all drawn from the pack's **own** textures using the same
geometry, colours and font metrics as the game.

## Controls

| Input | Action |
| --- | --- |
| drag (quest canvas) | pan |
| wheel (quest canvas) | zoom |
| wheel (chapter list) | scroll chapters |
| click a chapter | open it |
| `F` | fit chapter to view |
| `S` | cycle quest state (locked / unlocked / pending / complete / repeatable) |

The quest state selector exists because a static export has no player progress; BQ
derives frame colours and line colours from each quest's state.

## How it is built

Everything is generated from the local game install — no assets are redistributed
beyond what the pack ships.

```powershell
py build_data.py        # DefaultQuests/ -> quests.json
py extract_textures.py  # mod jars + BQ resources -> textures/
py -m http.server 8752  # then open http://127.0.0.1:8752/
```

`fetch()` is used to load `quests.json`, so the page must be served over HTTP
(GitHub Pages, `http.server`, etc.) — opening `index.html` via `file://` will not work.

### Sources

| Output | Source |
| --- | --- |
| `quests.json` | `config/betterquesting/DefaultQuests/{QuestLines,Quests}` + `QuestLinesOrder.txt` |
| `textures/bq/*.png` | the active `BetterQuesting-*.jar` (`assets/betterquesting/textures/gui/{simple_frames,quest_frames}.png`) |
| `textures/font/` | the pack's txloader font override (`mcpatcher/font/ascii.png` + `ascii.properties`) |
| `textures/icons/<modid>/<name>.png` | the owning mod's jar, `assets/<modid>/textures/{items,blocks}/` |
| `textures/lines/*.png` | `config/betterquesting/resources/betterquesting/textures/` |

### Rendering fidelity notes

The renderer mirrors the real BQ source: `GuiQuestLines` / `CanvasQuestLine` /
`PanelButtonQuest` / `GuiTransform`, and the theme defaults from `PresetTexture`,
`PresetColor` and `DirectionalLine`.

* 9-patch panels are sliced exactly as `SlicedTexture` does (`SLICED_STRETCH` for quest
  norm/aux frames, `STRETCH` for main-quest frames, 8px padding on a 24×24 slice).
* Dependency lines are `DirectionalLine` quads with arrow heads every ~20px
  (arrow width `0.5×`, size `0.75×`, 20% opacity), width 4 (8 for main quests).
* The font is the pack's HD atlas: 256×256, glyph cell = character code, `fontScale` 2,
  advances taken from `ascii.properties`.

## Known gaps

* **Item icons: 81 of 157 referenced icon ids resolve.** The 67 unresolved `hbm:*` ids
  are blocks whose texture filename differs from the registry name (and are frequently
  built from multipart models), so they cannot be resolved by name alone; the 11
  `minecraft:*` ids need the vanilla client jar, which is not present in this install.
  These currently render as a translucent placeholder tile. Resolving them properly
  requires mining HBM's icon registration (or supplying the client jar).
* Player progress is not part of the export, hence the manual state selector.
