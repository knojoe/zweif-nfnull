# zwei | fünf | null – 3D-Modell

Klickbares 3D-Modell für die Homepage. Läuft ohne externe Dienste
(Schriften, three.js und der Excel-Leser liegen im Ordner).

## Inhalt

| Datei | Zweck |
|---|---|
| `index.html` | Viewer (Oberfläche) |
| `app.js`, `tex.js` | Viewer-Logik, prozedurale Materialtexturen |
| `vendor.js` | three.js 0.165 (gebündelt) |
| `bauteile.xlsx` | **Steuerdatei**: Texte, Sichtbarkeit, Schichtaufbauten, Kennzahlen |
| `model.bin` | Geometrie, aus der IFC aufbereitet |
| `lib/` | SheetJS 0.18.5 (Apache 2.0) und Lizenz von three.js (MIT) |
| `fonts/` | DM Serif Display, Outfit (SIL OFL), wie auf der Homepage |

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
