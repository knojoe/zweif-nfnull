# zwei | fünf | null – 3D-Modell

Klickbares 3D-Modell für die Homepage. Läuft ohne externe Dienste
(Schriften, three.js und der Excel-Leser liegen im Ordner).

## Inhalt

| Datei | Zweck |
|---|---|
| `index.html` | Viewer |
| `bauteile.xlsx` | **Steuerdatei**: Texte, Sichtbarkeit, Schichtaufbauten, Kennzahlen |
| `model.bin` | Geometrie, aus der IFC aufbereitet |
| `lib/` | three.js 0.147.0 (MIT), SheetJS 0.18.5 (Apache 2.0) |
| `fonts/` | Bricolage Grotesque, Figtree, JetBrains Mono (SIL OFL) |

## Inhalte ändern

`bauteile.xlsx` in Excel öffnen, ändern, speichern, ins Repo hochladen.
Die Seite liest die Datei beim Öffnen neu ein. Das Blatt „Anleitung“ erklärt alle Spalten.
Ist die Excel fehlerhaft oder fehlt sie, zeigt der Viewer die eingebauten Startwerte.

## Hochladen

1. Ganzen Ordner ins Repo legen, z. B. als `bv/zweifuenfnull/`, committen, pushen.
2. Nicht per Doppelklick (`file://`) testen, der Browser blockiert dann `model.bin` und
   `bauteile.xlsx`. Lokal: `python -m http.server` im Ordner, dann `http://localhost:8000`.

## Einbetten

```html
<iframe src="/bv/zweifuenfnull/"
        title="3D-Modell zwei | fünf | null"
        style="width:100%;height:80vh;min-height:520px;border:0;border-radius:12px"
        loading="lazy"></iframe>
```
