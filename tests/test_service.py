"""Tests for the caching and fallback policy in :mod:`round105.service`."""

from __future__ import annotations

import asyncio

import pytest

from round105.errors import (
    NoZombiesData,
    PlayerNotFound,
    RateLimited,
    UpstreamUnavailable,
)
from round105.zombies import find_metric

from .conftest import SAMPLE_NAME, SAMPLE_UUID


async def test_first_lookup_hits_the_api(service):
    snapshot = await service.lookup(SAMPLE_NAME)

    assert snapshot.source == "live"
    assert snapshot.name == SAMPLE_NAME
    assert snapshot.uuid == SAMPLE_UUID
    assert snapshot.stats.overall.zombie_kills == 187_432
    assert snapshot.rank.tag == "[MVP++]"
    assert service.fake_hypixel.call_count == 1


async def test_second_lookup_is_served_from_cache(service, clock):
    await service.lookup(SAMPLE_NAME)
    clock.advance(120)

    snapshot = await service.lookup(SAMPLE_NAME)

    assert snapshot.source == "cache"
    assert not snapshot.is_stale
    assert service.fake_hypixel.call_count == 1


async def test_lookup_refetches_after_the_ttl(service, clock):
    await service.lookup(SAMPLE_NAME)
    clock.advance(301)

    snapshot = await service.lookup(SAMPLE_NAME)

    assert snapshot.source == "live"
    assert service.fake_hypixel.call_count == 2


async def test_username_is_resolved_once_within_the_name_ttl(service, clock):
    await service.lookup(SAMPLE_NAME)
    clock.advance(400)
    await service.lookup(SAMPLE_NAME)

    assert service.fake_mojang.calls == [SAMPLE_NAME]


async def test_unknown_username_raises(service):
    with pytest.raises(PlayerNotFound):
        await service.lookup("NotARealAccount")
    assert service.fake_hypixel.call_count == 0


async def test_stale_cache_covers_an_api_outage(service, clock):
    await service.lookup(SAMPLE_NAME)
    clock.advance(3_600)
    service.fake_hypixel.fail_with = UpstreamUnavailable("Hypixel", "timed out")

    snapshot = await service.lookup(SAMPLE_NAME)

    assert snapshot.source == "stale"
    assert snapshot.is_stale
    assert snapshot.stats.overall.zombie_kills == 187_432


async def test_stale_cache_covers_a_rate_limit(service, clock):
    await service.lookup(SAMPLE_NAME)
    clock.advance(3_600)
    service.fake_hypixel.fail_with = RateLimited(45.0)

    snapshot = await service.lookup(SAMPLE_NAME)

    assert snapshot.source == "stale"


async def test_outage_without_cache_raises(service):
    service.fake_hypixel.fail_with = UpstreamUnavailable("Hypixel", "timed out")

    with pytest.raises(UpstreamUnavailable):
        await service.lookup(SAMPLE_NAME)


async def test_mojang_outage_uses_the_cached_name_mapping(service, clock):
    await service.lookup(SAMPLE_NAME)
    clock.advance(90_000)  # past the name TTL as well
    service.fake_mojang.fail_with = UpstreamUnavailable("Mojang", "timed out")

    snapshot = await service.lookup(SAMPLE_NAME)

    assert snapshot.uuid == SAMPLE_UUID
    assert snapshot.source == "live"


async def test_mojang_outage_without_any_cache_raises(service):
    service.fake_mojang.fail_with = UpstreamUnavailable("Mojang", "timed out")

    with pytest.raises(UpstreamUnavailable):
        await service.lookup(SAMPLE_NAME)


async def test_player_without_zombies_data_raises(service):
    service.fake_hypixel.players[SAMPLE_UUID] = {"displayname": SAMPLE_NAME}

    with pytest.raises(NoZombiesData):
        await service.lookup(SAMPLE_NAME)


async def test_require_data_false_returns_empty_stats(service):
    service.fake_hypixel.players[SAMPLE_UUID] = {"displayname": SAMPLE_NAME}

    snapshot = await service.lookup(SAMPLE_NAME, require_data=False)

    assert not snapshot.stats.has_data


async def test_display_name_casing_comes_from_hypixel(service):
    snapshot = await service.lookup("roundrunner")
    assert snapshot.name == SAMPLE_NAME


async def test_concurrent_lookups_share_one_request(service):
    """Several users asking for the same player must cost one API call."""

    gate = asyncio.Event()
    service.fake_hypixel.gate = gate

    tasks = [asyncio.create_task(service.lookup(SAMPLE_NAME)) for _ in range(5)]
    await asyncio.sleep(0)  # let the tasks reach the gate
    gate.set()
    snapshots = await asyncio.gather(*tasks)

    assert service.fake_hypixel.call_count == 1
    assert all(s.stats.overall.zombie_kills == 187_432 for s in snapshots)


async def test_inflight_slot_is_released_after_completion(service, clock):
    await service.lookup(SAMPLE_NAME)
    clock.advance(301)
    await service.lookup(SAMPLE_NAME)

    assert service.fake_hypixel.call_count == 2
    assert service._inflight == {}  # noqa: SLF001 - asserting cleanup


async def test_leaderboard_ranks_cached_players(service, store, sample_player, clock):
    """Rankings come from the cache alone, without any extra API calls."""

    def player_with(kills: int) -> dict:
        copy = {**sample_player, "stats": {"Arcade": {**sample_player["stats"]["Arcade"]}}}
        copy["stats"]["Arcade"]["zombies_zombie_kills"] = kills
        return copy

    store.put_player("uuid-1", "Low", player_with(10))
    store.put_player("uuid-2", "High", player_with(9_000))
    store.put_player("uuid-3", "Mid", player_with(500))
    store.put_player("uuid-4", "NoData", {"displayname": "NoData"})

    metric = find_metric("kills")
    leaderboard = await service.leaderboard(metric)

    assert [e.name for e in leaderboard.entries] == ["High", "Mid", "Low"]
    assert [e.position for e in leaderboard.entries] == [1, 2, 3]
    assert leaderboard.entries[0].display_value == "9,000"
    assert leaderboard.players_ranked == 3
    assert leaderboard.players_cached == 4
    assert service.fake_hypixel.call_count == 0


async def test_leaderboard_respects_the_limit(service, store, sample_player):
    for index in range(8):
        store.put_player(f"uuid-{index}", f"Player{index}", sample_player)

    leaderboard = await service.leaderboard(find_metric("kills"), limit=3)

    assert len(leaderboard.entries) == 3
    assert leaderboard.players_ranked == 8


async def test_leaderboard_breaks_ties_by_name(service, store, sample_player):
    store.put_player("uuid-b", "Bravo", sample_player)
    store.put_player("uuid-a", "Alpha", sample_player)

    leaderboard = await service.leaderboard(find_metric("kills"))

    assert [e.name for e in leaderboard.entries] == ["Alpha", "Bravo"]


async def test_leaderboard_is_empty_without_cached_players(service):
    leaderboard = await service.leaderboard(find_metric("wins"))

    assert leaderboard.entries == []
    assert leaderboard.players_ranked == 0


async def test_leaderboard_reports_entry_age(service, store, sample_player, clock):
    store.put_player(SAMPLE_UUID, SAMPLE_NAME, sample_player)
    clock.advance(450)

    leaderboard = await service.leaderboard(find_metric("kills"))

    assert leaderboard.entries[0].age_seconds == 450
