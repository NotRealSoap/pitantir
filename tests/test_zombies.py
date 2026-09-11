"""Tests for Zombies stat parsing."""

from __future__ import annotations

import pytest

from round105.zombies import (
    ALIEN_ARCADIUM,
    BAD_BLOOD,
    DEAD_END,
    MAPS,
    PRISON,
    extract_arcade_stats,
    find_map,
    find_metric,
    parse_zombies_stats,
)


def test_parses_overall_counters(sample_stats):
    overall = sample_stats.overall
    assert overall.zombie_kills == 187_432
    assert overall.deaths == 1_204
    assert overall.wins == 96
    assert overall.best_round == 105
    assert overall.rounds_survived == 14_822
    assert overall.players_revived == 3_120
    assert overall.windows_repaired == 5_210
    assert overall.doors_opened == 1_890


def test_derived_ratios(sample_stats):
    overall = sample_stats.overall
    assert overall.kill_death_ratio == pytest.approx(187_432 / 1_204)
    assert overall.accuracy == pytest.approx(402_311 / 655_120)
    assert overall.headshot_rate == pytest.approx(88_450 / 402_311)
    assert overall.kills_per_round == pytest.approx(187_432 / 14_822)


def test_map_counters_are_scoped(sample_stats):
    dead_end = sample_stats.map_stats(DEAD_END)
    assert dead_end.combat.zombie_kills == 72_311
    assert dead_end.combat.wins == 51
    assert dead_end.combat.doors_opened == 733

    prison = sample_stats.map_stats(PRISON)
    assert prison.combat.zombie_kills == 21_044
    assert prison.combat.wins == 0


def test_difficulty_breakdown(sample_stats):
    dead_end = sample_stats.map_stats(DEAD_END)

    normal = dead_end.difficulty("normal")
    assert normal is not None
    assert normal.wins == 34
    assert normal.best_round == 30
    assert normal.fastest_time(10) == 402
    assert normal.fastest_time(30) == 1_623

    hard = dead_end.difficulty("hard")
    assert hard is not None
    # The fixture has no 20-round time on hard, which must read as "never done".
    assert hard.fastest_time(20) is None
    assert hard.fastest_time(30) == 1_899


def test_unplayed_difficulty_is_excluded_from_table(sample_stats):
    bad_blood = sample_stats.map_stats(BAD_BLOOD)
    played = [d.difficulty.id for d in bad_blood.played_difficulties()]
    assert played == ["normal", "hard"]

    rip = bad_blood.difficulty("rip")
    assert rip is not None
    assert not rip.played


def test_completion_requires_a_win(sample_stats):
    assert sample_stats.map_stats(DEAD_END).completed
    assert sample_stats.map_stats(BAD_BLOOD).completed
    # Prison has games but no wins.
    assert not sample_stats.map_stats(PRISON).completed
    assert sample_stats.maps_completed == 2


def test_alien_arcadium_is_endless(sample_stats):
    arcadium = sample_stats.map_stats(ALIEN_ARCADIUM)
    assert arcadium.map.is_endless
    assert arcadium.map.difficulties == ()
    assert arcadium.difficulties == {}
    assert arcadium.combat.best_round == 105
    # Endless maps can never be "completed", even with a win counter present.
    assert not arcadium.completed


def test_maps_played_lists_only_maps_with_data(sample_stats):
    assert [m.map.id for m in sample_stats.maps_played()] == [
        "deadend",
        "badblood",
        "prison",
        "alienarcadium",
    ]


def test_missing_player_yields_zeroed_stats():
    stats = parse_zombies_stats(None)
    assert not stats.has_data
    assert stats.overall.zombie_kills == 0
    assert len(stats.maps) == len(MAPS)
    assert stats.maps_completed == 0


@pytest.mark.parametrize(
    "player",
    [
        {},
        {"stats": None},
        {"stats": {}},
        {"stats": {"Arcade": None}},
        {"stats": {"Arcade": {}}},
    ],
)
def test_malformed_player_shapes_do_not_raise(player):
    assert not parse_zombies_stats(player).has_data


def test_non_numeric_counters_are_tolerated():
    stats = parse_zombies_stats(
        {
            "stats": {
                "Arcade": {
                    # Hypixel occasionally returns counters as strings.
                    "zombies_zombie_kills": "4210",
                    "zombies_deaths": 12.0,
                    "zombies_best_round": None,
                    "wins_zombies": True,
                    "zombies_bullets_shot": "not a number",
                }
            }
        }
    )
    assert stats.overall.zombie_kills == 4_210
    assert stats.overall.deaths == 12
    assert stats.overall.best_round == 0
    assert stats.overall.wins == 0
    assert stats.overall.bullets_shot == 0


def test_legacy_revives_key_is_honoured():
    stats = parse_zombies_stats(
        {"stats": {"Arcade": {"zombies_revives": 44, "zombies_zombie_kills": 1}}}
    )
    assert stats.overall.players_revived == 44


def test_ratio_without_deaths_falls_back_to_count():
    stats = parse_zombies_stats(
        {"stats": {"Arcade": {"zombies_zombie_kills": 500, "zombies_deaths": 0}}}
    )
    assert stats.overall.kill_death_ratio == 500.0


def test_accuracy_is_clamped_and_safe():
    stats = parse_zombies_stats(
        {
            "stats": {
                "Arcade": {
                    # More hits than shots is impossible but has been observed.
                    "zombies_bullets_hit": 200,
                    "zombies_bullets_shot": 100,
                    "zombies_headshots": 400,
                }
            }
        }
    )
    assert stats.overall.accuracy == 1.0
    assert stats.overall.headshot_rate == 1.0

    empty = parse_zombies_stats({"stats": {"Arcade": {}}})
    assert empty.overall.accuracy == 0.0
    assert empty.overall.headshot_rate == 0.0


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("deadend", "deadend"),
        ("Dead End", "deadend"),
        ("de", "deadend"),
        ("BB", "badblood"),
        ("bad-blood", "badblood"),
        ("aa", "alienarcadium"),
        ("Alien Arcadium", "alienarcadium"),
        ("prison", "prison"),
        (" PRISON ", "prison"),
    ],
)
def test_find_map_accepts_aliases(query, expected):
    found = find_map(query)
    assert found is not None
    assert found.id == expected


def test_find_map_rejects_unknown():
    assert find_map("nuketown") is None


def test_extract_arcade_stats_keeps_only_zombies_keys(sample_player):
    extracted = extract_arcade_stats(sample_player)
    assert "zombies_zombie_kills" in extracted
    assert "wins_zombies_deadend_normal" in extracted
    # Other Arcade games must not be carried into the cache.
    assert "coins" not in extracted
    assert "wins_dayone" not in extracted
    assert all(
        key.startswith("zombies_") or key.startswith("wins_zombies")
        for key in extracted
    )


def test_extract_arcade_stats_on_missing_section():
    assert extract_arcade_stats({}) == {}
    assert extract_arcade_stats({"stats": {"Bedwars": {}}}) == {}


def test_metrics_rank_and_format(sample_stats):
    kills = find_metric("kills")
    assert kills is not None
    assert kills.extract(sample_stats) == 187_432
    assert kills.format(187_432) == "187,432"

    accuracy = find_metric("acc")
    assert accuracy is not None
    assert accuracy.format(accuracy.extract(sample_stats)) == "61.4%"

    kdr = find_metric("kdr")
    assert kdr is not None
    assert kdr.format(kdr.extract(sample_stats)) == "155.67"


def test_find_metric_rejects_unknown():
    assert find_metric("vibes") is None
