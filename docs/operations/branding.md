# Branding

An organization can present the web UI as its own: the product name, the logo, the favicon and the accent colors come from a **branding file** that the deployment points the web container at. There is no admin page and no runtime editing; a change takes effect when the web container is restarted or redeployed. Without a branding file the UI keeps the Knowcelium name, logo and colors.

## The branding file

A directory holds `branding.json` and the image files it names. [`deploy/branding/example`](../../deploy/branding/example) is a complete example to copy:

```json
{
  "name": "Acme Knowledge",
  "logo": { "light": "logo-light.svg", "dark": "logo-dark.svg" },
  "favicon": "favicon.svg",
  "colors": {
    "light": { "accent": "#1d4ed8", "onAccent": "#ffffff" },
    "dark": { "accent": "#93b4ff", "onAccent": "#0b1220" }
  }
}
```

Every key is optional; what you leave out keeps the Knowcelium value.

| Key | Meaning |
|---|---|
| `name` | The product name (1 to 60 characters): the browser tab title, the header and the sign-in page. |
| `logo.light`, `logo.dark` | The logo on light and dark backgrounds: a file next to `branding.json` (`.svg`, `.png` or `.webp`, up to 512 KiB, named with letters, digits, `.`, `_` and `-`). |
| `favicon` | The browser tab icon (`.svg`, `.png` or `.ico`, same rules). |
| `fonts.heading`, `fonts.body`, `fonts.mono` | The typeface of headings, of the interface and of data (code, ids). Each is `{ "family", "file", "weight" }`; see [Fonts](#fonts). |
| `navigation.light`, `navigation.dark` | The sidebar background (color or gradient) and text color for each mode; see [Navigation](#navigation). |
| `colors.light`, `colors.dark` | The accent for each mode: `accent` (buttons, links, focus) and `onAccent` (text on an accent button), as `#rrggbb`. Give both of a mode. |

Hover, focus and subtle accent shades are derived from `accent`; the neutral greys, status colors and typeface stay as they are. A logo is shown at the height of the Knowcelium logo plus 40 %, so give it a transparent background and some breathing room; without a logo the product name is shown as text. The UI switches between the light and dark logo with the theme, including the user's own theme choice.

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

## Checks at start

The web container checks the file when it starts and refuses to start with one line per problem, so a broken branding never reaches users:

- the file is JSON, has only the keys above, and every file it names exists;
- every color (accent and navigation) is `#rrggbb`, a navigation gradient has `from` and `to`, an `angle` is 0 to 360, and every font has a valid family, weight and file;
- `onAccent` on `accent` and `accent` against the page background (the accent colors links and the active menu entry) each have a contrast of at least 4.5:1, the [WCAG 2.2 AA](../ux-standards.md) limit for text; so does the navigation text against its background (both stops of a gradient).

```text
branding: colors.light: text on the accent has contrast 1.09:1 (accent #1d4ed8, onAccent #2255dd), needs 4.5:1
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

Roll the web deployment after changing the ConfigMap (`kubectl rollout restart deployment/web`); the pod reads it at start. A ConfigMap holds up to 1 MiB, so keep the images small.

Both settings are listed in the [configuration reference](../configuration.md).
