"""Compatibility package exposing shared automation helpers.

This package re-exports modules housed under ``scripts/utils`` so that legacy
imports like ``from utils.database import get_supabase`` keep working.
"""

# Modules are provided via explicit submodule wrappers.
