"""Alembic environment for the chat module (schema "chat")."""

import asyncio

from alembic import context
from kb_chat.db import SCHEMA, metadata
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

config = context.config


def _run(connection) -> None:
    connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
    context.configure(
        connection=connection,
        target_metadata=metadata,
        version_table_schema=SCHEMA,
        include_schemas=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def _run_async() -> None:
    engine = create_async_engine(config.get_main_option("sqlalchemy.url") or "")
    async with engine.begin() as conn:
        await conn.run_sync(_run)
    await engine.dispose()


asyncio.run(_run_async())
