"""Tests for Hypixel rank resolution."""

from __future__ import annotations

from round105.ranks import (
    COLOR_CODES,
    DEFAULT_COLOR,
    named_color,
    resolve_rank,
    strip_color_codes,
)


def test_default_rank_when_nothing_is_set():
    rank = resolve_rank({})
    assert not rank.has_tag
    assert rank.tag == ""
    assert rank.name_color() == DEFAULT_COLOR
    assert rank.segments() == []


def test_none_placeholders_are_treated_as_unset():
    rank = resolve_rank(
        {"rank": "NORMAL", "newPackageRank": "NONE", "monthlyPackageRank": "NONE"}
    )
    assert not rank.has_tag


def test_vip_and_mvp(sample_player):
    assert resolve_rank({"newPackageRank": "VIP"}).tag == "[VIP]"
    assert resolve_rank({"newPackageRank": "MVP"}).tag == "[MVP]"

    vip_plus = resolve_rank({"newPackageRank": "VIP_PLUS"})
    assert vip_plus.tag == "[VIP+]"
    assert vip_plus.color == COLOR_CODES["a"]
    assert vip_plus.plus_color == COLOR_CODES["6"]


def test_mvp_plus_uses_custom_plus_colour():
    rank = resolve_rank({"newPackageRank": "MVP_PLUS", "rankPlusColor": "AQUA"})
    assert rank.tag == "[MVP+]"
    assert rank.color == COLOR_CODES["b"]
    assert rank.plus_color == named_color("AQUA")


def test_mvp_plus_plus_beats_package_rank(sample_player):
    # The fixture has both MVP_PLUS and a SUPERSTAR subscription.
    rank = resolve_rank(sample_player)
    assert rank.tag == "[MVP++]"
    assert rank.color == named_color("GOLD")
    assert rank.plus_color == named_color("AQUA")
    assert rank.plus_count == 2


def test_mvp_plus_plus_defaults_to_gold():
    rank = resolve_rank({"monthlyPackageRank": "SUPERSTAR"})
    assert rank.color == COLOR_CODES["6"]


def test_legacy_package_rank_field_is_used():
    assert resolve_rank({"packageRank": "MVP_PLUS"}).tag == "[MVP+]"


def test_staff_rank_wins_over_package_rank():
    rank = resolve_rank({"rank": "ADMIN", "newPackageRank": "MVP_PLUS"})
    assert rank.tag == "[ADMIN]"
    assert rank.color == COLOR_CODES["c"]


def test_custom_prefix_wins_over_everything():
    rank = resolve_rank({"prefix": "\u00a7c[OWNER]", "rank": "ADMIN"})
    assert rank.tag == "[OWNER]"
    assert rank.color == COLOR_CODES["c"]


def test_blank_prefix_is_ignored():
    rank = resolve_rank({"prefix": "   ", "newPackageRank": "MVP"})
    assert rank.tag == "[MVP]"


def test_prefix_without_colour_code_uses_default():
    rank = resolve_rank({"prefix": "[EVENT]"})
    assert rank.tag == "[EVENT]"
    assert rank.color == DEFAULT_COLOR


def test_segments_split_plus_signs():
    rank = resolve_rank({"monthlyPackageRank": "SUPERSTAR", "rankPlusColor": "RED"})
    assert rank.segments() == [
        ("[MVP", named_color("GOLD")),
        ("++", named_color("RED")),
        ("]", named_color("GOLD")),
    ]


def test_segments_of_plain_tag_is_single_run():
    rank = resolve_rank({"newPackageRank": "MVP"})
    assert rank.segments() == [("[MVP]", COLOR_CODES["b"])]


def test_strip_color_codes():
    assert strip_color_codes("\u00a76[MVP\u00a7c++\u00a76]") == "[MVP++]"
    assert strip_color_codes("&a&lBOLD") == "BOLD"
    assert strip_color_codes("plain") == "plain"


def test_named_color_falls_back():
    assert named_color("NOT_A_COLOR") == DEFAULT_COLOR
    assert named_color(None) == DEFAULT_COLOR
    assert named_color("gold") == COLOR_CODES["6"]


def test_resolve_rank_of_none():
    assert not resolve_rank(None).has_tag
