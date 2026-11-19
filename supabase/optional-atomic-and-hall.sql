-- ============================================================================
-- OPTIONAL server-side upgrade for متجر العطاء  (NOT applied; run it in Supabase -> SQL Editor if you want it)
--
-- What it adds, inside the database itself:
--   1) hall_of_fame      : permanent "points earned since the beginning" ledger, kept by a TRIGGER, so it is correct
--                          no matter which app/phone/site changes a balance (and cannot be forgotten by a client).
--   2) place_order()     : ATOMIC checkout. Balance, stock, per-order limits, cooldown and store-open state are checked
--                          and applied in ONE transaction with row locks (no half-saved orders, no overselling when two
--                          students buy the last item at the same moment).
--   3) refund_all_orders(): ATOMIC "حذف وإرجاع الجميع" (quantities + points + cooldowns), not counted as earned.
--
-- Safe to run: it only ADDS objects and a backfill; it does not change or delete existing data or policies.
-- Tested on PostgreSQL 16 with a copy of the schema (see test notes at the bottom). Not yet tested on your Supabase.
-- ============================================================================

-- ---------------------------------------------------------------- 1) hall of fame ledger
create table if not exists public.hall_of_fame (
  buyer_id   uuid primary key,
  name       text    not null,
  stage      text,
  earned     integer not null default 0 check (earned >= 0),
  updated_at timestamptz not null default now()
);
alter table public.hall_of_fame enable row level security;
drop policy if exists "hall readable by everyone" on public.hall_of_fame;
create policy "hall readable by everyone" on public.hall_of_fame for select using (true);
-- no insert/update/delete policy: only the trigger / SECURITY DEFINER functions below can write.

-- "earned" = every INCREASE of a balance, except points handed back by a refund (flag app.refund = on).
-- A spend (balance -> 0) never reduces it. Re-inserting a student that already has a row (backup restore keeps the id)
-- does not count again.
create or replace function public.tg_buyers_earned() returns trigger
language plpgsql security definer set search_path = public as $$
declare d integer;
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from hall_of_fame where buyer_id = new.id) then
      update hall_of_fame set name = new.name, stage = new.stage, updated_at = now() where buyer_id = new.id;
      return new;
    end if;
    d := coalesce(new.balance, 0);
  else
    d := coalesce(new.balance, 0) - coalesce(old.balance, 0);
  end if;

  if d > 0 and coalesce(current_setting('app.refund', true), '') <> 'on' then
    insert into hall_of_fame(buyer_id, name, stage, earned) values (new.id, new.name, new.stage, d)
    on conflict (buyer_id) do update
      set earned = hall_of_fame.earned + d, name = excluded.name, stage = excluded.stage, updated_at = now();
  else
    insert into hall_of_fame(buyer_id, name, stage, earned) values (new.id, new.name, new.stage, 0)
    on conflict (buyer_id) do update set name = excluded.name, stage = excluded.stage;
  end if;
  return new;
end $$;

drop trigger if exists buyers_earned on public.buyers;
create trigger buyers_earned after insert or update of balance, name, stage on public.buyers
  for each row execute function public.tg_buyers_earned();

-- Backfill (run once): current balance + the balance each recorded order consumed. Review/edit the numbers afterwards.
insert into public.hall_of_fame(buyer_id, name, stage, earned)
select b.id, b.name, b.stage,
       coalesce(b.balance, 0) + coalesce((select sum(coalesce(o.buyer_balance, o.total_points)) from public.orders o where o.buyer_name = b.name), 0)
from public.buyers b
on conflict (buyer_id) do nothing;

-- ---------------------------------------------------------------- 2) atomic checkout
-- p_items = [{"product_id": "...", "quantity": 2}, ...]  (prices and names are taken from the DB, never from the client)
create or replace function public.place_order(p_buyer_name text, p_items jsonb) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_buyer   public.buyers;
  v_open    boolean;
  v_total   integer := 0;
  v_items   jsonb   := '[]'::jsonb;
  v_it      record;
  v_p       public.products;
  v_order   public.orders;
begin
  select coalesce((value ->> 'open')::boolean, true) into v_open from store_settings where key = 'store_open';
  if v_open is false then raise exception 'STORE_CLOSED'; end if;

  select * into v_buyer from buyers where name = p_buyer_name and coalesce(active, true) for update;
  if not found then raise exception 'BUYER_NOT_FOUND'; end if;

  if exists (select 1 from buyer_cooldowns where buyer_name = p_buyer_name and expires_at > now()) then
    raise exception 'COOLDOWN';
  end if;

  -- lock products in a fixed order (no deadlocks) and validate every line
  for v_it in
    select (x ->> 'product_id')::uuid as product_id, sum((x ->> 'quantity')::int) as quantity
    from jsonb_array_elements(p_items) x group by 1 order by 1
  loop
    if v_it.quantity is null or v_it.quantity < 1 then raise exception 'BAD_QUANTITY'; end if;
    select * into v_p from products where id = v_it.product_id for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    if v_p.stock < v_it.quantity then raise exception 'OUT_OF_STOCK:%', v_p.name; end if;
    if v_p.max_per_order is not null and v_it.quantity > v_p.max_per_order then raise exception 'OVER_LIMIT:%', v_p.name; end if;
    v_total := v_total + v_p.points * v_it.quantity;
    v_items := v_items || jsonb_build_object('product_id', v_p.id, 'name', v_p.name, 'points', v_p.points, 'quantity', v_it.quantity);
  end loop;

  if jsonb_array_length(v_items) = 0 then raise exception 'EMPTY_ORDER'; end if;
  if v_total > coalesce(v_buyer.balance, 0) then raise exception 'NOT_ENOUGH_POINTS'; end if;

  update products p set stock = p.stock - (i ->> 'quantity')::int
  from jsonb_array_elements(v_items) i where p.id = (i ->> 'product_id')::uuid;

  insert into orders(buyer_name, items, total_points, buyer_balance)
  values (p_buyer_name, v_items, v_total, v_buyer.balance) returning * into v_order;

  update buyers set balance = 0 where id = v_buyer.id;       -- same rule as the site: an order uses the whole balance
  insert into buyer_cooldowns(buyer_name, expires_at) values (p_buyer_name, now() + interval '24 hours')
  on conflict (buyer_name) do update set expires_at = excluded.expires_at;

  return v_order;
end $$;

-- ---------------------------------------------------------------- 3) atomic "delete and return everything"
create or replace function public.refund_all_orders() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_orders int := 0; v_units int := 0; v_points int := 0; o record; it jsonb;
begin
  perform set_config('app.refund', 'on', true);               -- points handed back are NOT "earned"
  for o in select * from orders order by created_at for update loop
    for it in select * from jsonb_array_elements(o.items) loop
      update products set stock = stock + (it ->> 'quantity')::int where id = (it ->> 'product_id')::uuid;
      if found then v_units := v_units + (it ->> 'quantity')::int; end if;
    end loop;
    update buyers set balance = coalesce(balance, 0) + coalesce(o.buyer_balance, o.total_points) where name = o.buyer_name;
    if found then v_points := v_points + coalesce(o.buyer_balance, o.total_points); end if;
    delete from buyer_cooldowns where buyer_name = o.buyer_name;
    delete from orders where id = o.id;
    v_orders := v_orders + 1;
  end loop;
  return jsonb_build_object('orders', v_orders, 'units', v_units, 'points', v_points);
end $$;

grant execute on function public.place_order(text, jsonb) to anon, authenticated;
grant execute on function public.refund_all_orders()       to anon, authenticated;

-- ============================================================================
-- Notes
--  * After running this, the website/app must be switched to call place_order() / refund_all_orders() and to read
--    hall_of_fame (today the add-on keeps an equivalent ledger in store_settings). Until that switch, running this file
--    changes nothing for users; the trigger will simply start filling hall_of_fame.
--  * Security reality check: the admin panel currently writes with the public (anon) key and checks the PIN in the browser,
--    and store_settings (which contains the admin PIN/password) is readable by anyone. Real protection needs Supabase Auth
--    for the admin + RLS policies that only allow writes to authenticated admins. That is a separate, larger change.
-- ============================================================================
