import dataclasses

import pytest

from core.models import Allocation, Candidate


def test_models_are_frozen_and_hashable():
    c = Candidate("c1", "A", "text", ("python",), 3, 2)
    hash(c)
    with pytest.raises(dataclasses.FrozenInstanceError):
        c.name = "x"
    assert Allocation("hungarian", (), ("c1",)).unallocated == ("c1",)
