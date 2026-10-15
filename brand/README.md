# Временная айдентика

Плейсхолдеры до финального логотипа. Знак — дискета с магической искрой.

| Файл | Назначение |
|------|-----------|
| `mark.svg` | Знак на фирменной плашке — основной |
| `mark-mono.svg` | Одноцветный знак (`currentColor`), для тёмных/светлых фонов и монохромных мест |
| `logo.svg` | Знак + надпись, светлая и тёмная тема через `prefers-color-scheme` |
| `favicon.svg`, `icon-32.png` | Иконка вкладки |
| `icon-192.png`, `icon-512.png` | PWA / apple-touch-icon / аватарки |
| `icon-maskable.svg`, `icon-maskable-512.png` | Android adaptive icon (знак в безопасной зоне 80%) |

Палитра: фон `#2b1a66 → #5230b8`, линии `#ece6ff`, искра `#5ef2d6`, звёздочка `#ffd76a`, акцент UI `#6a3fe0`.

Надпись в `logo.svg` набрана живым шрифтом (Inter → системный sans) — в финальной версии перевести в кривые.

PNG пересобираются из SVG:

```sh
for s in 32 192 512; do rsvg-convert -w $s -h $s mark.svg -o icon-$s.png; done
rsvg-convert -w 512 -h 512 icon-maskable.svg -o icon-maskable-512.png
```
