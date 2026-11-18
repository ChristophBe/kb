"""when a document was last processed

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The recency a score is computed from: when ingestion last finished the document.
    op.add_column(
        "document_scores",
        sa.Column(
            "processed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        schema="curation",
    )
    # Superseded findings are counted per older document when it is scored.
    op.create_index(
        "findings_document_id_idx", "findings", ["document_id", "kind"], schema="curation"
    )


def downgrade() -> None:
    op.drop_index("findings_document_id_idx", table_name="findings", schema="curation")
    op.drop_column("document_scores", "processed_at", schema="curation")
