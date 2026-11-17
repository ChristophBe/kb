"""configurable system prompt per conversation and global prompt templates

Revision ID: 0008
Revises: 0007
"""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column("system_prompt", sa.Text, nullable=False, server_default=""),
        schema="chat",
    )
    op.create_table(
        "prompt_templates",
        sa.Column("name", sa.Text, primary_key=True),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        schema="chat",
    )


def downgrade() -> None:
    op.drop_table("prompt_templates", schema="chat")
    op.drop_column("conversations", "system_prompt", schema="chat")
