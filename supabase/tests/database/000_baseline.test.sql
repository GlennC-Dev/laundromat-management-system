begin;
select plan(1);
select has_extension('extensions', 'btree_gist', 'btree_gist is installed');
select * from finish();
rollback;
