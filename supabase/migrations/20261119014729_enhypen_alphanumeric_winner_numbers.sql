-- Allow alphanumeric ENHYPEN winner numbers while retaining numeric duplicate semantics.
alter table public.enhypen_winner_list
  drop constraint enhypen_winner_list_winner_number_check;

alter table public.enhypen_winner_list
  add constraint enhypen_winner_list_winner_number_check
  check (winner_number ~ '^[A-Z0-9]{1,16}$');

drop index public.enhypen_winner_number_key;

create unique index enhypen_winner_number_key
  on public.enhypen_winner_list
  ((case
    when winner_number ~ '^[0-9]+$' then (winner_number::numeric)::text
    else upper(winner_number)
  end))
  where winner_number is not null;
