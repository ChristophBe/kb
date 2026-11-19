import pytest
from knowcel_chat.citations import used_sources

SOURCES = ["a", "b", "c"]


def test_unused_sources_are_dropped() -> None:
    assert used_sources("It is in [2].", SOURCES) == ("It is in [1].", ["b"])


def test_markers_are_renumbered_in_order_of_first_use() -> None:
    assert used_sources("First [3], then [1] and [3] again.", SOURCES) == (
        "First [1], then [2] and [1] again.",
        ["c", "a"],
    )


def test_text_without_markers_has_no_sources() -> None:
    assert used_sources("No sources here.", SOURCES) == ("No sources here.", [])


def test_markers_without_a_source_stay_plain_text() -> None:
    assert used_sources("See [0], [4] and [2].", SOURCES) == ("See [0], [4] and [1].", ["b"])
    assert used_sources("See [1].", []) == ("See [1].", [])


@pytest.mark.parametrize(
    "text",
    [
        "Use `a[2]` here.",
        "Use ``a[2]`` here.",
        "```py\nx = a[2]\n```",
        "~~~\n[2]\n~~~",
        "```\n[2]\nnever closed",
    ],
)
def test_markers_in_code_are_left_alone(text: str) -> None:
    assert used_sources(text, SOURCES) == (text, [])


def test_markers_around_code_are_still_renumbered() -> None:
    text = "[3] `[2]`\n\n```\n[1]\n```\n\nand [2]"
    assert used_sources(text, SOURCES) == ("[1] `[2]`\n\n```\n[1]\n```\n\nand [2]", ["c", "b"])
