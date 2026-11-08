"""SqlRepository against a real Postgres (needs Docker; run by `task test:integration`)."""

import asyncio
import uuid
from collections.abc import AsyncIterator, Iterator

import pytest
from alembic import command
from alembic.config import Config
from kb.chat.v1 import chat_pb2
from kb_chat.db import MIGRATIONS_DIR, SqlRepository, migrate
from sqlalchemy.ext.asyncio import create_async_engine
from testcontainers.community.postgres import PostgresContainer

pytestmark = pytest.mark.integration

# The image of deploy/infra.compose.yaml, as in platform/go/postgres/pgtest.
IMAGE = "pgvector/pgvector:pg17"

ALICE, BOB = "alice", "bob"


@pytest.fixture(scope="module")
def database_url() -> Iterator[str]:
    with PostgresContainer(IMAGE, username="kb", password="kb", dbname="kb", driver=None) as pg:
        url = pg.get_connection_url().replace("postgresql://", "postgresql+asyncpg://", 1)
        asyncio.run(migrate(url))
        yield url


@pytest.fixture
async def repo(database_url: str) -> AsyncIterator[SqlRepository]:
    engine = create_async_engine(database_url)
    async with engine.begin() as conn:
        await conn.exec_driver_sql("TRUNCATE chat.conversations CASCADE")
    yield SqlRepository(engine)
    await engine.dispose()


async def say(repo: SqlRepository, conversation_id: uuid.UUID, content: str) -> None:
    await repo.add_message(conversation_id, chat_pb2.MESSAGE_ROLE_USER, content, [])


async def test_conversations_sort_by_their_latest_message(repo: SqlRepository) -> None:
    first = await repo.create_conversation(ALICE, "first", [])
    second = await repo.create_conversation(ALICE, "second", [])
    await repo.create_conversation(ALICE, "empty", [])
    await say(repo, second.id, "hello")
    await say(repo, first.id, "hello")

    listed = await repo.list_conversations(ALICE, 10, 0)

    assert [c.title for c in listed] == ["first", "second", "empty"]


async def test_renaming_or_rescoping_does_not_move_a_conversation(repo: SqlRepository) -> None:
    older = await repo.create_conversation(ALICE, "older", [])
    newer = await repo.create_conversation(ALICE, "newer", [])
    await say(repo, older.id, "hello")
    await say(repo, newer.id, "hello")

    renamed = await repo.update_conversation(ALICE, older.id, title="renamed")
    await repo.update_conversation(ALICE, older.id, document_ids=[uuid.uuid4()])

    assert [c.title for c in await repo.list_conversations(ALICE, 10, 0)] == ["newer", "renamed"]
    # The updated conversation still carries its latest message.
    assert renamed is not None
    assert renamed.last_message_preview == "hello"


async def test_conversations_without_messages_sort_by_creation(repo: SqlRepository) -> None:
    await repo.create_conversation(ALICE, "a", [])
    await repo.create_conversation(ALICE, "b", [])
    talked = await repo.create_conversation(ALICE, "talked", [])
    await say(repo, talked.id, "hello")
    await repo.create_conversation(ALICE, "c", [])

    listed = await repo.list_conversations(ALICE, 10, 0)

    assert [c.title for c in listed] == ["c", "talked", "b", "a"]
    assert listed[0].last_message_time is None
    assert listed[0].last_message_preview == ""


async def test_the_preview_is_the_latest_message_as_plain_text(repo: SqlRepository) -> None:
    conv = await repo.create_conversation(ALICE, "", [])
    await say(repo, conv.id, "first question")
    await repo.add_message(
        conv.id, chat_pb2.MESSAGE_ROLE_ASSISTANT, "**Paris** is the capital [1]. " * 20, []
    )

    [listed] = await repo.list_conversations(ALICE, 10, 0)
    got = await repo.get_conversation(ALICE, conv.id)
    messages = await repo.list_messages(conv.id)

    assert listed.last_message_preview.startswith("Paris is the capital. Paris")
    assert len(listed.last_message_preview) <= 120
    assert listed.last_message_preview.endswith("…")
    assert listed.last_message_time == messages[-1].created_at
    assert got is not None
    assert got.last_message_preview == listed.last_message_preview


async def test_paging_follows_the_order(repo: SqlRepository) -> None:
    for title in ["a", "b", "c"]:
        conv = await repo.create_conversation(ALICE, title, [])
        await say(repo, conv.id, title)

    pages = [await repo.list_conversations(ALICE, 2, 0), await repo.list_conversations(ALICE, 2, 2)]

    assert [[c.title for c in page] for page in pages] == [["c", "b"], ["a"]]


async def test_search_finds_words_in_titles_and_messages(repo: SqlRepository) -> None:
    titled = await repo.create_conversation(ALICE, "Trip to Lisbon", [])
    talked = await repo.create_conversation(ALICE, "Holidays", [])
    await say(repo, talked.id, "Which museums in **Lisbon** are open on Mondays?")
    await repo.create_conversation(ALICE, "Unrelated", [])

    found = await repo.search_conversations(ALICE, "lisbon", 10)

    assert [m.conversation.title for m in found] == ["Trip to Lisbon", "Holidays"]
    assert found[0].conversation.id == titled.id
    assert found[0].snippet == ""
    # The excerpt is plain text, without Markdown or highlight tags.
    assert found[1].snippet == "Which museums in Lisbon are open on Mondays?"
    assert found[1].conversation.last_message_preview == found[1].snippet


async def test_search_matches_word_prefixes_and_needs_every_word(repo: SqlRepository) -> None:
    conv = await repo.create_conversation(ALICE, "", [])
    await say(repo, conv.id, "The quarterly report is due on Friday")

    assert [m.conversation.id for m in await repo.search_conversations(ALICE, "QUART rep", 10)] == [
        conv.id
    ]
    assert await repo.search_conversations(ALICE, "quarterly invoice", 10) == []
    assert await repo.search_conversations(ALICE, "uarterly", 10) == []
    # Punctuation alone has no words to look for.
    assert await repo.search_conversations(ALICE, "?!", 10) == []
    # Quotes and operators are taken as text, not as query syntax.
    assert await repo.search_conversations(ALICE, "'report' & !friday |", 10) != []


async def test_search_ranks_titles_first_and_lists_each_conversation_once(
    repo: SqlRepository,
) -> None:
    often = await repo.create_conversation(ALICE, "Notes", [])
    for _ in range(3):
        await say(repo, often.id, "budget budget budget")
    once = await repo.create_conversation(ALICE, "Planning", [])
    await say(repo, once.id, "the budget for next year and some other things to talk about")
    titled = await repo.create_conversation(ALICE, "Budget review", [])
    await say(repo, titled.id, "budget")

    found = await repo.search_conversations(ALICE, "budget", 10)

    assert [m.conversation.id for m in found] == [titled.id, often.id, once.id]
    # A title match still shows the matching message.
    assert found[0].snippet == "budget"


async def test_search_keeps_the_best_message_as_the_snippet(repo: SqlRepository) -> None:
    conv = await repo.create_conversation(ALICE, "", [])
    await say(repo, conv.id, "a word about tea, among many other words about other things")
    await say(repo, conv.id, "tea, tea and more tea")
    await say(repo, conv.id, "coffee")

    [match] = await repo.search_conversations(ALICE, "tea", 10)

    assert match.snippet == "tea, tea and more tea"


async def test_search_cuts_long_messages_around_the_match(repo: SqlRepository) -> None:
    conv = await repo.create_conversation(ALICE, "", [])
    filler = " ".join(f"word{i}" for i in range(200))
    await say(repo, conv.id, f"{filler} needle {filler}")

    [match] = await repo.search_conversations(ALICE, "needle", 10)

    assert "needle" in match.snippet
    assert len(match.snippet.split()) <= 20


async def test_search_returns_at_most_limit_results(repo: SqlRepository) -> None:
    for i in range(3):
        await repo.create_conversation(ALICE, f"topic {i}", [])

    assert len(await repo.search_conversations(ALICE, "topic", 2)) == 2


async def test_users_see_only_their_own_conversations(repo: SqlRepository) -> None:
    mine = await repo.create_conversation(ALICE, "Lisbon", [])
    await say(repo, mine.id, "museums in Lisbon")
    theirs = await repo.create_conversation(BOB, "Lisbon too", [])
    await say(repo, theirs.id, "museums in Lisbon")

    assert mine.owner_id == ALICE
    assert [c.id for c in await repo.list_conversations(ALICE, 10, 0)] == [mine.id]
    assert [m.conversation.id for m in await repo.search_conversations(ALICE, "lisbon", 10)] == [
        mine.id
    ]
    assert [m.conversation.id for m in await repo.search_conversations(BOB, "museums", 10)] == [
        theirs.id
    ]


async def test_another_users_conversation_is_missing(repo: SqlRepository) -> None:
    conv = await repo.create_conversation(ALICE, "Mine", [])

    assert await repo.get_conversation(BOB, conv.id) is None
    assert await repo.update_conversation(BOB, conv.id, title="Taken") is None
    assert not await repo.delete_conversation(BOB, conv.id)

    kept = await repo.get_conversation(ALICE, conv.id)
    assert kept is not None
    assert kept.title == "Mine"


def _alembic(database_url: str, revision: str) -> None:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(cfg, revision)


async def test_the_migration_gives_existing_conversations_to_alice(database_url: str) -> None:
    # A database of its own, migrated up to just before ownership.
    admin = create_async_engine(database_url, isolation_level="AUTOCOMMIT")
    async with admin.connect() as conn:
        await conn.exec_driver_sql("DROP DATABASE IF EXISTS backfill")
        await conn.exec_driver_sql("CREATE DATABASE backfill")
    await admin.dispose()
    url = database_url.rsplit("/", 1)[0] + "/backfill"
    await asyncio.to_thread(_alembic, url, "0004")
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.exec_driver_sql(
            "INSERT INTO chat.conversations (id, title) VALUES (gen_random_uuid(), 'old')"
        )

    await asyncio.to_thread(_alembic, url, "head")

    try:
        listed = await SqlRepository(engine).list_conversations("CgVhbGljZRIFbG9jYWw", 10, 0)
        assert [c.title for c in listed] == ["old"]
        # New conversations must name their owner.
        async with engine.connect() as conn:
            default = await conn.exec_driver_sql(
                "SELECT column_default FROM information_schema.columns"
                " WHERE table_schema = 'chat' AND table_name = 'conversations'"
                " AND column_name = 'owner_id'"
            )
            assert default.scalar_one() is None
    finally:
        await engine.dispose()
