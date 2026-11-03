import math

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON
from sqlalchemy.types import TypeDecorator

EMBEDDING_DIM = 384


class EmbeddingType(TypeDecorator):
    """list[float] of length 384: pgvector on PostgreSQL, JSON elsewhere.

    impl is Vector so cosine_distance/l2_distance comparators exist on the column.
    """

    impl = Vector(EMBEDDING_DIM)
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(Vector(EMBEDDING_DIM))
        return dialect.type_descriptor(JSON(none_as_null=True))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        vals = [float(x) for x in value]
        if len(vals) != EMBEDDING_DIM:
            raise ValueError(f"embedding must have {EMBEDDING_DIM} dimensions, got {len(vals)}")
        if not all(math.isfinite(x) for x in vals):
            raise ValueError("embedding must contain only finite values")
        return vals

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return [float(x) for x in value]
