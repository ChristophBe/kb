import pytest
from knowcel_chat.prompts import MAX_TEMPLATE_LENGTH, TemplateError, parse


def test_variables_are_replaced_and_doubled_braces_are_literal() -> None:
    template = parse("A {{json}} with {sources} and {history}.")
    assert template.variables == {"sources", "history"}
    assert template.render({"sources": "S", "history": "H"}) == "A {json} with S and H."


def test_plain_text_is_a_template() -> None:
    assert parse("Just text").render({}) == "Just text"


@pytest.mark.parametrize(
    "text", ["{nope}", "{0}", "{sources.x}", "{sources[0]}", "{sources!r}", "{history:>3}"]
)
def test_unknown_variables_and_formatting_are_rejected(text: str) -> None:
    with pytest.raises(TemplateError, match=r"Available variables: \{sources\}, \{history\}"):
        parse(text)


@pytest.mark.parametrize("text", ["{", "}", "a { b"])
def test_unbalanced_braces_are_rejected(text: str) -> None:
    with pytest.raises(TemplateError, match="Braces"):
        parse(text)


def test_required_variables_and_length_are_checked() -> None:
    with pytest.raises(TemplateError, match=r"must contain \{sources\}"):
        parse("nothing", required=("sources",))
    with pytest.raises(TemplateError, match="longer than"):
        parse("x" * (MAX_TEMPLATE_LENGTH + 1))
