"""document scores and findings

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "document_scores",
        # The id of a document in the document module; no foreign key across modules.
        sa.Column("document_id", sa.Uuid, primary_key=True),
        sa.Column("score", sa.Double, nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        schema="curation",
    )
    op.create_table(
        "findings",
        sa.Column("id", sa.Uuid, primary_key=True),
        # duplicate, superseded or conflict
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("document_id", sa.Uuid, nullable=False),
        sa.Column("other_document_id", sa.Uuid, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        schema="curation",
    )
    op.create_index("findings_created_at_idx", "findings", ["created_at"], schema="curation")


def downgrade() -> None:
    op.drop_table("findings", schema="curation")
    op.drop_table("document_scores", schema="curation")
