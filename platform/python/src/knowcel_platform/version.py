"""The kb release version a component runs."""

import os


def version() -> str:
    """The release version (e.g. "0.3.1") from KNOWCEL_VERSION, set by the image build.

    Local runs without it report "dev".
    """
    return os.environ.get("KNOWCEL_VERSION") or "dev"
