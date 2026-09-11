-- Lets each seller choose the compact carousel or a multi-row photo overview.
alter table public.app_settings
  add column if not exists photo_editor_layout text not null default 'carousel'
  check (photo_editor_layout in ('carousel', 'grid'));
