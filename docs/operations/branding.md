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
| `colors.light`, `colors.dark` | The accent for each mode: `accent` (buttons, links, focus) and `onAccent` (text on an accent button), as `#rrggbb`. Give both of a mode. |

Hover, focus and subtle accent shades are derived from `accent`; the neutral greys, status colors and typeface stay as they are. A logo is shown at the height of the Knowcelium logo plus 40 %, so give it a transparent background and some breathing room; without a logo the product name is shown as text. The UI switches between the light and dark logo with the theme, including the user's own theme choice.

## Checks at start

The web container checks the file when it starts and refuses to start with one line per problem, so a broken branding never reaches users:

- the file is JSON, has only the keys above, and every file it names exists;
- every color is `#rrggbb`;
- `onAccent` on `accent` and `accent` against the page background (the accent colors links and the active menu entry) each have a contrast of at least 4.5:1, the [WCAG 2.2 AA](../ux-standards.md) limit for text.

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
