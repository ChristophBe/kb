import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from kb.chat.v1 import chat_pb2
from kb_chat.context import MESSAGE_OVERHEAD_TOKENS, ApproximateTokenCounter, fit
from kb_chat.repository import MessageRow


class WordCounter:
    """One token per word, so budgets in the tests are easy to follow."""

    def count(self, text: str) -> int:
        return len(text.split())


def system(sources: Sequence[chat_pb2.Citation]) -> str:
    return " ".join(["sys", *(c.snippet for c in sources)])


def source(name: str, score: float, words: int = 10) -> chat_pb2.Citation:
    return chat_pb2.Citation(document_id=name, snippet=" ".join([name] * words), score=score)


def message(text: str, words: int = 10) -> MessageRow:
    role = chat_pb2.MESSAGE_ROLE_USER
    return MessageRow(uuid.uuid4(), uuid.uuid4(), role, " ".join([text] * words), datetime.now(UTC))


def size(sources: Sequence[chat_pb2.Citation], history: Sequence[MessageRow], question: str) -> int:
    texts = [system(sources), *(m.content for m in history), question]
    return sum(WordCounter().count(t) + MESSAGE_OVERHEAD_TOKENS for t in texts)


SOURCES = [source("a", 0.9), source("b", 0.7), source("c", 0.5)]


def test_everything_is_kept_when_it_fits() -> None:
    history = [message("h1"), message("h2")]
    ctx = fit(1000, WordCounter(), system, SOURCES, history, "question")
    assert ctx.sources == SOURCES
    assert ctx.history == history


def test_the_oldest_history_goes_first() -> None:
    history = [message("old"), message("mid"), message("new")]
    budget = size(SOURCES, history[1:], "question")
    ctx = fit(budget, WordCounter(), system, SOURCES, history, "question")
    assert [m.content.split()[0] for m in ctx.history] == ["mid", "new"]
    assert ctx.sources == SOURCES


def test_sources_go_after_the_history_lowest_score_first() -> None:
    history = [message("h1")]
    budget = size(SOURCES[:2], [], "question")
    ctx = fit(budget, WordCounter(), system, SOURCES, history, "question")
    assert ctx.history == []
    assert [c.document_id for c in ctx.sources] == ["a", "b"]


def test_sources_are_ranked_by_score_whatever_their_order() -> None:
    shuffled = [SOURCES[2], SOURCES[0], SOURCES[1]]
    budget = size(SOURCES[:1], [], "question")
    ctx = fit(budget, WordCounter(), system, shuffled, [], "question")
    assert [c.document_id for c in ctx.sources] == ["a"]


def test_the_best_source_and_the_question_always_stay() -> None:
    history = [message("h1")]
    ctx = fit(1, WordCounter(), system, SOURCES, history, "a very long question")
    assert [c.document_id for c in ctx.sources] == ["a"]
    assert ctx.history == []


def test_long_conversations_never_exceed_the_budget() -> None:
    budget = 200
    for turns in range(0, 60, 7):
        history = [message(f"m{i}", words=15) for i in range(turns)]
        ctx = fit(budget, WordCounter(), system, SOURCES, history, "question")
        assert size(ctx.sources, ctx.history, "question") <= budget
        # Whatever is kept is the most recent part of the conversation.
        assert ctx.history == history[len(history) - len(ctx.history) :]


def test_no_sources_without_the_knowledge_base() -> None:
    ctx = fit(10, WordCounter(), system, [], [message("h", words=50)], "question")
    assert ctx.sources == []
    assert ctx.history == []


def test_approximate_counter_rounds_up() -> None:
    counter = ApproximateTokenCounter()
    assert counter.count("") == 0
    assert counter.count("abcd") == 1
    assert counter.count("abcde") == 2
