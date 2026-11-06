"""SqlRepository against a real Postgres (needs Docker; run by `task test:integration`)."""

import asyncio
import uuid
from collections.abc import AsyncIterator, Iterator

import pytest
from kb.chat.v1 import chat_pb2
from kb_chat.db import SqlRepository, migrate
from sqlalchemy.ext.asyncio import create_async_engine
from testcontainers.community.postgres import PostgresContainer

pytestmark = pytest.mark.integration

# The image of deploy/infra.compose.yaml, as in platform/go/postgres/pgtest.
IMAGE = "pgvector/pgvector:pg17"


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
    first = await repo.create_conversation("first", [])
    second = await repo.create_conversation("second", [])
    await repo.create_conversation("empty", [])
    await say(repo, second.id, "hello")
    await say(repo, first.id, "hello")

    listed = await repo.list_conversations(10, 0)

    assert [c.title for c in listed] == ["first", "second", "empty"]


async def test_renaming_or_rescoping_does_not_move_a_conversation(repo: SqlRepository) -> None:
    older = await repo.create_conversation("older", [])
    newer = await repo.create_conversation("newer", [])
    await say(repo, older.id, "hello")
    await say(repo, newer.id, "hello")

    renamed = await repo.update_conversation(older.id, title="renamed")
    await repo.update_conversation(older.id, document_ids=[uuid.uuid4()])

    assert [c.title for c in await repo.list_conversations(10, 0)] == ["newer", "renamed"]
    # The updated conversation still carries its latest message.
    assert renamed is not None
    assert renamed.last_message_preview == "hello"


async def test_conversations_without_messages_sort_by_creation(repo: SqlRepository) -> None:
    await repo.create_conversation("a", [])
    await repo.create_conversation("b", [])
    talked = await repo.create_conversation("talked", [])
    await say(repo, talked.id, "hello")
    await repo.create_conversation("c", [])

    listed = await repo.list_conversations(10, 0)

    assert [c.title for c in listed] == ["c", "talked", "b", "a"]
    assert listed[0].last_message_time is None
    assert listed[0].last_message_preview == ""


async def test_the_preview_is_the_latest_message_as_plain_text(repo: SqlRepository) -> None:
    conv = await repo.create_conversation("", [])
    await say(repo, conv.id, "first question")
    await repo.add_message(
        conv.id, chat_pb2.MESSAGE_ROLE_ASSISTANT, "**Paris** is the capital [1]. " * 20, []
    )

    [listed] = await repo.list_conversations(10, 0)
    got = await repo.get_conversation(conv.id)
    messages = await repo.list_messages(conv.id)

    assert listed.last_message_preview.startswith("Paris is the capital. Paris")
    assert len(listed.last_message_preview) <= 120
    assert listed.last_message_preview.endswith("…")
    assert listed.last_message_time == messages[-1].created_at
    assert got is not None
    assert got.last_message_preview == listed.last_message_preview


async def test_paging_follows_the_order(repo: SqlRepository) -> None:
    for title in ["a", "b", "c"]:
        conv = await repo.create_conversation(title, [])
        await say(repo, conv.id, title)

    pages = [await repo.list_conversations(2, 0), await repo.list_conversations(2, 2)]

    assert [[c.title for c in page] for page in pages] == [["c", "b"], ["a"]]
