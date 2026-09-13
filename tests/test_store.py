"""Tests for the SQLite cache."""

from __future__ import annotations

import json

from round105.store import PlayerStore, trim_player

from .conftest import SAMPLE_NAME, SAMPLE_UUID


def test_put_and_get_roundtrip(store, sample_player):
    store.put_player(SAMPLE_UUID, SAMPLE_NAME, sample_player)

    cached = store.get_player(SAMPLE_UUID)
    assert cached is not None
    assert cached.name == SAMPLE_NAME
    assert cached.stats().overall.zombie_kills == 187_432


def test_get_missing_player_is_none(store):
    assert store.get_player("does-not-exist") is None


def test_stored_payload_is_trimmed(sample_player):
    trimmed = trim_player(sample_player)

    assert trimmed["displayname"] == SAMPLE_NAME
    assert trimmed["monthlyPackageRank"] == "SUPERSTAR"
    # Only Zombies counters survive, and only from Arcade.
    assert "Bedwars" not in trimmed["stats"]
    assert "coins" not in trimmed["stats"]["Arcade"]
    assert trimmed["stats"]["Arcade"]["zombies_zombie_kills"] == 187_432

    assert len(json.dumps(trimmed)) < len(json.dumps(sample_player))


def test_freshness_follows_the_clock(store, clock, sample_player):
    store.put_player(SAMPLE_UUID, SAMPLE_NAME, sample_player)

    cached = store.get_player(SAMPLE_UUID)
    assert cached is not None
    assert cached.is_fresh(300, clock())

    clock.advance(299)
    assert cached.is_fresh(300, clock())
    assert cached.age(clock()) == 299

    clock.advance(2)
    assert not cached.is_fresh(300, clock())


def test_expired_rows_are_still_readable(store, clock, sample_player):
    """Expiry must not delete data; stale rows are the offline fallback."""

    store.put_player(SAMPLE_UUID, SAMPLE_NAME, sample_player)
    clock.advance(10_000)

    cached = store.get_player(SAMPLE_UUID)
    assert cached is not None
    assert not cached.is_fresh(300, clock())


def test_put_player_updates_in_place(store, clock, sample_player):
    store.put_player(SAMPLE_UUID, SAMPLE_NAME, sample_player)
    clock.advance(600)
    store.put_player(SAMPLE_UUID, "RenamedPlayer", sample_player)

    assert store.count_players() == 1
    cached = store.get_player(SAMPLE_UUID)
    assert cached is not None
    assert cached.name == "RenamedPlayer"
    assert cached.age(clock()) == 0


def test_lookup_by_name_is_case_insensitive(store, sample_player):
    store.put_player(SAMPLE_UUID, SAMPLE_NAME, sample_player)

    cached = store.get_player_by_name("roundrunner")
    assert cached is not None
    assert cached.uuid == SAMPLE_UUID
    assert store.get_player_by_name("someone-else") is None


def test_iter_players_is_newest_first(store, clock, sample_player):
    store.put_player("uuid-a", "Alpha", sample_player)
    clock.advance(60)
    store.put_player("uuid-b", "Bravo", sample_player)

    assert [p.name for p in store.iter_players()] == ["Bravo", "Alpha"]


def test_name_mapping_roundtrip(store, clock):
    store.put_name(SAMPLE_NAME, SAMPLE_UUID)

    cached = store.get_name("ROUNDRUNNER")
    assert cached is not None
    assert cached.uuid == SAMPLE_UUID
    assert cached.name == SAMPLE_NAME
    assert cached.is_fresh(86_400, clock())

    clock.advance(86_401)
    assert not cached.is_fresh(86_400, clock())
    assert store.get_name("nobody") is None


def test_prune_removes_only_old_rows(store, clock, sample_player):
    store.put_player("uuid-old", "Old", sample_player)
    store.put_name("Old", "uuid-old")
    clock.advance(5_000)
    store.put_player("uuid-new", "New", sample_player)

    removed = store.prune(1_000)

    assert removed == 1
    assert store.count_players() == 1
    assert store.get_player("uuid-old") is None
    assert store.get_player("uuid-new") is not None
    assert store.get_name("Old") is None


def test_corrupt_payload_degrades_to_empty_stats(store, sample_player, tmp_path):
    store.put_player(SAMPLE_UUID, SAMPLE_NAME, sample_player)
    store._connection.execute(  # noqa: SLF001 - deliberately corrupting a row
        "UPDATE players SET payload = ? WHERE uuid = ?", ("{not json", SAMPLE_UUID)
    )

    cached = store.get_player(SAMPLE_UUID)
    assert cached is not None
    assert not cached.stats().has_data


def test_store_creates_parent_directory(tmp_path):
    path = tmp_path / "nested" / "deeper" / "cache.sqlite3"
    with PlayerStore(path):
        assert path.exists()


def test_data_survives_reopening(tmp_path, sample_player):
    path = tmp_path / "cache.sqlite3"
    with PlayerStore(path) as first:
        first.put_player(SAMPLE_UUID, SAMPLE_NAME, sample_player)

    with PlayerStore(path) as second:
        cached = second.get_player(SAMPLE_UUID)
        assert cached is not None
        assert cached.stats().overall.wins == 96
