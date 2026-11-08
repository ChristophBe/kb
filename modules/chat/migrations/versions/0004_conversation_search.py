"""add full-text search indexes on titles and messages

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The expressions must match db.py's search query for the planner to use
    # them. The "simple" configuration doesn't stem, so it works for any language.
    op.create_index(
        "conversations_title_search_idx",
        "conversations",
        [sa.text("to_tsvector('simple'::regconfig, title)")],
        postgresql_using="gin",
        schema="chat",
    )
    op.create_index(
        "messages_content_search_idx",
        "messages",
        [sa.text("to_tsvector('simple'::regconfig, content)")],
        postgresql_using="gin",
        schema="chat",
    )


def downgrade() -> None:
    op.drop_index("messages_content_search_idx", "messages", schema="chat")
    op.drop_index("conversations_title_search_idx", "conversations", schema="chat")
