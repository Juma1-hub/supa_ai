import pytest
from app.main import app, require_supa_user
from app.supa_auth import SupaUser

@pytest.fixture(autouse=True)
def authenticated_test_user():
    async def fake_user():
        return SupaUser(id="00000000-0000-0000-0000-000000000001", email="test@example.invalid")
    app.dependency_overrides[require_supa_user] = fake_user
    yield
    app.dependency_overrides.pop(require_supa_user, None)
