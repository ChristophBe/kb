"""add the owner of each conversation

Revision ID: 0005
Revises: 0004
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

# The subject of the Dex dev user alice@example.com (deploy/dex). Conversations
# from before ownership go to her, so local data stays visible when signed in
# as alice.
DEFAULT_OWNER = "CgVhbGljZRIFbG9jYWw"


def upgrade() -> None:
    # The id of the user (the token's subject, x-kb-user) who created it. The
    # server default only backfills the existing rows; new rows always set it.
    op.add_column(
        "conversations",
        sa.Column("owner_id", sa.Text, nullable=False, server_default=DEFAULT_OWNER),
        schema="chat",
    )
    op.alter_column("conversations", "owner_id", server_default=None, schema="chat")
    op.create_index("conversations_owner_id_idx", "conversations", ["owner_id"], schema="chat")


def downgrade() -> None:
    op.drop_index("conversations_owner_id_idx", "conversations", schema="chat")
    op.drop_column("conversations", "owner_id", schema="chat")
