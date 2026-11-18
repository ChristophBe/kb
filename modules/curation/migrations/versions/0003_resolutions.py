"""resolutions of findings, and one finding per pair

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # keep, replace or ignore; null while the finding is open.
    op.add_column("findings", sa.Column("resolution", sa.Text), schema="curation")
    op.add_column(
        "findings", sa.Column("resolved_at", sa.DateTime(timezone=True)), schema="curation"
    )
    op.add_column("findings", sa.Column("resolved_by", sa.Text), schema="curation")
    # Detecting the same pair again (a redelivered event) adds nothing, and a
    # resolved finding is not opened again.
    op.create_index(
        "findings_pair_idx",
        "findings",
        ["kind", "document_id", "other_document_id"],
        unique=True,
        schema="curation",
    )
    op.create_check_constraint(
        "findings_kind_check",
        "findings",
        "kind in ('duplicate', 'superseded', 'conflict')",
        schema="curation",
    )


def downgrade() -> None:
    op.drop_constraint("findings_kind_check", "findings", schema="curation")
    op.drop_index("findings_pair_idx", table_name="findings", schema="curation")
    op.drop_column("findings", "resolved_by", schema="curation")
    op.drop_column("findings", "resolved_at", schema="curation")
    op.drop_column("findings", "resolution", schema="curation")
