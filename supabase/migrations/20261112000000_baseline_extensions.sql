-- Baseline: extensions required by later schema (overlap exclusion on machine runs).
create extension if not exists btree_gist with schema extensions;
