# Branding

An organization can present the web UI as its own: the product name, the logo, the favicon, the fonts and the colors come from a **branding file** that the deployment points the web container at. There is no admin page and no runtime editing; a change takes effect when the web container is restarted or redeployed. Without a branding file the UI keeps the Knowcelium name, logo and colors.

## The branding file

A directory holds `branding.json` and the image files it names. [`deploy/branding/example`](../../deploy/branding/example) is a complete example to copy:

```json
{
  "name": "Acme Knowledge",
  "logo": { "light": "logo-light.svg", "dark": "logo-dark.svg", "showName": true },
  "favicon": "favicon.svg",
  "colors": {
    "light": { "accent": "#1d4ed8", "onAccent": "#ffffff", "canvas": "#f2f5fb", "glow1": "#1d4ed8" },
    "dark": { "accent": "#93b4ff", "onAccent": "#0b1220", "canvas": "#0c101c", "glow1": "#93b4ff" }
  }
}
```

The example in the repository sets every color key. Every key is optional; what you leave out keeps the Knowcelium value.

| Key | Meaning |
|---|---|
| `name` | The product name (1 to 60 characters): the browser tab title, the header, the sign-in page and every other place the UI and the user manual say "Knowcelium" (see [The product name](#the-product-name)). |
| `logo.light`, `logo.dark` | The logo on light and dark backgrounds: a file next to `branding.json` (`.svg`, `.png` or `.webp`, up to 512 KiB, named with letters, digits, `.`, `_` and `-`). |
| `logo.showName` | `true` shows the product name as text under the logo image in the sidebar and on the sign-in page; `false` (the default) shows the image alone. It has an effect only with a logo image: without one the name already is the logo. The narrow-screen header always shows the image alone. |
| `favicon` | The browser tab icon (`.svg`, `.png` or `.ico`, same rules). |
| `fonts.heading`, `fonts.body`, `fonts.mono` | The typeface of headings, of the interface and of data (code, ids). Each is `{ "family", "file", "weight" }`; see [Fonts](#fonts). |
| `navigation.light`, `navigation.dark` | The sidebar background (color or gradient) and text color for each mode; see [Navigation](#navigation). |
| `colors.light`, `colors.dark` | The colors of each mode, as `#rrggbb`; see [Colors](#colors). A mode you leave out keeps the Knowcelium colors, and so does every color key you leave out of a mode. |
| `icons` | Replaces icons of the UI by your own images; see [Icons](#icons). |

The status colors and the neutral palette steps stay as they are. A logo is shown at the height of the Knowcelium logo plus 40 %, so give it a transparent background and some breathing room; without a logo the product name is shown as text. The UI switches between the light and dark logo with the theme, including the user's own theme choice.

## Colors

Light and dark mode take their own values, including the theme the user picks in the UI. Each key is `#rrggbb`:

| Key | Meaning |
|---|---|
| `accent`, `onAccent` | Buttons, links, the current place and the focus ring; the text on an accent button. |
| `accent2` | The second stop of the hero gradient (the accent word on the home page). |
| `canvas`, `surface` | The page background; cards, inputs and the glass panels. |
| `text`, `textMuted` | Body text and headings; secondary text and icons. |
| `border`, `borderStrong` | Decorative dividers; the boundaries of controls. |
| `glow1`, `glow2` | The two soft lights behind the glass (top right, bottom left), at the opacity of the Knowcelium theme. A glow may also be `"none"`: the light is off and that part of the page is the plain `canvas`. |

Derived, so they have no key: the hover and subtle shades of the accent, the focus ring (the accent), the hover and fill color `surface-muted` (a mix of `surface` and `text`), the translucent glass fills (`surface` at 72 %, 86 % and 40 %; the opaque `surface` where the browser cannot blur or the user asks for less transparency), the glass rim and the shadows.

A key you leave out keeps the Knowcelium color of that mode, and the checks below use it: a branded `canvas` is checked against the default `text` and accent. Set the colors that belong together in a mode, for example a dark `canvas` together with a light `text`. A mode you leave out keeps all Knowcelium colors, so a brand that only has a light palette still gets the Knowcelium dark mode.

<!-- navigation -->
## Navigation

The main sidebar keeps the frosted Knowcelium surface unless the file gives it a background. `navigation.light` and `navigation.dark` each take a `background` and optionally a `text`; a mode without a value keeps the default surface, so the two modes can differ.

```json
"navigation": {
  "light": { "background": "#1d4ed8", "text": "#ffffff" },
  "dark": { "background": { "from": "#0b1220", "to": "#1e3a8a", "angle": 135 }, "text": "#ffffff" }
}
```

- `background` is a color (`#rrggbb`) or a linear gradient `{ "from", "to", "angle" }` of two colors. `angle` is 0 to 360 degrees and defaults to 180 (top to bottom). Images, more stops and other gradient types are not supported.
- `text` (`#rrggbb`) is the color of the sidebar's text and icons, including the active item and the focus ring. Without it the theme's text color stays, so give a `text` whenever the background is far from the theme's light or dark surface.
- The text needs a contrast of at least 4.5:1 against the color, or against both gradient stops (the worse one counts).
- The conversation list and the rest of the page keep their surfaces. On a narrow screen the same background shows wherever the sidebar is shown (the menu drawer).
<!-- end navigation -->

## The product name

With a `name`, the UI says it everywhere: the search box, the search page, the Help page, error messages and the whole user manual (its index, headings and text, so "Acme Knowledge's manual" reads right). The manual is written once with the name "Knowcelium" and shown with yours. No page mentions Knowcelium except the credit below.

## Powered by

A deployment with a branding file shows "Powered by Knowcelium *version*" at the bottom right of every page after sign-in, below the page content and never over it. *version* is the version of the running web build (`version` in the web container's `/config.json`, the `KNOWCEL_VERSION` the image was built with, `dev` for a local build). "Knowcelium" links to the project page. The line cannot be changed or hidden. Without a branding file nothing is added.

## Fonts

Each role takes a `family` and optionally a `file` and a `weight`:

```json
"fonts": {
  "heading": { "family": "Acme Serif", "file": "acme-serif.woff2", "weight": "100 900" },
  "body": { "family": "Inter" }
}
```

- With a `file` (a `.woff2` or `.woff` next to `branding.json`, up to 512 KiB, same name rules as the logos) the web container serves the font itself; the UI loads nothing from other hosts. `weight` is the weight the file has, `400` unless you say otherwise, or a range such as `100 900` for a variable font.
- Without a `file`, `family` names a font installed on the viewer's device (for example `Georgia`).
- `family` is a name of up to 80 letters, digits, spaces, `.` and `-`.
- Until the file has loaded, and wherever a glyph is missing, the text uses the Knowcelium typeface of that role (Source Serif 4, IBM Plex Sans, IBM Plex Mono), so text never disappears.
- You need the licence to serve a font; check it before you put the file in the branding directory.

## Icons

`icons` maps the name of an icon of the UI to an image file next to `branding.json`:

```json
"icons": { "search": "search.svg", "menu": "menu.svg" }
```

- A file is an `.svg` or `.png` of up to 64 KiB, named like the other files. Icons without an entry keep the Knowcelium icon.
- An icon is drawn as a **single-color shape**: the UI uses the image's opacity as a mask and fills it with the surrounding text color, so it follows light and dark mode, hover and disabled states, and the size the UI gives the icon. The colors inside the image are ignored; use opaque strokes on a transparent background and a square canvas (the Knowcelium icons are 24 x 24 outlines).
- A name must be one of these (each is the kebab-case name of an icon of the UI; a test keeps the list in step with the code):

<!-- icons:start -->
`alert-triangle`, `arrow-left`, `arrow-right`, `arrow-up`, `bar-chart-3`, `check`, `check-circle-2`, `chevron-left`, `circle-alert`, `circle-help`, `circle-user`, `copy`, `cpu`, `download`, `file-text`, `file-up`, `info`, `layers`, `library`, `log-out`, `menu`, `message-square`, `message-square-text`, `monitor`, `moon`, `plus`, `rotate-ccw`, `search`, `search-x`, `shield-alert`, `square`, `sun`, `trash-2`, `triangle-alert`, `upload`, `user-minus`, `user-round-cog`, `users-round`, `x`
<!-- icons:end -->

## Checks at start

The web container checks the file when it starts and refuses to start with one line per problem, so a broken branding never reaches users:

- the file is JSON, has only the keys above, `logo.showName` is `true` or `false`, and every file it names exists, and every `icons` name is an icon of the UI, with an `.svg` or `.png` of at most 64 KiB;
- every color is `#rrggbb` (a glow may be `"none"`), a navigation gradient has `from` and `to`, an `angle` is 0 to 360, and every font has a valid family, weight and file;
- text has a contrast of at least 4.5:1, the [WCAG 2.2 AA](../ux-standards.md) limit: `text` and `textMuted` on `canvas` and on `surface`, `accent` on `canvas` (the accent colors links and the active menu entry) and `onAccent` on `accent`;
- `borderStrong` on `canvas` and on `surface` and `accent2` on `canvas` (large gradient text) have a contrast of at least 3:1.
- the navigation text has a contrast of at least 4.5:1 against its color, or against both stops of a gradient (the worse one counts).

Every pair uses the effective colors: the configured value, else the Knowcelium default of that mode. The message names the field that fails, also when the other color of the pair is a default.

```text
branding: colors.light: text on the accent has contrast 1.09:1 (accent #1d4ed8, onAccent #2255dd), needs 4.5:1
branding: colors.light.text #21221e has contrast 1.27:1 against the page background (canvas #333333), needs 4.5:1
```

## Apply it

**Compose.** Set `KNOWCEL_BRANDING_DIR` to the directory (in `.env` or the environment) and restart the web container:

```sh
KNOWCEL_BRANDING_DIR=./branding/example task up
```

Relative paths are relative to `deploy/`. Compose mounts the directory read-only at `/branding` and sets `KNOWCEL_BRANDING_FILE=/branding/branding.json`.

**Kubernetes.** Put the file and the images into a ConfigMap and name it in the chart values; the web pod mounts it:

```sh
kubectl create configmap acme-branding \
  --from-file=deploy/branding/example/branding.json \
  --from-file=deploy/branding/example/logo-light.svg \
  --from-file=deploy/branding/example/logo-dark.svg \
  --from-file=deploy/branding/example/favicon.svg
helm upgrade --install kb deploy/helm/kb --reuse-values --set web.brandingConfigMap=acme-branding
```

Roll the web deployment after changing the ConfigMap (`kubectl rollout restart deployment/web`); the pod reads it at start. A ConfigMap holds up to 1 MiB, so keep the images small. Many icons can exceed that limit; the chart only mounts a ConfigMap, so then mount a volume that holds the directory at `/branding` and set `KNOWCEL_BRANDING_FILE=/branding/branding.json` yourself, for example from your own chart overlay or a derived image (Compose mounts a whole directory and has no such limit).

Both settings are listed in the [configuration reference](../configuration.md).
