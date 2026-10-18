alter type public.account_role add value if not exists 'admin';

do $$
declare
  target_user auth.users%rowtype;
begin
  select *
  into target_user
  from auth.users
  where lower(email) = lower('chasecrawford829@gmail.com')
  limit 1;

  if target_user.id is null then
    raise exception 'Create and confirm the account for chasecrawford829@gmail.com before you run this migration.';
  end if;

  insert into public.profiles (id, display_name, role)
  values (
    target_user.id,
    coalesce(
      nullif(trim(target_user.raw_user_meta_data ->> 'display_name'), ''),
      split_part(target_user.email, '@', 1)
    ),
    'admin'
  )
  on conflict (id) do update
  set role = 'admin';
end
$$;
