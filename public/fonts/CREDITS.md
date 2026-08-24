# Font credits

Both families are shipped with the game rather than fetched from a font CDN, so
that the interface renders identically offline and on a first load, and so that
no third party learns who is playing.

| files | family | licence | copyright |
|---|---|---|---|
| `baloo2-700.woff2`, `baloo2-800.woff2` | [Baloo 2](https://github.com/EkType/Baloo2) | SIL Open Font License 1.1 — see [`OFL-Baloo2.txt`](OFL-Baloo2.txt) | The Baloo 2 Project Authors |
| `nunito-400.woff2`, `nunito-600.woff2`, `nunito-700.woff2` | [Nunito](https://github.com/googlefonts/nunito) | SIL Open Font License 1.1 — see [`OFL-Nunito.txt`](OFL-Nunito.txt) | 2014 The Nunito Project Authors |

Both are subset to Latin and converted to WOFF2; no glyph was altered. The OFL
requires its own text to travel with the font files, which is why the two
licence files sit in this folder rather than being linked to.

Baloo 2 is the display face — it is a rounded, slightly heavy family, which is
the whole reason it is here: the interface is made of clay tablets and a face
with sharp terminals sits on them like type set in metal. Nunito carries the
body text, where Baloo's roundness stops helping at small sizes.
