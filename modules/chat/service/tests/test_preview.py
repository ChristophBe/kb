import pytest
from kb_chat.preview import PREVIEW_LENGTH, plain_text, preview


@pytest.mark.parametrize(
    ("markdown", "text"),
    [
        ("## Revenue\n\nQ3 grew **12%**.", "Revenue Q3 grew 12%."),
        ("See [the report](https://x.test/r) and ![chart](c.png).", "See the report and chart."),
        ("Paris is the capital [1][2].", "Paris is the capital."),
        ("- one\n- [x] two\n1. three", "one two three"),
        ("> quoted *text* and _more_ ~~gone~~", "quoted text and more gone"),
        ("Run `task gen`:\n\n```sh\ntask gen\n```", "Run task gen: task gen"),
        ("| a | b |\n|---|---|\n| 1 | 2 |", "a b 1 2"),
        ("snake_case_name stays", "snake_case_name stays"),
        ("line<br>break", "linebreak"),
        ("above\n\n---\n\nbelow", "above below"),
    ],
)
def test_plain_text_removes_markdown(markdown: str, text: str) -> None:
    assert plain_text(markdown) == text


def test_short_text_is_kept_whole() -> None:
    assert preview("Hello **world**") == "Hello world"
    assert preview("") == ""


def test_long_text_is_cut_at_a_word_with_an_ellipsis() -> None:
    text = preview("word " * 100)

    assert len(text) <= PREVIEW_LENGTH
    assert text.endswith("word…")


def test_a_long_word_is_cut_mid_word() -> None:
    text = preview("x" * 300)

    assert text == "x" * (PREVIEW_LENGTH - 1) + "…"
